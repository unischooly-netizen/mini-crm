'use client';

import { useEffect, useRef, useState } from 'react';

type Msg = { role: 'user' | 'model'; text: string };
type Me = { id: number; name: string; role: string };

const VISIT_INTERVAL_MS = 2 * 60 * 60 * 1000; // how often he wanders over on his own during shift
const AUTO_COLLAPSE_MS = 25000; // walks off again if ignored
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // how often we check whether it's time for a visit

function istParts() {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false, weekday: 'short' });
  const parts = fmt.formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || '0');
  const weekday = parts.find((p) => p.type === 'weekday')?.value || '';
  return { hour, weekday };
}

function isOnShiftNow(): boolean {
  const { hour, weekday } = istParts();
  return weekday !== 'Sun' && hour >= 10 && hour < 19;
}

function ls() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function getPauseUntil(): number {
  const v = ls()?.getItem('shifu-pause-until');
  return v ? Number(v) : 0;
}
function setPauseUntil(ts: number) {
  ls()?.setItem('shifu-pause-until', String(ts));
}
function getLastVisit(): number {
  const v = ls()?.getItem('shifu-last-visit');
  return v ? Number(v) : 0;
}
function setLastVisit(ts: number) {
  ls()?.setItem('shifu-last-visit', String(ts));
}

export default function MrShifu() {
  const [me, setMe] = useState<Me | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(false);
  const [showPauseMenu, setShowPauseMenu] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setMe(data))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    setPaused(Date.now() < getPauseUntil());
  }, []);

  async function requestVisit(isAuto: boolean) {
    setExpanded(true);
    setLoading(true);
    try {
      const res = await fetch('/api/shifu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nudge: true, history: [] }),
      });
      const data = await res.json().catch(() => null);
      setMessages([{ role: 'model', text: data?.reply || "Woof! Just stopping by to say hi." }]);
    } catch {
      setMessages([{ role: 'model', text: "Woof! Just stopping by to say hi." }]);
    } finally {
      setLoading(false);
    }
    if (isAuto) setLastVisit(Date.now());
    armAutoCollapse();
  }

  function armAutoCollapse() {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    collapseTimer.current = setTimeout(() => setExpanded(false), AUTO_COLLAPSE_MS);
  }

  function cancelAutoCollapse() {
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
  }

  // Periodically check whether it's time for Mr Shifu to wander over on his own —
  // gated by shift hours, quiet-mode pause, and how long since his last visit.
  useEffect(() => {
    if (!me || startedRef.current) return;
    startedRef.current = true;

    function maybeVisit() {
      if (Date.now() < getPauseUntil()) return;
      if (!isOnShiftNow()) return;
      if (Date.now() - getLastVisit() < VISIT_INTERVAL_MS) return;
      requestVisit(true);
    }

    const firstDelay = setTimeout(maybeVisit, 8000); // small delay so it never fires before the page has settled
    const interval = setInterval(maybeVisit, CHECK_INTERVAL_MS);
    return () => {
      clearTimeout(firstDelay);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, expanded]);

  function openChat() {
    cancelAutoCollapse();
    if (messages.length === 0) {
      setMessages([{ role: 'model', text: `Woof! I'm Mr Shifu. Ask me anything about your leads, or how your day's going.` }]);
    }
    setExpanded(true);
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    cancelAutoCollapse();
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

  function pauseFor(ms: number) {
    setPauseUntil(Date.now() + ms);
    setPaused(true);
    setShowPauseMenu(false);
    setExpanded(false);
  }

  function pauseUntilTomorrow() {
    const now = new Date();
    const tomorrow10am = new Date(now);
    tomorrow10am.setDate(now.getDate() + 1);
    tomorrow10am.setHours(10, 0, 0, 0);
    setPauseUntil(tomorrow10am.getTime());
    setPaused(true);
    setShowPauseMenu(false);
    setExpanded(false);
  }

  function resume() {
    setPauseUntil(0);
    setPaused(false);
    setShowPauseMenu(false);
  }

  if (!me) return null;

  return (
    <>
      <style>{`
        @keyframes shifu-bob { 0%, 100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-5px) rotate(-1.5deg); } }
        .shifu-dock { animation: shifu-bob 3.2s ease-in-out infinite; }
        .shifu-wrap { position: fixed; bottom: 0; right: 16px; z-index: 9999; display: flex; align-items: flex-end; gap: 10px; }
        .shifu-img { display: block; cursor: pointer; filter: drop-shadow(0 6px 10px rgba(0,0,0,0.25)); transition: width 0.35s ease, height 0.35s ease; }
      `}</style>

      <div className="shifu-wrap">
        {expanded && (
          <div
            style={{
              width: 300,
              maxWidth: 'calc(100vw - 130px)',
              maxHeight: 380,
              marginBottom: 90,
              background: 'var(--card-bg)',
              border: '1px solid var(--card-border)',
              borderRadius: 16,
              boxShadow: '0 10px 32px rgba(0,0,0,0.22)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                borderBottom: '1px solid var(--card-border)',
                background: 'linear-gradient(135deg, var(--accent-dark), var(--accent))',
                position: 'relative',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>Mr Shifu</div>
              <button
                onClick={() => setShowPauseMenu((v) => !v)}
                title="Quiet mode"
                style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#fff', fontSize: 15, cursor: 'pointer', lineHeight: 1, opacity: 0.9 }}
                aria-label="Quiet mode options"
              >
                ⏸
              </button>
              <button
                onClick={() => {
                  setExpanded(false);
                  setShowPauseMenu(false);
                }}
                style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
                aria-label="Close"
              >
                ×
              </button>

              {showPauseMenu && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    right: 8,
                    marginTop: 6,
                    background: 'var(--card-bg)',
                    border: '1px solid var(--card-border)',
                    borderRadius: 10,
                    boxShadow: '0 6px 18px rgba(0,0,0,0.2)',
                    padding: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    zIndex: 10000,
                    minWidth: 150,
                  }}
                >
                  {paused ? (
                    <button onClick={resume} style={pauseMenuBtn}>Resume check-ins</button>
                  ) : (
                    <>
                      <button onClick={() => pauseFor(30 * 60 * 1000)} style={pauseMenuBtn}>Pause 30 min</button>
                      <button onClick={() => pauseFor(60 * 60 * 1000)} style={pauseMenuBtn}>Pause 1 hour</button>
                      <button onClick={pauseUntilTomorrow} style={pauseMenuBtn}>Pause until tomorrow</button>
                    </>
                  )}
                </div>
              )}
            </div>

            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 120 }}>
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
              {loading && <div style={{ alignSelf: 'flex-start', fontSize: 12, color: 'var(--muted)' }}>Mr Shifu is typing…</div>}
            </div>

            <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid var(--card-border)' }}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={cancelAutoCollapse}
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
                  minWidth: 0,
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

        <img
          src="/mr-shifu.png"
          alt="Mr Shifu"
          onClick={openChat}
          className={`shifu-img${expanded ? '' : ' shifu-dock'}`}
          style={{ width: expanded ? 92 : 68, height: 'auto' }}
        />
      </div>
    </>
  );
}

const pauseMenuBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--fg)',
  fontSize: 12.5,
  textAlign: 'left',
  padding: '6px 8px',
  borderRadius: 6,
  cursor: 'pointer',
};
