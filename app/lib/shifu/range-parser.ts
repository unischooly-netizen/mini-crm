// app/lib/shifu/range-parser.ts — Phase B.
//
// Pure, DB-free date-range detection from the raw message text — same
// design principle as intent-router.ts: this file only proposes a range
// LABEL from keywords, it never touches the database or computes actual
// start/end dates itself. The actual start/end dates come from
// context.ts's todayRange()/yesterdayRange()/thisWeekRange(), which are
// the single source of truth for what those labels mean in IST. Kept
// separate from intent classification (a message's intent and its date
// range are independent questions — "how many calls yesterday" and "how
// many calls today" are the same intent, MY_CALLS, with different ranges).

export type RangeLabel = 'today' | 'yesterday' | 'this_week';

const YESTERDAY_RE = /\byesterday\b/i;
const THIS_WEEK_RE = /\b(this\s+week|so\s+far\s+this\s+week|week\s+so\s+far)\b/i;

/**
 * Defaults to 'today' when no range word is present — matches the brief's
 * instruction: "Default operational questions to TODAY when no range is
 * stated and that is the natural interpretation." Snapshot-style questions
 * (e.g. "how many leads are waiting for counsellor assignment") don't use
 * this range at all — the snapshot/period split from Phase A already
 * ensures snapshot facts never get date-filtered regardless of what this
 * function returns, so defaulting to 'today' here is safe even for
 * snapshot questions; callers that need a snapshot simply ignore the range.
 */
export function parseRangeLabel(message: string): RangeLabel {
  if (YESTERDAY_RE.test(message)) return 'yesterday';
  if (THIS_WEEK_RE.test(message)) return 'this_week';
  return 'today';
}

export function rangeLabelToWords(label: RangeLabel): string {
  if (label === 'yesterday') return 'yesterday';
  if (label === 'this_week') return 'this week';
  return 'today';
}
