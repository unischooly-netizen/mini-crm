'use client';

import { BrandHeader } from '@/app/components/BrandHeader';
import { ThemeToggle } from '@/app/components/ThemeToggle';
import MrShifu from '@/app/components/MrShifu';
import { StatusBadge, followupColor } from '@/app/admin/AdminClient';
import { DashboardsMenu, usePageSlice, Pager } from '@/app/components/DashboardKit';
import { formatDateTime, formatDate } from '@/lib/format';
import { todayIstDateStr } from '@/lib/followup';
import Link from 'next/link';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

type Lead = {
  id: number;
  leadCode: string;
  name: string;
  mobile: string;
  email: string;
  source: string;
  language: string;
  assignedDate: string;
  status: string;
  qualificationStatus?: string;
  totalAttempts?: number;
  nextFollowupDate?: string | null;
  nextFollowupTime?: string | null;
  notes: string;
};

const PIPELINE_TABS = ['All', 'New', 'Not Picked', 'Follow-up Needed', 'Qualified', 'Not Qualified'];

export default function DashboardClient({ agentName }: { agentName: string }) {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [assignedDateFilter, setAssignedDateFilter] = useState('');
  const [attemptsFilter, setAttemptsFilter] = useState('All');
  const [loadError, setLoadError] = useState('');

  const loadLeads = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadError('');
    try {
      const res = await fetch('/api/leads');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data.error || `Could not load leads (server said: ${res.status}).`);
        if (!silent) setLeads([]);
        return;
      }
      setLeads(data.leads || []);
    } catch {
      if (!silent) {
        setLoadError('Could not reach the server. Check your connection and try again.');
        setLeads([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  useEffect(() => {
    const interval = setInterval(() => loadLeads(true), 25000);
    return () => clearInterval(interval);
  }, [loadLeads]);

  async function handleLogout() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const bySearch = (l: Lead) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      l.leadCode?.toLowerCase().includes(q) ||
      l.name?.toLowerCase().includes(q) ||
      l.mobile?.toLowerCase().includes(q) ||
      l.email?.toLowerCase().includes(q)
    );
  };
  const byAssignedDate = (l: Lead) =>
    !assignedDateFilter || (l.assignedDate ? l.assignedDate.slice(0, 10) === assignedDateFilter : false);
  const byAttempts = (l: Lead) => {
    if (attemptsFilter === 'All') return true;
    const n = l.totalAttempts || 0;
    if (attemptsFilter === '4+') return n >= 4;
    return n === Number(attemptsFilter);
  };
  const visibleLeads = (statusFilter === 'All' ? leads : leads.filter((l) => l.status === statusFilter))
    .filter(bySearch)
    .filter(byAssignedDate)
    .filter(byAttempts);
  const { page, setPage, totalPages, pageItems } = usePageSlice(visibleLeads, `${statusFilter}|${search}|${assignedDateFilter}|${attemptsFilter}`);

  const counts = PIPELINE_TABS.reduce<Record<string, number>>((acc, s) => {
    acc[s] = s === 'All' ? leads.length : leads.filter((l) => l.status === s).length;
    return acc;
  }, {});

  return (
    <div className="page-shell" style={{ maxWidth: '96vw', margin: '0 auto', padding: 20, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, sans-serif" }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <BrandHeader subtitle={`My Leads — ${agentName}`} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ThemeToggle />
          <MrShifu />
          <a href="/help" style={{ background: 'var(--card-bg)', color: 'var(--fg)', border: '1px solid var(--card-border)', borderRadius: 10, padding: '9px 16px', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Help</a>
          <button onClick={handleLogout} style={secondaryButtonStyle}>Log out</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <NavTab active>Leads</NavTab>
        <Link href="/qualified-leads" style={navLinkStyle}>Qualified Leads</Link>
        <Link href="/qualified-leads?view=reschedule" style={navLinkStyle}>Reschedule Pending</Link>
        <DashboardsMenu />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {PIPELINE_TABS.map((s) => (
          <FilterButton key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
            {s} ({counts[s] || 0})
          </FilterButton>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search by lead code, name, mobile, or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '9px 12px', fontSize: 14, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--fg)', borderRadius: 8, width: '100%', maxWidth: 320, boxSizing: 'border-box' }}
        />
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: 'var(--fg)' }}>
          Assigned Date
          <input
            type="date"
            value={assignedDateFilter}
            onChange={(e) => setAssignedDateFilter(e.target.value)}
            style={{ padding: '7px 10px', fontSize: 13, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--fg)', borderRadius: 8 }}
          />
        </label>
        <FilterButton active={assignedDateFilter === todayIstDateStr()} onClick={() => setAssignedDateFilter(assignedDateFilter === todayIstDateStr() ? '' : todayIstDateStr())}>
          Today
        </FilterButton>
        {assignedDateFilter && (
          <button onClick={() => setAssignedDateFilter('')} style={{ ...secondaryButtonStyle, padding: '6px 12px', fontSize: 13 }}>
            Clear date
          </button>
        )}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, color: 'var(--fg)' }}>
          Attempts
          <select
            value={attemptsFilter}
            onChange={(e) => setAttemptsFilter(e.target.value)}
            style={{ padding: '7px 10px', fontSize: 13, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--fg)', borderRadius: 8 }}
          >
            <option value="All">All</option>
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4+">4+</option>
          </select>
        </label>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : loadError ? (
        <p style={{ color: 'crimson' }}>{loadError}</p>
      ) : visibleLeads.length === 0 ? (
        <p>No leads here yet.</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Lead Code</th><th>Name</th><th>Mobile</th><th>Assigned Date</th><th>Language</th>
                <th>Attempts</th><th>Status</th><th>Next Follow-up</th><th></th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((lead) => (
                <tr key={lead.id}>
                  <td>{lead.leadCode}</td>
                  <td>{lead.name}</td>
                  <td>{lead.mobile}</td>
                  <td>{formatDate(lead.assignedDate) || '—'}</td>
                  <td>{lead.language}</td>
                  <td>{lead.totalAttempts ?? 0} / 9</td>
                  <td><StatusBadge status={lead.qualificationStatus || lead.status} /></td>
                  <td style={{ color: followupColor(lead.nextFollowupDate, lead.nextFollowupTime) }}>
                    {formatDateTime(lead.nextFollowupDate, lead.nextFollowupTime) || '—'}
                  </td>
                  <td><Link href={`/leads/${lead.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} totalPages={totalPages} totalItems={visibleLeads.length} onChange={setPage} />
    </div>
  );
}

function NavTab({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <span
      style={{
        padding: '7px 16px',
        border: active ? 'none' : '1px solid var(--input-border)',
        borderRadius: 8,
        background: active ? 'linear-gradient(135deg, var(--accent-dark), var(--accent))' : 'var(--card-bg)',
        color: active ? '#fff' : 'var(--accent-dark)',
        fontSize: 14,
        fontWeight: active ? 600 : 500,
        display: 'inline-block',
        boxShadow: active ? '0 4px 12px rgba(60, 79, 170, 0.25)' : 'none',
      }}
    >
      {children}
    </span>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px',
        border: active ? 'none' : '1px solid var(--input-border)',
        borderRadius: 8,
        background: active ? 'linear-gradient(135deg, var(--accent-dark), var(--accent))' : 'var(--card-bg)',
        color: active ? '#fff' : 'var(--accent-dark)',
        cursor: 'pointer',
        fontWeight: active ? 600 : 500,
        boxShadow: active ? '0 4px 12px rgba(60, 79, 170, 0.25)' : 'none',
      }}
    >
      {children}
    </button>
  );
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '7px 14px',
  background: 'var(--card-bg)',
  color: 'var(--accent-dark)',
  border: '1px solid var(--input-border)',
  borderRadius: 8,
  cursor: 'pointer',
  fontWeight: 500,
};

const navLinkStyle: React.CSSProperties = {
  padding: '7px 16px',
  border: '1px solid var(--input-border)',
  borderRadius: 8,
  background: 'var(--card-bg)',
  color: 'var(--accent-dark)',
  fontSize: 14,
  fontWeight: 500,
  textDecoration: 'none',
};
