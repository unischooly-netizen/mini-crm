'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BrandHeader } from '@/app/components/BrandHeader';

type Role = 'admin' | 'presales_agent' | 'vertical_head' | 'sales_counsellor' | 'data_team';
type UserOption = { id: number; name: string; role: Role };

type QLead = {
  id: number;
  leadCode: string;
  name: string;
  mobile: string;
  language: string;
  ownerName: string | null;
  handoverStatus: string;
  assignedVhUserId: number | null;
  assignedVhName: string | null;
  assignedCounsellorUserId: number | null;
  assignedCounsellorName: string | null;
};

const backPathFor: Record<Role, string> = {
  admin: '/admin',
  presales_agent: '/dashboard',
  vertical_head: '/qualified-leads',
  sales_counsellor: '/qualified-leads',
  data_team: '/admin',
};

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
  const [leads, setLeads] = useState<QLead[]>([]);
  const [vertHeads, setVertHeads] = useState<UserOption[]>([]);
  const [counsellors, setCounsellors] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/qualified-leads');
    const data = await res.json();
    setLeads(data.leads || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
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
    await fetch(`/api/leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedVhUserId: vhUserId }),
    });
    load();
  }

  async function assignCounsellor(leadId: number, counsellorUserId: number | null) {
    await fetch(`/api/leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignedCounsellorUserId: counsellorUserId }),
    });
    load();
  }

  async function handleLogout() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const canAssignVh = role === 'admin';
  const canAssignCounsellor = role === 'admin' || role === 'vertical_head';

  let subtitle = 'Qualified Leads';
  if (role === 'vertical_head') subtitle = `Qualified Leads assigned to ${selfName}`;
  if (role === 'sales_counsellor') subtitle = `Qualified Leads assigned to ${selfName}`;
  if (role === 'presales_agent') subtitle = 'Leads you qualified';

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <BrandHeader subtitle={subtitle} />
        <button onClick={handleLogout} style={secondaryButtonStyle}>Log out</button>
      </div>
      {(role === 'vertical_head' || role === 'sales_counsellor') && (
        <Link href={backPathFor[role]} style={{ fontSize: 14 }}>← Back</Link>
      )}

      <div style={{ ...cardStyle, marginTop: 16 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>
          {loading ? 'Loading…' : `${leads.length} qualified lead(s)`}
        </h2>
        {leads.length === 0 && !loading && (
          <p style={{ color: '#777' }}>Nothing here yet.</p>
        )}
        {leads.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Lead Code</th><th>Name</th><th>Mobile</th><th>Language</th><th>Pre-Sales Agent</th>
                <th>Handover Status</th>
                {(role === 'admin' || role === 'data_team' || role === 'vertical_head') && <th>Vertical Head</th>}
                {(role === 'admin' || role === 'data_team' || role === 'vertical_head' || role === 'sales_counsellor') && <th>Sales Counsellor</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td>{l.leadCode}</td>
                  <td>{l.name}</td>
                  <td>{l.mobile}</td>
                  <td>{l.language}</td>
                  <td>{l.ownerName || '—'}</td>
                  <td>{l.handoverStatus}</td>
                  {(role === 'admin' || role === 'data_team' || role === 'vertical_head') && (
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
                  {(role === 'admin' || role === 'data_team' || role === 'vertical_head' || role === 'sales_counsellor') && (
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

const secondaryButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: '#fff',
  color: '#111',
  border: '1px solid #ccc',
  borderRadius: 4,
  cursor: 'pointer',
};
