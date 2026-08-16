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

export function computePipelineStatus(totalAttempts: number, qualificationStatus: string): string {
  if (totalAttempts === 0) return 'New';
  if (qualificationStatus === 'Not Reviewed') return 'Not Picked';
  return qualificationStatus; // 'Qualified' | 'Not Qualified' | 'Follow-up Needed'
}

export function computeHandoverStatus(
  qualificationStatus: string,
  assignedVhUserId: number | null,
  assignedCounsellorUserId: number | null
): string {
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
