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

  // Reversible (encrypted, not hashed) copy of the PIN, purely so Admin can
  // look it up in the Users tab. Nullable: existing users created before
  // this feature only have the bcrypt hash, which cannot be reversed —
  // their PIN shows as not-viewable until an admin resets it.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_encrypted TEXT`;

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

  // --- Stage 2 columns: attempt tracking, qualification, handover chain ---
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS state TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS profession TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS purpose TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt1_status TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt1_date DATE`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt1_time TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt2_status TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt2_date DATE`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt2_time TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt3_status TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt3_date DATE`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt3_time TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt4_status TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt4_date DATE`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt4_time TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt5_status TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt5_date DATE`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt5_time TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt6_status TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt6_date DATE`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt6_time TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt7_status TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt7_date DATE`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt7_time TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt8_status TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt8_date DATE`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt8_time TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt9_status TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt9_date DATE`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS attempt9_time TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS total_attempts INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS final_outcome TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS qualification_status TEXT NOT NULL DEFAULT 'Not Reviewed'`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_followup_date DATE`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_followup_time TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS course_start_timeline TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS meeting_date DATE`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS meeting_time TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS preferred_mode TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS handover_status TEXT NOT NULL DEFAULT 'Not Ready'`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_vh_user_id INTEGER REFERENCES users(id)`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_counsellor_user_id INTEGER REFERENCES users(id)`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS counsellor_update TEXT NOT NULL DEFAULT ''`;

  // --- Stage 3 columns: Connecting/Meeting, Trial, Admission, Reminder Calls, audit ---
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS connecting_status TEXT`;
  // Connecting Status now defaults to "Pending" like the other Stage 3 statuses
  // (it used to be left blank until first touched) — backfill any existing
  // blanks, then make Pending the actual column default going forward.
  await sql`UPDATE leads SET connecting_status = 'Pending' WHERE connecting_status IS NULL`;
  await sql`ALTER TABLE leads ALTER COLUMN connecting_status SET DEFAULT 'Pending'`;
  await sql`ALTER TABLE leads ALTER COLUMN connecting_status SET NOT NULL`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS meeting_status TEXT NOT NULL DEFAULT 'Pending'`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS meeting_attempt_count INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_meeting_date DATE`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_meeting_time TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS trial_date DATE`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS trial_time TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS trial_status TEXT NOT NULL DEFAULT 'Pending'`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS trial_attempt_count INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_trial_date DATE`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_trial_time TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS admission_status TEXT NOT NULL DEFAULT 'Pending'`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS admission_timestamp TIMESTAMPTZ`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'Active Qualified'`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS revoked_timestamp TIMESTAMPTZ`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS revoked_reason TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS reminder_call1_status TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS reminder_call1_date DATE`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS reminder_call1_time TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS reminder_call2_status TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS reminder_call2_date DATE`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS reminder_call2_time TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS reminder_call3_status TEXT`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS reminder_call3_date DATE`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS reminder_call3_time TEXT`;

  // --- Stage 4: first-transition timestamps, for dashboard "avg days between
  // stages" / "qualified today" metrics. Nullable — leads that transitioned
  // before this column existed simply have no timing data for that stage.
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS vh_assigned_at TIMESTAMPTZ`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS counsellor_assigned_at TIMESTAMPTZ`;

  // --- Stage 5 (Sep 2026): booking-action timestamps, for the Hourly Report
  // dashboard. Distinct from meeting_date/trial_date (which store WHEN the
  // meeting/trial is scheduled to happen) — these record the moment someone
  // actually performed the booking action, so "how many meetings were
  // booked between 2-3pm" can be answered exactly going forward. Re-stamped
  // every time the effective meeting_date/trial_date value changes
  // (including reschedules, which count as a new booking action). Nullable
  // and never backfilled — leads booked before this column existed simply
  // have no data here, same rule as every other first-transition timestamp
  // in this schema.
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS meeting_booked_at TIMESTAMPTZ`;
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS trial_booked_at TIMESTAMPTZ`;

  // Widen the status check constraint to the new pipeline status values.
  await sql`ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check`;
  await sql`ALTER TABLE leads ADD CONSTRAINT leads_status_check CHECK (status IN ('New','Not Picked','Follow-up Needed','Qualified','Not Qualified'))`;

  await sql`CREATE INDEX IF NOT EXISTS idx_leads_qualification ON leads(qualification_status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_leads_next_followup ON leads(next_followup_date, next_followup_time)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_leads_assigned_vh ON leads(assigned_vh_user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_leads_assigned_counsellor ON leads(assigned_counsellor_user_id)`;

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
