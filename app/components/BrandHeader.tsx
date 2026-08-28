export function BrandHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          background: 'var(--card-bg)',
          border: '1px solid var(--card-border)',
          boxShadow: '0 2px 8px rgba(28, 35, 64, 0.08)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/tls-logo.svg" alt="TLS" style={{ width: 24, height: 24 }} />
      </div>
      <h1
        style={{
          fontSize: 19,
          margin: 0,
          fontWeight: 700,
          color: 'var(--fg)',
          letterSpacing: '-0.2px',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          minWidth: 0,
        }}
      >
        TLS <span className="brand-tagline" style={{ color: 'var(--muted)', fontWeight: 500 }}>— Presales CRM</span>
        {subtitle ? <span style={{ fontWeight: 400, color: 'var(--muted)' }}> — {subtitle}</span> : null}
      </h1>
    </div>
  );
}
