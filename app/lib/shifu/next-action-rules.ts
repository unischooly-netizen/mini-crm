// app/lib/shifu/next-action-rules.ts — Phase B.
//
// "What should I do next?" per brief section 17: deterministic, inspectable
// priority rules — never handed to Gemini to improvise. Each role's rule
// list is checked in order; the first rule that has something to show wins.
// This module only decides WHICH thing to surface and builds the sentence;
// it does not fetch data itself — callers pass in the already-fetched
// verified facts (deterministic-answers.ts is what calls this, after it
// has already called the Phase A context.ts functions for other reasons).

export type NextActionInput = {
  presales?: { followupsOverdue: number; followupsDueToday: number; currentNewLeads: number };
  vh?: { currentPendingAssignment: number; oldestWaitingLeadCode: string | null; oldestWaitingSince: string | null };
  counsellor?: {
    followupsOverdue: number;
    currentMeetingNotJoined: number;
    // trials done but admission still pending — same signal as
    // getAttentionItems's counsellor branch item 4, reused here as a count
    // rather than a capped list.
    trialDonePendingAdmission: number;
  };
  attentionItems?: string[]; // capped list from context.ts's getAttentionItems, used as a fallback detail line
};

export type NextAction = { text: string; leadCode?: string };

export function presalesNextAction(input: NonNullable<NextActionInput['presales']>, attentionItems?: string[]): NextAction {
  if (input.followupsOverdue > 0) {
    const detail = attentionItems?.find((a) => a.includes('overdue'));
    return {
      text: `You have ${input.followupsOverdue} overdue follow-up${input.followupsOverdue === 1 ? '' : 's'} — that's the most urgent thing to clear first.${detail ? ` (${detail})` : ''}`,
      leadCode: detail?.split(':')[0]?.trim(),
    };
  }
  const noMeeting = attentionItems?.find((a) => a.includes('no meeting booked'));
  if (noMeeting) {
    return { text: `A qualified lead doesn't have a meeting booked yet: ${noMeeting}`, leadCode: noMeeting.split(':')[0]?.trim() };
  }
  if (input.followupsDueToday > 0) {
    return { text: `You have ${input.followupsDueToday} follow-up${input.followupsDueToday === 1 ? '' : 's'} due today — worth clearing those next.` };
  }
  if (input.currentNewLeads > 0) {
    return { text: `You have ${input.currentNewLeads} new lead${input.currentNewLeads === 1 ? '' : 's'} that haven't been touched yet — good next step.` };
  }
  return { text: "You're clear right now — nothing overdue, due today, or freshly waiting on you." };
}

export function vhNextAction(input: NonNullable<NextActionInput['vh']>): NextAction {
  if (input.oldestWaitingLeadCode) {
    return {
      text: `${input.oldestWaitingLeadCode} has been waiting longest for a counsellor assignment${input.oldestWaitingSince ? ` (since ${input.oldestWaitingSince})` : ''} — start there.`,
      leadCode: input.oldestWaitingLeadCode,
    };
  }
  if (input.currentPendingAssignment > 0) {
    return { text: `You have ${input.currentPendingAssignment} qualified lead${input.currentPendingAssignment === 1 ? '' : 's'} waiting for a counsellor assignment.` };
  }
  return { text: "You're clear right now — nothing waiting on a counsellor assignment." };
}

export function counsellorNextAction(input: NonNullable<NextActionInput['counsellor']>, attentionItems?: string[]): NextAction {
  if (input.followupsOverdue > 0) {
    const detail = attentionItems?.find((a) => a.includes('overdue'));
    return {
      text: `You have ${input.followupsOverdue} overdue follow-up${input.followupsOverdue === 1 ? '' : 's'} — clear those first.${detail ? ` (${detail})` : ''}`,
      leadCode: detail?.split(':')[0]?.trim(),
    };
  }
  const upcoming = attentionItems?.find((a) => a.includes('meeting was rescheduled') || a.includes('trial was rescheduled'));
  if (upcoming) {
    return { text: `A rescheduled meeting/trial still needs a new date: ${upcoming}`, leadCode: upcoming.split(':')[0]?.trim() };
  }
  if (input.trialDonePendingAdmission > 0) {
    return { text: `${input.trialDonePendingAdmission} trial${input.trialDonePendingAdmission === 1 ? ' is' : 's are'} done but still waiting on an admission decision.` };
  }
  if (input.currentMeetingNotJoined > 0) {
    return { text: `${input.currentMeetingNotJoined} meeting${input.currentMeetingNotJoined === 1 ? " wasn't" : "s weren't"} joined — worth a re-attempt.` };
  }
  return { text: "You're clear right now — nothing overdue or pending a decision." };
}

/**
 * Admin per brief section 17: "surface operational exceptions, not generic
 * motivational advice." Reuses the admin branch of getAttentionItems
 * (already fetched by the caller) rather than a separate rule set.
 */
export function adminNextAction(attentionItems: string[]): NextAction {
  if (attentionItems.length > 0) {
    return { text: `Most pressing right now: ${attentionItems[0]}`, leadCode: attentionItems[0].split(':')[0]?.split(' ')[0]?.trim() };
  }
  return { text: 'Nothing flagged as an operational exception right now.' };
}
