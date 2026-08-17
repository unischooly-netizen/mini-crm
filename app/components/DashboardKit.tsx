'use client';

import { useRouter, usePathname } from 'next/navigation';

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
  padding: '6px 8px',
  borderRadius: 4,
  border: '1px solid #ccc',
  fontSize: 13,
};

export const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e2e2',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
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
        padding: '8px 10px',
        border: isActive ? '1px solid #111' : '1px solid #ccc',
        borderRadius: 4,
        background: '#fff',
        cursor: 'pointer',
        fontWeight: isActive ? 600 : 400,
        fontSize: 14,
      }}
    >
      <option value="">Dashboards ▾</option>
      {DASHBOARD_LINKS.map((d) => (
        <option key={d.href} value={d.href}>{d.label}</option>
      ))}
    </select>
  );
}
