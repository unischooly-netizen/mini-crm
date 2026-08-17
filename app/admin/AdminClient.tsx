'use client';

import { BrandHeader } from '@/app/components/BrandHeader';
import { DashboardsMenu } from '@/app/components/DashboardKit';
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

type User = { id: number; name: string; role: Role; created_at: string; pin?: string | null };

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

type Tab = 'leads' | 'upload' | 'rules' | 'users' | 'audit' | 'data' | 'fullimport';

export default function AdminClient({ adminName, role }: { adminName: string; role: Role }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('leads');
  const [leadsAgentFilter, setLeadsAgentFilter] = useState<string>('All');
  const [users, setUsers] = useState<User[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});

  function setLoadErr(key: string, msg: string) {
    setLoadErrors((prev) => ({ ...prev, [key]: msg }));
  }
  function clearLoadErr(key: string) {
    setLoadErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadErr('users', data.error || `Could not load users (server said: ${res.status}). If this just started after an update, the database may need /api/init run again.`);
        return;
      }
      clearLoadErr('users');
      setUsers(data.users || []);
    } catch {
      setLoadErr('users', 'Could not reach the server for users. Check your connection and try again.');
    }
  }, []);

  const loadRules = useCallback(async () => {
    try {
      const res = await fetch('/api/allocation-rules');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadErr('rules', data.error || `Could not load allocation rules (server said: ${res.status}).`);
        return;
      }
      clearLoadErr('rules');
      setRules(data.rules || []);
    } catch {
      setLoadErr('rules', 'Could not reach the server for allocation rules. Check your connection and try again.');
    }
  }, []);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/leads');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadErr('leads', data.error || `Could not load leads (server said: ${res.status}).`);
        return;
      }
      clearLoadErr('leads');
      setLeads(data.leads || []);
    } catch {
      setLoadErr('leads', 'Could not reach the server for leads. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    try {
      const res = await fetch('/api/audit-log');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadErr('audit', data.error || `Could not load the audit log (server said: ${res.status}).`);
        return;
      }
      clearLoadErr('audit');
      setAudit(data.entries || []);
    } catch {
      setLoadErr('audit', 'Could not reach the server for the audit log. Check your connection and try again.');
    }
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
    <div style={{ maxWidth: '96vw', margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <BrandHeader subtitle={`Admin (${adminName})`} />
        <button onClick={handleLogout} style={secondaryButtonStyle}>Log out</button>
      </div>

      {Object.keys(loadErrors).length > 0 && (
        <div style={{ background: '#fdeaea', border: '1px solid #f3b8b8', borderRadius: 4, padding: 12, marginBottom: 16 }}>
          {Object.values(loadErrors).map((msg, i) => (
            <p key={i} style={{ color: '#b3261e', margin: i === 0 ? 0 : '6px 0 0' }}>{msg}</p>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        <TabButton active={tab === 'leads' && leadsAgentFilter === 'All'} onClick={() => { setTab('leads'); setLeadsAgentFilter('All'); }}>All Leads</TabButton>
        <TabButton active={false} onClick={() => router.push('/qualified-leads')}>Qualified Leads</TabButton>
        <DashboardsMenu />
        {(() => {
          const opsTabs: { key: Tab; label: string }[] = [
            { key: 'upload', label: 'Upload Leads' },
            { key: 'rules', label: 'Allocation Rules' },
            { key: 'users', label: 'Users' },
            ...(role === 'admin' ? [{ key: 'audit' as Tab, label: 'Audit Log' }] : []),
            ...(role === 'admin' || role === 'data_team' ? [{ key: 'data' as Tab, label: 'Data Tools' }] : []),
            ...(role === 'admin' ? [{ key: 'fullimport' as Tab, label: 'Full Import' }] : []),
          ];
          const opsKeys = opsTabs.map((t) => t.key);
          const isOpsTabActive = opsKeys.includes(tab);
          return (
            <select
              value={isOpsTabActive ? tab : ''}
              onChange={(e) => {
                if (!e.target.value) return;
                setTab(e.target.value as Tab);
              }}
              style={{
                padding: '8px 10px', border: isOpsTabActive ? '1px solid #111' : '1px solid #ccc',
                borderRadius: 4, background: '#fff', cursor: 'pointer', fontWeight: isOpsTabActive ? 600 : 400,
              }}
            >
              <option value="">Operations ▾</option>
              {opsTabs.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          );
        })()}
        {agents.length > 0 && (
          <select
            value={agents.some((a) => String(a.id) === leadsAgentFilter) ? leadsAgentFilter : ''}
            onChange={(e) => {
              if (!e.target.value) return;
              setTab('leads');
              setLeadsAgentFilter(e.target.value);
            }}
            style={{ padding: '8px 10px', border: '1px solid #ccc', borderRadius: 4, background: '#fff', cursor: 'pointer' }}
          >
            <option value="">Agent Tabs ▾</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
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
      {tab === 'data' && <DataToolsTab role={role} />}
      {tab === 'fullimport' && <FullImportTab onImported={() => { loadLeads(); loadAudit(); }} />}
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
            <tr><th>Name</th><th>Role</th><th>PIN</th><th></th><th></th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRow key={u.id} user={u} onChanged={onChanged} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UserRow({ user, onChanged }: { user: User; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSave() {
    setError('');
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      if (name.trim() !== user.name) patch.name = name.trim();
      if (role !== user.role) patch.role = role;
      if (newPin.trim()) patch.pin = newPin.trim();
      if (Object.keys(patch).length === 0) {
        setEditing(false);
        return;
      }
      const res = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Could not save changes (server said: ${res.status}).`);
        return;
      }
      setNewPin('');
      setEditing(false);
      onChanged();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const ok = window.confirm(`Permanently delete ${user.name} (${ROLE_LABELS[user.role]})? This cannot be undone.`);
    if (!ok) return;
    setError('');
    setDeleting(true);
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Could not delete this user (server said: ${res.status}).`);
        return;
      }
      onChanged();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <tr>
        <td><input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} /></td>
        <td>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} style={inputStyle}>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </td>
        <td>
          <input
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            placeholder="New PIN (optional)"
            style={{ ...inputStyle, width: 130 }}
          />
        </td>
        <td colSpan={2}>
          <button onClick={handleSave} disabled={saving} style={primaryButtonStyle}>{saving ? 'Saving…' : 'Save'}</button>{' '}
          <button onClick={() => { setEditing(false); setName(user.name); setRole(user.role); setNewPin(''); setError(''); }} style={secondaryButtonStyle}>Cancel</button>
          {error && <p style={{ color: 'crimson', fontSize: 12, margin: '4px 0 0' }}>{error}</p>}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{user.name}</td>
      <td>{ROLE_LABELS[user.role]}</td>
      <td>{user.pin !== undefined ? (user.pin ?? <span style={{ color: '#999' }}>not viewable — reset to set</span>) : ''}</td>
      <td><button onClick={() => setEditing(true)} style={secondaryButtonStyle}>Edit</button></td>
      <td>
        <button onClick={handleDelete} disabled={deleting} style={dangerButtonStyleSmall}>{deleting ? 'Deleting…' : 'Delete'}</button>
        {error && <p style={{ color: 'crimson', fontSize: 12, margin: '4px 0 0' }}>{error}</p>}
      </td>
    </tr>
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
  const [search, setSearch] = useState('');

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
    const q = search.trim().toLowerCase();
    if (q) {
      const hit =
        lead.leadCode?.toLowerCase().includes(q) ||
        lead.name?.toLowerCase().includes(q) ||
        lead.mobile?.toLowerCase().includes(q) ||
        lead.email?.toLowerCase().includes(q) ||
        (lead.ownerName || '').toLowerCase().includes(q);
      if (!hit) return false;
    }
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
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search lead code, name, mobile…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, width: 240 }}
          />
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
    // Stage 3: Connecting / Meeting / Trial / Admission / Reminder Call statuses.
    // Several fields share these same words (Pending, Rescheduled, Cancelled) —
    // one shared color per word keeps the whole app visually consistent.
    'Pending': { bg: '#eef1f4', fg: '#555' },
    'Not Contacted': { bg: '#eef1f4', fg: '#555' },
    'Joined': { bg: '#e6f6ea', fg: '#0a7a2f' },
    'Not Joined': { bg: '#fdeaea', fg: '#b3261e' },
    'Completed': { bg: '#e6f6ea', fg: '#0a7a2f' },
    'Not Completed': { bg: '#fdeaea', fg: '#b3261e' },
    'Rescheduled': { bg: '#fff4e0', fg: '#a15c00' },
    'Cancelled': { bg: '#e2e2e2', fg: '#333' },
    'Trial Done': { bg: '#e6f6ea', fg: '#0a7a2f' },
    'Trial Not Done': { bg: '#fdeaea', fg: '#b3261e' },
    'Trial Sceduled but not done': { bg: '#fff4e0', fg: '#a15c00' },
    'On Hold': { bg: '#fff4e0', fg: '#a15c00' },
    'Closed Won': { bg: '#e6f6ea', fg: '#0a7a2f' },
    'Closed Lost': { bg: '#fdeaea', fg: '#b3261e' },
    'Contacted': { bg: '#e6f6ea', fg: '#0a7a2f' },
    'No Answer': { bg: '#fdeaea', fg: '#b3261e' },
    'Call Back Requested': { bg: '#fff4e0', fg: '#a15c00' },
    'Active Qualified': { bg: '#e6f6ea', fg: '#0a7a2f' },
    'Revoked': { bg: '#fdeaea', fg: '#b3261e' },
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

function FullImportTab({ onImported }: { onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    rowsInFile: number;
    inserted: number;
    skippedDuplicates: number;
    skippedBlank: number;
    unmatchedOwners: string[];
    unmatchedVh: string[];
    unmatchedCounsellors: string[];
  } | null>(null);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Choose a file first.');
      return;
    }
    setError('');
    setResult(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/leads/full-import', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Import failed (server said: ${res.status}).`);
        return;
      }
      setResult(data);
      onImported();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={cardStyle}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Full data import (migration)</h2>
      <p style={{ fontSize: 14, color: '#555' }}>
        For leads that already have history — call attempts, outcome, meeting/trial/admission status, VH and
        Counsellor already assigned — unlike the plain Upload Leads tab, which is only for brand-new,
        untouched leads. Add Vertical Head and Sales Counsellor users first; they&apos;re matched to the file by
        exact name. Total Attempts, Qualification Status, Meeting Status, and Handover Status are always worked
        out by the app itself from the other fields, not read from the file. Rows with a mobile number already
        in the system are skipped automatically.
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
          {uploading ? 'Importing…' : 'Import'}
        </button>
      </form>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      {result && (
        <div style={{ marginTop: 16, background: '#f0f8f0', padding: 12, borderRadius: 4 }}>
          <p>Rows in file: {result.rowsInFile}</p>
          <p>Leads added: {result.inserted}</p>
          <p>Skipped duplicates: {result.skippedDuplicates}</p>
          <p>Skipped blank rows: {result.skippedBlank}</p>
          {result.unmatchedOwners.length > 0 && (
            <p style={{ color: '#a15c00' }}>Pre-Sales Agent name(s) not found (left unassigned): {result.unmatchedOwners.join(', ')}</p>
          )}
          {result.unmatchedVh.length > 0 && (
            <p style={{ color: '#a15c00' }}>Vertical Head name(s) not found (left unassigned): {result.unmatchedVh.join(', ')}</p>
          )}
          {result.unmatchedCounsellors.length > 0 && (
            <p style={{ color: '#a15c00' }}>Sales Counsellor name(s) not found (left unassigned): {result.unmatchedCounsellors.join(', ')}</p>
          )}
        </div>
      )}
    </div>
  );
}

function DataToolsTab({ role }: { role: Role }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [preview, setPreview] = useState<{ leadCount: number; auditCount: number } | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [clearing, setClearing] = useState(false);
  const [clearResult, setClearResult] = useState('');
  const [clearError, setClearError] = useState('');

  const validRange = !!from && !!to && from <= to;

  async function runPreview() {
    setPreviewError('');
    setPreview(null);
    setClearResult('');
    if (!validRange) {
      setPreviewError('Pick a valid From and To date first (From must not be after To).');
      return;
    }
    setPreviewing(true);
    try {
      const res = await fetch(`/api/admin/clear-data?from=${from}&to=${to}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPreviewError(data.error || `Could not check this range (server said: ${res.status}).`);
        return;
      }
      setPreview(data);
    } catch {
      setPreviewError('Could not reach the server. Check your connection and try again.');
    } finally {
      setPreviewing(false);
    }
  }

  async function runClear() {
    setClearError('');
    setClearResult('');
    if (confirmText !== 'DELETE') return;
    setClearing(true);
    try {
      const res = await fetch('/api/admin/clear-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, confirm: confirmText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setClearError(data.error || `Could not clear this range (server said: ${res.status}).`);
        return;
      }
      setClearResult(`Deleted ${data.leadCount} lead(s) and ${data.auditCount} audit log entr${data.auditCount === 1 ? 'y' : 'ies'} assigned/logged between ${from} and ${to}.`);
      setPreview(null);
      setConfirmText('');
    } catch {
      setClearError('Could not reach the server. Check your connection and try again.');
    } finally {
      setClearing(false);
    }
  }

  return (
    <div style={cardStyle}>
      <h2 style={{ fontSize: 16, marginTop: 0 }}>Export &amp; data cleanup</h2>
      <p style={{ fontSize: 13, color: '#666', marginTop: -4 }}>
        Export downloads a CSV (opens directly in Excel) for leads assigned, or audit log entries logged, within the
        date range below. Leads are matched by Assigned Date; audit log entries by when they were logged.
      </p>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        <label>
          <div style={{ fontSize: 12, color: '#777', marginBottom: 3 }}>From</div>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreview(null); setClearResult(''); }} style={inputStyle} />
        </label>
        <label>
          <div style={{ fontSize: 12, color: '#777', marginBottom: 3 }}>To</div>
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreview(null); setClearResult(''); }} style={inputStyle} />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        <a
          href={validRange ? `/api/admin/export?type=leads&from=${from}&to=${to}` : undefined}
          onClick={(e) => { if (!validRange) e.preventDefault(); }}
          style={{ ...secondaryButtonStyle, textDecoration: 'none', opacity: validRange ? 1 : 0.5, pointerEvents: validRange ? 'auto' : 'none' }}
        >
          Export Leads (CSV)
        </a>
        <a
          href={validRange ? `/api/admin/export?type=audit&from=${from}&to=${to}` : undefined}
          onClick={(e) => { if (!validRange) e.preventDefault(); }}
          style={{ ...secondaryButtonStyle, textDecoration: 'none', opacity: validRange ? 1 : 0.5, pointerEvents: validRange ? 'auto' : 'none' }}
        >
          Export Audit Log (CSV)
        </a>
      </div>

      {role === 'admin' && (
        <div style={{ borderTop: '1px solid #eee', paddingTop: 16 }}>
          <h3 style={{ fontSize: 14, marginTop: 0, color: '#b3261e' }}>Clear data in this range</h3>
          <p style={{ fontSize: 13, color: '#666' }}>
            Permanently deletes every lead assigned, and every audit log entry logged, within the range above.
            This cannot be undone — export first and check the file before doing this.
          </p>

          <button onClick={runPreview} disabled={!validRange || previewing} style={secondaryButtonStyle}>
            {previewing ? 'Checking…' : 'Check how many rows this would delete'}
          </button>
          {previewError && <p style={{ color: 'crimson', fontSize: 13 }}>{previewError}</p>}

          {preview && (
            <div style={{ marginTop: 12, padding: 12, background: '#fdeaea', borderRadius: 4 }}>
              <p style={{ margin: '0 0 10px 0', fontSize: 14 }}>
                This will permanently delete <strong>{preview.leadCount} lead(s)</strong> and{' '}
                <strong>{preview.auditCount} audit log entr{preview.auditCount === 1 ? 'y' : 'ies'}</strong>.
              </p>
              <label style={{ display: 'block', marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: '#555', marginBottom: 3 }}>Type DELETE to confirm</div>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  style={inputStyle}
                  placeholder="DELETE"
                />
              </label>
              <button
                onClick={runClear}
                disabled={confirmText !== 'DELETE' || clearing}
                style={{ ...primaryButtonStyle, background: confirmText === 'DELETE' ? '#b3261e' : '#ccc' }}
              >
                {clearing ? 'Deleting…' : `Permanently delete these ${preview.leadCount} lead(s)`}
              </button>
            </div>
          )}
          {clearError && <p style={{ color: 'crimson', fontSize: 13 }}>{clearError}</p>}
          {clearResult && <p style={{ color: '#0a7a2f', fontSize: 13 }}>{clearResult}</p>}
        </div>
      )}
    </div>
  );
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

const dangerButtonStyleSmall: React.CSSProperties = {
  padding: '5px 10px',
  background: '#fdeaea',
  color: '#b3261e',
  border: '1px solid #f3b8b8',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 13,
};
