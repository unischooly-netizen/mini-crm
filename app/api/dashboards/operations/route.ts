import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { ATTEMPT_COUNT } from '@/lib/masters';
import { todayIstDateStr } from '@/lib/followup';

// Daily control-room view: Today/Yesterday/This Week/This Month activity
// side by side, the cumulative funnel, breakdowns, SLA timing, and an
// "Ops Watchlist" — agents ranked worst-first by untouched leads + overdue
// follow-ups, so a manager immediately sees who needs help today.

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

function firstOfMonthIst(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  return `${y}-${String(m).padStart(2, '0')}-01`;
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
  owner: string | null;
  language: string;
  source: string;
  assignedDate: string | null;
  qualificationStatus: string;
  qualifiedAt: string | null;
  vhAssignedAt: string | null;
  counsellorAssignedAt: string | null;
  connectingStatus: string | null;
  meetingDate: string | null;
  trialDate: string | null;
  trialStatus: string | null;
  admissionStatus: string | null;
  admissionTimestamp: string | null;
  assignedVhName: string | null;
  assignedCounsellorName: string | null;
  nextFollowupDate: string | null;
  attempts: { status: string | null; date: string | null }[];
};

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });

  try {
    const params = request.nextUrl.searchParams;
    const language = params.get('language') || 'All';
    const source = params.get('source') || 'All';
    const agentFilter = params.get('agent') || 'All';
    const today = todayIstDateStr();
    const yesterday = addDaysIst(today, -1);
    const weekStart = addDaysIst(today, -6);
    const monthStart = firstOfMonthIst(today);

    const attemptCols = Array.from({ length: ATTEMPT_COUNT }, (_, i) => {
      const n = i + 1;
      return `l.attempt${n}_status AS "a${n}s", l.attempt${n}_date AS "a${n}d"`;
    }).join(', ');

    const rows = await sql.query(
      `SELECT l.lead_code AS "leadCode", u.name AS "owner", l.language, l.source, l.assigned_date AS "assignedDate",
              l.qualification_status AS "qualificationStatus", l.qualified_at AS "qualifiedAt",
              l.vh_assigned_at AS "vhAssignedAt", l.counsellor_assigned_at AS "counsellorAssignedAt",
              l.connecting_status AS "connectingStatus", l.meeting_date AS "meetingDate",
              l.trial_date AS "trialDate", l.trial_status AS "trialStatus",
              l.admission_status AS "admissionStatus", l.admission_timestamp AS "admissionTimestamp",
              vh.name AS "assignedVhName", counsellor.name AS "assignedCounsellorName",
              l.next_followup_date AS "nextFollowupDate",
              ${attemptCols}
       FROM leads l
       LEFT JOIN users u ON u.id = l.owner_user_id
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
        owner: (r.owner as string) || null,
        language: (r.language as string) || '',
        source: (r.source as string) || '',
        assignedDate: toDateStr(r.assignedDate),
        qualificationStatus: (r.qualificationStatus as string) || 'Not Reviewed',
        qualifiedAt: r.qualifiedAt ? toDateStr(r.qualifiedAt) : null,
        vhAssignedAt: r.vhAssignedAt ? toDateStr(r.vhAssignedAt) : null,
        counsellorAssignedAt: r.counsellorAssignedAt ? toDateStr(r.counsellorAssignedAt) : null,
        connectingStatus: (r.connectingStatus as string) || null,
        meetingDate: toDateStr(r.meetingDate),
        trialDate: toDateStr(r.trialDate),
        trialStatus: (r.trialStatus as string) || null,
        admissionStatus: (r.admissionStatus as string) || null,
        admissionTimestamp: r.admissionTimestamp ? toDateStr(r.admissionTimestamp) : null,
        assignedVhName: (r.assignedVhName as string) || null,
        assignedCounsellorName: (r.assignedCounsellorName as string) || null,
        nextFollowupDate: toDateStr(r.nextFollowupDate),
        attempts,
      };
    });

    const filterMatch = (l: Lead) =>
      (language === 'All' || l.language === language) &&
      (source === 'All' || l.source === source) &&
      (agentFilter === 'All' || l.owner === agentFilter);
    const leads = allLeads.filter(filterMatch);

    function periodMetrics(start: string, end: string) {
      const leadsAdded = leads.filter((l) => l.assignedDate && l.assignedDate >= start && l.assignedDate <= end).length;
      const attemptsInPeriod = leads.flatMap((l) => l.attempts.filter((a) => a.date && a.date >= start && a.date <= end));
      const touchedLeadCodes = new Set(
        leads.filter((l) => l.attempts.some((a) => a.date && a.date >= start && a.date <= end)).map((l) => l.leadCode)
      );
      const connected = attemptsInPeriod.filter((a) => a.status === 'Connected').length;
      const qualified = leads.filter((l) => l.qualifiedAt && l.qualifiedAt >= start && l.qualifiedAt <= end).length;
      const followupsDue = leads.filter((l) => l.nextFollowupDate && l.nextFollowupDate >= start && l.nextFollowupDate <= end).length;
      const meetings = leads.filter((l) => l.meetingDate && l.meetingDate >= start && l.meetingDate <= end).length;
      const trials = leads.filter((l) => l.trialDate && l.trialDate >= start && l.trialDate <= end).length;
      const admissions = leads.filter(
        (l) => l.admissionStatus === 'Closed Won' && l.admissionTimestamp && l.admissionTimestamp >= start && l.admissionTimestamp <= end
      ).length;
      return {
        leadsAdded, uniqueTouched: touchedLeadCodes.size, callAttempts: attemptsInPeriod.length, connected,
        qualified, followupsDue, meetings, trials, admissions,
      };
    }

    const periods = {
      today: periodMetrics(today, today),
      yesterday: periodMetrics(yesterday, yesterday),
      thisWeek: periodMetrics(weekStart, today),
      thisMonth: periodMetrics(monthStart, today),
    };
    const overdueNow = leads.filter((l) => l.nextFollowupDate && l.nextFollowupDate < today).length;

    // ---- Cumulative funnel (all-time, respects language/source/agent filters) ----
    const assigned = leads.length;
    const touched = leads.filter((l) => l.attempts.length > 0).length;
    const connectedTotal = leads.filter((l) => l.attempts.some((a) => a.status === 'Connected')).length;
    const qualifiedTotal = leads.filter((l) => l.qualificationStatus === 'Qualified').length;
    const vhAssignedTotal = leads.filter((l) => l.qualificationStatus === 'Qualified' && l.assignedVhName).length;
    const counsellorAssignedTotal = leads.filter((l) => l.qualificationStatus === 'Qualified' && l.assignedCounsellorName).length;
    const meetingJoinedTotal = leads.filter((l) => l.connectingStatus === 'Joined').length;
    const trialDoneTotal = leads.filter((l) => l.trialStatus === 'Trial Done').length;
    const closedWonTotal = leads.filter((l) => l.admissionStatus === 'Closed Won').length;

    // ---- By language / by source (leads count) ----
    function tallyBy(keyFn: (l: Lead) => string) {
      const buckets = new Map<string, number>();
      for (const l of leads) {
        const key = keyFn(l) || 'Not Set';
        buckets.set(key, (buckets.get(key) || 0) + 1);
      }
      return Array.from(buckets.entries()).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
    }
    const byLanguage = tallyBy((l) => l.language);
    const bySource = tallyBy((l) => l.source);

    // ---- SLA ----
    const slaFor = (getA: (l: Lead) => string | null, getB: (l: Lead) => string | null) =>
      avg(leads.map((l) => daysBetween(getA(l), getB(l))).filter((d): d is number => d != null));
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

    // ---- Ops Watchlist: agents ranked worst-first (most issues) ----
    const agentBuckets = new Map<string, { assigned: number; touched: number; overdue: number; attemptsToday: number }>();
    for (const l of leads) {
      const name = l.owner || 'Unassigned';
      if (!agentBuckets.has(name)) agentBuckets.set(name, { assigned: 0, touched: 0, overdue: 0, attemptsToday: 0 });
      const b = agentBuckets.get(name)!;
      b.assigned += 1;
      if (l.attempts.length > 0) b.touched += 1;
      if (l.nextFollowupDate && l.nextFollowupDate < today) b.overdue += 1;
      b.attemptsToday += l.attempts.filter((a) => a.date === today).length;
    }
    const watchlist = Array.from(agentBuckets.entries())
      .map(([agent, b]) => ({ agent, untouched: b.assigned - b.touched, overdue: b.overdue, attemptsToday: b.attemptsToday, assigned: b.assigned }))
      .map((r) => ({ ...r, focusScore: r.untouched + r.overdue + (r.attemptsToday === 0 && r.assigned > 0 ? 3 : 0) }))
      .sort((a, b) => b.focusScore - a.focusScore);

    const languagesSet = new Set<string>();
    const sourcesSet = new Set<string>();
    const agentsSet = new Set<string>();
    for (const l of allLeads) {
      if (l.language) languagesSet.add(l.language);
      if (l.source) sourcesSet.add(l.source);
      if (l.owner) agentsSet.add(l.owner);
    }

    return NextResponse.json({
      today, periods, overdueNow,
      funnel: {
        assigned, touched, connected: connectedTotal, qualified: qualifiedTotal,
        vhAssigned: vhAssignedTotal, counsellorAssigned: counsellorAssignedTotal,
        meetingJoined: meetingJoinedTotal, trialDone: trialDoneTotal, closedWon: closedWonTotal,
      },
      byLanguage, bySource, sla, watchlist,
      filterOptions: {
        languages: Array.from(languagesSet).sort(),
        sources: Array.from(sourcesSet).sort(),
        agents: Array.from(agentsSet).sort(),
      },
    });
  } catch (err) {
    console.error('GET /api/dashboards/operations failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    return NextResponse.json({ error: `Could not load operations dashboard: ${message}` }, { status: 500 });
  }
}
