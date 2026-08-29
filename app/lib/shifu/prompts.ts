// app/lib/shifu/prompts.ts
//
// Pure string composition — BASE + ROLE + INTENT + VERIFIED_CONTEXT, per
// Part 35 of the brief. Nothing here calls Gemini; the route does that.
// The rule this file exists to enforce: Gemini only ever sees facts that
// were already computed by context.ts, never raw permission to guess.

import { BASE_PERSONALITY, ROLE_LABELS, ROLE_MISSIONS, type Role } from './role-config';
import type { Intent } from './intent-router';

const INTENT_INSTRUCTIONS: Partial<Record<Intent, string>> = {
  MY_CALLS: 'The user asked about their call activity. Answer using only the calls figures given below.',
  MY_CONNECTED_CALLS: 'The user asked about connected calls specifically. Use the connected_calls and calls_made figures below — do not conflate the two.',
  MY_FOLLOWUPS: 'The user asked about follow-ups. Distinguish "due today" from "overdue" using the figures below.',
  MY_MEETINGS: 'The user asked about meetings. Distinguish "scheduled" from "completed" using the figures below.',
  MY_ATTENTION_ITEMS: 'The user asked what needs attention. List the specific lead IDs given below, not a vague summary.',
  PERSON_PERFORMANCE: 'The user asked about a specific named person. Only use the verified figures for that exact person below — never blend in org-wide numbers as a stand-in.',
  TEAM_COMPARISON: 'The user asked to compare two people. Use only the verified figures for each of the two people below, side by side.',
  TEAM_PERFORMANCE: 'The user asked for a team/org overview. Use only the org-wide figures below.',
  ROLE_PERFORMANCE: 'The user asked how a role/team is doing. Use only the role breakdown figures below.',
  WELLNESS: 'This is a casual wellness check-in, not a data question. No CRM figures are needed — respond warmly and briefly.',
  CASUAL_CHAT: 'This is casual conversation, not a data question. No CRM figures are needed — respond warmly and briefly, and gently steer back to work only if natural.',
};

export function buildRoleBlock(role: Role): string {
  return `${BASE_PERSONALITY}\n\nYou are talking to a ${ROLE_LABELS[role]}. ${ROLE_MISSIONS[role]}`;
}

export function buildIntentInstruction(intent: Intent): string {
  return INTENT_INSTRUCTIONS[intent] || 'Answer using only the verified facts given below. If something is not in those facts, say you don\'t have that information yet — never estimate or invent it.';
}

/**
 * Turns a plain object of verified facts into a clearly-labeled block for
 * the prompt. Deliberately dumb (JSON-ish, not prose) so there's no room
 * for the formatting step itself to quietly change a number.
 */
export function buildVerifiedContextBlock(label: string, facts: Record<string, unknown> | null): string {
  if (!facts) return `${label}: no data available.`;
  const lines = Object.entries(facts).map(([k, v]) => `  ${k}: ${v === null ? 'unknown' : v}`);
  return `${label} (verified, from the database — do not add, change, or invent any value here):\n${lines.join('\n')}`;
}

export function composePrompt(role: Role, intent: Intent, contextBlocks: string[], timeLabel: string, onShift: boolean): string {
  const shiftNote = onShift
    ? `It is currently ${timeLabel} IST, within working hours.`
    : `It is currently ${timeLabel} IST, outside the 10am-7pm shift. This only matters if the user asks something time-sensitive like "should I keep working" — for factual questions about data, answer normally regardless of the time.`;
  return [buildRoleBlock(role), shiftNote, buildIntentInstruction(intent), ...contextBlocks].join('\n\n');
}
