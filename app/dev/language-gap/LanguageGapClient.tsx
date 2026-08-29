'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BrandHeader } from '@/app/components/BrandHeader';
import { ThemeToggle } from '@/app/components/ThemeToggle';

type GapLead = {
  id: number;
  leadCode: string;
  name: string;
  mobile: string;
  source: string | null;
  assignedDate: string;
  qualificationStatus: string;
  ownerUserId: number | null;
  ownerName: string | null;
};

export default function LanguageGapClient() {
  const [leads, setLeads] = useState<GapLead[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/dev/language-gap')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          return;
        }
        setLeads(d.leads || []);
      })
      .catch(() => setError('Could not reach the server.'));
  }, []);

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <BrandHeader subtitle="Language data-quality worklist" />
        <ThemeToggle />
      </div>

      <div
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          borderRadius: 6,
          padding: 14,
          marginTop: 16,
          marginBottom: 16,
          fontSize: 13,
          color: 'var(--muted)',
        }}
      >
        Temporary diagnostic — Qualified leads with no Language on record (see the root-cause
        writeup delivered alongside this page). Read-only list; click a row to open that lead
        and fill in Language by hand. Nothing here is guessed or written automatically.
      </div>

      {error && <div style={{ color: '#c0392b' }}>{error}</div>}
      {!error && leads === null && <div>Loading…</div>}
      {!error && leads !== null && leads.length === 0 && (
        <div style={{ padding: 20 }}>Nothing outstanding — every Qualified lead has a Language on record.</div>
      )}
      {!error && leads !== null && leads.length > 0 && (
        <>
          <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--muted)' }}>{leads.length} lead(s) to review</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--th-bg)', color: 'var(--th-fg)', textAlign: 'left' }}>
                  <th style={thStyle}>Lead Code</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Mobile</th>
                  <th style={thStyle}>Source</th>
                  <th style={thStyle}>Assigned Date</th>
                  <th style={thStyle}>Owner</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} style={{ borderBottom: '1px solid var(--td-border)' }}>
                    <td style={tdStyle}>{l.leadCode}</td>
                    <td style={tdStyle}>{l.name || '—'}</td>
                    <td style={tdStyle}>{l.mobile || '—'}</td>
                    <td style={tdStyle}>{l.source || '—'}</td>
                    <td style={tdStyle}>{l.assignedDate ? l.assignedDate.slice(0, 10) : '—'}</td>
                    <td style={tdStyle}>{l.ownerName || 'Unassigned'}</td>
                    <td style={tdStyle}>
                      <Link href={`/leads/${l.id}`} target="_blank" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                        Open →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: '8px 10px', fontWeight: 600, borderBottom: '1px solid var(--td-border)' };
const tdStyle: React.CSSProperties = { padding: '8px 10px', color: 'var(--fg)' };
