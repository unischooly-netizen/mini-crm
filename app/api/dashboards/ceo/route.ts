import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import {
  ATTEMPT_COUNT, ATTEMPT_STATUSES, CONNECTING_STATUSES, TRIAL_STATUSES, ADMISSION_STATUSES,
  HANDOVER_STATUSES_STAGE2,
} from '@/lib/masters';
import { todayIstDateStr } from '@/lib/followup';

// Executive-level, whole-org view: the full funnel from Assigned all the
// way to Admission, a massively expanded flat KPI set covering every stage
// tracked anywhere else in the app (call activity, qualification, handover,
// meeting funnel, trial funnel, admission funnel, today snapshot), pie-chart
// outcome breakdowns (meeting/trial/admission/call status), a handover
// status funnel, breakdowns by language/source/mode using the same rich
// bucket, three leaderboards (Pre-Sales Agent, Vertical Head, Sales
// Counsellor — each ranked by a metric appropriate to their role), SLA
// timing between stages, a rule-based "what's working / what needs fixing"
// insight list, and the data-quality health checklist. Every filter that
// exists anywhere else in the app is available here at once.

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
  handoverStatus: string | null;
  connectingStatus: string | null;
  meetingDate: string | null;
  meetingAttemptCount: number;
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

// ---------------------------------------------------------------------------
// Rich bucket pattern (mirrors team-performance's accumulate/withRates) —
// used both for the org-wide KPI set and for every breakdown-by dimension
// (language/source/mode) so they all report the exact same shape.
// ---------------------------------------------------------------------------

function emptyBucket() {
  return {
    assigned: 0, touched: 0, totalCallAttempts: 0, connectedCalls: 0, uniqueConnected: 0,
    qualified: 0, followUpNeeded: 0, notQualified: 0, notReviewed: 0,
    vhAssigned: 0, counsellorAssigned: 0, pendingVh: 0, pendingCounsellor: 0, pendingFirstContact: 0,
    meetingScheduled: 0, meetingDone: 0, meetingNotJoined: 0, meetingRescheduled: 0, meetingCancelled: 0,
    trialScheduled: 0, trialDone: 0, trialNotDone: 0, trialRescheduled: 0,
    admissionPending: 0, admissionOnHold: 0, admissionWon: 0, admissionLost: 0,
    activePipeline: 0, revoked: 0,
  };
}
type Bucket = ReturnType<typeof emptyBucket>;

function accumulate(bucket: Bucket, lead: Lead, startDate: string, endDate: string) {
  bucket.assigned += 1;
  const attemptsInRange = lead.attempts.filter((a) => a.date && (!startDate || a.date >= startDate) && (!endDate || a.date <= endDate));
  if (attemptsInRange.length > 0) bucket.touched += 1;
  bucket.totalCallAttempts += attemptsInRange.length;
  const connected = attemptsInRange.filter((a) => a.status === 'Connected');
  bucket.connectedCalls += connected.length;
  if (connected.length > 0) bucket.uniqueConnected += 1;

  const isQualified = lead.qualificationStatus === 'Qualified';
  if (isQualified) bucket.qualified += 1;
  else if (lead.qualificationStatus === 'Follow-up Needed') bucket.followUpNeeded += 1;
  else if (lead.qualificationStatus === 'Not Qualified') bucket.notQualified += 1;
  else bucket.notReviewed += 1;

  // Pending VH / Pending Counsellor / Pending First Contact — same logic as
  // the Qualified Dashboard, scoped here to isQualified within this bucket.
  if (isQualified) {
    if (lead.assignedVhName) bucket.vhAssigned += 1;
    else bucket.pendingVh += 1;
    if (lead.assignedCounsellorName) bucket.counsellorAssigned += 1;
    else if (lead.assignedVhName) bucket.pendingCounsellor += 1;
    if (lead.assignedCounsellorName && lead.connectingStatus === 'Pending' && lead.meetingAttemptCount === 0) {
      bucket.pendingFirstContact += 1;
    }
  }

  if (lead.meetingDate) bucket.meetingScheduled += 1;
  if (lead.connectingStatus === 'Joined') bucket.meetingDone += 1;
  if (lead.connectingStatus === 'Not Joined') bucket.meetingNotJoined += 1;
  if (lead.connectingStatus === 'Rescheduled') bucket.meetingRescheduled += 1;
  if (lead.connectingStatus === 'Cancelled') bucket.meetingCancelled += 1;

  if (lead.trialDate) bucket.trialScheduled += 1;
  if (lead.trialStatus === 'Trial Done') bucket.trialDone += 1;
  if (lead.trialStatus === 'Trial Not Done') bucket.trialNotDone += 1;
  if (lead.trialStatus === 'Rescheduled' || lead.trialStatus === 'Trial Sceduled but not done') bucket.trialRescheduled += 1;

  const admissionStatus = lead.admissionStatus || 'Pending';
  if (admissionStatus === 'Pending') bucket.admissionPending += 1;
  if (admissionStatus === 'On Hold') bucket.admissionOnHold += 1;
  if (admissionStatus === 'Closed Won') bucket.admissionWon += 1;
  if (admissionStatus === 'Closed Lost') bucket.admissionLost += 1;

  if (isQualified && lead.lifecycleStatus === 'Active Qualified' && admissionStatus !== 'Closed Won' && admissionStatus !== 'Closed Lost') {
    bucket.activePipeline += 1;
  }
  if (lead.lifecycleStatus === 'Revoked') bucket.revoked += 1;
}

function withRates(b: Bucket) {
  return {
    ...b,
    untouched: b.assigned - b.touched,
    notConnected: b.totalCallAttempts - b.connectedCalls,
    callConnectionRate: b.totalCallAttempts ? b.connectedCalls / b.totalCallAttempts : 0,
    leadConnectionRate: b.touched ? b.uniqueConnected / b.touched : 0,
    avgAttemptsPerTouched: b.touched ? b.totalCallAttempts / b.touched : 0,
    qualifiedRate: b.assigned ? b.qualified / b.assigned : 0,
    qualifiedPerTouched: b.touched ? b.qualified / b.touched : 0,
    qualifiedPerConnected: b.uniqueConnected ? b.qualified / b.uniqueConnected : 0,
    meetingJoinRate: b.meetingScheduled ? b.meetingDone / b.meetingScheduled : 0,
    trialCompletionRate: b.trialScheduled ? b.trialDone / b.trialScheduled : 0,
    admissionWinRate: (b.admissionWon + b.admissionLost) ? b.admissionWon / (b.admissionWon + b.admissionLost) : 0,
    overallWinRate: b.qualified ? b.admissionWon / b.qualified : 0,
  };
}

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
              l.handover_status AS "handoverStatus",
              l.connecting_status AS "connectingStatus", l.meeting_date AS "meetingDate",
              l.meeting_attempt_count AS "meetingAttemptCount",
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
        handoverStatus: (r.handoverStatus as string) || null,
        connectingStatus: (r.connectingStatus as string) || null,
        meetingDate: toDateStr(r.meetingDate),
        meetingAttemptCount: Number(r.meetingAttemptCount) || 0,
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
    const qualifiedScope = scope.filter((l) => l.qualificationStatus === 'Qualified');

    // ---- Full flat KPI set (org-wide, whole filtered scope) ----
    const orgBucket = emptyBucket();
    for (const l of scope) accumulate(orgBucket, l, startDate, endDate);
    const kpis = withRates(orgBucket);

    // ---- Today snapshot — independent of the Start/End Date range, but
    // respects every other filter (language/source/agent/vh/counsellor/mode). ----
    const snapshotScope = allLeads.filter(
      (l) =>
        (language === 'All' || l.language === language) &&
        (source === 'All' || l.source === source) &&
        (agent === 'All' || l.owner === agent) &&
        (vh === 'All' || l.assignedVhName === vh) &&
        (counsellor === 'All' || l.assignedCounsellorName === counsellor) &&
        (mode === 'All' || (l.preferredMode || 'Not Set') === mode)
    );
    const todaySnapshot = {
      followupsDueToday: snapshotScope.filter((l) => l.nextFollowupDate === today).length,
      overdueNow: snapshotScope.filter((l) => l.nextFollowupDate && l.nextFollowupDate < today).length,
      callAttemptsToday: snapshotScope.flatMap((l) => l.attempts.filter((a) => a.date === today)).length,
      qualifiedToday: snapshotScope.filter((l) => l.qualifiedAt === today).length,
      meetingsToday: snapshotScope.filter((l) => l.meetingDate === today).length,
      admissionsToday: snapshotScope.filter((l) => l.admissionTimestamp === today).length,
    };

    // ---- Funnel (extended) ----
    const funnel = {
      assigned: kpis.assigned,
      touched: kpis.touched,
      connected: kpis.uniqueConnected,
      qualified: kpis.qualified,
      vhAssigned: kpis.vhAssigned,
      counsellorAssigned: kpis.counsellorAssigned,
      meetingScheduled: kpis.meetingScheduled,
      meetingDone: kpis.meetingDone,
      trialScheduled: kpis.trialScheduled,
      trialDone: kpis.trialDone,
      admissionWon: kpis.admissionWon,
      admissionLost: kpis.admissionLost,
    };

    // ---- Outcome breakdowns for pie charts — scoped to QUALIFIED leads only,
    // since connecting_status/trial_status/admission_status default to
    // 'Pending' and are NOT NULL on every lead row (including unqualified
    // ones), so tallying the whole scope would drown the chart in noise
    // from leads these fields don't meaningfully apply to yet. ----
    const tally = (arr: Lead[], field: 'connectingStatus' | 'trialStatus' | 'admissionStatus', values: string[]) => {
      const out: Record<string, number> = {};
      for (const v of values) out[v] = arr.filter((l) => (l[field] || 'Pending') === v).length;
      return out;
    };
    const meetingOutcome = tally(qualifiedScope, 'connectingStatus', CONNECTING_STATUSES);
    const trialOutcome = tally(qualifiedScope, 'trialStatus', TRIAL_STATUSES);
    const admissionOutcome = tally(qualifiedScope, 'admissionStatus', ADMISSION_STATUSES);

    // ---- Call status breakdown — ALL call attempts across the full scope
    // (not qualified-only), mirroring the Call Log dashboard's pie chart. ----
    const callStatusBreakdown: Record<string, number> = {};
    for (const s of ATTEMPT_STATUSES) callStatusBreakdown[s] = 0;
    for (const l of scope) {
      const attemptsInRange = l.attempts.filter((a) => a.date && (!startDate || a.date >= startDate) && (!endDate || a.date <= endDate));
      for (const a of attemptsInRange) {
        if (!a.status) continue;
        callStatusBreakdown[a.status] = (callStatusBreakdown[a.status] || 0) + 1;
      }
    }

    // ---- Handover status funnel — qualified leads only, excludes 'Not Ready'. ----
    const handoverFunnel = HANDOVER_STATUSES_STAGE2.filter((s) => s !== 'Not Ready').map((stage) => ({
      stage,
      count: qualifiedScope.filter((l) => l.handoverStatus === stage).length,
    }));

    // ---- Breakdown-by dimension, using the exact same rich bucket, each
    // ignoring its OWN filter so every value in that dimension still shows
    // (same pattern as team-performance's breakdownBy). ----
    function breakdownBy(keyFn: (l: Lead) => string, ignoreLanguageFilter: boolean, ignoreSourceFilter: boolean, ignoreModeFilter: boolean) {
      const scoped = allLeads.filter(
        (l) =>
          (!startDate || (l.assignedDate && l.assignedDate >= startDate)) &&
          (!endDate || (l.assignedDate && l.assignedDate <= endDate)) &&
          (ignoreLanguageFilter || language === 'All' || l.language === language) &&
          (ignoreSourceFilter || source === 'All' || l.source === source) &&
          (agent === 'All' || l.owner === agent) &&
          (vh === 'All' || l.assignedVhName === vh) &&
          (counsellor === 'All' || l.assignedCounsellorName === counsellor) &&
          (ignoreModeFilter || mode === 'All' || (l.preferredMode || 'Not Set') === mode)
      );
      const buckets = new Map<string, Bucket>();
      for (const l of scoped) {
        const key = keyFn(l) || 'Not Set';
        if (!buckets.has(key)) buckets.set(key, emptyBucket());
        accumulate(buckets.get(key)!, l, startDate, endDate);
      }
      return Array.from(buckets.entries()).map(([key, b]) => ({ key, ...withRates(b) }));
    }

    const byLanguage = breakdownBy((l) => l.language, true, false, false);
    const bySource = breakdownBy((l) => l.source, false, true, false);
    const byMode = breakdownBy((l) => l.preferredMode || 'Not Set', false, false, true);

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
    if (kpis.assigned > 0) {
      if (kpis.leadConnectionRate >= 0.4) insights.push({ type: 'good', text: `Call connection rate is healthy at ${(kpis.leadConnectionRate * 100).toFixed(0)}%.` });
      else if (kpis.touched > 0) insights.push({ type: 'warning', text: `Call connection rate is low at ${(kpis.leadConnectionRate * 100).toFixed(0)}% — review calling windows or number quality.` });

      if (kpis.qualifiedRate >= 0.15) insights.push({ type: 'good', text: `Qualification rate is solid at ${(kpis.qualifiedRate * 100).toFixed(0)}% of assigned leads.` });
      else insights.push({ type: 'warning', text: `Qualification rate is only ${(kpis.qualifiedRate * 100).toFixed(0)}% of assigned leads — review agent pitch or lead quality by source.` });

      if (kpis.untouched === 0) insights.push({ type: 'good', text: 'Every assigned lead in this view has been touched at least once.' });
      else insights.push({ type: 'warning', text: `${kpis.untouched} assigned lead(s) have never been touched — check agent workload.` });
    }
    if (kpis.qualified > 0) {
      if (kpis.overallWinRate >= 0.2) insights.push({ type: 'good', text: `Overall win rate (Admission / Qualified) is strong at ${(kpis.overallWinRate * 100).toFixed(0)}%.` });
      else insights.push({ type: 'warning', text: `Overall win rate is ${(kpis.overallWinRate * 100).toFixed(0)}% — look at where the qualified pipeline is leaking (VH/Counsellor pending, meeting no-shows, trial no-shows).` });
    }
    if (kpis.vhAssigned < kpis.qualified) insights.push({ type: 'warning', text: `${kpis.qualified - kpis.vhAssigned} qualified lead(s) still waiting for a Vertical Head.` });
    if (kpis.counsellorAssigned < kpis.vhAssigned) insights.push({ type: 'warning', text: `${kpis.vhAssigned - kpis.counsellorAssigned} lead(s) have a Vertical Head but no Sales Counsellor yet.` });
    if (kpis.meetingScheduled > 0) {
      if (kpis.meetingJoinRate >= 0.6) insights.push({ type: 'good', text: `Meeting join rate is healthy at ${(kpis.meetingJoinRate * 100).toFixed(0)}%.` });
      else insights.push({ type: 'warning', text: `Only ${(kpis.meetingJoinRate * 100).toFixed(0)}% of scheduled meetings are being joined — consider reminder calls or reschedule follow-through.` });
    }
    if (kpis.trialScheduled > 0) {
      if (kpis.trialCompletionRate < 0.5) insights.push({ type: 'warning', text: `Only ${(kpis.trialCompletionRate * 100).toFixed(0)}% of scheduled trials are completing — investigate trial scheduling/no-shows.` });
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
      kpis,
      today: todaySnapshot,
      funnel,
      meetingOutcome, trialOutcome, admissionOutcome,
      callStatusBreakdown,
      handoverFunnel,
      byLanguage, bySource, byMode,
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
