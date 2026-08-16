import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Admin login required.' }, { status: 403 });
  }

  const rows = await sql`
    SELECT id, actor_name AS "actorName", action, target_type AS "targetType",
           target_id AS "targetId", details, created_at AS "createdAt"
    FROM audit_log
    ORDER BY created_at DESC
    LIMIT 500
  `;
  return NextResponse.json({ entries: rows });
}
