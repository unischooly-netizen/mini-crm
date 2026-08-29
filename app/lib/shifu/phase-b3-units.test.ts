// app/lib/shifu/phase-b3-units.test.ts
//
// Pure, DB-free regression tests for the Phase B.3 pass (qualification-
// event diagnostics: LATEST_QUALIFICATION, DAILY_QUALIFICATION_COUNT).
// Same standalone pattern as the earlier phase-b*-units.test.ts files.
// Run with:
//   DATABASE_URL="postgres://user:pass@localhost:5432/db" npx tsx app/lib/shifu/phase-b3-units.test.ts
//
// What's covered here vs. what needs a live database (manual-test
// checklist, same split as Phase B.1's teamAttention()):
//   - Router classification (all example phrases route to the right new
//     intent, and specifically do NOT fall through to CASUAL_CHAT — the
//     exact bug this phase was opened to fix) — pure, tested here.
//   - The first-person guard that keeps "how many leads did I qualify
//     today" out of the new admin-only DAILY_QUALIFICATION_COUNT path —
//     pure, tested here.
//   - Admin-only permission gating for both new deterministic-answer
//     functions — pure, tested here (canViewTeamMetrics is checked and
//     returned on before either function ever calls the database, so
//     this needs no live DB, same pattern as presalesAgentBreakdown's
//     permission test in phase-b2-units.test.ts).
//   - "Latest non-null qualified_at is returned", "exact date
//     qualification count", "grouped owner counts", "no rows case", and
//     "date boundaries use IST/business-date semantics" are all real SQL
//     behaviors of getLatestQualification()/getDailyQualificationBreakdown()
//     in context.ts, which need a live database to verify against real
//     data — not independently testable in this pure/offline file. Their
//     SQL is a direct parity match with already-verified Phase A/B.1
//     clauses (same qualified_at field, same
//     "(qualified_at AT TIME ZONE 'Asia/Kolkata')::date" IST conversion
//     used in getPresalesAgentMetrics's qualified_in_range clause, same
//     "ORDER BY ... DESC LIMIT 1" pattern already used and verified for
//     getVerticalHeadMetrics's oldestWaitingLeadCode lookup) — flagged
//     here for live manual verification once deployed, same as the
//     Phase B.1 checklist.

import { classifyIntent } from './intent-router';
import { latestQualificationAnswer, dailyQualificationCountAnswer } from './deterministic-answers';
import type { ShifuSession } from './permissions';

let pass = 0;
let fail = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    pass++;
    console.log(`PASS  ${label}`);
  } else {
    fail++;
    console.log(`FAIL  ${label}`);
  }
}

// ---------------------------------------------------------------------------
// LATEST_QUALIFICATION routing — the exact phrases from the brief, plus
// the specific regression this phase exists to fix (must NOT be CASUAL_CHAT).
// ---------------------------------------------------------------------------

const latestQualificationPhrases = [
  'When was the last lead qualified?',
  'When was the latest qualification?',
  'What date was the last qualified lead?',
  'Who qualified the latest lead?',
  'When was the last lead qualified, and on what date?', // the exact phrase from live testing that triggered this phase
];
for (const msg of latestQualificationPhrases) {
  const { intent } = classifyIntent(msg);
  check(`"${msg}" -> LATEST_QUALIFICATION`, intent === 'LATEST_QUALIFICATION');
  check(`"${msg}" -> NOT CASUAL_CHAT (the regression this phase fixes)`, intent !== 'CASUAL_CHAT');
}

// ---------------------------------------------------------------------------
// DAILY_QUALIFICATION_COUNT routing.
// ---------------------------------------------------------------------------

const dailyCountPhrases = [
  'How many leads were qualified on 27 August?',
  'How many leads qualified on 26th August?',
  'Who qualified leads on 27 August?',
];
for (const msg of dailyCountPhrases) {
  const { intent } = classifyIntent(msg);
  check(`"${msg}" -> DAILY_QUALIFICATION_COUNT`, intent === 'DAILY_QUALIFICATION_COUNT');
  check(`"${msg}" -> NOT CASUAL_CHAT`, intent !== 'CASUAL_CHAT');
}

// ---------------------------------------------------------------------------
// Regression guard: a first-person qualification question must NOT be
// swept into the new admin-only DAILY_QUALIFICATION_COUNT path — this
// was a real gap caught during implementation, not from the brief itself.
// ---------------------------------------------------------------------------

check(
  '"How many leads did I qualify today?" -> NOT DAILY_QUALIFICATION_COUNT (first-person guard)',
  classifyIntent('How many leads did I qualify today?').intent !== 'DAILY_QUALIFICATION_COUNT'
);
check(
  '"How many did I qualify yesterday?" -> NOT DAILY_QUALIFICATION_COUNT (first-person guard)',
  classifyIntent('How many did I qualify yesterday?').intent !== 'DAILY_QUALIFICATION_COUNT'
);

// ---------------------------------------------------------------------------
// No collision with pre-existing "who ..." intents that are checked
// earlier in the router (WHO_RANKING_RE / WHO_NEEDS_ATTENTION_RE), and
// role-performance/agent-breakdown intents from earlier phases still work
// unchanged.
// ---------------------------------------------------------------------------

check('"Who has made the most calls?" still -> LEADERBOARD (Phase B, unaffected)', classifyIntent('Who has made the most calls?').intent === 'LEADERBOARD');
check('"Who needs attention?" still -> TEAM_ATTENTION (Phase B.1, unaffected)', classifyIntent('Who needs attention?').intent === 'TEAM_ATTENTION');
check(
  '"Which Pre-Sales agent did how many calls?" still -> PRESALES_AGENT_BREAKDOWN (Phase B.2, unaffected)',
  classifyIntent('Which Pre-Sales agent did how many calls?').intent === 'PRESALES_AGENT_BREAKDOWN'
);

// ---------------------------------------------------------------------------
// Admin-only permission gating — both new functions check
// canViewTeamMetrics() and return before touching the database, so this
// is safely testable without a live DB connection (same pattern as
// presalesAgentBreakdown's permission test in phase-b2-units.test.ts).
// ---------------------------------------------------------------------------

async function runPermissionTests() {
  const nonAdminSession: ShifuSession = { id: 42, name: 'Rashi', role: 'presales_agent' };
  const adminSessionShapeOnly: ShifuSession = { id: 1, name: 'Admin', role: 'admin' };
  void adminSessionShapeOnly; // not exercised end-to-end here (would require a live DB) — see file header

  const latestResult = await latestQualificationAnswer(nonAdminSession);
  check('latestQualificationAnswer denies a non-Admin (presales_agent) session', latestResult.source === 'permission_denied');
  check('latestQualificationAnswer denial carries no latestQualification field', latestResult.latestQualification === undefined);

  const dailyResult = await dailyQualificationCountAnswer(nonAdminSession, { start: '2026-08-27', end: '2026-08-27' }, '2026-08-27');
  check('dailyQualificationCountAnswer denies a non-Admin (presales_agent) session', dailyResult.source === 'permission_denied');
  check('dailyQualificationCountAnswer denial carries no rows/totalQualified', dailyResult.rows === undefined && dailyResult.totalQualified === undefined);

  const summary = pass + fail;
  console.log(`\n${pass}/${summary} passed`);
  if (fail > 0) process.exit(1);
}

runPermissionTests();
