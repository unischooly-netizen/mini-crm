'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';

// Shared building blocks for the Stage 4 reporting dashboards (Call Log,
// Today's Follow-up, and the ones after them): a color-coded KPI card and a
// simple filter-panel field wrapper, kept visually consistent with the
// StatusBadge palette used everywhere else in the app.

export type KpiTone = 'green' | 'yellow' | 'red' | 'neutral';

const TONE_COLORS: Record<KpiTone, { bg: string; fg: string }> = {
  green: { bg: '#e6f6ea', fg: '#0a7a2f' },
  yellow: { bg: '#fff4e0', fg: '#a15c00' },
  red: { bg: '#fdeaea', fg: '#b3261e' },
  neutral: { bg: '#eef1f4', fg: '#333' },
};

export function KpiCard({ label, value, tone = 'neutral', sub }: { label: string; value: string; tone?: KpiTone; sub?: string }) {
  const c = TONE_COLORS[tone];
  return (
    <div style={{ background: c.bg, borderRadius: 8, padding: '12px 16px', minWidth: 150, flex: '1 1 150px' }}>
      <div style={{ fontSize: 12, color: c.fg, opacity: 0.85, marginBottom: 4, whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: c.fg, lineHeight: 1.1 }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: c.fg, opacity: 0.75, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

export function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#555', minWidth: 130 }}>
      {label}
      {children}
    </label>
  );
}

export const selectStyle: React.CSSProperties = {
  padding: '5px 6px',
  borderRadius: 6,
  border: '1px solid var(--input-border)',
  background: 'var(--card-bg)',
  color: 'var(--fg)',
  fontSize: 13,
};

export const cardStyle: React.CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--card-border)',
  borderRadius: 14,
  padding: 18,
  marginBottom: 16,
  boxShadow: '0 1px 3px rgba(16, 20, 42, 0.04)',
};

// Chart palette — reused across pie/bar charts so colors stay consistent
// with the rest of the app (green/red/orange/blue/grey family).
export const CHART_COLORS = ['#1a56c4', '#0a7a2f', '#b3261e', '#a15c00', '#7a4fd1', '#0f9ba6', '#c2185b', '#555555'];


// Single "Dashboards ▾" dropdown, reused across every role's home page nav
// bar (Agent, Admin/Data Team, Vertical Head/Sales Counsellor) — mirrors the
// "Operations ▾" dropdown pattern already used in Admin. Kept in one place
// so every new reporting dashboard only needs to be added here once, and
// so it only ever appears on a role's actual home page, not on pages a
// role merely navigates into (e.g. Admin clicking into Qualified Leads).
export const DASHBOARD_LINKS: { href: string; label: string }[] = [
  { href: '/dashboards/call-log', label: 'Call Log' },
  { href: '/dashboards/today-followup', label: "Today's Follow-up" },
  { href: '/dashboards/team-performance', label: 'Team Performance' },
  { href: '/dashboards/qualified-dashboard', label: 'Qualified Dashboard' },
  { href: '/dashboards/operations', label: 'Operations Dashboard' },
  { href: '/dashboards/ceo', label: 'CEO Dashboard' },
];

export function DashboardsMenu() {
  const router = useRouter();
  const pathname = usePathname();
  const isActive = DASHBOARD_LINKS.some((d) => d.href === pathname);

  return (
    <select
      value={isActive ? pathname : ''}
      onChange={(e) => {
        if (!e.target.value) return;
        router.push(e.target.value);
      }}
      style={{
        padding: '8px 12px',
        border: isActive ? '1.5px solid var(--accent)' : '1px solid var(--input-border)',
        borderRadius: 8,
        background: 'var(--card-bg)',
        color: isActive ? 'var(--accent-dark)' : 'var(--fg)',
        cursor: 'pointer',
        fontWeight: isActive ? 600 : 400,
        fontSize: 14,
        maxWidth: '100%',
      }}
    >
      <option value="">Dashboards ▾</option>
      {DASHBOARD_LINKS.map((d) => (
        <option key={d.href} value={d.href}>{d.label}</option>
      ))}
    </select>
  );
}

// ---- Client-side pagination for long lead lists (All Leads, Agent Tabs,
// Qualified Leads, My Leads) ----------------------------------------------
// All of these fetch their full filtered dataset once and filter/sort in
// the browser already, so pagination here just slices what's already in
// memory — no API changes needed. usePageSlice keeps a page number, resets
// it to 1 whenever the caller's resetKey changes (e.g. a filter or search
// term), and hands back only the current page's items plus everything a
// pager control needs to render itself.
export const PAGE_SIZE = 100;

export function usePageSlice<T>(items: T[], resetKey: unknown): {
  page: number;
  setPage: (p: number) => void;
  totalPages: number;
  pageItems: T[];
} {
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = items.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return { page: safePage, setPage, totalPages, pageItems };
}

export function Pager({ page, totalPages, totalItems, onChange }: {
  page: number;
  totalPages: number;
  totalItems: number;
  onChange: (p: number) => void;
}) {
  if (totalItems === 0) return null;
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, totalItems);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0', flexWrap: 'wrap' }}>
      <button
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        style={{ ...pagerButtonStyle, opacity: page <= 1 ? 0.4 : 1, cursor: page <= 1 ? 'default' : 'pointer' }}
      >
        ← Prev
      </button>
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>
        Showing {start}–{end} of {totalItems} · Page {page} of {totalPages}
      </span>
      <button
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        style={{ ...pagerButtonStyle, opacity: page >= totalPages ? 0.4 : 1, cursor: page >= totalPages ? 'default' : 'pointer' }}
      >
        Next →
      </button>
    </div>
  );
}

const pagerButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  border: '1px solid var(--input-border)',
  borderRadius: 8,
  background: 'var(--card-bg)',
  color: 'var(--accent-dark)',
  fontSize: 13,
  fontWeight: 600,
};
