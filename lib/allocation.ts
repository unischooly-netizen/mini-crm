import { sql } from '@/lib/db';

type ActiveRule = { agentUserId: number; agentName: string; percentage: number };
type UnassignedLead = { id: number; language: string; assignedDate: string; createdAt: string };

export function pickNextAgent(
  rules: ActiveRule[],
  runningCounts: Map<number, number>
): ActiveRule | null {
  const totalSoFar = Array.from(runningCounts.values()).reduce((a, b) => a + b, 0);

  let bestAgent: ActiveRule | null = null;
  let bestDeficit = -Infinity;

  for (const rule of rules) {
    const current = runningCounts.get(rule.agentUserId) || 0;
    const target = (rule.percentage / 100) * (totalSoFar + 1);
    const deficit = target - current;

    if (
      deficit > bestDeficit ||
      (deficit === bestDeficit && bestAgent !== null && rule.agentUserId < bestAgent.agentUserId)
    ) {
      bestDeficit = deficit;
      bestAgent = rule;
    }
  }

  return bestAgent;
}

export type AllocationResult = {
  assignments: { leadId: number; agentUserId: number; agentName: string }[];
  skippedLanguages: { language: string; reason: string }[];
};

/**
 * Assigns an Owner to every currently-unassigned lead, using the same
 * business rules as the original Google Sheets allocation engine:
 *
 *  - Isolated by (Assigned Date + Language): agents' shares are balanced
 *    per day per language, not globally.
 *  - "Deficit to target" distribution: each new lead goes to whichever
 *    active agent is furthest below their target percentage of that day's
 *    running total for that language — this is what keeps a 50/50 split
 *    accurate as leads trickle in one at a time, rather than just
 *    round-robining.
 *  - Existing Owner is permanent — this function only ever touches leads
 *    where owner_user_id IS NULL. It never reassigns an already-owned lead.
 *  - No fallback owner — if a language has no active rules, or its active
 *    percentages don't add up to 100, leads in that language are left
 *    unassigned rather than guessed at.
 */
export async function allocateUnassignedLeads(): Promise<AllocationResult> {
  const assignments: AllocationResult['assignments'] = [];
  const skippedLanguages: AllocationResult['skippedLanguages'] = [];

  const languageRows = await sql`
    SELECT DISTINCT language
    FROM leads
    WHERE owner_user_id IS NULL AND language IS NOT NULL AND language <> ''
  `;
  const languages = (languageRows as { language: string }[]).map((r) => r.language);

  for (const language of languages) {
    const ruleRows = await sql`
      SELECT ar.agent_user_id AS "agentUserId", u.name AS "agentName", ar.percentage
      FROM allocation_rules ar
      JOIN users u ON u.id = ar.agent_user_id
      WHERE ar.language = ${language} AND ar.active = true
    `;
    const rules = ruleRows as ActiveRule[];

    if (rules.length === 0) {
      skippedLanguages.push({ language, reason: 'No active agents configured for this language.' });
      continue;
    }

    const totalPercent = rules.reduce((sum, r) => sum + Number(r.percentage), 0);
    if (Math.abs(totalPercent - 100) > 0.01) {
      skippedLanguages.push({
        language,
        reason: `Active percentages total ${totalPercent}, not 100. Fix Allocation Rules before these leads can be assigned.`,
      });
      continue;
    }

    const leadRows = await sql`
      SELECT id, language, assigned_date::text AS "assignedDate", created_at::text AS "createdAt"
      FROM leads
      WHERE owner_user_id IS NULL AND language = ${language}
      ORDER BY assigned_date ASC, created_at ASC, id ASC
    `;
    const leads = leadRows as UnassignedLead[];

    // Group leads by assigned_date so each day's ratio is balanced independently.
    const leadsByDate = new Map<string, UnassignedLead[]>();
    for (const lead of leads) {
      const list = leadsByDate.get(lead.assignedDate) || [];
      list.push(lead);
      leadsByDate.set(lead.assignedDate, list);
    }

    for (const [assignedDate, dateLeads] of leadsByDate) {
      const countRows = await sql`
        SELECT owner_user_id AS "agentUserId", COUNT(*)::int AS count
        FROM leads
        WHERE language = ${language} AND assigned_date = ${assignedDate}::date AND owner_user_id IS NOT NULL
        GROUP BY owner_user_id
      `;
      const runningCounts = new Map<number, number>();
      for (const rule of rules) runningCounts.set(rule.agentUserId, 0);
      for (const row of countRows as { agentUserId: number; count: number }[]) {
        runningCounts.set(row.agentUserId, row.count);
      }

      for (const lead of dateLeads) {
        const bestAgent = pickNextAgent(rules, runningCounts);

        if (!bestAgent) continue;

        await sql`
          UPDATE leads SET owner_user_id = ${bestAgent.agentUserId}, updated_at = now() WHERE id = ${lead.id}
        `;

        runningCounts.set(bestAgent.agentUserId, (runningCounts.get(bestAgent.agentUserId) || 0) + 1);
        assignments.push({ leadId: lead.id, agentUserId: bestAgent.agentUserId, agentName: bestAgent.agentName });
      }
    }
  }

  return { assignments, skippedLanguages };
}
