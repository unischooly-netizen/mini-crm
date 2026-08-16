import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyPin, setSessionCookie, roleHomePath, type Role } from '@/lib/auth';
import { logAction } from '@/lib/audit';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const name = (body?.name || '').trim();
  const pin = (body?.pin || '').trim();

  if (!name || !pin) {
    return NextResponse.json({ error: 'Name and PIN are required.' }, { status: 400 });
  }

  const rows = await sql`
    SELECT id, name, pin_hash, role FROM users WHERE lower(name) = lower(${name}) LIMIT 1
  `;

  const user = rows[0] as { id: number; name: string; pin_hash: string; role: Role } | undefined;

  if (!user) {
    return NextResponse.json({ error: 'No user found with that name.' }, { status: 401 });
  }

  const ok = await verifyPin(pin, user.pin_hash);
  if (!ok) {
    return NextResponse.json({ error: 'Incorrect PIN.' }, { status: 401 });
  }

  const sessionUser = { id: user.id, name: user.name, role: user.role };
  await setSessionCookie(sessionUser);
  await logAction(sessionUser, 'LOGIN', 'user', user.id, {});

  return NextResponse.json({
    status: 'ok',
    redirectTo: roleHomePath(user.role),
  });
}
