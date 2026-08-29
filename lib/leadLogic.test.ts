// lib/leadLogic.test.ts
//
// Pure, DB-free regression tests for computeQualifiedAt() — extracted
// from app/api/leads/[id]/route.ts's PATCH handler during the Aug 2026
// qualified_at diagnostic pass (Task 6). This is core CRM logic, not
// Shifu-specific, but it's what the diagnostic investigation (triggered
// by Shifu's LATEST_QUALIFICATION returning "no lead has been qualified
// yet" despite 529 currently-Qualified leads) traced the write path back
// to, so these tests live alongside the function they cover.
//
// Run with: npx tsx lib/leadLogic.test.ts
// (No DATABASE_URL needed — this file only imports pure functions from
// lib/leadLogic.ts, which has no DB dependency at all.)

import { computeQualifiedAt } from './leadLogic';

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

const T1 = '2026-08-20T10:00:00.000Z';
const T2 = '2026-08-27T15:30:00.000Z';

// ---------------------------------------------------------------------------
// non-Qualified -> Qualified sets qualified_at (server timestamp, not
// client-supplied — the caller passes nowIso, this function just uses
// whatever it's given, so the "server-side" guarantee lives in the
// caller always passing new Date().toISOString(), verified by inspection
// of app/api/leads/[id]/route.ts).
// ---------------------------------------------------------------------------

check(
  'brand-new lead (never qualified, existingQualifiedAt null) transitioning to Qualified sets qualified_at to now',
  computeQualifiedAt(false, 'Qualified', T1, null) === T1
);
check(
  'a lead that was Not Qualified transitioning to Qualified sets qualified_at to now',
  computeQualifiedAt(false, 'Qualified', T1, null) === T1
);
check(
  'a lead that was Follow-up Needed transitioning to Qualified sets qualified_at to now',
  computeQualifiedAt(false, 'Qualified', T1, null) === T1
);

// ---------------------------------------------------------------------------
// Unrelated update (still Qualified before and after this save — e.g. only
// `state`/`profession`/`remarks` changed, Final Outcome untouched) does
// NOT alter qualified_at.
// ---------------------------------------------------------------------------

check(
  'a save that does not change qualification status at all (already Qualified, still Qualified) leaves qualified_at untouched',
  computeQualifiedAt(true, 'Qualified', T2, T1) === T1
);

// ---------------------------------------------------------------------------
// Existing Qualified record edit (e.g. editing remarks, course start
// timeline, or re-saving the same Final Outcome) does not reset
// qualified_at — same code path as above, different real-world scenario,
// both explicitly requested as separate cases.
// ---------------------------------------------------------------------------

check(
  "editing an already-Qualified lead's other fields (remarks, course timeline) does not reset its original qualified_at",
  computeQualifiedAt(true, 'Qualified', T2, T1) === T1
);

// ---------------------------------------------------------------------------
// Requalification behavior, per the confirmed V1 semantic: Qualified ->
// Not Qualified -> Qualified again RE-STAMPS qualified_at to the second
// event's time (matches computeLifecycle()'s existing Revoked -> Active
// Qualified handling, which already treats this as a real, designed-for
// cycle) — this is deliberately NOT "keep the original forever".
// ---------------------------------------------------------------------------

check(
  'requalification (Qualified at T1, later reverted, now Qualified again at T2) re-stamps qualified_at to T2, not the original T1',
  computeQualifiedAt(false, 'Qualified', T2, T1) === T2
);
check(
  'requalification from Follow-up Needed after a prior qualification also re-stamps (wasQualified is false regardless of which non-Qualified state it detoured through)',
  computeQualifiedAt(false, 'Qualified', T2, T1) === T2
);

// ---------------------------------------------------------------------------
// A save that moves a lead AWAY from Qualified (un-qualifying it) must not
// itself write a qualified_at value — this function is only ever called
// for the qualified_at column, and un-qualifying doesn't match its
// !wasQualified && newStatus === 'Qualified' condition, so the existing
// (possibly already-set) value is preserved untouched, which is correct:
// un-qualifying doesn't erase the historical record of when it WAS
// qualified.
// ---------------------------------------------------------------------------

check(
  'un-qualifying a lead (was Qualified, now Not Qualified) leaves the existing qualified_at value untouched, not cleared',
  computeQualifiedAt(true, 'Not Qualified', T2, T1) === T1
);

const summary = pass + fail;
console.log(`\n${pass}/${summary} passed`);
if (fail > 0) process.exit(1);
