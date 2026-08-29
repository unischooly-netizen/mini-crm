// app/lib/shifu/gemini-client.ts — Phase B.
//
// Thin wrapper around the Gemini call, extracted from the exact working
// pattern already proven in the live app/api/shifu/route.ts (not
// reconstructed from memory — read directly from that file before writing
// this). Two fixes from that file are preserved here since they were real,
// previously-hit bugs, not defensive-programming guesses:
//   1. generationConfig.thinkingConfig.thinkingBudget = 0 — newer Gemini
//      models "think" before answering by default, which silently ate the
//      reply and left only a stray fragment.
//   2. Join every non-thought text part, not just parts[0] — a reply can
//      come back split across multiple parts.
//
// This module has exactly one job: given a system prompt and a user
// message, return Gemini's raw text (or null on any failure). It knows
// nothing about CRM facts, intents, or the numeric guard — that
// separation is what keeps "Gemini only rephrases" enforceable, since
// this file has no path by which Gemini's output could bypass
// numeric-guard.ts on its way back to the user.

export type GeminiCallResult = {
  text: string | null;
  errorReason?: string;
};

export async function callGemini(
  systemPrompt: string,
  userMessage: string,
  history: { role: 'user' | 'model'; text: string }[] = []
): Promise<GeminiCallResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { text: null, errorReason: 'missing_api_key' };

  const contents = [
    ...history.slice(-12).map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 400,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (!res.ok) {
      console.error('[Shifu] Gemini call failed:', res.status, await res.text().catch(() => ''));
      return { text: null, errorReason: `http_${res.status}` };
    }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts as { text?: string; thought?: boolean }[] | undefined;
    const text = parts
      ?.filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join('')
      .trim();
    const finishReason = data?.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      console.error('[Shifu] Gemini finished abnormally:', finishReason);
    }
    return { text: text || null, errorReason: text ? undefined : 'empty_response' };
  } catch (err) {
    console.error('[Shifu] Gemini call threw:', err);
    return { text: null, errorReason: 'exception' };
  }
}
