'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrandHeader } from '@/app/components/BrandHeader';

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Login failed.');
        setLoading(false);
        return;
      }
      router.push(data.redirectTo || '/dashboard');
      router.refresh();
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '80px auto', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ marginBottom: 24 }}><BrandHeader subtitle="Login" /></div>
      <form onSubmit={handleSubmit}>
        <label style={{ display: 'block', marginBottom: 12 }}>
          Name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
            autoFocus
          />
        </label>
        <label style={{ display: 'block', marginBottom: 16 }}>
          PIN
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            style={inputStyle}
          />
        </label>
        {error && <p style={{ color: 'crimson', marginBottom: 12 }}>{error}</p>}
        <button type="submit" disabled={loading} style={buttonStyle}>
          {loading ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 10px',
  marginTop: 4,
  fontSize: 16,
  border: '1px solid #ccc',
  borderRadius: 4,
  boxSizing: 'border-box',
};

const buttonStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  fontSize: 16,
  background: '#111',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};
