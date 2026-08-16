// Dropdown option lists, pulled verbatim from the TLS Google Sheet's Masters
// tab. Kept in one file so they're easy to update later without touching
// any logic code.

export const STATES: string[] = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi (NCT)', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

export const PROFESSIONS: string[] = [
  'School Student', 'College Student', 'University Student', 'Working Professional',
  'IT Professional', 'Software Engineer', 'Teacher', 'Professor', 'Doctor', 'Nurse',
  'Pharmacist', 'Chartered Accountant', 'Company Secretary', 'Lawyer', 'Government Employee',
  'PSU Employee', 'Banker', 'Finance Professional', 'Sales Professional', 'Marketing Professional',
  'HR Professional', 'Business Owner', 'Entrepreneur', 'Freelancer', 'Consultant', 'Homemaker',
  'Civil Services Aspirant', 'Defence Personnel', 'Police Personnel', 'Cabin Crew',
  'Hotel & Hospitality', 'Aviation Professional', 'Travel & Tourism', 'Content Creator',
  'Digital Marketer', 'Graphic Designer', 'Interior Designer', 'Architect',
  'Mechanical Engineer', 'Civil Engineer', 'Electrical Engineer', 'Electronics Engineer',
  'Data Analyst', 'Data Scientist', 'AI / ML Professional', 'Research Scholar', 'Scientist',
  'NGO Professional', 'Retired', 'Looking for Job', 'Between Jobs', 'Accountant', 'Other',
];

export const PURPOSES: string[] = [
  'Study Abroad', 'Career Growth', 'Immigration / PR', 'Travel', 'Hobby', 'School Support',
  'DELF Preparation', 'Higher Education', 'Upskill', 'Other',
];

// "Call Status" in the sheet = the outcome logged for each individual call attempt.
export const ATTEMPT_STATUSES: string[] = [
  'Connected', 'No Answer', 'Busy', 'Switched Off', 'Wrong Number', 'No Incoming Call',
  'Number not connecting',
];

// Attempt statuses that mean "we did not actually speak to them" — these are
// the ones that trigger the automatic next-follow-up scheduling.
export const AUTO_FOLLOWUP_TRIGGER_STATUSES: string[] = [
  'Busy', 'No Answer', 'Switched Off', 'No Incoming Call', 'Number not connecting',
];

export const FINAL_OUTCOMES: string[] = [
  'Qualified', 'Not Interested', 'Junior Lead', 'Wrong Number', 'Already Learning',
  'Budget Issue', 'No Response', 'Call Back Later',
];

// Final Outcome -> Qualification Status, exactly as specified.
export const FINAL_OUTCOME_TO_QUALIFICATION: Record<string, string> = {
  'Qualified': 'Qualified',
  'Not Interested': 'Not Qualified',
  'Junior Lead': 'Not Qualified',
  'Wrong Number': 'Not Qualified',
  'Already Learning': 'Not Qualified',
  'Budget Issue': 'Not Qualified',
  'No Response': 'Not Qualified',
  'Call Back Later': 'Follow-up Needed',
};

export const QUALIFICATION_STATUSES: string[] = [
  'Not Reviewed', 'Qualified', 'Follow-up Needed', 'Not Qualified',
];

export const COURSE_START_TIMELINES: string[] = [
  'Today', 'Within 3 Days', 'Within 7 Days', 'This Month', 'Next Month', 'Just Exploring',
  'Beyond 3 months', 'NA',
];

export const PREFERRED_MODES: string[] = [
  'Phone Call', 'Teams Meet', 'Whatsapp call', 'Google Meet',
];

// Handover Status stages we actively set in Stage 2. More stages (Meeting
// Scheduled onward) get added in Stage 3 once meeting/trial/admission
// tracking is built.
export const HANDOVER_STATUSES_STAGE2: string[] = [
  'Not Ready', 'Qualified - Pending VH', 'VH Assigned', 'Counsellor Assigned',
];

export const ATTEMPT_COUNT = 9;

// Pipeline status shown as filter tabs on the agent's own leads view.
export const PIPELINE_STATUSES = ['New', 'Not Picked', 'Follow-up Needed', 'Qualified', 'Not Qualified'] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

// Fields a Pre-Sales Agent is allowed to edit directly on their own leads.
// Everything else on the lead is system-managed or managed by another role.
export const AGENT_EDITABLE_FIELDS = [
  'state', 'profession', 'purpose',
  ...Array.from({ length: ATTEMPT_COUNT }, (_, i) => `attempt${i + 1}Status`),
  'finalOutcome', 'remarks', 'courseStartTimeline', 'meetingDate', 'meetingTime', 'preferredMode',
  'nextFollowupDate', 'nextFollowupTime', // only actually applied when not auto-triggered — enforced in lib/leadLogic.ts
] as const;
