'use client';

import { BrandHeader } from '@/app/components/BrandHeader';
import { formatDate, formatDateTime } from '@/lib/format';
import Link from 'next/link';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

type Role = 'admin' | 'presales_agent' | 'vertical_head' | 'sales_counsellor' | 'data_team';

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  presales_agent: 'Pre-Sales Agent',
  vertical_head: 'Vertical Head',
  sales_counsellor: 'Sales Counsellor',
  data_team: 'Data Team',
};

type User = { id: number; name: string; role: Role; created_at: string };

type Rule = {
  id: number;
  language: string;
  agentUserId: number;
  agentName: string;
  percentage: number;
  active: boolean;
  updatedAt: string;
};

type Lead = {
  id: number;
  leadCode: string;
  name: string;
  mobile: string;
  email: string;
  source: string;
  language: string;
  assignedDate: string;
  ownerUserId: number | null;
  ownerName: string | null;
  status: string;
  notes: string;
  qualificationStatus?: string;
  nextFollowupDate?: string | null;
  nextFollowupTime?: string | null;
  handoverStatus?: string;
  createdAt: string;
};

type AuditEntry = {
  id: number;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
};

type Tab = 'leads' | 'upload' | 'rules' | 'users' | 'audit';

export default function AdminClient({ adminName, role }: { adminName: string; role: Role }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('leads');
  const [leadsAgentFilter, setLeadsAgentFilter] = useState<string>('All');
  const [users, setUsers] = useState<User[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    const res = await fetch('/api/users');
    const data = await res.json();
    setUsers(data.users || []);
  }, []);

  const loadRules = useCallback(async () => {
    const res = await fetch('/api/allocation-rules');
    const data = await res.json();
    setRules(data.rules || []);
  }, []);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/leads');
    const data = await res.json();
    setLeads(data.leads || []);
    setLoading(false);
  }, []);

  const loadAudit = useCallback(async () => {
    const res = await fetch('/api/audit-log');
    const data = await res.json();
    setAudit(data.entries || []);
  }, []);

  useEffect(() => {
    loadUsers();
    loadRules();
    loadLeads();
    loadAudit();
  }, [loadUsers, loadRules, loadLeads, loadAudit]);

  async function handleLogout() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const agents = users.filter((u) => u.role === 'presales_agent');

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <BrandHeader subtitle={`Admin (${adminName})`} />
        <button onClick={handleLogout} style={secondaryButtonStyle}>Log out</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <TabButton active={tab === 'leads' && leadsAgentFilter === 'All'} onClick={() => { setTab('leads'); setLeadsAgentFilter('All'); }}>All Leads</TabButton>
        <TabButton active={tab === 'upload'} onClick={() => setTab('upload')}>Upload Leads</TabButton>
        <TabButton active={tab === 'rules'} onClick={() => setTab('rules')}>Allocation Rules</TabButton>
        <TabButton active={tab === 'users'} onClick={() => setTab('users')}>Users</TabButton>
        {role === 'admin' && (
          <TabButton active={tab === 'audit'} onClick={() => setTab('audit')}>Audit Log</TabButton>
        )}
        <TabButton active={false} onClick={() => router.push('/qualified-leads')}>Qualified Leads</TabButton>
        {agents.map((a) => (
          <TabButton
            key={a.id}
            active={tab === 'leads' && leadsAgentFilter === String(a.id)}
            onClick={() => { setTab('leads'); setLeadsAgentFilter(String(a.id)); }}
          >
            {a.name}
          </TabButton>
        ))}
      </div>

      {tab === 'users' && <UsersTab users={users} onChanged={loadUsers} />}
      {tab === 'rules' && <RulesTab rules={rules} agents={agents} onChanged={() => { loadRules(); loadLeads(); }} />}
      {tab === 'upload' && <UploadTab onUploaded={() => { loadLeads(); loadAudit(); }} />}
      {tab === 'leads' && (
        <LeadsTab
          leads={leads}
          agents={agents}
          loading={loading}
          onChanged={loadLeads}
          agentFilter={leadsAgentFilter}
          setAgentFilter={setLeadsAgentFilter}
        />
      )}
      {tab === 'audit' && <AuditTab entries={audit} onRefresh={loadAudit} />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 14px',
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

function UsersTab({ users, onChanged }: { users: User[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<Role>('presales_agent');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSaving(true);
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pin, role }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || 'Could not add user.');
      return;
    }
    setName('');
    setPin('');
    setRole('presales_agent');
    onChanged();
  }

  return (
    <div>
      <div style={cardStyle}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Add a user</h2>
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </label>
          <label>
            PIN
            <input value={pin} onChange={(e) => setPin(e.target.value)} style={inputStyle} />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} style={inputStyle}>
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={saving} style={primaryButtonStyle}>
            {saving ? 'Adding…' : 'Add user'}
          </button>
        </form>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
      </div>

      <div style={cardStyle}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Existing users ({users.length})</h2>
        <table>
          <thead>
            <tr><th>Name</th><th>Role</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{ROLE_LABELS[u.role]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RulesTab({
  rules,
  agents,
  onChanged,
}: {
  rules: Rule[];
  agents: User[];
  onChanged: () => void;
}) {
  const [language, setLanguage] = useState('');
  const [agentUserId, setAgentUserId] = useState<number | ''>('');
  const [percentage, setPercentage] = useState('');
  const [active, setActive] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [runResult, setRunResult] = useState<string>('');

  const languages = Array.from(new Set(rules.map((r) => r.language)));

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!language || !agentUserId || percentage === '') {
      setError('Language, agent, and percentage are all required.');
      return;
    }
    setSaving(true);
    const res = await fetch('/api/allocation-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language, agentUserId: Number(agentUserId), percentage: Number(percentage), active }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(data.error || 'Could not save rule.');
      return;
    }
    setLanguage('');
    setAgentUserId('');
    setPercentage('');
    setActive(true);
    onChanged();
  }

  async function handleRunNow() {
    setRunResult('Running…');
    const res = await fetch('/api/allocation-rules/run', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      setRunResult(data.error || 'Failed to run allocation.');
      return;
    }
    setRunResult(
      `Assigned ${data.assignments.length} lead(s).` +
        (data.skippedLanguages.length
          ? ` Still unassigned: ${data.skippedLanguages.map((s: { language: string; reason: string }) => `${s.language} (${s.reason})`).join('; ')}`
          : '')
    );
    onChanged();
  }

  const totalsByLanguage = languages.map((lang) => {
    const activeTotal = rules
      .filter((r) => r.language === lang && r.active)
      .reduce((sum, r) => sum + Number(r.percentage), 0);
    return { lang, activeTotal };
  });

  return (
    <div>
      <div style={cardStyle}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Add / update an allocation rule</h2>
        <p style={{ fontSize: 13, color: '#555' }}>
          Adding a rule for a Language + Agent that already exists will update it (percentage/active) instead of duplicating it.
        </p>
        <form onSubmit={handleSave} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>
            Language
            <input value={language} onChange={(e) => setLanguage(e.target.value)} style={inputStyle} placeholder="e.g. French" />
          </label>
          <label>
            Agent
            <select value={agentUserId} onChange={(e) => setAgentUserId(e.target.value ? Number(e.target.value) : '')} style={inputStyle}>
              <option value="">Choose agent…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <label>
            Percentage
            <input
              type="number"
              value={percentage}
              onChange={(e) => setPercentage(e.target.value)}
              style={inputStyle}
              min={0}
              max={100}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active
          </label>
          <button type="submit" disabled={saving} style={primaryButtonStyle}>
            {saving ? 'Saving…' : 'Save rule'}
          </button>
        </form>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        {agents.length === 0 && (
          <p style={{ color: '#a60' }}>No Pre-Sales Agents added yet — add one under the Users tab first.</p>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Current rules</h2>
          <button onClick={handleRunNow} style={secondaryButtonStyle}>Run allocation now</button>
        </div>
        {runResult && <p style={{ fontSize: 13 }}>{runResult}</p>}
        <table>
          <thead>
            <tr><th>Language</th><th>Agent</th><th>Percentage</th><th>Active</th></tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td>{r.language}</td>
                <td>{r.agentName}</td>
                <td>{r.percentage}%</td>
                <td>{r.active ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 12, fontSize: 13 }}>
          {totalsByLanguage.map(({ lang, activeTotal }) => (
            <div key={lang} style={{ color: Math.abs(activeTotal - 100) > 0.01 ? 'crimson' : '#080' }}>
              {lang}: active percentages total {activeTotal}
              {Math.abs(activeTotal - 100) > 0.01 ? ' — must equal 100 for new leads to be assigned' : ' ✓'}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UploadTab({ onUploaded }: { onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{
    rowsInFile: number;
    inserted: number;
    skippedDuplicates: string[];
    skippedBlank: number;
    allocated: number;
    unassignedLanguages: { language: string; reason: string }[];
  } | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Choose a file first.');
      return;
    }
    setError('');
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/leads/upload', { method: 'POST', body: formData });
    const data = await res.json();
    setUploading(false);
    if (!res.ok) {
      setError(data.error || 'Upload failed.');
      return;
    }
    setResult(data);
    onUploaded();
  }

  return (
    <div style={cardStyle}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Upload leads (.xlsx or .csv)</h2>
      <p style={{ fontSize: 14, color: '#555' }}>
        Columns needed: Name, Mobile, Email, Source, Language. Duplicate mobile numbers (already in the
        system) are skipped automatically. Leads are allocated to agents right after upload, based on the
        current Allocation Rules.
      </p>
      <form onSubmit={handleUpload}>
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          style={{ marginBottom: 12 }}
        />
        <br />
        <button type="submit" disabled={uploading} style={primaryButtonStyle}>
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </form>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {result && (
        <div style={{ marginTop: 16, background: '#f0f8f0', padding: 12, borderRadius: 4 }}>
          <p>Rows in file: {result.rowsInFile}</p>
          <p>Leads added: {result.inserted}</p>
          <p>Skipped duplicates: {result.skippedDuplicates.length}{result.skippedDuplicates.length > 0 ? ` (${result.skippedDuplicates.join(', ')})` : ''}</p>
          <p>Allocated to an agent just now: {result.allocated}</p>
          {result.unassignedLanguages.length > 0 && (
            <p style={{ color: '#a60' }}>
              Still unassigned — fix Allocation Rules and click &quot;Run allocation now&quot; on that tab:{' '}
              {result.unassignedLanguages.map((s) => `${s.language} (${s.reason})`).join('; ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function LeadsTab({
  leads,
  agents,
  loading,
  onChanged,
  agentFilter,
  setAgentFilter,
}: {
  leads: Lead[];
  agents: User[];
  loading: boolean;
  onChanged: () => void;
  agentFilter: string;
  setAgentFilter: (v: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<string>('All');

  async function reassign(leadId: number, userId: number | null) {
    await fetch(`/api/leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerUserId: userId }),
    });
    onChanged();
  }

  const visibleLeads = leads.filter((lead) => {
    if (agentFilter === 'Unassigned' && lead.ownerUserId !== null) return false;
    if (agentFilter !== 'All' && agentFilter !== 'Unassigned' && String(lead.ownerUserId) !== agentFilter) return false;
    if (statusFilter !== 'All' && lead.status !== statusFilter) return false;
    return true;
  });

  const agentName = agentFilter !== 'All' && agentFilter !== 'Unassigned'
    ? agents.find((a) => String(a.id) === agentFilter)?.name
    : null;

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>
          {agentName ? `${agentName}'s leads` : 'All leads'} {loading ? '(loading…)' : `(${visibleLeads.length} of ${leads.length})`}
        </h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} style={inputStyle}>
            <option value="All">All agents</option>
            <option value="Unassigned">Unassigned</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle}>
            <option value="All">All statuses</option>
            <option value="New">New</option>
            <option value="Not Picked">Not Picked</option>
            <option value="Follow-up Needed">Follow-up Needed</option>
            <option value="Qualified">Qualified</option>
            <option value="Not Qualified">Not Qualified</option>
          </select>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Lead Code</th><th>Name</th><th>Mobile</th><th>Source</th>
            <th>Language</th><th>Assigned Date</th><th>Owner</th><th>Status</th>
            <th>Next Follow-up</th><th></th>
          </tr>
        </thead>
        <tbody>
          {visibleLeads.map((lead) => (
            <tr key={lead.id}>
              <td>{lead.leadCode}</td>
              <td>{lead.name}</td>
              <td>{lead.mobile}</td>
              <td>{lead.source}</td>
              <td>{lead.language}</td>
              <td>{formatDate(lead.assignedDate)}</td>
              <td>
                <select
                  value={lead.ownerUserId ?? ''}
                  onChange={(e) => reassign(lead.id, e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Unassigned</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </td>
              <td><StatusBadge status={lead.qualificationStatus || lead.status} /></td>
              <td style={{ color: followupColor(lead.nextFollowupDate, lead.nextFollowupTime) }}>
                {formatDateTime(lead.nextFollowupDate, lead.nextFollowupTime) || '—'}
              </td>
              <td><Link href={`/leads/${lead.id}`}>View</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    'Qualified': { bg: '#e6f6ea', fg: '#0a7a2f' },
    'Not Qualified': { bg: '#fdeaea', fg: '#b3261e' },
    'Follow-up Needed': { bg: '#fff4e0', fg: '#a15c00' },
    'Not Picked': { bg: '#eef1f4', fg: '#555' },
    'New': { bg: '#eaf1fd', fg: '#1a56c4' },
    'Not Reviewed': { bg: '#eef1f4', fg: '#555' },
  };
  const c = colors[status] || { bg: '#eee', fg: '#333' };
  return (
    <span style={{ background: c.bg, color: c.fg, padding: '2px 8px', borderRadius: 12, fontSize: 12, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  );
}

/** Red if overdue, orange if due today, green if upcoming, grey if not set. */
export function followupColor(date: string | null | undefined, time: string | null | undefined): string {
  if (!date) return '#999';
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const target = new Date(`${date.slice(0, 10)}T${time || '00:00'}:00`);
  if (date.slice(0, 10) < todayStr) return '#b3261e';
  if (date.slice(0, 10) === todayStr) {
    return target.getTime() < now.getTime() ? '#b3261e' : '#a15c00';
  }
  return '#0a7a2f';
}

function AuditTab({ entries, onRefresh }: { entries: AuditEntry[]; onRefresh: () => void }) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Activity log ({entries.length})</h2>
        <button onClick={onRefresh} style={secondaryButtonStyle}>Refresh</button>
      </div>
      <table>
        <thead>
          <tr><th>When</th><th>Who</th><th>Action</th><th>On</th><th>Details</th></tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.createdAt).toLocaleString()}</td>
              <td>{e.actorName}</td>
              <td>{e.action}</td>
              <td>{e.targetType}{e.targetId ? ` #${e.targetId}` : ''}</td>
              <td style={{ fontSize: 12, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {JSON.stringify(e.details)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #ddd',
  borderRadius: 6,
  padding: 16,
  marginBottom: 20,
};

const inputStyle: React.CSSProperties = {
  display: 'block',
  padding: '6px 8px',
  fontSize: 14,
  border: '1px solid #ccc',
  borderRadius: 4,
  marginTop: 4,
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 14px',
  background: '#111',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: '#fff',
  color: '#111',
  border: '1px solid #ccc',
  borderRadius: 4,
  cursor: 'pointer',
};
