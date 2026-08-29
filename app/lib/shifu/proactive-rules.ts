// app/lib/shifu/proactive-rules.ts
//
// Types and a few example deterministic checks for the proactive engine.
// Wiring these into a live "Shifu perks up" experience is Phase D — this
// file only defines the shape and proves the pattern on two rules, per
// Part 15/16 of the brief: rules are deterministic, AI only writes the
// wording afterward.

export type Priority = 1 | 2 | 3 | 4 | 5; // 1 = urgent operational ... 5 = casual

export type ProactiveEvent = {
  id: string;
  priority: Priority;
  message: string;
  actions?: { label: string; action: string }[];
  leadCode?: string;
};

// Non-urgent proactive messages should not repeat more often than this —
// exact value is a constant so it's easy to tune later, per Part 17.
export const NONURGENT_COOLDOWN_MS = 75 * 60 * 1000; // ~75 minutes

/** P1 — an overdue follow-up. One event per lead, capped by the caller. */
export function ruleOverdueFollowup(leadCode: string, dueDate: string): ProactiveEvent {
  return {
    id: `overdue-${leadCode}`,
    priority: 1,
    leadCode,
    message: `${leadCode}'s follow-up has been overdue since ${dueDate}.`,
    actions: [
      { label: 'Open lead', action: `OPEN_LEAD:${leadCode}` },
      { label: 'Later', action: 'DISMISS' },
    ],
  };
}

/** P2 — a qualified lead sitting with no meeting booked. */
export function ruleQualifiedNoMeeting(leadCode: string): ProactiveEvent {
  return {
    id: `no-meeting-${leadCode}`,
    priority: 2,
    leadCode,
    message: `${leadCode} was qualified but doesn't have a meeting booked yet.`,
    actions: [
      { label: 'Open lead', action: `OPEN_LEAD:${leadCode}` },
      { label: 'Later', action: 'DISMISS' },
    ],
  };
}

/**
 * Picks the single highest-priority event to show, respecting the
 * "only one visible bubble at a time" rule (Part 17). Lower number = higher
 * priority.
 */
export function pickTopEvent(events: ProactiveEvent[]): ProactiveEvent | null {
  if (events.length === 0) return null;
  return [...events].sort((a, b) => a.priority - b.priority)[0];
}
