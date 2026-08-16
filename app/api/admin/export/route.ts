import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { logAction } from '@/lib/audit';

// Turns any query-result cell into a safe CSV value. Dates come back from
// the database driver as native JS Date objects (not strings) when read
// here on the server — same reason the "e.slice is not a function" bug
// happened elsewhere — so this normalizes them to a readable ISO form
// rather than crashing or printing "[object Object]".
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) {
    s = v.toISOString();
  } else if (typeof v === 'object') {
    s = JSON.stringify(v);
  } else {
    s = String(v);
  }
  if (/[",\n\r]/.test(s)) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0]);
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(row[c])).join(','));
  }
  return lines.join('\r\n');
}

function isValidDate(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });
  if (session.role !== 'admin' && session.role !== 'data_team') {
    return NextResponse.json({ error: 'Only Admin or Data Team can export data.' }, { status: 403 });
  }

  const type = request.nextUrl.searchParams.get('type') || 'leads';
  const from = request.nextUrl.searchParams.get('from');
  const to = request.nextUrl.searchParams.get('to');

  if (!isValidDate(from) || !isValidDate(to)) {
    return NextResponse.json({ error: 'from and to must be dates in YYYY-MM-DD format.' }, { status: 400 });
  }

  let csv: string;
  let filename: string;

  if (type === 'audit') {
    const rows = await sql.query(
      `SELECT id, actor_user_id, actor_name, action, target_type, target_id, details, created_at
       FROM audit_log
       WHERE created_at::date BETWEEN $1 AND $2
       ORDER BY created_at`,
      [from, to]
    );
    csv = toCsv(rows as Record<string, unknown>[]);
    filename = `audit-log_${from}_to_${to}.csv`;
  } else {
    const rows = await sql.query(
      `SELECT l.*, owner.name AS owner_name, vh.name AS vh_name, counsellor.name AS counsellor_name
       FROM leads l
       LEFT JOIN users owner ON owner.id = l.owner_user_id
       LEFT JOIN users vh ON vh.id = l.assigned_vh_user_id
       LEFT JOIN users counsellor ON counsellor.id = l.assigned_counsellor_user_id
       WHERE l.assigned_date BETWEEN $1 AND $2
       ORDER BY l.assigned_date, l.id`,
      [from, to]
    );
    csv = toCsv(rows as Record<string, unknown>[]);
    filename = `leads_${from}_to_${to}.csv`;
  }

  await logAction(session, 'EXPORT_DATA', type, null, { from, to });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
