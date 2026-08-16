export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleString('en-US', { month: 'short' });
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

/** "18:00" (24h, as stored) -> "06:00 PM". Plain string formatting, no timezone math. */
export function formatTime12h(hhmm: string | null | undefined): string {
  if (!hhmm) return '';
  const [hStr, mStr] = hhmm.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  if (isNaN(h)) return hhmm;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
}

/** Combines a DATE ('YYYY-MM-DD') and a 24h time string into "16-Aug-2026 06:00 PM". */
export function formatDateTime(dateStr: string | null | undefined, timeStr: string | null | undefined): string {
  const d = formatDate(dateStr);
  const t = formatTime12h(timeStr);
  if (!d && !t) return '';
  if (!t) return d;
  if (!d) return t;
  return `${d} ${t}`;
}

/** Timestamptz column (e.g. last updated) -> "16-Aug-2026 06:00 PM" in IST. */
export function formatTimestampIST(ts: string | null | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const ist = new Date(d.getTime() + 5.5 * 60 * 60 * 1000);
  const day = String(ist.getUTCDate()).padStart(2, '0');
  const month = ist.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const year = ist.getUTCFullYear();
  let h = ist.getUTCHours();
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${day}-${month}-${year} ${String(h).padStart(2, '0')}:${mm} ${ampm}`;
}
