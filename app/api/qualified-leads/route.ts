import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';

const SELECT = `
  l.id, l.lead_code AS "leadCode", l.name, l.mobile, l.email, l.source, l.language,
  l.owner_user_id AS "ownerUserId", owner.name AS "ownerName",
  l.handover_status AS "handoverStatus",
  l.assigned_vh_user_id AS "assignedVhUserId", vh.name AS "assignedVhName",
  l.assigned_counsellor_user_id AS "assignedCounsellorUserId", counsellor.name AS "assignedCounsellorName",
  l.counsellor_update AS "counsellorUpdate",
  l.updated_at AS "updatedAt"
  FROM leads l
  LEFT JOIN users owner ON owner.id = l.owner_user_id
  LEFT JOIN users vh ON vh.id = l.assigned_vh_user_id
  LEFT JOIN users counsellor ON counsellor.id = l.assigned_counsellor_user_id
  WHERE l.qualification_status = 'Qualified'
`;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });

  if (session.role === 'admin' || session.role === 'data_team') {
    const rows = await sql.query(`SELECT ${SELECT} ORDER BY l.updated_at DESC LIMIT 2000`, []);
    return NextResponse.json({ leads: rows, scope: 'all' });
  }

  if (session.role === 'vertical_head') {
    const rows = await sql.query(
      `SELECT ${SELECT} AND l.assigned_vh_user_id = $1 ORDER BY l.updated_at DESC LIMIT 2000`,
      [session.id]
    );
    return NextResponse.json({ leads: rows, scope: 'vh' });
  }

  if (session.role === 'sales_counsellor') {
    const rows = await sql.query(
      `SELECT ${SELECT} AND l.assigned_counsellor_user_id = $1 ORDER BY l.updated_at DESC LIMIT 2000`,
      [session.id]
    );
    return NextResponse.json({ leads: rows, scope: 'counsellor' });
  }

  if (session.role === 'presales_agent') {
    const rows = await sql.query(
      `SELECT ${SELECT} AND l.owner_user_id = $1 ORDER BY l.updated_at DESC LIMIT 2000`,
      [session.id]
    );
    return NextResponse.json({ leads: rows, scope: 'own' });
  }

  return NextResponse.json({ leads: [], scope: 'none' });
}
