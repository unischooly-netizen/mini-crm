'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandHeader } from '@/app/components/BrandHeader';
import { KpiCard, FilterField, selectStyle, cardStyle, CHART_COLORS } from '@/app/components/DashboardKit';
import { formatDate } from '@/lib/format';
import {
  ResponsiveContainer, FunnelChart, Funnel, LabelList, Tooltip, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';

type PeriodMetrics = {
  leadsAdded: number; uniqueTouched: number; callAttempts: number; connected: number;
  qualified: number; followupsDue: number; meetings: number; trials: number; admissions: number;
};
type FunnelData = {
  assigned: number; touched: number; connected: number; qualified: number; vhAssigned: number; counsellorAssigned: number;
  meetingJoined: number; trialDone: number; closedWon: number;
};
type Sla = {
  assignmentToFirstAttempt: number | null; assignmentToQualification: number | null; qualificationToVh: number | null;
  vhToCounsellor: number | null; meetingToTrial: number | null; trialToAdmission: number | null;
};
type WatchRow = { agent: string; untouched: number; overdue: number; attemptsToday: number; assigned: number; focusScore: number };

function volumeTone(n: number, yellowAt: number, redAt: number): 'green' | 'yellow' | 'red' {
  if (n >= redAt) return 'red';
  if (n >= yellowAt) return 'yellow';
  return 'green';
}

export default function OperationsDashboardClient() {
  const router = useRouter();

  const [language, setLanguage] = useState('All');
  const [source, setSource] = useState('All');
  const [agent, setAgent] = useState('All');

  const [today, setToday] = useState('');
  const [periods, setPeriods] = useState<{ today: PeriodMetrics; yesterday: PeriodMetrics; thisWeek: PeriodMetrics; thisMonth: PeriodMetrics } | null>(null);
  const [overdueNow, setOverdueNow] = useState(0);
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [byLanguage, setByLanguage] = useState<{ key: string; count: number }[]>([]);
  const [bySource, setBySource] = useState<{ key: string; count: number }[]>([]);
  const [sla, setSla] = useState<Sla | null>(null);
  const [watchlist, setWatchlist] = useState<WatchRow[]>([]);
  const [filterOptions, setFilterOptions] = useState<{ languages: string[]; sources: string[]; agents: string[] }>({ languages: [], sources: [], agents: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ language, source, agent });
      const res = await fetch(`/api/dashboards/operations?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Could not load operations dashboard (server said: ${res.status}).`);
        return;
      }
      setToday(data.today || '');
      setPeriods(data.periods);
      setOverdueNow(data.overdueNow || 0);
      setFunnel(data.funnel);
      setByLanguage(data.byLanguage || []);
      setBySource(data.bySource || []);
      setSla(data.sla);
      setWatchlist(data.watchlist || []);
      setFilterOptions(data.filterOptions || { languages: [], sources: [], agents: [] });
    } catch {
      if (!silent) setError('Could not reach the server. Check your connection and try again.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [language, source, agent]);

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), 60000);
    return () => clearInterval(interval);
  }, [load]);

  function resetFilters() {
    setLanguage('All'); setSource('All'); setAgent('All');
  }

  const funnelData = useMemo(() => {
    if (!funnel) return [];
    return [
      { name: 'Assigned', value: funnel.assigned },
      { name: 'Touched', value: funnel.touched },
      { name: 'Connected', value: funnel.connected },
      { name: 'Qualified', value: funnel.qualified },
      { name: 'VH Assigned', value: funnel.vhAssigned },
      { name: 'Counsellor Assigned', value: funnel.counsellorAssigned },
      { name: 'Meeting Joined', value: funnel.meetingJoined },
      { name: 'Trial Done', value: funnel.trialDone },
      { name: 'Closed Won', value: funnel.closedWon },
    ];
  }, [funnel]);

  const periodRows: { label: string; m: PeriodMetrics | undefined }[] = periods
    ? [
        { label: 'Today', m: periods.today },
        { label: 'Yesterday', m: periods.yesterday },
        { label: 'This Week', m: periods.thisWeek },
        { label: 'This Month', m: periods.thisMonth },
      ]
    : [];

  return (
    <div style={{ maxWidth: '96vw', margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <BrandHeader subtitle="Operations Dashboard" />
        <button onClick={() => router.back()} style={backButtonStyle}>← Back</button>
      </div>
      {today ? <p style={{ color: '#777', fontSize: 13, marginTop: 0, marginBottom: 12 }}>Daily control room for {formatDate(today)} — auto-refreshes every minute.</p> : null}

      {error ? (
        <div style={{ background: '#fdeaea', border: '1px solid #f3b8b8', borderRadius: 4, padding: 12, marginBottom: 16, color: '#b3261e' }}>
          {error}
        </div>
      ) : null}

      <div style={cardStyle}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <FilterField label="Language">
            <select value={language} onChange={(e) => setLanguage(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {filterOptions.languages.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </FilterField>
          <FilterField label="Source">
            <select value={source} onChange={(e) => setSource(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {filterOptions.sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </FilterField>
          <FilterField label="Agent">
            <select value={agent} onChange={(e) => setAgent(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {filterOptions.agents.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </FilterField>
          <button onClick={resetFilters} style={resetButtonStyle}>Reset filters</button>
        </div>
      </div>

      {loading || !periods || !funnel ? (
        <p>Loading…</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <KpiCard label="Leads Added Today" value={String(periods.today.leadsAdded)} />
            <KpiCard label="Touched Today" value={String(periods.today.uniqueTouched)} />
            <KpiCard label="Call Attempts Today" value={String(periods.today.callAttempts)} />
            <KpiCard label="Connected Today" value={String(periods.today.connected)} tone="green" />
            <KpiCard label="Qualified Today" value={String(periods.today.qualified)} tone="green" />
            <KpiCard label="Meetings Today" value={String(periods.today.meetings)} />
            <KpiCard label="Trials Today" value={String(periods.today.trials)} />
            <KpiCard label="Admissions Today" value={String(periods.today.admissions)} tone="green" />
            <KpiCard label="Overdue Right Now" value={String(overdueNow)} tone={volumeTone(overdueNow, 5, 20)} />
          </div>

          <div style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Period Comparison</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
                    <th style={thStyle}>Period</th><th style={thStyle}>Leads Added</th><th style={thStyle}>Unique Touched</th>
                    <th style={thStyle}>Call Attempts</th><th style={thStyle}>Connected</th><th style={thStyle}>Qualified</th>
                    <th style={thStyle}>Follow-ups Due</th><th style={thStyle}>Meetings</th><th style={thStyle}>Trials</th><th style={thStyle}>Admissions</th>
                  </tr>
                </thead>
                <tbody>
                  {periodRows.map(({ label, m }) => m ? (
                    <tr key={label} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={tdStyle}><strong>{label}</strong></td>
                      <td style={tdStyle}>{m.leadsAdded}</td>
                      <td style={tdStyle}>{m.uniqueTouched}</td>
                      <td style={tdStyle}>{m.callAttempts}</td>
                      <td style={tdStyle}>{m.connected}</td>
                      <td style={tdStyle}>{m.qualified}</td>
                      <td style={tdStyle}>{m.followupsDue}</td>
                      <td style={tdStyle}>{m.meetings}</td>
                      <td style={tdStyle}>{m.trials}</td>
                      <td style={tdStyle}>{m.admissions}</td>
                    </tr>
                  ) : null)}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ ...cardStyle, flex: '2 1 500px', margin: 0 }}>
              <h3 style={{ marginTop: 0, fontSize: 14 }}>Cumulative Funnel — Assigned → Closed Won</h3>
              <ResponsiveContainer width="100%" height={340}>
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
              <h3 style={{ marginTop: 0, fontSize: 14 }}>By Language</h3>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={byLanguage.map((r) => ({ name: r.key, value: r.count }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={50} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#1a56c4" />
                </BarChart>
              </ResponsiveContainer>
              <h3 style={{ fontSize: 14 }}>By Source</h3>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={bySource.map((r) => ({ name: r.key, value: r.count }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-30} textAnchor="end" height={60} />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#0a7a2f" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {sla ? (
            <div style={cardStyle}>
              <h3 style={{ marginTop: 0, fontSize: 14 }}>SLA — Average Calendar Days Between Stages</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <KpiCard label="Assignment → First Attempt" value={sla.assignmentToFirstAttempt != null ? sla.assignmentToFirstAttempt.toFixed(1) : '—'} />
                <KpiCard label="Assignment → Qualification" value={sla.assignmentToQualification != null ? sla.assignmentToQualification.toFixed(1) : '—'} />
                <KpiCard label="Qualification → VH" value={sla.qualificationToVh != null ? sla.qualificationToVh.toFixed(1) : '—'} />
                <KpiCard label="VH → Counsellor" value={sla.vhToCounsellor != null ? sla.vhToCounsellor.toFixed(1) : '—'} />
                <KpiCard label="Meeting → Trial" value={sla.meetingToTrial != null ? sla.meetingToTrial.toFixed(1) : '—'} />
                <KpiCard label="Trial → Admission" value={sla.trialToAdmission != null ? sla.trialToAdmission.toFixed(1) : '—'} />
              </div>
            </div>
          ) : null}

          <div style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Ops Watchlist — Where to Focus Today</h3>
            <p style={{ fontSize: 12, color: '#777', marginTop: -6 }}>
              Agents sorted worst-first: untouched leads + overdue follow-ups + a penalty if they haven&apos;t made a single call attempt today.
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
                    <th style={thStyle}>Agent</th><th style={thStyle}>Assigned</th><th style={thStyle}>Untouched</th>
                    <th style={thStyle}>Overdue</th><th style={thStyle}>Attempts Today</th><th style={thStyle}>Focus Score</th>
                  </tr>
                </thead>
                <tbody>
                  {watchlist.map((w) => (
                    <tr key={w.agent} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={tdStyle}>{w.agent}</td>
                      <td style={tdStyle}>{w.assigned}</td>
                      <td style={{ ...tdStyle, color: w.untouched > 0 ? '#a15c00' : undefined }}>{w.untouched}</td>
                      <td style={{ ...tdStyle, color: w.overdue > 0 ? '#b3261e' : undefined }}>{w.overdue}</td>
                      <td style={{ ...tdStyle, color: w.attemptsToday === 0 && w.assigned > 0 ? '#b3261e' : undefined }}>{w.attemptsToday}</td>
                      <td style={tdStyle}>
                        <span style={{
                          background: w.focusScore === 0 ? '#e6f6ea' : w.focusScore < 5 ? '#fff4e0' : '#fdeaea',
                          color: w.focusScore === 0 ? '#0a7a2f' : w.focusScore < 5 ? '#a15c00' : '#b3261e',
                          padding: '2px 10px', borderRadius: 12, fontWeight: 600,
                        }}>
                          {w.focusScore}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {watchlist.length === 0 ? <tr><td style={tdStyle} colSpan={6}>No data.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: '8px 10px', whiteSpace: 'nowrap' };
const tdStyle: React.CSSProperties = { padding: '8px 10px', whiteSpace: 'nowrap' };
const backButtonStyle: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 4, border: '1px solid #ccc', background: '#fff', cursor: 'pointer', fontSize: 13,
};
const resetButtonStyle: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 4, border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer', fontSize: 13, height: 34,
};
