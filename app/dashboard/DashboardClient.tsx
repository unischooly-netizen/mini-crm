'use client';

import { BrandHeader } from '@/app/components/BrandHeader';

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
  notes: string;
};

const STATUS_OPTIONS = ['New', 'Called', 'Qualified', 'Not Qualified'];

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

  async function updateLead(id: number, changes: { status?: string; notes?: string }) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...changes } : l)));
    await fetch(`/api/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
  }

  const visibleLeads = statusFilter === 'All' ? leads : leads.filter((l) => l.status === statusFilter);

  const counts = STATUS_OPTIONS.reduce<Record<string, number>>((acc, s) => {
    acc[s] = leads.filter((l) => l.status === s).length;
    return acc;
  }, {});

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <BrandHeader subtitle={`My Leads — ${agentName}`} />
        <button onClick={handleLogout} style={secondaryButtonStyle}>Log out</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <FilterButton active={statusFilter === 'All'} onClick={() => setStatusFilter('All')}>
          All ({leads.length})
        </FilterButton>
        {STATUS_OPTIONS.map((s) => (
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
              <th>Lead Code</th><th>Name</th><th>Mobile</th><th>Email</th><th>Source</th>
              <th>Language</th><th>Status</th><th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {visibleLeads.map((lead) => (
              <LeadRow key={lead.id} lead={lead} onChange={updateLead} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function LeadRow({
  lead,
  onChange,
}: {
  lead: Lead;
  onChange: (id: number, changes: { status?: string; notes?: string }) => void;
}) {
  const [notes, setNotes] = useState(lead.notes);

  return (
    <tr>
      <td>{lead.leadCode}</td>
      <td>{lead.name}</td>
      <td>{lead.mobile}</td>
      <td>{lead.email}</td>
      <td>{lead.source}</td>
      <td>{lead.language}</td>
      <td>
        <select value={lead.status} onChange={(e) => onChange(lead.id, { status: e.target.value })}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </td>
      <td>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ flex: 1, padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4 }}
          />
          <button onClick={() => onChange(lead.id, { notes })} style={{ padding: '4px 8px', cursor: 'pointer' }}>
            Save
          </button>
        </div>
      </td>
    </tr>
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
