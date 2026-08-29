// app/lib/shifu/chat-handler.ts — Phase B, revised in Phase B.1.
//
// The orchestrator: USER QUESTION -> intent -> entity resolution ->
// permission check -> date/range resolution -> correct context function
// -> verified structured facts -> deterministic answer -> [Gemini rewrite
// ONLY for casual/wellness, see Phase B.1 note below] -> final response.
//
// PHASE B.1 POLICY CHANGE (user-flagged item 3, restated from
// numeric-guard.ts): Gemini no longer rewrites any answer that carries
// verified CRM numbers. For every 'verified_crm' result, the deterministic
// text from deterministic-answers.ts IS the final message, unmodified —
// there is no Gemini call for that path at all now. Gemini is only
// invoked for CASUAL_CHAT/WELLNESS, which never touch context.ts or carry
// CRM facts. See numeric-guard.ts's shouldCallGeminiForRewrite() for the
// single source of truth on this policy.
//
// PHASE B.1 POLICY CHANGE (user-flagged item 4): client-supplied
// `history` is never sent to Gemini for operational/CRM answers — this is
// now automatic and structural, not a separate check, because Gemini
// isn't called at all on that path per the policy above. For
// CASUAL_CHAT/WELLNESS, sanitized history may still be used (see
// sanitizeHistoryForCasualChat below) since those replies never contain
// CRM facts for fabricated history to corrupt — but the history is still
// capped and filtered, not trusted blindly.

import { classifyIntent } from './intent-router';
import { parseDateRequest, rangeLabelToWords } from './range-parser';
import { buildDeterministicAnswer, type DeterministicResult } from './deterministic-answers';
import { buildRoleBlock } from './prompts';
import { callGemini } from './gemini-client';
import { applyGeminiRewrite, shouldCallGeminiForRewrite } from './numeric-guard';
import type { ShifuSession } from './permissions';

const SHIFT_START_HOUR = 10;
const SHIFT_END_HOUR = 19;
const SHIFT_DAYS = [1, 2, 3, 4, 5, 6]; // Mon-Sat

function istNow(): { hour: number; weekday: number; label: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false, weekday: 'short' });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const label = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
  return { hour: Number(get('hour')), weekday: weekdayMap[get('weekday')] ?? 0, label };
}

function isOnShift(): boolean {
  const { hour, weekday } = istNow();
  return SHIFT_DAYS.includes(weekday) && hour >= SHIFT_START_HOUR && hour < SHIFT_END_HOUR;
}

export type ShifuChatResponse = {
  message: string;
  intent: string;
  source: DeterministicResult['source'] | 'casual';
  subject?: DeterministicResult['subject'];
  range?: string;
  actions?: { label: string; action: string }[];
  candidates?: { id: number; name: string; role: string }[];
  // Phase B.2 addition — only populated for PRESALES_AGENT_BREAKDOWN.
  rows?: DeterministicResult['rows'];
  totals?: DeterministicResult['totals'];
  // Phase B.3 additions — only populated for LATEST_QUALIFICATION /
  // DAILY_QUALIFICATION_COUNT respectively.
  latestQualification?: DeterministicResult['latestQualification'];
  totalQualified?: DeterministicResult['totalQualified'];
};

const CASUAL_FALLBACKS: Record<'CASUAL_CHAT' | 'WELLNESS', string> = {
  CASUAL_CHAT: "Hey! I'm here if you need anything.",
  WELLNESS: "That sounds like a good idea — take a short break.",
};

/**
 * Phase B.3.1 fix (user-flagged item 1). Most verified_crm answers are
 * genuinely scoped to the parsed range, so reporting `rangeWords` back in
 * the response is correct. LATEST_QUALIFICATION is different: it's an
 * intentional ALL-HISTORY lookup (getLatestQualification() has no date
 * filter at all — see its doc comment in context.ts), so if a user asks
 * "When was the last lead qualified?" with no date mentioned,
 * parseDateRequest() still resolves a default rangeLabel of 'today' (that
 * default is correct and unchanged for every OTHER intent), and reporting
 * `range: "today"` on this particular answer would be actively
 * misleading — the answer might be describing something that happened
 * three weeks ago. This function is the single place that decides what
 * `range` gets reported, so future all-time (non-range-scoped) intents
 * have one obvious spot to add themselves, rather than each one needing
 * its own ad hoc fix in the return statement below. Exported and unit-
 * tested directly (see phase-b3-1-units.test.ts) — the test proves the
 * override wins even when `rangeWords` is literally 'today', so this
 * can't regress by someone changing the range-parsing default later.
 */
export function resolveResponseRangeLabel(intent: string, source: DeterministicResult['source'], rangeWords: string): string | undefined {
  if (intent === 'LATEST_QUALIFICATION') return 'all_time';
  return source === 'verified_crm' ? rangeWords : undefined;
}

export type HistoryEntry = { role: 'user' | 'model'; text: string };

const LEAD_CODE_IN_HISTORY_RE = /\bTLS-\d{3,}\b/i;
const SUSPICIOUS_INJECTION_RE = /\b(ignore (all |the )?(previous|above|prior) instructions?|disregard (all |the )?(previous|above|prior)|system\s*:|you are now|new instructions?:)\b/i;
const MAX_HISTORY_ENTRIES = 6; // tighter than Phase B's 12, per item 4
const MAX_ENTRY_LENGTH = 300; // caps injection payload size per entry

/**
 * Phase B.1 addition (item 4). Client-supplied conversation history is
 * untrusted input — the client could fabricate a "model" turn claiming
 * Shifu previously stated some CRM number, or embed a prompt-injection
 * attempt. Since this is only ever used for CASUAL_CHAT/WELLNESS (never
 * for verified CRM answers, per the policy above), the stakes are lower,
 * but "lower" isn't "none": this strips any entry that looks like it's
 * trying to smuggle in a lead code (as if referencing real CRM data) or a
 * system-prompt-override attempt, and caps both entry count and length.
 * Exported and unit-tested directly (see phase-b1-units.test.ts).
 */
export function sanitizeHistoryForCasualChat(history: HistoryEntry[]): HistoryEntry[] {
  return history
    .filter((h) => typeof h.text === 'string' && h.text.trim().length > 0)
    .filter((h) => !LEAD_CODE_IN_HISTORY_RE.test(h.text))
    .filter((h) => !SUSPICIOUS_INJECTION_RE.test(h.text))
    .slice(-MAX_HISTORY_ENTRIES)
    .map((h) => ({ role: h.role, text: h.text.slice(0, MAX_ENTRY_LENGTH) }));
}

/**
 * Dev-only timing collector, per brief item 18. Never exposed in the
 * response body or to the client — logged server-side only, and only the
 * elapsed milliseconds, never message content beyond the intent label.
 */
class Timing {
  private marks: [string, number][] = [];
  private start = performance.now();
  mark(label: string) {
    this.marks.push([label, performance.now() - this.start]);
  }
  flush(intent: string) {
    const line = this.marks.map(([label, ms], i) => {
      const prev = i === 0 ? 0 : this.marks[i - 1][1];
      return `${label}=${(ms - prev).toFixed(0)}ms`;
    });
    console.log(`[Shifu] intent=${intent} ${line.join(' ')} total=${(performance.now() - this.start).toFixed(0)}ms`);
  }
}

export async function handleShifuChat(
  session: ShifuSession,
  message: string,
  history: HistoryEntry[] = []
): Promise<ShifuChatResponse> {
  const timing = new Timing();
  const trimmed = (message || '').trim();
  if (!trimmed) {
    return { message: "I didn't catch that — try asking me something.", intent: 'CASUAL_CHAT', source: 'casual' };
  }

  const { intent, entities } = classifyIntent(trimmed);
  timing.mark('intent');

  const { label: rangeLabel, explicitDate } = parseDateRequest(trimmed);
  const rangeWords = rangeLabelToWords(rangeLabel, explicitDate);
  timing.mark('range');

  // Phase B.2 (item 1): a clearly-attempted-but-unparseable date must
  // never silently fall through to 'today'. This is checked here, after
  // CASUAL_CHAT/WELLNESS have their own early return below (those never
  // use rangeLabel at all, so a coincidental false-positive there would
  // otherwise block ordinary conversation for no reason) but before every
  // CRM-answering intent, so the guard applies uniformly regardless of
  // which intent was classified — not just the new per-agent breakdown.
  const isCasualIntent = intent === 'CASUAL_CHAT' || intent === 'WELLNESS';
  if (!isCasualIntent && rangeLabel === 'unrecognized_date') {
    timing.mark('gemini_skipped');
    timing.flush(intent);
    return {
      message: "I couldn't match that to a real calendar date — try a format like '27 Aug', 'August 27th', or '27/08/2026'.",
      intent,
      source: 'unsupported',
    };
  }

  // CASUAL_CHAT / WELLNESS never touch the CRM, per brief sections 14/15,
  // and are the ONLY path where Gemini is ever called, per the Phase B.1
  // policy — shouldCallGeminiForRewrite('casual') is the only true case.
  if (intent === 'CASUAL_CHAT' || intent === 'WELLNESS') {
    const fallback = CASUAL_FALLBACKS[intent];
    const onShift = isOnShift();
    const { label: timeLabel } = istNow();
    const roleBlock = buildRoleBlock(session.role);
    const wellnessNote =
      intent === 'WELLNESS'
        ? "\n\nNote: persistent reminders are not available yet — if the user asks you to remind them of something later, say you can't save a reminder yet rather than pretending you did."
        : '';
    const systemPrompt = `${roleBlock}\n\nThis is casual conversation, not a data question. No CRM figures are needed — respond warmly and briefly (1-3 sentences).${wellnessNote}\n\nIt is currently ${timeLabel} IST.`;
    timing.mark('context');
    const sanitizedHistory = sanitizeHistoryForCasualChat(history);
    const shouldCallGemini = shouldCallGeminiForRewrite('casual');
    const gemini = shouldCallGemini ? await callGemini(systemPrompt, trimmed, sanitizedHistory) : { text: null };
    timing.mark('gemini');
    const guarded = applyGeminiRewrite(fallback, gemini.text);
    timing.mark('guard');
    timing.flush(intent);
    void onShift;
    return { message: guarded.finalText, intent, source: 'casual' };
  }

  // Every other intent goes through the verified-facts pipeline.
  const result = await buildDeterministicAnswer(session, intent, entities, rangeLabel, trimmed, explicitDate);
  timing.mark('context');

  // Phase B.1: shouldCallGeminiForRewrite(result.source) is always false
  // here (result.source is never 'casual') — verified_crm and every
  // error/denial/unsupported outcome all go straight to the user exactly
  // as deterministic-answers.ts wrote them. No Gemini call, no
  // client-supplied history anywhere near this path. This single check is
  // kept explicit (rather than just deleting the old Gemini-call block)
  // so the policy is enforced by one readable line, not by omission.
  if (!shouldCallGeminiForRewrite(result.source)) {
    timing.mark('gemini_skipped');
    timing.flush(intent);
    return {
      message: result.text,
      intent,
      source: result.source,
      subject: result.subject,
      range: resolveResponseRangeLabel(intent, result.source, rangeWords),
      candidates: result.candidates,
      actions: result.leadCode ? [{ label: 'Open Lead', action: `OPEN_LEAD:${result.leadCode}` }] : undefined,
      rows: result.rows,
      totals: result.totals,
      latestQualification: result.latestQualification,
      totalQualified: result.totalQualified,
    };
  }

  // Unreachable under the current policy (kept only so this function's
  // shape stays stable if a future pass ever adds a rewrite-eligible
  // source) — deliberately not deleted, since "unreachable today" is not
  // the same guarantee as "structurally impossible", and removing it
  // would just mean re-adding it correctly later if that ever changes.
  timing.flush(intent);
  return { message: result.text, intent, source: result.source, subject: result.subject, range: rangeWords };
}
