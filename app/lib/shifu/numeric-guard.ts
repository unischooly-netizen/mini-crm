// app/lib/shifu/numeric-guard.ts — Phase B, redesigned in Phase B.1.
//
// PHASE B.1 POLICY CHANGE (user-flagged item 3) — read this first.
// The original Phase B design let Gemini rewrite any deterministic answer
// (including ones full of CRM numbers) and then checked afterwards that
// every number in Gemini's version already existed somewhere in the
// source text (a set-membership check). That check has a real gap: it
// cannot detect a SWAP. Given source text "47 calls, 13 connected",
// Gemini could return "13 calls, 47 connected" — both numbers are present
// in the source, so the old check would accept it, but the answer is now
// wrong. This is demonstrated directly in phase-b1-units.test.ts.
//
// I don't think a better set-membership-style check can close this gap
// completely — the real fix is not to compare number SETS but to make
// sure numbers stay attached to their meaning, and the only fully robust
// way to guarantee that is to never let Gemini touch the numbers at all.
// A "stronger fact-label-preserving validation mechanism" (e.g. having
// Gemini return a template with placeholders like "{calls} calls,
// {connected} connected" that get filled in server-side from the verified
// facts, so Gemini never sees or writes an actual digit) would close this
// properly, but it's meaningfully more complex — new prompt design, a
// placeholder grammar, parsing/fallback for malformed templates — for a
// benefit (a slightly more natural-sounding numeric sentence) that's
// small next to hand-writing the deterministic templates in Shifu's voice
// directly, which is already free. So: adopting the user's proposed
// design as the V1 answer, not the placeholder-template approach.
//
// FINAL POLICY: Gemini never rewrites an answer that carries verified CRM
// numbers. `deterministic-answers.ts`'s `text` output for every
// 'verified_crm' result IS the final message shown to the user, written
// in Shifu's voice directly (see the "sound like Shifu" pass applied to
// those templates). Gemini is only invoked at all for CASUAL_CHAT /
// WELLNESS, which never carry CRM facts by construction — see
// shouldCallGeminiForRewrite() below, which chat-handler.ts checks before
// ever making a Gemini call. This closes the swap-vulnerability
// completely: there is no rewrite step for numeric answers to have a bug
// in, because there is no rewrite step.
//
// The original set-membership functions (extractNumbers /
// allNumbersAccountedFor / applyGeminiRewrite) are KEPT — not deleted —
// and still run for the CASUAL_CHAT/WELLNESS path, as a second line of
// defense: those replies normally contain no numbers at all, so this
// quietly blocks Gemini from slipping a stray, uncited number into casual
// conversation. It is explicitly no longer the only or primary protection
// for CRM numbers, per the user's instruction — that job now belongs to
// shouldCallGeminiForRewrite() simply never letting Gemini near them.

const NUMBER_RE = /\d+(?:\.\d+)?%?/g;

export function extractNumbers(text: string): string[] {
  return text.match(NUMBER_RE) ?? [];
}

export function allNumbersAccountedFor(sourceText: string, candidateText: string): boolean {
  const sourceNumbers = new Set(extractNumbers(sourceText));
  const candidateNumbers = extractNumbers(candidateText);
  return candidateNumbers.every((n) => sourceNumbers.has(n));
}

export type GuardResult = {
  finalText: string;
  usedGemini: boolean;
  rejectedReason?: string;
};

/** Only ever called for the CASUAL_CHAT/WELLNESS path now — see policy note above. */
export function applyGeminiRewrite(deterministicText: string, geminiText: string | null): GuardResult {
  if (!geminiText || !geminiText.trim()) {
    return { finalText: deterministicText, usedGemini: false, rejectedReason: 'empty_gemini_response' };
  }
  if (!allNumbersAccountedFor(deterministicText, geminiText)) {
    return { finalText: deterministicText, usedGemini: false, rejectedReason: 'introduced_unverified_number' };
  }
  return { finalText: geminiText.trim(), usedGemini: true };
}

/**
 * The Phase B.1 policy gate. `source` is a DeterministicResult['source']
 * for CRM-backed answers, or the literal 'casual' tag chat-handler.ts
 * uses for CASUAL_CHAT/WELLNESS (which never touch context.ts at all).
 * Only 'casual' returns true. Every CRM-facts or CRM-adjacent outcome —
 * verified_crm, permission_denied, not_found, ambiguous, unsupported —
 * returns false, so the deterministic text is always the final answer for
 * anything that came anywhere near real data.
 */
export function shouldCallGeminiForRewrite(source: string): boolean {
  return source === 'casual';
}
