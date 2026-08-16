export function BrandHeader({ subtitle }: { subtitle?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/tls-logo.svg" alt="TLS" style={{ width: 32, height: 32, flexShrink: 0 }} />
      <h1 style={{ fontSize: 20, margin: 0 }}>
        TLS - Presales CRM
        {subtitle ? <span style={{ fontWeight: 400 }}> — {subtitle}</span> : null}
      </h1>
    </div>
  );
}
