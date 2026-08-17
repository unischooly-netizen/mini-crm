'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandHeader } from '@/app/components/BrandHeader';
import { KpiCard, FilterField, selectStyle, cardStyle, CHART_COLORS } from '@/app/components/DashboardKit';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';

type Kpis = {
  activeQualified: number; revoked: number; pendingVh: number; pendingCounsellor: number; pendingFirstContact: number;
  meetingsScheduled: number; meetingNotJoined: number; meetingRescheduled: number; meetingCompleted: number;
  trialScheduled: number; trialDone: number; admissionOnHold: number; admissionWon: number; admissionLost: number;
  avgDaysQualifiedToVh: number | null; avgDaysVhToCounsellor: number | null; overallWinRate: number;
};

type GroupRow = { key: string; qualified: number; admissionWon: number };

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function volumeTone(n: number, yellowAt: number, redAt: number): 'green' | 'yellow' | 'red' {
  if (n >= redAt) return 'red';
  if (n >= yellowAt) return 'yellow';
  return 'green';
}

export default function QualifiedDashboardClient() {
  const router = useRouter();

  const [language, setLanguage] = useState('All');
  const [source, setSource] = useState('All');
  const [agent, setAgent] = useState('All');
  const [vh, setVh] = useState('All');
  const [counsellor, setCounsellor] = useState('All');
  const [handoverStatus, setHandoverStatus] = useState('All');
  const [lifecycleStatus, setLifecycleStatus] = useState('All');

  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [meetingOutcome, setMeetingOutcome] = useState<Record<string, number>>({});
  const [trialOutcome, setTrialOutcome] = useState<Record<string, number>>({});
  const [admissionOutcome, setAdmissionOutcome] = useState<Record<string, number>>({});
  const [handoverFunnel, setHandoverFunnel] = useState<{ stage: string; count: number }[]>([]);
  const [byOwner, setByOwner] = useState<GroupRow[]>([]);
  const [byVh, setByVh] = useState<GroupRow[]>([]);
  const [byCounsellor, setByCounsellor] = useState<GroupRow[]>([]);
  const [filterOptions, setFilterOptions] = useState<{
    languages: string[]; sources: string[]; agents: string[]; vertheads: string[]; counsellors: string[];
    handoverStatuses: string[]; lifecycleStatuses: string[];
  }>({ languages: [], sources: [], agents: [], vertheads: [], counsellors: [], handoverStatuses: [], lifecycleStatuses: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ language, source, agent, vh, counsellor, handoverStatus, lifecycleStatus });
      const res = await fetch(`/api/dashboards/qualified-dashboard?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Could not load qualified dashboard (server said: ${res.status}).`);
        return;
      }
      setKpis(data.kpis);
      setMeetingOutcome(data.meetingOutcome || {});
      setTrialOutcome(data.trialOutcome || {});
      setAdmissionOutcome(data.admissionOutcome || {});
      setHandoverFunnel(data.handoverFunnel || []);
      setByOwner(data.byOwner || []);
      setByVh(data.byVh || []);
      setByCounsellor(data.byCounsellor || []);
      setFilterOptions(
        data.filterOptions || { languages: [], sources: [], agents: [], vertheads: [], counsellors: [], handoverStatuses: [], lifecycleStatuses: [] }
      );
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [language, source, agent, vh, counsellor, handoverStatus, lifecycleStatus]);

  useEffect(() => {
    load();
  }, [load]);

  function resetFilters() {
    setLanguage('All');
    setSource('All');
    setAgent('All');
    setVh('All');
    setCounsellor('All');
    setHandoverStatus('All');
    setLifecycleStatus('All');
  }

  const meetingPie = useMemo(() => Object.entries(meetingOutcome).map(([name, value]) => ({ name, value })), [meetingOutcome]);
  const trialPie = useMemo(() => Object.entries(trialOutcome).map(([name, value]) => ({ name, value })), [trialOutcome]);
  const admissionPie = useMemo(() => Object.entries(admissionOutcome).map(([name, value]) => ({ name, value })), [admissionOutcome]);

  return (
    <div style={{ maxWidth: '96vw', margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <BrandHeader subtitle="Qualified Dashboard" />
        <button onClick={() => router.back()} style={backButtonStyle}>← Back</button>
      </div>

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
          <FilterField label="Handover Status">
            <select value={handoverStatus} onChange={(e) => setHandoverStatus(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {filterOptions.handoverStatuses.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </FilterField>
          <FilterField label="Lifecycle Status">
            <select value={lifecycleStatus} onChange={(e) => setLifecycleStatus(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {filterOptions.lifecycleStatuses.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </FilterField>
          <button onClick={resetFilters} style={resetButtonStyle}>Reset filters</button>
        </div>
      </div>

      {loading || !kpis ? (
        <p>Loading…</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            <KpiCard label="Active Qualified" value={String(kpis.activeQualified)} tone="green" />
            <KpiCard label="Revoked" value={String(kpis.revoked)} tone={kpis.revoked > 0 ? 'yellow' : 'green'} />
            <KpiCard label="Pending Vertical Head" value={String(kpis.pendingVh)} tone={volumeTone(kpis.pendingVh, 1, 5)} />
            <KpiCard label="Pending Counsellor" value={String(kpis.pendingCounsellor)} tone={volumeTone(kpis.pendingCounsellor, 1, 5)} />
            <KpiCard label="Pending First Contact" value={String(kpis.pendingFirstContact)} tone={volumeTone(kpis.pendingFirstContact, 1, 5)} />
            <KpiCard label="Meetings Scheduled" value={String(kpis.meetingsScheduled)} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            <KpiCard label="Meeting Not Joined" value={String(kpis.meetingNotJoined)} tone={volumeTone(kpis.meetingNotJoined, 1, 5)} />
            <KpiCard label="Meeting Rescheduled" value={String(kpis.meetingRescheduled)} tone={volumeTone(kpis.meetingRescheduled, 1, 5)} />
            <KpiCard label="Meeting Completed" value={String(kpis.meetingCompleted)} tone="green" />
            <KpiCard label="Trial Scheduled" value={String(kpis.trialScheduled)} />
            <KpiCard label="Trial Done" value={String(kpis.trialDone)} tone="green" />
            <KpiCard label="Admission On Hold" value={String(kpis.admissionOnHold)} tone={volumeTone(kpis.admissionOnHold, 1, 5)} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <KpiCard label="Admission Won" value={String(kpis.admissionWon)} tone="green" />
            <KpiCard label="Admission Lost" value={String(kpis.admissionLost)} tone={kpis.admissionLost > 0 ? 'yellow' : 'green'} />
            <KpiCard label="Avg Days Qualified→VH" value={kpis.avgDaysQualifiedToVh != null ? kpis.avgDaysQualifiedToVh.toFixed(1) : '—'} />
            <KpiCard label="Avg Days VH→Counsellor" value={kpis.avgDaysVhToCounsellor != null ? kpis.avgDaysVhToCounsellor.toFixed(1) : '—'} />
            <KpiCard label="Overall Win Rate" value={pct(kpis.overallWinRate)} tone={kpis.overallWinRate >= 0.2 ? 'green' : kpis.overallWinRate >= 0.1 ? 'yellow' : 'red'} />
          </div>

          <div style={cardStyle}>
            <h3 style={{ marginTop: 0, fontSize: 14 }}>Handover Status Funnel</h3>
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
            <OutcomeCard title="Meeting Outcome" data={meetingPie} />
            <OutcomeCard title="Trial Outcome" data={trialPie} />
            <OutcomeCard title="Admission Outcome" data={admissionPie} />
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <GroupCard title="Qualified by Pre-Sales Owner" rows={byOwner} />
            <GroupCard title="By Vertical Head" rows={byVh} />
            <GroupCard title="By Sales Counsellor" rows={byCounsellor} />
          </div>
        </>
      )}
    </div>
  );
}

function OutcomeCard({ title, data }: { title: string; data: { name: string; value: number }[] }) {
  return (
    <div style={{ ...cardStyle, flex: '1 1 320px', margin: 0 }}>
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

function GroupCard({ title, rows }: { title: string; rows: GroupRow[] }) {
  const chartData = rows.map((r) => ({ name: r.key, value: r.qualified }));
  return (
    <div style={{ ...cardStyle, flex: '1 1 320px', margin: 0 }}>
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
            <th style={thStyleSm}>Name</th><th style={thStyleSm}>Qualified</th><th style={thStyleSm}>Admission Won</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={tdStyleSm}>{r.key}</td>
              <td style={tdStyleSm}>{r.qualified}</td>
              <td style={tdStyleSm}>{r.admissionWon}</td>
            </tr>
          ))}
          {rows.length === 0 ? <tr><td style={tdStyleSm} colSpan={3}>No data.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}

const thStyleSm: React.CSSProperties = { padding: '4px 6px', whiteSpace: 'nowrap' };
const tdStyleSm: React.CSSProperties = { padding: '4px 6px', whiteSpace: 'nowrap' };
const backButtonStyle: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 4, border: '1px solid #ccc', background: '#fff', cursor: 'pointer', fontSize: 13,
};
const resetButtonStyle: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 4, border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer', fontSize: 13, height: 34,
};
