import { ATTEMPT_COUNT, AUTO_FOLLOWUP_TRIGGER_STATUSES, FINAL_OUTCOME_TO_QUALIFICATION } from './masters';
import { computeNextFollowup } from './followup';

export function computeTotalAttempts(fields: Record<string, unknown>): number {
  let count = 0;
  for (let i = 1; i <= ATTEMPT_COUNT; i++) {
    if (fields[`attempt${i}Status`]) count++;
  }
  return count;
}

export function computeQualificationStatus(finalOutcome: string | null | undefined): string {
  if (!finalOutcome) return 'Not Reviewed';
  return FINAL_OUTCOME_TO_QUALIFICATION[finalOutcome] || 'Not Reviewed';
}

export function computePipelineStatus(totalAttempts: number, qualificationStatus: string): string {
  if (totalAttempts === 0) return 'New';
  if (qualificationStatus === 'Not Reviewed') return 'Not Picked';
  return qualificationStatus; // 'Qualified' | 'Not Qualified' | 'Follow-up Needed'
}

export function computeHandoverStatus(
  qualificationStatus: string,
  assignedVhUserId: number | null,
  assignedCounsellorUserId: number | null
): string {
  if (assignedCounsellorUserId) return 'Counsellor Assigned';
  if (assignedVhUserId) return 'VH Assigned';
  if (qualificationStatus === 'Qualified') return 'Qualified - Pending VH';
  return 'Not Ready';
}

/** True if this attempt status means "we didn't actually get through". */
export function isAutoFollowupTrigger(attemptStatus: string | null | undefined): boolean {
  return !!attemptStatus && AUTO_FOLLOWUP_TRIGGER_STATUSES.includes(attemptStatus);
}

export { computeNextFollowup };
