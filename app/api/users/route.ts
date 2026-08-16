import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession, hashPin, encryptPin, decryptPin, ROLES, type Role } from '@/lib/auth';
import { logAction } from '@/lib/audit';

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });
  }

  // Admin and Data Team manage the full user list. Vertical Heads only need
  // the Sales Counsellor list, to assign qualified leads to one of them.
  if (session.role === 'admin' || session.role === 'data_team') {
    const rows = await sql`SELECT id, name, role, created_at, pin_encrypted FROM users ORDER BY role, name`;
    const users = (rows as { pin_encrypted: string | null; [k: string]: unknown }[]).map((u) => {
      const { pin_encrypted, ...rest } = u;
      // Only Admin sees PINs — Data Team uses this same endpoint just to
      // populate name/role pickers elsewhere and doesn't need them.
      return session.role === 'admin' ? { ...rest, pin: decryptPin(pin_encrypted) } : rest;
    });
    return NextResponse.json({ users });
  }

  if (session.role === 'vertical_head') {
    const rows = await sql`SELECT id, name, role, created_at FROM users WHERE role = 'sales_counsellor' ORDER BY name`;
    return NextResponse.json({ users: rows });
  }

  return NextResponse.json({ error: 'Not permitted.' }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== 'admin' && session.role !== 'data_team')) {
    return NextResponse.json({ error: 'Admin or Data Team login required.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const name = (body?.name || '').trim();
  const pin = (body?.pin || '').trim();
  const role = ROLES.includes(body?.role) ? (body.role as Role) : 'presales_agent';

  if (!name || !pin) {
    return NextResponse.json({ error: 'Name and PIN are required.' }, { status: 400 });
  }
  if (pin.length < 4) {
    return NextResponse.json({ error: 'PIN should be at least 4 characters.' }, { status: 400 });
  }

  const existing = await sql`SELECT id FROM users WHERE lower(name) = lower(${name}) LIMIT 1`;
  if (existing.length > 0) {
    return NextResponse.json({ error: 'A user with that name already exists.' }, { status: 409 });
  }

  const pinHash = await hashPin(pin);
  const pinEncrypted = encryptPin(pin);
  const rows = await sql`
    INSERT INTO users (name, pin_hash, pin_encrypted, role)
    VALUES (${name}, ${pinHash}, ${pinEncrypted}, ${role})
    RETURNING id, name, role, created_at
  `;

  await logAction(session, 'ADD_USER', 'user', rows[0].id, { name, role });

  return NextResponse.json({ user: rows[0] });
}
