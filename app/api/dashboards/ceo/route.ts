import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { ATTEMPT_COUNT } from '@/lib/masters';
import { todayIstDateStr } from '@/lib/followup';

// Executive-level, whole-org view: the full funnel from Assigned all the
// way to Admission, three leaderboards (Pre-Sales Agent, Vertical Head,
// Sales Counsellor — each ranked by a metric appropriate to their role),
// SLA timing between stages, a rule-based "what's working / what needs
// fixing" insight list, and the data-quality health checklist that used to
// be its own separate tab. Every filter that exists anywhere else in the
// app is available here at once.

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

function avg(nums: number[]): number | null {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : null;
}

type Lead = {
  leadCode: string;
  mobile: string;
  owner: string | null;
  ownerUserId: number | null;
  assignedVhName: string | null;
  assignedCounsellorName: string | null;
  language: string;
  source: string;
  preferredMode: string | null;
  assignedDate: string | null;
  qualificationStatus: string;
  lifecycleStatus: string;
  connectingStatus: string | null;
  meetingDate: string | null;
  trialDate: string | null;
  trialStatus: string | null;
  admissionStatus: string | null;
  admissionTimestamp: string | null;
  qualifiedAt: string | null;
  vhAssignedAt: string | null;
  counsellorAssignedAt: string | null;
  nextFollowupDate: string | null;
  attempts: { status: string | null; date: string | null }[];
};

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });

  try {
    const params = request.nextUrl.searchParams;
    const startDate = params.get('startDate') || '';
    const endDate = params.get('endDate') || '';
    const language = params.get('language') || 'All';
    const source = params.get('source') || 'All';
    const agent = params.get('agent') || 'All';
    const vh = params.get('vh') || 'All';
    const counsellor = params.get('counsellor') || 'All';
    const mode = params.get('mode') || 'All';
    const today = todayIstDateStr();

    const attemptCols = Array.from({ length: ATTEMPT_COUNT }, (_, i) => {
      const n = i + 1;
      return `l.attempt${n}_status AS "a${n}s", l.attempt${n}_date AS "a${n}d"`;
    }).join(', ');

    const rows = await sql.query(
      `SELECT l.lead_code AS "leadCode", l.mobile, owner.name AS "owner", l.owner_user_id AS "ownerUserId",
              vh.name AS "assignedVhName", counsellor.name AS "assignedCounsellorName",
              l.language, l.source, l.preferred_mode AS "preferredMode", l.assigned_date AS "assignedDate",
              l.qualification_status AS "qualificationStatus", l.lifecycle_status AS "lifecycleStatus",
              l.connecting_status AS "connectingStatus", l.meeting_date AS "meetingDate",
              l.trial_date AS "trialDate", l.trial_status AS "trialStatus",
              l.admission_status AS "admissionStatus", l.admission_timestamp AS "admissionTimestamp",
              l.qualified_at AS "qualifiedAt", l.vh_assigned_at AS "vhAssignedAt", l.counsellor_assigned_at AS "counsellorAssignedAt",
              l.next_followup_date AS "nextFollowupDate",
              ${attemptCols}
       FROM leads l
       LEFT JOIN users owner ON owner.id = l.owner_user_id
       LEFT JOIN users vh ON vh.id = l.assigned_vh_user_id
       LEFT JOIN users counsellor ON counsellor.id = l.assigned_counsellor_user_id`
    );

    const allLeads: Lead[] = (rows as Record<string, unknown>[]).map((r) => {
      const attempts = Array.from({ length: ATTEMPT_COUNT }, (_, i) => {
        const n = i + 1;
        return { status: (r[`a${n}s`] as string) || null, date: toDateStr(r[`a${n}d`]) };
      }).filter((a) => a.status || a.date);
      return {
        leadCode: r.leadCode as string,
        mobile: (r.mobile as string) || '',
        owner: (r.owner as string) || null,
        ownerUserId: (r.ownerUserId as number) ?? null,
        assignedVhName: (r.assignedVhName as string) || null,
        assignedCounsellorName: (r.assignedCounsellorName as string) || null,
        language: (r.language as string) || '',
        source: (r.source as string) || '',
        preferredMode: (r.preferredMode as string) || null,
        assignedDate: toDateStr(r.assignedDate),
        qualificationStatus: (r.qualificationStatus as string) || 'Not Reviewed',
        lifecycleStatus: (r.lifecycleStatus as string) || 'Active Qualified',
        connectingStatus: (r.connectingStatus as string) || null,
        meetingDate: toDateStr(r.meetingDate),
        trialDate: toDateStr(r.trialDate),
        trialStatus: (r.trialStatus as string) || null,
        admissionStatus: (r.admissionStatus as string) || null,
        admissionTimestamp: r.admissionTimestamp ? toDateStr(r.admissionTimestamp) : null,
        qualifiedAt: r.qualifiedAt ? toDateStr(r.qualifiedAt) : null,
        vhAssignedAt: r.vhAssignedAt ? toDateStr(r.vhAssignedAt) : null,
        counsellorAssignedAt: r.counsellorAssignedAt ? toDateStr(r.counsellorAssignedAt) : null,
        nextFollowupDate: toDateStr(r.nextFollowupDate),
        attempts,
      };
    });

    const matches = (l: Lead) =>
      (!startDate || (l.assignedDate && l.assignedDate >= startDate)) &&
      (!endDate || (l.assignedDate && l.assignedDate <= endDate)) &&
      (language === 'All' || l.language === language) &&
      (source === 'All' || l.source === source) &&
      (agent === 'All' || l.owner === agent) &&
      (vh === 'All' || l.assignedVhName === vh) &&
      (counsellor === 'All' || l.assignedCounsellorName === counsellor) &&
      (mode === 'All' || (l.preferredMode || 'Not Set') === mode);

    const scope = allLeads.filter(matches);

    // ---- Full funnel ----
    const assigned = scope.length;
    const touched = scope.filter((l) => l.attempts.length > 0).length;
    const connected = scope.filter((l) => l.attempts.some((a) => a.status === 'Connected')).length;
    const qualified = scope.filter((l) => l.qualificationStatus === 'Qualified').length;
    const vhAssigned = scope.filter((l) => l.qualificationStatus === 'Qualified' && l.assignedVhName).length;
    const counsellorAssigned = scope.filter((l) => l.qualificationStatus === 'Qualified' && l.assignedCounsellorName).length;
    const meetingScheduled = scope.filter((l) => l.meetingDate).length;
    const meetingDone = scope.filter((l) => l.connectingStatus === 'Joined').length;
    const trialScheduled = scope.filter((l) => l.trialDate).length;
    const trialDone = scope.filter((l) => l.trialStatus === 'Trial Done').length;
    const admissionWon = scope.filter((l) => l.admissionStatus === 'Closed Won').length;
    const admissionLost = scope.filter((l) => l.admissionStatus === 'Closed Lost').length;
    const revokedCount = scope.filter((l) => l.lifecycleStatus === 'Revoked').length;
    const activePipeline = scope.filter(
      (l) => l.qualificationStatus === 'Qualified' && l.lifecycleStatus === 'Active Qualified' && l.admissionStatus !== 'Closed Won' && l.admissionStatus !== 'Closed Lost'
    ).length;

    const overallWinRate = qualified ? admissionWon / qualified : 0;
    const qualifiedRate = assigned ? qualified / assigned : 0;
    const connectionRate = touched ? connected / touched : 0;

    // ---- SLA / time-to-stage (average calendar days) ----
    const slaFor = (getA: (l: Lead) => string | null, getB: (l: Lead) => string | null) =>
      avg(scope.map((l) => daysBetween(getA(l), getB(l))).filter((d): d is number => d != null));

    const firstAttemptDate = (l: Lead) => {
      const dates = l.attempts.map((a) => a.date).filter((d): d is string => !!d).sort();
      return dates[0] || null;
    };

    const sla = {
      assignmentToFirstAttempt: slaFor((l) => l.assignedDate, firstAttemptDate),
      assignmentToQualification: slaFor((l) => l.assignedDate, (l) => l.qualifiedAt),
      qualificationToVh: slaFor((l) => l.qualifiedAt, (l) => l.vhAssignedAt),
      vhToCounsellor: slaFor((l) => l.vhAssignedAt, (l) => l.counsellorAssignedAt),
      meetingToTrial: slaFor((l) => l.meetingDate, (l) => l.trialDate),
      trialToAdmission: slaFor((l) => l.trialDate, (l) => l.admissionTimestamp),
    };

    // ---- Leaderboards ----
    type LbRow = { name: string; qualifiedAssigned: number; admissionWon: number; winRate: number; volume: number };
    function buildLeaderboard(nameFn: (l: Lead) => string | null, denomFn: (l: Lead) => boolean): LbRow[] {
      const buckets = new Map<string, { qualifiedAssigned: number; admissionWon: number; volume: number }>();
      for (const l of scope) {
        const name = nameFn(l);
        if (!name) continue;
        if (!denomFn(l)) continue;
        if (!buckets.has(name)) buckets.set(name, { qualifiedAssigned: 0, admissionWon: 0, volume: 0 });
        const b = buckets.get(name)!;
        b.qualifiedAssigned += 1;
        b.volume += 1;
        if (l.admissionStatus === 'Closed Won') b.admissionWon += 1;
      }
      return Array.from(buckets.entries())
        .map(([name, b]) => ({ name, ...b, winRate: b.qualifiedAssigned ? b.admissionWon / b.qualifiedAssigned : 0 }))
        .sort((a, b) => b.winRate - a.winRate || b.volume - a.volume);
    }

    const agentLeaderboard = (() => {
      const buckets = new Map<string, { assigned: number; qualified: number }>();
      for (const l of scope) {
        const name = l.owner || 'Unassigned';
        if (!buckets.has(name)) buckets.set(name, { assigned: 0, qualified: 0 });
        const b = buckets.get(name)!;
        b.assigned += 1;
        if (l.qualificationStatus === 'Qualified') b.qualified += 1;
      }
      return Array.from(buckets.entries())
        .map(([name, b]) => ({ name, ...b, qualifiedPerAssigned: b.assigned ? b.qualified / b.assigned : 0 }))
        .sort((a, b) => b.qualifiedPerAssigned - a.qualifiedPerAssigned);
    })();

    const vhLeaderboard = buildLeaderboard((l) => l.assignedVhName, (l) => l.qualificationStatus === 'Qualified');
    const counsellorLeaderboard = buildLeaderboard((l) => l.assignedCounsellorName, (l) => l.qualificationStatus === 'Qualified');

    // ---- Data quality / health checklist (whole database, not filtered — this is a system-wide integrity check) ----
    const mobileCounts = new Map<string, number>();
    for (const l of allLeads) {
      if (!l.mobile) continue;
      mobileCounts.set(l.mobile, (mobileCounts.get(l.mobile) || 0) + 1);
    }
    const duplicateMobiles = Array.from(mobileCounts.values()).filter((c) => c > 1).reduce((s, c) => s + c, 0);
    const missingOwner = allLeads.filter((l) => !l.ownerUserId).length;
    const stuckNotReviewed = allLeads.filter((l) => l.attempts.length > 0 && l.qualificationStatus === 'Not Reviewed').length;
    const qualifiedWithoutVh = allLeads.filter((l) => l.qualificationStatus === 'Qualified' && l.lifecycleStatus === 'Active Qualified' && !l.assignedVhName).length;
    const qualifiedWithoutCounsellor = allLeads.filter((l) => l.qualificationStatus === 'Qualified' && l.lifecycleStatus === 'Active Qualified' && !l.assignedCounsellorName).length;
    const overdueFollowups = allLeads.filter((l) => l.nextFollowupDate && l.nextFollowupDate < today).length;
    const revokedTotal = allLeads.filter((l) => l.lifecycleStatus === 'Revoked').length;

    function severity(count: number, criticalAt: number): 'OK' | 'Warning' | 'Critical' {
      if (count === 0) return 'OK';
      if (count >= criticalAt) return 'Critical';
      return 'Warning';
    }

    const health = [
      { metric: 'Total Leads', value: allLeads.length, severity: 'OK' as const, why: 'Current data volume.', action: 'No action needed.' },
      { metric: 'Duplicate Mobile Numbers', value: duplicateMobiles, severity: severity(duplicateMobiles, 10), why: 'Potential repeated enquiries or bad data.', action: 'Review manually — do not auto-merge.' },
      { metric: 'Missing Owner', value: missingOwner, severity: severity(missingOwner, 5), why: 'Lead will never reach an agent.', action: 'Run allocation or assign manually.' },
      { metric: 'Attempted but Never Reviewed', value: stuckNotReviewed, severity: severity(stuckNotReviewed, 10), why: 'Falls outside qualification reporting.', action: 'Agent should set a Final Outcome.' },
      { metric: 'Qualified without Vertical Head', value: qualifiedWithoutVh, severity: severity(qualifiedWithoutVh, 5), why: 'Qualified lead is stuck waiting.', action: 'Admin assigns a Vertical Head.' },
      { metric: 'Qualified without Sales Counsellor', value: qualifiedWithoutCounsellor, severity: severity(qualifiedWithoutCounsellor, 5), why: 'No one owns the handover yet.', action: 'Vertical Head assigns a Counsellor.' },
      { metric: 'Overdue Follow-ups', value: overdueFollowups, severity: severity(overdueFollowups, 10), why: 'Lead may go cold or be lost.', action: 'Prioritise in Today\'s Follow-up.' },
      { metric: 'Revoked Leads', value: revokedTotal, severity: 'OK' as const, why: 'Audit/history only.', action: 'Excluded from active pipeline — no action.' },
    ];

    // ---- Rule-based insights: what's working, what needs fixing ----
    const insights: { type: 'good' | 'warning'; text: string }[] = [];
    if (assigned > 0) {
      if (connectionRate >= 0.4) insights.push({ type: 'good', text: `Call connection rate is healthy at ${(connectionRate * 100).toFixed(0)}%.` });
      else if (touched > 0) insights.push({ type: 'warning', text: `Call connection rate is low at ${(connectionRate * 100).toFixed(0)}% — review calling windows or number quality.` });

      if (qualifiedRate >= 0.15) insights.push({ type: 'good', text: `Qualification rate is solid at ${(qualifiedRate * 100).toFixed(0)}% of assigned leads.` });
      else insights.push({ type: 'warning', text: `Qualification rate is only ${(qualifiedRate * 100).toFixed(0)}% of assigned leads — review agent pitch or lead quality by source.` });

      const untouched = assigned - touched;
      if (untouched === 0) insights.push({ type: 'good', text: 'Every assigned lead in this view has been touched at least once.' });
      else insights.push({ type: 'warning', text: `${untouched} assigned lead(s) have never been touched — check agent workload.` });
    }
    if (qualified > 0) {
      if (overallWinRate >= 0.2) insights.push({ type: 'good', text: `Overall win rate (Admission / Qualified) is strong at ${(overallWinRate * 100).toFixed(0)}%.` });
      else insights.push({ type: 'warning', text: `Overall win rate is ${(overallWinRate * 100).toFixed(0)}% — look at where the qualified pipeline is leaking (VH/Counsellor pending, meeting no-shows, trial no-shows).` });
    }
    if (vhAssigned < qualified) insights.push({ type: 'warning', text: `${qualified - vhAssigned} qualified lead(s) still waiting for a Vertical Head.` });
    if (counsellorAssigned < vhAssigned) insights.push({ type: 'warning', text: `${vhAssigned - counsellorAssigned} lead(s) have a Vertical Head but no Sales Counsellor yet.` });
    if (meetingScheduled > 0) {
      const meetingJoinRate = meetingScheduled ? meetingDone / meetingScheduled : 0;
      if (meetingJoinRate >= 0.6) insights.push({ type: 'good', text: `Meeting join rate is healthy at ${(meetingJoinRate * 100).toFixed(0)}%.` });
      else insights.push({ type: 'warning', text: `Only ${(meetingJoinRate * 100).toFixed(0)}% of scheduled meetings are being joined — consider reminder calls or reschedule follow-through.` });
    }
    if (trialScheduled > 0) {
      const trialDoneRate = trialScheduled ? trialDone / trialScheduled : 0;
      if (trialDoneRate < 0.5) insights.push({ type: 'warning', text: `Only ${(trialDoneRate * 100).toFixed(0)}% of scheduled trials are completing — investigate trial scheduling/no-shows.` });
    }
    if (overdueFollowups > 0) insights.push({ type: 'warning', text: `${overdueFollowups} follow-up(s) are overdue right now across the whole database.` });
    if (duplicateMobiles > 0) insights.push({ type: 'warning', text: `${duplicateMobiles} lead record(s) share a duplicate mobile number.` });

    const languagesSet = new Set<string>();
    const sourcesSet = new Set<string>();
    const agentsSet = new Set<string>();
    const vhSet = new Set<string>();
    const counsellorSet = new Set<string>();
    const modesSet = new Set<string>();
    for (const l of allLeads) {
      if (l.language) languagesSet.add(l.language);
      if (l.source) sourcesSet.add(l.source);
      if (l.owner) agentsSet.add(l.owner);
      if (l.assignedVhName) vhSet.add(l.assignedVhName);
      if (l.assignedCounsellorName) counsellorSet.add(l.assignedCounsellorName);
      modesSet.add(l.preferredMode || 'Not Set');
    }

    return NextResponse.json({
      funnel: {
        assigned, touched, connected, qualified, vhAssigned, counsellorAssigned,
        meetingScheduled, meetingDone, trialScheduled, trialDone, admissionWon, admissionLost,
      },
      topKpis: { assigned, qualified, qualifiedRate, admissionWon, overallWinRate, activePipeline, revokedCount },
      sla,
      agentLeaderboard,
      vhLeaderboard,
      counsellorLeaderboard,
      health,
      insights,
      filterOptions: {
        languages: Array.from(languagesSet).sort(),
        sources: Array.from(sourcesSet).sort(),
        agents: Array.from(agentsSet).sort(),
        vertheads: Array.from(vhSet).sort(),
        counsellors: Array.from(counsellorSet).sort(),
        modes: Array.from(modesSet).sort(),
      },
    });
  } catch (err) {
    console.error('GET /api/dashboards/ceo failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    return NextResponse.json({ error: `Could not load CEO dashboard: ${message}` }, { status: 500 });
  }
}
