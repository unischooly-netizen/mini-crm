import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { ATTEMPT_COUNT, ATTEMPT_STATUSES } from '@/lib/masters';
import { todayIstDateStr } from '@/lib/followup';

// Flattens each lead's 9 attempt slots into individual call-log rows (our
// schema stores attempts inline on the lead rather than in a separate call
// log table), then applies the filter panel and computes the KPI row.
// Available to every logged-in role — this is a reporting view, not an
// editing surface, so there's no owner-scoping at the query level; the
// Pre-Sales Agent's own name is just pre-selected as the default filter
// value on the client.

type CallLogEntry = {
  leadCode: string;
  leadName: string;
  mobile: string;
  owner: string;
  attemptDate: string;
  attemptTime: string;
  callStatus: string;
  attemptNo: number;
  language: string;
  source: string;
};

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
    const startDate = params.get('startDate') || '';
    const endDate = params.get('endDate') || '';
    const agent = params.get('agent') || 'All';
    const language = params.get('language') || 'All';
    const source = params.get('source') || 'All';
    const callStatus = params.get('callStatus') || 'All';
    const attemptNoFilter = params.get('attemptNo') || 'All';

    const attemptCols = Array.from({ length: ATTEMPT_COUNT }, (_, i) => {
      const n = i + 1;
      return `l.attempt${n}_status AS "a${n}s", l.attempt${n}_date AS "a${n}d", l.attempt${n}_time AS "a${n}t"`;
    }).join(', ');

    const rows = await sql.query(
      `SELECT l.lead_code AS "leadCode", l.name AS "leadName", l.mobile, l.language, l.source,
              u.name AS "owner", ${attemptCols}
       FROM leads l
       LEFT JOIN users u ON u.id = l.owner_user_id`
    );

    const entries: CallLogEntry[] = [];
    for (const row of rows as Record<string, unknown>[]) {
      for (let n = 1; n <= ATTEMPT_COUNT; n++) {
        const status = row[`a${n}s`] as string | null;
        const date = toDateStr(row[`a${n}d`]);
        if (!status || !date) continue;
        entries.push({
          leadCode: row.leadCode as string,
          leadName: (row.leadName as string) || '',
          mobile: (row.mobile as string) || '',
          owner: (row.owner as string) || 'Unassigned',
          attemptDate: date,
          attemptTime: (row[`a${n}t`] as string) || '',
          callStatus: status,
          attemptNo: n,
          language: (row.language as string) || '',
          source: (row.source as string) || '',
        });
      }
    }

    const today = todayIstDateStr();

    // "Calls Logged Today" ignores the date-range filter by design (it's
    // always relative to today), but respects the other filters.
    const matchesNonDateFilters = (e: CallLogEntry) =>
      (agent === 'All' || e.owner === agent) &&
      (language === 'All' || e.language === language) &&
      (source === 'All' || e.source === source) &&
      (callStatus === 'All' || e.callStatus === callStatus) &&
      (attemptNoFilter === 'All' || String(e.attemptNo) === attemptNoFilter);

    const callsLoggedToday = entries.filter((e) => e.attemptDate === today && matchesNonDateFilters(e)).length;

    const inDateRange = (e: CallLogEntry) =>
      (!startDate || e.attemptDate >= startDate) && (!endDate || e.attemptDate <= endDate);

    const filtered = entries.filter((e) => inDateRange(e) && matchesNonDateFilters(e));

    const totalAttempts = filtered.length;
    const connectedCalls = filtered.filter((e) => e.callStatus === 'Connected').length;
    const notConnected = totalAttempts - connectedCalls;
    const connectionRate = totalAttempts ? connectedCalls / totalAttempts : 0;
    const avgAttemptNo = totalAttempts ? filtered.reduce((s, e) => s + e.attemptNo, 0) / totalAttempts : 0;

    const uniqueLeads = new Set(filtered.map((e) => e.leadCode));
    const uniqueLeadsTouched = uniqueLeads.size;
    const avgAttemptsPerLead = uniqueLeadsTouched ? totalAttempts / uniqueLeadsTouched : 0;

    const firstAttempts = filtered.filter((e) => e.attemptNo === 1);
    const firstAttemptConnectRate = firstAttempts.length
      ? firstAttempts.filter((e) => e.callStatus === 'Connected').length / firstAttempts.length
      : 0;
    const repeatAttemptsPercent = totalAttempts ? (totalAttempts - firstAttempts.length) / totalAttempts : 0;

    filtered.sort((a, b) => (a.attemptDate + a.attemptTime < b.attemptDate + b.attemptTime ? 1 : -1));

    // Full-set breakdowns for the charts (not capped to the 1000-row table preview).
    const callStatusBreakdown: Record<string, number> = {};
    const ownerBreakdown: Record<string, number> = {};
    for (const e of filtered) {
      callStatusBreakdown[e.callStatus] = (callStatusBreakdown[e.callStatus] || 0) + 1;
      ownerBreakdown[e.owner] = (ownerBreakdown[e.owner] || 0) + 1;
    }

    const agentsSet = new Set<string>();
    const languagesSet = new Set<string>();
    const sourcesSet = new Set<string>();
    for (const e of entries) {
      if (e.owner) agentsSet.add(e.owner);
      if (e.language) languagesSet.add(e.language);
      if (e.source) sourcesSet.add(e.source);
    }

    return NextResponse.json({
      kpis: {
        totalAttempts,
        connectedCalls,
        connectionRate,
        notConnected,
        avgAttemptNo,
        uniqueLeadsTouched,
        avgAttemptsPerLead,
        firstAttemptConnectRate,
        repeatAttemptsPercent,
        callsLoggedToday,
      },
      rows: filtered.slice(0, 1000),
      totalRows: filtered.length,
      callStatusBreakdown,
      ownerBreakdown,
      filterOptions: {
        agents: Array.from(agentsSet).sort(),
        languages: Array.from(languagesSet).sort(),
        sources: Array.from(sourcesSet).sort(),
        callStatuses: ATTEMPT_STATUSES,
        attemptNumbers: Array.from({ length: ATTEMPT_COUNT }, (_, i) => i + 1),
      },
    });
  } catch (err) {
    console.error('GET /api/dashboards/call-log failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    return NextResponse.json({ error: `Could not load call log: ${message}` }, { status: 500 });
  }
}
