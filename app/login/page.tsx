'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
    <div className="login-page">
      <style>{`
        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, system-ui, sans-serif;
          background:
            radial-gradient(circle at 15% 15%, rgba(120, 130, 255, 0.18), transparent 45%),
            radial-gradient(circle at 85% 85%, rgba(60, 200, 200, 0.14), transparent 45%),
            linear-gradient(160deg, #0b0f1f 0%, #101a35 45%, #0b0f1f 100%);
        }
        .login-card {
          width: 100%;
          max-width: 380px;
          background: rgba(255, 255, 255, 0.98);
          border-radius: 18px;
          padding: 40px 36px 32px;
          box-shadow:
            0 20px 60px rgba(0, 0, 0, 0.45),
            0 2px 8px rgba(0, 0, 0, 0.15),
            inset 0 1px 0 rgba(255, 255, 255, 0.6);
          animation: login-rise 0.5s ease-out;
        }
        @keyframes login-rise {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .login-logo-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-bottom: 28px;
        }
        .login-logo-badge {
          width: 56px;
          height: 56px;
          border-radius: 14px;
          background: linear-gradient(135deg, #1c2340, #34406e);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 8px 20px rgba(28, 35, 64, 0.35);
          margin-bottom: 14px;
        }
        .login-logo-badge img {
          width: 30px;
          height: 30px;
          filter: brightness(0) invert(1);
        }
        .login-title {
          font-size: 19px;
          font-weight: 600;
          color: #10142a;
          margin: 0;
          letter-spacing: -0.2px;
        }
        .login-subtitle {
          font-size: 13px;
          color: #8a90a8;
          margin: 4px 0 0;
        }
        .login-field {
          margin-bottom: 18px;
        }
        .login-label {
          display: block;
          font-size: 12.5px;
          font-weight: 600;
          color: #4a4f66;
          margin-bottom: 6px;
          letter-spacing: 0.2px;
        }
        .login-input {
          display: block;
          width: 100%;
          padding: 12px 14px;
          font-size: 15px;
          color: #10142a;
          border: 1.5px solid #e3e5f0;
          background: #f9f9fc;
          border-radius: 10px;
          box-sizing: border-box;
          transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
        }
        .login-input:focus {
          outline: none;
          border-color: #3c4faa;
          background: #fff;
          box-shadow: 0 0 0 4px rgba(60, 79, 170, 0.12);
        }
        .login-error {
          background: #fdecec;
          border: 1px solid #f6c6c6;
          color: #b3261e;
          font-size: 13px;
          padding: 9px 12px;
          border-radius: 8px;
          margin-bottom: 16px;
        }
        .login-button {
          width: 100%;
          padding: 13px 12px;
          font-size: 15px;
          font-weight: 600;
          color: #fff;
          background: linear-gradient(135deg, #232c52, #3c4faa);
          border: none;
          border-radius: 10px;
          cursor: pointer;
          letter-spacing: 0.2px;
          box-shadow: 0 8px 18px rgba(60, 79, 170, 0.3);
          transition: transform 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease;
        }
        .login-button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 10px 22px rgba(60, 79, 170, 0.4);
        }
        .login-button:disabled {
          opacity: 0.7;
          cursor: default;
        }
        .login-footer {
          text-align: center;
          font-size: 11.5px;
          color: #a6abc0;
          margin-top: 22px;
        }
      `}</style>

      <div className="login-card">
        <div className="login-logo-wrap">
          <div className="login-logo-badge">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/tls-logo.svg" alt="TLS" />
          </div>
          <h1 className="login-title">TLS &mdash; Presales CRM</h1>
          <p className="login-subtitle">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="login-field">
            <label className="login-label" htmlFor="login-name">Name</label>
            <input
              id="login-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="login-input"
              autoFocus
              autoComplete="username"
            />
          </div>
          <div className="login-field">
            <label className="login-label" htmlFor="login-pin">PIN</label>
            <input
              id="login-pin"
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="login-input"
              autoComplete="current-password"
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" disabled={loading} className="login-button">
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <p className="login-footer">Unischooly &middot; Presales CRM</p>
      </div>
    </div>
  );
}
