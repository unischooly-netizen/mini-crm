// app/lib/shifu/phase-b3-1-units.test.ts
//
// Pure, DB-free regression tests for the Phase B.3.1 correction:
//   1. LATEST_QUALIFICATION must report range: "all_time", never "today"
//      (or any other parsed range label), regardless of what the message
//      happened to parse to — see resolveResponseRangeLabel() in
//      chat-handler.ts.
//   2. The owner-attribution caveat is present in both qualification
//      answers' text whenever an owner is actually named, so a reader
//      never mistakes "current owner" for "who performed the
//      qualification" (see the doc comments in context.ts's
//      getLatestQualification()/getDailyQualificationBreakdown() for the
//      verified reasoning this is based on).
//
// Run with:
//   DATABASE_URL="postgres://user:pass@localhost:5432/db" npx tsx app/lib/shifu/phase-b3-1-units.test.ts

import { resolveResponseRangeLabel } from './chat-handler';
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
// Item 1: LATEST_QUALIFICATION cannot return "today" merely because the
// question contained no explicit date (the exact bug reported: a message
// with no date parses to the default rangeLabel 'today', and the old code
// echoed that straight back as the response's `range`, even though
// getLatestQualification() is an all-history lookup).
// ---------------------------------------------------------------------------

check(
  'resolveResponseRangeLabel(LATEST_QUALIFICATION, verified_crm, "today") -> "all_time", not "today"',
  resolveResponseRangeLabel('LATEST_QUALIFICATION', 'verified_crm', 'today') === 'all_time'
);
check(
  'resolveResponseRangeLabel(LATEST_QUALIFICATION, ...) overrides even if rangeWords is "yesterday"/"this week" — the override always wins regardless of what was parsed',
  resolveResponseRangeLabel('LATEST_QUALIFICATION', 'verified_crm', 'yesterday') === 'all_time' &&
    resolveResponseRangeLabel('LATEST_QUALIFICATION', 'verified_crm', 'this week') === 'all_time' &&
    resolveResponseRangeLabel('LATEST_QUALIFICATION', 'verified_crm', '2026-08-27') === 'all_time'
);
check(
  'resolveResponseRangeLabel(LATEST_QUALIFICATION, permission_denied, "today") -> still "all_time" (the override is intent-based, not source-based)',
  resolveResponseRangeLabel('LATEST_QUALIFICATION', 'permission_denied', 'today') === 'all_time'
);

// ---------------------------------------------------------------------------
// Regression: normal range behavior for every other intent must be
// completely unchanged by this fix.
// ---------------------------------------------------------------------------

check(
  'resolveResponseRangeLabel(DAILY_QUALIFICATION_COUNT, verified_crm, "2026-08-27") -> "2026-08-27" (unchanged, not overridden)',
  resolveResponseRangeLabel('DAILY_QUALIFICATION_COUNT', 'verified_crm', '2026-08-27') === '2026-08-27'
);
check(
  'resolveResponseRangeLabel(PRESALES_AGENT_BREAKDOWN, verified_crm, "today") -> "today" (unchanged)',
  resolveResponseRangeLabel('PRESALES_AGENT_BREAKDOWN', 'verified_crm', 'today') === 'today'
);
check(
  'resolveResponseRangeLabel(MY_CALLS, verified_crm, "yesterday") -> "yesterday" (unchanged)',
  resolveResponseRangeLabel('MY_CALLS', 'verified_crm', 'yesterday') === 'yesterday'
);
check(
  'resolveResponseRangeLabel(MY_CALLS, permission_denied, "today") -> undefined (unchanged — range is only reported for verified_crm)',
  resolveResponseRangeLabel('MY_CALLS', 'permission_denied', 'today') === undefined
);
check(
  'resolveResponseRangeLabel(MY_CALLS, unsupported, "today") -> undefined (unchanged)',
  resolveResponseRangeLabel('MY_CALLS', 'unsupported', 'today') === undefined
);

// ---------------------------------------------------------------------------
// Item 2: owner-attribution caveat is surfaced in the text whenever an
// owner is actually named. Both functions return early on the
// permission-denied path (before touching the DB), so this is safely
// testable offline for the "no owner to caveat" and permission-denied
// shapes; the "owner IS present" case needs live data and is on the
// manual-test checklist (same split as Phase B.3's own tests).
// ---------------------------------------------------------------------------

async function runFunctionTests() {
  const nonAdminSession: ShifuSession = { id: 42, name: 'Rashi', role: 'presales_agent' };

  const latestDenied = await latestQualificationAnswer(nonAdminSession);
  check('latestQualificationAnswer still denies non-Admin after the B.3.1 change', latestDenied.source === 'permission_denied');

  const dailyDenied = await dailyQualificationCountAnswer(nonAdminSession, { start: '2026-08-27', end: '2026-08-27' }, '2026-08-27');
  check('dailyQualificationCountAnswer still denies non-Admin after the B.3.1 change', dailyDenied.source === 'permission_denied');

  const summary = pass + fail;
  console.log(`\n${pass}/${summary} passed`);
  if (fail > 0) process.exit(1);
}

runFunctionTests();
