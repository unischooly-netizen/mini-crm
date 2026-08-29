// lib/performanceMetrics.ts — Phase A.1 correctness pass.
//
// This is a shared CANDIDATE metrics module for Shifu, extracted from the
// bucket pattern in app/api/dashboards/ceo/route.ts. It is NOT yet the
// single source of truth — team-performance, qualified-dashboard, and ceo
// still contain their own separate (and, per audit below, not fully
// period-consistent) copies. This file should only be called "canonical"
// once those dashboards are refactored to consume it and parity is proven.
//
// -----------------------------------------------------------------------
// SNAPSHOT vs PERIOD — why this split exists
// -----------------------------------------------------------------------
// Audit of ceo/route.ts's accumulate() found it silently mixes two kinds
// of metric inside one bucket:
//   - genuinely period-filtered: call attempts (attempt{n}_date checked
//     against the requested range) — this part was correct.
//   - CURRENT STATE, not date-filtered at all: qualified/meetingDone/
//     trialDone/admissionWon are all tallied from the lead's *current*
//     status field, regardless of when that status was reached. ceo's
//     "scope" is pre-filtered by assignedDate, so these numbers actually
//     mean "of leads assigned in this window, how many are (as of right
//     now) qualified/meeting-done/etc" — not "became qualified/done
//     within this window." Those are different questions.
// Asking Shifu "how did Swati do today" and having it silently return a
// snapshot number labeled as today's activity is exactly the kind of
// confidently-wrong answer this correctness pass exists to prevent. So:
// every function below is named to make its scope obvious, and there is
// no function that blends the two without saying so.
//
// -----------------------------------------------------------------------
// Which date field backs each PERIOD metric (and known limitations)
// -----------------------------------------------------------------------
//   calls / connected calls   -> attempt{1-9}_date (per-attempt, exact)
//   qualified                 -> qualified_at (stamped once, exact)
//   admissions won/lost       -> admission_timestamp (exact)
//   meetings scheduled/done   -> meeting_date (PROXY, see below)
//   trials scheduled/done     -> trial_date (PROXY, see below)
//
// meeting_date and trial_date are single mutable fields, not an event
// log — if a meeting is rescheduled, the old date is overwritten, so
// "meetings scheduled in range X" really means "the lead's *currently
// recorded* meeting date falls in X," which can undercount reschedule
// history. There is no timestamp anywhere for "when connecting_status
// became Joined," so meetingsDoneInRange uses meeting_date as the closest
// available proxy for "when this meeting happened." This is a genuine
// data-model limitation, not something fixable in this module alone.

import { sql } from '@/lib/db';
import { ATTEMPT_COUNT } from '@/lib/masters';

function toDateStr(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'string') return v.slice(0, 10);
  return String(v).slice(0, 10);
}

export type PerfLead = {
  leadCode: string;
  owner: string | null;
  ownerUserId: number | null;
  assignedVhName: string | null;
  assignedVhUserId: number | null;
  assignedCounsellorName: string | null;
  assignedCounsellorUserId: number | null;
  language: string;
  source: string;
  status: string;
  qualificationStatus: string;
  lifecycleStatus: string;
  handoverStatus: string | null;
  connectingStatus: string | null; // authoritative field for meeting outcome — see "meeting completed" note below
  meetingDate: string | null;
  meetingAttemptCount: number;
  trialDate: string | null;
  trialStatus: string | null;
  admissionStatus: string | null;
  admissionTimestamp: string | null;
  qualifiedAt: string | null;
  nextFollowupDate: string | null;
  attempts: { status: string | null; date: string | null }[];
};

/** Same SELECT as ceo/route.ts, plus assigned_vh_user_id / assigned_counsellor_user_id (Phase A.1 fix #4 — ID-based, not name-based, person scoping) and status (for follow-up exclusion rules). */
export async function fetchAllLeadsRich(): Promise<PerfLead[]> {
  const attemptCols = Array.from({ length: ATTEMPT_COUNT }, (_, i) => {
    const n = i + 1;
    return `l.attempt${n}_status AS "a${n}s", l.attempt${n}_date AS "a${n}d"`;
  }).join(', ');

  const rows = await sql.query(
    `SELECT l.lead_code AS "leadCode", l.status,
            owner.name AS "owner", l.owner_user_id AS "ownerUserId",
            vh.name AS "assignedVhName", l.assigned_vh_user_id AS "assignedVhUserId",
            counsellor.name AS "assignedCounsellorName", l.assigned_counsellor_user_id AS "assignedCounsellorUserId",
            l.language, l.source,
            l.qualification_status AS "qualificationStatus", l.lifecycle_status AS "lifecycleStatus",
            l.handover_status AS "handoverStatus",
            l.connecting_status AS "connectingStatus", l.meeting_date AS "meetingDate",
            l.meeting_attempt_count AS "meetingAttemptCount",
            l.trial_date AS "trialDate", l.trial_status AS "trialStatus",
            l.admission_status AS "admissionStatus", l.admission_timestamp AS "admissionTimestamp",
            l.qualified_at AS "qualifiedAt", l.next_followup_date AS "nextFollowupDate",
            ${attemptCols}
     FROM leads l
     LEFT JOIN users owner ON owner.id = l.owner_user_id
     LEFT JOIN users vh ON vh.id = l.assigned_vh_user_id
     LEFT JOIN users counsellor ON counsellor.id = l.assigned_counsellor_user_id`
  );

  return (rows as Record<string, unknown>[]).map((r) => {
    const attempts = Array.from({ length: ATTEMPT_COUNT }, (_, i) => {
      const n = i + 1;
      return { status: (r[`a${n}s`] as string) || null, date: toDateStr(r[`a${n}d`]) };
    }).filter((a) => a.status || a.date);
    return {
      leadCode: r.leadCode as string,
      status: (r.status as string) || 'New',
      owner: (r.owner as string) || null,
      ownerUserId: (r.ownerUserId as number) ?? null,
      assignedVhName: (r.assignedVhName as string) || null,
      assignedVhUserId: (r.assignedVhUserId as number) ?? null,
      assignedCounsellorName: (r.assignedCounsellorName as string) || null,
      assignedCounsellorUserId: (r.assignedCounsellorUserId as number) ?? null,
      language: (r.language as string) || '',
      source: (r.source as string) || '',
      qualificationStatus: (r.qualificationStatus as string) || 'Not Reviewed',
      lifecycleStatus: (r.lifecycleStatus as string) || 'Active Qualified',
      handoverStatus: (r.handoverStatus as string) || null,
      connectingStatus: (r.connectingStatus as string) || null,
      meetingDate: toDateStr(r.meetingDate),
      meetingAttemptCount: Number(r.meetingAttemptCount) || 0,
      trialDate: toDateStr(r.trialDate),
      trialStatus: (r.trialStatus as string) || null,
      admissionStatus: (r.admissionStatus as string) || null,
      admissionTimestamp: r.admissionTimestamp ? toDateStr(r.admissionTimestamp) : null,
      qualifiedAt: r.qualifiedAt ? toDateStr(r.qualifiedAt) : null,
      nextFollowupDate: toDateStr(r.nextFollowupDate),
      attempts,
    };
  });
}

export type DateRange = { start: string; end: string };
const inRange = (d: string | null, r: DateRange) => !!d && d >= r.start && d <= r.end;

// ---------------------------------------------------------------------------
// SNAPSHOT — "as of right now." No date filtering. Optional cohort param
// only restricts WHICH leads are included (e.g. assigned in a window),
// never treats a status as if it happened within that window.
// ---------------------------------------------------------------------------

export function emptySnapshot() {
  return {
    currentAssigned: 0, currentQualified: 0, currentFollowUpNeeded: 0, currentNotQualified: 0, currentNotReviewed: 0,
    currentVhAssigned: 0, currentCounsellorAssigned: 0, currentPendingVh: 0, currentPendingCounsellor: 0, currentPendingFirstContact: 0,
    currentMeetingScheduled: 0, currentMeetingDone: 0, currentMeetingNotJoined: 0, currentMeetingRescheduled: 0, currentMeetingCancelled: 0,
    currentTrialScheduled: 0, currentTrialDone: 0, currentTrialNotDone: 0, currentTrialRescheduled: 0,
    currentAdmissionPending: 0, currentAdmissionOnHold: 0, currentAdmissionWon: 0, currentAdmissionLost: 0,
    currentActivePipeline: 0, currentRevoked: 0,
  };
}
export type Snapshot = ReturnType<typeof emptySnapshot>;

export function computeSnapshot(leads: PerfLead[]): Snapshot {
  const s = emptySnapshot();
  for (const lead of leads) {
    s.currentAssigned += 1;
    const isQualified = lead.qualificationStatus === 'Qualified';
    if (isQualified) s.currentQualified += 1;
    else if (lead.qualificationStatus === 'Follow-up Needed') s.currentFollowUpNeeded += 1;
    else if (lead.qualificationStatus === 'Not Qualified') s.currentNotQualified += 1;
    else s.currentNotReviewed += 1;

    if (isQualified) {
      if (lead.assignedVhUserId) s.currentVhAssigned += 1;
      else s.currentPendingVh += 1;
      if (lead.assignedCounsellorUserId) s.currentCounsellorAssigned += 1;
      else if (lead.assignedVhUserId) s.currentPendingCounsellor += 1;
      if (lead.assignedCounsellorUserId && lead.connectingStatus === 'Pending' && lead.meetingAttemptCount === 0) {
        s.currentPendingFirstContact += 1;
      }
    }

    if (lead.meetingDate) s.currentMeetingScheduled += 1;
    // "Meeting completed" canonical definition: connecting_status = 'Joined'.
    // connecting_status is the field the user actually sets (in
    // AGENT_EDITABLE_FIELDS / COUNSELLOR_EDITABLE_FIELDS); meeting_status is
    // a derived, system-written-only display duplicate computed by
    // computeMeetingStatus() in lib/leadLogic.ts — it should always equal
    // CONNECTING_TO_MEETING_STATUS[connecting_status], so querying it
    // directly is redundant at best and a risk if it were ever out of sync.
    // Every existing dashboard (ceo, qualified-dashboard) already reads
    // connecting_status, not meeting_status — this module now matches them.
    if (lead.connectingStatus === 'Joined') s.currentMeetingDone += 1;
    if (lead.connectingStatus === 'Not Joined') s.currentMeetingNotJoined += 1;
    if (lead.connectingStatus === 'Rescheduled') s.currentMeetingRescheduled += 1;
    if (lead.connectingStatus === 'Cancelled') s.currentMeetingCancelled += 1;

    if (lead.trialDate) s.currentTrialScheduled += 1;
    if (lead.trialStatus === 'Trial Done') s.currentTrialDone += 1;
    if (lead.trialStatus === 'Trial Not Done') s.currentTrialNotDone += 1;
    if (lead.trialStatus === 'Rescheduled' || lead.trialStatus === 'Trial Sceduled but not done') s.currentTrialRescheduled += 1;

    const admissionStatus = lead.admissionStatus || 'Pending';
    if (admissionStatus === 'Pending') s.currentAdmissionPending += 1;
    if (admissionStatus === 'On Hold') s.currentAdmissionOnHold += 1;
    if (admissionStatus === 'Closed Won') s.currentAdmissionWon += 1;
    if (admissionStatus === 'Closed Lost') s.currentAdmissionLost += 1;

    if (isQualified && lead.lifecycleStatus === 'Active Qualified' && admissionStatus !== 'Closed Won' && admissionStatus !== 'Closed Lost') {
      s.currentActivePipeline += 1;
    }
    if (lead.lifecycleStatus === 'Revoked') s.currentRevoked += 1;
  }
  return s;
}

export function snapshotRates(s: Snapshot) {
  return {
    ...s,
    currentQualifiedRate: s.currentAssigned ? s.currentQualified / s.currentAssigned : 0,
    currentMeetingJoinRate: s.currentMeetingScheduled ? s.currentMeetingDone / s.currentMeetingScheduled : 0,
    currentTrialCompletionRate: s.currentTrialScheduled ? s.currentTrialDone / s.currentTrialScheduled : 0,
    currentAdmissionWinRate: s.currentAdmissionWon + s.currentAdmissionLost ? s.currentAdmissionWon / (s.currentAdmissionWon + s.currentAdmissionLost) : 0,
  };
}

// ---------------------------------------------------------------------------
// PERIOD — "this specific thing happened within this date range," backed
// by the actual event date field for each metric (see header note on
// proxies for meeting/trial).
// ---------------------------------------------------------------------------

export function emptyPeriod() {
  return {
    callsInRange: 0, connectedCallsInRange: 0, uniqueConnectedLeadsInRange: 0,
    qualifiedInRange: 0,
    meetingsScheduledInRange: 0, meetingsDoneInRange: 0,
    trialsScheduledInRange: 0, trialsDoneInRange: 0,
    admissionsWonInRange: 0, admissionsLostInRange: 0,
  };
}
export type Period = ReturnType<typeof emptyPeriod>;

export function computePeriod(leads: PerfLead[], range: DateRange): Period {
  const p = emptyPeriod();
  for (const lead of leads) {
    const attemptsInRange = lead.attempts.filter((a) => inRange(a.date, range));
    p.callsInRange += attemptsInRange.length;
    const connected = attemptsInRange.filter((a) => a.status === 'Connected');
    p.connectedCallsInRange += connected.length;
    if (connected.length > 0) p.uniqueConnectedLeadsInRange += 1;

    if (inRange(lead.qualifiedAt, range)) p.qualifiedInRange += 1;

    if (inRange(lead.meetingDate, range)) {
      p.meetingsScheduledInRange += 1;
      if (lead.connectingStatus === 'Joined') p.meetingsDoneInRange += 1;
    }
    if (inRange(lead.trialDate, range)) {
      p.trialsScheduledInRange += 1;
      if (lead.trialStatus === 'Trial Done') p.trialsDoneInRange += 1;
    }
    if (lead.admissionStatus === 'Closed Won' && inRange(lead.admissionTimestamp, range)) p.admissionsWonInRange += 1;
    if (lead.admissionStatus === 'Closed Lost' && inRange(lead.admissionTimestamp, range)) p.admissionsLostInRange += 1;
  }
  return p;
}

export function periodRates(p: Period) {
  return {
    ...p,
    callConnectionRateInRange: p.callsInRange ? p.connectedCallsInRange / p.callsInRange : 0,
    meetingDoneRateInRange: p.meetingsScheduledInRange ? p.meetingsDoneInRange / p.meetingsScheduledInRange : 0,
    trialDoneRateInRange: p.trialsScheduledInRange ? p.trialsDoneInRange / p.trialsScheduledInRange : 0,
  };
}

// ---------------------------------------------------------------------------
// Follow-ups — always evaluated "as of right now," never date-range-scoped
// (next_followup_date is a single current pending target, not a log, so
// there is no meaningful "what was overdue as of last Tuesday").
// Phase A.1 fix #3: due-today and overdue are now mutually exclusive.
//
// Phase A.2 fix #3 (user-flagged, "match exactly the same business rule as
// the CRM, do not assume"): audited app/api/dashboards/today-followup/
// route.ts, the real existing "Today's Follow-up" dashboard feature. It
// applies WHERE next_followup_date = today with NO status/qualification
// exclusion of any kind. The `excludeClosed` default here used to be
// `true`, which silently disagreed with that dashboard. Default flipped to
// `false` so Shifu's numbers match the CRM's own dashboard exactly out of
// the box. The parameter is kept (not deleted) only because getAttentionItems
// in context.ts deliberately wants a filtered, "what still needs a human
// decision" view for its own separate feature — that is a new Shifu concept
// with no existing dashboard equivalent to be consistent with, not a mirror
// of Today's Follow-up, so it is allowed to differ and does so explicitly.
// ---------------------------------------------------------------------------

export function followupCounts(leads: PerfLead[], todayIso: string, excludeClosed = false) {
  const scoped = excludeClosed ? leads.filter((l) => l.status !== 'Not Qualified') : leads;
  return {
    followupsDueToday: scoped.filter((l) => l.nextFollowupDate === todayIso).length,
    followupsOverdue: scoped.filter((l) => !!l.nextFollowupDate && l.nextFollowupDate < todayIso).length,
    followupsDueOrOverdue: scoped.filter((l) => !!l.nextFollowupDate && l.nextFollowupDate <= todayIso).length,
  };
}
