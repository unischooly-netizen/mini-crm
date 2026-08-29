// app/lib/shifu/context.ts — Phase A.1 correctness pass.
//
// A shared CANDIDATE metrics module for new Shifu logic, extracted from
// existing reporting definitions (see lib/performanceMetrics.ts for the
// full audit). Not yet a single source of truth — team-performance,
// qualified-dashboard, and ceo dashboards still contain their own
// implementations. Every function here is named to make SNAPSHOT
// ("as of now") vs PERIOD ("happened within this date range") scope
// obvious — see lib/performanceMetrics.ts's header comment for the full
// audit of why that distinction matters and which date field backs each
// period metric.

import { sql } from '@/lib/db';
import type { Role } from './role-config';
import {
  fetchAllLeadsRich,
  computeSnapshot,
  snapshotRates,
  computePeriod,
  periodRates,
  followupCounts,
  type PerfLead,
  type DateRange,
} from '@/lib/performanceMetrics';

export type { DateRange };

export function istToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export function todayRange(): DateRange {
  const d = istToday();
  return { start: d, end: d };
}

export function yesterdayRange(): DateRange {
  const now = new Date();
  now.setUTCHours(now.getUTCHours() + 5, now.getUTCMinutes() + 30); // shift to IST wall clock
  now.setUTCDate(now.getUTCDate() - 1);
  const d = now.toISOString().slice(0, 10);
  return { start: d, end: d };
}

/**
 * Phase B addition. "This week" = Monday of the current IST week through
 * today (not through Sunday) — an in-progress week reported through "now",
 * not a full Mon-Sun window that would imply data for days that haven't
 * happened yet. Monday is chosen as the week start to match the CRM's
 * existing Mon-Sat shift week (see SHIFT_DAYS in the live app/api/shifu/
 * route.ts), not a Sunday-start calendar week.
 */
export function thisWeekRange(): DateRange {
  const now = new Date();
  now.setUTCHours(now.getUTCHours() + 5, now.getUTCMinutes() + 30); // shift to IST wall clock
  const istDow = now.getUTCDay(); // 0=Sun .. 6=Sat, in IST wall-clock terms after the shift above
  const daysSinceMonday = (istDow + 6) % 7; // Mon=0, Tue=1, ... Sun=6
  const monday = new Date(now);
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  const start = monday.toISOString().slice(0, 10);
  const end = istToday();
  return { start, end };
}

// ---------------------------------------------------------------------------
// Fast single-user paths — used on every chat message, so these stay as
// lean per-user SQL rather than fetching the whole leads table. Same field
// definitions as lib/performanceMetrics.ts, just computed for one owner
// instead of reduced in JS across everyone. Phase A.1 fixes applied:
// follow-up due/overdue no longer overlap (fix #3), field names now say
// "InRange" where they mean a date-scoped period (matches the naming
// convention requested).
// ---------------------------------------------------------------------------

const ATTEMPT_IN_RANGE = (alias = '') =>
  Array.from({ length: 9 }, (_, i) => `(CASE WHEN ${alias}attempt${i + 1}_date BETWEEN $RANGE_START AND $RANGE_END THEN 1 ELSE 0 END)`).join(' + ');
const CONNECTED_ATTEMPT_IN_RANGE = (alias = '') =>
  Array.from(
    { length: 9 },
    (_, i) => `(CASE WHEN ${alias}attempt${i + 1}_status = 'Connected' AND ${alias}attempt${i + 1}_date BETWEEN $RANGE_START AND $RANGE_END THEN 1 ELSE 0 END)`
  ).join(' + ');
function withRange(sqlText: string, range: DateRange): string {
  return sqlText.replaceAll('$RANGE_START', `'${range.start}'`).replaceAll('$RANGE_END', `'${range.end}'`);
}

export type PresalesOwnMetrics = {
  callsInRange: number;
  connectedCallsInRange: number;
  uniqueConnectedLeadsInRange: number;
  qualifiedInRange: number;
  meetingsScheduledInRange: number;
  meetingsDoneInRange: number;
  currentNewLeads: number;
  currentFollowUpNeeded: number;
  currentTotalLeads: number;
  followupsDueToday: number;
  followupsOverdue: number;
};

/** Pre-Sales Agent's own numbers. Fast path — direct SQL, not the full-table shared engine. */
export async function getPresalesAgentMetrics(userId: number, range: DateRange): Promise<PresalesOwnMetrics> {
  const today = istToday();
  const sqlText = withRange(
    `SELECT
       COALESCE(SUM(${ATTEMPT_IN_RANGE()}), 0)::int AS calls_in_range,
       COALESCE(SUM(${CONNECTED_ATTEMPT_IN_RANGE()}), 0)::int AS connected_calls_in_range,
       COUNT(*) FILTER (WHERE ${Array.from({ length: 9 }, (_, i) => `(attempt${i + 1}_status = 'Connected' AND attempt${i + 1}_date BETWEEN $RANGE_START AND $RANGE_END)`).join(' OR ')}) AS unique_connected_leads_in_range,
       COUNT(*) FILTER (WHERE (qualified_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $RANGE_START AND $RANGE_END) AS qualified_in_range,
       COUNT(*) FILTER (WHERE meeting_date BETWEEN $RANGE_START AND $RANGE_END) AS meetings_scheduled_in_range,
       COUNT(*) FILTER (WHERE meeting_date BETWEEN $RANGE_START AND $RANGE_END AND connecting_status = 'Joined') AS meetings_done_in_range,
       COUNT(*) FILTER (WHERE status = 'New') AS current_new_leads,
       COUNT(*) FILTER (WHERE status = 'Follow-up Needed') AS current_follow_up_needed,
       -- Phase A.2 fix: app/api/dashboards/today-followup/route.ts (the real,
       -- existing "Today's Follow-up" dashboard) applies NO status exclusion
       -- at all -- it is a pure next_followup_date = today filter. The
       -- earlier status exclusion clause here was invented, not matched to
       -- real CRM behavior, so it has been removed to make this figure
       -- agree exactly with what the dashboard shows.
       COUNT(*) FILTER (WHERE next_followup_date = '${today}') AS followups_due_today,
       COUNT(*) FILTER (WHERE next_followup_date < '${today}') AS followups_overdue,
       COUNT(*) AS current_total_leads
     FROM leads WHERE owner_user_id = $1`,
    range
  );
  const rows = (await sql.query(sqlText, [userId])) as Record<string, number>[];
  const r = rows[0];
  return {
    callsInRange: Number(r.calls_in_range) || 0,
    connectedCallsInRange: Number(r.connected_calls_in_range) || 0,
    uniqueConnectedLeadsInRange: Number(r.unique_connected_leads_in_range) || 0,
    qualifiedInRange: Number(r.qualified_in_range) || 0,
    meetingsScheduledInRange: Number(r.meetings_scheduled_in_range) || 0,
    meetingsDoneInRange: Number(r.meetings_done_in_range) || 0,
    currentNewLeads: Number(r.current_new_leads) || 0,
    currentFollowUpNeeded: Number(r.current_follow_up_needed) || 0,
    currentTotalLeads: Number(r.current_total_leads) || 0,
    followupsDueToday: Number(r.followups_due_today) || 0,
    followupsOverdue: Number(r.followups_overdue) || 0,
  };
}

export type VerticalHeadOwnMetrics = {
  currentPendingAssignment: number;
  assignedInRange: number;
  currentTotalAssigned: number;
  oldestWaitingLeadCode: string | null;
  oldestWaitingSince: string | null;
};

/** Vertical Head's own numbers — a snapshot (pending queue) plus one period figure (assigned this range). */
export async function getVerticalHeadMetrics(userId: number, range: DateRange): Promise<VerticalHeadOwnMetrics> {
  const sqlText = withRange(
    `SELECT
       COUNT(*) FILTER (WHERE assigned_counsellor_user_id IS NULL) AS current_pending_assignment,
       COUNT(*) FILTER (WHERE (counsellor_assigned_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $RANGE_START AND $RANGE_END) AS assigned_in_range,
       COUNT(*) AS current_total_assigned
     FROM leads WHERE assigned_vh_user_id = $1`,
    range
  );
  const rows = (await sql.query(sqlText, [userId])) as Record<string, number>[];
  const r = rows[0];

  const oldestRows = (await sql.query(
    `SELECT lead_code, qualified_at FROM leads
     WHERE assigned_vh_user_id = $1 AND assigned_counsellor_user_id IS NULL
     ORDER BY qualified_at ASC NULLS LAST LIMIT 1`,
    [userId]
  )) as { lead_code: string; qualified_at: string | null }[];
  const oldest = oldestRows[0];

  return {
    currentPendingAssignment: Number(r.current_pending_assignment) || 0,
    assignedInRange: Number(r.assigned_in_range) || 0,
    currentTotalAssigned: Number(r.current_total_assigned) || 0,
    oldestWaitingLeadCode: oldest?.lead_code || null,
    oldestWaitingSince: oldest?.qualified_at || null,
  };
}

export type CounsellorOwnMetrics = {
  meetingsScheduledInRange: number;
  meetingsDoneInRange: number;
  currentMeetingNotJoined: number;
  trialsScheduledInRange: number;
  trialsDoneInRange: number;
  admissionsWonInRange: number;
  admissionsLostInRange: number;
  followupsDueToday: number;
  followupsOverdue: number;
  currentTotalLeads: number;
};

/** Sales Counsellor's own numbers. Fast path — direct SQL. */
export async function getCounsellorMetrics(userId: number, range: DateRange): Promise<CounsellorOwnMetrics> {
  const today = istToday();
  const sqlText = withRange(
    `SELECT
       COUNT(*) FILTER (WHERE meeting_date BETWEEN $RANGE_START AND $RANGE_END) AS meetings_scheduled_in_range,
       COUNT(*) FILTER (WHERE meeting_date BETWEEN $RANGE_START AND $RANGE_END AND connecting_status = 'Joined') AS meetings_done_in_range,
       COUNT(*) FILTER (WHERE connecting_status = 'Not Joined') AS current_meeting_not_joined,
       COUNT(*) FILTER (WHERE trial_date BETWEEN $RANGE_START AND $RANGE_END) AS trials_scheduled_in_range,
       COUNT(*) FILTER (WHERE trial_date BETWEEN $RANGE_START AND $RANGE_END AND trial_status = 'Trial Done') AS trials_done_in_range,
       COUNT(*) FILTER (WHERE admission_status = 'Closed Won' AND (admission_timestamp AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $RANGE_START AND $RANGE_END) AS admissions_won_in_range,
       COUNT(*) FILTER (WHERE admission_status = 'Closed Lost' AND (admission_timestamp AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $RANGE_START AND $RANGE_END) AS admissions_lost_in_range,
       -- Phase A.2 fix: same finding as getPresalesAgentMetrics above — the
       -- real today-followup dashboard applies no admission_status
       -- exclusion either. Removed to match exactly.
       COUNT(*) FILTER (WHERE next_followup_date = '${today}') AS followups_due_today,
       COUNT(*) FILTER (WHERE next_followup_date < '${today}') AS followups_overdue,
       COUNT(*) AS current_total_leads
     FROM leads WHERE assigned_counsellor_user_id = $1`,
    range
  );
  const rows = (await sql.query(sqlText, [userId])) as Record<string, number>[];
  const r = rows[0];
  return {
    meetingsScheduledInRange: Number(r.meetings_scheduled_in_range) || 0,
    meetingsDoneInRange: Number(r.meetings_done_in_range) || 0,
    currentMeetingNotJoined: Number(r.current_meeting_not_joined) || 0,
    trialsScheduledInRange: Number(r.trials_scheduled_in_range) || 0,
    trialsDoneInRange: Number(r.trials_done_in_range) || 0,
    admissionsWonInRange: Number(r.admissions_won_in_range) || 0,
    admissionsLostInRange: Number(r.admissions_lost_in_range) || 0,
    followupsDueToday: Number(r.followups_due_today) || 0,
    followupsOverdue: Number(r.followups_overdue) || 0,
    currentTotalLeads: Number(r.current_total_leads) || 0,
  };
}

// ---------------------------------------------------------------------------
// Admin — org-wide, per-role breakdowns, and person lookup. Built on the
// shared snapshot/period engine in lib/performanceMetrics.ts. Phase A.1
// fix #4: VH/Counsellor person-scoping now filters by assignedVhUserId /
// assignedCounsellorUserId (real foreign keys), not by matching name
// strings — no same-name collision risk in this layer anymore.
// ---------------------------------------------------------------------------

export type AdminView = { snapshot: ReturnType<typeof snapshotRates>; period: ReturnType<typeof periodRates> };

function combine(leads: PerfLead[], range: DateRange): AdminView {
  return { snapshot: snapshotRates(computeSnapshot(leads)), period: periodRates(computePeriod(leads, range)) };
}

/** Org-wide — same underlying numbers as the CEO dashboard's kpis, split honestly into snapshot vs period. */
export async function getOrgSummary(range: DateRange): Promise<AdminView> {
  return combine(await fetchAllLeadsRich(), range);
}

export type NamedBreakdownRow = { name: string; userId: number | null } & AdminView;

/**
 * Phase A.2 fix #1 (user-flagged): this used to key the grouping Map by
 * `k.name` (a display string), so two users who happen to share an exact
 * name would have had their leads silently merged into one row — even
 * though the caller already has the real numeric user ID available. Now
 * keyed by ID first: `user:<id>` when an ID exists, so same-name users are
 * always kept separate. Only falls back to a name-based key (`name:<name>`)
 * when a lead genuinely has no resolvable owner/VH/counsellor user ID —
 * this can legitimately happen for older rows imported before the
 * assigned_*_user_id columns existed, and is a display-only fallback
 * bucket, not a real per-person breakdown row.
 */
function groupAndCombine(leads: PerfLead[], range: DateRange, keyFn: (l: PerfLead) => { name: string; id: number | null } | null): NamedBreakdownRow[] {
  const buckets = new Map<string, { name: string; id: number | null; leads: PerfLead[] }>();
  for (const l of leads) {
    const k = keyFn(l);
    if (!k) continue;
    const bucketKey = k.id != null ? `user:${k.id}` : `name:${k.name}`;
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, { name: k.name, id: k.id, leads: [] });
    buckets.get(bucketKey)!.leads.push(l);
  }
  return Array.from(buckets.values()).map(({ name, id, leads: group }) => ({ name, userId: id, ...combine(group, range) }));
}

/** Per-agent breakdown for all Pre-Sales Agents — admin only. */
export async function getPresalesBreakdown(range: DateRange): Promise<NamedBreakdownRow[]> {
  const leads = await fetchAllLeadsRich();
  return groupAndCombine(leads, range, (l) => (l.owner ? { name: l.owner, id: l.ownerUserId } : null)).sort(
    (a, b) => b.period.callsInRange - a.period.callsInRange
  );
}

/** Per-VH breakdown — admin only. Scoped to qualified leads (VH only touches those), matches qualified-dashboard's byVh scoping. */
export async function getVhBreakdown(range: DateRange): Promise<NamedBreakdownRow[]> {
  const leads = (await fetchAllLeadsRich()).filter((l) => l.qualificationStatus === 'Qualified');
  return groupAndCombine(leads, range, (l) => (l.assignedVhName ? { name: l.assignedVhName, id: l.assignedVhUserId } : null)).sort(
    (a, b) => b.snapshot.currentQualified - a.snapshot.currentQualified
  );
}

/** Per-counsellor breakdown — admin only. */
export async function getCounsellorBreakdown(range: DateRange): Promise<NamedBreakdownRow[]> {
  const leads = (await fetchAllLeadsRich()).filter((l) => l.qualificationStatus === 'Qualified');
  return groupAndCombine(leads, range, (l) => (l.assignedCounsellorName ? { name: l.assignedCounsellorName, id: l.assignedCounsellorUserId } : null)).sort(
    (a, b) => b.snapshot.currentQualified - a.snapshot.currentQualified
  );
}

/** Resolve a typed name to user(s) — used for admin PERSON_PERFORMANCE / TEAM_COMPARISON lookups. */
export async function resolveUserByName(query: string): Promise<{ id: number; name: string; role: Role }[]> {
  const rows = (await sql.query(
    `SELECT id, name, role FROM users WHERE LOWER(name) LIKE LOWER($1) ORDER BY name LIMIT 5`,
    [`%${query}%`]
  )) as { id: number; name: string; role: Role }[];
  return rows;
}

/**
 * Look up one person's metrics by user id — scoped by their real user ID
 * (owner_user_id / assigned_vh_user_id / assigned_counsellor_user_id), not
 * by name string. This is what actually fixes the "how is Swati doing" bug.
 */
// Phase B.1 addition (item 6, performance): an optional pre-fetched lead
// set. When the caller already needs fetchAllLeadsRich() for more than one
// person in the same request (e.g. Shifu's TEAM_COMPARISON, which looks up
// two people), passing it in here avoids a second full-table fetch. Purely
// additive and backward-compatible — every existing caller that omits this
// argument gets the exact same behavior as before (fetches internally),
// so this does not change getPersonMetrics's validated Phase A behavior.
export async function getPersonMetrics(
  targetUserId: number,
  range: DateRange,
  preloadedLeads?: PerfLead[]
): Promise<{ role: Role; name: string; view: AdminView | null }> {
  const userRows = (await sql.query(`SELECT id, name, role FROM users WHERE id = $1`, [targetUserId])) as { id: number; name: string; role: Role }[];
  const user = userRows[0];
  if (!user) return { role: 'presales_agent', name: 'Unknown', view: null };

  const leads = preloadedLeads ?? (await fetchAllLeadsRich());
  let scoped: PerfLead[];
  if (user.role === 'presales_agent') scoped = leads.filter((l) => l.ownerUserId === user.id);
  else if (user.role === 'vertical_head') scoped = leads.filter((l) => l.assignedVhUserId === user.id && l.qualificationStatus === 'Qualified');
  else if (user.role === 'sales_counsellor') scoped = leads.filter((l) => l.assignedCounsellorUserId === user.id && l.qualificationStatus === 'Qualified');
  else return { role: user.role, name: user.name, view: null }; // admin/data_team have no individual "leads owned" concept

  return { role: user.role, name: user.name, view: combine(scoped, range) };
}

// ---------------------------------------------------------------------------
// Attention items — specific leads by ID needing action. Follow-up counts
// now use the corrected mutually-exclusive due/overdue definitions.
//
// Phase A.2 note: this function applies its own exclusion rules below,
// INTENTIONALLY different from the raw followups_due_today/
// followups_overdue figures elsewhere in this file (those were fixed to
// match today-followup/route.ts's zero-exclusion behavior exactly).
// "Attention items" has no existing dashboard equivalent to mirror — it's
// a new Shifu-only concept meant to answer "what actually needs a human
// decision right now," so it is allowed to filter out leads whose workflow
// is already finished. This is a deliberate product judgment call, not an
// inconsistency, but the exclusion rules below must use the actual
// authoritative field for each concept, not a guess:
//
//   - "Not Qualified" exclusion (Pre-Sales/Admin): uses
//     qualification_status = 'Not Qualified', not status <> 'Not
//     Qualified'. Audited lib/leadLogic.ts: `status` (pipeline_status) is
//     DERIVED from qualification_status via computePipelineStatus(), which
//     returns 'New' whenever totalAttempts === 0 — REGARDLESS of what
//     qualification_status already is. So a lead whose finalOutcome/
//     qualification_status was already set to 'Not Qualified' (e.g. via
//     historical import, with no attempts logged in this app) would show
//     status = 'New', not 'Not Qualified' — meaning a `status <> 'Not
//     Qualified'` filter would have silently kept surfacing it as
//     actionable when it is genuinely already closed out.
//     qualification_status is the authoritative field; status is a
//     display/filter overlay on top of it. Fixed to filter on
//     qualification_status directly.
//   - Admission-closed exclusion (Sales Counsellor overdue follow-ups):
//     added `admission_status NOT IN ('Closed Won', 'Closed Lost')` — an
//     overdue follow-up on a lead whose admission is already decided is
//     not actionable, there is nothing left to follow up on. This wasn't
//     excluded here before (it only lived in the now-fixed
//     getCounsellorMetrics raw-count query, which was the wrong place for
//     it since that function mirrors the dashboard and should have zero
//     exclusion).
// ---------------------------------------------------------------------------

const ATTENTION_LIMIT = 5;

export async function getAttentionItems(role: Role, userId: number): Promise<string[]> {
  const today = istToday();
  if (role === 'presales_agent') {
    const rows = (await sql.query(
      `(SELECT lead_code AS code, 'follow-up overdue since ' || next_followup_date::text AS why
        FROM leads WHERE owner_user_id = $1 AND next_followup_date < $2 AND qualification_status <> 'Not Qualified'
        ORDER BY next_followup_date ASC LIMIT ${ATTENTION_LIMIT})
       UNION ALL
       (SELECT lead_code AS code, 'qualified but no meeting booked yet' AS why
        FROM leads WHERE owner_user_id = $1 AND qualification_status = 'Qualified' AND meeting_date IS NULL
        LIMIT ${ATTENTION_LIMIT})`,
      [userId, today]
    )) as { code: string; why: string }[];
    return rows.map((r) => `${r.code}: ${r.why}`);
  }
  if (role === 'vertical_head') {
    const rows = (await sql.query(
      `SELECT lead_code AS code FROM leads
       WHERE assigned_vh_user_id = $1 AND assigned_counsellor_user_id IS NULL
       ORDER BY qualified_at ASC NULLS LAST LIMIT ${ATTENTION_LIMIT}`,
      [userId]
    )) as { code: string }[];
    return rows.map((r) => `${r.code}: qualified, still waiting on a counsellor assignment`);
  }
  if (role === 'sales_counsellor') {
    const rows = (await sql.query(
      `(SELECT lead_code AS code, 'follow-up overdue since ' || next_followup_date::text AS why
        FROM leads WHERE assigned_counsellor_user_id = $1 AND next_followup_date < $2
        AND admission_status NOT IN ('Closed Won', 'Closed Lost')
        ORDER BY next_followup_date ASC LIMIT ${ATTENTION_LIMIT})
       UNION ALL
       (SELECT lead_code AS code, 'meeting was rescheduled but no new date/time set yet' AS why
        FROM leads WHERE assigned_counsellor_user_id = $1 AND connecting_status = 'Rescheduled' AND next_meeting_date IS NULL
        LIMIT ${ATTENTION_LIMIT})
       UNION ALL
       (SELECT lead_code AS code, 'trial was rescheduled but no new date/time set yet' AS why
        FROM leads WHERE assigned_counsellor_user_id = $1 AND trial_status = 'Rescheduled' AND next_trial_date IS NULL
        LIMIT ${ATTENTION_LIMIT})
       UNION ALL
       (SELECT lead_code AS code, 'trial is done but admission decision is still pending' AS why
        FROM leads WHERE assigned_counsellor_user_id = $1 AND trial_status = 'Trial Done' AND admission_status = 'Pending'
        LIMIT ${ATTENTION_LIMIT})`,
      [userId, today]
    )) as { code: string; why: string }[];
    return rows.map((r) => `${r.code}: ${r.why}`);
  }
  if (role === 'admin') {
    const rows = (await sql.query(
      `SELECT l.lead_code AS code, u.name AS owner, l.next_followup_date::text AS due
       FROM leads l LEFT JOIN users u ON u.id = l.owner_user_id
       WHERE l.next_followup_date < $1 AND l.qualification_status <> 'Not Qualified'
       ORDER BY l.next_followup_date ASC LIMIT ${ATTENTION_LIMIT}`,
      [today]
    )) as { code: string; owner: string | null; due: string }[];
    return rows.map((r) => `${r.code} (${r.owner || 'unassigned'}): follow-up overdue since ${r.due}`);
  }
  return []; // data_team — deliberately no attention items yet, per the minimal-role rule
}

export { followupCounts };
