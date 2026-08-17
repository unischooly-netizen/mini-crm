'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandHeader, } from '@/app/components/BrandHeader';
import { StatusBadge } from '@/app/admin/AdminClient';
import { KpiCard, FilterField, selectStyle, cardStyle, CHART_COLORS } from '@/app/components/DashboardKit';
import { formatDate, formatTime12h } from '@/lib/format';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';

type Role = 'admin' | 'presales_agent' | 'vertical_head' | 'sales_counsellor' | 'data_team';

type Row = {
  leadCode: string;
  leadName: string;
  mobile: string;
  owner: string;
  attemptDate: string;
  attemptTime: string;
  callStatus: string;
  attemptNo: number;
  language: string;
  source: string;
};

type Kpis = {
  totalAttempts: number;
  connectedCalls: number;
  connectionRate: number;
  notConnected: number;
  avgAttemptNo: number;
  uniqueLeadsTouched: number;
  avgAttemptsPerLead: number;
  firstAttemptConnectRate: number;
  repeatAttemptsPercent: number;
  callsLoggedToday: number;
};

function todayStr(): string {
  const d = new Date();
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${String(ist.getUTCDate()).padStart(2, '0')}`;
}

function rateTone(rate: number): 'green' | 'yellow' | 'red' {
  if (rate >= 0.4) return 'green';
  if (rate >= 0.2) return 'yellow';
  return 'red';
}

function repeatTone(rate: number): 'green' | 'yellow' | 'red' {
  if (rate < 0.3) return 'green';
  if (rate < 0.5) return 'yellow';
  return 'red';
}

export default function CallLogClient({ role, selfName }: { role: Role; selfName: string }) {
  const router = useRouter();
  const today = useMemo(() => todayStr(), []);

  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [agent, setAgent] = useState(role === 'presales_agent' ? selfName : 'All');
  const [language, setLanguage] = useState('All');
  const [source, setSource] = useState('All');
  const [callStatus, setCallStatus] = useState('All');
  const [attemptNo, setAttemptNo] = useState('All');

  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [statusBreakdown, setStatusBreakdown] = useState<Record<string, number>>({});
  const [ownerBreakdown, setOwnerBreakdown] = useState<Record<string, number>>({});
  const [filterOptions, setFilterOptions] = useState<{
    agents: string[]; languages: string[]; sources: string[]; callStatuses: string[]; attemptNumbers: number[];
  }>({ agents: [], languages: [], sources: [], callStatuses: [], attemptNumbers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({
        startDate, endDate, agent, language, source, callStatus, attemptNo,
      });
      const res = await fetch(`/api/dashboards/call-log?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Could not load call log (server said: ${res.status}).`);
        return;
      }
      setKpis(data.kpis);
      setRows(data.rows || []);
      setTotalRows(data.totalRows || 0);
      setStatusBreakdown(data.callStatusBreakdown || {});
      setOwnerBreakdown(data.ownerBreakdown || {});
      setFilterOptions(data.filterOptions || { agents: [], languages: [], sources: [], callStatuses: [], attemptNumbers: [] });
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, agent, language, source, callStatus, attemptNo]);

  useEffect(() => {
    load();
  }, [load]);

  function resetFilters() {
    setStartDate(today);
    setEndDate(today);
    setAgent(role === 'presales_agent' ? selfName : 'All');
    setLanguage('All');
    setSource('All');
    setCallStatus('All');
    setAttemptNo('All');
  }

  const pieData = Object.entries(statusBreakdown).map(([name, value]) => ({ name, value }));
  const barData = Object.entries(ownerBreakdown)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  return (
    <div style={{ maxWidth: '96vw', margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <BrandHeader subtitle="Call Log" />
        <button onClick={() => router.back()} style={backButtonStyle}>← Back</button>
      </div>

      {error ? (
        <div style={{ background: '#fdeaea', border: '1px solid #f3b8b8', borderRadius: 4, padding: 12, marginBottom: 16, color: '#b3261e' }}>
          {error}
        </div>
      ) : null}

      <div style={{ ...cardStyle }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <FilterField label="Start Date">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={selectStyle} />
          </FilterField>
          <FilterField label="End Date">
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={selectStyle} />
          </FilterField>
          <FilterField label="Agent">
            <select value={agent} onChange={(e) => setAgent(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {filterOptions.agents.map((a) => (
                <option key={a} value={a}>{a}</option>
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
          <FilterField label="Call Status">
            <select value={callStatus} onChange={(e) => setCallStatus(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {filterOptions.callStatuses.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Attempt No.">
            <select value={attemptNo} onChange={(e) => setAttemptNo(e.target.value)} style={selectStyle}>
              <option value="All">All</option>
              {filterOptions.attemptNumbers.map((n) => (
                <option key={n} value={n}>{n}</option>
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            <KpiCard label="Total Attempts (filtered)" value={String(kpis.totalAttempts)} />
            <KpiCard label="Connected Calls" value={String(kpis.connectedCalls)} tone="green" />
            <KpiCard label="Connection Rate %" value={`${(kpis.connectionRate * 100).toFixed(1)}%`} tone={rateTone(kpis.connectionRate)} />
            <KpiCard label="Not Connected" value={String(kpis.notConnected)} />
            <KpiCard label="Avg Attempt No." value={kpis.avgAttemptNo.toFixed(1)} />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <KpiCard label="Unique Leads Touched" value={String(kpis.uniqueLeadsTouched)} />
            <KpiCard label="Avg Attempts / Lead" value={kpis.avgAttemptsPerLead.toFixed(1)} />
            <KpiCard label="First-Attempt Connect Rate" value={`${(kpis.firstAttemptConnectRate * 100).toFixed(1)}%`} tone={rateTone(kpis.firstAttemptConnectRate)} />
            <KpiCard label="Repeat Attempts %" value={`${(kpis.repeatAttemptsPercent * 100).toFixed(1)}%`} tone={repeatTone(kpis.repeatAttemptsPercent)} />
            <KpiCard label="Calls Logged Today" value={String(kpis.callsLoggedToday)} />
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ ...cardStyle, flex: '1 1 380px', margin: 0 }}>
              <h3 style={{ marginTop: 0, fontSize: 14 }}>Call Status Breakdown</h3>
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
              <h3 style={{ marginTop: 0, fontSize: 14 }}>Attempts by Agent</h3>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h3 style={{ marginTop: 0 }}>Call Attempts ({totalRows})</h3>
              {totalRows > rows.length ? (
                <span style={{ fontSize: 12, color: '#777' }}>Showing first {rows.length} of {totalRows}</span>
              ) : null}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
                    <th style={thStyle}>Lead Code</th>
                    <th style={thStyle}>Lead Name</th>
                    <th style={thStyle}>Mobile</th>
                    <th style={thStyle}>Owner</th>
                    <th style={thStyle}>Attempt Date</th>
                    <th style={thStyle}>Attempt Time</th>
                    <th style={thStyle}>Call Status</th>
                    <th style={thStyle}>Attempt No.</th>
                    <th style={thStyle}>Language</th>
                    <th style={thStyle}>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={tdStyle}>{r.leadCode}</td>
                      <td style={tdStyle}>{r.leadName}</td>
                      <td style={tdStyle}>{r.mobile}</td>
                      <td style={tdStyle}>{r.owner}</td>
                      <td style={tdStyle}>{formatDate(r.attemptDate)}</td>
                      <td style={tdStyle}>{formatTime12h(r.attemptTime)}</td>
                      <td style={tdStyle}><StatusBadge status={r.callStatus} /></td>
                      <td style={tdStyle}>{r.attemptNo}</td>
                      <td style={tdStyle}>{r.language}</td>
                      <td style={tdStyle}>{r.source}</td>
                    </tr>
                  ))}
                  {rows.length === 0 ? (
                    <tr><td style={tdStyle} colSpan={10}>No call attempts match the current filters.</td></tr>
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
