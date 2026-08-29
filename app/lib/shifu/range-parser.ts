// app/lib/shifu/range-parser.ts — Phase B, extended in Phase B.2.
//
// Pure, DB-free date-range detection from the raw message text — same
// design principle as intent-router.ts: this file only proposes a range
// from keywords/patterns, it never touches the database or computes
// derived business figures itself. The actual start/end dates for the
// keyword labels come from context.ts's todayRange()/yesterdayRange()/
// thisWeekRange(), which remain the single source of truth for what
// those labels mean in IST. Kept separate from intent classification (a
// message's intent and its date range are independent questions).
//
// PHASE B.2 ADDITION (user-flagged capability gap): admin questions can
// now name an explicit calendar date ("On 27th August...", "27/08/2026",
// etc.) instead of only today/yesterday/this week. Two new outcomes were
// added to support this safely:
//   - 'explicit_date': a specific calendar date was named and parsed
//     successfully. The resolved ISO date travels alongside the label
//     (see ParsedDateRequest.explicitDate) rather than folding it into
//     the RangeLabel string itself, so every existing `rangeLabel ===
//     'today'` / rangeMismatchNote() check elsewhere keeps working
//     unchanged for this new case (an explicit date is never 'today',
//     which is exactly the correct snapshot-vs-period behavior).
//   - 'unrecognized_date': the message clearly attempted to name a date
//     (a month name next to a day number, or a D/M/Y or D-M-Y numeric
//     pattern with a 4-digit year) but it didn't resolve to a real
//     calendar date (bad day-of-month, bad month, Feb 29 in a non-leap
//     year, etc.). This is deliberately kept distinct from the plain
//     'today' default — silently answering "today" for a mistyped date
//     would be a wrong answer dressed up as a right one, the same failure
//     mode Phase B.1 fixed for snapshot-vs-period. Callers (chat-handler)
//     must short-circuit on this outcome with a clarification message
//     before dispatching to any intent handler, for ANY intent — not just
//     the new Pre-Sales breakdown one.

export type RangeLabel = 'today' | 'yesterday' | 'this_week' | 'explicit_date' | 'unrecognized_date';

export type ParsedDateRequest = {
  label: RangeLabel;
  /** Only set when label === 'explicit_date'. ISO 'YYYY-MM-DD'. */
  explicitDate?: string;
};

const YESTERDAY_RE = /\byesterday\b/i;
const THIS_WEEK_RE = /\b(this\s+week|so\s+far\s+this\s+week|week\s+so\s+far)\b/i;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH_WORD = '(jan\\.?|january|feb\\.?|february|mar\\.?|march|apr\\.?|april|may|jun\\.?|june|jul\\.?|july|aug\\.?|august|sep\\.?|sept\\.?|september|oct\\.?|october|nov\\.?|november|dec\\.?|december)';

// "27 Aug", "27 August", "27th Aug", "27th August" (optional trailing year)
const DATE_DAY_MONTH_RE = new RegExp(`\\b(\\d{1,2})(st|nd|rd|th)?\\s+${MONTH_WORD}\\.?\\s*,?\\s*(\\d{4})?\\b`, 'i');
// "August 27", "August 27th" (optional trailing year)
const DATE_MONTH_DAY_RE = new RegExp(`\\b${MONTH_WORD}\\.?\\s+(\\d{1,2})(st|nd|rd|th)?\\s*,?\\s*(\\d{4})?\\b`, 'i');
// "27/08/2026" or "27-08-2026" — day-first (Indian convention); year required
// so this pattern can't misfire on ordinary numbers in chat (e.g. phone
// extensions, lead counts). Day-first is confirmed unambiguous by the
// brief's own example (27/08/2026 — 08 can only be a month, 27 can't).
const DATE_NUMERIC_RE = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/;

// Broader "this looks like an attempted date" detector, used ONLY to
// distinguish "no date mentioned at all" (-> default 'today') from "a
// date was attempted but didn't parse cleanly" (-> 'unrecognized_date').
// Deliberately not the same as the strict patterns above: this one
// doesn't require a valid day-of-month or a sane month, just the general
// shape of a date (a number next to a month name, or three numbers
// separated by / or - with a 4-digit year).
const LOOKS_LIKE_DATE_ATTEMPT_RE = new RegExp(
  `\\b\\d{1,2}(st|nd|rd|th)?\\s+${MONTH_WORD}[a-z]*\\b|\\b${MONTH_WORD}[a-z]*\\s+\\d{1,2}(st|nd|rd|th)?\\b|\\b\\d{1,2}[/-]\\d{1,2}[/-]\\d{4}\\b`,
  'i'
);

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(month: number, year: number): number {
  // new Date(Date.UTC(year, month, 0)) rolls back to the last day of the
  // 1-indexed target `month` because the Date constructor's month slot is
  // 0-indexed — passing the 1-indexed month directly lands one month
  // ahead, and day 0 of that month is the last day of the target month.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Pure "what's today in IST" — duplicated intentionally from context.ts's
 * istToday(). This module must stay DB-free/importable without a
 * DATABASE_URL (context.ts pulls in lib/db.ts, which eagerly connects at
 * import time — see phase-b1-units.test.ts's need for a dummy
 * DATABASE_URL as a direct consequence of that). This is a generic
 * date/time utility, not a CRM business-metric definition, so duplicating
 * it here does not violate the "don't invent new metric logic" rule that
 * governs functions like getPresalesBreakdown. */
function istTodayParts(): { year: number; month: number; day: number } {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()); // 'YYYY-MM-DD'
  const [y, m, dd] = d.split('-').map(Number);
  return { year: y, month: m, day: dd };
}

/**
 * Builds an ISO date string from day/month and an optional year, applying
 * calendar validity checks (real month, real day-of-month for that month
 * including leap years). Returns null if the date is not a real calendar
 * date — callers treat that as an "attempted but unrecognized" date, never
 * as "no date at all".
 *
 * Year resolution when omitted: use the current IST year. If that lands
 * strictly after today (IST) — e.g. it's January and someone says "27
 * Aug" with no year, which in the current year hasn't happened yet — roll
 * back one year, since this is a reporting tool over past business
 * activity and a "date" that's actually still in the future almost never
 * reflects the user's intent. A date that resolves to today or the past
 * in the current year is left as-is.
 */
function resolveExplicitDate(day: number, month: number, yearStr?: string): string | null {
  if (month < 1 || month > 12) return null;
  if (day < 1) return null;

  const today = istTodayParts();
  let year: number;
  if (yearStr) {
    year = Number(yearStr);
  } else {
    year = today.year;
    const candidateIsFuture = month > today.month || (month === today.month && day > today.day);
    if (candidateIsFuture) year -= 1;
  }

  if (day > daysInMonth(month, year)) return null; // e.g. 31 Feb, or 29 Feb in a non-leap year
  if (month === 2 && day === 29 && !isLeapYear(year)) return null; // belt-and-braces, covered above too

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function tryParseExplicitDate(message: string): string | null | undefined {
  // undefined = no explicit-date pattern matched at all (caller falls
  // through to the "loose attempt" check). null = a pattern matched but
  // didn't resolve to a real date. string = resolved ISO date.
  const numeric = message.match(DATE_NUMERIC_RE);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const year = numeric[3];
    return resolveExplicitDate(day, month, year);
  }
  const dayMonth = message.match(DATE_DAY_MONTH_RE);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const monthWord = dayMonth[3].toLowerCase().replace(/\.$/, '');
    const month = MONTHS[monthWord];
    return resolveExplicitDate(day, month, dayMonth[4]);
  }
  const monthDay = message.match(DATE_MONTH_DAY_RE);
  if (monthDay) {
    const monthWord = monthDay[1].toLowerCase().replace(/\.$/, '');
    const month = MONTHS[monthWord];
    const day = Number(monthDay[2]);
    return resolveExplicitDate(day, month, monthDay[4]);
  }
  return undefined;
}

/**
 * Defaults to 'today' when no range word or date is present — matches the
 * brief's instruction: "Default operational questions to TODAY when no
 * range is stated and that is the natural interpretation." Snapshot-style
 * questions (e.g. "how many leads are waiting for counsellor assignment")
 * don't use this range at all — the snapshot/period split from Phase A
 * already ensures snapshot facts never get date-filtered regardless of
 * what this function returns.
 *
 * PHASE B.2: now also recognizes explicit calendar dates (see the
 * 'explicit_date' / 'unrecognized_date' outcomes documented on RangeLabel
 * above), checked first since it's the most specific signal.
 */
export function parseDateRequest(message: string): ParsedDateRequest {
  const explicit = tryParseExplicitDate(message);
  if (typeof explicit === 'string') return { label: 'explicit_date', explicitDate: explicit };
  if (explicit === null) return { label: 'unrecognized_date' };

  if (YESTERDAY_RE.test(message)) return { label: 'yesterday' };
  if (THIS_WEEK_RE.test(message)) return { label: 'this_week' };

  // No strict pattern matched — check the looser "attempted a date but it
  // didn't even have the right shape" detector before defaulting to
  // 'today'. This still requires a real month name or a full D/M/Y-with-
  // 4-digit-year shape, so it does not false-positive on ordinary numbers
  // in casual chat.
  if (LOOKS_LIKE_DATE_ATTEMPT_RE.test(message)) return { label: 'unrecognized_date' };

  return { label: 'today' };
}

/** Backward-compatible wrapper — returns just the label, as the pre-B.2
 * signature did. Kept for any call site that only needs the label and not
 * the explicit date value. */
export function parseRangeLabel(message: string): RangeLabel {
  return parseDateRequest(message).label;
}

export function rangeLabelToWords(label: RangeLabel, explicitDate?: string): string {
  if (label === 'yesterday') return 'yesterday';
  if (label === 'this_week') return 'this week';
  if (label === 'explicit_date') return explicitDate ?? 'that date';
  if (label === 'unrecognized_date') return 'that date'; // not expected to be shown; callers short-circuit before this
  return 'today';
}
