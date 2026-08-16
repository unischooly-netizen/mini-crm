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
  ownerName: string | null;
  status: string;
  createdAt: string;
};

export default function DataUploadClient({ userName }: { userName: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    rowsInFile: number;
    inserted: number;
    skippedDuplicates: string[];
    skippedBlank: number;
    allocated: number;
    unassignedLanguages: { language: string; reason: string }[];
  } | null>(null);
  const [recentLeads, setRecentLeads] = useState<Lead[]>([]);

  const loadRecent = useCallback(async () => {
    const res = await fetch('/api/leads');
    const data = await res.json();
    setRecentLeads((data.leads || []).slice(0, 50));
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  async function handleLogout() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

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
    loadRecent();
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <BrandHeader subtitle={`Data Upload — ${userName}`} />
        <button onClick={handleLogout} style={secondaryButtonStyle}>Log out</button>
      </div>

      <div style={cardStyle}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Upload leads (.xlsx or .csv)</h2>
        <p style={{ fontSize: 14, color: '#555' }}>
          Columns needed: Name, Mobile, Email, Source, Language. Duplicate mobile numbers already in the
          system are skipped automatically — you&apos;ll see exactly which ones after uploading.
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
            <p>
              Skipped duplicates: {result.skippedDuplicates.length}
              {result.skippedDuplicates.length > 0 ? ` (${result.skippedDuplicates.join(', ')})` : ''}
            </p>
            <p>Allocated to an agent just now: {result.allocated}</p>
            {result.unassignedLanguages.length > 0 && (
              <p style={{ color: '#a60' }}>
                Some leads are still unassigned — ask an admin to check Allocation Rules:{' '}
                {result.unassignedLanguages.map((s) => `${s.language} (${s.reason})`).join('; ')}
              </p>
            )}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Recently uploaded leads</h2>
        <table>
          <thead>
            <tr>
              <th>Lead Code</th><th>Name</th><th>Mobile</th><th>Language</th><th>Owner</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {recentLeads.map((lead) => (
              <tr key={lead.id}>
                <td>{lead.leadCode}</td>
                <td>{lead.name}</td>
                <td>{lead.mobile}</td>
                <td>{lead.language}</td>
                <td>{lead.ownerName || 'Unassigned'}</td>
                <td>{lead.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
