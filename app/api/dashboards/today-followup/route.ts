import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { HANDOVER_STATUSES_STAGE2, QUALIFICATION_STATUSES } from '@/lib/masters';
import { todayIstDateStr, nowIstTimeStr } from '@/lib/followup';

// A single queue of every lead — in any pipeline stage — whose Next
// Follow-up Date is today. Our schema already funnels every kind of
// "something needs to happen with this lead" (a re-attempt call, a missed
// meeting, a missed trial, a reminder call) into that one automated field,
// so this is simpler than the source workbook's multi-queue-type Action
// Queue: one date filter covers every case. Available to every logged-in
// role — Pre-Sales Agents get their own name pre-selected as the default
// Owner filter on the client, but can switch to view others or All.

function toDateStr(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'string') return v.slice(0, 10);
  return String(v).slice(0, 10);
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });

  try {
    const params = request.nextUrl.searchParams;
    const owner = params.get('owner') || 'All';
    const language = params.get('language') || 'All';
    const source = params.get('source') || 'All';
    const qualificationStatus = params.get('qualificationStatus') || 'All';
    const handoverStatus = params.get('handoverStatus') || 'All';

    const today = todayIstDateStr();
    const nowTime = nowIstTimeStr();

    const rows = await sql`
      SELECT l.lead_code AS "leadCode", l.name AS "leadName", l.mobile, l.language, l.source, l.purpose,
             owner.name AS "owner",
             l.qualification_status AS "qualificationStatus", l.handover_status AS "handoverStatus",
             l.final_outcome AS "finalOutcome",
             l.next_followup_date AS "nextFollowupDate", l.next_followup_time AS "nextFollowupTime",
             l.meeting_date AS "meetingDate", l.meeting_time AS "meetingTime",
             l.trial_date AS "trialDate", l.trial_time AS "trialTime",
             l.connecting_status AS "connectingStatus", l.trial_status AS "trialStatus",
             l.assigned_vh_user_id AS "assignedVhUserId", vh.name AS "assignedVhName",
             l.assigned_counsellor_user_id AS "assignedCounsellorUserId", counsellor.name AS "assignedCounsellorName",
             l.notes, l.counsellor_update AS "counsellorUpdate", l.updated_at AS "updatedAt"
      FROM leads l
      LEFT JOIN users owner ON owner.id = l.owner_user_id
      LEFT JOIN users vh ON vh.id = l.assigned_vh_user_id
      LEFT JOIN users counsellor ON counsellor.id = l.assigned_counsellor_user_id
      WHERE l.next_followup_date = ${today}
    `;

    type FollowupRow = {
      leadCode: string; leadName: string; mobile: string; language: string; source: string; purpose: string;
      owner: string | null; qualificationStatus: string; handoverStatus: string; finalOutcome: string | null;
      nextFollowupDate: string | null; nextFollowupTime: string | null;
      meetingDate: string | null; meetingTime: string | null;
      trialDate: string | null; trialTime: string | null;
      connectingStatus: string | null; trialStatus: string | null;
      assignedVhUserId: number | null; assignedVhName: string | null;
      assignedCounsellorUserId: number | null; assignedCounsellorName: string | null;
      notes: string | null; counsellorUpdate: string | null; updatedAt: string | null;
    };

    const items: FollowupRow[] = (rows as Record<string, unknown>[]).map((r) => ({
      leadCode: r.leadCode as string,
      leadName: (r.leadName as string) || '',
      mobile: (r.mobile as string) || '',
      language: (r.language as string) || '',
      source: (r.source as string) || '',
      purpose: (r.purpose as string) || '',
      owner: (r.owner as string) || null,
      qualificationStatus: (r.qualificationStatus as string) || '',
      handoverStatus: (r.handoverStatus as string) || '',
      finalOutcome: (r.finalOutcome as string) || null,
      nextFollowupDate: toDateStr(r.nextFollowupDate),
      nextFollowupTime: (r.nextFollowupTime as string) || null,
      meetingDate: toDateStr(r.meetingDate),
      meetingTime: (r.meetingTime as string) || null,
      trialDate: toDateStr(r.trialDate),
      trialTime: (r.trialTime as string) || null,
      connectingStatus: (r.connectingStatus as string) || null,
      trialStatus: (r.trialStatus as string) || null,
      assignedVhUserId: (r.assignedVhUserId as number) ?? null,
      assignedVhName: (r.assignedVhName as string) || null,
      assignedCounsellorUserId: (r.assignedCounsellorUserId as number) ?? null,
      assignedCounsellorName: (r.assignedCounsellorName as string) || null,
      notes: (r.notes as string) || null,
      counsellorUpdate: (r.counsellorUpdate as string) || null,
      updatedAt: (r.updatedAt as string) || null,
    }));

    const matches = (r: FollowupRow) =>
      (owner === 'All' || r.owner === owner) &&
      (language === 'All' || r.language === language) &&
      (source === 'All' || r.source === source) &&
      (qualificationStatus === 'All' || r.qualificationStatus === qualificationStatus) &&
      (handoverStatus === 'All' || r.handoverStatus === handoverStatus);

    const filtered = items.filter(matches);

    const totalDueToday = filtered.length;
    const overdue = filtered.filter((r) => r.nextFollowupTime && r.nextFollowupTime < nowTime).length;
    const upcoming = totalDueToday - overdue;
    const meetingsToday = filtered.filter((r) => r.meetingDate === today).length;
    const trialsToday = filtered.filter((r) => r.trialDate === today).length;
    const unassignedQualifiedToday = filtered.filter(
      (r) => r.qualificationStatus === 'Qualified' && (!r.assignedVhUserId || !r.assignedCounsellorUserId)
    ).length;

    filtered.sort((a, b) => ((a.nextFollowupTime || '') > (b.nextFollowupTime || '') ? 1 : -1));

    // Full-set breakdowns for the charts.
    const handoverStatusBreakdown: Record<string, number> = {};
    const ownerBreakdown: Record<string, number> = {};
    for (const r of filtered) {
      const hs = r.handoverStatus || 'Not Set';
      handoverStatusBreakdown[hs] = (handoverStatusBreakdown[hs] || 0) + 1;
      const ow = r.owner || 'Unassigned';
      ownerBreakdown[ow] = (ownerBreakdown[ow] || 0) + 1;
    }

    const ownersSet = new Set<string>();
    const languagesSet = new Set<string>();
    const sourcesSet = new Set<string>();
    for (const r of items) {
      if (r.owner) ownersSet.add(r.owner);
      if (r.language) languagesSet.add(r.language);
      if (r.source) sourcesSet.add(r.source);
    }

    return NextResponse.json({
      today,
      kpis: {
        totalDueToday,
        overdue,
        upcoming,
        meetingsToday,
        trialsToday,
        unassignedQualifiedToday,
      },
      rows: filtered,
      handoverStatusBreakdown,
      ownerBreakdown,
      filterOptions: {
        owners: Array.from(ownersSet).sort(),
        languages: Array.from(languagesSet).sort(),
        sources: Array.from(sourcesSet).sort(),
        qualificationStatuses: QUALIFICATION_STATUSES,
        handoverStatuses: HANDOVER_STATUSES_STAGE2,
      },
    });
  } catch (err) {
    console.error('GET /api/dashboards/today-followup failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    return NextResponse.json({ error: `Could not load today's follow-ups: ${message}` }, { status: 500 });
  }
}
