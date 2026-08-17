import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { HANDOVER_STATUSES_STAGE2 } from '@/lib/masters';

// Post-qualification funnel: from the moment a lead is marked Qualified,
// through Vertical Head -> Sales Counsellor -> Meeting -> Trial ->
// Admission. Scope is every lead that has ever been Qualified (Active or
// Revoked) — Lifecycle Status is what tells the two apart.

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

function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (isNaN(da) || isNaN(db)) return null;
  return (db - da) / (1000 * 60 * 60 * 24);
}

type Lead = {
  leadCode: string;
  language: string;
  source: string;
  owner: string | null;
  assignedVhName: string | null;
  assignedCounsellorName: string | null;
  handoverStatus: string | null;
  lifecycleStatus: string | null;
  connectingStatus: string | null;
  meetingDate: string | null;
  meetingAttemptCount: number;
  trialDate: string | null;
  trialStatus: string | null;
  admissionStatus: string | null;
  qualifiedAt: string | null;
  vhAssignedAt: string | null;
  counsellorAssignedAt: string | null;
};

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });

  try {
    const params = request.nextUrl.searchParams;
    const language = params.get('language') || 'All';
    const source = params.get('source') || 'All';
    const agent = params.get('agent') || 'All';
    const vh = params.get('vh') || 'All';
    const counsellor = params.get('counsellor') || 'All';
    const handoverStatus = params.get('handoverStatus') || 'All';
    const lifecycleStatus = params.get('lifecycleStatus') || 'All';

    const rows = await sql`
      SELECT l.lead_code AS "leadCode", l.language, l.source,
             owner.name AS "owner", vh.name AS "assignedVhName", counsellor.name AS "assignedCounsellorName",
             l.handover_status AS "handoverStatus", l.lifecycle_status AS "lifecycleStatus",
             l.connecting_status AS "connectingStatus", l.meeting_date AS "meetingDate",
             l.meeting_attempt_count AS "meetingAttemptCount",
             l.trial_date AS "trialDate", l.trial_status AS "trialStatus", l.admission_status AS "admissionStatus",
             l.qualified_at AS "qualifiedAt", l.vh_assigned_at AS "vhAssignedAt", l.counsellor_assigned_at AS "counsellorAssignedAt"
      FROM leads l
      LEFT JOIN users owner ON owner.id = l.owner_user_id
      LEFT JOIN users vh ON vh.id = l.assigned_vh_user_id
      LEFT JOIN users counsellor ON counsellor.id = l.assigned_counsellor_user_id
      WHERE l.qualification_status = 'Qualified'
    `;

    const leads: Lead[] = (rows as Record<string, unknown>[]).map((r) => ({
      leadCode: r.leadCode as string,
      language: (r.language as string) || '',
      source: (r.source as string) || '',
      owner: (r.owner as string) || null,
      assignedVhName: (r.assignedVhName as string) || null,
      assignedCounsellorName: (r.assignedCounsellorName as string) || null,
      handoverStatus: (r.handoverStatus as string) || null,
      lifecycleStatus: (r.lifecycleStatus as string) || 'Active Qualified',
      connectingStatus: (r.connectingStatus as string) || 'Pending',
      meetingDate: toDateStr(r.meetingDate),
      meetingAttemptCount: Number(r.meetingAttemptCount) || 0,
      trialDate: toDateStr(r.trialDate),
      trialStatus: (r.trialStatus as string) || 'Pending',
      admissionStatus: (r.admissionStatus as string) || 'Pending',
      qualifiedAt: (r.qualifiedAt as string) || null,
      vhAssignedAt: (r.vhAssignedAt as string) || null,
      counsellorAssignedAt: (r.counsellorAssignedAt as string) || null,
    }));

    const matches = (l: Lead) =>
      (language === 'All' || l.language === language) &&
      (source === 'All' || l.source === source) &&
      (agent === 'All' || l.owner === agent) &&
      (vh === 'All' || l.assignedVhName === vh) &&
      (counsellor === 'All' || l.assignedCounsellorName === counsellor) &&
      (handoverStatus === 'All' || l.handoverStatus === handoverStatus) &&
      (lifecycleStatus === 'All' || l.lifecycleStatus === lifecycleStatus);

    const scope = leads.filter(matches);

    const activeQualified = scope.filter((l) => l.lifecycleStatus === 'Active Qualified').length;
    const revoked = scope.filter((l) => l.lifecycleStatus === 'Revoked').length;
    const pendingVh = scope.filter((l) => !l.assignedVhName).length;
    const pendingCounsellor = scope.filter((l) => l.assignedVhName && !l.assignedCounsellorName).length;
    const pendingFirstContact = scope.filter(
      (l) => l.assignedCounsellorName && l.connectingStatus === 'Pending' && l.meetingAttemptCount === 0
    ).length;
    const meetingsScheduled = scope.filter((l) => l.meetingDate && (l.connectingStatus === 'Pending' || l.connectingStatus === 'Rescheduled')).length;
    const meetingNotJoined = scope.filter((l) => l.connectingStatus === 'Not Joined').length;
    const meetingRescheduled = scope.filter((l) => l.connectingStatus === 'Rescheduled').length;
    const meetingCompleted = scope.filter((l) => l.connectingStatus === 'Joined').length;
    const trialScheduled = scope.filter((l) => l.trialDate && (l.trialStatus === 'Pending' || l.trialStatus === 'Rescheduled')).length;
    const trialDone = scope.filter((l) => l.trialStatus === 'Trial Done').length;
    const admissionOnHold = scope.filter((l) => l.admissionStatus === 'On Hold').length;
    const admissionWon = scope.filter((l) => l.admissionStatus === 'Closed Won').length;
    const admissionLost = scope.filter((l) => l.admissionStatus === 'Closed Lost').length;

    const qToVhDays = scope.map((l) => daysBetween(l.qualifiedAt, l.vhAssignedAt)).filter((d): d is number => d != null);
    const avgDaysQualifiedToVh = qToVhDays.length ? qToVhDays.reduce((s, d) => s + d, 0) / qToVhDays.length : null;
    const vhToCounsellorDays = scope.map((l) => daysBetween(l.vhAssignedAt, l.counsellorAssignedAt)).filter((d): d is number => d != null);
    const avgDaysVhToCounsellor = vhToCounsellorDays.length ? vhToCounsellorDays.reduce((s, d) => s + d, 0) / vhToCounsellorDays.length : null;
    const overallWinRate = activeQualified + revoked ? admissionWon / (activeQualified + revoked) : 0;

    // Outcome breakdowns.
    const tally = (arr: Lead[], field: keyof Lead, values: string[]) => {
      const out: Record<string, number> = {};
      for (const v of values) out[v] = arr.filter((l) => (l[field] || 'Pending') === v).length;
      return out;
    };
    const meetingOutcome = tally(scope, 'connectingStatus', ['Pending', 'Joined', 'Not Joined', 'Rescheduled', 'Cancelled']);
    const trialOutcome = tally(scope, 'trialStatus', ['Pending', 'Trial Done', 'Trial Not Done', 'Rescheduled', 'Trial Sceduled but not done']);
    const admissionOutcome = tally(scope, 'admissionStatus', ['Pending', 'On Hold', 'Closed Won', 'Closed Lost']);

    // Handover status funnel (excludes 'Not Ready', which doesn't apply to already-qualified leads).
    const handoverFunnel = HANDOVER_STATUSES_STAGE2.filter((s) => s !== 'Not Ready').map((stage) => ({
      stage,
      count: scope.filter((l) => l.handoverStatus === stage).length,
    }));

    // By owner / VH / counsellor.
    function groupCount(field: keyof Lead) {
      const buckets = new Map<string, { qualified: number; admissionWon: number }>();
      for (const l of scope) {
        const key = (l[field] as string) || 'Unassigned';
        if (!buckets.has(key)) buckets.set(key, { qualified: 0, admissionWon: 0 });
        const b = buckets.get(key)!;
        b.qualified += 1;
        if (l.admissionStatus === 'Closed Won') b.admissionWon += 1;
      }
      return Array.from(buckets.entries()).map(([key, v]) => ({ key, ...v }));
    }
    const byOwner = groupCount('owner');
    const byVh = groupCount('assignedVhName');
    const byCounsellor = groupCount('assignedCounsellorName');

    const languagesSet = new Set<string>();
    const sourcesSet = new Set<string>();
    const agentsSet = new Set<string>();
    const vhSet = new Set<string>();
    const counsellorSet = new Set<string>();
    for (const l of leads) {
      if (l.language) languagesSet.add(l.language);
      if (l.source) sourcesSet.add(l.source);
      if (l.owner) agentsSet.add(l.owner);
      if (l.assignedVhName) vhSet.add(l.assignedVhName);
      if (l.assignedCounsellorName) counsellorSet.add(l.assignedCounsellorName);
    }

    return NextResponse.json({
      kpis: {
        activeQualified, revoked, pendingVh, pendingCounsellor, pendingFirstContact, meetingsScheduled,
        meetingNotJoined, meetingRescheduled, meetingCompleted, trialScheduled, trialDone, admissionOnHold,
        admissionWon, admissionLost, avgDaysQualifiedToVh, avgDaysVhToCounsellor, overallWinRate,
      },
      meetingOutcome, trialOutcome, admissionOutcome, handoverFunnel,
      byOwner, byVh, byCounsellor,
      filterOptions: {
        languages: Array.from(languagesSet).sort(),
        sources: Array.from(sourcesSet).sort(),
        agents: Array.from(agentsSet).sort(),
        vertheads: Array.from(vhSet).sort(),
        counsellors: Array.from(counsellorSet).sort(),
        handoverStatuses: HANDOVER_STATUSES_STAGE2.filter((s) => s !== 'Not Ready'),
        lifecycleStatuses: ['Active Qualified', 'Revoked'],
      },
    });
  } catch (err) {
    console.error('GET /api/dashboards/qualified-dashboard failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    return NextResponse.json({ error: `Could not load qualified dashboard: ${message}` }, { status: 500 });
  }
}
