// app/lib/shifu/intent-router.ts — Phase A.1 correctness pass.
//
// Deterministic, keyword-based intent classification. No Gemini call here.
// Design note on person-name extraction: this router does NOT have access
// to the real users table (no DB call here — kept pure/fast/testable), so
// it can only ever *propose* a candidate name span using a capitalization
// heuristic (real names are capitalized, "you"/"it"/role words aren't).
// The actual validation happens downstream in context.ts's
// resolveUserByName() against the real users table — if the router guesses
// wrong or the name doesn't exist, that function returns zero matches and
// the chat handler (Phase B) can say "I don't have anyone by that name"
// rather than silently failing. Two-stage design: router proposes, DB
// confirms.
//
// I do not have direct read access to your users table to verify real
// name formats (single-word vs multi-word) — the screenshots I've seen
// only show single first names (Rashi, Shalini, Swati). The extraction
// below supports 1-3 word names as a reasonable default; if real names
// are consistently single-word, this is harmless slack, not a bug — but
// worth confirming against actual data before Phase B.

export type Intent =
  | 'CASUAL_CHAT'
  | 'MY_STATUS'
  | 'MY_CALLS'
  | 'MY_CONNECTED_CALLS'
  | 'MY_FOLLOWUPS'
  | 'MY_MEETINGS'
  | 'MY_TRIALS'
  | 'MY_ADMISSIONS'
  | 'MY_NEXT_ACTION'
  | 'MY_ATTENTION_ITEMS'
  | 'PERSON_PERFORMANCE'
  | 'TEAM_PERFORMANCE'
  | 'ROLE_PERFORMANCE'
  | 'TEAM_COMPARISON'
  | 'LEAD_LOOKUP'
  | 'PIPELINE_STATUS'
  | 'OPEN_LEAD'
  | 'NAVIGATE_TO_PAGE'
  | 'SNOOZE_SHIFU_ALERT'
  | 'WELLNESS';

export type Entities = { personNames?: string[]; leadCode?: string };
export type ClassifiedIntent = { intent: Intent; entities: Entities };

// Lead codes: every example observed across the live app (screenshots,
// pasted data, and lib/masters.ts usage) consistently shows "TLS-######"
// (TLS, hyphen, digits). I have not seen a code-generation function to
// confirm this is enforced/universal at the DB level — flagging that as
// unverified rather than assuming. Kept narrow (a real prefix, not a bare
// number pattern) to avoid false-positives on ordinary numbers in chat.
const LEAD_CODE_RE = /\bTLS-\d{3,}\b/i;

const ROLE_WORDS = /\b(pre-?sales|sales(?!person)|counsellors?|vertical\s*heads?|admin|everyone|org(anisation)?|company|team)\b/i;
const CASUAL_HOW_ARE_YOU = /\bhow\s*('?s|are|is)\s*(you|it going|things|everything)\b/i;
const COMPARE_RE = /compare\s+([a-z][a-z ]*?)\s+(?:and|vs\.?|with)\s+([a-z][a-z ]*?)(?:[.?!]|$)/i;
// "how is <Name> doing" / "how's <Name>" / "how many calls did <Name> do" / "<Name>'s calls"
const PERSON_HOW_RE = /\bhow\s*('?s|is|are)\s+([a-z][a-z]*(?:\s+[a-z][a-z]*){0,2})\s+(doing|performing)\b/i;
const PERSON_DID_RE = /\bdid\s+([a-z][a-z]*(?:\s+[a-z][a-z]*){0,2})\s+(do|make|complete)\b/i;
const PERSON_POSSESSIVE_RE = /\b([a-z][a-z]*(?:\s+[a-z][a-z]*){0,2})'s\s+(calls|performance|numbers|progress)\b/i;

const STOPWORDS_AS_NAME = new Set(['you', 'it', 'i', 'we', 'they', 'things', 'everything', 'pre', 'sales', 'team']);

function cleanName(raw: string): string | null {
  const w = raw.trim().toLowerCase();
  if (!w || STOPWORDS_AS_NAME.has(w)) return null;
  if (ROLE_WORDS.test(w)) return null;
  return raw.trim();
}

function extractTwoNames(message: string): [string, string] | null {
  const m = message.match(COMPARE_RE);
  if (!m) return null;
  const a = cleanName(m[1]);
  const b = cleanName(m[2]);
  if (!a || !b) return null;
  return [a, b];
}

function extractOneName(message: string): string | null {
  const how = message.match(PERSON_HOW_RE);
  if (how) return cleanName(how[2]);
  const did = message.match(PERSON_DID_RE);
  if (did) return cleanName(did[1]);
  const poss = message.match(PERSON_POSSESSIVE_RE);
  if (poss) return cleanName(poss[1]);
  return null;
}

/**
 * Basic rule-based classifier. Order matters a great deal — this was the
 * actual bug in the previous version (generic "how" patterns ran before
 * reserved phrases like "how are you" or role phrases like "how is
 * Pre-Sales doing" were checked, so they misclassified as PERSON_PERFORMANCE).
 * Fixed order: casual greetings -> role performance -> two-person compare
 * -> single-person lookup -> lead code -> everything else -> fallback.
 */
export function classifyIntent(message: string): ClassifiedIntent {
  const trimmed = message.trim();
  const m = trimmed.toLowerCase();

  // 1. Reserved casual phrases, checked before anything tries to extract a name.
  if (CASUAL_HOW_ARE_YOU.test(m)) return { intent: 'CASUAL_CHAT', entities: {} };

  // 2. Lead code — unambiguous, safe to check early.
  const leadCodeMatch = trimmed.match(LEAD_CODE_RE);
  if (leadCodeMatch) return { intent: 'LEAD_LOOKUP', entities: { leadCode: leadCodeMatch[0].toUpperCase() } };

  // 3. Role/team performance — checked before person extraction so "how is
  // Pre-Sales doing" / "how is Sales doing" never get treated as a person
  // named "Pre" or "Sales".
  if (ROLE_WORDS.test(m) && /\b(doing|performing|going|status|update|overview)\b/.test(m)) {
    return { intent: 'ROLE_PERFORMANCE', entities: {} };
  }

  // 4. Two-person compare.
  const twoNames = extractTwoNames(trimmed);
  if (twoNames) return { intent: 'TEAM_COMPARISON', entities: { personNames: twoNames } };

  // 5. Single named person.
  const oneName = extractOneName(trimmed);
  if (oneName) return { intent: 'PERSON_PERFORMANCE', entities: { personNames: [oneName] } };

  // 6. Wellness / snooze / open-lead — checked before the generic MY_* bucket.
  if (/\b(water|drink|stretch|break|tired|stressed|motivate)\b/.test(m)) return { intent: 'WELLNESS', entities: {} };
  if (/\bsnooze|remind me later\b/.test(m)) return { intent: 'SNOOZE_SHIFU_ALERT', entities: {} };
  if (/\bopen (this )?lead\b/.test(m)) return { intent: 'OPEN_LEAD', entities: {} };

  // 7. Generic MY_* — only reached once role/person/lead-code have all
  // failed to match, so "how many calls did Rashi do" is safely routed to
  // PERSON_PERFORMANCE at step 5, not here. "Overdue/attention" is checked
  // before the plain "follow-up" keyword — real test run caught this:
  // "what follow-ups are overdue" was matching MY_FOLLOWUPS before this
  // fix, never reaching MY_ATTENTION_ITEMS.
  if (/\battention|overdue|waiting|needs? (attention|help)|who needs\b/.test(m)) return { intent: 'MY_ATTENTION_ITEMS', entities: {} };
  if (/\bconnect(ed)?\b/.test(m)) return { intent: 'MY_CONNECTED_CALLS', entities: {} };
  if (/\bcalls?\b/.test(m)) return { intent: 'MY_CALLS', entities: {} };
  if (/\bfollow[\s-]?up/.test(m)) return { intent: 'MY_FOLLOWUPS', entities: {} };
  if (/\bmeetings?\b/.test(m)) return { intent: 'MY_MEETINGS', entities: {} };
  if (/\btrials?\b/.test(m)) return { intent: 'MY_TRIALS', entities: {} };
  if (/\badmissions?\b/.test(m)) return { intent: 'MY_ADMISSIONS', entities: {} };
  if (/\bpipeline|bottleneck|stuck\b/.test(m)) return { intent: 'PIPELINE_STATUS', entities: {} };
  if (/\b(today'?s )?(overview|update|briefing|summary)\b/.test(m)) return { intent: 'TEAM_PERFORMANCE', entities: {} };
  if (/\b(next|what should i do|focus)\b/.test(m)) return { intent: 'MY_NEXT_ACTION', entities: {} };
  if (/\bstatus|how am i doing|progress\b/.test(m)) return { intent: 'MY_STATUS', entities: {} };

  return { intent: 'CASUAL_CHAT', entities: {} };
}
