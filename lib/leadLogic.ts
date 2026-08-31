import {
  ATTEMPT_COUNT, AUTO_FOLLOWUP_TRIGGER_STATUSES, FINAL_OUTCOME_TO_QUALIFICATION,
  CONNECTING_TO_MEETING_STATUS, MEETING_CONCLUDING_STATUSES, TRIAL_CONCLUDING_STATUSES,
} from './masters';
import { computeNextFollowup, computeBusinessHoursFollowup, subtractMinutes, fromIstWallClock } from './followup';

export function computeTotalAttempts(fields: Record<string, unknown>): number {
  let count = 0;
  for (let i = 1; i <= ATTEMPT_COUNT; i++) {
    if (fields[`attempt${i}Status`]) count++;
  }
  return count;
}

export function computeQualificationStatus(finalOutcome: string | null | undefined): string {
  if (!finalOutcome) return 'Not Reviewed';
  return FINAL_OUTCOME_TO_QUALIFICATION[finalOutcome] || 'Not Reviewed';
}

/**
 * Extracted from app/api/leads/[id]/route.ts's PATCH handler (Aug 2026
 * qualified_at diagnostic pass) so this specific piece of logic is
 * independently unit-testable — the ternary itself is unchanged, byte for
 * byte, from what already shipped; this is a pure extraction, not a
 * behavior change.
 *
 * V1 SEMANTIC (confirmed correct on inspection, kept as-is): qualified_at
 * is stamped with the current server time every time a lead TRANSITIONS
 * from a non-Qualified qualification_status into 'Qualified' — including
 * on a requalification after being reverted (e.g. Qualified -> Not
 * Qualified -> Qualified again re-stamps to the second event's time, not
 * the first). It is left untouched on any save that doesn't cross that
 * boundary — either because the lead was already Qualified before this
 * save (an unrelated field edit, or a Final Outcome edit that still maps
 * to Qualified), or because it isn't becoming Qualified at all.
 *
 * This is the right choice for "when was this lead (last) qualified"-
 * style questions specifically because it reflects the most recent
 * qualification event, not a stale first-ever one — matches
 * computeLifecycle()'s existing Revoked/Active-Qualified handling just
 * below, which already treats Qualified -> Not Qualified -> Qualified as
 * a real, designed-for cycle (a "Revoked" lead returning to "Active
 * Qualified"). Always pass a SERVER-generated `nowIso` (e.g.
 * `new Date().toISOString()`), never a client-supplied timestamp — the
 * caller in app/api/leads/[id]/route.ts already does this correctly.
 */
export function computeQualifiedAt(
  wasQualified: boolean,
  newQualificationStatus: string,
  nowIso: string,
  existingQualifiedAt: string | null
): string | null {
  return !wasQualified && newQualificationStatus === 'Qualified' ? nowIso : existingQualifiedAt;
}

/**
 * Phase B.5, Task 1 — per-attempt-slot historical-timestamp protection.
 * Extracted from app/api/leads/[id]/route.ts's PATCH handler (byte-for-byte
 * the same decision the route already made inline, just made independently
 * testable) so a regression here is caught by a unit test, not discovered
 * live in production the way the original re-stamping bug was.
 *
 * Rule, decided per slot, never from a single "last changed" trigger index
 * that would apply to every slot at once:
 *   - The slot has NEVER been recorded before (no existing date AND no
 *     existing time stored) -> a genuinely new attempt. Stamp with the
 *     server-supplied `nowDate`/`nowTime`.
 *   - The slot already has a stored date and/or time -> any status change
 *     is treated as a CORRECTION. The status text may change; the stored
 *     date/time is returned exactly as it was, untouched.
 *   - Whether a slot is "new" or a "correction" is decided ONLY by what's
 *     already in the database for that slot — never by a client-supplied
 *     timestamp, and never by today's date being assumed.
 *   - Edge case: a malformed legacy row (a status is present but both date
 *     and time are null, e.g. an old import missing its attempt date) is
 *     treated the same as "never recorded" — there is no trustworthy
 *     historical timestamp to preserve, so the safest, most honest choice
 *     is to stamp it as of the moment it's actually being acted on now.
 *     This is a deliberate, documented choice, not an oversight.
 *
 * `nowDate`/`nowTime` must always come from the server clock (the caller
 * already does this correctly via toIstDateTimeParts(new Date())) — never
 * from client-supplied input.
 */
export function computeAttemptSlotUpdate(
  existingStatus: string | null,
  existingDate: string | null,
  existingTime: string | null,
  suppliedStatus: string | null | undefined,
  nowDate: string,
  nowTime: string
): { status: string | null; date: string | null; time: string | null; isNewAttempt: boolean } {
  const statusChanged = suppliedStatus !== undefined && suppliedStatus !== existingStatus && !!suppliedStatus;
  const alreadyTimestamped = !!(existingDate || existingTime);

  const status = (suppliedStatus !== undefined ? suppliedStatus : existingStatus) || null;
  let date = existingDate;
  let time = existingTime;
  let isNewAttempt = false;

  if (statusChanged && !alreadyTimestamped) {
    date = nowDate;
    time = nowTime;
    isNewAttempt = true;
  }
  // else: no change, or a correction of an already-timestamped slot —
  // date/time are left untouched either way.

  return { status, date, time, isNewAttempt };
}

/**
 * Phase B.5, Task 2 — VH / Counsellor reassignment timestamp semantic.
 * Extracted from app/api/leads/[id]/route.ts's PATCH handler (byte-for-byte
 * the same ternary chain already shipped there) so both the VH and
 * Counsellor call sites share one tested implementation instead of two
 * independently-maintained copies that could silently drift apart.
 *
 * Canonical semantic (Phase B.5 spec, Task 2): `vh_assigned_at` /
 * `counsellor_assigned_at` mean "when the CURRENT assignee was assigned" —
 * not "when this lead was first ever assigned a VH/Counsellor, regardless
 * of who." Therefore:
 *   - NULL -> a user: stamp now.
 *   - user A -> user B (an actual reassignment): stamp now (this is the
 *     fix — the old logic only ever stamped on the very first null->user
 *     transition, so reassigning kept showing the original assignee's old
 *     date forever).
 *   - same user saved again (no real change): do NOT re-stamp — return the
 *     existing value untouched.
 *   - user -> NULL (cleared/unassigned): return null. A timestamp
 *     describing "when the current assignee was assigned" is meaningless
 *     once there is no current assignee, and the UI does support clearing
 *     an assignment back to "Unassigned."
 * This deliberately does NOT preserve who held the role before or when —
 * that needs a future event log, out of scope here.
 */
export function computeAssignedAt(
  newUserId: number | null,
  oldUserId: number | null,
  existingAssignedAt: string | null,
  nowIso: string
): string | null {
  if (newUserId === oldUserId) return existingAssignedAt;
  return newUserId ? nowIso : null;
}

/**
 * BUG FIX (found Aug 2026, "stuck in New" report): previously this checked
 * `totalAttempts === 0` FIRST, which forced ANY lead with zero in-system
 * attempts into "New" — even one whose qualification_status was already a
 * decisive Qualified / Not Qualified / Follow-up Needed. That assumption
 * holds for leads worked entirely inside this CRM (an agent can't reach a
 * qualification outcome without first logging attempts), but it silently
 * broke for imported leads: a full-import row can carry a Final Outcome
 * (so qualificationStatus is already decided) while its Attempt 1-9
 * columns are blank in the source file (so totalAttempts computes to 0,
 * since this system has no call-attempt history for it). The result:
 * Status column correctly showed "Qualified," but the lead's tab/pipeline
 * bucket was forced back to "New," making it invisible to the agent as
 * already-qualified work.
 *
 * Fix: a decisive qualification outcome always wins, regardless of
 * in-system attempt count. Attempt count only decides the split between
 * "New" (never touched) and "Not Picked" (attempted but not yet reviewed)
 * for leads that haven't been reviewed at all.
 */
export function computePipelineStatus(totalAttempts: number, qualificationStatus: string): string {
  if (qualificationStatus !== 'Not Reviewed') return qualificationStatus; // 'Qualified' | 'Not Qualified' | 'Follow-up Needed'
  return totalAttempts === 0 ? 'New' : 'Not Picked';
}

// Handover Status is the single at-a-glance "how far along is this lead"
// indicator. It progresses: Not Ready -> Qualified - Pending VH -> VH
// Assigned -> Counsellor Assigned -> Meeting Completed (once they actually
// joined) -> Trial Completed -> Admission Closed. Whichever stage the lead
// has reached furthest wins — it never moves backwards on its own.
export function computeHandoverStatus(
  qualificationStatus: string,
  assignedVhUserId: number | null,
  assignedCounsellorUserId: number | null,
  connectingStatus?: string | null,
  trialStatus?: string | null,
  admissionStatus?: string | null
): string {
  if (admissionStatus === 'Closed Won' || admissionStatus === 'Closed Lost') return 'Admission Closed';
  if (trialStatus === 'Trial Done') return 'Trial Completed';
  if (connectingStatus === 'Joined') return 'Meeting Completed';
  if (assignedCounsellorUserId) return 'Counsellor Assigned';
  if (assignedVhUserId) return 'VH Assigned';
  if (qualificationStatus === 'Qualified') return 'Qualified - Pending VH';
  return 'Not Ready';
}

/** True if this attempt status means "we didn't actually get through". */
export function isAutoFollowupTrigger(attemptStatus: string | null | undefined): boolean {
  return !!attemptStatus && AUTO_FOLLOWUP_TRIGGER_STATUSES.includes(attemptStatus);
}

/** Meeting Status auto-cascades from Connecting Status. */
export function computeMeetingStatus(connectingStatus: string | null | undefined, fallback: string): string {
  if (!connectingStatus) return fallback || 'Pending';
  return CONNECTING_TO_MEETING_STATUS[connectingStatus] || fallback || 'Pending';
}

/** True if this Connecting Status value means "this meeting attempt just concluded". */
export function isMeetingConcludingStatus(connectingStatus: string | null | undefined): boolean {
  return !!connectingStatus && MEETING_CONCLUDING_STATUSES.includes(connectingStatus);
}

/** True if this Trial Status value means "this trial attempt just concluded". */
export function isTrialConcludingStatus(trialStatus: string | null | undefined): boolean {
  return !!trialStatus && TRIAL_CONCLUDING_STATUSES.includes(trialStatus);
}

/**
 * Revoke/re-qualify bookkeeping: called whenever qualification status may
 * have changed this save. If a lead was Qualified and no longer is, it's
 * marked Revoked (background audit fields only — it simply drops out of the
 * Qualified Leads view, which already filters on qualification_status).
 * If it becomes Qualified again later, the revoke record is cleared.
 */
export function computeLifecycle(
  previousQualificationStatus: string | null | undefined,
  newQualificationStatus: string,
  finalOutcome: string | null | undefined,
  nowUtc: Date,
  existing: { lifecycleStatus: string | null; revokedTimestamp: string | null; revokedReason: string | null }
): { lifecycleStatus: string; revokedTimestamp: string | null; revokedReason: string | null } {
  const wasQualified = previousQualificationStatus === 'Qualified';
  const isQualifiedNow = newQualificationStatus === 'Qualified';

  if (wasQualified && !isQualifiedNow) {
    return {
      lifecycleStatus: 'Revoked',
      revokedTimestamp: nowUtc.toISOString(),
      revokedReason: `Final Outcome changed to "${finalOutcome || 'Not Reviewed'}"`,
    };
  }
  if (!wasQualified && isQualifiedNow) {
    return { lifecycleStatus: 'Active Qualified', revokedTimestamp: null, revokedReason: null };
  }
  return {
    lifecycleStatus: existing.lifecycleStatus || 'Active Qualified',
    revokedTimestamp: existing.revokedTimestamp,
    revokedReason: existing.revokedReason,
  };
}

export { computeNextFollowup, computeBusinessHoursFollowup, subtractMinutes, fromIstWallClock };
