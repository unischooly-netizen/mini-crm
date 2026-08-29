// app/lib/shifu/phase-b2-units.test.ts
//
// Pure, DB-free regression tests for the Phase B.2 pass (explicit
// calendar-date parsing + Pre-Sales per-agent breakdown). Same standalone
// pattern as intent-router.test.ts / phase-b-units.test.ts / phase-b1-units.test.ts.
// Run with:
//   DATABASE_URL="postgres://user:pass@localhost:5432/db" npx tsx app/lib/shifu/phase-b2-units.test.ts
// (DATABASE_URL is a dummy value, required only because this file
// transitively imports deterministic-answers.ts -> context.ts -> lib/db.ts,
// which eagerly calls neon(process.env.DATABASE_URL) at import time. No
// query is ever actually issued by the tests below.)
//
// NOTE ON "TODAY": these tests assume the machine's IST wall-clock date is
// 2026-08-29, matching this session's environment. The year-rollover test
// (item: "year omitted resolves safely") is inherently date-relative by
// design, so if this file is ever run on a different real-world date, that
// one specific case would need its expected year adjusted — every other
// case here is date-independent.

import { classifyIntent } from './intent-router';
import { parseDateRequest, parseRangeLabel, rangeLabelToWords } from './range-parser';
import { sumBreakdownRows, presalesAgentBreakdown, type PresalesAgentBreakdownRow } from './deterministic-answers';
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
// Item 3 / item 7: the three example phrases from the brief route to the
// new PRESALES_AGENT_BREAKDOWN intent, not ROLE_PERFORMANCE or anything else.
// ---------------------------------------------------------------------------

check(
  '"On 27th August, which Pre-Sales agent did how many calls and how many leads did each qualify?" -> PRESALES_AGENT_BREAKDOWN',
  classifyIntent('On 27th August, which Pre-Sales agent did how many calls and how many leads did each qualify?').intent === 'PRESALES_AGENT_BREAKDOWN'
);
check(
  '"Show Pre-Sales agent performance on 27 August." -> PRESALES_AGENT_BREAKDOWN',
  classifyIntent('Show Pre-Sales agent performance on 27 August.').intent === 'PRESALES_AGENT_BREAKDOWN'
);
check(
  '"Give me calls and qualifications by Pre-Sales agent for 27 Aug." -> PRESALES_AGENT_BREAKDOWN',
  classifyIntent('Give me calls and qualifications by Pre-Sales agent for 27 Aug.').intent === 'PRESALES_AGENT_BREAKDOWN'
);
check(
  '"which agent did how many calls today" -> PRESALES_AGENT_BREAKDOWN (agent word alone is a specific enough signal)',
  classifyIntent('which agent did how many calls today').intent === 'PRESALES_AGENT_BREAKDOWN'
);
check(
  'plain role total still routes to ROLE_PERFORMANCE when "agent" is not mentioned: "How is Pre-Sales doing?"',
  classifyIntent('How is Pre-Sales doing?').intent === 'ROLE_PERFORMANCE'
);

// ---------------------------------------------------------------------------
// Item 1 / item 7: explicit date parsing across every required format,
// all should resolve to the same date, 2026-08-27.
// ---------------------------------------------------------------------------

const explicitDateFormats: string[] = [
  'what happened on 27 Aug',
  'what happened on 27 August',
  'what happened on 27th Aug',
  'what happened on 27th August',
  'what happened on August 27',
  'what happened on August 27th',
  'what happened on 27/08/2026',
  'what happened on 27-08-2026',
];
for (const msg of explicitDateFormats) {
  const parsed = parseDateRequest(msg);
  check(`"${msg}" -> explicit_date 2026-08-27`, parsed.label === 'explicit_date' && parsed.explicitDate === '2026-08-27');
}

// ---------------------------------------------------------------------------
// Item 7: leap-year / date-validity handling.
// ---------------------------------------------------------------------------

check('"29 Feb 2024" -> valid (2024 is a leap year)', parseDateRequest('29 Feb 2024').label === 'explicit_date' && parseDateRequest('29 Feb 2024').explicitDate === '2024-02-29');
check('"29 Feb 2025" -> unrecognized_date (2025 is not a leap year)', parseDateRequest('29 Feb 2025').label === 'unrecognized_date');
check('"31 Apr 2026" -> unrecognized_date (April only has 30 days)', parseDateRequest('31 Apr 2026').label === 'unrecognized_date');

// ---------------------------------------------------------------------------
// Item 7: malformed explicit date must NOT silently become 'today'.
// ---------------------------------------------------------------------------

check('"32 Aug 2026" -> unrecognized_date, not today', parseDateRequest('on 32 Aug 2026').label === 'unrecognized_date');
check('"13/13/2026" -> unrecognized_date, not today (month 13 does not exist)', parseDateRequest('13/13/2026').label === 'unrecognized_date');
check('"31 Feb 2026" -> unrecognized_date, not today', parseDateRequest('what about 31 Feb 2026').label === 'unrecognized_date');

// ---------------------------------------------------------------------------
// Regression: no date mentioned at all still defaults to 'today' (the
// unrecognized-date guard must not become overly broad and start
// swallowing ordinary messages).
// ---------------------------------------------------------------------------

check('"What are my calls today?" -> today (no false positive from the new guard)', parseRangeLabel('What are my calls today?') === 'today');
check('"How many calls did I make?" -> today (no date mentioned at all)', parseRangeLabel('How many calls did I make?') === 'today');
check('"yesterday" keyword still works unchanged', parseRangeLabel('What were my calls yesterday?') === 'yesterday');
check('"this week" keyword still works unchanged', parseRangeLabel('Calls so far this week?') === 'this_week');

// ---------------------------------------------------------------------------
// Item 1: year omitted resolves safely. Assumes IST "today" = 2026-08-29
// (see file header note).
// ---------------------------------------------------------------------------

check(
  '"27 Aug" (no year, in the past this year relative to 2026-08-29) -> 2026-08-27',
  parseDateRequest('numbers on 27 Aug').explicitDate === '2026-08-27'
);
check(
  '"30 Aug" (no year, 1 day in the future this year relative to 2026-08-29) rolls back to 2025-08-30',
  parseDateRequest('numbers on 30 Aug').explicitDate === '2025-08-30'
);
check(
  '"1 Jan" (no year, already in the past this year relative to 2026-08-29 — Jan comes before Aug) -> 2026-01-01, no rollback needed',
  parseDateRequest('numbers on 1 Jan').explicitDate === '2026-01-01'
);

// ---------------------------------------------------------------------------
// rangeLabelToWords for explicit_date shows the ISO date, matching the
// brief's requested response shape ("range": "2026-08-27", not a phrase).
// ---------------------------------------------------------------------------

check('rangeLabelToWords("explicit_date", "2026-08-27") === "2026-08-27"', rangeLabelToWords('explicit_date', '2026-08-27') === '2026-08-27');

// ---------------------------------------------------------------------------
// Item 7: totals equal the sum of the agent rows.
// ---------------------------------------------------------------------------

const sampleRows: PresalesAgentBreakdownRow[] = [
  { userId: 1, name: 'Rashi', calls: 12, qualified: 3 },
  { userId: 2, name: 'Swati', calls: 7, qualified: 1 },
  { userId: 3, name: 'Shalini', calls: 0, qualified: 0 },
];
const totals = sumBreakdownRows(sampleRows);
check('sumBreakdownRows: calls total equals sum of row calls', totals.calls === 19);
check('sumBreakdownRows: qualified total equals sum of row qualified', totals.qualified === 4);
check('sumBreakdownRows: empty rows -> zero totals', sumBreakdownRows([]).calls === 0 && sumBreakdownRows([]).qualified === 0);

// ---------------------------------------------------------------------------
// Item 4 / item 7: a non-Admin session is denied, before any DB call.
// (canViewTeamMetrics is checked and returned on before
// getPresalesBreakdown() runs, so this never touches the database.)
// ---------------------------------------------------------------------------

async function runPermissionTest() {
  const nonAdminSession: ShifuSession = { id: 42, name: 'Rashi', role: 'presales_agent' };
  const result = await presalesAgentBreakdown(nonAdminSession, { start: '2026-08-27', end: '2026-08-27' }, '2026-08-27');
  check('presalesAgentBreakdown denies a non-Admin (presales_agent) session', result.source === 'permission_denied');
  check('presalesAgentBreakdown denial carries no rows/totals', result.rows === undefined && result.totals === undefined);

  const summary = pass + fail;
  console.log(`\n${pass}/${summary} passed`);
  if (fail > 0) process.exit(1);
}

runPermissionTest();
