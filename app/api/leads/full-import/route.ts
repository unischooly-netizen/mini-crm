import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { logAction } from '@/lib/audit';
import { ATTEMPT_COUNT } from '@/lib/masters';
import {
  computeTotalAttempts,
  computeQualificationStatus,
  computePipelineStatus,
  computeHandoverStatus,
  computeMeetingStatus,
} from '@/lib/leadLogic';

// Full-fidelity import: unlike /api/leads/upload (raw new leads only), this
// accepts leads that already have a full history — attempts, outcome,
// meeting/connecting/trial/admission state, assignments — as when migrating
// real historical data from the old spreadsheet CRM. Computed fields
// (Total Attempts, Qualification Status, Pipeline Status, Meeting Status,
// Handover Status) are always derived here from the same logic the app uses
// everywhere else, never trusted directly from the file, so migrated leads
// behave identically to natively-created ones from day one.

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

function pick(row: Record<string, unknown>, header: string): string {
  for (const [key, value] of Object.entries(row)) {
    if (normalizeKey(key) === normalizeKey(header)) {
      return value === undefined || value === null ? '' : String(value).trim();
    }
  }
  return '';
}

function pickNum(row: Record<string, unknown>, header: string): number | null {
  const v = pick(row, header);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeMobile(mobile: string): string {
  return mobile.replace(/\D/g, '');
}

// Historical Lead IDs used a 4-digit number (e.g. TLS-0001); the app uses
// 6-digit (TLS-000001). Re-pads whatever numeric part is found, regardless
// of the original width, so both old and already-correct IDs come out the
// same way.
function normalizeLeadCode(raw: string, fallbackNum: number): string {
  const digits = raw.replace(/\D/g, '');
  const num = digits ? parseInt(digits, 10) : fallbackNum;
  return `TLS-${String(num).padStart(6, '0')}`;
}

// Excel date cells arrive as JS Date objects (via XLSX's cellDates option);
// plain typed strings arrive as strings. Normalizes either into 'YYYY-MM-DD'.
function toDateStr(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  return s ? s.slice(0, 10) : null;
}

function toTimeStr(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    const hh = String(v.getUTCHours()).padStart(2, '0');
    const mm = String(v.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const s = String(v).trim();
  return s || null;
}

function toTimestampStr(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  return s || null;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'Admin login required for full data import.' }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  }

  const arrayBuffer = await (file as File).arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    return NextResponse.json({ error: 'The file has no sheets.' }, { status: 400 });
  }
  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No rows found in the first sheet.' }, { status: 400 });
  }

  const existingRows = await sql`SELECT mobile FROM leads WHERE mobile IS NOT NULL AND mobile <> ''`;
  const existingMobiles = new Set((existingRows as { mobile: string }[]).map((r) => normalizeMobile(r.mobile)));

  const maxRows = await sql`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(lead_code, '\\D', '', 'g'), '')::int), 0) AS "maxNum"
    FROM leads
  `;
  let nextNum = ((maxRows[0] as { maxNum: number })?.maxNum || 0) + 1;

  const usersRows = await sql`SELECT id, name, role FROM users`;
  const usersByRole: Record<string, Map<string, number>> = { presales_agent: new Map(), vertical_head: new Map(), sales_counsellor: new Map() };
  for (const u of usersRows as { id: number; name: string; role: string }[]) {
    if (usersByRole[u.role]) usersByRole[u.role].set(u.name.trim().toLowerCase(), u.id);
  }

  function matchUser(role: 'presales_agent' | 'vertical_head' | 'sales_counsellor', name: string): number | null {
    if (!name) return null;
    return usersByRole[role].get(name.trim().toLowerCase()) ?? null;
  }

  let inserted = 0;
  let skippedDuplicates = 0;
  let skippedBlank = 0;
  const unmatchedOwners = new Set<string>();
  const unmatchedVh = new Set<string>();
  const unmatchedCounsellors = new Set<string>();

  for (const row of rows) {
    const name = pick(row, 'Name');
    const mobileRaw = pick(row, 'Mobile');
    if (!name && !mobileRaw) {
      skippedBlank += 1;
      continue;
    }

    const normalizedMobile = normalizeMobile(mobileRaw);
    if (normalizedMobile && existingMobiles.has(normalizedMobile)) {
      skippedDuplicates += 1;
      continue;
    }

    const leadCode = normalizeLeadCode(pick(row, 'Lead ID'), nextNum);
    if (!pick(row, 'Lead ID')) nextNum += 1;

    const ownerName = pick(row, 'Pre-Sales Agent');
    const vhName = pick(row, 'Vertical Head');
    const counsellorName = pick(row, 'Sales Counsellor');
    const ownerUserId = matchUser('presales_agent', ownerName);
    const assignedVhUserId = matchUser('vertical_head', vhName);
    const assignedCounsellorUserId = matchUser('sales_counsellor', counsellorName);
    if (ownerName && !ownerUserId) unmatchedOwners.add(ownerName);
    if (vhName && !assignedVhUserId) unmatchedVh.add(vhName);
    if (counsellorName && !assignedCounsellorUserId) unmatchedCounsellors.add(counsellorName);

    const attemptFields: Record<string, unknown> = {};
    for (let i = 1; i <= ATTEMPT_COUNT; i++) {
      attemptFields[`attempt${i}Status`] = pick(row, `Attempt ${i} Status`) || null;
    }
    const totalAttempts = computeTotalAttempts(attemptFields);
    const finalOutcome = pick(row, 'Final Outcome') || null;
    const qualificationStatus = computeQualificationStatus(finalOutcome);
    const pipelineStatus = computePipelineStatus(totalAttempts, qualificationStatus);
    const connectingStatus = pick(row, 'Connecting Status') || 'Pending';
    const meetingStatus = computeMeetingStatus(connectingStatus, 'Pending');
    const trialStatus = pick(row, 'Trial Status') || 'Pending';
    const admissionStatus = pick(row, 'Admission Status') || 'Pending';
    const handoverStatus = computeHandoverStatus(
      qualificationStatus, assignedVhUserId, assignedCounsellorUserId,
      connectingStatus, trialStatus, admissionStatus
    );

    const values = [
      leadCode, name, mobileRaw, pick(row, 'Email') || null, pick(row, 'Source') || null, pick(row, 'Language') || null,
      toDateStr(row['Assigned Date']) || new Date().toISOString().slice(0, 10),
      ownerUserId, pipelineStatus, pick(row, 'Remarks') || '',
      pick(row, 'State') || null, pick(row, 'Profession') || null, pick(row, 'Purpose') || null,
    ];
    const cols = [
      'lead_code', 'name', 'mobile', 'email', 'source', 'language', 'assigned_date',
      'owner_user_id', 'status', 'notes', 'state', 'profession', 'purpose',
    ];
    for (let i = 1; i <= ATTEMPT_COUNT; i++) {
      cols.push(`attempt${i}_status`, `attempt${i}_date`, `attempt${i}_time`);
      values.push(
        pick(row, `Attempt ${i} Status`) || null,
        toDateStr(row[`Attempt ${i} Date`]),
        toTimeStr(row[`Attempt ${i} Time`])
      );
    }
    cols.push('total_attempts', 'final_outcome', 'qualification_status');
    values.push(totalAttempts, finalOutcome, qualificationStatus);
    cols.push('next_followup_date', 'next_followup_time');
    values.push(toDateStr(row['Next Follow-up Date']), toTimeStr(row['Next Follow-up Time']));
    cols.push('course_start_timeline', 'meeting_date', 'meeting_time', 'preferred_mode');
    values.push(
      pick(row, 'Course Start Timeline') || null,
      toDateStr(row['Meeting Date']),
      toTimeStr(row['Meeting Time']),
      pick(row, 'Preferred Mode') || null
    );
    cols.push('handover_status', 'assigned_vh_user_id', 'assigned_counsellor_user_id', 'counsellor_update');
    values.push(handoverStatus, assignedVhUserId, assignedCounsellorUserId, pick(row, 'Counsellor Remarks') || '');
    cols.push('connecting_status', 'meeting_status', 'meeting_attempt_count', 'next_meeting_date', 'next_meeting_time');
    values.push(connectingStatus, meetingStatus, pickNum(row, 'Meeting Attempt Count') || 0, toDateStr(row['Next Meeting Date']), toTimeStr(row['Next Meeting Time']));
    cols.push('trial_date', 'trial_time', 'trial_status', 'trial_attempt_count', 'next_trial_date', 'next_trial_time');
    values.push(
      toDateStr(row['Trial Date']), toTimeStr(row['Trial Time']), trialStatus,
      pickNum(row, 'Trial Attempt Count') || 0, toDateStr(row['Next Trial Date']), toTimeStr(row['Next Trial Time'])
    );
    cols.push('admission_status', 'admission_timestamp');
    values.push(admissionStatus, toTimestampStr(row['Admission Timestamp']));
    cols.push('lifecycle_status', 'revoked_timestamp', 'revoked_reason');
    values.push(pick(row, 'Lifecycle Status') || 'Active Qualified', toTimestampStr(row['Revoked Timestamp']), pick(row, 'Revoked Reason') || null);
    for (let i = 1; i <= 3; i++) {
      cols.push(`reminder_call${i}_status`, `reminder_call${i}_date`, `reminder_call${i}_time`);
      values.push(
        pick(row, `Reminder Call ${i} Status`) || null,
        toDateStr(row[`Reminder Call ${i} Date`]),
        toTimeStr(row[`Reminder Call ${i} Time`])
      );
    }

    if (cols.length !== values.length) {
      throw new Error(`Internal error: column/value count mismatch (${cols.length} vs ${values.length}).`);
    }
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    await sql.query(`INSERT INTO leads (${cols.join(', ')}) VALUES (${placeholders})`, values);

    inserted += 1;
    if (normalizedMobile) existingMobiles.add(normalizedMobile);
  }

  await logAction(session, 'FULL_IMPORT_LEADS', 'leads', null, {
    fileRows: rows.length,
    inserted,
    skippedDuplicates,
    skippedBlank,
    unmatchedOwners: Array.from(unmatchedOwners),
    unmatchedVh: Array.from(unmatchedVh),
    unmatchedCounsellors: Array.from(unmatchedCounsellors),
  });

  return NextResponse.json({
    status: 'ok',
    rowsInFile: rows.length,
    inserted,
    skippedDuplicates,
    skippedBlank,
    unmatchedOwners: Array.from(unmatchedOwners),
    unmatchedVh: Array.from(unmatchedVh),
    unmatchedCounsellors: Array.from(unmatchedCounsellors),
  });
}
