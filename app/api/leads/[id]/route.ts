import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { logAction } from '@/lib/audit';
import { AGENT_EDITABLE_FIELDS } from '@/lib/masters';
import {
  computeTotalAttempts,
  computeQualificationStatus,
  computePipelineStatus,
  computeHandoverStatus,
  computeNextFollowup,
  isAutoFollowupTrigger,
} from '@/lib/leadLogic';
import { toIstDateTimeParts } from '@/lib/followup';

const SELECT_LEAD_COLUMNS = `
      id, lead_code AS "leadCode", name, mobile, email, source, language,
      assigned_date AS "assignedDate", owner_user_id AS "ownerUserId", status, notes,
      state, profession, purpose,
      attempt1_status AS "attempt1Status", attempt1_date AS "attempt1Date", attempt1_time AS "attempt1Time",
      attempt2_status AS "attempt2Status", attempt2_date AS "attempt2Date", attempt2_time AS "attempt2Time",
      attempt3_status AS "attempt3Status", attempt3_date AS "attempt3Date", attempt3_time AS "attempt3Time",
      attempt4_status AS "attempt4Status", attempt4_date AS "attempt4Date", attempt4_time AS "attempt4Time",
      attempt5_status AS "attempt5Status", attempt5_date AS "attempt5Date", attempt5_time AS "attempt5Time",
      attempt6_status AS "attempt6Status", attempt6_date AS "attempt6Date", attempt6_time AS "attempt6Time",
      attempt7_status AS "attempt7Status", attempt7_date AS "attempt7Date", attempt7_time AS "attempt7Time",
      attempt8_status AS "attempt8Status", attempt8_date AS "attempt8Date", attempt8_time AS "attempt8Time",
      attempt9_status AS "attempt9Status", attempt9_date AS "attempt9Date", attempt9_time AS "attempt9Time",
      total_attempts AS "totalAttempts", final_outcome AS "finalOutcome",
      qualification_status AS "qualificationStatus",
      next_followup_date AS "nextFollowupDate", next_followup_time AS "nextFollowupTime",
      course_start_timeline AS "courseStartTimeline", meeting_date AS "meetingDate", meeting_time AS "meetingTime",
      preferred_mode AS "preferredMode", handover_status AS "handoverStatus",
      assigned_vh_user_id AS "assignedVhUserId", assigned_counsellor_user_id AS "assignedCounsellorUserId",
      counsellor_update AS "counsellorUpdate", updated_at AS "updatedAt"
`;

async function fetchLead(leadId: number) {
  const rows = await sql.query(`SELECT ${SELECT_LEAD_COLUMNS} FROM leads WHERE id = $1 LIMIT 1`, [leadId]);
  return (rows as Record<string, unknown>[])[0] || null;
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
    // Admin can edit anything an agent can, plus owner/VH assignment.
    AGENT_EDITABLE_FIELDS.forEach((k) => allowedKeys.add(k));
    allowedKeys.add('ownerUserId');
    allowedKeys.add('assignedVhUserId');
    allowedKeys.add('assignedCounsellorUserId');
    allowedKeys.add('counsellorUpdate');
  }
  if (isDataTeam) {
    allowedKeys.add('ownerUserId');
  }
  if (isOwnerAgent) {
    AGENT_EDITABLE_FIELDS.forEach((k) => allowedKeys.add(k));
  }
  if (isAssignedVh) {
    allowedKeys.add('assignedCounsellorUserId');
  }
  if (isAssignedCounsellor) {
    allowedKeys.add('counsellorUpdate');
  }

  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) delete body[key];
  }

  const nowUtc = new Date();
  const nowParts = toIstDateTimeParts(nowUtc);

  // Detect which attempt (if any) is being newly logged this save, so we can
  // auto-stamp its date/time and, if applicable, auto-schedule the next follow-up.
  let triggerIndex: number | null = null;
  let triggerStatus: string | null = null;
  if (body.attempt1Status !== undefined && body.attempt1Status !== existing.attempt1Status && body.attempt1Status) {
    triggerIndex = 1;
    triggerStatus = body.attempt1Status as string;
  }
  if (body.attempt2Status !== undefined && body.attempt2Status !== existing.attempt2Status && body.attempt2Status) {
    triggerIndex = 2;
    triggerStatus = body.attempt2Status as string;
  }
  if (body.attempt3Status !== undefined && body.attempt3Status !== existing.attempt3Status && body.attempt3Status) {
    triggerIndex = 3;
    triggerStatus = body.attempt3Status as string;
  }
  if (body.attempt4Status !== undefined && body.attempt4Status !== existing.attempt4Status && body.attempt4Status) {
    triggerIndex = 4;
    triggerStatus = body.attempt4Status as string;
  }
  if (body.attempt5Status !== undefined && body.attempt5Status !== existing.attempt5Status && body.attempt5Status) {
    triggerIndex = 5;
    triggerStatus = body.attempt5Status as string;
  }
  if (body.attempt6Status !== undefined && body.attempt6Status !== existing.attempt6Status && body.attempt6Status) {
    triggerIndex = 6;
    triggerStatus = body.attempt6Status as string;
  }
  if (body.attempt7Status !== undefined && body.attempt7Status !== existing.attempt7Status && body.attempt7Status) {
    triggerIndex = 7;
    triggerStatus = body.attempt7Status as string;
  }
  if (body.attempt8Status !== undefined && body.attempt8Status !== existing.attempt8Status && body.attempt8Status) {
    triggerIndex = 8;
    triggerStatus = body.attempt8Status as string;
  }
  if (body.attempt9Status !== undefined && body.attempt9Status !== existing.attempt9Status && body.attempt9Status) {
    triggerIndex = 9;
    triggerStatus = body.attempt9Status as string;
  }

  const attempt1Status = (body.attempt1Status !== undefined ? body.attempt1Status : existing.attempt1Status) || null;
  const attempt2Status = (body.attempt2Status !== undefined ? body.attempt2Status : existing.attempt2Status) || null;
  const attempt3Status = (body.attempt3Status !== undefined ? body.attempt3Status : existing.attempt3Status) || null;
  const attempt4Status = (body.attempt4Status !== undefined ? body.attempt4Status : existing.attempt4Status) || null;
  const attempt5Status = (body.attempt5Status !== undefined ? body.attempt5Status : existing.attempt5Status) || null;
  const attempt6Status = (body.attempt6Status !== undefined ? body.attempt6Status : existing.attempt6Status) || null;
  const attempt7Status = (body.attempt7Status !== undefined ? body.attempt7Status : existing.attempt7Status) || null;
  const attempt8Status = (body.attempt8Status !== undefined ? body.attempt8Status : existing.attempt8Status) || null;
  const attempt9Status = (body.attempt9Status !== undefined ? body.attempt9Status : existing.attempt9Status) || null;

  let attempt1Date = existing.attempt1Date;
  let attempt1Time = existing.attempt1Time;
  if (triggerIndex === 1) {
    attempt1Date = nowParts.date;
    attempt1Time = nowParts.time;
  }
  let attempt2Date = existing.attempt2Date;
  let attempt2Time = existing.attempt2Time;
  if (triggerIndex === 2) {
    attempt2Date = nowParts.date;
    attempt2Time = nowParts.time;
  }
  let attempt3Date = existing.attempt3Date;
  let attempt3Time = existing.attempt3Time;
  if (triggerIndex === 3) {
    attempt3Date = nowParts.date;
    attempt3Time = nowParts.time;
  }
  let attempt4Date = existing.attempt4Date;
  let attempt4Time = existing.attempt4Time;
  if (triggerIndex === 4) {
    attempt4Date = nowParts.date;
    attempt4Time = nowParts.time;
  }
  let attempt5Date = existing.attempt5Date;
  let attempt5Time = existing.attempt5Time;
  if (triggerIndex === 5) {
    attempt5Date = nowParts.date;
    attempt5Time = nowParts.time;
  }
  let attempt6Date = existing.attempt6Date;
  let attempt6Time = existing.attempt6Time;
  if (triggerIndex === 6) {
    attempt6Date = nowParts.date;
    attempt6Time = nowParts.time;
  }
  let attempt7Date = existing.attempt7Date;
  let attempt7Time = existing.attempt7Time;
  if (triggerIndex === 7) {
    attempt7Date = nowParts.date;
    attempt7Time = nowParts.time;
  }
  let attempt8Date = existing.attempt8Date;
  let attempt8Time = existing.attempt8Time;
  if (triggerIndex === 8) {
    attempt8Date = nowParts.date;
    attempt8Time = nowParts.time;
  }
  let attempt9Date = existing.attempt9Date;
  let attempt9Time = existing.attempt9Time;
  if (triggerIndex === 9) {
    attempt9Date = nowParts.date;
    attempt9Time = nowParts.time;
  }

  const state = ((body.state !== undefined ? body.state : existing.state) || null) as string | null;
  const profession = ((body.profession !== undefined ? body.profession : existing.profession) || null) as string | null;
  const purpose = ((body.purpose !== undefined ? body.purpose : existing.purpose) || null) as string | null;
  const finalOutcome = ((body.finalOutcome !== undefined ? body.finalOutcome : existing.finalOutcome) || null) as string | null;
  const notes = body.remarks !== undefined ? String(body.remarks) : (existing.notes as string) || '';
  const courseStartTimeline = ((body.courseStartTimeline !== undefined ? body.courseStartTimeline : existing.courseStartTimeline) || null) as string | null;
  const meetingDate = ((body.meetingDate !== undefined ? body.meetingDate : existing.meetingDate) || null) as string | null;
  const meetingTime = ((body.meetingTime !== undefined ? body.meetingTime : existing.meetingTime) || null) as string | null;
  const preferredMode = ((body.preferredMode !== undefined ? body.preferredMode : existing.preferredMode) || null) as string | null;
  const counsellorUpdate = body.counsellorUpdate !== undefined ? String(body.counsellorUpdate) : (existing.counsellorUpdate as string) || '';

  const assignedVhUserId = body.assignedVhUserId !== undefined ? (body.assignedVhUserId as number | null) : assignedVhUserId0;
  const assignedCounsellorUserId =
    body.assignedCounsellorUserId !== undefined ? (body.assignedCounsellorUserId as number | null) : assignedCounsellorUserId0;
  const newOwnerUserId = body.ownerUserId !== undefined ? (body.ownerUserId as number | null) : ownerUserId;

  const totalAttempts = computeTotalAttempts({
attempt1Status, attempt2Status, attempt3Status, attempt4Status, attempt5Status, attempt6Status, attempt7Status, attempt8Status, attempt9Status
  });
  const qualificationStatus = computeQualificationStatus(finalOutcome);
  const pipelineStatus = computePipelineStatus(totalAttempts, qualificationStatus);
  const handoverStatus = computeHandoverStatus(qualificationStatus, assignedVhUserId, assignedCounsellorUserId);

  // Auto-schedule next follow-up: only when this save just logged a "didn't
  // connect" attempt AND there's still no Final Outcome. Otherwise, respect
  // whatever was already there (or a manual value the agent typed in).
  let nextFollowupDate = ((body.nextFollowupDate !== undefined ? body.nextFollowupDate : existing.nextFollowupDate) || null) as string | null;
  let nextFollowupTime = ((body.nextFollowupTime !== undefined ? body.nextFollowupTime : existing.nextFollowupTime) || null) as string | null;
  const autoTriggered = triggerIndex !== null && isAutoFollowupTrigger(triggerStatus) && !finalOutcome;
  if (autoTriggered) {
    const computed = computeNextFollowup(nowUtc);
    nextFollowupDate = computed.date;
    nextFollowupTime = computed.time;
  }

  await sql.query(
    `UPDATE leads SET
      attempt1_status = $1, attempt1_date = $2, attempt1_time = $3,
      attempt2_status = $4, attempt2_date = $5, attempt2_time = $6,
      attempt3_status = $7, attempt3_date = $8, attempt3_time = $9,
      attempt4_status = $10, attempt4_date = $11, attempt4_time = $12,
      attempt5_status = $13, attempt5_date = $14, attempt5_time = $15,
      attempt6_status = $16, attempt6_date = $17, attempt6_time = $18,
      attempt7_status = $19, attempt7_date = $20, attempt7_time = $21,
      attempt8_status = $22, attempt8_date = $23, attempt8_time = $24,
      attempt9_status = $25, attempt9_date = $26, attempt9_time = $27,
      state = $28, profession = $29, purpose = $30,
      total_attempts = $31, final_outcome = $32, qualification_status = $33,
      next_followup_date = $34, next_followup_time = $35, notes = $36,
      course_start_timeline = $37, meeting_date = $38, meeting_time = $39, preferred_mode = $40,
      handover_status = $41, assigned_vh_user_id = $42, assigned_counsellor_user_id = $43,
      counsellor_update = $44, owner_user_id = $45, status = $46, updated_at = now()
    WHERE id = $47`,
    [
      attempt1Status, attempt1Date, attempt1Time, attempt2Status, attempt2Date, attempt2Time, attempt3Status, attempt3Date, attempt3Time, attempt4Status, attempt4Date, attempt4Time, attempt5Status, attempt5Date, attempt5Time, attempt6Status, attempt6Date, attempt6Time, attempt7Status, attempt7Date, attempt7Time, attempt8Status, attempt8Date, attempt8Time, attempt9Status, attempt9Date, attempt9Time,
      state, profession, purpose,
      totalAttempts, finalOutcome, qualificationStatus,
      nextFollowupDate, nextFollowupTime, notes,
      courseStartTimeline, meetingDate, meetingTime, preferredMode,
      handoverStatus, assignedVhUserId, assignedCounsellorUserId,
      counsellorUpdate, newOwnerUserId, pipelineStatus, leadId,
    ]
  );

  const updated = await fetchLead(leadId);

  await logAction(session, 'UPDATE_LEAD', 'lead', leadId, {
    fieldsChanged: Object.keys(body),
    autoFollowupTriggered: autoTriggered,
    newPipelineStatus: pipelineStatus,
  });

  return NextResponse.json({ lead: updated });
}
