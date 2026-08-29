import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { logAction } from '@/lib/audit';
import { AGENT_EDITABLE_FIELDS, COUNSELLOR_EDITABLE_FIELDS } from '@/lib/masters';
import {
  computeTotalAttempts,
  computeQualificationStatus,
  computeQualifiedAt,
  computePipelineStatus,
  computeHandoverStatus,
  computeNextFollowup,
  computeBusinessHoursFollowup,
  isAutoFollowupTrigger,
  computeMeetingStatus,
  isMeetingConcludingStatus,
  isTrialConcludingStatus,
  computeLifecycle,
} from '@/lib/leadLogic';
import { toIstDateTimeParts, subtractMinutes, fromIstWallClock } from '@/lib/followup';

const SELECT_LEAD_COLUMNS = `
      l.id, l.lead_code AS "leadCode", l.name, l.mobile, l.email, l.source, l.language,
      l.assigned_date AS "assignedDate", l.owner_user_id AS "ownerUserId", l.status, l.notes,
      l.state, l.profession, l.purpose,
      l.attempt1_status AS "attempt1Status", l.attempt1_date AS "attempt1Date", l.attempt1_time AS "attempt1Time",
      l.attempt2_status AS "attempt2Status", l.attempt2_date AS "attempt2Date", l.attempt2_time AS "attempt2Time",
      l.attempt3_status AS "attempt3Status", l.attempt3_date AS "attempt3Date", l.attempt3_time AS "attempt3Time",
      l.attempt4_status AS "attempt4Status", l.attempt4_date AS "attempt4Date", l.attempt4_time AS "attempt4Time",
      l.attempt5_status AS "attempt5Status", l.attempt5_date AS "attempt5Date", l.attempt5_time AS "attempt5Time",
      l.attempt6_status AS "attempt6Status", l.attempt6_date AS "attempt6Date", l.attempt6_time AS "attempt6Time",
      l.attempt7_status AS "attempt7Status", l.attempt7_date AS "attempt7Date", l.attempt7_time AS "attempt7Time",
      l.attempt8_status AS "attempt8Status", l.attempt8_date AS "attempt8Date", l.attempt8_time AS "attempt8Time",
      l.attempt9_status AS "attempt9Status", l.attempt9_date AS "attempt9Date", l.attempt9_time AS "attempt9Time",
      l.total_attempts AS "totalAttempts", l.final_outcome AS "finalOutcome",
      l.qualification_status AS "qualificationStatus",
      l.next_followup_date AS "nextFollowupDate", l.next_followup_time AS "nextFollowupTime",
      l.course_start_timeline AS "courseStartTimeline", l.meeting_date AS "meetingDate", l.meeting_time AS "meetingTime",
      l.preferred_mode AS "preferredMode", l.handover_status AS "handoverStatus",
      l.assigned_vh_user_id AS "assignedVhUserId", vh.name AS "assignedVhName",
      l.assigned_counsellor_user_id AS "assignedCounsellorUserId", counsellor.name AS "assignedCounsellorName",
      l.counsellor_update AS "counsellorUpdate", l.updated_at AS "updatedAt",
      l.connecting_status AS "connectingStatus", l.meeting_status AS "meetingStatus",
      l.meeting_attempt_count AS "meetingAttemptCount",
      l.next_meeting_date AS "nextMeetingDate", l.next_meeting_time AS "nextMeetingTime",
      l.trial_date AS "trialDate", l.trial_time AS "trialTime", l.trial_status AS "trialStatus",
      l.trial_attempt_count AS "trialAttemptCount",
      l.next_trial_date AS "nextTrialDate", l.next_trial_time AS "nextTrialTime",
      l.admission_status AS "admissionStatus", l.admission_timestamp AS "admissionTimestamp",
      l.qualified_at AS "qualifiedAt", l.vh_assigned_at AS "vhAssignedAt", l.counsellor_assigned_at AS "counsellorAssignedAt",
      l.meeting_booked_at AS "meetingBookedAt", l.trial_booked_at AS "trialBookedAt",
      l.lifecycle_status AS "lifecycleStatus", l.revoked_timestamp AS "revokedTimestamp", l.revoked_reason AS "revokedReason",
      l.reminder_call1_status AS "reminderCall1Status", l.reminder_call1_date AS "reminderCall1Date", l.reminder_call1_time AS "reminderCall1Time",
      l.reminder_call2_status AS "reminderCall2Status", l.reminder_call2_date AS "reminderCall2Date", l.reminder_call2_time AS "reminderCall2Time",
      l.reminder_call3_status AS "reminderCall3Status", l.reminder_call3_date AS "reminderCall3Date", l.reminder_call3_time AS "reminderCall3Time"
`;

// Columns whose Postgres type is DATE. The underlying driver hands these
// back as native JS Date objects (not strings) when read server-side,
// before Next.js gets a chance to JSON-serialize the response (JSON.stringify
// auto-converts Date -> ISO string, which is why this never showed up on the
// client — but code here in the route runs *before* that conversion). Any
// date-math helper expecting a 'YYYY-MM-DD' string then crashes calling
// .slice() on a Date object with something like "e.slice is not a function".
// Fix at the source: normalize every DATE column to a plain string the
// moment a row comes back from the database.
const DATE_COLUMNS = [
  'assignedDate', 'nextFollowupDate', 'meetingDate', 'nextMeetingDate',
  'trialDate', 'nextTrialDate',
  ...Array.from({ length: 9 }, (_, i) => `attempt${i + 1}Date`),
  ...Array.from({ length: 3 }, (_, i) => `reminderCall${i + 1}Date`),
];

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

function normalizeDateColumns(row: Record<string, unknown>): Record<string, unknown> {
  for (const col of DATE_COLUMNS) {
    if (col in row) row[col] = toDateStr(row[col]);
  }
  return row;
}

async function fetchLead(leadId: number) {
  const rows = await sql.query(
    `SELECT ${SELECT_LEAD_COLUMNS}
     FROM leads l
     LEFT JOIN users vh ON vh.id = l.assigned_vh_user_id
     LEFT JOIN users counsellor ON counsellor.id = l.assigned_counsellor_user_id
     WHERE l.id = $1
     LIMIT 1`,
    [leadId]
  );
  const row = (rows as Record<string, unknown>[])[0];
  return row ? normalizeDateColumns(row) : null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });

  const { id } = await params;
  const leadId = Number(id);
  if (!Number.isInteger(leadId)) return NextResponse.json({ error: 'Invalid lead id.' }, { status: 400 });

  const lead = await fetchLead(leadId);
  if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });

  const ownerUserId = lead.ownerUserId as number | null;
  const assignedVhUserId = lead.assignedVhUserId as number | null;
  const assignedCounsellorUserId = lead.assignedCounsellorUserId as number | null;

  const canView =
    session.role === 'admin' ||
    session.role === 'data_team' ||
    (session.role === 'presales_agent' && ownerUserId === session.id) ||
    (session.role === 'vertical_head' && assignedVhUserId === session.id) ||
    (session.role === 'sales_counsellor' && assignedCounsellorUserId === session.id);

  if (!canView) return NextResponse.json({ error: 'You do not have access to this lead.' }, { status: 403 });

  return NextResponse.json({
    lead,
    editableFields: session.role === 'presales_agent' && ownerUserId === session.id ? AGENT_EDITABLE_FIELDS : [],
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });

  const { id } = await params;
  const leadId = Number(id);
  if (!Number.isInteger(leadId)) return NextResponse.json({ error: 'Invalid lead id.' }, { status: 400 });

  const existing = await fetchLead(leadId);
  if (!existing) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  try {

  const ownerUserId = existing.ownerUserId as number | null;
  const assignedVhUserId0 = existing.assignedVhUserId as number | null;
  const assignedCounsellorUserId0 = existing.assignedCounsellorUserId as number | null;

  const isOwnerAgent = session.role === 'presales_agent' && ownerUserId === session.id;
  const isAssignedVh = session.role === 'vertical_head' && assignedVhUserId0 === session.id;
  const isAssignedCounsellor = session.role === 'sales_counsellor' && assignedCounsellorUserId0 === session.id;
  const isAdmin = session.role === 'admin';
  const isDataTeam = session.role === 'data_team';

  if (!isAdmin && !isDataTeam && !isOwnerAgent && !isAssignedVh && !isAssignedCounsellor) {
    return NextResponse.json({ error: 'You do not have access to this lead.' }, { status: 403 });
  }

  // Per-field permission: silently drop any field the caller's role isn't allowed to touch,
  // rather than rejecting the whole request (keeps the UI simple — it only ever sends what
  // it shows the user, so this is really a safety net).
  const allowedKeys = new Set<string>();
  if (isAdmin) {
    // Admin can edit anything an agent or counsellor can, plus owner/VH assignment.
    AGENT_EDITABLE_FIELDS.forEach((k) => allowedKeys.add(k));
    COUNSELLOR_EDITABLE_FIELDS.forEach((k) => allowedKeys.add(k));
    allowedKeys.add('ownerUserId');
    allowedKeys.add('assignedVhUserId');
    allowedKeys.add('assignedCounsellorUserId');
    // Aug 2026 data-quality fix: Language was never editable by anyone
    // after a lead was created — full-import/upload accept a blank
    // Language with no validation (see those routes' comments), so
    // leads could reach Qualified with no Language on record and there
    // was no way to correct it. Admin and Data Team (the two roles that
    // already do data corrections — see ownerUserId above) can now fix it.
    allowedKeys.add('language');
  }
  if (isDataTeam) {
    allowedKeys.add('ownerUserId');
    allowedKeys.add('language');
  }
  if (isOwnerAgent) {
    AGENT_EDITABLE_FIELDS.forEach((k) => allowedKeys.add(k));
  }
  if (isAssignedVh) {
    allowedKeys.add('assignedCounsellorUserId');
  }
  if (isAssignedCounsellor) {
    COUNSELLOR_EDITABLE_FIELDS.forEach((k) => allowedKeys.add(k));
  }

  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) delete body[key];
  }

  const nowUtc = new Date();
  const nowParts = toIstDateTimeParts(nowUtc);

  // ---- Attempts 1-9: detect which one (if any) is being newly logged this save ----
  let triggerIndex: number | null = null;
  let triggerStatus: string | null = null;
  for (let i = 1; i <= 9; i++) {
    const key = `attempt${i}Status`;
    if (body[key] !== undefined && body[key] !== existing[key] && body[key]) {
      triggerIndex = i;
      triggerStatus = body[key] as string;
    }
  }

  const attemptStatuses: (string | null)[] = [];
  const attemptDates: (string | null)[] = [];
  const attemptTimes: (string | null)[] = [];
  for (let i = 1; i <= 9; i++) {
    const key = `attempt${i}Status`;
    const status = ((body[key] !== undefined ? body[key] : existing[key]) || null) as string | null;
    attemptStatuses.push(status);
    let date = (existing[`attempt${i}Date`] || null) as string | null;
    let time = (existing[`attempt${i}Time`] || null) as string | null;
    if (triggerIndex === i) {
      date = nowParts.date;
      time = nowParts.time;
    }
    attemptDates.push(date);
    attemptTimes.push(time);
  }

  const state = ((body.state !== undefined ? body.state : existing.state) || null) as string | null;
  const profession = ((body.profession !== undefined ? body.profession : existing.profession) || null) as string | null;
  const purpose = ((body.purpose !== undefined ? body.purpose : existing.purpose) || null) as string | null;
  // Aug 2026 data-quality fix: language is now correctable by Admin/Data
  // Team (see allowedKeys above) — same optional-field pattern as
  // state/profession/purpose. Trimmed so a whitespace-only value doesn't
  // silently pass validation-that-doesn't-exist and look populated.
  const language = ((body.language !== undefined ? String(body.language).trim() : existing.language) || null) as string | null;
  const finalOutcome = ((body.finalOutcome !== undefined ? body.finalOutcome : existing.finalOutcome) || null) as string | null;
  const notes = body.remarks !== undefined ? String(body.remarks) : (existing.notes as string) || '';
  const courseStartTimeline = ((body.courseStartTimeline !== undefined ? body.courseStartTimeline : existing.courseStartTimeline) || null) as string | null;
  const preferredMode = ((body.preferredMode !== undefined ? body.preferredMode : existing.preferredMode) || null) as string | null;
  const counsellorUpdate = body.counsellorUpdate !== undefined ? String(body.counsellorUpdate) : (existing.counsellorUpdate as string) || '';

  const assignedVhUserId = body.assignedVhUserId !== undefined ? (body.assignedVhUserId as number | null) : assignedVhUserId0;
  const assignedCounsellorUserId =
    body.assignedCounsellorUserId !== undefined ? (body.assignedCounsellorUserId as number | null) : assignedCounsellorUserId0;
  const newOwnerUserId = body.ownerUserId !== undefined ? (body.ownerUserId as number | null) : ownerUserId;

  const totalAttempts = computeTotalAttempts({
    attempt1Status: attemptStatuses[0], attempt2Status: attemptStatuses[1], attempt3Status: attemptStatuses[2],
    attempt4Status: attemptStatuses[3], attempt5Status: attemptStatuses[4], attempt6Status: attemptStatuses[5],
    attempt7Status: attemptStatuses[6], attempt8Status: attemptStatuses[7], attempt9Status: attemptStatuses[8],
  });
  const qualificationStatus = computeQualificationStatus(finalOutcome);
  const pipelineStatus = computePipelineStatus(totalAttempts, qualificationStatus);

  // ---- First-transition timestamps, for funnel/leakage timing analysis ----
  // (Team Performance / Qualified Dashboard "Avg Days X to Y" metrics, and
  // Shifu's LATEST_QUALIFICATION/DAILY_QUALIFICATION_COUNT.) Extracted to
  // lib/leadLogic.ts's computeQualifiedAt() (Aug 2026 diagnostic pass) so
  // this logic is independently unit-tested — see that function's doc
  // comment for the confirmed V1 semantic (re-stamps on each
  // requalification, untouched on any other save).
  const wasQualified = existing.qualificationStatus === 'Qualified';
  const qualifiedAt = computeQualifiedAt(wasQualified, qualificationStatus, nowUtc.toISOString(), (existing.qualifiedAt as string | null));
  const vhAssignedAt =
    !assignedVhUserId0 && assignedVhUserId
      ? nowUtc.toISOString()
      : (existing.vhAssignedAt as string | null);
  const counsellorAssignedAt =
    !assignedCounsellorUserId0 && assignedCounsellorUserId
      ? nowUtc.toISOString()
      : (existing.counsellorAssignedAt as string | null);

  // ---- Meeting / Connecting Status cascade ----
  // Next Meeting Date/Time is a *transient* reschedule input: when both are
  // supplied together, they fold into Meeting Date/Time immediately and the
  // Next Meeting fields go back to blank in the same save. Connecting
  // Status becomes "Rescheduled" automatically when this happens.
  const connectingStatusRaw = body.connectingStatus !== undefined ? (body.connectingStatus as string | null) : undefined;
  const connectingStatusChanged = connectingStatusRaw !== undefined && connectingStatusRaw !== existing.connectingStatus;

  const nextMeetingDateInput = ((body.nextMeetingDate !== undefined ? body.nextMeetingDate : null) || null) as string | null;
  const nextMeetingTimeInput = ((body.nextMeetingTime !== undefined ? body.nextMeetingTime : null) || null) as string | null;
  const meetingRescheduled = !!(nextMeetingDateInput && nextMeetingTimeInput);

  let meetingDate = ((body.meetingDate !== undefined ? body.meetingDate : existing.meetingDate) || null) as string | null;
  let meetingTime = ((body.meetingTime !== undefined ? body.meetingTime : existing.meetingTime) || null) as string | null;
  let nextMeetingDate: string | null = nextMeetingDateInput;
  let nextMeetingTime: string | null = nextMeetingTimeInput;
  // Connecting Status defaults to "Pending" rather than blank once a
  // meeting exists — matches Meeting/Trial/Admission Status, which all
  // default to Pending too.
  let finalConnectingStatus =
    (connectingStatusRaw !== undefined ? connectingStatusRaw : (existing.connectingStatus as string | null)) || 'Pending';

  const notJoinedTriggered = connectingStatusChanged && connectingStatusRaw === 'Not Joined';

  if (meetingRescheduled) {
    meetingDate = nextMeetingDateInput;
    meetingTime = nextMeetingTimeInput;
    nextMeetingDate = null;
    nextMeetingTime = null;
    finalConnectingStatus = 'Rescheduled';
  } else if (notJoinedTriggered) {
    // Meeting Date/Time is intentionally left untouched here — only the
    // Next Follow-up gets moved (see below). The lead now naturally shows
    // up in the Reschedule Pending view (filtered on Connecting Status).
    finalConnectingStatus = 'Not Joined';
  }

  const meetingStatus = computeMeetingStatus(finalConnectingStatus, (existing.meetingStatus as string) || 'Pending');

  let meetingAttemptCount = Number(existing.meetingAttemptCount) || 0;
  if (connectingStatusChanged && isMeetingConcludingStatus(connectingStatusRaw)) {
    meetingAttemptCount += 1;
  }

  // Meeting Booked At — a genuine event timestamp, distinct from Meeting
  // Date/Time (which is WHEN the meeting is scheduled to happen, and gets
  // overwritten on reschedule). Re-stamped every time the effective Meeting
  // Date actually changes value (first booking or a reschedule both count
  // as "a booking action happened right now") — powers the Hourly Report's
  // exact "Meetings Booked this hour" figure. Never touched by anything
  // else, and never populated retroactively.
  const meetingBookedAt =
    meetingDate !== ((existing.meetingDate as string | null) || null) ? nowUtc.toISOString() : (existing.meetingBookedAt as string | null);

  // ---- Trial (mirrors Meeting's automation pattern) ----
  const trialStatusRaw = body.trialStatus !== undefined ? (body.trialStatus as string | null) : undefined;
  const trialStatusChanged = trialStatusRaw !== undefined && trialStatusRaw !== existing.trialStatus;

  const nextTrialDateInput = ((body.nextTrialDate !== undefined ? body.nextTrialDate : null) || null) as string | null;
  const nextTrialTimeInput = ((body.nextTrialTime !== undefined ? body.nextTrialTime : null) || null) as string | null;
  const trialRescheduled = !!(nextTrialDateInput && nextTrialTimeInput);

  let trialDate = ((body.trialDate !== undefined ? body.trialDate : existing.trialDate) || null) as string | null;
  let trialTime = ((body.trialTime !== undefined ? body.trialTime : existing.trialTime) || null) as string | null;
  let nextTrialDate: string | null = nextTrialDateInput;
  let nextTrialTime: string | null = nextTrialTimeInput;
  let finalTrialStatus = (trialStatusRaw !== undefined ? trialStatusRaw : (existing.trialStatus as string | null)) || 'Pending';

  const trialNotDoneTriggered = trialStatusChanged && trialStatusRaw === 'Trial Not Done';

  if (trialRescheduled) {
    trialDate = nextTrialDateInput;
    trialTime = nextTrialTimeInput;
    nextTrialDate = null;
    nextTrialTime = null;
    finalTrialStatus = 'Rescheduled';
  } else if (trialNotDoneTriggered) {
    finalTrialStatus = 'Trial Not Done';
  }

  let trialAttemptCount = Number(existing.trialAttemptCount) || 0;
  if (trialStatusChanged && isTrialConcludingStatus(trialStatusRaw)) {
    trialAttemptCount += 1;
  }

  // Trial Booked At — mirrors Meeting Booked At above, same reasoning.
  const trialBookedAt =
    trialDate !== ((existing.trialDate as string | null) || null) ? nowUtc.toISOString() : (existing.trialBookedAt as string | null);

  // ---- Admission ----
  const admissionStatusRaw = body.admissionStatus !== undefined ? (body.admissionStatus as string | null) : undefined;
  const admissionStatusChanged = admissionStatusRaw !== undefined && admissionStatusRaw !== existing.admissionStatus;
  const admissionStatus = (admissionStatusRaw !== undefined ? admissionStatusRaw : (existing.admissionStatus as string | null)) || 'Pending';
  const admissionTimestamp = admissionStatusChanged ? nowUtc.toISOString() : (existing.admissionTimestamp as string | null);

  const handoverStatus = computeHandoverStatus(
    qualificationStatus, assignedVhUserId, assignedCounsellorUserId,
    finalConnectingStatus, finalTrialStatus, admissionStatus
  );

  // ---- Reminder Calls 1-3 (same auto-stamp pattern as call attempts) ----
  const reminderStatuses: (string | null)[] = [];
  const reminderDates: (string | null)[] = [];
  const reminderTimes: (string | null)[] = [];
  for (let i = 1; i <= 3; i++) {
    const key = `reminderCall${i}Status`;
    const raw = body[key] !== undefined ? (body[key] as string | null) : undefined;
    const changed = raw !== undefined && raw !== existing[key] && raw;
    const status = (raw !== undefined ? raw : (existing[key] as string | null)) || null;
    reminderStatuses.push(status);
    reminderDates.push((changed ? nowParts.date : (existing[`reminderCall${i}Date`] as string | null)) || null);
    reminderTimes.push((changed ? nowParts.time : (existing[`reminderCall${i}Time`] as string | null)) || null);
  }

  // ---- Next Follow-up: priority-ordered automation ----
  // Whichever pipeline stage the lead has progressed furthest into "owns"
  // the reminder: Trial (if one has ever been scheduled) takes priority
  // over Meeting, which takes priority over the plain call-attempt rule.
  //   1) Trial marked Not Done this save        -> Trial time + 1hr (business hours), Trial Date/Time untouched
  //   2) Trial just rescheduled                  -> new Trial time - 30min
  //   3) Trial upcoming (Pending/Rescheduled)     -> Trial time - 30min
  //   4) Meeting marked Not Joined this save      -> Meeting time + 1hr (business hours), Meeting Date/Time untouched
  //   5) Meeting just rescheduled                 -> new Meeting time - 30min
  //   6) Meeting upcoming (Pending/Rescheduled)    -> Meeting time - 30min
  //   7) A "didn't connect" call attempt just logged, no Final Outcome yet -> +2hr business hours
  //   8) Otherwise: whatever was already there / manually typed
  let nextFollowupDate = ((body.nextFollowupDate !== undefined ? body.nextFollowupDate : existing.nextFollowupDate) || null) as string | null;
  let nextFollowupTime = ((body.nextFollowupTime !== undefined ? body.nextFollowupTime : existing.nextFollowupTime) || null) as string | null;

  const trialUpcomingStatuses = [null, 'Pending', 'Rescheduled'];
  const meetingUpcomingStatuses = [null, 'Pending', 'Rescheduled'];
  const trialReminderActive = !!(trialDate && trialTime && trialUpcomingStatuses.includes(finalTrialStatus));
  const meetingReminderActive = !!(meetingDate && meetingTime && meetingUpcomingStatuses.includes(finalConnectingStatus));
  const attemptAutoTriggered = triggerIndex !== null && isAutoFollowupTrigger(triggerStatus) && !finalOutcome;

  if (trialNotDoneTriggered && existing.trialDate && existing.trialTime) {
    const anchor = fromIstWallClock(existing.trialDate as string, existing.trialTime as string);
    const computed = computeBusinessHoursFollowup(anchor, 60);
    nextFollowupDate = computed.date;
    nextFollowupTime = computed.time;
  } else if (trialRescheduled) {
    const r = subtractMinutes(trialDate as string, trialTime as string, 30);
    nextFollowupDate = r.date;
    nextFollowupTime = r.time;
  } else if (trialReminderActive) {
    const r = subtractMinutes(trialDate as string, trialTime as string, 30);
    nextFollowupDate = r.date;
    nextFollowupTime = r.time;
  } else if (notJoinedTriggered && existing.meetingDate && existing.meetingTime) {
    const anchor = fromIstWallClock(existing.meetingDate as string, existing.meetingTime as string);
    const computed = computeBusinessHoursFollowup(anchor, 60);
    nextFollowupDate = computed.date;
    nextFollowupTime = computed.time;
  } else if (meetingRescheduled) {
    const r = subtractMinutes(meetingDate as string, meetingTime as string, 30);
    nextFollowupDate = r.date;
    nextFollowupTime = r.time;
  } else if (meetingReminderActive) {
    const r = subtractMinutes(meetingDate as string, meetingTime as string, 30);
    nextFollowupDate = r.date;
    nextFollowupTime = r.time;
  } else if (attemptAutoTriggered) {
    const computed = computeNextFollowup(nowUtc);
    nextFollowupDate = computed.date;
    nextFollowupTime = computed.time;
  }

  // ---- Lifecycle / revoke bookkeeping (background audit fields only) ----
  const lifecycle = computeLifecycle(
    existing.qualificationStatus as string | null,
    qualificationStatus,
    finalOutcome,
    nowUtc,
    {
      lifecycleStatus: existing.lifecycleStatus as string | null,
      revokedTimestamp: existing.revokedTimestamp as string | null,
      revokedReason: existing.revokedReason as string | null,
    }
  );

  // Build the SET clause and its params together, from a single list, so the
  // $N placeholder numbers can never drift out of sync with the values array
  // (this is what broke Save once before — generating numbered placeholders
  // by hand while also building a long values array by hand).
  const updates: Array<[string, unknown]> = [
    ['attempt1_status', attemptStatuses[0]], ['attempt1_date', attemptDates[0]], ['attempt1_time', attemptTimes[0]],
    ['attempt2_status', attemptStatuses[1]], ['attempt2_date', attemptDates[1]], ['attempt2_time', attemptTimes[1]],
    ['attempt3_status', attemptStatuses[2]], ['attempt3_date', attemptDates[2]], ['attempt3_time', attemptTimes[2]],
    ['attempt4_status', attemptStatuses[3]], ['attempt4_date', attemptDates[3]], ['attempt4_time', attemptTimes[3]],
    ['attempt5_status', attemptStatuses[4]], ['attempt5_date', attemptDates[4]], ['attempt5_time', attemptTimes[4]],
    ['attempt6_status', attemptStatuses[5]], ['attempt6_date', attemptDates[5]], ['attempt6_time', attemptTimes[5]],
    ['attempt7_status', attemptStatuses[6]], ['attempt7_date', attemptDates[6]], ['attempt7_time', attemptTimes[6]],
    ['attempt8_status', attemptStatuses[7]], ['attempt8_date', attemptDates[7]], ['attempt8_time', attemptTimes[7]],
    ['attempt9_status', attemptStatuses[8]], ['attempt9_date', attemptDates[8]], ['attempt9_time', attemptTimes[8]],
    ['state', state], ['profession', profession], ['purpose', purpose], ['language', language],
    ['total_attempts', totalAttempts], ['final_outcome', finalOutcome], ['qualification_status', qualificationStatus],
    ['next_followup_date', nextFollowupDate], ['next_followup_time', nextFollowupTime], ['notes', notes],
    ['course_start_timeline', courseStartTimeline], ['meeting_date', meetingDate], ['meeting_time', meetingTime],
    ['preferred_mode', preferredMode],
    ['handover_status', handoverStatus], ['assigned_vh_user_id', assignedVhUserId], ['assigned_counsellor_user_id', assignedCounsellorUserId],
    ['counsellor_update', counsellorUpdate], ['owner_user_id', newOwnerUserId], ['status', pipelineStatus],
    ['connecting_status', finalConnectingStatus], ['meeting_status', meetingStatus], ['meeting_attempt_count', meetingAttemptCount],
    ['next_meeting_date', nextMeetingDate], ['next_meeting_time', nextMeetingTime], ['meeting_booked_at', meetingBookedAt],
    ['trial_date', trialDate], ['trial_time', trialTime], ['trial_status', finalTrialStatus], ['trial_attempt_count', trialAttemptCount],
    ['next_trial_date', nextTrialDate], ['next_trial_time', nextTrialTime], ['trial_booked_at', trialBookedAt],
    ['admission_status', admissionStatus], ['admission_timestamp', admissionTimestamp],
    ['qualified_at', qualifiedAt], ['vh_assigned_at', vhAssignedAt], ['counsellor_assigned_at', counsellorAssignedAt],
    ['lifecycle_status', lifecycle.lifecycleStatus], ['revoked_timestamp', lifecycle.revokedTimestamp], ['revoked_reason', lifecycle.revokedReason],
    ['reminder_call1_status', reminderStatuses[0]], ['reminder_call1_date', reminderDates[0]], ['reminder_call1_time', reminderTimes[0]],
    ['reminder_call2_status', reminderStatuses[1]], ['reminder_call2_date', reminderDates[1]], ['reminder_call2_time', reminderTimes[1]],
    ['reminder_call3_status', reminderStatuses[2]], ['reminder_call3_date', reminderDates[2]], ['reminder_call3_time', reminderTimes[2]],
  ];

  const setClause = updates.map(([col], i) => `${col} = $${i + 1}`).join(', ') + ', updated_at = now()';
  const values = updates.map(([, v]) => v);

  // Safety net: this should be structurally impossible given the loop above builds
  // both from the same array, but assert it anyway so a future edit can't silently
  // reintroduce the old class of bug.
  if (setClause.split('$').length - 1 !== values.length) {
    throw new Error('Internal error: SQL placeholder count does not match params count.');
  }

  await sql.query(
    `UPDATE leads SET ${setClause} WHERE id = $${values.length + 1}`,
    [...values, leadId]
  );

  const updated = await fetchLead(leadId);

  await logAction(session, 'UPDATE_LEAD', 'lead', leadId, {
    fieldsChanged: Object.keys(body),
    autoFollowupTriggered: attemptAutoTriggered || meetingReminderActive || trialReminderActive || notJoinedTriggered || trialNotDoneTriggered,
    newPipelineStatus: pipelineStatus,
    lifecycleStatus: lifecycle.lifecycleStatus,
  });

  return NextResponse.json({ lead: updated });
  } catch (err) {
    // Surface the real problem instead of a silent generic crash — this is
    // exactly the failure mode that broke Save once before (client saw a
    // non-JSON 500 and had nothing useful to show the user).
    console.error('PATCH /api/leads/[id] failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    return NextResponse.json({ error: `Could not save changes: ${message}` }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Only Admin can delete a lead.' }, { status: 403 });
  }

  const { id } = await params;
  const leadId = Number(id);
  if (!Number.isInteger(leadId)) return NextResponse.json({ error: 'Invalid lead id.' }, { status: 400 });

  const existing = await fetchLead(leadId);
  if (!existing) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });

  try {
    await sql.query(`DELETE FROM leads WHERE id = $1`, [leadId]);
  } catch (err) {
    console.error('DELETE /api/leads/[id] failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    return NextResponse.json({ error: `Could not delete lead: ${message}` }, { status: 500 });
  }

  // Logged with the lead's identifying details captured beforehand, since
  // the row itself is gone by the time anyone reads this log entry.
  await logAction(session, 'DELETE_LEAD', 'lead', leadId, {
    leadCode: existing.leadCode,
    name: existing.name,
    mobile: existing.mobile,
  });

  return NextResponse.json({ ok: true });
}
