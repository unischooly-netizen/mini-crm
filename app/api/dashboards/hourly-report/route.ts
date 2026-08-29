import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { ATTEMPT_COUNT } from '@/lib/masters';
import { todayIstDateStr, toIstDateTimeParts } from '@/lib/followup';

// Hourly Report — the digital replacement for the paper/spreadsheet hourly
// report Pre-Sales agents used to hand a manager (Dialed Call, Connected
// Calls, Meets Scheduled, Calls Scheduled, Followup), broken down by the
// hour of day it happened in, for one selected date, across every agent at
// once. Every number here is computed from the same fields the rest of the
// app already trusts — nothing new is invented, and the two figures that
// genuinely have no reliable historical source before this feature shipped
// (Meets/Calls Scheduled going forward use meeting_booked_at/trial_booked_at
// — see app/api/init/route.ts's "Stage 5" comment) are simply absent for
// any hour before that column existed, same rule as every other
// first-transition timestamp in this schema.
//
// "Meets Scheduled" vs "Calls Scheduled": both are Qualified leads, split
// by the lead's stated Preferred Mode — Teams Meet / Google Meet count as
// a Meet, Phone Call / Whatsapp call count as a Call (confirmed against
// the live team's own usage of the old sheet, not assumed).
//
// Dialed / Connected are read straight from each attempt slot's own
// date+time (already exact, per the Aug 2026 metric-truth audit — see
// Section G of that report for the one caveat: correcting an attempt's
// status after the fact silently re-stamps its date/time too).

const MEET_MODES = new Set(['Teams Meet', 'Google Meet']);
const CALL_MODES = new Set(['Phone Call', 'Whatsapp call']);

type HourBucket = {
  dialed: number;
  connected: number;
  uniqueTouched: number;
  qualified: number;
  meetsScheduled: number;
  callsScheduled: number;
};

function emptyHourBucket(): HourBucket {
  return { dialed: 0, connected: 0, uniqueTouched: 0, qualified: 0, meetsScheduled: 0, callsScheduled: 0 };
}

function emptyHours(): Record<string, HourBucket> {
  const out: Record<string, HourBucket> = {};
  for (let h = 0; h < 24; h++) out[String(h)] = emptyHourBucket();
  return out;
}

// Simple, transparent scoring for the leaderboard/race — shown in the UI
// alongside its formula so it's never a black box. Weighted toward the
// outcomes that matter more (a Qualified lead is worth more than a dial),
// not just raw call volume.
const SCORE_WEIGHTS = { dialed: 1, connected: 2, qualified: 5, scheduled: 3 };

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });

  try {
    const params = request.nextUrl.searchParams;
    const date = params.get('date') || todayIstDateStr();
    const agentFilter = params.get('agent') || 'All';

    const attemptCols = Array.from({ length: ATTEMPT_COUNT }, (_, i) => {
      const n = i + 1;
      return `l.attempt${n}_status AS "a${n}s", l.attempt${n}_date AS "a${n}d", l.attempt${n}_time AS "a${n}t"`;
    }).join(', ');

    const rows = await sql.query(
      `SELECT l.lead_code AS "leadCode", l.owner_user_id AS "ownerUserId", u.name AS "ownerName",
              l.preferred_mode AS "preferredMode", l.qualification_status AS "qualificationStatus",
              l.qualified_at AS "qualifiedAt", l.next_followup_date AS "nextFollowupDate",
              ${attemptCols}
       FROM leads l
       JOIN users u ON u.id = l.owner_user_id
       WHERE u.role = 'presales_agent'`
    );

    // Every active Pre-Sales agent shows up even with zero activity today —
    // matches the "always show every agent" convention used by Team
    // Performance's perAgent table.
    const agentsResult = await sql`SELECT id, name FROM users WHERE role = 'presales_agent' ORDER BY name`;
    const allAgents = (agentsResult as { id: number; name: string }[]).map((r) => ({ userId: r.id, name: r.name }));

    type AgentAgg = {
      userId: number;
      name: string;
      hourly: Record<string, HourBucket>;
      followupsPendingToday: number;
      touchedLeadsByHour: Record<string, Set<string>>;
    };

    const byAgent = new Map<number, AgentAgg>();
    for (const a of allAgents) {
      byAgent.set(a.userId, { userId: a.userId, name: a.name, hourly: emptyHours(), followupsPendingToday: 0, touchedLeadsByHour: {} });
    }

    const today = todayIstDateStr();

    for (const row of rows as Record<string, unknown>[]) {
      const ownerUserId = row.ownerUserId as number | null;
      if (!ownerUserId || !byAgent.has(ownerUserId)) continue;
      const agg = byAgent.get(ownerUserId)!;

      // Follow-ups pending today — a current snapshot (no hour attached;
      // this field has no history at all, see the metric-truth audit).
      const nextFollowupDate = row.nextFollowupDate ? String(row.nextFollowupDate).slice(0, 10) : null;
      if (nextFollowupDate === today) agg.followupsPendingToday += 1;

      // Dialed / Connected, per attempt slot, bucketed by the attempt's own hour.
      for (let n = 1; n <= ATTEMPT_COUNT; n++) {
        const status = row[`a${n}s`] as string | null;
        const attemptDate = row[`a${n}d`] ? String(row[`a${n}d`]).slice(0, 10) : null;
        const attemptTime = row[`a${n}t`] as string | null;
        if (!status || attemptDate !== date || !attemptTime) continue;
        const hour = String(parseInt(attemptTime.split(':')[0], 10) || 0);
        const bucket = agg.hourly[hour];
        if (!bucket) continue;
        bucket.dialed += 1;
        if (status === 'Connected') bucket.connected += 1;
        if (!agg.touchedLeadsByHour[hour]) agg.touchedLeadsByHour[hour] = new Set();
        agg.touchedLeadsByHour[hour].add(row.leadCode as string);
      }

      // Qualified this hour, split into Meets / Calls Scheduled by Preferred Mode.
      if (row.qualifiedAt && (row.qualificationStatus as string) === 'Qualified') {
        const { date: qDate, time: qTime } = toIstDateTimeParts(new Date(row.qualifiedAt as string));
        if (qDate === date) {
          const hour = String(parseInt(qTime.split(':')[0], 10) || 0);
          const bucket = agg.hourly[hour];
          if (bucket) {
            bucket.qualified += 1;
            const mode = (row.preferredMode as string) || '';
            if (MEET_MODES.has(mode)) bucket.meetsScheduled += 1;
            else if (CALL_MODES.has(mode)) bucket.callsScheduled += 1;
          }
        }
      }
    }

    for (const agg of byAgent.values()) {
      for (const hour of Object.keys(agg.hourly)) {
        agg.hourly[hour].uniqueTouched = agg.touchedLeadsByHour[hour]?.size || 0;
      }
    }

    function dayTotals(agg: AgentAgg) {
      const t = emptyHourBucket();
      for (const b of Object.values(agg.hourly)) {
        t.dialed += b.dialed;
        t.connected += b.connected;
        t.qualified += b.qualified;
        t.meetsScheduled += b.meetsScheduled;
        t.callsScheduled += b.callsScheduled;
      }
      return t;
    }

    function activityScore(t: HourBucket) {
      return (
        t.dialed * SCORE_WEIGHTS.dialed +
        t.connected * SCORE_WEIGHTS.connected +
        t.qualified * SCORE_WEIGHTS.qualified +
        (t.meetsScheduled + t.callsScheduled) * SCORE_WEIGHTS.scheduled
      );
    }

    // Full set, always — the leaderboard/race compares everyone regardless
    // of which agent is selected for the detail matrix below.
    const allAgentRows = allAgents.map((a) => {
      const agg = byAgent.get(a.userId)!;
      const totals = dayTotals(agg);
      return {
        userId: a.userId,
        name: a.name,
        hourly: agg.hourly,
        totals,
        connectionRate: totals.dialed ? totals.connected / totals.dialed : 0,
        followupsPendingToday: agg.followupsPendingToday,
        activityScore: activityScore(totals),
      };
    });

    const agentRows = agentFilter === 'All' ? allAgentRows : allAgentRows.filter((r) => r.name === agentFilter);

    const leaderboard = [...allAgentRows]
      .sort((a, b) => b.activityScore - a.activityScore)
      .map((r, i) => ({ userId: r.userId, name: r.name, activityScore: r.activityScore, totals: r.totals, rank: i + 1 }));

    const currentHour = date === today ? String(new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCHours()) : null;
    const currentHourLeaderboard = currentHour
      ? [...allAgentRows]
          .map((r) => ({ userId: r.userId, name: r.name, hourScore: activityScore(r.hourly[currentHour]), hour: r.hourly[currentHour] }))
          .sort((a, b) => b.hourScore - a.hourScore)
          .map((r, i) => ({ ...r, rank: i + 1 }))
      : [];

    return NextResponse.json({
      date,
      today,
      currentHour,
      agents: agentRows,
      leaderboard,
      currentHourLeaderboard,
      scoreWeights: SCORE_WEIGHTS,
      filterOptions: { agents: allAgents.map((a) => a.name) },
    });
  } catch (err) {
    console.error('GET /api/dashboards/hourly-report failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    return NextResponse.json({ error: `Could not load hourly report: ${message}` }, { status: 500 });
  }
}
