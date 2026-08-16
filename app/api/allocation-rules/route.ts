import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { logAction } from '@/lib/audit';

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Admin login required.' }, { status: 403 });
  }

  const rows = await sql`
    SELECT ar.id, ar.language, ar.agent_user_id AS "agentUserId", u.name AS "agentName",
           ar.percentage, ar.active, ar.updated_at AS "updatedAt"
    FROM allocation_rules ar
    JOIN users u ON u.id = ar.agent_user_id
    ORDER BY ar.language, u.name
  `;
  return NextResponse.json({ rules: rows });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Admin login required.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const language = (body?.language || '').trim();
  const agentUserId = Number(body?.agentUserId);
  const percentage = Number(body?.percentage);
  const active = body?.active !== false;

  if (!language || !Number.isInteger(agentUserId) || Number.isNaN(percentage)) {
    return NextResponse.json({ error: 'Language, agent, and percentage are required.' }, { status: 400 });
  }

  const rows = await sql`
    INSERT INTO allocation_rules (language, agent_user_id, percentage, active)
    VALUES (${language}, ${agentUserId}, ${percentage}, ${active})
    ON CONFLICT (language, agent_user_id)
    DO UPDATE SET percentage = EXCLUDED.percentage, active = EXCLUDED.active, updated_at = now()
    RETURNING id, language, agent_user_id AS "agentUserId", percentage, active
  `;

  await logAction(session, 'SET_ALLOCATION_RULE', 'allocation_rule', rows[0].id, {
    language,
    agentUserId,
    percentage,
    active,
  });

  return NextResponse.json({ rule: rows[0] });
}
