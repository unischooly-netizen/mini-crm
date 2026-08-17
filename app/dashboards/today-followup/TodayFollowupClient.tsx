'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandHeader } from '@/app/components/BrandHeader';
import { StatusBadge } from '@/app/admin/AdminClient';
import { KpiCard, FilterField, selectStyle, cardStyle, CHART_COLORS } from '@/app/components/DashboardKit';
import { formatDate, formatTime12h, formatTimestampIST } from '@/lib/format';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';

type Role = 'admin' | 'presales_agent' | 'vertical_head' | 'sales_counsellor' | 'data_team';

type Row = {
  leadCode: string;
  leadName: string;
  mobile: string;
  language: string;
  source: string;
  purpose: string;
  owner: string;
  qualificationStatus: string;
  handoverStatus: string;
  finalOutcome: string | null;
  nextFollowupDate: string | null;
  nextFollowupTime: string | null;
  meetingDate: string | null;
  meetingTime: string | null;
  trialDate: string | null;
  trialTime: string | null;
  connectingStatus: string | null;
  trialStatus: string | null;
  assignedVhName: string | null;
  assignedCounsellorName: string | null;
  notes: string | null;
  counsellorUpdate: string | null;
  updatedAt: string | null;
};

type Kpis = {
  totalDueToday: number;
  overdue: number;
  upcoming: number;
  meetingsToday: number;
  trialsToday: number;
  unassignedQualifiedToday: number;
};

function volumeTone(n: number, yellowAt: number, redAt: number): 'green' | 'yellow' | 'red' {
  if (n >= redAt) return 'red';
  if (n >= yellowAt) return 'yellow';
  return 'green';
}

export default function TodayFollowupClient({ role, selfName }: { role: Role; selfName: string }) {
  const router = useRouter();

  const [owner, setOwner] = useState(role === 'presales_agent' ? selfName : 'All');
  const [language, setLanguage] = useState('All');
  const [source, setSource] = useState('All');
  const [qualificationStatus, setQualificationStatus] = useState('All');
  const [handoverStatus, setHandoverStatus] = useState('All');

  const [today, setToday] = useState('');
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [handoverBreakdown, setHandoverBreakdown] = useState<Record<string, number>>({});
  const [ownerBreakdown, setOwnerBreakdown] = useState<Record<string, number>>({});
  const [filterOptions, setFilterOptions] = useState<{
    owners: string[]; languages: string[]; sources: string[]; qualificationStatuses: string[]; handoverStatuses: string[];
  }>({ owners: [], languages: [], sources: [], qualificationStatuses: [], handoverStatuses: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ owner, language, source, qualificationStatus, handoverStatus });
      const res = await fetch(`/api/dashboards/today-followup?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Could not load today's follow-ups (server said: ${res.status}).`);
        return;
      }
      setToday(data.today || '');
      setKpis(data.kpis);
      setRows(data.rows || []);
      setHandoverBreakdown(data.handoverStatusBreakdown || {});
      setOwnerBreakdown(data.ownerBreakdown || {});
      setFilterOptions(
        data.filterOptions || { owners: [], languages: [], sources: [], qualificationStatuses: [], handoverStatuses: [] }
      );
    } catch {
      if (!silent) setError('Could not reach the server. Check your connection and try again.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [owner, language, source, qualificationStatus, handoverStatus]);

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), 25000);
    return () => clearInterval(interval);
  }, [load]);

  function resetFilters() {
    setOwner(role === 'presales_agent' ? selfName : 'All');
    setLanguage('All');
    setSource('All');
    setQualificationStatus('All');
    setHandoverStatus('All');
  }

  const pieData = useMemo(() => Object.entries(handoverBreakdown).map(([name, value]) => ({ name, value })), [handoverBreakdown]);
  const barData = useMemo(
    () => Object.entries(ownerBreakdown).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 12),
    [ownerBreakdown]
  );

  return (
    <div style={{ maxWidth: '96vw', margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <BrandHeader subtitle="Today's Follow-up" />
        <button onClick={() => router.back()} style={backButtonStyle}>← Back</button>
      </div>
      {today ? <p style={{ color: '#777', fontSize: 13, marginTop: 0, marginBottom: 12 }}>Showing follow-ups due on {formatDate(today)} — auto-refreshes every 25s.</p> : null}

      {error ? (
        <div style={{ background: '#fdeaea', border: '1px solid #f3b8b8', borderRadius: 4, padding: 12, marginBottom: 16, color: '#b3261e' }}>
          {error}
        </div>
      ) : null}

      <div style={cardStyle}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <FilterField label="Owner">
            <select value={owner} onChange={(e) => setOwner(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {filterOptions.owners.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Language">
            <select value={language} onChange={(e) => setLanguage(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {filterOptions.languages.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Source">
            <select value={source} onChange={(e) => setSource(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {filterOptions.sources.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Qualification Status">
            <select value={qualificationStatus} onChange={(e) => setQualificationStatus(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {filterOptions.qualificationStatuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Handover Status">
            <select value={handoverStatus} onChange={(e) => setHandoverStatus(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {filterOptions.handoverStatuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </FilterField>
          <button onClick={resetFilters} style={resetButtonStyle}>Reset filters</button>
        </div>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : kpis ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <KpiCard label="Total Due Today" value={String(kpis.totalDueToday)} />
            <KpiCard label="Overdue (time passed)" value={String(kpis.overdue)} tone={volumeTone(kpis.overdue, 1, 5)} />
            <KpiCard label="Upcoming (later today)" value={String(kpis.upcoming)} tone="green" />
            <KpiCard label="Meetings Needing Action" value={String(kpis.meetingsToday)} tone={volumeTone(kpis.meetingsToday, 1, 4)} />
            <KpiCard label="Trial Follow-ups" value={String(kpis.trialsToday)} tone={volumeTone(kpis.trialsToday, 1, 4)} />
            <KpiCard label="Unassigned Qualified" value={String(kpis.unassignedQualifiedToday)} tone={volumeTone(kpis.unassignedQualifiedToday, 1, 4)} />
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ ...cardStyle, flex: '1 1 380px', margin: 0 }}>
              <h3 style={{ marginTop: 0, fontSize: 14 }}>Handover Status Breakdown</h3>
              {pieData.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p style={{ color: '#777' }}>No data for the current filters.</p>
              )}
            </div>
            <div style={{ ...cardStyle, flex: '1 1 380px', margin: 0 }}>
              <h3 style={{ marginTop: 0, fontSize: 14 }}>Due Today by Owner</h3>
              {barData.length ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={barData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#1a56c4" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p style={{ color: '#777' }}>No data for the current filters.</p>
              )}
            </div>
          </div>

          <div style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Today&apos;s Follow-ups ({rows.length})</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
                    <th style={thStyle}>Lead Code</th>
                    <th style={thStyle}>Lead Name</th>
                    <th style={thStyle}>Mobile</th>
                    <th style={thStyle}>Owner</th>
                    <th style={thStyle}>Language</th>
                    <th style={thStyle}>Source</th>
                    <th style={thStyle}>Purpose</th>
                    <th style={thStyle}>Qualification Status</th>
                    <th style={thStyle}>Handover Status</th>
                    <th style={thStyle}>Follow-up Time</th>
                    <th style={thStyle}>Vertical Head</th>
                    <th style={thStyle}>Sales Counsellor</th>
                    <th style={thStyle}>Remarks</th>
                    <th style={thStyle}>Last Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.leadCode} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={tdStyle}>{r.leadCode}</td>
                      <td style={tdStyle}>{r.leadName}</td>
                      <td style={tdStyle}>{r.mobile}</td>
                      <td style={tdStyle}>{r.owner}</td>
                      <td style={tdStyle}>{r.language}</td>
                      <td style={tdStyle}>{r.source}</td>
                      <td style={tdStyle}>{r.purpose}</td>
                      <td style={tdStyle}><StatusBadge status={r.qualificationStatus} /></td>
                      <td style={tdStyle}>{r.handoverStatus}</td>
                      <td style={tdStyle}>{formatTime12h(r.nextFollowupTime)}</td>
                      <td style={tdStyle}>{r.assignedVhName || '—'}</td>
                      <td style={tdStyle}>{r.assignedCounsellorName || '—'}</td>
                      <td style={{ ...tdStyle, maxWidth: 220, whiteSpace: 'normal' }}>{r.counsellorUpdate || r.notes || ''}</td>
                      <td style={tdStyle}>{formatTimestampIST(r.updatedAt)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr><td style={tdStyle} colSpan={14}>Nothing due today for the current filters.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
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
