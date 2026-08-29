// app/api/dev/language-gap/route.ts — TEMPORARY diagnostic report.
//
// Built in response to a real data-quality finding (Aug 2026): leads can
// reach qualification_status = 'Qualified' with an empty/NULL Language
// field, because neither app/api/leads/full-import/route.ts (the
// historical migration) nor app/api/leads/upload/route.ts validates or
// requires Language on ingest — a row is accepted as long as it has a
// name or mobile number. Nothing in the qualification logic
// (computeQualificationStatus, driven purely by Final Outcome) checks
// Language either, so this was always possible.
//
// This endpoint does NOT modify any data — it is a read-only worklist so
// an Admin can see exactly which currently-Qualified leads are missing
// Language and correct them by hand via the Lead Detail page's new
// Language field (see app/leads/[id]/LeadDetailClient.tsx — Admin/Data
// Team only). No language values are guessed or invented here, same
// principle as the qualified_at investigation: the correct value has to
// come from a person who actually knows it.
//
// Same lifecycle as the earlier /api/dev/shifu-parity endpoint: meant to
// be run a handful of times while working through the list, then removed
// (ask Claude to delete the app/api/dev folder once this is no longer
// needed).

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';

export async function GET(_request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });
  if (session.role !== 'admin') {
    return NextResponse.json({ error: 'Only Admin can run this diagnostic.' }, { status: 403 });
  }

  const rows = (await sql.query(
    `SELECT l.lead_code AS "leadCode", l.name, l.mobile, l.source,
            l.assigned_date AS "assignedDate", l.qualification_status AS "qualificationStatus",
            l.owner_user_id AS "ownerUserId", u.name AS "ownerName"
     FROM leads l
     LEFT JOIN users u ON u.id = l.owner_user_id
     WHERE l.qualification_status = 'Qualified'
       AND (l.language IS NULL OR TRIM(l.language) = '')
     ORDER BY l.assigned_date ASC, l.lead_code ASC`
  )) as {
    leadCode: string;
    name: string;
    mobile: string;
    source: string | null;
    assignedDate: string;
    qualificationStatus: string;
    ownerUserId: number | null;
    ownerName: string | null;
  }[];

  return NextResponse.json({
    count: rows.length,
    leads: rows,
  });
}
