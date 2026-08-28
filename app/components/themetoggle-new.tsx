'use client';

import { useEffect, useState } from 'react';

// Small light/dark switch. The no-flash inline script in layout.tsx already
// applies the saved theme before paint — this just keeps the icon in sync
// and writes back to localStorage + <html data-theme> when clicked.
export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'dark' : 'light');
  }, []);

  function toggle() {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('tls-theme', next);
    } catch {
      // Private/incognito mode can block localStorage — the toggle still
      // works for this page view, it just won't be remembered next time.
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
      style={{
        width: 38,
        height: 38,
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--card-bg)',
        border: '1px solid var(--input-border)',
        borderRadius: 8,
        cursor: 'pointer',
        fontSize: 16,
        flexShrink: 0,
      }}
    >
      {theme === 'light' ? '🌙' : '☀️'}
    </button>
  );
}
