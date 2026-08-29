// app/lib/shifu/phase-b3-3-units.test.ts
//
// Pure, DB-free regression tests for the Phase B.3.3 pass: protecting
// PRESALES_AGENT_BREAKDOWN, ROLE_PERFORMANCE (Pre-Sales), and
// PERSON_PERFORMANCE/TEAM_COMPARISON (via the shared headlineMetrics())
// from presenting an unverifiable "0 qualified" as though it were a
// confirmed historical fact, given the known qualified_at gap on
// migrated leads (see getUntimedQualifiedLeadCount()'s doc comment in
// context.ts for the root cause).
//
// What's covered here vs. what needs a live database: the actual
// getUntimedQualifiedLeadCount()/getPresalesBreakdown() SQL, and
// therefore the full end-to-end wiring inside presalesAgentBreakdown(),
// rolePerformance(), personPerformance(), and teamComparison() (whether
// they actually CALL getUntimedQualifiedLeadCount() and thread the
// result through correctly against real data) needs a live DB — flagged
// below as a manual-test checklist, same split as every other
// DB-dependent behavior in this suite. What IS safely testable offline:
//   - sumBreakdownRows()'s null-propagation logic (pure).
//   - headlineMetrics()'s wording decision (pure, exported specifically
//     for this).
//   - Every function's admin-only permission gate, which is checked and
//     returned on BEFORE any database call in every case — proven by
//     inspection and by these tests never needing DATABASE_URL to
//     resolve to a real database.
//
// Run with:
//   DATABASE_URL="postgres://user:pass@localhost:5432/db" npx tsx app/lib/shifu/phase-b3-3-units.test.ts

import { emptySnapshot, emptyPeriod, snapshotRates, periodRates } from '@/lib/performanceMetrics';
import {
  sumBreakdownRows,
  headlineMetrics,
  presalesAgentBreakdown,
  buildDeterministicAnswer,
  type PresalesAgentBreakdownRow,
} from './deterministic-answers';
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

function fakeView(callsInRange: number, connectedCallsInRange: number, qualifiedInRange: number) {
  return {
    snapshot: snapshotRates(emptySnapshot()),
    period: periodRates({ ...emptyPeriod(), callsInRange, connectedCallsInRange, qualifiedInRange }),
  };
}

// ---------------------------------------------------------------------------
// sumBreakdownRows: totals must not claim qualified=0 as verified when any
// row is unavailable (null); must still work normally when every row is a
// real number (including a real, verified zero) — this is the
// "untimedQualifiedCount = 0" / no-gap case.
// ---------------------------------------------------------------------------

const rowsWithOneUnavailable: PresalesAgentBreakdownRow[] = [
  { userId: 1, name: 'Satabhisha', calls: 190, qualified: null },
  { userId: 2, name: 'Poonam', calls: 152, qualified: null },
];
const totalsUnavailable = sumBreakdownRows(rowsWithOneUnavailable);
check('sumBreakdownRows: calls still sum normally even when qualified is unavailable', totalsUnavailable.calls === 342);
check('sumBreakdownRows: qualified total is null (not 0) when every row is unavailable — never presented as a verified zero', totalsUnavailable.qualified === null);

const mixedRows: PresalesAgentBreakdownRow[] = [
  { userId: 1, name: 'Rashi', calls: 100, qualified: 3 },
  { userId: 2, name: 'Swati', calls: 50, qualified: null },
];
check(
  'sumBreakdownRows: ANY unavailable row makes the whole total null, even if other rows have real numbers (cannot honestly claim a partial total)',
  sumBreakdownRows(mixedRows).qualified === null
);

const allRealRowsIncludingGenuineZero: PresalesAgentBreakdownRow[] = [
  { userId: 1, name: 'Rashi', calls: 100, qualified: 3 },
  { userId: 2, name: 'Swati', calls: 50, qualified: 0 },
];
const genuineTotals = sumBreakdownRows(allRealRowsIncludingGenuineZero);
check(
  'sumBreakdownRows: when no row is null (the untimedQualifiedCount = 0 / no-gap case), a genuine zero row still contributes normally and the total is a real number',
  genuineTotals.qualified === 3
);
check('sumBreakdownRows: calls total correct in the no-gap case', genuineTotals.calls === 150);

// ---------------------------------------------------------------------------
// headlineMetrics (PERSON_PERFORMANCE / TEAM_COMPARISON's shared
// formatter): must not say "qualified 0 leads" when untimedQualifiedCount
// > 0; must say it normally when the zero is genuine (untimedQualifiedCount
// === 0); a real nonzero figure is always shown as-is regardless of the
// untimed count elsewhere (a nonzero count is never ambiguous).
// ---------------------------------------------------------------------------

const zeroQualifiedView = fakeView(190, 80, 0);
const withGapText = headlineMetrics('presales_agent', zeroQualifiedView, 529);
check('headlineMetrics: does NOT say "qualified 0" when untimedQualifiedCount > 0', !withGapText.includes('qualified 0'));
check('headlineMetrics: DOES surface "unavailable" wording when untimedQualifiedCount > 0', withGapText.toLowerCase().includes('unavailable'));
check('headlineMetrics: still reports the real, verified call count even when qualification is unavailable', withGapText.includes('190 calls'));

const noGapText = headlineMetrics('presales_agent', zeroQualifiedView, 0);
check(
  'headlineMetrics: a genuine verified zero (untimedQualifiedCount === 0) is still reported normally as "qualified 0 leads" — proves the normal path is not permanently disabled',
  noGapText.includes('qualified 0 lead')
);

const nonzeroQualifiedView = fakeView(200, 90, 5);
const nonzeroText = headlineMetrics('presales_agent', nonzeroQualifiedView, 529);
check(
  'headlineMetrics: a real nonzero qualified count is always shown as-is, even when untimedQualifiedCount is nonzero elsewhere in the system (a nonzero figure is never ambiguous)',
  nonzeroText.includes('qualified 5 lead')
);

const counsellorView = fakeView(0, 0, 0); // qualifiedInRange irrelevant for this role
check(
  'headlineMetrics: sales_counsellor branch is unaffected by untimedQualifiedCount (only presales_agent reads that parameter)',
  headlineMetrics('sales_counsellor', counsellorView, 529) === headlineMetrics('sales_counsellor', counsellorView, 0)
);

// ---------------------------------------------------------------------------
// Permission gating for the three call sites this pass touches, proven
// without a live DB (every one of these checks canViewTeamMetrics /
// canResolveOtherUsers and returns before any query runs).
// ---------------------------------------------------------------------------

async function runPermissionTests() {
  const nonAdminSession: ShifuSession = { id: 42, name: 'Rashi', role: 'presales_agent' };

  const breakdownDenied = await presalesAgentBreakdown(nonAdminSession, { start: '2026-08-27', end: '2026-08-27' }, '2026-08-27');
  check('presalesAgentBreakdown still denies non-Admin after the B.3.3 change', breakdownDenied.source === 'permission_denied');
  check('presalesAgentBreakdown denial carries no dataQuality/untimedQualifiedCount', breakdownDenied.dataQuality === undefined && breakdownDenied.untimedQualifiedCount === undefined);

  const roleDenied = await buildDeterministicAnswer(nonAdminSession, 'ROLE_PERFORMANCE', {}, 'today', 'How was Pre-Sales doing?');
  check('ROLE_PERFORMANCE (via buildDeterministicAnswer) still denies non-Admin', roleDenied.source === 'permission_denied');
  check('ROLE_PERFORMANCE denial carries no dataQuality field', roleDenied.dataQuality === undefined);

  const personDenied = await buildDeterministicAnswer(nonAdminSession, 'PERSON_PERFORMANCE', { personNames: ['Satabhisha'] }, 'today', 'How did Satabhisha do?');
  check('PERSON_PERFORMANCE (via buildDeterministicAnswer) still denies non-Admin resolving another person', personDenied.source === 'permission_denied');

  const compareDenied = await buildDeterministicAnswer(nonAdminSession, 'TEAM_COMPARISON', { personNames: ['Satabhisha', 'Rashi'] }, 'today', 'Compare Satabhisha and Rashi');
  check('TEAM_COMPARISON (via buildDeterministicAnswer) still denies non-Admin', compareDenied.source === 'permission_denied');
  check('TEAM_COMPARISON denial carries no dataQuality field', compareDenied.dataQuality === undefined);

  const summary = pass + fail;
  console.log(`\n${pass}/${summary} passed`);
  if (fail > 0) process.exit(1);
}

runPermissionTests();

// ---------------------------------------------------------------------------
// MANUAL / LIVE-DB TEST CHECKLIST (cannot be verified offline):
//
// 1. Admin asks "On 27th August, which Pre-Sales agent did how many calls
//    and how many leads did each qualify?" against real production data
//    (529 Qualified leads, 0 with qualified_at): expect every row to read
//    "<name> — <real calls> calls | qualification history unavailable",
//    "Total — <sum> calls" with NO "| N qualified" suffix, a trailing
//    "Qualification totals unavailable because 529 ..." sentence,
//    dataQuality: 'unavailable', untimedQualifiedCount: 529, and
//    rows[].qualified === null / totals.qualified === null for every row
//    — while calls figures match exactly what the old (pre-fix) response
//    already showed correctly (1073 for 26 Aug, 1027 for 27 Aug).
//
// 2. Admin asks "How was Pre-Sales doing on 27 August?" (ROLE_PERFORMANCE):
//    expect the calls-combined sentence with the unavailable caveat, NOT
//    "qualified 0 leads", dataQuality: 'unavailable'.
//
// 3. Admin asks "How did Satabhisha do on 27 August?" (PERSON_PERFORMANCE)
//    for an agent whose qualifiedInRange for that date is 0: expect the
//    same caveat via headlineMetrics(), not "qualified 0 leads".
//
// 4. Admin asks "Compare Satabhisha and Rashi" for a date where both have
//    zero real qualifications (TEAM_COMPARISON): expect both sides to use
//    the caveat wording.
//
// 5. Once at least one Pre-Sales agent has a real, live, timestamped
//    qualification on a given date, re-run all four questions for that
//    date: expect real nonzero numbers with dataQuality left undefined —
//    same code path, no further changes needed (this is exactly what the
//    "zeroQualifiedView vs nonzeroQualifiedView" tests above already
//    prove for headlineMetrics() in isolation).
// ---------------------------------------------------------------------------
