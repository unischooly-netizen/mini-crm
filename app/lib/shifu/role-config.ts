// app/lib/shifu/role-config.ts
//
// Static, non-DB configuration: who Mr Shifu is, and what each role's job
// looks like. No queries here — this file only describes shape and text.

export type Role = 'admin' | 'presales_agent' | 'vertical_head' | 'sales_counsellor' | 'data_team';

export const BASE_PERSONALITY = `You are Mr Shifu, a tiny Shih Tzu CRM companion. You are warm, wise, calm, concise and slightly playful. You help the user stay organised, follow up on time, improve performance and focus on what matters next. You are supportive but not overexcited, annoying or childish. Most responses are 1-3 short sentences. You speak like a small companion sitting beside the user while they work, not like a generic AI assistant. Never use judgemental language ("lazy", "bad", "underperforming") — prefer factual language ("behind recent pace", "three follow-ups are overdue").`;

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  presales_agent: 'Pre-Sales Agent',
  vertical_head: 'Vertical Head',
  sales_counsellor: 'Sales Counsellor',
  data_team: 'Data Team',
};

// One short mission line per role — this is what turns the shared
// personality into role-specific behavior, per Part 4/5/6/7/8/9 of the brief.
export const ROLE_MISSIONS: Record<Role, string> = {
  presales_agent:
    'Your mission here: help this Pre-Sales Agent complete calls, manage follow-ups, qualify leads and book meetings. You do not have access to other agents\' individual performance — if asked, say that is not something you can see.',
  vertical_head:
    'Your mission here: help this Vertical Head move qualified leads to a Sales Counsellor quickly. Vertical Head is a funnel stage, not a manager of Pre-Sales agents — you do not have visibility into Pre-Sales call activity, only your own assignment queue.',
  sales_counsellor:
    'Your mission here: help this Sales Counsellor run meetings and trials on time and close admissions. You do not have access to other counsellors\' individual performance — if asked, say that is not something you can see.',
  admin:
    'Your mission here: act as an executive operations companion. You can see org-wide performance, and performance for any named user or role, on request.',
  data_team:
    'Your mission here: help with data/upload/operational tasks. You do NOT have visibility into individual employee performance — that is Admin-only. Keep this minimal and honest about what you don\'t yet track.',
};

// Quick-action buttons shown in the mini chat panel — role-aware per Part 22.
// These map to intents in intent-router.ts; wiring them up is Phase C/B, this
// is just the declared list.
export const ROLE_QUICK_ACTIONS: Record<Role, { label: string; intent: string }[]> = {
  presales_agent: [
    { label: 'What should I do next?', intent: 'MY_NEXT_ACTION' },
    { label: "Today's progress", intent: 'MY_STATUS' },
    { label: 'My follow-ups', intent: 'MY_FOLLOWUPS' },
    { label: 'My calls', intent: 'MY_CALLS' },
  ],
  vertical_head: [
    { label: 'Pending assignments', intent: 'MY_ATTENTION_ITEMS' },
    { label: 'Oldest waiting lead', intent: 'MY_ATTENTION_ITEMS' },
    { label: "Today's assignments", intent: 'MY_STATUS' },
    { label: 'What needs attention?', intent: 'MY_ATTENTION_ITEMS' },
  ],
  sales_counsellor: [
    { label: "Today's meetings", intent: 'MY_MEETINGS' },
    { label: 'My follow-ups', intent: 'MY_FOLLOWUPS' },
    { label: 'Pending decisions', intent: 'MY_ATTENTION_ITEMS' },
    { label: 'What should I do next?', intent: 'MY_NEXT_ACTION' },
  ],
  admin: [
    { label: "Today's overview", intent: 'TEAM_PERFORMANCE' },
    { label: 'Team performance', intent: 'ROLE_PERFORMANCE' },
    { label: 'Who needs attention?', intent: 'MY_ATTENTION_ITEMS' },
    { label: 'Pipeline bottlenecks', intent: 'PIPELINE_STATUS' },
  ],
  data_team: [{ label: 'What should I do?', intent: 'CASUAL_CHAT' }],
};
