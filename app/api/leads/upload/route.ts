import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { allocateUnassignedLeads } from '@/lib/allocation';
import { logAction } from '@/lib/audit';

const FIELD_ALIASES: Record<string, string[]> = {
  name: ['name', 'lead name', 'full name', 'customer name'],
  mobile: ['mobile', 'phone', 'mobile number', 'contact', 'contact number', 'phone number'],
  email: ['email', 'email address', 'e-mail'],
  source: ['source', 'lead source'],
  language: ['language'],
};

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

function pickField(row: Record<string, unknown>, aliases: string[]): string {
  for (const [key, value] of Object.entries(row)) {
    if (aliases.includes(normalizeKey(key))) {
      return value === undefined || value === null ? '' : String(value).trim();
    }
  }
  return '';
}

function normalizeMobile(mobile: string): string {
  // Keep only digits so "+91 98765 43210" and "9876543210" are recognized
  // as the same number for duplicate checking.
  return mobile.replace(/\D/g, '');
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== 'admin' && session.role !== 'data_team')) {
    return NextResponse.json({ error: 'Admin or Data Team login required.' }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get('file');

  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  }

  const arrayBuffer = await (file as File).arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return NextResponse.json({ error: 'The file has no sheets.' }, { status: 400 });
  }

  const sheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[];

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No rows found in the first sheet.' }, { status: 400 });
  }

  // Load existing mobiles once for duplicate checking (normalized to digits only).
  const existingRows = await sql`SELECT mobile FROM leads WHERE mobile IS NOT NULL AND mobile <> ''`;
  const existingMobiles = new Set(
    (existingRows as { mobile: string }[]).map((r) => normalizeMobile(r.mobile))
  );

  // Find the current highest lead_code number to keep incrementing sequentially.
  const maxRows = await sql`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(lead_code, '\\D', '', 'g'), '')::int), 0) AS "maxNum"
    FROM leads
  `;
  let nextNum = ((maxRows[0] as { maxNum: number })?.maxNum || 0) + 1;

  let inserted = 0;
  let skippedDuplicates: string[] = [];
  let skippedBlank = 0;

  for (const row of rows) {
    const name = pickField(row, FIELD_ALIASES.name);
    const mobileRaw = pickField(row, FIELD_ALIASES.mobile);
    const email = pickField(row, FIELD_ALIASES.email);
    const source = pickField(row, FIELD_ALIASES.source);
    const language = pickField(row, FIELD_ALIASES.language);

    if (!name && !mobileRaw) {
      skippedBlank += 1;
      continue;
    }

    const normalizedMobile = normalizeMobile(mobileRaw);

    if (normalizedMobile && existingMobiles.has(normalizedMobile)) {
      skippedDuplicates.push(mobileRaw);
      continue;
    }

    const leadCode = `TLS-${String(nextNum).padStart(6, '0')}`;
    nextNum += 1;

    await sql`
      INSERT INTO leads (lead_code, name, mobile, email, source, language, assigned_date, status, notes)
      VALUES (${leadCode}, ${name}, ${mobileRaw}, ${email}, ${source}, ${language}, CURRENT_DATE, 'New', '')
    `;
    inserted += 1;

    if (normalizedMobile) {
      existingMobiles.add(normalizedMobile);
    }
  }

  const allocationResult = await allocateUnassignedLeads();

  await logAction(session, 'UPLOAD_LEADS', 'leads', null, {
    fileRows: rows.length,
    inserted,
    skippedDuplicates: skippedDuplicates.length,
    skippedBlank,
    allocated: allocationResult.assignments.length,
    unassignedLanguages: allocationResult.skippedLanguages,
  });

  return NextResponse.json({
    status: 'ok',
    rowsInFile: rows.length,
    inserted,
    skippedDuplicates,
    skippedBlank,
    allocated: allocationResult.assignments.length,
    unassignedLanguages: allocationResult.skippedLanguages,
  });
}
