'use client';

import { BrandHeader } from '@/app/components/BrandHeader';
import { StatusBadge, followupColor } from '@/app/admin/AdminClient';
import { formatDateTime } from '@/lib/format';
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

  const loadLeads = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/leads');
    const data = await res.json();
    setLeads(data.leads || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  async function handleLogout() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const visibleLeads = statusFilter === 'All' ? leads : leads.filter((l) => l.status === statusFilter);

  const counts = PIPELINE_TABS.reduce<Record<string, number>>((acc, s) => {
    acc[s] = s === 'All' ? leads.length : leads.filter((l) => l.status === s).length;
    return acc;
  }, {});

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <BrandHeader subtitle={`My Leads — ${agentName}`} />
        <button onClick={handleLogout} style={secondaryButtonStyle}>Log out</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {PIPELINE_TABS.map((s) => (
          <FilterButton key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}>
            {s} ({counts[s] || 0})
          </FilterButton>
        ))}
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : visibleLeads.length === 0 ? (
        <p>No leads here yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Lead Code</th><th>Name</th><th>Mobile</th><th>Language</th>
              <th>Status</th><th>Next Follow-up</th><th></th>
            </tr>
          </thead>
          <tbody>
            {visibleLeads.map((lead) => (
              <tr key={lead.id}>
                <td>{lead.leadCode}</td>
                <td>{lead.name}</td>
                <td>{lead.mobile}</td>
                <td>{lead.language}</td>
                <td><StatusBadge status={lead.qualificationStatus || lead.status} /></td>
                <td style={{ color: followupColor(lead.nextFollowupDate, lead.nextFollowupTime) }}>
                  {formatDateTime(lead.nextFollowupDate, lead.nextFollowupTime) || '—'}
                </td>
                <td><Link href={`/leads/${lead.id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 12px',
        border: '1px solid #ccc',
        borderRadius: 4,
        background: active ? '#111' : '#fff',
        color: active ? '#fff' : '#111',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: '#fff',
  color: '#111',
  border: '1px solid #ccc',
  borderRadius: 4,
  cursor: 'pointer',
};
