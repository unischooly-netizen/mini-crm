'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { BrandHeader } from '@/app/components/BrandHeader';
import { formatDate, formatDateTime, formatTimestampIST } from '@/lib/format';
import { StatusBadge, followupColor } from '@/app/admin/AdminClient';
import {
  STATES, PROFESSIONS, PURPOSES, ATTEMPT_STATUSES, FINAL_OUTCOMES,
  COURSE_START_TIMELINES, PREFERRED_MODES, ATTEMPT_COUNT,
} from '@/lib/masters';

type Role = 'admin' | 'presales_agent' | 'vertical_head' | 'sales_counsellor' | 'data_team';

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
  status: string;
  notes: string;
  state: string | null;
  profession: string | null;
  purpose: string | null;
  totalAttempts: number;
  finalOutcome: string | null;
  qualificationStatus: string;
  nextFollowupDate: string | null;
  nextFollowupTime: string | null;
  courseStartTimeline: string | null;
  meetingDate: string | null;
  meetingTime: string | null;
  preferredMode: string | null;
  handoverStatus: string;
  assignedVhUserId: number | null;
  assignedVhName: string | null;
  assignedCounsellorUserId: number | null;
  assignedCounsellorName: string | null;
  counsellorUpdate: string;
  updatedAt: string;
  [key: string]: unknown;
};

type UserOption = { id: number; name: string; role: Role };

const backPathFor: Record<Role, string> = {
  admin: '/admin',
  presales_agent: '/dashboard',
  vertical_head: '/qualified-leads',
  sales_counsellor: '/qualified-leads',
  data_team: '/admin',
};

export default function LeadDetailClient({
  leadId,
  role,
  selfUserId,
  selfName,
}: {
  leadId: string;
  role: Role;
  selfUserId: number;
  selfName: string;
}) {
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [vertHeads, setVertHeads] = useState<UserOption[]>([]);
  const [counsellors, setCounsellors] = useState<UserOption[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Local editable field state, seeded from the fetched lead.
  const [form, setForm] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError('');
    const res = await fetch(`/api/leads/${leadId}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Could not load this lead.');
      return;
    }
    setLead(data.lead);
    const f: Record<string, string> = {};
    for (let i = 1; i <= ATTEMPT_COUNT; i++) {
      f[`attempt${i}Status`] = data.lead[`attempt${i}Status`] || '';
    }
    f.state = data.lead.state || '';
    f.profession = data.lead.profession || '';
    f.purpose = data.lead.purpose || '';
    f.finalOutcome = data.lead.finalOutcome || '';
    f.remarks = data.lead.notes || '';
    f.courseStartTimeline = data.lead.courseStartTimeline || '';
    f.meetingDate = data.lead.meetingDate ? data.lead.meetingDate.slice(0, 10) : '';
    f.meetingTime = data.lead.meetingTime || '';
    f.preferredMode = data.lead.preferredMode || '';
    f.nextFollowupDate = data.lead.nextFollowupDate ? data.lead.nextFollowupDate.slice(0, 10) : '';
    f.nextFollowupTime = data.lead.nextFollowupTime || '';
    f.counsellorUpdate = data.lead.counsellorUpdate || '';
    f.assignedVhUserId = data.lead.assignedVhUserId ? String(data.lead.assignedVhUserId) : '';
    f.assignedCounsellorUserId = data.lead.assignedCounsellorUserId ? String(data.lead.assignedCounsellorUserId) : '';
    setForm(f);
  }, [leadId]);

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

  async function handleLogout() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  if (error) {
    return (
      <div style={{ maxWidth: 700, margin: '60px auto', fontFamily: 'system-ui, sans-serif', textAlign: 'center' }}>
        <p style={{ color: 'crimson' }}>{error}</p>
        <Link href={backPathFor[role]}>← Back</Link>
      </div>
    );
  }

  if (!lead) {
    return <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif' }}>Loading…</div>;
  }

  const isOwnerAgent = role === 'presales_agent' && lead.ownerUserId === selfUserId;
  const isAssignedVh = role === 'vertical_head' && lead.assignedVhUserId === selfUserId;
  const isAssignedCounsellor = role === 'sales_counsellor' && lead.assignedCounsellorUserId === selfUserId;
  const isAdmin = role === 'admin';

  const canEditAgentFields = isAdmin || isOwnerAgent;
  const canAssignVh = isAdmin;
  const canAssignCounsellor = isAdmin || isAssignedVh;
  const canEditCounsellorUpdate = isAdmin || isAssignedCounsellor;
  const canEditAnything = canEditAgentFields || canAssignVh || canAssignCounsellor || canEditCounsellorUpdate;

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError('');

    const patch: Record<string, unknown> = {};
    if (canEditAgentFields) {
      for (let i = 1; i <= ATTEMPT_COUNT; i++) {
        patch[`attempt${i}Status`] = form[`attempt${i}Status`] || null;
      }
      patch.state = form.state || null;
      patch.profession = form.profession || null;
      patch.purpose = form.purpose || null;
      patch.finalOutcome = form.finalOutcome || null;
      patch.remarks = form.remarks || '';
      patch.courseStartTimeline = form.courseStartTimeline || null;
      patch.meetingDate = form.meetingDate || null;
      patch.meetingTime = form.meetingTime || null;
      patch.preferredMode = form.preferredMode || null;
      patch.nextFollowupDate = form.nextFollowupDate || null;
      patch.nextFollowupTime = form.nextFollowupTime || null;
    }
    if (canAssignVh) {
      patch.assignedVhUserId = form.assignedVhUserId ? Number(form.assignedVhUserId) : null;
    }
    if (canAssignCounsellor) {
      patch.assignedCounsellorUserId = form.assignedCounsellorUserId ? Number(form.assignedCounsellorUserId) : null;
    }
    if (canEditCounsellorUpdate) {
      patch.counsellorUpdate = form.counsellorUpdate || '';
    }

    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || `Could not save changes (server said: ${res.status}).`);
        return;
      }
      setSaved(true);
      load();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <BrandHeader subtitle={`${lead.leadCode} — ${lead.name}`} />
        <button onClick={handleLogout} style={secondaryButtonStyle}>Log out</button>
      </div>
      <Link href={backPathFor[role]} style={{ fontSize: 14 }}>← Back</Link>

      {/* Summary */}
      <div style={{ ...cardStyle, marginTop: 16 }}>
        <div style={gridStyle}>
          <Field label="Mobile" value={lead.mobile} />
          <Field label="Email" value={lead.email} />
          <Field label="Source" value={lead.source} />
          <Field label="Language" value={lead.language} />
          <Field label="Assigned Date" value={formatDate(lead.assignedDate)} />
          <div>
            <div style={labelStyle}>Qualification Status</div>
            <StatusBadge status={lead.qualificationStatus} />
          </div>
          <div>
            <div style={labelStyle}>Next Follow-up</div>
            <div style={{ color: followupColor(lead.nextFollowupDate, lead.nextFollowupTime), fontWeight: 600 }}>
              {formatDateTime(lead.nextFollowupDate, lead.nextFollowupTime) || '—'}
            </div>
          </div>
          <Field label="Handover Status" value={lead.handoverStatus} />
          <Field label="Last Updated" value={formatTimestampIST(lead.updatedAt)} />
        </div>
      </div>

      {/* Basic info */}
      <div style={cardStyle}>
        <h2 style={h2Style}>Lead info</h2>
        <div style={gridStyle}>
          <SelectField label="State" value={form.state} options={STATES} onChange={(v) => set('state', v)} disabled={!canEditAgentFields} />
          <SelectField label="Profession" value={form.profession} options={PROFESSIONS} onChange={(v) => set('profession', v)} disabled={!canEditAgentFields} />
          <SelectField label="Purpose" value={form.purpose} options={PURPOSES} onChange={(v) => set('purpose', v)} disabled={!canEditAgentFields} />
        </div>
      </div>

      {/* Attempts */}
      <div style={cardStyle}>
        <h2 style={h2Style}>Call attempts ({lead.totalAttempts} of {ATTEMPT_COUNT} logged)</h2>
        {Array.from({ length: ATTEMPT_COUNT }, (_, idx) => idx + 1).map((i) => (
          <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
            <div style={{ width: 90, fontSize: 13, color: '#555' }}>Attempt {i}</div>
            <select
              value={form[`attempt${i}Status`] || ''}
              onChange={(e) => set(`attempt${i}Status`, e.target.value)}
              disabled={!canEditAgentFields}
              style={inputStyle}
            >
              <option value="">—</option>
              {ATTEMPT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <div style={{ fontSize: 13, color: '#777' }}>
              {formatDateTime(lead[`attempt${i}Date`] as string, lead[`attempt${i}Time`] as string) || 'not logged yet'}
            </div>
          </div>
        ))}
      </div>

      {/* Outcome */}
      <div style={cardStyle}>
        <h2 style={h2Style}>Outcome</h2>
        <div style={gridStyle}>
          <Field label="Total Attempts" value={String(lead.totalAttempts)} />
          <SelectField label="Final Outcome" value={form.finalOutcome} options={FINAL_OUTCOMES} onChange={(v) => set('finalOutcome', v)} disabled={!canEditAgentFields} />
          <div>
            <div style={labelStyle}>Qualification Status</div>
            <StatusBadge status={lead.qualificationStatus} />
          </div>
          <DateField label="Next Follow-up Date" value={form.nextFollowupDate} onChange={(v) => set('nextFollowupDate', v)} disabled={!canEditAgentFields} />
          <TimeField label="Next Follow-up Time" value={form.nextFollowupTime} onChange={(v) => set('nextFollowupTime', v)} disabled={!canEditAgentFields} />
        </div>
        <p style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
          Next Follow-up sets itself automatically: once a Meeting Date &amp; Time is scheduled below, it becomes
          30 minutes before that meeting. Otherwise, if an attempt comes back Busy / No Answer / Switched Off /
          No Incoming Call / Number not connecting, it&apos;s set to the next business-hours slot (Mon–Sat
          10am–7pm). Manual values here are only used when neither rule applies.
        </p>
        <TextAreaField label="Remarks" value={form.remarks} onChange={(v) => set('remarks', v)} disabled={!canEditAgentFields} />
      </div>

      {/* Meeting */}
      <div style={cardStyle}>
        <h2 style={h2Style}>Meeting</h2>
        <div style={gridStyle}>
          <SelectField label="Course Start Timeline" value={form.courseStartTimeline} options={COURSE_START_TIMELINES} onChange={(v) => set('courseStartTimeline', v)} disabled={!canEditAgentFields} />
          <DateField label="Meeting Date" value={form.meetingDate} onChange={(v) => set('meetingDate', v)} disabled={!canEditAgentFields} />
          <TimeField label="Meeting Time" value={form.meetingTime} onChange={(v) => set('meetingTime', v)} disabled={!canEditAgentFields} />
          <SelectField label="Preferred Mode" value={form.preferredMode} options={PREFERRED_MODES} onChange={(v) => set('preferredMode', v)} disabled={!canEditAgentFields} />
        </div>
      </div>

      {/* Handover / assignment */}
      <div style={cardStyle}>
        <h2 style={h2Style}>Handover</h2>
        <div style={gridStyle}>
          <Field label="Handover Status" value={lead.handoverStatus} />
          {canAssignVh ? (
            <SelectUsersField
              label="Assigned Vertical Head"
              value={form.assignedVhUserId}
              options={vertHeads}
              onChange={(v) => set('assignedVhUserId', v)}
              disabled={false}
            />
          ) : (
            <Field label="Assigned Vertical Head" value={lead.assignedVhName || 'Unassigned'} />
          )}
          {canAssignCounsellor ? (
            <SelectUsersField
              label="Assigned Sales Counsellor"
              value={form.assignedCounsellorUserId}
              options={counsellors}
              onChange={(v) => set('assignedCounsellorUserId', v)}
              disabled={false}
            />
          ) : (
            <Field label="Assigned Sales Counsellor" value={lead.assignedCounsellorName || 'Unassigned'} />
          )}
        </div>
        <p style={{ fontSize: 12, color: '#888', marginTop: 10, marginBottom: 4 }}>
          Handover Status updates itself automatically as the lead moves through Qualified → VH Assigned →
          Counsellor Assigned (more stages come in Stage 3, once meeting/trial/admission tracking is added).
          Counsellor / Meeting Update below is a free-text note the counsellor keeps updated by hand — the two
          are related but not the same thing.
        </p>
        <TextAreaField label="Counsellor / Meeting Update" value={form.counsellorUpdate} onChange={(v) => set('counsellorUpdate', v)} disabled={!canEditCounsellorUpdate} />
      </div>

      {canEditAnything && (
        <div style={{ position: 'sticky', bottom: 0, background: '#fff', padding: '12px 0', borderTop: '1px solid #eee' }}>
          {error && <p style={{ color: 'crimson' }}>{error}</p>}
          {saved && <p style={{ color: '#0a7a2f' }}>Saved.</p>}
          <button onClick={handleSave} disabled={saving} style={primaryButtonStyle}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div>{value || '—'}</div>
    </div>
  );
}

function SelectField({
  label, value, options, onChange, disabled,
}: { label: string; value: string; options: string[]; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <label>
      <div style={labelStyle}>{label}</div>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} style={inputStyle}>
        <option value="">—</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function SelectUsersField({
  label, value, options, onChange, disabled,
}: { label: string; value: string; options: UserOption[]; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <label>
      <div style={labelStyle}>{label}</div>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} style={inputStyle}>
        <option value="">Unassigned</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}

function DateField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <label>
      <div style={labelStyle}>{label}</div>
      <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} style={inputStyle} />
    </label>
  );
}

function TimeField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <label>
      <div style={labelStyle}>{label}</div>
      <input type="time" value={value || ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} style={inputStyle} />
    </label>
  );
}

function TextAreaField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <label style={{ display: 'block', marginTop: 10 }}>
      <div style={labelStyle}>{label}</div>
      <textarea
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={3}
        style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
      />
    </label>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #ddd',
  borderRadius: 6,
  padding: 16,
  marginTop: 16,
};

const h2Style: React.CSSProperties = { fontSize: 15, marginTop: 0, marginBottom: 12 };

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: 14,
};

const labelStyle: React.CSSProperties = { fontSize: 12, color: '#777', marginBottom: 3 };

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '6px 8px',
  fontSize: 14,
  border: '1px solid #ccc',
  borderRadius: 4,
  boxSizing: 'border-box',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 18px',
  background: '#111',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 14,
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: '#fff',
  color: '#111',
  border: '1px solid #ccc',
  borderRadius: 4,
  cursor: 'pointer',
};
