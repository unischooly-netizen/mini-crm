// app/lib/shifu/phase-b-units.test.ts
//
// Standalone test script (same pattern as intent-router.test.ts — no test
// runner in this repo) covering the two Phase B modules that are pure and
// DB-free: numeric-guard.ts and range-parser.ts. The rest of Phase B
// (deterministic-answers.ts, chat-handler.ts) calls the real database
// through context.ts and cannot be unit-tested from this environment —
// see the Phase B report for the manual test checklist to run once
// deployed instead.
//
// Run with: npx tsx app/lib/shifu/phase-b-units.test.ts

import { extractNumbers, allNumbersAccountedFor, applyGeminiRewrite } from './numeric-guard';
import { parseRangeLabel } from './range-parser';

type Case = { name: string; run: () => boolean };

const cases: Case[] = [
  {
    name: 'extractNumbers finds integers and percentages',
    run: () => JSON.stringify(extractNumbers('47 calls, 13 connected, 28%')) === JSON.stringify(['47', '13', '28%']),
  },
  {
    name: 'allNumbersAccountedFor: true when Gemini reuses only verified numbers',
    run: () => allNumbersAccountedFor("You've made 47 calls today and connected with 13.", "You've made 47 calls today and connected with 13. Nice work!") === true,
  },
  {
    name: 'allNumbersAccountedFor: false when Gemini introduces a calculated rate',
    run: () =>
      allNumbersAccountedFor(
        "You've made 47 calls today and connected with 13.",
        "You've made 47 calls, connected with 13, giving you a 28% connection rate."
      ) === false,
  },
  {
    name: 'allNumbersAccountedFor: true for harmless reused time-of-day numbers',
    run: () => allNumbersAccountedFor('It is currently 4 PM IST.', 'Hey! It is 4 PM — how can I help?') === true,
  },
  {
    name: 'applyGeminiRewrite: keeps Gemini text when safe',
    run: () => applyGeminiRewrite('You made 47 calls.', 'You made 47 calls today, nice work!').usedGemini === true,
  },
  {
    name: 'applyGeminiRewrite: falls back to deterministic text when Gemini invents a number',
    run: () => {
      const r = applyGeminiRewrite('You made 47 calls.', 'You made 47 calls with a 90% success rate.');
      return r.usedGemini === false && r.finalText === 'You made 47 calls.';
    },
  },
  {
    name: 'applyGeminiRewrite: falls back when Gemini response is null (call failed)',
    run: () => {
      const r = applyGeminiRewrite('You made 47 calls.', null);
      return r.usedGemini === false && r.finalText === 'You made 47 calls.';
    },
  },
  { name: "parseRangeLabel: defaults to 'today' with no range word", run: () => parseRangeLabel('How many calls have I done?') === 'today' },
  { name: "parseRangeLabel: detects 'yesterday'", run: () => parseRangeLabel('How many calls yesterday?') === 'yesterday' },
  { name: "parseRangeLabel: detects 'this week'", run: () => parseRangeLabel('How did I do this week?') === 'this_week' },
  { name: "parseRangeLabel: snapshot-style question still defaults to 'today' (caller ignores it)", run: () => parseRangeLabel('How many leads are waiting for counsellor assignment?') === 'today' },
];

let pass = 0;
for (const c of cases) {
  const ok = c.run();
  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
}
console.log(`\n${pass}/${cases.length} passed`);
if (pass !== cases.length) process.exit(1);
