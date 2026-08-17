'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BrandHeader } from '@/app/components/BrandHeader';
import { formatDateTime } from '@/lib/format';
import { StatusBadge, followupColor } from '@/app/admin/AdminClient';

type Role = 'admin' | 'presales_agent' | 'vertical_head' | 'sales_counsellor' | 'data_team';
type UserOption = { id: number; name: string; role: Role };
type View = 'qualified' | 'reschedule' | 'cancelled';

type QLead = {
  id: number;
  leadCode: string;
  name: string;
  mobile: string;
  language: string;
  ownerName: string | null;
  meetingDate: string | null;
  meetingTime: string | null;
  preferredMode: string | null;
  handoverStatus: string;
  assignedVhUserId: number | null;
  assignedVhName: string | null;
  assignedCounsellorUserId: number | null;
  assignedCounsellorName: string | null;
  connectingStatus: string | null;
  meetingStatus: string;
};

const ALL = 'All';

// "Today's meetings first, then future ascending, then past at the bottom" —
// computed against IST "today" (not the browser's local date), matching how
// every other date in the app is treated.
function todayIst(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function meetingSortBucket(dateStr: string | null, today: string): number {
  if (!dateStr) return 3; // no meeting date at all -> very bottom
  const d = dateStr.slice(0, 10);
  if (d === today) return 0;
  if (d > today) return 1; // future
  return 2; // past / overdue
}

function sortQualifiedLeads(leads: QLead[]): QLead[] {
  const today = todayIst();
  return [...leads].sort((a, b) => {
    const ba = meetingSortBucket(a.meetingDate, today);
    const bb = meetingSortBucket(b.meetingDate, today);
    if (ba !== bb) return ba - bb;
    // Within "today" and "future": soonest first. Within "past": soonest (least overdue) first too,
    // i.e. most-recently-passed at the top of the past group, oldest at the very bottom.
    const ta = `${a.meetingDate || ''} ${a.meetingTime || ''}`;
    const tb = `${b.meetingDate || ''} ${b.meetingTime || ''}`;
    if (ba === 2) return tb.localeCompare(ta); // past: most recent first
    return ta.localeCompare(tb); // today/future: soonest first
  });
}

export default function QualifiedLeadsClient({
  role,
  selfUserId,
  selfName,
}: {
  role: Role;
  selfUserId: number;
  selfName: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = ((searchParams.get('view') as View) || 'qualified') as View;

  const [leads, setLeads] = useState<QLead[]>([]);
  const [vertHeads, setVertHeads] = useState<UserOption[]>([]);
  const [counsellors, setCounsellors] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [languageFilter, setLanguageFilter] = useState(ALL);
  const [vhFilter, setVhFilter] = useState(ALL);
  const [counsellorFilter, setCounsellorFilter] = useState(ALL);
  const [handoverFilter, setHandoverFilter] = useState(ALL);
  const [meetingDateFilter, setMeetingDateFilter] = useState('');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setLoadError('');
    try {
      const res = await fetch(`/api/qualified-leads?view=${view}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data.error || `Could not load leads (server said: ${res.status}). If this just started happening after an update, the database may need /api/init run again.`);
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
  }, [view]);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-refresh in the background so newly-assigned leads (e.g. a VH just
  // handed one to you) show up without needing a manual page reload.
  useEffect(() => {
    const interval = setInterval(() => load(true), 25000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (role === 'admin' || role === 'data_team' || role === 'vertical_head') {
      fetch('/api/users').then((r) => r.json()).then((d) => {
        const users: UserOption[] = d.users || [];
        setVertHeads(users.filter((u) => u.role === 'vertical_head'));
        setCounsellors(users.filter((u) => u.role === 'sales_counsellor'));
      });
    }
  }, [role]);

  async function assignVh(leadId: number, vhUserId: number | null) {
    setActionError('');
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedVhUserId: vhUserId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || `Could not assign Vertical Head (server said: ${res.status}).`);
        return;
      }
    } catch {
      setActionError('Could not reach the server. Check your connection and try again.');
      return;
    }
    load();
  }

  async function assignCounsellor(leadId: number, counsellorUserId: number | null) {
    setActionError('');
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedCounsellorUserId: counsellorUserId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(data.error || `Could not assign Sales Counsellor (server said: ${res.status}).`);
        return;
      }
    } catch {
      setActionError('Could not reach the server. Check your connection and try again.');
      return;
    }
    load();
  }

  async function handleLogout() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const canAssignVh = role === 'admin';
  const canAssignCounsellor = role === 'admin' || role === 'vertical_head';
  const showVhColumn = role === 'admin' || role === 'data_team' || role === 'vertical_head';
  const showCounsellorColumn = role === 'admin' || role === 'data_team' || role === 'vertical_head' || role === 'sales_counsellor';

  const languages = Array.from(new Set(leads.map((l) => l.language).filter(Boolean)));
  const handoverStatuses = Array.from(new Set(leads.map((l) => l.handoverStatus).filter(Boolean)));

  const filteredLeads = leads.filter((l) => {
    const q = search.trim().toLowerCase();
    if (q) {
      const hit =
        l.leadCode?.toLowerCase().includes(q) ||
        l.name?.toLowerCase().includes(q) ||
        l.mobile?.toLowerCase().includes(q);
      if (!hit) return false;
    }
    if (languageFilter !== ALL && l.language !== languageFilter) return false;
    if (vhFilter !== ALL && String(l.assignedVhUserId) !== vhFilter) return false;
    if (counsellorFilter !== ALL && String(l.assignedCounsellorUserId) !== counsellorFilter) return false;
    if (handoverFilter !== ALL && l.handoverStatus !== handoverFilter) return false;
    if (meetingDateFilter && (!l.meetingDate || l.meetingDate.slice(0, 10) !== meetingDateFilter)) return false;
    return true;
  });

  const visibleLeads = sortQualifiedLeads(filteredLeads);

  let subtitle = 'Qualified Leads';
  if (view === 'reschedule') subtitle = 'Reschedule Pending';
  if (view === 'cancelled') subtitle = 'Cancelled Meetings';
  if (role === 'vertical_head') subtitle += ` — assigned to ${selfName}`;
  if (role === 'sales_counsellor') subtitle += ` — assigned to ${selfName}`;
  if (role === 'presales_agent') subtitle += ' — leads you qualified';

  const tabs: { key: View; label: string }[] = [
    { key: 'qualified', label: 'Qualified Leads' },
    { key: 'reschedule', label: 'Reschedule Pending' },
    { key: 'cancelled', label: 'Cancelled' },
  ];

  return (
    <div style={{ maxWidth: '96vw', margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <BrandHeader subtitle={subtitle} />
        <button onClick={handleLogout} style={secondaryButtonStyle}>Log out</button>
      </div>
      <button onClick={() => router.back()} style={backLinkStyle}>← Back</button>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, marginBottom: 4, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => router.push(t.key === 'qualified' ? '/qualified-leads' : `/qualified-leads?view=${t.key}`)}
            style={{
              padding: '6px 14px',
              border: '1px solid #ccc',
              borderRadius: 4,
              background: view === t.key ? '#111' : '#fff',
              color: view === t.key ? '#fff' : '#111',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {t.label}
          </button>
        ))}
        <Link href="/dashboards/call-log" style={dashboardLinkStyle}>Call Log</Link>
        <Link href="/dashboards/today-followup" style={dashboardLinkStyle}>Today's Follow-up</Link>
      </div>

      <div style={{ ...cardStyle, marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>
            {loading ? 'Loading…' : `${visibleLeads.length} of ${leads.length} lead(s)`}
          </h2>
          <input
            type="text"
            placeholder="Search lead code, name, mobile…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, width: 240 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
          <select value={languageFilter} onChange={(e) => setLanguageFilter(e.target.value)} style={inputStyle}>
            <option value={ALL}>All languages</option>
            {languages.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          {showVhColumn && (
            <select value={vhFilter} onChange={(e) => setVhFilter(e.target.value)} style={inputStyle}>
              <option value={ALL}>All Vertical Heads</option>
              {vertHeads.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
          {showCounsellorColumn && (
            <select value={counsellorFilter} onChange={(e) => setCounsellorFilter(e.target.value)} style={inputStyle}>
              <option value={ALL}>All Sales Counsellors</option>
              {counsellors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <select value={handoverFilter} onChange={(e) => setHandoverFilter(e.target.value)} style={inputStyle}>
            <option value={ALL}>All handover statuses</option>
            {handoverStatuses.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#555' }}>
            Meeting date:
            <input type="date" value={meetingDateFilter} onChange={(e) => setMeetingDateFilter(e.target.value)} style={inputStyle} />
          </label>
          {meetingDateFilter && (
            <button onClick={() => setMeetingDateFilter('')} style={secondaryButtonStyle}>Clear date</button>
          )}
        </div>

        {loadError && (
          <p style={{ color: 'crimson' }}>{loadError}</p>
        )}
        {actionError && (
          <p style={{ color: 'crimson' }}>{actionError}</p>
        )}
        {visibleLeads.length === 0 && !loading && !loadError && (
          <p style={{ color: '#777' }}>Nothing here yet.</p>
        )}
        {visibleLeads.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Meeting Date &amp; Time</th><th>Mode</th>
                <th>Lead Code</th><th>Name</th><th>Mobile</th><th>Language</th><th>Pre-Sales Agent</th>
                <th>Connecting Status</th><th>Handover Status</th>
                {showVhColumn && <th>Vertical Head</th>}
                {showCounsellorColumn && <th>Sales Counsellor</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleLeads.map((l) => (
                <tr key={l.id}>
                  <td style={{ color: followupColor(l.meetingDate, l.meetingTime), fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {formatDateTime(l.meetingDate, l.meetingTime) || '—'}
                  </td>
                  <td>{l.preferredMode || '—'}</td>
                  <td>{l.leadCode}</td>
                  <td>{l.name}</td>
                  <td>{l.mobile}</td>
                  <td>{l.language}</td>
                  <td>{l.ownerName || '—'}</td>
                  <td><StatusBadge status={l.connectingStatus || 'Pending'} /></td>
                  <td>{l.handoverStatus}</td>
                  {showVhColumn && (
                    <td>
                      {canAssignVh ? (
                        <select
                          value={l.assignedVhUserId ?? ''}
                          onChange={(e) => assignVh(l.id, e.target.value ? Number(e.target.value) : null)}
                        >
                          <option value="">Unassigned</option>
                          {vertHeads.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </select>
                      ) : (l.assignedVhName || '—')}
                    </td>
                  )}
                  {showCounsellorColumn && (
                    <td>
                      {canAssignCounsellor ? (
                        <select
                          value={l.assignedCounsellorUserId ?? ''}
                          onChange={(e) => assignCounsellor(l.id, e.target.value ? Number(e.target.value) : null)}
                        >
                          <option value="">Unassigned</option>
                          {counsellors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      ) : (l.assignedCounsellorName || '—')}
                    </td>
                  )}
                  <td><Link href={`/leads/${l.id}`}>View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #ddd',
  borderRadius: 6,
  padding: 16,
};

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 14,
  border: '1px solid #ccc',
  borderRadius: 4,
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: '#fff',
  color: '#111',
  border: '1px solid #ccc',
  borderRadius: 4,
  cursor: 'pointer',
};

const backLinkStyle: React.CSSProperties = {
  fontSize: 14,
  background: 'none',
  border: 'none',
  padding: 0,
  color: '#1a56c4',
  textDecoration: 'underline',
  cursor: 'pointer',
};

const dashboardLinkStyle: React.CSSProperties = {
  padding: '6px 14px',
  border: '1px solid #ccc',
  borderRadius: 4,
  background: '#fff',
  color: '#111',
  fontSize: 14,
  textDecoration: 'none',
};
