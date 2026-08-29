// app/lib/shifu/leaderboards.ts — Phase B.
//
// Supports the admin ranking questions from brief section 8 ("Who has made
// the most calls?", "Who has the most overdue follow-ups?"). Deliberately
// kept separate from context.ts rather than added to it, so the
// already-validated (parity-checked, 0 mismatches) Phase A file stays
// untouched. Built entirely on primitives Phase A already exports —
// fetchAllLeadsRich() and followupCounts() from lib/performanceMetrics.ts
// — so this does not duplicate any metric definition, it just re-groups
// and re-sorts numbers those functions already compute correctly.
//
// Scope note (stated plainly, not glossed over): "most calls" only ranks
// Pre-Sales Agents, since call attempts are a Pre-Sales concept in this
// schema (Vertical Heads and Sales Counsellors don't log call attempts).
// "most overdue follow-ups" ranks whichever role currently owns each lead
// (owner for Pre-Sales-stage leads, assigned counsellor for
// qualified-stage leads) — reported as two separate small lists rather
// than merged into one, since "most overdue" means something different
// depending on which stage the lead is in.

import { fetchAllLeadsRich, followupCounts, type DateRange } from '@/lib/performanceMetrics';

export type LeaderboardRow = { name: string; userId: number | null; value: number };

/** Top Pre-Sales Agents by number of call attempts within the given range. */
export async function getCallsLeaderboard(range: DateRange, limit = 3): Promise<LeaderboardRow[]> {
  const leads = await fetchAllLeadsRich();
  const buckets = new Map<string, { userId: number | null; calls: number }>();
  for (const l of leads) {
    if (!l.owner) continue;
    const key = l.ownerUserId != null ? `user:${l.ownerUserId}` : `name:${l.owner}`;
    if (!buckets.has(key)) buckets.set(key, { userId: l.ownerUserId, calls: 0 });
    const inRange = l.attempts.filter((a) => a.date && a.date >= range.start && a.date <= range.end);
    buckets.get(key)!.calls += inRange.length;
  }
  const rows = Array.from(buckets.entries()).map(([key, b]) => ({
    name: key.startsWith('name:') ? key.slice(5) : (leads.find((l) => l.ownerUserId === b.userId)?.owner ?? 'Unknown'),
    userId: b.userId,
    value: b.calls,
  }));
  return rows.sort((a, b) => b.value - a.value).slice(0, limit);
}

export type OverdueLeaderboards = {
  presales: LeaderboardRow[];
  counsellor: LeaderboardRow[];
};

/** Most overdue follow-ups, split by which role currently owns the lead. */
export async function getOverdueLeaderboard(todayIso: string, limit = 3): Promise<OverdueLeaderboards> {
  const leads = await fetchAllLeadsRich();

  const presalesScope = leads.filter((l) => !!l.owner);
  const presalesBuckets = new Map<string, { userId: number | null; name: string; leads: typeof leads }>();
  for (const l of presalesScope) {
    const key = l.ownerUserId != null ? `user:${l.ownerUserId}` : `name:${l.owner}`;
    if (!presalesBuckets.has(key)) presalesBuckets.set(key, { userId: l.ownerUserId, name: l.owner!, leads: [] });
    presalesBuckets.get(key)!.leads.push(l);
  }
  const presales = Array.from(presalesBuckets.values())
    .map((b) => ({ name: b.name, userId: b.userId, value: followupCounts(b.leads, todayIso, false).followupsOverdue }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  const counsellorScope = leads.filter((l) => !!l.assignedCounsellorName);
  const counsellorBuckets = new Map<string, { userId: number | null; name: string; leads: typeof leads }>();
  for (const l of counsellorScope) {
    const key = l.assignedCounsellorUserId != null ? `user:${l.assignedCounsellorUserId}` : `name:${l.assignedCounsellorName}`;
    if (!counsellorBuckets.has(key)) counsellorBuckets.set(key, { userId: l.assignedCounsellorUserId, name: l.assignedCounsellorName!, leads: [] });
    counsellorBuckets.get(key)!.leads.push(l);
  }
  const counsellor = Array.from(counsellorBuckets.values())
    .map((b) => ({ name: b.name, userId: b.userId, value: followupCounts(b.leads, todayIso, false).followupsOverdue }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);

  return { presales, counsellor };
}
