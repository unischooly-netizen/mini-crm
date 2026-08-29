// app/lib/shifu/intent-router.test.ts
//
// Not wired into `npm run build` or any CI — this repo has no test runner
// installed (checked package.json: no jest/vitest), and installing one is
// outside this pass's scope. Run manually with:
//   npx tsx app/lib/shifu/intent-router.test.ts
//
// Phase A.1: 20 cases, all executed for real, one real bug found and fixed
// (overdue follow-up questions were matching MY_FOLLOWUPS before
// MY_ATTENTION_ITEMS — see the chat report for that pass).
//
// Phase A.2 (this pass, user-flagged item 5): checking `intent` alone was
// not enough — a case could report PASS while silently extracting the
// wrong person name or lead code, since the old assertions never looked at
// `entities`. Every case that expects personNames or a leadCode now checks
// the actual value, not just the intent label. Also added the required new
// multi-word name case: "How is Neha Sharma doing?".

import { classifyIntent } from './intent-router';

type Case = {
  msg: string;
  expected: string;
  expectedNames?: string[]; // checked as an exact, order-sensitive array match when present
  expectedLeadCode?: string; // checked as an exact match when present
};

const cases: Case[] = [
  { msg: 'How are you?', expected: 'CASUAL_CHAT' },
  { msg: 'How is Swati doing?', expected: 'PERSON_PERFORMANCE', expectedNames: ['Swati'] },
  { msg: 'How is Neha Sharma doing?', expected: 'PERSON_PERFORMANCE', expectedNames: ['Neha Sharma'] },
  { msg: 'How is Pre-Sales doing?', expected: 'ROLE_PERFORMANCE' },
  { msg: 'How is Sales doing?', expected: 'ROLE_PERFORMANCE' },
  { msg: 'How many calls did Rashi do?', expected: 'PERSON_PERFORMANCE', expectedNames: ['Rashi'] },
  { msg: 'Compare Swati and Rashi', expected: 'TEAM_COMPARISON', expectedNames: ['Swati', 'Rashi'] },
  { msg: 'What are my calls today?', expected: 'MY_CALLS' },
  { msg: 'How many connected calls have I done?', expected: 'MY_CONNECTED_CALLS' },
  { msg: 'What follow-ups are overdue?', expected: 'MY_ATTENTION_ITEMS' },
  { msg: 'Who needs attention?', expected: 'MY_ATTENTION_ITEMS' },
  { msg: "Give me today's overview", expected: 'TEAM_PERFORMANCE' },
  { msg: 'TLS-003408', expected: 'LEAD_LOOKUP', expectedLeadCode: 'TLS-003408' },
  { msg: 'tls-000042', expected: 'LEAD_LOOKUP', expectedLeadCode: 'TLS-000042' }, // lowercase input, uppercased output
  { msg: 'I need water', expected: 'WELLNESS' },
  { msg: 'I am tired', expected: 'WELLNESS' },
  { msg: 'What should I do next?', expected: 'MY_NEXT_ACTION' },
  { msg: 'How many meetings did I book?', expected: 'MY_MEETINGS' },
  { msg: 'Show my overdue follow-ups', expected: 'MY_ATTENTION_ITEMS' },
  { msg: 'How is the team doing?', expected: 'ROLE_PERFORMANCE' },
  { msg: "Rashi's calls today", expected: 'PERSON_PERFORMANCE', expectedNames: ['Rashi'] },
  { msg: 'Hi Shifu', expected: 'CASUAL_CHAT' },
];

let pass = 0;
for (const c of cases) {
  const result = classifyIntent(c.msg);
  let ok = result.intent === c.expected;
  const problems: string[] = [];
  if (!ok) problems.push(`intent: got ${result.intent}, expected ${c.expected}`);

  if (c.expectedNames) {
    const got = result.entities.personNames ?? [];
    const namesMatch = got.length === c.expectedNames.length && got.every((n, i) => n === c.expectedNames![i]);
    if (!namesMatch) {
      ok = false;
      problems.push(`personNames: got [${got.join(', ')}], expected [${c.expectedNames.join(', ')}]`);
    }
  }

  if (c.expectedLeadCode) {
    const got = result.entities.leadCode ?? null;
    if (got !== c.expectedLeadCode) {
      ok = false;
      problems.push(`leadCode: got ${got}, expected ${c.expectedLeadCode}`);
    }
  }

  if (ok) pass++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  "${c.msg}"${ok ? '' : '  -> ' + problems.join(' | ')}`);
}
console.log(`\n${pass}/${cases.length} passed`);
if (pass !== cases.length) process.exit(1);
