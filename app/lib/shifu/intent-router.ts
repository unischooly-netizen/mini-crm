// app/lib/shifu/intent-router.ts — Phase A.1 correctness pass, extended in
// Phase B (see the three additions marked "Phase B" below: LEADERBOARD
// intent + WHO_RANKING_RE, a broadened MY_NEXT_ACTION regex, and an
// "assign" keyword routed to MY_STATUS). These were added because building
// the real chat handler surfaced three concrete test phrases from the
// Phase B brief that the Phase A router did not yet classify correctly —
// each addition is scoped to the exact gap found, not a general rewrite.
// The full Phase A test suite was re-run after these changes and still
// passes; see intent-router.test.ts for the new cases added alongside it.
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
  | 'LEADERBOARD' // Phase B addition — see WHO_RANKING_RE below
  | 'TEAM_ATTENTION' // Phase B.1 addition — "who needs attention", distinct from MY_ATTENTION_ITEMS's "what needs attention"
  | 'PRESALES_AGENT_BREAKDOWN' // Phase B.2 addition — per-agent Pre-Sales breakdown, distinct from ROLE_PERFORMANCE's combined total
  | 'LATEST_QUALIFICATION' // Phase B.3 addition — "when was the last lead qualified"
  | 'DAILY_QUALIFICATION_COUNT' // Phase B.3 addition — "how many/who qualified leads on <date>"
  | 'LEAD_LOOKUP'
  | 'PIPELINE_STATUS'
  | 'OPEN_LEAD'
  | 'NAVIGATE_TO_PAGE'
  | 'SNOOZE_SHIFU_ALERT'
  | 'WELLNESS';

export type Entities = { personNames?: string[]; leadCode?: string; rankingMetric?: 'calls' | 'overdue' };
export type ClassifiedIntent = { intent: Intent; entities: Entities };

// Lead codes: every example observed across the live app (screenshots,
// pasted data, and lib/masters.ts usage) consistently shows "TLS-######"
// (TLS, hyphen, digits). I have not seen a code-generation function to
// confirm this is enforced/universal at the DB level — flagging that as
// unverified rather than assuming. Kept narrow (a real prefix, not a bare
// number pattern) to avoid false-positives on ordinary numbers in chat.
const LEAD_CODE_RE = /\bTLS-\d{3,}\b/i;

// Phase B addition — admin ranking questions ("who has made the most
// calls", "who has the most overdue follow-ups"). Checked early,
// before the generic "calls?" / "attention|overdue" keyword checks
// further down, because those would otherwise misclassify these as
// MY_CALLS / MY_ATTENTION_ITEMS (a self-scoped intent) instead of a
// cross-team ranking question. Permission-gated to admin downstream in
// the chat handler, same as TEAM_COMPARISON/ROLE_PERFORMANCE.
const WHO_RANKING_RE = /\bwho\s+(has|have|'s|is|are)\b[\s\S]*\b(most|least|highest|lowest|top)\b/i;

// Phase B.1 addition (user-flagged item 2): "who needs attention" is a
// people/team-level question (which employees have the biggest backlog),
// completely different from "what needs attention" (which specific leads
// need action) — the Phase A/B router previously folded both into the same
// MY_ATTENTION_ITEMS intent via a shared "who needs\b" fragment inside the
// generic attention/overdue regex further down. Split out and checked
// early, in the same "who ..." cluster as WHO_RANKING_RE.
const WHO_NEEDS_ATTENTION_RE = /\bwho\s+needs?\s+(attention|help)\b/i;

// Phase B.2 addition — a per-agent Pre-Sales breakdown request ("which
// Pre-Sales agent did how many calls", "Pre-Sales agent performance",
// "calls by Pre-Sales agent"), distinct from ROLE_PERFORMANCE's combined
// role-level total. The single word "agent"/"agents" is a safe, specific
// signal in this app's vocabulary — no other role in this CRM is ever
// called an "agent" (Vertical Head, Sales Counsellor, Admin, Data Team),
// so this doesn't need to also require the words "pre-sales" or "each" to
// be unambiguous. Checked early (before ROLE_PERFORMANCE) since a phrase
// like "Show Pre-Sales agent performance" doesn't happen to match
// ROLE_PERFORMANCE's own regex anyway (it requires
// doing/performing/going/status/update/overview, and "performance" the
// noun doesn't match "performing"), but is placed here for a stronger,
// more specific signal to win first regardless.
const PRESALES_AGENT_BREAKDOWN_RE = /\bagents?\b/i;

// Phase B.3 additions — qualification-event diagnostics. "Latest" catches
// both word orders ("the last lead qualified" and "who qualified the
// latest lead"), checked strictly before DAILY_QUALIFICATION_COUNT so a
// message naming both "last/latest" AND a date some day doesn't get
// mis-routed to the daily-count path. DAILY_QUALIFICATION_COUNT_RE
// requires the word "qualif..." together with a "how many"/"who" framing
// — deliberately keyword-only (not date-aware) per this router's existing
// design principle that intent classification and date-range parsing are
// independent questions (see range-parser.ts's header comment); the date
// itself is resolved separately by parseDateRequest() in chat-handler.ts,
// same as every other intent.
const LATEST_QUALIFICATION_RE = /\b(last|latest)\b.*\bqualif|\bqualif\w*\b.*\b(last|latest)\b/i;
const DAILY_QUALIFICATION_COUNT_RE = /\bqualif\w*\b/i;
const HOW_MANY_OR_WHO_RE = /\b(how many|who)\b/i;
// Guards DAILY_QUALIFICATION_COUNT from swallowing a first-person question
// like "how many leads did I qualify today?" — that's a personal question
// (would belong with MY_STATUS-style intents, not this admin cross-team
// one), not one of the three example phrasings the brief specifies, all
// of which are third-person ("were qualified", "who qualified leads").
const FIRST_PERSON_RE = /\b(i|my|me)\b/i;

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

  // 3. Admin ranking questions (Phase B) — checked before role/person
  // extraction and before the generic keyword bucket, since phrases like
  // "who has made the most calls" would otherwise hit the plain "calls?"
  // check below and get misrouted to MY_CALLS (a self-scoped intent).
  if (WHO_RANKING_RE.test(m)) {
    const rankingMetric: 'calls' | 'overdue' | undefined = /overdue/.test(m)
      ? 'overdue'
      : /calls?\b/.test(m)
        ? 'calls'
        : undefined;
    return { intent: 'LEADERBOARD', entities: { rankingMetric } };
  }

  // 3b. "Who needs attention?" (Phase B.1) — must be checked before the
  // generic attention/overdue bucket in step 8, which now only matches
  // "what needs attention" style phrasing (no leading "who").
  if (WHO_NEEDS_ATTENTION_RE.test(m)) {
    return { intent: 'TEAM_ATTENTION', entities: {} };
  }

  // 3c. Per-agent Pre-Sales breakdown (Phase B.2) — checked before
  // ROLE_PERFORMANCE/person-extraction so "which Pre-Sales agent did how
  // many calls", "Pre-Sales agent performance on 27 August", and "calls by
  // Pre-Sales agent for 27 Aug" all route here instead of falling through
  // to a combined-total answer or being misread as a person's name.
  if (PRESALES_AGENT_BREAKDOWN_RE.test(m)) {
    return { intent: 'PRESALES_AGENT_BREAKDOWN', entities: {} };
  }

  // 3d. Latest qualification event (Phase B.3) — "when was the last lead
  // qualified", "who qualified the latest lead", etc. Checked before the
  // daily-count check below since both can mention "qualif...".
  if (LATEST_QUALIFICATION_RE.test(m)) {
    return { intent: 'LATEST_QUALIFICATION', entities: {} };
  }

  // 3e. Daily qualification count/breakdown (Phase B.3) — "how many leads
  // were qualified on 27 August", "who qualified leads on 27 August".
  // Requires the "how many"/"who" framing so an unrelated sentence that
  // happens to contain "qualified" (e.g. a future MY_STATUS-style
  // question) doesn't get swept in here.
  if (DAILY_QUALIFICATION_COUNT_RE.test(m) && HOW_MANY_OR_WHO_RE.test(m) && !FIRST_PERSON_RE.test(m)) {
    return { intent: 'DAILY_QUALIFICATION_COUNT', entities: {} };
  }

  // 4. Role/team performance — checked before person extraction so "how is
  // Pre-Sales doing" / "how is Sales doing" never get treated as a person
  // named "Pre" or "Sales".
  if (ROLE_WORDS.test(m) && /\b(doing|performing|going|status|update|overview)\b/.test(m)) {
    return { intent: 'ROLE_PERFORMANCE', entities: {} };
  }

  // 5. Two-person compare.
  const twoNames = extractTwoNames(trimmed);
  if (twoNames) return { intent: 'TEAM_COMPARISON', entities: { personNames: twoNames } };

  // 6. Single named person.
  const oneName = extractOneName(trimmed);
  if (oneName) return { intent: 'PERSON_PERFORMANCE', entities: { personNames: [oneName] } };

  // 7. Wellness / snooze / open-lead — checked before the generic MY_* bucket.
  if (/\b(water|drink|stretch|break|tired|stressed|motivate)\b/.test(m)) return { intent: 'WELLNESS', entities: {} };
  if (/\bsnooze|remind me later\b/.test(m)) return { intent: 'SNOOZE_SHIFU_ALERT', entities: {} };
  if (/\bopen (this )?lead\b/.test(m)) return { intent: 'OPEN_LEAD', entities: {} };

  // 8. Generic MY_* — only reached once role/person/lead-code have all
  // failed to match, so "how many calls did Rashi do" is safely routed to
  // PERSON_PERFORMANCE at step 6, not here. "Overdue/attention" is checked
  // before the plain "follow-up" keyword — real test run caught this:
  // "what follow-ups are overdue" was matching MY_FOLLOWUPS before this
  // fix, never reaching MY_ATTENTION_ITEMS.
  if (/\battention|overdue|waiting|needs? (attention|help)\b/.test(m)) return { intent: 'MY_ATTENTION_ITEMS', entities: {} };
  if (/\bconnect(ed)?\b/.test(m)) return { intent: 'MY_CONNECTED_CALLS', entities: {} };
  if (/\bcalls?\b/.test(m)) return { intent: 'MY_CALLS', entities: {} };
  if (/\bfollow[\s-]?up/.test(m)) return { intent: 'MY_FOLLOWUPS', entities: {} };
  if (/\bmeetings?\b/.test(m)) return { intent: 'MY_MEETINGS', entities: {} };
  if (/\btrials?\b/.test(m)) return { intent: 'MY_TRIALS', entities: {} };
  if (/\badmissions?\b/.test(m)) return { intent: 'MY_ADMISSIONS', entities: {} };
  if (/\bpipeline|bottleneck|stuck\b/.test(m)) return { intent: 'PIPELINE_STATUS', entities: {} };
  if (/\b(today'?s )?(overview|update|briefing|summary)\b/.test(m)) return { intent: 'TEAM_PERFORMANCE', entities: {} };
  // Phase B: broadened from the Phase A version (just "next|what should i
  // do|focus") to also catch "what should I handle first", "priority",
  // "prioriti[sz]e" — the Phase B test list includes "What should I handle
  // first?" (a Vertical Head phrasing) which the narrower version missed.
  if (/\b(next|what should i (do|handle|focus on|prioriti[sz]e)|focus|priorit(y|ies)|prioriti[sz]e)\b/.test(m)) {
    return { intent: 'MY_NEXT_ACTION', entities: {} };
  }
  // Phase B: "assign(ed)" routed to MY_STATUS so a Vertical Head asking
  // "How many did I assign today?" gets a real answer (MY_STATUS's
  // deterministic formatter for vertical_head includes assignedInRange)
  // instead of silently falling through to CASUAL_CHAT, which is what
  // happened with the unmodified Phase A router — no keyword there matched
  // "assign" at all.
  if (/\bstatus|how am i doing|progress|assign(ed)?\b/.test(m)) return { intent: 'MY_STATUS', entities: {} };

  return { intent: 'CASUAL_CHAT', entities: {} };
}
