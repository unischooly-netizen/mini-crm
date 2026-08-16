import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession, hashPin, encryptPin, decryptPin, ROLES, type Role } from '@/lib/auth';
import { logAction } from '@/lib/audit';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || (session.role !== 'admin' && session.role !== 'data_team')) {
    return NextResponse.json({ error: 'Admin or Data Team login required.' }, { status: 403 });
  }

  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) return NextResponse.json({ error: 'Invalid user id.' }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : undefined;
  const role = typeof body.role === 'string' && ROLES.includes(body.role as Role) ? (body.role as Role) : undefined;
  const pin = typeof body.pin === 'string' ? body.pin.trim() : undefined;

  if (name === undefined && role === undefined && pin === undefined) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 });
  }
  if (pin !== undefined && pin.length < 4) {
    return NextResponse.json({ error: 'PIN should be at least 4 characters.' }, { status: 400 });
  }
  if (name !== undefined && !name) {
    return NextResponse.json({ error: 'Name cannot be blank.' }, { status: 400 });
  }

  try {
    if (name !== undefined) {
      const dupe = await sql`SELECT id FROM users WHERE lower(name) = lower(${name}) AND id <> ${userId} LIMIT 1`;
      if (dupe.length > 0) {
        return NextResponse.json({ error: 'A user with that name already exists.' }, { status: 409 });
      }
    }

    const updates: Array<[string, unknown]> = [];
    if (name !== undefined) updates.push(['name', name]);
    if (role !== undefined) updates.push(['role', role]);
    if (pin !== undefined) {
      updates.push(['pin_hash', await hashPin(pin)]);
      updates.push(['pin_encrypted', encryptPin(pin)]);
    }

    const setClause = updates.map(([col], i) => `${col} = $${i + 1}`).join(', ');
    const values = updates.map(([, v]) => v);

    const rows = await sql.query(
      `UPDATE users SET ${setClause} WHERE id = $${values.length + 1} RETURNING id, name, role, created_at, pin_encrypted`,
      [...values, userId]
    );
    const updated = (rows as { pin_encrypted: string | null; [k: string]: unknown }[])[0];
    if (!updated) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

    await logAction(session, 'EDIT_USER', 'user', userId, {
      nameChanged: name !== undefined,
      roleChanged: role !== undefined,
      pinReset: pin !== undefined,
    });

    const { pin_encrypted, ...rest } = updated;
    return NextResponse.json({ user: { ...rest, pin: session.role === 'admin' ? decryptPin(pin_encrypted) : undefined } });
  } catch (err) {
    console.error('PATCH /api/users/[id] failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    return NextResponse.json({ error: `Could not update user: ${message}` }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Only Admin can delete a user.' }, { status: 403 });
  }

  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) return NextResponse.json({ error: 'Invalid user id.' }, { status: 400 });

  if (userId === session.id) {
    return NextResponse.json({ error: 'You cannot delete your own account while logged in as it.' }, { status: 400 });
  }

  try {
    const existing = await sql`SELECT id, name FROM users WHERE id = ${userId} LIMIT 1`;
    if (existing.length === 0) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

    const counts = await sql`
      SELECT
        COUNT(*) FILTER (WHERE owner_user_id = ${userId})::int AS owned,
        COUNT(*) FILTER (WHERE assigned_vh_user_id = ${userId})::int AS "asVh",
        COUNT(*) FILTER (WHERE assigned_counsellor_user_id = ${userId})::int AS "asCounsellor"
      FROM leads
    `;
    const c = counts[0] as { owned: number; asVh: number; asCounsellor: number };
    if (c.owned > 0 || c.asVh > 0 || c.asCounsellor > 0) {
      const parts: string[] = [];
      if (c.owned > 0) parts.push(`owns ${c.owned} lead(s)`);
      if (c.asVh > 0) parts.push(`is Vertical Head on ${c.asVh} lead(s)`);
      if (c.asCounsellor > 0) parts.push(`is Sales Counsellor on ${c.asCounsellor} lead(s)`);
      return NextResponse.json(
        { error: `Can't delete — this user still ${parts.join(' and ')}. Reassign those leads first.` },
        { status: 409 }
      );
    }

    await sql`DELETE FROM users WHERE id = ${userId}`;

    await logAction(session, 'DELETE_USER', 'user', userId, { name: (existing[0] as { name: string }).name });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/users/[id] failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    return NextResponse.json({ error: `Could not delete user: ${message}` }, { status: 500 });
  }
}
