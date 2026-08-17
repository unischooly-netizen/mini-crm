import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { ATTEMPT_COUNT, PREFERRED_MODES } from '@/lib/masters';
import { todayIstDateStr } from '@/lib/followup';

// Full pre-sales funnel per agent: Assigned -> Touched -> Call Attempts ->
// Connected -> Qualified -> Meeting -> Trial -> Admission, plus a Today/
// Tomorrow activity snapshot and breakdowns by language/source/mode. Every
// role can view this (it's how an agent sees where they rank), but the
// client only exposes the Agent filter to non-agent roles — agents always
// see the full team so they can gauge their own standing.

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

function addDaysIst(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

type LeadRow = {
  leadCode: string;
  owner: string | null;
  language: string;
  source: string;
  preferredMode: string | null;
  assignedDate: string | null;
  totalAttempts: number;
  qualificationStatus: string;
  meetingDate: string | null;
  connectingStatus: string | null;
  trialDate: string | null;
  trialStatus: string | null;
  admissionStatus: string | null;
  nextMeetingDate: string | null;
  nextTrialDate: string | null;
  nextFollowupDate: string | null;
  qualifiedAt: string | null;
  attempts: { status: string | null; date: string | null }[];
};

function emptyBucket() {
  return {
    assigned: 0, touched: 0, calledTotal: 0, connectedAttempts: 0, uniqueConnected: 0,
    qualified: 0, followUpNeeded: 0, notQualified: 0,
    meetingScheduled: 0, meetingDone: 0, meetingRescheduled: 0, meetingCancelled: 0, meetingNotDone: 0,
    trialScheduled: 0, trialDone: 0, admissionWon: 0,
  };
}
type Bucket = ReturnType<typeof emptyBucket>;

function accumulate(bucket: Bucket, lead: LeadRow, startDate: string, endDate: string) {
  bucket.assigned += 1;
  const attemptsInRange = lead.attempts.filter((a) => a.date && (!startDate || a.date >= startDate) && (!endDate || a.date <= endDate));
  if (attemptsInRange.length > 0) bucket.touched += 1;
  bucket.calledTotal += attemptsInRange.length;
  const connected = attemptsInRange.filter((a) => a.status === 'Connected');
  bucket.connectedAttempts += connected.length;
  if (connected.length > 0) bucket.uniqueConnected += 1;

  if (lead.qualificationStatus === 'Qualified') bucket.qualified += 1;
  if (lead.qualificationStatus === 'Follow-up Needed') bucket.followUpNeeded += 1;
  if (lead.qualificationStatus === 'Not Qualified') bucket.notQualified += 1;

  if (lead.meetingDate) bucket.meetingScheduled += 1;
  if (lead.connectingStatus === 'Joined') bucket.meetingDone += 1;
  if (lead.connectingStatus === 'Rescheduled') bucket.meetingRescheduled += 1;
  if (lead.connectingStatus === 'Cancelled') bucket.meetingCancelled += 1;
  if (lead.connectingStatus === 'Not Joined') bucket.meetingNotDone += 1;

  if (lead.trialDate) bucket.trialScheduled += 1;
  if (lead.trialStatus === 'Trial Done') bucket.trialDone += 1;
  if (lead.admissionStatus === 'Closed Won') bucket.admissionWon += 1;
}

function withRates(b: Bucket) {
  return {
    ...b,
    callConnectionRate: b.calledTotal ? b.connectedAttempts / b.calledTotal : 0,
    leadConnectionRate: b.touched ? b.uniqueConnected / b.touched : 0,
    qualifiedPerAssigned: b.assigned ? b.qualified / b.assigned : 0,
    qualifiedPerTouched: b.touched ? b.qualified / b.touched : 0,
    qualifiedPerConnected: b.uniqueConnected ? b.qualified / b.uniqueConnected : 0,
    untouched: b.assigned - b.touched,
    avgAttemptsPerTouched: b.touched ? b.calledTotal / b.touched : 0,
  };
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });

  try {
    const params = request.nextUrl.searchParams;
    const today = todayIstDateStr();
    const startDate = params.get('startDate') || addDaysIst(today, -30);
    const endDate = params.get('endDate') || today;
    const language = params.get('language') || 'All';
    const source = params.get('source') || 'All';
    const agentFilter = params.get('agent') || 'All';
    const tomorrow = addDaysIst(today, 1);

    const attemptCols = Array.from({ length: ATTEMPT_COUNT }, (_, i) => {
      const n = i + 1;
      return `l.attempt${n}_status AS "a${n}s", l.attempt${n}_date AS "a${n}d"`;
    }).join(', ');

    const rows = await sql.query(
      `SELECT l.lead_code AS "leadCode", u.name AS "owner", l.language, l.source, l.preferred_mode AS "preferredMode",
              l.assigned_date AS "assignedDate", l.total_attempts AS "totalAttempts",
              l.qualification_status AS "qualificationStatus",
              l.meeting_date AS "meetingDate", l.connecting_status AS "connectingStatus",
              l.trial_date AS "trialDate", l.trial_status AS "trialStatus", l.admission_status AS "admissionStatus",
              l.next_meeting_date AS "nextMeetingDate", l.next_trial_date AS "nextTrialDate",
              l.next_followup_date AS "nextFollowupDate", l.qualified_at AS "qualifiedAt",
              ${attemptCols}
       FROM leads l
       LEFT JOIN users u ON u.id = l.owner_user_id`
    );

    const agentsResult = await sql`SELECT name FROM users WHERE role = 'presales_agent' ORDER BY name`;
    const allAgentNames = (agentsResult as { name: string }[]).map((r) => r.name);

    const leads: LeadRow[] = (rows as Record<string, unknown>[]).map((r) => {
      const attempts = Array.from({ length: ATTEMPT_COUNT }, (_, i) => {
        const n = i + 1;
        return { status: (r[`a${n}s`] as string) || null, date: toDateStr(r[`a${n}d`]) };
      }).filter((a) => a.status || a.date);
      return {
        leadCode: r.leadCode as string,
        owner: (r.owner as string) || null,
        language: (r.language as string) || '',
        source: (r.source as string) || '',
        preferredMode: (r.preferredMode as string) || null,
        assignedDate: toDateStr(r.assignedDate),
        totalAttempts: Number(r.totalAttempts) || 0,
        qualificationStatus: (r.qualificationStatus as string) || 'Not Reviewed',
        meetingDate: toDateStr(r.meetingDate),
        connectingStatus: (r.connectingStatus as string) || null,
        trialDate: toDateStr(r.trialDate),
        trialStatus: (r.trialStatus as string) || null,
        admissionStatus: (r.admissionStatus as string) || null,
        nextMeetingDate: toDateStr(r.nextMeetingDate),
        nextTrialDate: toDateStr(r.nextTrialDate),
        nextFollowupDate: toDateStr(r.nextFollowupDate),
        qualifiedAt: r.qualifiedAt ? toDateStr(r.qualifiedAt) : null,
        attempts,
      };
    });

    // Scope: leads assigned within the date range, matching language/source/agent filters.
    const inScope = leads.filter(
      (l) =>
        l.assignedDate && (!startDate || l.assignedDate >= startDate) && (!endDate || l.assignedDate <= endDate) &&
        (language === 'All' || l.language === language) &&
        (source === 'All' || l.source === source) &&
        (agentFilter === 'All' || l.owner === agentFilter)
    );

    // Per-agent table — always every agent, even ones with zero leads in scope.
    const perAgentBuckets = new Map<string, Bucket>();
    for (const name of allAgentNames) perAgentBuckets.set(name, emptyBucket());
    for (const l of inScope) {
      const name = l.owner || 'Unassigned';
      if (!perAgentBuckets.has(name)) perAgentBuckets.set(name, emptyBucket());
      accumulate(perAgentBuckets.get(name)!, l, startDate, endDate);
    }
    const perAgent = Array.from(perAgentBuckets.entries())
      .map(([agent, b]) => ({ agent, ...withRates(b) }))
      .sort((a, b) => b.qualifiedPerAssigned - a.qualifiedPerAssigned)
      .map((row, i) => ({ ...row, rank: i + 1 }));

    // Team-wide totals (same scope).
    const teamBucket = emptyBucket();
    for (const l of inScope) accumulate(teamBucket, l, startDate, endDate);
    const team = withRates(teamBucket);

    // By language / source / mode — filtered by date range + agent only (not
    // by their own dimension, so every language/source/mode still shows up).
    function breakdownBy(keyFn: (l: LeadRow) => string, ignoreLanguageFilter: boolean, ignoreSourceFilter: boolean) {
      const scoped = leads.filter(
        (l) =>
          l.assignedDate && (!startDate || l.assignedDate >= startDate) && (!endDate || l.assignedDate <= endDate) &&
          (ignoreLanguageFilter || language === 'All' || l.language === language) &&
          (ignoreSourceFilter || source === 'All' || l.source === source) &&
          (agentFilter === 'All' || l.owner === agentFilter)
      );
      const buckets = new Map<string, Bucket>();
      for (const l of scoped) {
        const key = keyFn(l) || 'Not Set';
        if (!buckets.has(key)) buckets.set(key, emptyBucket());
        accumulate(buckets.get(key)!, l, startDate, endDate);
      }
      return Array.from(buckets.entries()).map(([key, b]) => ({ key, ...withRates(b) }));
    }

    const byLanguage = breakdownBy((l) => l.language, true, false);
    const bySource = breakdownBy((l) => l.source, false, true);
    const byMode = breakdownBy((l) => l.preferredMode || 'Not Set', false, false);

    // Agent x Mode matrix.
    const agentModeMatrix: Record<string, Record<string, number>> = {};
    for (const name of allAgentNames) {
      agentModeMatrix[name] = {};
      for (const mode of [...PREFERRED_MODES, 'Not Set']) agentModeMatrix[name][mode] = 0;
    }
    for (const l of inScope) {
      const name = l.owner || 'Unassigned';
      if (!agentModeMatrix[name]) {
        agentModeMatrix[name] = {};
        for (const mode of [...PREFERRED_MODES, 'Not Set']) agentModeMatrix[name][mode] = 0;
      }
      const mode = l.preferredMode || 'Not Set';
      agentModeMatrix[name][mode] = (agentModeMatrix[name][mode] || 0) + 1;
    }

    // Today / Tomorrow snapshot — independent of the Start/End Date range,
    // always relative to today, but respects language/source/agent filters.
    const snapshotScope = leads.filter(
      (l) => (language === 'All' || l.language === language) && (source === 'All' || l.source === source) && (agentFilter === 'All' || l.owner === agentFilter)
    );
    const attemptsToday = snapshotScope.flatMap((l) => l.attempts.filter((a) => a.date === today));
    const qualifiedToday = snapshotScope.filter((l) => l.qualifiedAt === today).length;
    const meetingsToday = snapshotScope.filter((l) => l.meetingDate === today);
    const meetingsTodayStatus: Record<string, number> = {};
    for (const l of meetingsToday) {
      const s = l.connectingStatus || 'Pending';
      meetingsTodayStatus[s] = (meetingsTodayStatus[s] || 0) + 1;
    }
    const rescheduledToTomorrow = snapshotScope.filter((l) => l.nextMeetingDate === tomorrow || l.nextTrialDate === tomorrow).length;
    const followupsDueTomorrow = snapshotScope.filter((l) => l.nextFollowupDate === tomorrow).length;

    const languagesSet = new Set<string>();
    const sourcesSet = new Set<string>();
    for (const l of leads) {
      if (l.language) languagesSet.add(l.language);
      if (l.source) sourcesSet.add(l.source);
    }

    return NextResponse.json({
      today,
      tomorrow,
      team,
      perAgent,
      byLanguage,
      bySource,
      byMode,
      agentModeMatrix,
      snapshot: {
        attemptsToday: attemptsToday.length,
        connectedToday: attemptsToday.filter((a) => a.status === 'Connected').length,
        qualifiedToday,
        meetingsToday: meetingsToday.length,
        meetingsTodayStatus,
        rescheduledToTomorrow,
        followupsDueTomorrow,
      },
      filterOptions: {
        agents: allAgentNames,
        languages: Array.from(languagesSet).sort(),
        sources: Array.from(sourcesSet).sort(),
      },
    });
  } catch (err) {
    console.error('GET /api/dashboards/team-performance failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    return NextResponse.json({ error: `Could not load team performance: ${message}` }, { status: 500 });
  }
}
