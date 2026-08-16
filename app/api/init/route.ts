import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { hashPin } from '@/lib/auth';

// One-time (safe to re-run) setup endpoint: creates/updates tables if they
// don't exist yet, and creates a first admin user if there are no users at
// all. Protected by a secret key so random visitors can't hit it.
//   https://yourapp.vercel.app/api/init?key=YOUR_SECRET
export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  const expected = process.env.INIT_SECRET;

  if (!expected) {
    return NextResponse.json(
      { error: 'INIT_SECRET is not set in your environment variables.' },
      { status: 500 }
    );
  }

  if (key !== expected) {
    return NextResponse.json({ error: 'Invalid or missing key.' }, { status: 401 });
  }

  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      pin_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','presales_agent','vertical_head','sales_counsellor','data_team')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      lead_code TEXT UNIQUE,
      name TEXT,
      mobile TEXT,
      email TEXT,
      source TEXT,
      language TEXT,
      assigned_date DATE NOT NULL DEFAULT CURRENT_DATE,
      owner_user_id INTEGER REFERENCES users(id),
      status TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New','Called','Qualified','Not Qualified')),
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner_user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_leads_lang_date ON leads(language, assigned_date)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_leads_mobile ON leads(mobile)`;

  await sql`
    CREATE TABLE IF NOT EXISTS allocation_rules (
      id SERIAL PRIMARY KEY,
      language TEXT NOT NULL,
      agent_user_id INTEGER NOT NULL REFERENCES users(id),
      percentage NUMERIC NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (language, agent_user_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      actor_user_id INTEGER,
      actor_name TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC)`;

  // Lead code sequence, e.g. LD-000001, assigned at insert time via trigger-less
  // approach (we set it in application code instead, simpler than a DB sequence
  // format function).

  const existingUsers = await sql`SELECT COUNT(*)::int AS count FROM users`;
  const userCount = (existingUsers[0] as { count: number }).count;

  let createdAdmin: { name: string; pin: string } | null = null;

  if (userCount === 0) {
    const adminName = process.env.INIT_ADMIN_NAME || 'admin';
    const adminPin = process.env.INIT_ADMIN_PIN || '1234';
    const pinHash = await hashPin(adminPin);

    await sql`
      INSERT INTO users (name, pin_hash, role)
      VALUES (${adminName}, ${pinHash}, 'admin')
    `;

    createdAdmin = { name: adminName, pin: adminPin };
  }

  return NextResponse.json({
    status: 'ok',
    tablesReady: true,
    firstAdminCreated: Boolean(createdAdmin),
    firstAdminLogin: createdAdmin || undefined,
    note: createdAdmin
      ? 'Log in with this name + PIN, then add your real users from the Users tab.'
      : 'Users already exist — no changes made to users.',
  });
}
