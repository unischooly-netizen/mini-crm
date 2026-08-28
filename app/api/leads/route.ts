import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });
  }

  if (session.role === 'admin' || session.role === 'data_team') {
    const rows = await sql`
      SELECT l.id, l.lead_code AS "leadCode", l.name, l.mobile, l.email, l.source, l.language,
             l.assigned_date AS "assignedDate", l.owner_user_id AS "ownerUserId",
             u.name AS "ownerName", l.status, l.notes,
             l.qualification_status AS "qualificationStatus",
             l.next_followup_date AS "nextFollowupDate", l.next_followup_time AS "nextFollowupTime",
             l.handover_status AS "handoverStatus",
             l.created_at AS "createdAt", l.updated_at AS "updatedAt"
      FROM leads l
      LEFT JOIN users u ON u.id = l.owner_user_id
      ORDER BY l.created_at DESC
      LIMIT 500000
    `;
    return NextResponse.json({ leads: rows });
  }

  if (session.role !== 'presales_agent') {
    return NextResponse.json({ leads: [] });
  }

  const rows = await sql`
    SELECT id, lead_code AS "leadCode", name, mobile, email, source, language,
           assigned_date AS "assignedDate", status, notes,
           qualification_status AS "qualificationStatus",
           next_followup_date AS "nextFollowupDate", next_followup_time AS "nextFollowupTime",
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM leads
    WHERE owner_user_id = ${session.id}
    ORDER BY
      CASE status
        WHEN 'New' THEN 0
        WHEN 'Not Picked' THEN 1
        WHEN 'Follow-up Needed' THEN 2
        WHEN 'Not Qualified' THEN 3
        WHEN 'Qualified' THEN 4
        ELSE 5
      END,
      created_at DESC
    LIMIT 500000
  `;
  return NextResponse.json({ leads: rows });
}
