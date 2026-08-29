// app/lib/shifu/permissions.ts
//
// Pure authorization rules — no DB access here, just decisions given a
// session and (optionally) a target. Every one of these must be checked
// server-side before context.ts runs a query, per Part 11 of the brief:
// "Never rely only on the frontend to hide data."

import type { Role } from './role-config';

export type ShifuSession = { id: number; name: string; role: Role };

/** Can this session see performance data belonging to someone else? */
export function canViewPerson(session: ShifuSession, targetUserId: number): boolean {
  if (session.role === 'admin') return true;
  if (session.id === targetUserId) return true;
  // Explicit correction from the approved brief: Vertical Head does not
  // supervise Pre-Sales agents in this schema, Sales Counsellors don't see
  // each other, and Data Team never gets employee-performance visibility.
  return false;
}

/** Can this session see org-wide / role-wide aggregate numbers? */
export function canViewTeamMetrics(session: ShifuSession): boolean {
  return session.role === 'admin';
}

/** Can this session resolve an arbitrary name to a user (for lookups)? */
export function canResolveOtherUsers(session: ShifuSession): boolean {
  return session.role === 'admin';
}

/**
 * Data Team gets a deliberately minimal Shifu — this function exists so
 * callers have one obvious place to gate data_team-only behavior, per the
 * approved correction: "keep Shifu minimal for Data Team rather than
 * inventing capabilities."
 */
export function isMinimalRole(session: ShifuSession): boolean {
  return session.role === 'data_team';
}
