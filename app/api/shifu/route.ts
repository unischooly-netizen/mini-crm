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

function systemPrompt(name: string, role: string, s: Stats, onShift: boolean, timeLabel: string): string {
  const roleLabel: Record<string, string> = {
    presales_agent: 'Pre-Sales Agent',
    vertical_head: 'Vertical Head',
    sales_counsellor: 'Sales Counsellor',
    admin: 'Admin',
    data_team: 'Data Team',
  };
  return `You are Mr Shifu, a friendly Shih Tzu dog who lives inside a CRM app called mini-crm, used by a sales team. You are talking to ${name}, who is a ${roleLabel[role] || role}. You are warm, playful, upbeat and encouraging like a loyal dog companion, but you are ALSO effectively their manager: you know their work numbers, you gently keep them accountable, and you help them stay on top of follow-ups. Keep replies short (2-4 sentences), conversational, plain simple English, occasional light dog-ish flavor (a "woof" or tail-wag energy) but never childish or annoying, and never use complicated business jargon. It is currently ${timeLabel} IST. ${onShift ? "You are on shift right now (10am-7pm IST, Mon-Sat)." : "You are currently off shift (shift is 10am-7pm IST, Monday to Saturday) — you can still chat and answer questions, just mention briefly that you're off the clock if it's relevant, without refusing to help."}

Here is ${name}'s real, live data right now — always use these exact numbers, never make numbers up:
${statsToPlainEnglish(role, s)}

Your job: celebrate wins, nudge gently on what's overdue (like follow-ups due), answer any question about their numbers using the data above, and be a supportive presence. If asked something outside your knowledge of this data, be honest that you only track their CRM activity.`;
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
  try {
    stats = await getStats(session.role, session.id, today);
  } catch (err) {
    console.error('Mr Shifu stats query failed:', err);
    return NextResponse.json({ error: 'Could not load your stats right now.' }, { status: 500 });
  }

  const fallbackReply = body.nudge
    ? `Hey ${session.name.split(' ')[0]}! ${statsToPlainEnglish(session.role, stats)}`
    : statsToPlainEnglish(session.role, stats);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ reply: fallbackReply, stats });
  }

  const prompt = systemPrompt(session.name, session.role, stats, onShift, timeLabel);
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
          generationConfig: { temperature: 0.8, maxOutputTokens: 220 },
        }),
      }
    );
    if (!res.ok) {
      console.error('Gemini call failed:', res.status, await res.text().catch(() => ''));
      return NextResponse.json({ reply: fallbackReply, stats });
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return NextResponse.json({ reply: text || fallbackReply, stats });
  } catch (err) {
    console.error('Gemini call threw:', err);
    return NextResponse.json({ reply: fallbackReply, stats });
  }
}
