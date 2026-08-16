import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { logAction } from '@/lib/audit';

function isValidDate(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// GET = preview only (no deletion) — shows how many rows would be removed
// for a date range, so the admin can check the number before committing.
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Only Admin can clear data.' }, { status: 403 });
  }

  const from = request.nextUrl.searchParams.get('from');
  const to = request.nextUrl.searchParams.get('to');
  if (!isValidDate(from) || !isValidDate(to)) {
    return NextResponse.json({ error: 'from and to must be dates in YYYY-MM-DD format.' }, { status: 400 });
  }

  const [leadRows, auditRows] = await Promise.all([
    sql.query(`SELECT COUNT(*)::int AS count FROM leads WHERE assigned_date BETWEEN $1 AND $2`, [from, to]),
    sql.query(`SELECT COUNT(*)::int AS count FROM audit_log WHERE created_at::date BETWEEN $1 AND $2`, [from, to]),
  ]);

  return NextResponse.json({
    leadCount: (leadRows as { count: number }[])[0]?.count || 0,
    auditCount: (auditRows as { count: number }[])[0]?.count || 0,
  });
}

// POST = actually delete. Requires the exact confirmation phrase as a
// second safeguard beyond the UI's own confirmation step, in case this
// endpoint is ever called some other way.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Only Admin can clear data.' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const from = body.from as string | undefined;
  const to = body.to as string | undefined;
  const confirm = body.confirm as string | undefined;

  if (!isValidDate(from || null) || !isValidDate(to || null)) {
    return NextResponse.json({ error: 'from and to must be dates in YYYY-MM-DD format.' }, { status: 400 });
  }
  if (confirm !== 'DELETE') {
    return NextResponse.json({ error: 'Type DELETE exactly to confirm.' }, { status: 400 });
  }

  const leadsDeleted = await sql.query(
    `DELETE FROM leads WHERE assigned_date BETWEEN $1 AND $2 RETURNING id`,
    [from, to]
  );
  const auditDeleted = await sql.query(
    `DELETE FROM audit_log WHERE created_at::date BETWEEN $1 AND $2 RETURNING id`,
    [from, to]
  );

  const leadCount = (leadsDeleted as { id: number }[]).length;
  const auditCount = (auditDeleted as { id: number }[]).length;

  // Log this after the fact — it'll be the only record that this range
  // ever existed, since we may have just deleted the audit rows that would
  // otherwise show it. This entry is created fresh, after the delete above,
  // so it isn't caught in its own date-range deletion.
  await logAction(session, 'CLEAR_DATA', 'leads+audit_log', null, { from, to, leadCount, auditCount });

  return NextResponse.json({ leadCount, auditCount });
}
