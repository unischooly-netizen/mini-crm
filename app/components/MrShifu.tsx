'use client';

import { useEffect, useRef, useState } from 'react';

type Msg = { role: 'user' | 'model'; text: string };
type Me = { id: number; name: string; role: string };

const bubbleStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 20,
  right: 20,
  width: 56,
  height: 56,
  borderRadius: '50%',
  border: '2px solid var(--card-border)',
  background: 'var(--card-bg)',
  boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
  cursor: 'pointer',
  overflow: 'visible',
  zIndex: 9999,
  padding: 0,
};

const panelStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 88,
  right: 20,
  width: 320,
  maxWidth: 'calc(100vw - 32px)',
  height: 420,
  maxHeight: 'calc(100vh - 140px)',
  background: 'var(--card-bg)',
  border: '1px solid var(--card-border)',
  borderRadius: 16,
  boxShadow: '0 10px 32px rgba(0,0,0,0.22)',
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

function todayIstKey(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export default function MrShifu() {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nudgedRef = useRef(false);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setMe(data))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!me || nudgedRef.current) return;
    nudgedRef.current = true;
    const key = `shifu-nudge-${me.id}-${todayIstKey()}`;
    if (typeof window === 'undefined') return;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch {
      return;
    }
    fetch('/api/shifu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nudge: true, history: [] }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.reply) {
          setMessages([{ role: 'model', text: data.reply }]);
          setHasUnread(true);
        }
      })
      .catch(() => {});
  }, [me]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  function greetingIfEmpty() {
    if (messages.length === 0) {
      setMessages([{ role: 'model', text: `Woof! I'm Mr Shifu. Ask me anything about your leads, or how your day's going.` }]);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const nextHistory = [...messages, { role: 'user' as const, text }];
    setMessages(nextHistory);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/shifu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: messages }),
      });
      const data = await res.json().catch(() => null);
      setMessages([...nextHistory, { role: 'model', text: data?.reply || "Sorry, I couldn't fetch that just now — try again in a bit." }]);
    } catch {
      setMessages([...nextHistory, { role: 'model', text: "Sorry, I couldn't fetch that just now — try again in a bit." }]);
    } finally {
      setLoading(false);
    }
  }

  if (!me) return null;

  return (
    <>
      <button
        style={bubbleStyle}
        onClick={() => {
          setOpen((v) => !v);
          setHasUnread(false);
          greetingIfEmpty();
        }}
        aria-label="Open Mr Shifu chat"
      >
        <img
          src="/mr-shifu.png"
          alt="Mr Shifu"
          style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', display: 'block' }}
        />
        {hasUnread && (
          <span
            style={{
              position: 'absolute',
              top: -2,
              right: -2,
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: '#dc2626',
              border: '2px solid var(--card-bg)',
            }}
          />
        )}
      </button>

      {open && (
        <div style={panelStyle}>
          <div
            style={{
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              borderBottom: '1px solid var(--card-border)',
              background: 'linear-gradient(135deg, var(--accent-dark), var(--accent))',
            }}
          >
            <img src="/mr-shifu.png" alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover' }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Mr Shifu</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>your CRM companion</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.map((m, i) => (
              <div
                key={i}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  background: m.role === 'user' ? 'var(--accent)' : 'var(--input-bg)',
                  color: m.role === 'user' ? '#fff' : 'var(--fg)',
                  border: m.role === 'user' ? 'none' : '1px solid var(--card-border)',
                  borderRadius: 10,
                  padding: '8px 11px',
                  fontSize: 13,
                  lineHeight: 1.5,
                  maxWidth: '85%',
                }}
              >
                {m.text}
              </div>
            ))}
            {loading && (
              <div style={{ alignSelf: 'flex-start', fontSize: 12, color: 'var(--muted)' }}>Mr Shifu is typing…</div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid var(--card-border)' }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') send();
              }}
              placeholder="Ask Mr Shifu..."
              style={{
                flex: 1,
                background: 'var(--input-bg)',
                border: '1px solid var(--input-border)',
                borderRadius: 8,
                padding: '8px 10px',
                fontSize: 13,
                color: 'var(--fg)',
              }}
            />
            <button
              onClick={send}
              disabled={loading}
              style={{
                background: 'linear-gradient(135deg, var(--accent-dark), var(--accent))',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
