// app/api/shifu/chat/route.ts — Phase B.
//
// The new chat endpoint. Deliberately separate from the live
// app/api/shifu/route.ts, which keeps working unchanged — this route is
// not linked from MrShifu.tsx or any page yet, per the standing
// instruction not to swap production Shifu until this is reviewed and
// approved. All it does is authenticate the session and hand off to
// handleShifuChat(), which does the real work using only Phase A/B
// modules — no CRM query logic lives in this file.

import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { handleShifuChat } from '@/app/lib/shifu/chat-handler';

export async function POST(request: NextRequest) {
  // Per brief section 2: the authenticated user's id/name/role come only
  // from the server-side session — never from the request body, even if
  // the client sends something under those names.
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Not logged in.' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    message?: string;
    history?: { role: 'user' | 'model'; text: string }[];
  };

  if (typeof body.message !== 'string' || !body.message.trim()) {
    return NextResponse.json({ error: 'Message is required.' }, { status: 400 });
  }

  try {
    const result = await handleShifuChat(session, body.message, body.history ?? []);
    return NextResponse.json(result);
  } catch (err) {
    console.error('POST /api/shifu/chat failed:', err);
    // Brief item 19: if the CRM query fails, do not ask Gemini to
    // improvise — return a safe, honest error instead.
    return NextResponse.json({ message: "I couldn't read that CRM information just now. Please try again.", intent: 'ERROR', source: 'error' }, { status: 200 });
  }
}
