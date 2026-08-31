import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { logAction } from '@/lib/audit';
import { computePipelineStatus } from '@/lib/leadLogic';

// One-time (safe to re-run — it's idempotent) data-repair endpoint for the
// Aug 2026 "stuck in New" bug: computePipelineStatus() used to check
// total_attempts === 0 BEFORE qualification_status, so any lead with zero
// in-system call attempts was forced into the "New" tab even if it already
// had a decisive Qualified / Not Qualified / Follow-up Needed outcome —
// this specifically hit leads brought in via full-import that carried a
// Final Outcome but no historical attempt log. See lib/leadLogic.ts's
// computePipelineStatus() doc comment for the full root-cause explanation.
//
// This route does NOT touch qualification_status or total_attempts (the
// source-of-truth fields) — it only recomputes the DERIVED `status`
// (pipeline/tab) column from those two already-correct fields, using the
// now-fixed function, and writes it back only where it actually differs.
// Nothing is fabricated: every value written here is a deterministic
// function of data that was already in the row.

type Row = { id: number; leadCode: string; status: string; totalAttempts: number; qualificationStatus: string };

async function computeChanges(): Promise<{ rows: Row[]; changed: { row: Row; newStatus: string }[] }> {
  const rows = (await sql.query(
    `SELECT id, lead_code AS "leadCode", status, total_attempts AS "totalAttempts", qualification_status AS "qualificationStatus"
     FROM leads`
  )) as Row[];

  const changed = rows
    .map((row) => ({ row, newStatus: computePipelineStatus(row.totalAttempts, row.qualificationStatus) }))
    .filter(({ row, newStatus }) => newStatus !== row.status);

  return { rows, changed };
}

// GET = preview only (no writes) — shows exactly how many leads would
// change and a breakdown of old-status -> new-status, so Admin can check
// the number before committing.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Only Admin can run this repair.' }, { status: 403 });
  }

  const { rows, changed } = await computeChanges();

  const breakdown: Record<string, number> = {};
  for (const { row, newStatus } of changed) {
    const key = `${row.status} -> ${newStatus}`;
    breakdown[key] = (breakdown[key] || 0) + 1;
  }

  return NextResponse.json({
    totalLeads: rows.length,
    wouldChange: changed.length,
    breakdown,
    sampleLeadCodes: changed.slice(0, 20).map(({ row }) => row.leadCode),
  });
}

// POST = actually apply the fix. Requires the exact confirmation phrase as
// a second safeguard, same pattern as /api/admin/clear-data.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Only Admin can run this repair.' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.confirm !== 'FIX') {
    return NextResponse.json({ error: 'Type FIX exactly to confirm.' }, { status: 400 });
  }

  const { changed } = await computeChanges();

  for (const { row, newStatus } of changed) {
    await sql.query(`UPDATE leads SET status = $1 WHERE id = $2`, [newStatus, row.id]);
  }

  const breakdown: Record<string, number> = {};
  for (const { row, newStatus } of changed) {
    const key = `${row.status} -> ${newStatus}`;
    breakdown[key] = (breakdown[key] || 0) + 1;
  }

  await logAction(session, 'RECOMPUTE_PIPELINE_STATUS', 'leads', null, {
    fixedCount: changed.length,
    breakdown,
    leadCodes: changed.map(({ row }) => row.leadCode),
  });

  return NextResponse.json({ fixedCount: changed.length, breakdown });
}
