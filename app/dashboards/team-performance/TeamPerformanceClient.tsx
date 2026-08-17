'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandHeader } from '@/app/components/BrandHeader';
import { KpiCard, FilterField, selectStyle, cardStyle, CHART_COLORS } from '@/app/components/DashboardKit';
import {
  ResponsiveContainer, FunnelChart, Funnel, LabelList, Tooltip, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';

type Role = 'admin' | 'presales_agent' | 'vertical_head' | 'sales_counsellor' | 'data_team';

type AgentRow = {
  agent: string;
  assigned: number; touched: number; calledTotal: number; connectedAttempts: number; uniqueConnected: number;
  qualified: number; followUpNeeded: number; notQualified: number;
  meetingScheduled: number; meetingDone: number; meetingRescheduled: number; meetingCancelled: number; meetingNotDone: number;
  trialScheduled: number; trialDone: number; admissionWon: number;
  callConnectionRate: number; leadConnectionRate: number;
  qualifiedPerAssigned: number; qualifiedPerTouched: number; qualifiedPerConnected: number;
  untouched: number; avgAttemptsPerTouched: number;
  rank: number;
};

type BreakdownRow = AgentRow & { key: string };

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function rateTone(rate: number): 'green' | 'yellow' | 'red' {
  if (rate >= 0.4) return 'green';
  if (rate >= 0.2) return 'yellow';
  return 'red';
}

const MEDAL_STYLES = [
  { emoji: '🥇', bg: 'linear-gradient(135deg,#fff6d8,#ffe28a)', border: '#d4af37', label: '1st' },
  { emoji: '🥈', bg: 'linear-gradient(135deg,#f4f6f8,#dfe4e8)', border: '#a7abb0', label: '2nd' },
  { emoji: '🥉', bg: 'linear-gradient(135deg,#fbe4d0,#eec19a)', border: '#c07a3a', label: '3rd' },
];

export default function TeamPerformanceClient({ role, selfName }: { role: Role; selfName: string }) {
  const router = useRouter();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [language, setLanguage] = useState('All');
  const [source, setSource] = useState('All');
  const [agent, setAgent] = useState('All');

  const [data, setData] = useState<{
    today: string; tomorrow: string;
    team: AgentRow;
    perAgent: AgentRow[];
    byLanguage: BreakdownRow[]; bySource: BreakdownRow[]; byMode: BreakdownRow[];
    agentModeMatrix: Record<string, Record<string, number>>;
    snapshot: {
      attemptsToday: number; connectedToday: number; qualifiedToday: number;
      meetingsToday: number; meetingsTodayStatus: Record<string, number>;
      rescheduledToTomorrow: number; followupsDueTomorrow: number;
    };
    filterOptions: { agents: string[]; languages: string[]; sources: string[] };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const isAgentRole = role === 'presales_agent';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ startDate, endDate, language, source, agent: isAgentRole ? 'All' : agent });
      const res = await fetch(`/api/dashboards/team-performance?${qs.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || `Could not load team performance (server said: ${res.status}).`);
        return;
      }
      setData(json);
      if (!startDate) setStartDate('');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, language, source, agent, isAgentRole]);

  useEffect(() => {
    load();
  }, [load]);

  function resetFilters() {
    setStartDate('');
    setEndDate('');
    setLanguage('All');
    setSource('All');
    setAgent('All');
  }

  const funnelData = useMemo(() => {
    if (!data) return [];
    const t = data.team;
    return [
      { name: 'Assigned', value: t.assigned },
      { name: 'Touched', value: t.touched },
      { name: 'Connected', value: t.uniqueConnected },
      { name: 'Qualified', value: t.qualified },
      { name: 'Meeting Scheduled', value: t.meetingScheduled },
      { name: 'Meeting Done', value: t.meetingDone },
      { name: 'Trial Scheduled', value: t.trialScheduled },
      { name: 'Trial Done', value: t.trialDone },
      { name: 'Admission Won', value: t.admissionWon },
    ];
  }, [data]);

  const meetingOutcomeData = useMemo(() => {
    if (!data) return [];
    const t = data.team;
    return [
      { name: 'Done', value: t.meetingDone },
      { name: 'Not Done', value: t.meetingNotDone },
      { name: 'Rescheduled', value: t.meetingRescheduled },
      { name: 'Cancelled', value: t.meetingCancelled },
    ];
  }, [data]);

  const top3 = data ? data.perAgent.filter((a) => a.assigned > 0).slice(0, 3) : [];
  const rest = data ? data.perAgent.filter((a) => !top3.includes(a)) : [];

  return (
    <div style={{ maxWidth: '96vw', margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <BrandHeader subtitle="Team Performance" />
        <button onClick={() => router.back()} style={backButtonStyle}>← Back</button>
      </div>

      {error ? (
        <div style={{ background: '#fdeaea', border: '1px solid #f3b8b8', borderRadius: 4, padding: 12, marginBottom: 16, color: '#b3261e' }}>
          {error}
        </div>
      ) : null}

      <div style={cardStyle}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <FilterField label="Start Date">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={selectStyle} />
          </FilterField>
          <FilterField label="End Date">
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={selectStyle} />
          </FilterField>
          <FilterField label="Language">
            <select value={language} onChange={(e) => setLanguage(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {(data?.filterOptions.languages || []).map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Source">
            <select value={source} onChange={(e) => setSource(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {(data?.filterOptions.sources || []).map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </FilterField>
          {!isAgentRole ? (
            <FilterField label="Agent">
              <select value={agent} onChange={(e) => setAgent(e.target.value)} style={selectStyle}>
                <option value="All">All</option>
                {(data?.filterOptions.agents || []).map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </FilterField>
          ) : (
            <p style={{ fontSize: 12, color: '#777', margin: 0 }}>Showing the full team so you can see where you stand, {selfName}.</p>
          )}
          <button onClick={resetFilters} style={resetButtonStyle}>Reset filters</button>
          <span style={{ fontSize: 11, color: '#999' }}>Leaves Start/End blank for last 30 days by default.</span>
        </div>
      </div>

      {loading || !data ? (
        <p>Loading…</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            <KpiCard label="Total Assigned" value={String(data.team.assigned)} />
            <KpiCard label="Unique Touched" value={String(data.team.touched)} />
            <KpiCard label="Total Call Attempts" value={String(data.team.calledTotal)} />
            <KpiCard label="Unique Connected" value={String(data.team.uniqueConnected)} />
            <KpiCard label="Call Connection %" value={pct(data.team.callConnectionRate)} tone={rateTone(data.team.callConnectionRate)} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <KpiCard label="Total Qualified" value={String(data.team.qualified)} tone="green" />
            <KpiCard label="Qualified / Assigned %" value={pct(data.team.qualifiedPerAssigned)} tone={rateTone(data.team.qualifiedPerAssigned)} />
            <KpiCard label="Untouched Leads" value={String(data.team.untouched)} tone={data.team.untouched > 0 ? 'yellow' : 'green'} />
            <KpiCard label="Avg Attempts / Touched" value={data.team.avgAttemptsPerTouched.toFixed(1)} />
            <KpiCard label="Admission Won" value={String(data.team.admissionWon)} tone="green" />
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ ...cardStyle, flex: '2 1 520px', margin: 0 }}>
              <h3 style={{ marginTop: 0, fontSize: 14 }}>End-to-End Funnel (Assigned → Admission)</h3>
              <ResponsiveContainer width="100%" height={320}>
                <FunnelChart>
                  <Tooltip />
                  <Funnel dataKey="value" data={funnelData} isAnimationActive>
                    <LabelList position="right" dataKey="name" fill="#333" stroke="none" />
                    <LabelList position="left" dataKey="value" fill="#333" stroke="none" />
                    {funnelData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Funnel>
                </FunnelChart>
              </ResponsiveContainer>
            </div>
            <div style={{ ...cardStyle, flex: '1 1 320px', margin: 0 }}>
              <h3 style={{ marginTop: 0, fontSize: 14 }}>Meeting Outcome Breakdown</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={meetingOutcomeData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#1a56c4" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Today&apos;s Activity &amp; Tomorrow&apos;s Outlook</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <KpiCard label="Call Attempts Today" value={String(data.snapshot.attemptsToday)} />
              <KpiCard label="Connected Today" value={String(data.snapshot.connectedToday)} tone="green" />
              <KpiCard label="Qualified Today" value={String(data.snapshot.qualifiedToday)} tone="green" />
              <KpiCard label="Meetings Scheduled Today" value={String(data.snapshot.meetingsToday)} />
              <KpiCard label="Rescheduled to Tomorrow" value={String(data.snapshot.rescheduledToTomorrow)} tone={data.snapshot.rescheduledToTomorrow > 0 ? 'yellow' : 'green'} />
              <KpiCard label="Follow-ups Due Tomorrow" value={String(data.snapshot.followupsDueTomorrow)} />
            </div>
            {Object.keys(data.snapshot.meetingsTodayStatus).length > 0 ? (
              <p style={{ fontSize: 13, color: '#555', marginTop: 10, marginBottom: 0 }}>
                Today&apos;s meeting status: {Object.entries(data.snapshot.meetingsTodayStatus).map(([k, v]) => `${k}: ${v}`).join(', ')}
              </p>
            ) : null}
          </div>

          <div style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Leaderboard — ranked by Qualified / Assigned %</h3>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
              {top3.map((a, i) => {
                const medal = MEDAL_STYLES[i];
                return (
                  <div key={a.agent} style={{
                    flex: '1 1 220px', background: medal.bg, border: `2px solid ${medal.border}`, borderRadius: 10,
                    padding: '16px 18px', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 36 }}>{medal.emoji}</div>
                    <div style={{ fontWeight: 700, fontSize: 17, marginTop: 4 }}>{a.agent}</div>
                    <div style={{ fontSize: 13, color: '#555', marginTop: 2 }}>{medal.label} place</div>
                    <div style={{ fontSize: 22, fontWeight: 700, marginTop: 8 }}>{pct(a.qualifiedPerAssigned)}</div>
                    <div style={{ fontSize: 11, color: '#666' }}>Qualified / Assigned</div>
                    <div style={{ fontSize: 12, color: '#555', marginTop: 6 }}>{a.qualified} qualified of {a.assigned} assigned</div>
                  </div>
                );
              })}
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
                    <th style={thStyle}>Rank</th><th style={thStyle}>Agent</th>
                    <th style={thStyle}>Assigned</th><th style={thStyle}>Touched</th><th style={thStyle}>Attempts</th>
                    <th style={thStyle}>Connected</th><th style={thStyle}>Call Conn. %</th><th style={thStyle}>Lead Conn. %</th>
                    <th style={thStyle}>Qualified</th><th style={thStyle}>Qual/Assigned</th><th style={thStyle}>Qual/Touched</th><th style={thStyle}>Qual/Connected</th>
                    <th style={thStyle}>Follow-up</th><th style={thStyle}>Not Qualified</th><th style={thStyle}>Untouched</th>
                    <th style={thStyle}>Meeting Done</th><th style={thStyle}>Not Done</th><th style={thStyle}>Resched.</th><th style={thStyle}>Cancelled</th>
                    <th style={thStyle}>Trial Done</th><th style={thStyle}>Admission Won</th>
                  </tr>
                </thead>
                <tbody>
                  {[...top3, ...rest].map((a) => (
                    <tr key={a.agent} style={{ borderBottom: '1px solid #eee', background: a.rank <= 3 ? '#fffdf6' : undefined }}>
                      <td style={tdStyle}>{a.rank <= 3 ? MEDAL_STYLES[a.rank - 1].emoji : a.rank}</td>
                      <td style={tdStyle}>{a.agent}</td>
                      <td style={tdStyle}>{a.assigned}</td>
                      <td style={tdStyle}>{a.touched}</td>
                      <td style={tdStyle}>{a.calledTotal}</td>
                      <td style={tdStyle}>{a.uniqueConnected}</td>
                      <td style={tdStyle}>{pct(a.callConnectionRate)}</td>
                      <td style={tdStyle}>{pct(a.leadConnectionRate)}</td>
                      <td style={tdStyle}>{a.qualified}</td>
                      <td style={tdStyle}>{pct(a.qualifiedPerAssigned)}</td>
                      <td style={tdStyle}>{pct(a.qualifiedPerTouched)}</td>
                      <td style={tdStyle}>{pct(a.qualifiedPerConnected)}</td>
                      <td style={tdStyle}>{a.followUpNeeded}</td>
                      <td style={tdStyle}>{a.notQualified}</td>
                      <td style={{ ...tdStyle, color: a.untouched > 0 ? '#a15c00' : undefined }}>{a.untouched}</td>
                      <td style={tdStyle}>{a.meetingDone}</td>
                      <td style={tdStyle}>{a.meetingNotDone}</td>
                      <td style={tdStyle}>{a.meetingRescheduled}</td>
                      <td style={tdStyle}>{a.meetingCancelled}</td>
                      <td style={tdStyle}>{a.trialDone}</td>
                      <td style={tdStyle}>{a.admissionWon}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <BreakdownCard title="By Language" rows={data.byLanguage} />
            <BreakdownCard title="By Source" rows={data.bySource} />
            <BreakdownCard title="By Mode" rows={data.byMode} />
          </div>

          <div style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Agent × Mode</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
                    <th style={thStyle}>Agent</th>
                    {['Phone Call', 'Teams Meet', 'Whatsapp call', 'Google Meet', 'Not Set'].map((m) => (
                      <th key={m} style={thStyle}>{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.agentModeMatrix).map(([agentName, modes]) => (
                    <tr key={agentName} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={tdStyle}>{agentName}</td>
                      {['Phone Call', 'Teams Meet', 'Whatsapp call', 'Google Meet', 'Not Set'].map((m) => (
                        <td key={m} style={tdStyle}>{modes[m] || 0}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BreakdownCard({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  const chartData = rows.map((r) => ({ name: r.key, value: r.assigned }));
  return (
    <div style={{ ...cardStyle, flex: '1 1 340px', margin: 0 }}>
      <h3 style={{ marginTop: 0, fontSize: 14 }}>{title}</h3>
      {chartData.length ? (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="value" fill="#1a56c4" />
          </BarChart>
        </ResponsiveContainer>
      ) : null}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
            <th style={thStyleSm}>Name</th><th style={thStyleSm}>Assigned</th><th style={thStyleSm}>Qualified</th><th style={thStyleSm}>Qual %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={tdStyleSm}>{r.key}</td>
              <td style={tdStyleSm}>{r.assigned}</td>
              <td style={tdStyleSm}>{r.qualified}</td>
              <td style={tdStyleSm}>{pct(r.qualifiedPerAssigned)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: '8px 10px', whiteSpace: 'nowrap' };
const tdStyle: React.CSSProperties = { padding: '8px 10px', whiteSpace: 'nowrap' };
const thStyleSm: React.CSSProperties = { padding: '4px 6px', whiteSpace: 'nowrap' };
const tdStyleSm: React.CSSProperties = { padding: '4px 6px', whiteSpace: 'nowrap' };
const backButtonStyle: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 4, border: '1px solid #ccc', background: '#fff', cursor: 'pointer', fontSize: 13,
};
const resetButtonStyle: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 4, border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer', fontSize: 13, height: 34,
};
