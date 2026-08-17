'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandHeader } from '@/app/components/BrandHeader';
import { KpiCard, FilterField, selectStyle, cardStyle, CHART_COLORS } from '@/app/components/DashboardKit';
import {
  ResponsiveContainer, FunnelChart, Funnel, LabelList, Tooltip, Cell,
  PieChart, Pie, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';

type Kpis = {
  assigned: number; touched: number; untouched: number; totalCallAttempts: number; connectedCalls: number; notConnected: number;
  callConnectionRate: number; uniqueConnected: number; leadConnectionRate: number; avgAttemptsPerTouched: number;
  qualified: number; qualifiedRate: number; qualifiedPerTouched: number; qualifiedPerConnected: number;
  followUpNeeded: number; notQualified: number; notReviewed: number;
  vhAssigned: number; counsellorAssigned: number; pendingVh: number; pendingCounsellor: number; pendingFirstContact: number;
  meetingScheduled: number; meetingDone: number; meetingNotJoined: number; meetingRescheduled: number; meetingCancelled: number; meetingJoinRate: number;
  trialScheduled: number; trialDone: number; trialNotDone: number; trialRescheduled: number; trialCompletionRate: number;
  admissionPending: number; admissionOnHold: number; admissionWon: number; admissionLost: number; admissionWinRate: number; overallWinRate: number;
  activePipeline: number; revoked: number;
};

type TodaySnapshot = {
  followupsDueToday: number; overdueNow: number; callAttemptsToday: number;
  qualifiedToday: number; meetingsToday: number; admissionsToday: number;
};

type FunnelData = {
  assigned: number; touched: number; connected: number; qualified: number; vhAssigned: number; counsellorAssigned: number;
  meetingScheduled: number; meetingDone: number; trialScheduled: number; trialDone: number; admissionWon: number; admissionLost: number;
};

type Sla = {
  assignmentToFirstAttempt: number | null; assignmentToQualification: number | null; qualificationToVh: number | null;
  vhToCounsellor: number | null; meetingToTrial: number | null; trialToAdmission: number | null;
};
type AgentLbRow = { name: string; assigned: number; qualified: number; qualifiedPerAssigned: number };
type RoleLbRow = { name: string; qualifiedAssigned: number; admissionWon: number; winRate: number; volume: number };
type HealthRow = { metric: string; value: number; severity: 'OK' | 'Warning' | 'Critical'; why: string; action: string };
type Insight = { type: 'good' | 'warning'; text: string };
type BreakdownRow = Kpis & { key: string };

const MEDAL = ['🥇', '🥈', '🥉'];

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function rateTone(rate: number): 'green' | 'yellow' | 'red' {
  if (rate >= 0.4) return 'green';
  if (rate >= 0.2) return 'yellow';
  return 'red';
}

function volumeTone(n: number, yellowAt: number, redAt: number): 'green' | 'yellow' | 'red' {
  if (n >= redAt) return 'red';
  if (n >= yellowAt) return 'yellow';
  return 'green';
}

function severityColor(s: 'OK' | 'Warning' | 'Critical'): { bg: string; fg: string } {
  if (s === 'OK') return { bg: '#e6f6ea', fg: '#0a7a2f' };
  if (s === 'Warning') return { bg: '#fff4e0', fg: '#a15c00' };
  return { bg: '#fdeaea', fg: '#b3261e' };
}

const emptyFilterOptions = { languages: [], sources: [], agents: [], vertheads: [], counsellors: [], modes: [] };

export default function CeoDashboardClient() {
  const router = useRouter();

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [language, setLanguage] = useState('All');
  const [source, setSource] = useState('All');
  const [agent, setAgent] = useState('All');
  const [vh, setVh] = useState('All');
  const [counsellor, setCounsellor] = useState('All');
  const [mode, setMode] = useState('All');

  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [today, setToday] = useState<TodaySnapshot | null>(null);
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [meetingOutcome, setMeetingOutcome] = useState<Record<string, number>>({});
  const [trialOutcome, setTrialOutcome] = useState<Record<string, number>>({});
  const [admissionOutcome, setAdmissionOutcome] = useState<Record<string, number>>({});
  const [callStatusBreakdown, setCallStatusBreakdown] = useState<Record<string, number>>({});
  const [handoverFunnel, setHandoverFunnel] = useState<{ stage: string; count: number }[]>([]);
  const [byLanguage, setByLanguage] = useState<BreakdownRow[]>([]);
  const [bySource, setBySource] = useState<BreakdownRow[]>([]);
  const [byMode, setByMode] = useState<BreakdownRow[]>([]);
  const [sla, setSla] = useState<Sla | null>(null);
  const [agentLeaderboard, setAgentLeaderboard] = useState<AgentLbRow[]>([]);
  const [vhLeaderboard, setVhLeaderboard] = useState<RoleLbRow[]>([]);
  const [counsellorLeaderboard, setCounsellorLeaderboard] = useState<RoleLbRow[]>([]);
  const [health, setHealth] = useState<HealthRow[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [filterOptions, setFilterOptions] = useState<{
    languages: string[]; sources: string[]; agents: string[]; vertheads: string[]; counsellors: string[]; modes: string[];
  }>(emptyFilterOptions);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ startDate, endDate, language, source, agent, vh, counsellor, mode });
      const res = await fetch(`/api/dashboards/ceo?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Could not load CEO dashboard (server said: ${res.status}).`);
        return;
      }
      setKpis(data.kpis);
      setToday(data.today);
      setFunnel(data.funnel);
      setMeetingOutcome(data.meetingOutcome || {});
      setTrialOutcome(data.trialOutcome || {});
      setAdmissionOutcome(data.admissionOutcome || {});
      setCallStatusBreakdown(data.callStatusBreakdown || {});
      setHandoverFunnel(data.handoverFunnel || []);
      setByLanguage(data.byLanguage || []);
      setBySource(data.bySource || []);
      setByMode(data.byMode || []);
      setSla(data.sla);
      setAgentLeaderboard(data.agentLeaderboard || []);
      setVhLeaderboard(data.vhLeaderboard || []);
      setCounsellorLeaderboard(data.counsellorLeaderboard || []);
      setHealth(data.health || []);
      setInsights(data.insights || []);
      setFilterOptions(data.filterOptions || emptyFilterOptions);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, language, source, agent, vh, counsellor, mode]);

  useEffect(() => {
    load();
  }, [load]);

  function resetFilters() {
    setStartDate(''); setEndDate(''); setLanguage('All'); setSource('All');
    setAgent('All'); setVh('All'); setCounsellor('All'); setMode('All');
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
      { name: 'Meeting Scheduled', value: funnel.meetingScheduled },
      { name: 'Meeting Done', value: funnel.meetingDone },
      { name: 'Trial Scheduled', value: funnel.trialScheduled },
      { name: 'Trial Done', value: funnel.trialDone },
      { name: 'Admission Won', value: funnel.admissionWon },
    ];
  }, [funnel]);

  const meetingPie = useMemo(() => Object.entries(meetingOutcome).map(([name, value]) => ({ name, value })), [meetingOutcome]);
  const trialPie = useMemo(() => Object.entries(trialOutcome).map(([name, value]) => ({ name, value })), [trialOutcome]);
  const admissionPie = useMemo(() => Object.entries(admissionOutcome).map(([name, value]) => ({ name, value })), [admissionOutcome]);
  const callStatusPie = useMemo(() => Object.entries(callStatusBreakdown).map(([name, value]) => ({ name, value })), [callStatusBreakdown]);

  return (
    <div style={{ maxWidth: '96vw', margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <BrandHeader subtitle="CEO Dashboard" />
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
          <FilterField label="Vertical Head">
            <select value={vh} onChange={(e) => setVh(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {filterOptions.vertheads.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </FilterField>
          <FilterField label="Sales Counsellor">
            <select value={counsellor} onChange={(e) => setCounsellor(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {filterOptions.counsellors.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </FilterField>
          <FilterField label="Mode">
            <select value={mode} onChange={(e) => setMode(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {filterOptions.modes.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </FilterField>
          <button onClick={resetFilters} style={resetButtonStyle}>Reset filters</button>
        </div>
      </div>

      {loading || !kpis || !funnel || !today ? (
        <p>Loading…</p>
      ) : (
        <>
          <KpiGroup title="Call Activity">
            <KpiCard label="Assigned" value={String(kpis.assigned)} />
            <KpiCard label="Touched" value={String(kpis.touched)} />
            <KpiCard label="Untouched" value={String(kpis.untouched)} tone={volumeTone(kpis.untouched, 1, 10)} />
            <KpiCard label="Total Call Attempts" value={String(kpis.totalCallAttempts)} />
            <KpiCard label="Connected Calls" value={String(kpis.connectedCalls)} tone="green" />
            <KpiCard label="Not Connected" value={String(kpis.notConnected)} />
            <KpiCard label="Call Connection Rate" value={pct(kpis.callConnectionRate)} tone={rateTone(kpis.callConnectionRate)} />
            <KpiCard label="Unique Connected Leads" value={String(kpis.uniqueConnected)} tone="green" />
            <KpiCard label="Lead Connection Rate" value={pct(kpis.leadConnectionRate)} tone={rateTone(kpis.leadConnectionRate)} />
            <KpiCard label="Avg Attempts / Touched" value={kpis.avgAttemptsPerTouched.toFixed(1)} />
          </KpiGroup>

          <KpiGroup title="Qualification">
            <KpiCard label="Qualified" value={String(kpis.qualified)} tone="green" />
            <KpiCard label="Qualified Rate (of Assigned)" value={pct(kpis.qualifiedRate)} tone={kpis.qualifiedRate >= 0.15 ? 'green' : 'yellow'} />
            <KpiCard label="Qualified / Touched" value={pct(kpis.qualifiedPerTouched)} />
            <KpiCard label="Qualified / Connected" value={pct(kpis.qualifiedPerConnected)} />
            <KpiCard label="Follow-up Needed" value={String(kpis.followUpNeeded)} tone="yellow" />
            <KpiCard label="Not Qualified" value={String(kpis.notQualified)} />
            <KpiCard label="Not Reviewed" value={String(kpis.notReviewed)} tone={volumeTone(kpis.notReviewed, 1, 10)} />
          </KpiGroup>

          <KpiGroup title="Handover">
            <KpiCard label="VH Assigned" value={String(kpis.vhAssigned)} tone="green" />
            <KpiCard label="Counsellor Assigned" value={String(kpis.counsellorAssigned)} tone="green" />
            <KpiCard label="Pending VH" value={String(kpis.pendingVh)} tone={volumeTone(kpis.pendingVh, 1, 5)} />
            <KpiCard label="Pending Counsellor" value={String(kpis.pendingCounsellor)} tone={volumeTone(kpis.pendingCounsellor, 1, 5)} />
            <KpiCard label="Pending First Contact" value={String(kpis.pendingFirstContact)} tone={volumeTone(kpis.pendingFirstContact, 1, 5)} />
          </KpiGroup>

          <KpiGroup title="Meeting Funnel">
            <KpiCard label="Meeting Scheduled" value={String(kpis.meetingScheduled)} />
            <KpiCard label="Meeting Done (Joined)" value={String(kpis.meetingDone)} tone="green" />
            <KpiCard label="Meeting Not Joined" value={String(kpis.meetingNotJoined)} tone={volumeTone(kpis.meetingNotJoined, 1, 5)} />
            <KpiCard label="Meeting Rescheduled" value={String(kpis.meetingRescheduled)} tone={volumeTone(kpis.meetingRescheduled, 1, 5)} />
            <KpiCard label="Meeting Cancelled" value={String(kpis.meetingCancelled)} tone={volumeTone(kpis.meetingCancelled, 1, 5)} />
            <KpiCard label="Meeting Join Rate" value={pct(kpis.meetingJoinRate)} tone={kpis.meetingJoinRate >= 0.6 ? 'green' : 'yellow'} />
          </KpiGroup>

          <KpiGroup title="Trial Funnel">
            <KpiCard label="Trial Scheduled" value={String(kpis.trialScheduled)} />
            <KpiCard label="Trial Done" value={String(kpis.trialDone)} tone="green" />
            <KpiCard label="Trial Not Done" value={String(kpis.trialNotDone)} tone={volumeTone(kpis.trialNotDone, 1, 5)} />
            <KpiCard label="Trial Rescheduled" value={String(kpis.trialRescheduled)} tone={volumeTone(kpis.trialRescheduled, 1, 5)} />
            <KpiCard label="Trial Completion Rate" value={pct(kpis.trialCompletionRate)} tone={kpis.trialCompletionRate >= 0.5 ? 'green' : 'yellow'} />
          </KpiGroup>

          <KpiGroup title="Admission Funnel">
            <KpiCard label="Admission Pending" value={String(kpis.admissionPending)} />
            <KpiCard label="Admission On Hold" value={String(kpis.admissionOnHold)} tone={volumeTone(kpis.admissionOnHold, 1, 5)} />
            <KpiCard label="Admission Won" value={String(kpis.admissionWon)} tone="green" />
            <KpiCard label="Admission Lost" value={String(kpis.admissionLost)} tone={kpis.admissionLost > 0 ? 'yellow' : 'green'} />
            <KpiCard label="Admission Win Rate" value={pct(kpis.admissionWinRate)} tone={rateTone(kpis.admissionWinRate)} />
            <KpiCard label="Overall Win Rate (of Qualified)" value={pct(kpis.overallWinRate)} tone={kpis.overallWinRate >= 0.2 ? 'green' : kpis.overallWinRate >= 0.1 ? 'yellow' : 'red'} />
            <KpiCard label="Active Pipeline" value={String(kpis.activePipeline)} />
            <KpiCard label="Revoked" value={String(kpis.revoked)} tone={kpis.revoked > 0 ? 'yellow' : 'green'} />
          </KpiGroup>

          <KpiGroup title="Today">
            <KpiCard label="Follow-ups Due Today" value={String(today.followupsDueToday)} />
            <KpiCard label="Overdue Right Now" value={String(today.overdueNow)} tone={volumeTone(today.overdueNow, 1, 10)} />
            <KpiCard label="Call Attempts Today" value={String(today.callAttemptsToday)} />
            <KpiCard label="Qualified Today" value={String(today.qualifiedToday)} tone="green" />
            <KpiCard label="Meetings Today" value={String(today.meetingsToday)} />
            <KpiCard label="Admissions Today" value={String(today.admissionsToday)} tone="green" />
          </KpiGroup>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ ...cardStyle, flex: '2 1 560px', margin: 0 }}>
              <h3 style={{ marginTop: 0, fontSize: 14 }}>End-to-End Funnel — Assigned → Admission</h3>
              <ResponsiveContainer width="100%" height={380}>
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
              <h3 style={{ marginTop: 0, fontSize: 14 }}>What&apos;s Working / Needs Attention</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
                {insights.length === 0 ? <p style={{ color: '#777' }}>Not enough data yet for this filter combination.</p> : null}
                {insights.map((ins, i) => (
                  <div
                    key={i}
                    style={{
                      background: ins.type === 'good' ? '#e6f6ea' : '#fff4e0',
                      color: ins.type === 'good' ? '#0a7a2f' : '#a15c00',
                      borderRadius: 6, padding: '8px 10px', fontSize: 13,
                    }}
                  >
                    {ins.type === 'good' ? '✅ ' : '⚠️ '}{ins.text}
                  </div>
                ))}
              </div>
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
              <p style={{ fontSize: 11, color: '#999', marginTop: 8, marginBottom: 0 }}>
                Qualification/VH/Counsellor timestamps only exist for leads that transitioned after this feature was added — older leads show &quot;—&quot;.
                Meeting→Trial and Trial→Admission use scheduled dates, not exact action timestamps.
              </p>
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <OutcomeCard title="Meeting Outcome" data={meetingPie} />
            <OutcomeCard title="Trial Outcome" data={trialPie} />
            <OutcomeCard title="Admission Outcome" data={admissionPie} />
            <OutcomeCard title="Call Status Breakdown" data={callStatusPie} />
          </div>

          <div style={cardStyle}>
            <h3 style={{ marginTop: 0, fontSize: 14 }}>Handover Status Funnel (Qualified Leads)</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={handoverFunnel} layout="vertical" margin={{ left: 40 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="stage" width={160} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#1a56c4" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ ...cardStyle, flex: '1 1 340px', margin: 0 }}>
              <h3 style={{ marginTop: 0, marginBottom: 2, fontSize: 14 }}>Pre-Sales Agent Leaderboard</h3>
              <p style={{ fontSize: 11, color: '#777', marginTop: 0 }}>Ranked by Qualified / Assigned %</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                    <th style={thStyleSm}>#</th><th style={thStyleSm}>Agent</th><th style={thStyleSm}>Assigned</th><th style={thStyleSm}>Qualified</th><th style={thStyleSm}>Qual %</th>
                  </tr>
                </thead>
                <tbody>
                  {agentLeaderboard.map((r, i) => (
                    <tr key={r.name} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={tdStyleSm}>{i < 3 ? MEDAL[i] : i + 1}</td>
                      <td style={tdStyleSm}>{r.name}</td>
                      <td style={tdStyleSm}>{r.assigned}</td>
                      <td style={tdStyleSm}>{r.qualified}</td>
                      <td style={tdStyleSm}>{pct(r.qualifiedPerAssigned)}</td>
                    </tr>
                  ))}
                  {agentLeaderboard.length === 0 ? <tr><td style={tdStyleSm} colSpan={5}>No data.</td></tr> : null}
                </tbody>
              </table>
            </div>

            <div style={{ ...cardStyle, flex: '1 1 340px', margin: 0 }}>
              <h3 style={{ marginTop: 0, marginBottom: 2, fontSize: 14 }}>Vertical Head Leaderboard</h3>
              <p style={{ fontSize: 11, color: '#777', marginTop: 0 }}>Ranked by Win Rate (Admission Won / Qualified assigned)</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                    <th style={thStyleSm}>#</th><th style={thStyleSm}>Vertical Head</th><th style={thStyleSm}>Qualified</th><th style={thStyleSm}>Won</th><th style={thStyleSm}>Win %</th>
                  </tr>
                </thead>
                <tbody>
                  {vhLeaderboard.map((r, i) => (
                    <tr key={r.name} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={tdStyleSm}>{i < 3 ? MEDAL[i] : i + 1}</td>
                      <td style={tdStyleSm}>{r.name}</td>
                      <td style={tdStyleSm}>{r.qualifiedAssigned}</td>
                      <td style={tdStyleSm}>{r.admissionWon}</td>
                      <td style={tdStyleSm}>{pct(r.winRate)}</td>
                    </tr>
                  ))}
                  {vhLeaderboard.length === 0 ? <tr><td style={tdStyleSm} colSpan={5}>No data.</td></tr> : null}
                </tbody>
              </table>
            </div>

            <div style={{ ...cardStyle, flex: '1 1 340px', margin: 0 }}>
              <h3 style={{ marginTop: 0, marginBottom: 2, fontSize: 14 }}>Sales Counsellor Leaderboard</h3>
              <p style={{ fontSize: 11, color: '#777', marginTop: 0 }}>Ranked by Win Rate (Admission Won / Qualified assigned)</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                    <th style={thStyleSm}>#</th><th style={thStyleSm}>Counsellor</th><th style={thStyleSm}>Qualified</th><th style={thStyleSm}>Won</th><th style={thStyleSm}>Win %</th>
                  </tr>
                </thead>
                <tbody>
                  {counsellorLeaderboard.map((r, i) => (
                    <tr key={r.name} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={tdStyleSm}>{i < 3 ? MEDAL[i] : i + 1}</td>
                      <td style={tdStyleSm}>{r.name}</td>
                      <td style={tdStyleSm}>{r.qualifiedAssigned}</td>
                      <td style={tdStyleSm}>{r.admissionWon}</td>
                      <td style={tdStyleSm}>{pct(r.winRate)}</td>
                    </tr>
                  ))}
                  {counsellorLeaderboard.length === 0 ? <tr><td style={tdStyleSm} colSpan={5}>No data.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <BreakdownCard title="By Language" rows={byLanguage} />
            <BreakdownCard title="By Source" rows={bySource} />
            <BreakdownCard title="By Mode" rows={byMode} />
          </div>

          <div style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Data Quality &amp; Health Checklist</h3>
            <p style={{ fontSize: 11, color: '#999', marginTop: -6 }}>Whole database, not affected by the filters above — this is a system-wide integrity check.</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
                    <th style={thStyle}>Metric</th><th style={thStyle}>Value</th><th style={thStyle}>Severity</th><th style={thStyle}>Why It Matters</th><th style={thStyle}>Recommended Action</th>
                  </tr>
                </thead>
                <tbody>
                  {health.map((h) => {
                    const c = severityColor(h.severity);
                    return (
                      <tr key={h.metric} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={tdStyle}>{h.metric}</td>
                        <td style={tdStyle}>{h.value}</td>
                        <td style={tdStyle}><span style={{ background: c.bg, color: c.fg, padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>{h.severity}</span></td>
                        <td style={{ ...tdStyle, whiteSpace: 'normal' }}>{h.why}</td>
                        <td style={{ ...tdStyle, whiteSpace: 'normal' }}>{h.action}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={cardStyle}>
      <h3 style={{ marginTop: 0, marginBottom: 10, fontSize: 14 }}>{title}</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

function OutcomeCard({ title, data }: { title: string; data: { name: string; value: number }[] }) {
  return (
    <div style={{ ...cardStyle, flex: '1 1 280px', margin: 0 }}>
      <h3 style={{ marginTop: 0, fontSize: 14 }}>{title}</h3>
      {data.some((d) => d.value > 0) ? (
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
              {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <p style={{ color: '#777' }}>No data for the current filters.</p>
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
            <th style={thStyleSm}>Name</th><th style={thStyleSm}>Assigned</th><th style={thStyleSm}>Touched</th>
            <th style={thStyleSm}>Qualified</th><th style={thStyleSm}>Qual %</th><th style={thStyleSm}>Adm. Won</th><th style={thStyleSm}>Win %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={tdStyleSm}>{r.key}</td>
              <td style={tdStyleSm}>{r.assigned}</td>
              <td style={tdStyleSm}>{r.touched}</td>
              <td style={tdStyleSm}>{r.qualified}</td>
              <td style={tdStyleSm}>{pct(r.qualifiedRate)}</td>
              <td style={tdStyleSm}>{r.admissionWon}</td>
              <td style={tdStyleSm}>{pct(r.overallWinRate)}</td>
            </tr>
          ))}
          {rows.length === 0 ? <tr><td style={tdStyleSm} colSpan={7}>No data.</td></tr> : null}
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
