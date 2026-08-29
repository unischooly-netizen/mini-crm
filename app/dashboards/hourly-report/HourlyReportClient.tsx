'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandHeader } from '@/app/components/BrandHeader';
import { KpiCard, FilterField, selectStyle, cardStyle } from '@/app/components/DashboardKit';
import { formatDate } from '@/lib/format';
import { todayIstDateStr } from '@/lib/followup';

type HourBucket = {
  dialed: number;
  connected: number;
  uniqueTouched: number;
  qualified: number;
  meetsScheduled: number;
  callsScheduled: number;
};

type AgentRow = {
  userId: number;
  name: string;
  hourly: Record<string, HourBucket>;
  totals: HourBucket;
  connectionRate: number;
  followupsPendingToday: number;
  activityScore: number;
};

type LeaderRow = { userId: number; name: string; activityScore: number; totals: HourBucket; rank: number };
type CurrentHourLeaderRow = { userId: number; name: string; hourScore: number; hour: HourBucket; rank: number };

const MEDALS = ['🥇', '🥈', '🥉'];

function hourLabel(h: number): string {
  const to12 = (x: number) => {
    const hh = x % 24;
    const ampm = hh >= 12 ? 'PM' : 'AM';
    let v = hh % 12;
    if (v === 0) v = 12;
    return `${v} ${ampm}`;
  };
  return `${to12(h)} – ${to12(h + 1)}`;
}

export default function HourlyReportClient({ defaultAgent }: { defaultAgent: string }) {
  const router = useRouter();
  const today = todayIstDateStr();

  const [date, setDate] = useState(today);
  const [agent, setAgent] = useState(defaultAgent);
  const [fromHour, setFromHour] = useState(9);
  const [toHour, setToHour] = useState(20);

  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([]);
  const [currentHourLeaderboard, setCurrentHourLeaderboard] = useState<CurrentHourLeaderRow[]>([]);
  const [currentHour, setCurrentHour] = useState<string | null>(null);
  const [scoreWeights, setScoreWeights] = useState({ dialed: 1, connected: 2, qualified: 5, scheduled: 3 });
  const [filterOptions, setFilterOptions] = useState<{ agents: string[] }>({ agents: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ date, agent });
      const res = await fetch(`/api/dashboards/hourly-report?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Could not load the hourly report (server said: ${res.status}).`);
        return;
      }
      setAgents(data.agents || []);
      setLeaderboard(data.leaderboard || []);
      setCurrentHourLeaderboard(data.currentHourLeaderboard || []);
      setCurrentHour(data.currentHour ?? null);
      setScoreWeights(data.scoreWeights || { dialed: 1, connected: 2, qualified: 5, scheduled: 3 });
      setFilterOptions(data.filterOptions || { agents: [] });
    } catch {
      if (!silent) setError('Could not reach the server. Check your connection and try again.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [date, agent]);

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), 60000);
    return () => clearInterval(interval);
  }, [load]);

  const hours = useMemo(() => {
    const out: number[] = [];
    for (let h = fromHour; h <= toHour; h++) out.push(h);
    return out;
  }, [fromHour, toHour]);

  const teamHourly = useMemo(() => {
    const out: Record<number, HourBucket> = {};
    for (const h of hours) {
      const bucket: HourBucket = { dialed: 0, connected: 0, uniqueTouched: 0, qualified: 0, meetsScheduled: 0, callsScheduled: 0 };
      for (const a of agents) {
        const b = a.hourly[String(h)];
        if (!b) continue;
        bucket.dialed += b.dialed;
        bucket.connected += b.connected;
        bucket.qualified += b.qualified;
        bucket.meetsScheduled += b.meetsScheduled;
        bucket.callsScheduled += b.callsScheduled;
      }
      out[h] = bucket;
    }
    return out;
  }, [agents, hours]);

  const singleAgent = agent !== 'All' ? agents[0] : null;

  return (
    <div style={{ maxWidth: '96vw', margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <BrandHeader subtitle="Hourly Report" />
        <button onClick={() => router.back()} style={backButtonStyle}>← Back</button>
      </div>
      <p style={{ color: '#777', fontSize: 13, marginTop: 0, marginBottom: 16 }}>
        Live replacement for the hourly sheet — Dialed / Connected read from each call&apos;s own logged time, Qualified split into
        Meets / Calls Scheduled by Preferred Mode, Follow-ups Pending is a right-now count. Auto-refreshes every minute.
      </p>

      <div style={{ ...cardStyle, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <FilterField label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={selectStyle} max={today} />
        </FilterField>
        <FilterField label="Agent">
          <select value={agent} onChange={(e) => setAgent(e.target.value)} style={selectStyle}>
            <option value="All">All Agents</option>
            {filterOptions.agents.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="From Hour">
          <select value={fromHour} onChange={(e) => setFromHour(Number(e.target.value))} style={selectStyle}>
            {Array.from({ length: 24 }, (_, h) => h).map((h) => (
              <option key={h} value={h}>{hourLabel(h)}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="To Hour">
          <select value={toHour} onChange={(e) => setToHour(Number(e.target.value))} style={selectStyle}>
            {Array.from({ length: 24 }, (_, h) => h).map((h) => (
              <option key={h} value={h}>{hourLabel(h)}</option>
            ))}
          </select>
        </FilterField>
        <button
          onClick={() => { setDate(today); setFromHour(9); setToHour(20); }}
          style={{ ...selectStyle, cursor: 'pointer', fontWeight: 600 }}
        >
          Today, 9 AM–9 PM
        </button>
      </div>

      {error ? (
        <p style={{ color: 'crimson' }}>{error}</p>
      ) : loading ? (
        <p>Loading…</p>
      ) : (
        <>
          {/* ---- Leaderboard / Race ---- */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>🏁 Today&apos;s Race — {formatDate(date)}</h3>
              <span style={{ fontSize: 11, color: '#888' }}>
                Score = {scoreWeights.dialed}×Dialed + {scoreWeights.connected}×Connected + {scoreWeights.qualified}×Qualified + {scoreWeights.scheduled}×(Meets+Calls Scheduled)
              </span>
            </div>

            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 14, marginBottom: 18 }}>
              {leaderboard.slice(0, 3).map((r, i) => (
                <div
                  key={r.userId}
                  style={{
                    flex: '1 1 200px', minWidth: 180, textAlign: 'center', borderRadius: 12, padding: '16px 10px',
                    background: i === 0 ? 'linear-gradient(135deg,#fff6da,#ffe9a8)' : i === 1 ? 'linear-gradient(135deg,#f2f4f7,#e2e6ec)' : 'linear-gradient(135deg,#ffe9dd,#ffd3ba)',
                    border: '1px solid var(--card-border)',
                  }}
                >
                  <div style={{ fontSize: 30 }}>{MEDALS[i]}</div>
                  <div style={{ fontWeight: 700, fontSize: 15, marginTop: 4 }}>{r.name}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#1a56c4', marginTop: 2 }}>{r.activityScore}</div>
                  <div style={{ fontSize: 11, color: '#666' }}>
                    {r.totals.dialed} dialed · {r.totals.connected} connected · {r.totals.qualified} qualified
                  </div>
                </div>
              ))}
              {leaderboard.length === 0 && <p style={{ color: '#888' }}>No activity recorded for this date yet.</p>}
            </div>

            {currentHour !== null && currentHourLeaderboard.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>⚡ This Hour ({hourLabel(Number(currentHour))})</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {currentHourLeaderboard.slice(0, 5).map((r) => (
                    <span key={r.userId} style={{ ...pillStyle, background: r.rank === 1 ? '#e6f6ea' : 'var(--card-bg)', color: r.rank === 1 ? '#0a7a2f' : 'var(--fg)' }}>
                      #{r.rank} {r.name} — {r.hourScore} pts ({r.hour.dialed} dialed)
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Rank</th><th>Agent</th><th>Dialed</th><th>Connected</th><th>Conn %</th>
                    <th>Qualified</th><th>Meets Sched.</th><th>Calls Sched.</th><th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((r) => (
                    <tr key={r.userId}>
                      <td>{r.rank <= 3 ? MEDALS[r.rank - 1] : r.rank}</td>
                      <td>{r.name}</td>
                      <td>{r.totals.dialed}</td>
                      <td>{r.totals.connected}</td>
                      <td>{r.totals.dialed ? `${((r.totals.connected / r.totals.dialed) * 100).toFixed(0)}%` : '—'}</td>
                      <td>{r.totals.qualified}</td>
                      <td>{r.totals.meetsScheduled}</td>
                      <td>{r.totals.callsScheduled}</td>
                      <td style={{ fontWeight: 700 }}>{r.activityScore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ---- Detail: single agent hour-by-hour, or team hour-by-hour totals ---- */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>{singleAgent ? `${singleAgent.name} — Hour by Hour` : 'Team — Hour by Hour'}</h3>
              {singleAgent && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <KpiCard label="Follow-ups Pending Today" value={String(singleAgent.followupsPendingToday)} tone={singleAgent.followupsPendingToday > 0 ? 'yellow' : 'green'} />
                  <KpiCard label="Today's Connection Rate" value={`${(singleAgent.connectionRate * 100).toFixed(0)}%`} tone="neutral" />
                </div>
              )}
            </div>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Hour</th><th>Dialed Call</th><th>Connected Calls</th><th>Meets Scheduled</th><th>Calls Scheduled</th><th>Conn %</th>
                  </tr>
                </thead>
                <tbody>
                  {hours.map((h) => {
                    const b = singleAgent ? singleAgent.hourly[String(h)] : teamHourly[h];
                    const isNow = currentHour !== null && Number(currentHour) === h && date === today;
                    return (
                      <tr key={h} style={isNow ? { background: 'rgba(26,86,196,0.08)', fontWeight: 600 } : undefined}>
                        <td>{hourLabel(h)} {isNow ? '● now' : ''}</td>
                        <td>{b?.dialed ?? 0}</td>
                        <td>{b?.connected ?? 0}</td>
                        <td>{b?.meetsScheduled ?? 0}</td>
                        <td>{b?.callsScheduled ?? 0}</td>
                        <td>{b?.dialed ? `${((b.connected / b.dialed) * 100).toFixed(0)}%` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {!singleAgent && (
            <div style={cardStyle}>
              <h3 style={{ marginTop: 0, fontSize: 16 }}>Per-Agent Totals — {formatDate(date)}</h3>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Agent</th><th>Dialed</th><th>Connected</th><th>Conn %</th><th>Qualified</th>
                      <th>Meets Sched.</th><th>Calls Sched.</th><th>Follow-ups Pending Today</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((a) => (
                      <tr key={a.userId}>
                        <td>{a.name}</td>
                        <td>{a.totals.dialed}</td>
                        <td>{a.totals.connected}</td>
                        <td>{a.totals.dialed ? `${(a.connectionRate * 100).toFixed(0)}%` : '—'}</td>
                        <td>{a.totals.qualified}</td>
                        <td>{a.totals.meetsScheduled}</td>
                        <td>{a.totals.callsScheduled}</td>
                        <td>{a.followupsPendingToday}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const backButtonStyle: React.CSSProperties = {
  padding: '7px 14px',
  background: 'var(--card-bg)',
  color: 'var(--accent-dark)',
  border: '1px solid var(--input-border)',
  borderRadius: 8,
  cursor: 'pointer',
  fontWeight: 500,
};

const pillStyle: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 999,
  border: '1px solid var(--card-border)',
  fontSize: 12,
  fontWeight: 600,
};
