import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';

const SELECT = `
  l.id, l.lead_code AS "leadCode", l.name, l.mobile, l.email, l.source, l.language,
  l.owner_user_id AS "ownerUserId", owner.name AS "ownerName",
  l.meeting_date AS "meetingDate", l.meeting_time AS "meetingTime", l.preferred_mode AS "preferredMode",
  l.handover_status AS "handoverStatus",
  l.assigned_vh_user_id AS "assignedVhUserId", vh.name AS "assignedVhName",
  l.assigned_counsellor_user_id AS "assignedCounsellorUserId", counsellor.name AS "assignedCounsellorName",
  l.counsellor_update AS "counsellorUpdate",
  l.connecting_status AS "connectingStatus", l.meeting_status AS "meetingStatus",
  l.meeting_attempt_count AS "meetingAttemptCount",
  l.next_meeting_date AS "nextMeetingDate", l.next_meeting_time AS "nextMeetingTime",
  l.trial_date AS "trialDate", l.trial_time AS "trialTime", l.trial_status AS "trialStatus",
  l.trial_attempt_count AS "trialAttemptCount",
  l.next_trial_date AS "nextTrialDate", l.next_trial_time AS "nextTrialTime",
  l.admission_status AS "admissionStatus", l.admission_timestamp AS "admissionTimestamp",
  l.reminder_call1_status AS "reminderCall1Status", l.reminder_call2_status AS "reminderCall2Status",
  l.reminder_call3_status AS "reminderCall3Status",
  l.next_followup_date AS "nextFollowupDate", l.next_followup_time AS "nextFollowupTime",
  l.updated_at AS "updatedAt"
  FROM leads l
  LEFT JOIN users owner ON owner.id = l.owner_user_id
  LEFT JOIN users vh ON vh.id = l.assigned_vh_user_id
  LEFT JOIN users counsellor ON counsellor.id = l.assigned_counsellor_user_id
  WHERE l.qualification_status = 'Qualified'
`;

// View filters. "qualified" (default) = everything qualified. "reschedule" =
// Connecting Status is Not Joined (the Reschedule Pending tab). "cancelled" =
// Connecting Status or Meeting Status is Cancelled.
function viewClause(view: string): string {
  if (view === 'reschedule') return `AND l.connecting_status = 'Not Joined'`;
  if (view === 'cancelled') return `AND (l.connecting_status = 'Cancelled' OR l.meeting_status = 'Cancelled')`;
  return '';
}

// Kept simple and stable — the client applies the exact "today's meetings on
// top, future ascending, past at the bottom" ordering (which depends on IST
// "today", not the DB server's date), so this just gets everything back with
// meeting-scheduled leads before not-yet-scheduled ones.
const ORDER_BY = `ORDER BY (l.meeting_date IS NULL) ASC, l.meeting_date ASC, l.meeting_time ASC`;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });

  const view = request.nextUrl.searchParams.get('view') || 'qualified';
  const extra = viewClause(view);

  if (session.role === 'admin' || session.role === 'data_team') {
    const rows = await sql.query(`SELECT ${SELECT} ${extra} ${ORDER_BY} LIMIT 2000`, []);
    return NextResponse.json({ leads: rows, scope: 'all', view });
  }

  if (session.role === 'vertical_head') {
    const rows = await sql.query(
      `SELECT ${SELECT} AND l.assigned_vh_user_id = $1 ${extra} ${ORDER_BY} LIMIT 2000`,
      [session.id]
    );
    return NextResponse.json({ leads: rows, scope: 'vh', view });
  }

  if (session.role === 'sales_counsellor') {
    const rows = await sql.query(
      `SELECT ${SELECT} AND l.assigned_counsellor_user_id = $1 ${extra} ${ORDER_BY} LIMIT 2000`,
      [session.id]
    );
    return NextResponse.json({ leads: rows, scope: 'counsellor', view });
  }

  if (session.role === 'presales_agent') {
    const rows = await sql.query(
      `SELECT ${SELECT} AND l.owner_user_id = $1 ${extra} ${ORDER_BY} LIMIT 2000`,
      [session.id]
    );
    return NextResponse.json({ leads: rows, scope: 'own', view });
  }

  return NextResponse.json({ leads: [], scope: 'none', view });
}
