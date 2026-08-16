import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { logAction } from '@/lib/audit';

const ALLOWED_STATUSES = ['New', 'Called', 'Qualified', 'Not Qualified'];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });
  }

  const { id } = await params;
  const leadId = Number(id);
  if (!Number.isInteger(leadId)) {
    return NextResponse.json({ error: 'Invalid lead id.' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const status = body?.status as string | undefined;
  const notes = body?.notes as string | undefined;
  const ownerUserId = body?.ownerUserId as number | null | undefined;

  if (status !== undefined && !ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
  }

  if (ownerUserId !== undefined && session.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can reassign leads.' }, { status: 403 });
  }

  if (session.role === 'presales_agent') {
    const existing = await sql`SELECT owner_user_id AS "ownerUserId" FROM leads WHERE id = ${leadId} LIMIT 1`;
    const row = existing[0] as { ownerUserId: number | null } | undefined;
    if (!row || row.ownerUserId !== session.id) {
      return NextResponse.json({ error: 'This lead is not assigned to you.' }, { status: 403 });
    }
  } else if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Not permitted to update leads.' }, { status: 403 });
  }

  const rows = await sql`
    UPDATE leads
    SET
      status = COALESCE(${status ?? null}, status),
      notes = COALESCE(${notes ?? null}, notes),
      owner_user_id = CASE WHEN ${ownerUserId !== undefined} THEN ${ownerUserId ?? null} ELSE owner_user_id END,
      updated_at = now()
    WHERE id = ${leadId}
    RETURNING id, lead_code AS "leadCode", name, status, notes, owner_user_id AS "ownerUserId", updated_at AS "updatedAt"
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
  }

  await logAction(session, 'UPDATE_LEAD', 'lead', leadId, { status, notes, ownerUserId });

  return NextResponse.json({ lead: rows[0] });
}
