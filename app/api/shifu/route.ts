import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';

// ---------------------------------------------------------------------------
// Mr Shifu — the in-app companion/manager. This route does two things:
//   1) Pulls a small, role-specific snapshot of today's live numbers straight
//      from the leads table (no guessing, no caching).
//   2) Hands that snapshot plus the chat history to Gemini, with a system
//      prompt describing Mr Shifu's personality, and returns his reply.
// If the Gemini call fails for any reason (bad/missing key, network, rate
// limit), we still return a plain-English sentence built from the real
// numbers rather than an error — the stats are always trustworthy even if
// the chatty wrapper around them isn't available.
// ---------------------------------------------------------------------------

const SHIFT_START_HOUR = 10; // 10am IST
const SHIFT_END_HOUR = 19; // 7pm IST
const SHIFT_DAYS = [1, 2, 3, 4, 5, 6]; // Mon-Sat (0 = Sunday, off)

function istNow(): { date: string; hour: number; weekday: number; label: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const hour = Number(get('hour'));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = weekdayMap[get('weekday')] ?? 0;
  const label = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
  return { date, hour, weekday, label };
}

function isOnShift(): boolean {
  const { hour, weekday } = istNow();
  return SHIFT_DAYS.includes(weekday) && hour >= SHIFT_START_HOUR && hour < SHIFT_END_HOUR;
}

const ATTEMPT_TODAY_SUM = Array.from(
  { length: 9 },
  (_, i) => `(CASE WHEN attempt${i + 1}_date = $1 THEN 1 ELSE 0 END)`
).join(' + ');

type Stats = Record<string, number>;

const ATTENTION_LIMIT = 5;

async function getAttention(role: string, userId: number, today: string): Promise<string[]> {
  if (role === 'presales_agent') {
    const rows = await sql.query(
      `(SELECT lead_code AS code, 'follow-up overdue since ' || next_followup_date::text AS why
        FROM leads WHERE owner_user_id = $1 AND next_followup_date < $2 AND status <> 'Not Qualified'
        ORDER BY next_followup_date ASC LIMIT ${ATTENTION_LIMIT})
       UNION ALL
       (SELECT lead_code AS code, 'qualified but no meeting booked yet' AS why
        FROM leads WHERE owner_user_id = $1 AND qualification_status = 'Qualified' AND meeting_date IS NULL
        LIMIT ${ATTENTION_LIMIT})`,
      [userId, today]
    );
    return (rows as { code: string; why: string }[]).map((r) => `${r.code}: ${r.why}`);
  }
  if (role === 'vertical_head') {
    const rows = await sql.query(
      `SELECT lead_code AS code
       FROM leads WHERE assigned_vh_user_id = $1 AND assigned_counsellor_user_id IS NULL
       ORDER BY qualified_at ASC NULLS LAST LIMIT ${ATTENTION_LIMIT}`,
      [userId]
    );
    return (rows as { code: string }[]).map((r) => `${r.code}: qualified, still waiting on a counsellor assignment`);
  }
  if (role === 'sales_counsellor') {
    const rows = await sql.query(
      `(SELECT lead_code AS code, 'follow-up overdue since ' || next_followup_date::text AS why
        FROM leads WHERE assigned_counsellor_user_id = $1 AND next_followup_date < $2
        ORDER BY next_followup_date ASC LIMIT ${ATTENTION_LIMIT})
       UNION ALL
       (SELECT lead_code AS code, 'meeting was rescheduled but no new date/time set yet' AS why
        FROM leads WHERE assigned_counsellor_user_id = $1 AND connecting_status = 'Rescheduled' AND next_meeting_date IS NULL
        LIMIT ${ATTENTION_LIMIT})
       UNION ALL
       (SELECT lead_code AS code, 'trial was rescheduled but no new date/time set yet' AS why
        FROM leads WHERE assigned_counsellor_user_id = $1 AND trial_status = 'Rescheduled' AND next_trial_date IS NULL
        LIMIT ${ATTENTION_LIMIT})
       UNION ALL
       (SELECT lead_code AS code, 'trial is done but admission decision is still pending' AS why
        FROM leads WHERE assigned_counsellor_user_id = $1 AND trial_status = 'Trial Done' AND admission_status = 'Pending'
        LIMIT ${ATTENTION_LIMIT})`,
      [userId, today]
    );
    return (rows as { code: string; why: string }[]).map((r) => `${r.code}: ${r.why}`);
  }
  // admin / data_team — worst overdue follow-ups across the whole team
  const rows = await sql.query(
    `SELECT l.lead_code AS code, u.name AS owner, l.next_followup_date::text AS due
     FROM leads l LEFT JOIN users u ON u.id = l.owner_user_id
     WHERE l.next_followup_date < $1 AND l.status <> 'Not Qualified'
     ORDER BY l.next_followup_date ASC LIMIT ${ATTENTION_LIMIT}`,
    [today]
  );
  return (rows as { code: string; owner: string | null; due: string }[]).map(
    (r) => `${r.code} (${r.owner || 'unassigned'}): follow-up overdue since ${r.due}`
  );
}

async function getStats(role: string, userId: number, today: string): Promise<Stats> {
  if (role === 'presales_agent') {
    const rows = await sql.query(
      `SELECT
         COALESCE(SUM(${ATTEMPT_TODAY_SUM}), 0)::int AS calls_today,
         COUNT(*) FILTER (WHERE meeting_date = $1) AS meetings_today,
         COUNT(*) FILTER (WHERE (qualified_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS qualified_today,
         COUNT(*) FILTER (WHERE next_followup_date <= $1) AS followups_due,
         COUNT(*) FILTER (WHERE status = 'New') AS new_leads,
         COUNT(*) FILTER (WHERE status = 'Follow-up Needed') AS followup_needed,
         COUNT(*) AS total_leads
       FROM leads WHERE owner_user_id = $2`,
      [today, userId]
    );
    return rows[0] as Stats;
  }
  if (role === 'vertical_head') {
    const rows = await sql.query(
      `SELECT
         COUNT(*) FILTER (WHERE assigned_counsellor_user_id IS NULL) AS pending_assignment,
         COUNT(*) FILTER (WHERE (counsellor_assigned_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS assigned_today,
         COUNT(*) AS total_assigned
       FROM leads WHERE assigned_vh_user_id = $2`,
      [today, userId]
    );
    return rows[0] as Stats;
  }
  if (role === 'sales_counsellor') {
    const rows = await sql.query(
      `SELECT
         COUNT(*) FILTER (WHERE meeting_date = $1) AS meetings_today,
         COUNT(*) FILTER (WHERE trial_date = $1) AS trials_today,
         COUNT(*) FILTER (WHERE admission_status = 'Closed Won' AND (admission_timestamp AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS admissions_won_today,
         COUNT(*) FILTER (WHERE admission_status = 'Closed Lost' AND (admission_timestamp AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS admissions_lost_today,
         COUNT(*) FILTER (WHERE next_followup_date <= $1) AS followups_due,
         COUNT(*) AS total_leads
       FROM leads WHERE assigned_counsellor_user_id = $2`,
      [today, userId]
    );
    return rows[0] as Stats;
  }
  // admin / data_team — whole org
  const rows = await sql.query(
    `SELECT
       COALESCE(SUM(${ATTEMPT_TODAY_SUM}), 0)::int AS calls_today,
       COUNT(*) FILTER (WHERE meeting_date = $1) AS meetings_today,
       COUNT(*) FILTER (WHERE (qualified_at AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS qualified_today,
       COUNT(*) FILTER (WHERE admission_status = 'Closed Won' AND (admission_timestamp AT TIME ZONE 'Asia/Kolkata')::date = $1::date) AS admissions_won_today,
       COUNT(*) AS total_leads
     FROM leads`,
    [today]
  );
  return rows[0] as Stats;
}

function statsToPlainEnglish(role: string, s: Stats): string {
  if (role === 'presales_agent') {
    return `So far today: ${s.calls_today} calls logged, ${s.meetings_today} meetings on today's board, ${s.qualified_today} leads qualified. ${s.followups_due} follow-ups are due. You have ${s.new_leads} new and ${s.followup_needed} in follow-up needed.`;
  }
  if (role === 'vertical_head') {
    return `${s.pending_assignment} qualified leads are waiting for you to assign a counsellor. You've assigned ${s.assigned_today} today, out of ${s.total_assigned} total under you.`;
  }
  if (role === 'sales_counsellor') {
    return `Today: ${s.meetings_today} meetings, ${s.trials_today} trials, ${s.admissions_won_today} admissions closed won and ${s.admissions_lost_today} closed lost. ${s.followups_due} follow-ups are due.`;
  }
  return `Org-wide today: ${s.calls_today} calls, ${s.meetings_today} meetings, ${s.qualified_today} qualified, ${s.admissions_won_today} admissions won. ${s.total_leads} leads total in the system.`;
}

function systemPrompt(name: string, role: string, s: Stats, attention: string[], onShift: boolean, timeLabel: string): string {
  const roleLabel: Record<string, string> = {
    presales_agent: 'Pre-Sales Agent',
    vertical_head: 'Vertical Head',
    sales_counsellor: 'Sales Counsellor',
    admin: 'Admin',
    data_team: 'Data Team',
  };
  const attentionText = attention.length
    ? `Leads that need attention right now (mention their lead ID exactly as written when relevant):\n${attention.map((a) => `- ${a}`).join('\n')}`
    : `Nothing flagged as needing attention right now — everything under ${name} looks up to date.`;
  return `You are Mr Shifu, a friendly Shih Tzu dog who lives inside a CRM app called mini-crm, used by a sales team. You are talking to ${name}, who is a ${roleLabel[role] || role}. You are warm, playful, upbeat and encouraging like a loyal dog companion, but you are ALSO effectively their manager: you know their work numbers, you gently keep them accountable, and you help them stay on top of follow-ups. Keep replies short (2-4 sentences), conversational, plain simple English, occasional light dog-ish flavor (a "woof" or tail-wag energy) but never childish or annoying, and never use complicated business jargon. It is currently ${timeLabel} IST. ${onShift ? "You are on shift right now (10am-7pm IST, Mon-Sat)." : "You are currently off shift (shift is 10am-7pm IST, Monday to Saturday) — you can still chat and answer questions, just mention briefly that you're off the clock if it's relevant, without refusing to help."}

Here is ${name}'s real, live data right now — always use these exact numbers and lead IDs, never invent or guess any number, name, or lead ID that isn't given to you below:
${statsToPlainEnglish(role, s)}

${attentionText}

Your job: celebrate wins, nudge gently on what's overdue or missing (naming the specific lead ID when you have one), answer questions about their numbers using only the data above, and be a supportive presence. Stay strictly on the topic of their CRM work — leads, calls, meetings, trials, admissions, follow-ups, their team. If asked something unrelated to their work in this CRM (general knowledge, other topics, anything you have no data for), gently redirect back to work in one short friendly line rather than answering it, since your whole job here is to be their work companion, not a general chatbot.`;
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    message?: string;
    history?: { role: 'user' | 'model'; text: string }[];
    nudge?: boolean;
  };

  const { date: today, label: timeLabel } = istNow();
  const onShift = isOnShift();

  let stats: Stats;
  let attention: string[];
  try {
    stats = await getStats(session.role, session.id, today);
    attention = await getAttention(session.role, session.id, today);
  } catch (err) {
    console.error('Mr Shifu stats query failed:', err);
    return NextResponse.json({ error: 'Could not load your stats right now.' }, { status: 500 });
  }

  const attentionLine = attention.length ? ` Heads up: ${attention[0]}.` : '';
  const fallbackReply = body.nudge
    ? `Hey ${session.name.split(' ')[0]}! ${statsToPlainEnglish(session.role, stats)}${attentionLine}`
    : `${statsToPlainEnglish(session.role, stats)}${attentionLine}`;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ reply: fallbackReply, stats });
  }

  const prompt = systemPrompt(session.name, session.role, stats, attention, onShift, timeLabel);
  const history = (body.history || []).slice(-12);
  const contents = [
    ...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    {
      role: 'user',
      parts: [{ text: body.nudge ? 'Give me a short, friendly proactive check-in based on my numbers above.' : (body.message || '') }],
    },
  ];

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: prompt }] },
          contents,
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 500,
            // Newer Gemini models "think" before answering by default, which was
            // silently eating the reply and leaving only a stray fragment — this
            // model doesn't need deep reasoning for a short friendly chat reply,
            // so thinking is switched off entirely for speed and reliability.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );
    if (!res.ok) {
      console.error('Gemini call failed:', res.status, await res.text().catch(() => ''));
      return NextResponse.json({ reply: fallbackReply, stats });
    }
    const data = await res.json();
    // A reply can come back as several parts (rare, but happens) — join every
    // non-thought text part rather than trusting parts[0] alone, which is what
    // produced the truncated/garbled fragments seen before this fix.
    const parts = data?.candidates?.[0]?.content?.parts as { text?: string; thought?: boolean }[] | undefined;
    const text = parts
      ?.filter((p) => !p.thought && p.text)
      .map((p) => p.text)
      .join('')
      .trim();
    const finishReason = data?.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      console.error('Gemini finished abnormally:', finishReason, JSON.stringify(data).slice(0, 500));
    }
    return NextResponse.json({ reply: text || fallbackReply, stats });
  } catch (err) {
    console.error('Gemini call threw:', err);
    return NextResponse.json({ reply: fallbackReply, stats });
  }
}
