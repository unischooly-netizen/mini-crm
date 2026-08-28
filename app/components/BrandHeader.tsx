export function BrandHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          background: '#fff',
          border: '1px solid #e9ebf3',
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
      <h1 style={{ fontSize: 19, margin: 0, fontWeight: 700, color: '#10142a', letterSpacing: '-0.2px' }}>
        TLS <span style={{ color: '#8a90a8', fontWeight: 500 }}>— Presales CRM</span>
        {subtitle ? <span style={{ fontWeight: 400, color: '#4a4f66' }}> — {subtitle}</span> : null}
      </h1>
    </div>
  );
}
