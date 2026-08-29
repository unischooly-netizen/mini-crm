// app/api/dev/shifu-parity/route.ts
//
// *** TEMPORARY DEV DIAGNOSTIC — NOT PART OF MR. SHIFU'S PRODUCT SURFACE. ***
// This route exists only to validate the Phase A metrics engine once,
// before Phase B wires it into the live chat. It is not linked from any
// page, has no UI, and is not something end users are meant to know about.
// Once it has been run and expectedButMismatchedCount is confirmed at 0,
// it should be deleted or disabled (e.g. removed from the deployed repo, or
// gated behind an env var that defaults off) — it should not linger in
// production indefinitely as a standing admin-only data-dump endpoint.
//
// Phase A.2 item 4 — a dev-only, admin-only, read-only diagnostic endpoint.
// It does NOT touch, wrap, or replace any production dashboard route; it
// calls the real existing /api/dashboards/ceo and /api/dashboards/today-followup
// routes exactly as a logged-in admin's browser would (same-origin fetch,
// forwarding the admin's own session cookie), and separately computes the
// same figures using the new lib/performanceMetrics.ts + app/lib/shifu/
// context.ts engine. It then lines the two up field-by-field so a human can
// see, in one JSON response, which figures are expected to match exactly,
// which are expected to differ on purpose (and why), and — most
// importantly — flags anything in the "expected to match" bucket that
// doesn't, because that would mean a real bug, not a known difference.
//
// This design was chosen specifically so it never re-implements ceo's or
// today-followup's business logic (per the standing rule: "do not
// duplicate metric definitions if a reliable calculation already exists")
// — it calls the real routes over HTTP and compares outputs, it does not
// guess at what they compute.
//
// IMPORTANT — I could not execute this myself. I have no database
// credentials and no authenticated session against the deployed app from
// my sandbox, so I cannot produce real pass/fail numbers for this script
// the way I did for the intent-router tests. This needs to be deployed
// (added as a genuinely new route — it changes nothing existing) and then
// opened by an admin at /api/dev/shifu-parity to get real output. I am not
// claiming it has been run.
//
// Field mapping below was derived by actually reading the current source
// of app/api/dashboards/ceo/route.ts and app/api/dashboards/today-followup/route.ts
// (fetched fresh during this Phase A.2 pass), not assumed from memory. Two
// notable findings from that read, both relevant to items already fixed in
// this pass:
//   1. ceo's `today.followupsDueToday` and `today.overdueNow` both apply
//      ZERO status/qualification exclusion — a second, independent
//      confirmation (alongside today-followup/route.ts) that the exclusion
//      removed from getPresalesAgentMetrics/getCounsellorMetrics in this
//      pass was correct to remove.
//   2. today-followup/route.ts's own "overdue" KPI is NOT the same concept
//      as Shifu's followupsOverdue — it means "due today, but the time
//      slot already passed" (nextFollowupTime < now, scoped to
//      next_followup_date = today only). It does not query prior-day
//      backlog at all. ceo's `today.overdueNow` (next_followup_date <
//      today, no exclusion) is the real match for Shifu's followupsOverdue,
//      not today-followup's "overdue" field — mapped correctly below.

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { fetchAllLeadsRich, computeSnapshot, computePeriod, followupCounts } from '@/lib/performanceMetrics';

type Row = {
  field: string;
  ceoOrDashboardValue: number | null;
  shifuValue: number | null;
  category: 'expected_match' | 'intentional_difference';
  note: string;
};

function istToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });
  if (session.role !== 'admin') return NextResponse.json({ error: 'Admin only — this is a diagnostic tool.' }, { status: 403 });

  try {
    const origin = request.nextUrl.origin;
    const cookie = request.headers.get('cookie') || '';
    const today = istToday();

    const [ceoRes, followupRes] = await Promise.all([
      fetch(`${origin}/api/dashboards/ceo`, { headers: { cookie }, cache: 'no-store' }),
      fetch(`${origin}/api/dashboards/today-followup`, { headers: { cookie }, cache: 'no-store' }),
    ]);
    if (!ceoRes.ok) return NextResponse.json({ error: `ceo dashboard fetch failed: ${ceoRes.status}` }, { status: 500 });
    if (!followupRes.ok) return NextResponse.json({ error: `today-followup fetch failed: ${followupRes.status}` }, { status: 500 });
    const ceo = await ceoRes.json();
    const followup = await followupRes.json();

    const leads = await fetchAllLeadsRich();
    const snapshot = computeSnapshot(leads);
    const period = computePeriod(leads, { start: today, end: today });
    const fc = followupCounts(leads, today, false); // false = no exclusion, matching the Phase A.2 fix

    const rows: Row[] = [
      {
        field: 'currently qualified (whole org, no filters)',
        ceoOrDashboardValue: ceo?.kpis?.qualified ?? null,
        shifuValue: snapshot.currentQualified,
        category: 'expected_match',
        note: 'Both count qualification_status = Qualified over every lead with no date/other filter applied.',
      },
      {
        field: 'currently meeting-done (connecting_status = Joined)',
        ceoOrDashboardValue: ceo?.kpis?.meetingDone ?? null,
        shifuValue: snapshot.currentMeetingDone,
        category: 'expected_match',
        note: "Standardized on connecting_status = 'Joined' as canonical (Phase A.1 fix #8) — both sides now use it.",
      },
      {
        field: 'currently trial-done',
        ceoOrDashboardValue: ceo?.kpis?.trialDone ?? null,
        shifuValue: snapshot.currentTrialDone,
        category: 'expected_match',
        note: 'Both count trial_status = Trial Done over the whole org.',
      },
      {
        field: 'currently admission won',
        ceoOrDashboardValue: ceo?.kpis?.admissionWon ?? null,
        shifuValue: snapshot.currentAdmissionWon,
        category: 'expected_match',
        note: 'Both count admission_status = Closed Won over the whole org.',
      },
      {
        field: "today's follow-ups due (next_followup_date = today)",
        ceoOrDashboardValue: followup?.kpis?.totalDueToday ?? null,
        shifuValue: fc.followupsDueToday,
        category: 'expected_match',
        note: 'Phase A.2 fix: both now apply zero status/qualification exclusion. This is the field the fix was made to match.',
      },
      {
        field: 'overdue follow-ups (next_followup_date < today, prior-day backlog)',
        ceoOrDashboardValue: ceo?.today?.overdueNow ?? null,
        shifuValue: fc.followupsOverdue,
        category: 'expected_match',
        note: "Matched against ceo's today.overdueNow, NOT today-followup's \"overdue\" field — that field means something different (see file header). ceo.today.overdueNow also applies zero exclusion, independently confirming the Phase A.2 fix.",
      },
      {
        field: "today's call attempts",
        ceoOrDashboardValue: ceo?.today?.callAttemptsToday ?? null,
        shifuValue: period.callsInRange,
        category: 'expected_match',
        note: 'Both count attempt{n}_date = today across all leads, whole org, no other filter.',
      },
      {
        field: "today's qualified count",
        ceoOrDashboardValue: ceo?.today?.qualifiedToday ?? null,
        shifuValue: period.qualifiedInRange,
        category: 'expected_match',
        note: 'Both use qualified_at = today.',
      },
      {
        field: "today's meetings",
        ceoOrDashboardValue: ceo?.today?.meetingsToday ?? null,
        shifuValue: period.meetingsScheduledInRange,
        category: 'expected_match',
        note: 'Both use meeting_date = today (the documented proxy field — see performanceMetrics.ts header for its known limitation).',
      },
      {
        field: "today's admissions (won + lost combined)",
        ceoOrDashboardValue: ceo?.today?.admissionsToday ?? null,
        shifuValue: period.admissionsWonInRange + period.admissionsLostInRange,
        category: 'expected_match',
        note: "ceo's admissionsToday does not split by outcome; Shifu's engine deliberately stores admissionsWonInRange / admissionsLostInRange separately (so Shifu can say which), and combines them only here for parity. Once summed, both sides represent the exact same underlying business number (admission_timestamp = today, any outcome) — so this is expected to match exactly, and a mismatch here is a real bug, not a known shape difference.",
      },
      {
        field: 'qualified rate (org-wide)',
        ceoOrDashboardValue: ceo?.kpis?.qualifiedRate ?? null,
        shifuValue: snapshot.currentQualified && leads.length ? snapshot.currentQualified / leads.length : 0,
        category: 'expected_match',
        note: 'Both are currentQualified / total lead count with no filters.',
      },
      {
        field: 'pending VH (qualified, no VH assigned yet)',
        ceoOrDashboardValue: ceo?.kpis?.pendingVh ?? null,
        shifuValue: snapshot.currentPendingVh,
        category: 'intentional_difference',
        note: "ceo's version checks assignedVhName (string null-check); Shifu's engine checks assignedVhUserId (Phase A.1 fix #4, ID-based). These should produce the same count in clean data, but if any row somehow has a VH name with no VH user ID (or vice versa) they would diverge — a real, if unlikely, data-quality case rather than a bug in either calculation. Worth investigating if this row does not match.",
      },
    ];

    const expectedButMismatched = rows.filter((r) => r.category === 'expected_match' && r.ceoOrDashboardValue !== r.shifuValue);

    return NextResponse.json({
      comparedAt: new Date().toISOString(),
      dateUsedForTodayFigures: today,
      rows,
      summary: {
        totalCompared: rows.length,
        expectedMatchCount: rows.filter((r) => r.category === 'expected_match').length,
        expectedButMismatchedCount: expectedButMismatched.length,
        expectedButMismatchedFields: expectedButMismatched.map((r) => r.field),
      },
    });
  } catch (err) {
    console.error('GET /api/dev/shifu-parity failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown server error.';
    return NextResponse.json({ error: `Parity check failed: ${message}` }, { status: 500 });
  }
}
