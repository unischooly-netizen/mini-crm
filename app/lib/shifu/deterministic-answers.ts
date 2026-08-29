// app/lib/shifu/deterministic-answers.ts — Phase B.
//
// The heart of "DATABASE/CRM CODE DETERMINES FACTS, AI EXPLAINS": every
// function here takes a session + resolved range/entities, calls the
// already-approved Phase A context.ts functions (no new metric
// definitions are invented here — this file only formats what those
// functions already return), and produces BOTH a structured `facts`
// object (fed into the Gemini prompt as the labeled "verified" block) and
// a plain-English `text` sentence that is a correct, complete answer on
// its own, with no Gemini involvement required. See gemini-client.ts /
// numeric-guard.ts for what happens to `text` after this — as of Phase
// B.1, that answer is what the user sees, unmodified, for every
// 'verified_crm' result (see numeric-guard.ts's shouldCallGeminiForRewrite
// for why Gemini no longer rewrites numeric operational answers at all).
//
// Phase B.1 additions in this file: a rangeMismatchNote() guard so
// snapshot-only intents (follow-ups, attention items, next-action,
// pipeline status, the VH aggregate) give an honest "I don't have
// historical reporting for that" instead of silently answering a
// yesterday/this-week question with right-now data; a real bug fix in the
// VH aggregate (was summing currentPendingVh, always 0 for a per-VH-scoped
// row, now sums currentPendingCounsellor); a new teamAttention() function
// for admin's "who needs attention?"; and TEAM_COMPARISON now fetches the
// leads table once and reuses it for both people instead of twice.

import type { Role } from './role-config';
import type { ShifuSession } from './permissions';
import { canViewPerson, canViewTeamMetrics, canResolveOtherUsers, isMinimalRole } from './permissions';
import type { RangeLabel } from './range-parser';
import { rangeLabelToWords } from './range-parser';
import {
  istToday,
  todayRange,
  yesterdayRange,
  thisWeekRange,
  getPresalesAgentMetrics,
  getVerticalHeadMetrics,
  getCounsellorMetrics,
  getOrgSummary,
  getPresalesBreakdown,
  getVhBreakdown,
  getCounsellorBreakdown,
  resolveUserByName,
  getPersonMetrics,
  getAttentionItems,
  getLatestQualification,
  getDailyQualificationBreakdown,
  type DateRange,
  type AdminView,
  type LatestQualification,
  type QualificationOwnerRow,
} from './context';
import { presalesNextAction, vhNextAction, counsellorNextAction, adminNextAction } from './next-action-rules';
import { getCallsLeaderboard, getOverdueLeaderboard } from './leaderboards';
import type { Intent, Entities } from './intent-router';
import { fetchAllLeadsRich } from '@/lib/performanceMetrics';

export type DeterministicSource = 'verified_crm' | 'permission_denied' | 'not_found' | 'ambiguous' | 'unsupported' | 'no_gemini_needed';

export type PresalesAgentBreakdownRow = { userId: number | null; name: string; calls: number; qualified: number };

export type DeterministicResult = {
  text: string;
  facts: Record<string, unknown> | null;
  source: DeterministicSource;
  subject?: { type: 'self' | 'user' | 'role' | 'org'; id?: number; name?: string; role?: string };
  leadCode?: string;
  candidates?: { id: number; name: string; role: Role }[];
  // Phase B.2 addition — only populated by presalesAgentBreakdown(), so
  // every other intent's result leaves these undefined.
  rows?: PresalesAgentBreakdownRow[] | QualificationOwnerRow[];
  totals?: { calls: number; qualified: number };
  // Phase B.3 additions — only populated by their respective functions.
  latestQualification?: LatestQualification;
  totalQualified?: number;
};

export function resolveRange(label: RangeLabel, explicitDate?: string): DateRange {
  if (label === 'yesterday') return yesterdayRange();
  if (label === 'this_week') return thisWeekRange();
  // Phase B.2: an explicit calendar date is its own single-day range.
  // Falls through to todayRange() if explicitDate is somehow missing —
  // should never happen in practice since chat-handler only sets
  // rangeLabel to 'explicit_date' when it also has a resolved date string.
  if (label === 'explicit_date' && explicitDate) return { start: explicitDate, end: explicitDate };
  return todayRange();
}

const ROLE_LABEL_SHORT: Record<Role, string> = {
  admin: 'Admin',
  presales_agent: 'Pre-Sales',
  vertical_head: 'Vertical Head',
  sales_counsellor: 'Sales Counsellor',
  data_team: 'Data Team',
};

function unsupportedForRole(role: Role, metricLabel: string): DeterministicResult {
  return {
    text: `As ${ROLE_LABEL_SHORT[role]} you don't have personal ${metricLabel} data — try asking about a specific person, a role, or the whole team instead.`,
    facts: null,
    source: 'unsupported',
  };
}

function minimalRoleAnswer(): DeterministicResult {
  return {
    text: "I don't have personal CRM metrics to show for the Data Team role yet — that's kept deliberately minimal for now.",
    facts: null,
    source: 'unsupported',
  };
}

function permissionDenied(reason?: string): DeterministicResult {
  return {
    text: reason || "I can't show that information for your role.",
    facts: null,
    source: 'permission_denied',
  };
}

/**
 * Phase B.1 addition (user-flagged item 5): several intents are only ever
 * answerable "as of right now" — the schema gives us action-state
 * follow-up information and current queue snapshots, not a historical
 * log of what those looked like on a past date. Before Phase B.1, a
 * message like "how many follow-ups yesterday?" silently ignored the
 * parsed range and answered with today's/current figures — a genuinely
 * wrong answer dressed up as a real one. This helper is called at the top
 * of every snapshot-only formatter; when it returns non-null, the caller
 * returns this honest capability note instead of fetching or stating any
 * number, so there's nothing for a mismatched range to mislead about.
 */
export function rangeMismatchNote(rangeLabel: RangeLabel, capabilityDescription: string): DeterministicResult | null {
  if (rangeLabel === 'today') return null;
  return {
    text: `I can show ${capabilityDescription}, but I don't have historical reporting for ${rangeLabelToWords(rangeLabel)} yet.`,
    facts: null,
    source: 'unsupported',
  };
}

/**
 * Phase B.1 regression guard (user-flagged item 1). Exported and unit-
 * tested directly (see phase-b1-units.test.ts) with fake rows carrying a
 * deliberately-wrong nonzero currentPendingVh, to prove this function
 * only ever reads currentPendingCounsellor. Per-VH breakdown rows (from
 * getVhBreakdown) are already scoped to leads assigned to that specific
 * VH, so currentPendingVh — which means "no VH assigned to this lead at
 * all" — is mathematically always 0 for every such row. The real signal
 * for "how many qualified leads is this VH's queue still waiting to hand
 * to a counsellor" is currentPendingCounsellor.
 */
export function vhAggregatePending(rows: { snapshot: { currentPendingVh: number; currentPendingCounsellor: number } }[]): number {
  return rows.reduce((s, r) => s + r.snapshot.currentPendingCounsellor, 0);
}

// ---------------------------------------------------------------------------
// Own-metric intents (MY_*) — role-dispatched.
// ---------------------------------------------------------------------------

async function ownCalls(session: ShifuSession, range: DateRange, rangeWords: string, connectedOnly: boolean): Promise<DeterministicResult> {
  if (session.role === 'presales_agent') {
    const m = await getPresalesAgentMetrics(session.id, range);
    const text = connectedOnly
      ? `You've connected with ${m.connectedCallsInRange} lead${m.connectedCallsInRange === 1 ? '' : 's'} ${rangeWords}, out of ${m.callsInRange} call attempt${m.callsInRange === 1 ? '' : 's'}.`
      : `You've made ${m.callsInRange} call${m.callsInRange === 1 ? '' : 's'} ${rangeWords} and connected with ${m.connectedCallsInRange}.`;
    return { text, facts: { callsInRange: m.callsInRange, connectedCallsInRange: m.connectedCallsInRange, range: rangeWords }, source: 'verified_crm', subject: { type: 'self' } };
  }
  if (isMinimalRole(session)) return minimalRoleAnswer();
  return unsupportedForRole(session.role, 'call');
}

function followupSentence(due: number, overdue: number): string {
  if (due === 0 && overdue === 0) return "You're all clear on follow-ups today — nothing due, nothing overdue.";
  return `You have ${due} follow-up${due === 1 ? '' : 's'} due today and ${overdue} overdue.`;
}

async function ownFollowups(session: ShifuSession, rangeLabel: RangeLabel): Promise<DeterministicResult> {
  const mismatch = rangeMismatchNote(rangeLabel, "what's due today and what's currently overdue");
  if (mismatch) return mismatch;
  if (session.role === 'presales_agent') {
    const m = await getPresalesAgentMetrics(session.id, todayRange());
    return { text: followupSentence(m.followupsDueToday, m.followupsOverdue), facts: { followupsDueToday: m.followupsDueToday, followupsOverdue: m.followupsOverdue }, source: 'verified_crm', subject: { type: 'self' } };
  }
  if (session.role === 'sales_counsellor') {
    const m = await getCounsellorMetrics(session.id, todayRange());
    return { text: followupSentence(m.followupsDueToday, m.followupsOverdue), facts: { followupsDueToday: m.followupsDueToday, followupsOverdue: m.followupsOverdue }, source: 'verified_crm', subject: { type: 'self' } };
  }
  if (isMinimalRole(session)) return minimalRoleAnswer();
  if (session.role === 'admin') return unsupportedForRole(session.role, 'follow-up');
  // vertical_head: follow-up date isn't a VH concept in this schema (VH acts on assignment, not a followup date).
  return unsupportedForRole(session.role, 'follow-up');
}

async function ownMeetings(session: ShifuSession, range: DateRange, rangeWords: string): Promise<DeterministicResult> {
  if (session.role === 'presales_agent') {
    const m = await getPresalesAgentMetrics(session.id, range);
    const text = `You've booked ${m.meetingsScheduledInRange} meeting${m.meetingsScheduledInRange === 1 ? '' : 's'} ${rangeWords}, and ${m.meetingsDoneInRange} ${m.meetingsDoneInRange === 1 ? 'was' : 'were'} completed.`;
    return { text, facts: { meetingsScheduledInRange: m.meetingsScheduledInRange, meetingsDoneInRange: m.meetingsDoneInRange, range: rangeWords }, source: 'verified_crm', subject: { type: 'self' } };
  }
  if (session.role === 'sales_counsellor') {
    const m = await getCounsellorMetrics(session.id, range);
    const text = `You have ${m.meetingsScheduledInRange} meeting${m.meetingsScheduledInRange === 1 ? '' : 's'} ${rangeWords}, ${m.meetingsDoneInRange} completed, and ${m.currentMeetingNotJoined} not joined right now.`;
    return { text, facts: { meetingsScheduledInRange: m.meetingsScheduledInRange, meetingsDoneInRange: m.meetingsDoneInRange, currentMeetingNotJoined: m.currentMeetingNotJoined, range: rangeWords }, source: 'verified_crm', subject: { type: 'self' } };
  }
  if (isMinimalRole(session)) return minimalRoleAnswer();
  return unsupportedForRole(session.role, 'meeting');
}

async function ownTrials(session: ShifuSession, range: DateRange, rangeWords: string): Promise<DeterministicResult> {
  if (session.role === 'sales_counsellor') {
    const m = await getCounsellorMetrics(session.id, range);
    const text = `You have ${m.trialsScheduledInRange} trial${m.trialsScheduledInRange === 1 ? '' : 's'} ${rangeWords}, and ${m.trialsDoneInRange} completed.`;
    return { text, facts: { trialsScheduledInRange: m.trialsScheduledInRange, trialsDoneInRange: m.trialsDoneInRange, range: rangeWords }, source: 'verified_crm', subject: { type: 'self' } };
  }
  if (isMinimalRole(session)) return minimalRoleAnswer();
  return unsupportedForRole(session.role, 'trial');
}

async function ownAdmissions(session: ShifuSession, range: DateRange, rangeWords: string): Promise<DeterministicResult> {
  if (session.role === 'sales_counsellor') {
    const m = await getCounsellorMetrics(session.id, range);
    const text = `${rangeWords[0].toUpperCase()}${rangeWords.slice(1)}: ${m.admissionsWonInRange} admission${m.admissionsWonInRange === 1 ? '' : 's'} closed won and ${m.admissionsLostInRange} closed lost.`;
    return { text, facts: { admissionsWonInRange: m.admissionsWonInRange, admissionsLostInRange: m.admissionsLostInRange, range: rangeWords }, source: 'verified_crm', subject: { type: 'self' } };
  }
  if (isMinimalRole(session)) return minimalRoleAnswer();
  return unsupportedForRole(session.role, 'admission');
}

async function ownAttentionItems(session: ShifuSession, rangeLabel: RangeLabel): Promise<DeterministicResult> {
  if (isMinimalRole(session)) return minimalRoleAnswer();
  const mismatch = rangeMismatchNote(rangeLabel, "what needs attention right now");
  if (mismatch) return mismatch;
  if (session.role === 'vertical_head') {
    const m = await getVerticalHeadMetrics(session.id, todayRange());
    const text =
      m.currentPendingAssignment > 0
        ? `You have ${m.currentPendingAssignment} qualified lead${m.currentPendingAssignment === 1 ? '' : 's'} waiting for a counsellor assignment.${m.oldestWaitingLeadCode ? ` The oldest is ${m.oldestWaitingLeadCode}, waiting since ${m.oldestWaitingSince}.` : ''}`
        : "Nothing's waiting on you right now — every qualified lead has a counsellor assigned.";
    return {
      text,
      facts: { currentPendingAssignment: m.currentPendingAssignment, oldestWaitingLeadCode: m.oldestWaitingLeadCode, oldestWaitingSince: m.oldestWaitingSince },
      source: 'verified_crm',
      subject: { type: 'self' },
      leadCode: m.oldestWaitingLeadCode ?? undefined,
    };
  }
  const items = await getAttentionItems(session.role, session.id);
  const text = items.length
    ? `Here's what needs attention:\n${items.map((i) => `- ${i}`).join('\n')}`
    : "Nothing flagged as needing attention right now — you're up to date.";
  return { text, facts: { attentionItems: items }, source: 'verified_crm', subject: { type: 'self' } };
}

async function ownStatus(session: ShifuSession, range: DateRange, rangeWords: string): Promise<DeterministicResult> {
  if (session.role === 'presales_agent') {
    const m = await getPresalesAgentMetrics(session.id, range);
    const text = `${rangeWords[0].toUpperCase()}${rangeWords.slice(1)}: ${m.callsInRange} calls, ${m.connectedCallsInRange} connected, ${m.qualifiedInRange} qualified, ${m.meetingsDoneInRange} meetings completed. You currently have ${m.currentNewLeads} new and ${m.currentFollowUpNeeded} in follow-up needed.`;
    return { text, facts: { ...m, range: rangeWords }, source: 'verified_crm', subject: { type: 'self' } };
  }
  if (session.role === 'vertical_head') {
    const m = await getVerticalHeadMetrics(session.id, range);
    const text = `${rangeWords[0].toUpperCase()}${rangeWords.slice(1)}: you assigned ${m.assignedInRange} lead${m.assignedInRange === 1 ? '' : 's'}. ${m.currentPendingAssignment} qualified lead${m.currentPendingAssignment === 1 ? '' : 's'} still waiting on assignment right now, out of ${m.currentTotalAssigned} total under you.`;
    return { text, facts: { ...m, range: rangeWords }, source: 'verified_crm', subject: { type: 'self' } };
  }
  if (session.role === 'sales_counsellor') {
    const m = await getCounsellorMetrics(session.id, range);
    const text = `${rangeWords[0].toUpperCase()}${rangeWords.slice(1)}: ${m.meetingsDoneInRange} meetings completed, ${m.trialsDoneInRange} trials completed, ${m.admissionsWonInRange} admissions won. ${m.followupsOverdue} follow-up${m.followupsOverdue === 1 ? '' : 's'} overdue right now.`;
    return { text, facts: { ...m, range: rangeWords }, source: 'verified_crm', subject: { type: 'self' } };
  }
  if (session.role === 'admin') {
    const view = await getOrgSummary(range);
    const text = `Org-wide ${rangeWords}: ${view.period.callsInRange} calls, ${view.period.qualifiedInRange} qualified, ${view.period.meetingsDoneInRange} meetings completed, ${view.period.admissionsWonInRange} admissions won. Currently ${view.snapshot.currentQualified} leads are qualified in total.`;
    return { text, facts: { period: view.period, snapshotHighlights: { currentQualified: view.snapshot.currentQualified }, range: rangeWords }, source: 'verified_crm', subject: { type: 'org' } };
  }
  return minimalRoleAnswer();
}

async function ownNextAction(session: ShifuSession, rangeLabel: RangeLabel): Promise<DeterministicResult> {
  if (isMinimalRole(session)) return minimalRoleAnswer();
  const mismatch = rangeMismatchNote(rangeLabel, "what to prioritize right now");
  if (mismatch) return mismatch;
  if (session.role === 'presales_agent') {
    const m = await getPresalesAgentMetrics(session.id, todayRange());
    const items = await getAttentionItems(session.role, session.id);
    const action = presalesNextAction({ followupsOverdue: m.followupsOverdue, followupsDueToday: m.followupsDueToday, currentNewLeads: m.currentNewLeads }, items);
    return { text: action.text, facts: { followupsOverdue: m.followupsOverdue, followupsDueToday: m.followupsDueToday, currentNewLeads: m.currentNewLeads }, source: 'verified_crm', subject: { type: 'self' }, leadCode: action.leadCode };
  }
  if (session.role === 'vertical_head') {
    const m = await getVerticalHeadMetrics(session.id, todayRange());
    const action = vhNextAction({ currentPendingAssignment: m.currentPendingAssignment, oldestWaitingLeadCode: m.oldestWaitingLeadCode, oldestWaitingSince: m.oldestWaitingSince });
    return { text: action.text, facts: { currentPendingAssignment: m.currentPendingAssignment, oldestWaitingLeadCode: m.oldestWaitingLeadCode }, source: 'verified_crm', subject: { type: 'self' }, leadCode: action.leadCode };
  }
  if (session.role === 'sales_counsellor') {
    const m = await getCounsellorMetrics(session.id, todayRange());
    const items = await getAttentionItems(session.role, session.id);
    const trialDonePending = items.filter((i) => i.includes('admission decision is still pending')).length;
    const action = counsellorNextAction({ followupsOverdue: m.followupsOverdue, currentMeetingNotJoined: m.currentMeetingNotJoined, trialDonePendingAdmission: trialDonePending }, items);
    return { text: action.text, facts: { followupsOverdue: m.followupsOverdue, currentMeetingNotJoined: m.currentMeetingNotJoined }, source: 'verified_crm', subject: { type: 'self' }, leadCode: action.leadCode };
  }
  if (session.role === 'admin') {
    const items = await getAttentionItems('admin', session.id);
    const action = adminNextAction(items);
    return { text: action.text, facts: { attentionItems: items }, source: 'verified_crm', subject: { type: 'org' }, leadCode: action.leadCode };
  }
  return minimalRoleAnswer();
}

// ---------------------------------------------------------------------------
// Admin cross-user intelligence — PERSON_PERFORMANCE / TEAM_COMPARISON.
// ---------------------------------------------------------------------------

function headlineMetrics(role: Role, view: AdminView): string {
  if (role === 'presales_agent') {
    return `made ${view.period.callsInRange} calls with ${view.period.connectedCallsInRange} connects and qualified ${view.period.qualifiedInRange} lead${view.period.qualifiedInRange === 1 ? '' : 's'}`;
  }
  if (role === 'sales_counsellor') {
    return `completed ${view.period.meetingsDoneInRange} meetings, ${view.period.trialsDoneInRange} trials, and closed ${view.period.admissionsWonInRange} admission${view.period.admissionsWonInRange === 1 ? '' : 's'} won`;
  }
  if (role === 'vertical_head') {
    // Bug caught before shipping: this view is already scoped to leads
    // assigned to THIS VH (see getPersonMetrics's vertical_head branch in
    // context.ts), so currentPendingVh (which means "no VH assigned at
    // all") would always read 0 here. The correct scoped figure is
    // currentPendingCounsellor — qualified leads this VH owns that don't
    // yet have a counsellor.
    return `has ${view.snapshot.currentPendingCounsellor} qualified lead${view.snapshot.currentPendingCounsellor === 1 ? '' : 's'} currently waiting for a counsellor assignment`;
  }
  return `has ${view.snapshot.currentQualified} qualified leads currently`;
}

async function resolvePersonOrRespond(
  session: ShifuSession,
  name: string
): Promise<{ ok: true; id: number; name: string; role: Role } | { ok: false; result: DeterministicResult }> {
  if (!canResolveOtherUsers(session)) {
    return { ok: false, result: permissionDenied('I can only show performance details for other team members if you have Admin access.') };
  }
  const matches = await resolveUserByName(name);
  if (matches.length === 0) {
    return { ok: false, result: { text: `I couldn't find a user named ${name}.`, facts: null, source: 'not_found' } };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      result: {
        text: `I found more than one matching user: ${matches.map((u) => `${u.name} (${ROLE_LABEL_SHORT[u.role]})`).join(', ')}. Which one did you mean?`,
        facts: null,
        source: 'ambiguous',
        candidates: matches,
      },
    };
  }
  const u = matches[0];
  if (!canViewPerson(session, u.id)) {
    return { ok: false, result: permissionDenied() };
  }
  return { ok: true, id: u.id, name: u.name, role: u.role };
}

async function personPerformance(session: ShifuSession, name: string, range: DateRange, rangeWords: string): Promise<DeterministicResult> {
  const resolved = await resolvePersonOrRespond(session, name);
  if (!resolved.ok) return resolved.result;
  const { role, name: personName, view } = await getPersonMetrics(resolved.id, range);
  if (!view) {
    return { text: `${personName} is ${ROLE_LABEL_SHORT[role]} — I don't track individual performance numbers for that role yet.`, facts: null, source: 'unsupported' };
  }
  const text = `${personName} ${headlineMetrics(role, view)}, ${rangeWords}.`;
  return { text, facts: { name: personName, role, ...view }, source: 'verified_crm', subject: { type: 'user', id: resolved.id, name: personName, role } };
}

async function teamComparison(session: ShifuSession, names: [string, string], range: DateRange, rangeWords: string): Promise<DeterministicResult> {
  if (!canViewTeamMetrics(session)) return permissionDenied('Comparing two people is only available to Admin.');
  const [a, b] = names;
  const ra = await resolvePersonOrRespond(session, a);
  if (!ra.ok) return ra.result;
  const rb = await resolvePersonOrRespond(session, b);
  if (!rb.ok) return rb.result;
  // Phase B.1 performance fix (user-flagged item 6): getPersonMetrics
  // fetches the whole leads table internally when not given one, so the
  // original Phase B version of this function triggered TWO full-table
  // fetches for one comparison request. getPersonMetrics now accepts an
  // optional pre-fetched lead set (added to context.ts as a purely
  // additive, backward-compatible parameter — see its doc comment), so
  // this fetches once and reuses it for both people.
  const leads = await fetchAllLeadsRich();
  const pa = await getPersonMetrics(ra.id, range, leads);
  const pb = await getPersonMetrics(rb.id, range, leads);
  if (!pa.view || !pb.view) {
    return { text: "I don't have comparable performance numbers for one or both of those roles yet.", facts: null, source: 'unsupported' };
  }
  const text = `${pa.name} ${headlineMetrics(pa.role, pa.view)}. ${pb.name} ${headlineMetrics(pb.role, pb.view)}. (${rangeWords})`;
  return {
    text,
    facts: { a: { name: pa.name, role: pa.role, ...pa.view }, b: { name: pb.name, role: pb.role, ...pb.view } },
    source: 'verified_crm',
  };
}

// ---------------------------------------------------------------------------
// Admin team/role/org intelligence.
// ---------------------------------------------------------------------------

function detectTargetRole(message: string): Role | 'org' | null {
  const m = message.toLowerCase();
  if (/\bvertical\s*heads?\b/.test(m)) return 'vertical_head';
  if (/\bpre-?sales\b/.test(m)) return 'presales_agent';
  if (/\bcounsellors?\b/.test(m)) return 'sales_counsellor';
  if (/\badmin\b/.test(m)) return 'admin';
  if (/\bsales\b/.test(m)) return 'sales_counsellor'; // checked after pre-sales, per intent-router's own ROLE_WORDS ordering
  if (/\b(everyone|org(anisation)?|company|team)\b/.test(m)) return 'org';
  return null;
}

async function rolePerformance(session: ShifuSession, message: string, range: DateRange, rangeWords: string, rangeLabel: RangeLabel): Promise<DeterministicResult> {
  if (!canViewTeamMetrics(session)) return permissionDenied('Role and team performance is only available to Admin.');
  const target = detectTargetRole(message);
  if (target === 'presales_agent') {
    const rows = await getPresalesBreakdown(range);
    const totalCalls = rows.reduce((s, r) => s + r.period.callsInRange, 0);
    const totalQualified = rows.reduce((s, r) => s + r.period.qualifiedInRange, 0);
    const text = `Pre-Sales, ${rangeWords}: ${rows.length} agent${rows.length === 1 ? '' : 's'} made ${totalCalls} calls combined and qualified ${totalQualified} lead${totalQualified === 1 ? '' : 's'}.`;
    return { text, facts: { role: 'presales_agent', agentCount: rows.length, totalCalls, totalQualified, range: rangeWords }, source: 'verified_crm', subject: { type: 'role', role: 'presales_agent' } };
  }
  if (target === 'sales_counsellor') {
    const rows = await getCounsellorBreakdown(range);
    const totalMeetingsDone = rows.reduce((s, r) => s + r.period.meetingsDoneInRange, 0);
    const totalAdmissionsWon = rows.reduce((s, r) => s + r.period.admissionsWonInRange, 0);
    const text = `Sales Counsellors, ${rangeWords}: ${rows.length} counsellor${rows.length === 1 ? '' : 's'} completed ${totalMeetingsDone} meetings combined and closed ${totalAdmissionsWon} admission${totalAdmissionsWon === 1 ? '' : 's'} won.`;
    return { text, facts: { role: 'sales_counsellor', counsellorCount: rows.length, totalMeetingsDone, totalAdmissionsWon, range: rangeWords }, source: 'verified_crm', subject: { type: 'role', role: 'sales_counsellor' } };
  }
  if (target === 'vertical_head') {
    // getVhBreakdown's rows are already scoped to leads assigned to each
    // VH (see context.ts). Same bug class as headlineMetrics() (Phase B)
    // and now caught here too: summing currentPendingVh across these rows
    // would always total 0 (see vhAggregatePending's doc comment). The VH
    // aggregate is also snapshot-only (rows.reduce reads .snapshot, never
    // .period), so a non-today range gets the same honest-mismatch note
    // rather than being silently ignored.
    const mismatch = rangeMismatchNote(rangeLabel, 'the Vertical Head assignment backlog as it stands right now');
    if (mismatch) return mismatch;
    const rows = await getVhBreakdown(range);
    const totalPending = vhAggregatePending(rows);
    const text = `Vertical Heads: ${rows.length} VH${rows.length === 1 ? '' : 's'} currently have ${totalPending} qualified lead${totalPending === 1 ? '' : 's'} waiting for a counsellor assignment combined.`;
    return { text, facts: { role: 'vertical_head', vhCount: rows.length, totalPending }, source: 'verified_crm', subject: { type: 'role', role: 'vertical_head' } };
  }
  // "org"/"team"/"everyone", or role word not recognized — fall back to org-wide.
  const view = await getOrgSummary(range);
  const text = `Org-wide, ${rangeWords}: ${view.period.callsInRange} calls, ${view.period.qualifiedInRange} qualified, ${view.period.admissionsWonInRange} admissions won. ${view.snapshot.currentQualified} leads are qualified right now in total.`;
  return { text, facts: { period: view.period, currentQualified: view.snapshot.currentQualified, range: rangeWords }, source: 'verified_crm', subject: { type: 'org' } };
}

/**
 * Phase B.2 addition — admin-only per-agent Pre-Sales breakdown, built for
 * explicit-date questions like "On 27th August, which Pre-Sales agent did
 * how many calls and how many leads did each qualify?" but works for any
 * resolved range (today/yesterday/this week/explicit date) since it's
 * purely period-based — getPresalesBreakdown(range) already filters every
 * agent's calls/qualifications to the given date range, so there's no
 * snapshot-vs-period mismatch to guard against here (unlike ROLE_PERFORMANCE's
 * VH branch, which is snapshot-only).
 *
 * Reuses getPresalesBreakdown(range) as-is — no new metric logic is
 * computed here, this function only formats rows that function already
 * returns (period.callsInRange / period.qualifiedInRange), per the
 * standing "reuse, don't duplicate" rule. Rows are already sorted by
 * calls-descending by getPresalesBreakdown itself.
 */
/**
 * Pure aggregation, extracted so the "totals equal the sum of the agent
 * rows" invariant can be unit-tested directly without a live DB — same
 * pattern as vhAggregatePending above.
 */
export function sumBreakdownRows(rows: PresalesAgentBreakdownRow[]): { calls: number; qualified: number } {
  return {
    calls: rows.reduce((s, r) => s + r.calls, 0),
    qualified: rows.reduce((s, r) => s + r.qualified, 0),
  };
}

/**
 * Exported (rather than kept module-private) so the admin-only permission
 * gate can be unit-tested directly: canViewTeamMetrics(session) is
 * checked and returned on before getPresalesBreakdown() is ever called,
 * so calling this with a non-admin session never touches the database —
 * see phase-b2-units.test.ts.
 */
export async function presalesAgentBreakdown(session: ShifuSession, range: DateRange, rangeWords: string): Promise<DeterministicResult> {
  if (!canViewTeamMetrics(session)) return permissionDenied('Per-agent Pre-Sales breakdowns are only available to Admin.');
  const breakdown = await getPresalesBreakdown(range);
  const rows: PresalesAgentBreakdownRow[] = breakdown.map((r) => ({
    userId: r.userId,
    name: r.name,
    calls: r.period.callsInRange,
    qualified: r.period.qualifiedInRange,
  }));
  const totals = sumBreakdownRows(rows);
  const text = rows.length
    ? [
        `Pre-Sales agent breakdown, ${rangeWords}:`,
        ...rows.map((r) => `${r.name} — ${r.calls} call${r.calls === 1 ? '' : 's'} | ${r.qualified} qualified`),
        `Total — ${totals.calls} call${totals.calls === 1 ? '' : 's'} | ${totals.qualified} qualified`,
      ].join('\n')
    : `No Pre-Sales agent activity recorded for ${rangeWords}.`;
  return {
    text,
    facts: { rows, totals, range: rangeWords },
    source: 'verified_crm',
    subject: { type: 'role', role: 'presales_agent' },
    rows,
    totals,
  };
}

/**
 * Phase B.3 addition — "when was the last lead qualified" diagnostics.
 * Admin-only. Uses getLatestQualification(), which sorts by qualified_at
 * DESC across ALL leads with no date filter — this is "the last one,
 * ever", not scoped to today/yesterday/any parsed range. Never infers
 * from the current qualification_status column (a lead's status can
 * change after the fact; qualified_at does not) — see that function's
 * doc comment in context.ts for the full reasoning.
 */
export async function latestQualificationAnswer(session: ShifuSession): Promise<DeterministicResult> {
  if (!canViewTeamMetrics(session)) return permissionDenied('Qualification-event diagnostics are only available to Admin.');
  const latest = await getLatestQualification();
  if (!latest) {
    return { text: 'No lead has been qualified yet.', facts: null, source: 'verified_crm' };
  }
  const ownerPart = latest.ownerName ? ` by ${latest.ownerName}` : latest.ownerUserId ? ` by user #${latest.ownerUserId}` : '';
  // Phase B.3.1 (item 2): disclosed rather than presented as settled fact
  // — see getLatestQualification()'s doc comment in context.ts for the
  // verified reasoning (owner_user_id can be reassigned by Admin/Data
  // Team after qualification; no historical qualifier field exists).
  const ownerCaveat = ownerPart ? ' (Note: owner reflects current Pre-Sales ownership, which can be reassigned after qualification — not necessarily who owned it at the time.)' : '';
  const text = `The last lead qualified was ${latest.leadCode}${ownerPart}, at ${latest.qualifiedAt}. Its current qualification status is ${latest.qualificationStatus}.${ownerCaveat}`;
  return {
    text,
    facts: { ...latest },
    source: 'verified_crm',
    leadCode: latest.leadCode,
    latestQualification: latest,
  };
}

/**
 * Phase B.3 addition — "how many leads were qualified on <date>" /
 * "who qualified leads on <date>". One deterministic query
 * (getDailyQualificationBreakdown) answers both phrasings: it's already
 * grouped by owner, so the total is just the sum of the rows, and the
 * per-owner rows themselves answer the "who" framing directly. Works
 * with any resolved range (explicit date, today, yesterday, this week),
 * not just explicit dates — it's purely period-based (qualified_at
 * filtered by the range), so there's no snapshot/period mismatch to
 * guard against here, same reasoning as presalesAgentBreakdown().
 */
export async function dailyQualificationCountAnswer(session: ShifuSession, range: DateRange, rangeWords: string): Promise<DeterministicResult> {
  if (!canViewTeamMetrics(session)) return permissionDenied('Qualification-event diagnostics are only available to Admin.');
  const rows = await getDailyQualificationBreakdown(range);
  const totalQualified = rows.reduce((s, r) => s + r.qualifiedCount, 0);
  // Phase B.3.1 (item 2): grouped by CURRENT owner_user_id, disclosed as
  // such rather than presented as a locked-in historical record — see
  // getDailyQualificationBreakdown()'s doc comment in context.ts for the
  // verified reasoning (Admin/Data Team can reassign a lead's owner at
  // any time; no historical "who qualified it" field exists to use
  // instead).
  const text = rows.length
    ? [
        `${totalQualified} lead${totalQualified === 1 ? '' : 's'} qualified, ${rangeWords}, by current Pre-Sales owner:`,
        ...rows.map((r) => `${r.ownerName ?? 'Unassigned'} — ${r.qualifiedCount} qualified`),
        `(Note: grouped by each lead's current owner, which can be reassigned by Admin/Data Team after qualification — not a guaranteed record of who performed the qualification.)`,
      ].join('\n')
    : `No leads were qualified ${rangeWords}.`;
  return {
    text,
    facts: { rows, totalQualified, range: rangeWords },
    source: 'verified_crm',
    subject: { type: 'role', role: 'presales_agent' },
    rows,
    totalQualified,
  };
}

async function teamPerformance(session: ShifuSession, range: DateRange, rangeWords: string): Promise<DeterministicResult> {
  if (!canViewTeamMetrics(session)) return permissionDenied('A team/org overview is only available to Admin.');
  const view = await getOrgSummary(range);
  const text = `${rangeWords[0].toUpperCase()}${rangeWords.slice(1)}'s overview: ${view.period.callsInRange} calls, ${view.period.qualifiedInRange} qualified, ${view.period.meetingsDoneInRange} meetings completed, ${view.period.admissionsWonInRange} admissions won. Currently ${view.snapshot.currentQualified} leads qualified, ${view.snapshot.currentActivePipeline} active in the pipeline.`;
  return { text, facts: { period: view.period, snapshotHighlights: { currentQualified: view.snapshot.currentQualified, currentActivePipeline: view.snapshot.currentActivePipeline }, range: rangeWords }, source: 'verified_crm', subject: { type: 'org' } };
}

async function pipelineStatus(session: ShifuSession, range: DateRange, rangeLabel: RangeLabel): Promise<DeterministicResult> {
  if (!canViewTeamMetrics(session)) return permissionDenied('Pipeline status is only available to Admin.');
  // Pipeline status is built entirely from computeSnapshot's current-state
  // fields (never computePeriod) — the `range` argument has no effect on
  // this answer at all, so a non-today rangeLabel must be caught here
  // rather than silently accepted and ignored.
  const mismatch = rangeMismatchNote(rangeLabel, 'the pipeline as it stands right now');
  if (mismatch) return mismatch;
  const view = await getOrgSummary(range);
  const s = view.snapshot;
  const text = `Pipeline right now: ${s.currentPendingVh} qualified lead${s.currentPendingVh === 1 ? '' : 's'} waiting for a Vertical Head, ${s.currentPendingCounsellor} waiting for a Sales Counsellor, ${s.currentPendingFirstContact} waiting on first contact after assignment. ${s.currentActivePipeline} lead${s.currentActivePipeline === 1 ? '' : 's'} are active in the pipeline overall.`;
  return {
    text,
    facts: { currentPendingVh: s.currentPendingVh, currentPendingCounsellor: s.currentPendingCounsellor, currentPendingFirstContact: s.currentPendingFirstContact, currentActivePipeline: s.currentActivePipeline },
    source: 'verified_crm',
    subject: { type: 'org' },
  };
}

async function leaderboard(session: ShifuSession, entities: Entities, range: DateRange, rangeWords: string): Promise<DeterministicResult> {
  if (!canViewTeamMetrics(session)) return permissionDenied('Team rankings are only available to Admin.');
  if (entities.rankingMetric === 'overdue') {
    const boards = await getOverdueLeaderboard(istToday());
    const topPresales = boards.presales[0];
    const topCounsellor = boards.counsellor[0];
    const parts: string[] = [];
    if (topPresales && topPresales.value > 0) parts.push(`${topPresales.name} has the most overdue follow-ups among Pre-Sales, with ${topPresales.value}`);
    if (topCounsellor && topCounsellor.value > 0) parts.push(`${topCounsellor.name} has the most among Sales Counsellors, with ${topCounsellor.value}`);
    const text = parts.length ? `${parts.join('. ')}.` : 'Nobody currently has any overdue follow-ups.';
    return { text, facts: { presales: boards.presales, counsellor: boards.counsellor }, source: 'verified_crm', subject: { type: 'org' } };
  }
  // default / 'calls'
  const rows = await getCallsLeaderboard(range);
  const top = rows[0];
  const text = top
    ? `${top.name} has made the most calls ${rangeWords}, with ${top.value}.`
    : `No call activity recorded ${rangeWords}.`;
  return { text, facts: { rows, range: rangeWords }, source: 'verified_crm', subject: { type: 'org' } };
}

/**
 * Phase B.1 addition (user-flagged item 2): "Who needs attention?" is a
 * people/team-level question, distinct from "What needs attention?"
 * (MY_ATTENTION_ITEMS, lead-level). Identifies people using real
 * operational signals already computed elsewhere in this file/module —
 * no new metric definitions, no invented composite "score":
 *   - Pre-Sales / Sales Counsellor: largest overdue follow-up backlog
 *     (reuses getOverdueLeaderboard, same function LEADERBOARD uses).
 *   - Vertical Head: largest counsellor-assignment backlog, i.e. the same
 *     vhAggregatePending signal used per-row rather than summed (the
 *     item 1 bug fix applies here too — using currentPendingCounsellor,
 *     never currentPendingVh, for a per-VH-scoped row).
 * Snapshot-only by nature (every signal is "right now"), so it goes
 * through the same rangeMismatchNote guard as the other snapshot-only
 * intents rather than silently answering a "yesterday" phrasing of this
 * question with current data.
 */
async function teamAttention(session: ShifuSession, rangeLabel: RangeLabel): Promise<DeterministicResult> {
  if (!canViewTeamMetrics(session)) return permissionDenied('People-level attention summaries are only available to Admin.');
  const mismatch = rangeMismatchNote(rangeLabel, 'who currently has the largest operational backlog');
  if (mismatch) return mismatch;

  const today = istToday();
  const [overdueBoards, vhRows] = await Promise.all([getOverdueLeaderboard(today), getVhBreakdown(todayRange())]);

  const topPresales = overdueBoards.presales[0];
  const topCounsellor = overdueBoards.counsellor[0];
  const vhWithPending = vhRows
    .map((r) => ({ name: r.name, pending: r.snapshot.currentPendingCounsellor }))
    .sort((a, b) => b.pending - a.pending);
  const topVh = vhWithPending[0];

  const lines: string[] = [];
  if (topPresales && topPresales.value > 0) lines.push(`${topPresales.name} (Pre-Sales) has the largest overdue follow-up backlog, with ${topPresales.value}`);
  if (topCounsellor && topCounsellor.value > 0) lines.push(`${topCounsellor.name} (Sales Counsellor) has the largest overdue follow-up backlog, with ${topCounsellor.value}`);
  if (topVh && topVh.pending > 0) lines.push(`${topVh.name} (Vertical Head) has the largest counsellor-assignment backlog, with ${topVh.pending} lead${topVh.pending === 1 ? '' : 's'} waiting`);

  const text = lines.length ? `${lines.join('. ')}.` : "No one currently has a notable operational backlog — the team's on top of things.";
  return {
    text,
    facts: { topPresales, topCounsellor, topVh, presalesBoard: overdueBoards.presales, counsellorBoard: overdueBoards.counsellor },
    source: 'verified_crm',
    subject: { type: 'org' },
  };
}

// ---------------------------------------------------------------------------
// Main dispatcher.
// ---------------------------------------------------------------------------

export async function buildDeterministicAnswer(
  session: ShifuSession,
  intent: Intent,
  entities: Entities,
  rangeLabel: RangeLabel,
  rawMessage: string,
  explicitDate?: string
): Promise<DeterministicResult> {
  const range = resolveRange(rangeLabel, explicitDate);
  const rangeWords = rangeLabelToWords(rangeLabel, explicitDate);

  switch (intent) {
    case 'MY_CALLS':
      return ownCalls(session, range, rangeWords, false);
    case 'MY_CONNECTED_CALLS':
      return ownCalls(session, range, rangeWords, true);
    case 'MY_FOLLOWUPS':
      return ownFollowups(session, rangeLabel);
    case 'MY_MEETINGS':
      return ownMeetings(session, range, rangeWords);
    case 'MY_TRIALS':
      return ownTrials(session, range, rangeWords);
    case 'MY_ADMISSIONS':
      return ownAdmissions(session, range, rangeWords);
    case 'MY_ATTENTION_ITEMS':
      return ownAttentionItems(session, rangeLabel);
    case 'MY_STATUS':
      return ownStatus(session, range, rangeWords);
    case 'MY_NEXT_ACTION':
      return ownNextAction(session, rangeLabel);

    case 'PERSON_PERFORMANCE': {
      const name = entities.personNames?.[0];
      if (!name) return { text: "I couldn't tell who you meant — try naming the person directly.", facts: null, source: 'not_found' };
      return personPerformance(session, name, range, rangeWords);
    }
    case 'TEAM_COMPARISON': {
      const names = entities.personNames;
      if (!names || names.length < 2) return { text: 'I need two names to compare — try "Compare X and Y."', facts: null, source: 'not_found' };
      return teamComparison(session, [names[0], names[1]], range, rangeWords);
    }
    case 'ROLE_PERFORMANCE':
      return rolePerformance(session, rawMessage, range, rangeWords, rangeLabel);
    case 'TEAM_PERFORMANCE':
      return teamPerformance(session, range, rangeWords);
    case 'TEAM_ATTENTION':
      return teamAttention(session, rangeLabel);
    case 'PRESALES_AGENT_BREAKDOWN':
      return presalesAgentBreakdown(session, range, rangeWords);
    case 'LATEST_QUALIFICATION':
      return latestQualificationAnswer(session);
    case 'DAILY_QUALIFICATION_COUNT':
      return dailyQualificationCountAnswer(session, range, rangeWords);
    case 'PIPELINE_STATUS':
      return pipelineStatus(session, range, rangeLabel);
    case 'LEADERBOARD':
      return leaderboard(session, entities, range, rangeWords);

    case 'LEAD_LOOKUP':
      // Deferred per brief section 16: single-lead detail lookup needs its
      // own role-scoped field-visibility rules that Phase A's context.ts
      // does not yet provide (it only returns lead CODES inside attention
      // lists, never a full lead record). Rather than build that
      // permission surface hastily inside this pass, it's explicitly
      // deferred — see the Phase B report, item O.
      return {
        text: `I can't pull up ${entities.leadCode ?? 'that lead'}'s full details yet — that's coming in a future update. You can open it directly from the Leads page for now.`,
        facts: null,
        source: 'unsupported',
        leadCode: entities.leadCode,
      };

    case 'OPEN_LEAD':
    case 'NAVIGATE_TO_PAGE':
    case 'SNOOZE_SHIFU_ALERT':
      // Phase E territory (safe actions) — not built yet, answered honestly.
      return { text: "I can't perform that action yet, but I can tell you what you need to know if you ask.", facts: null, source: 'unsupported' };

    default:
      // CASUAL_CHAT / WELLNESS are intentionally never routed here by the
      // chat handler (see chat-handler.ts) — they skip the CRM entirely,
      // per brief sections 14/15. Reaching here for either would be a bug
      // in the handler, not a legitimate case, so this is a safe fallback.
      return { text: "I'm not sure how to answer that with CRM data yet.", facts: null, source: 'unsupported' };
  }
}

