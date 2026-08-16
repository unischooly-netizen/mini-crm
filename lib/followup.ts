// Business-hours-aware "next follow-up" scheduling.
//
// Rule: when a call attempt comes back as one of the "didn't actually
// connect" statuses, the next follow-up is set to 2 hours later — but
// clamped into working hours: Mon-Sat 10:00-19:00 IST, Sunday off. If the
// +2h lands outside that window (too late, too early, or on a Sunday), it
// rolls forward to the next working day at 10:00.
//
// All arithmetic happens in an "IST-shifted" Date (a Date object whose UTC
// getters read out IST wall-clock values), which avoids needing a timezone
// library. The result is converted back to a real UTC instant only when
// asked for.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const BUSINESS_START_MIN = 10 * 60; // 10:00
const BUSINESS_END_MIN = 19 * 60; // 19:00

function toIstShifted(utcDate: Date): Date {
  return new Date(utcDate.getTime() + IST_OFFSET_MS);
}

function atTime(istShifted: Date, hour: number, minute: number): Date {
  const d = new Date(istShifted);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

function addDays(istShifted: Date, days: number): Date {
  const d = new Date(istShifted);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Returns { date: 'YYYY-MM-DD', time: 'HH:MM' } (24h) in IST for the given UTC instant. */
export function toIstDateTimeParts(utcDate: Date): { date: string; time: string } {
  const ist = toIstShifted(utcDate);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return { date: `${y}-${m}-${d}`, time: `${hh}:${mm}` };
}

/**
 * Given the moment a call attempt was logged (as a UTC Date), returns the
 * next-follow-up date/time (IST date + 24h time string) per the business
 * hours rule above.
 */
export function computeNextFollowup(triggerUtc: Date): { date: string; time: string } {
  let ist = toIstShifted(triggerUtc);
  ist = new Date(ist.getTime() + 2 * 60 * 60 * 1000); // +2 hours

  for (let guard = 0; guard < 14; guard++) {
    const dayOfWeek = ist.getUTCDay(); // 0 = Sunday
    const minutesOfDay = ist.getUTCHours() * 60 + ist.getUTCMinutes();

    if (dayOfWeek === 0) {
      ist = atTime(addDays(ist, 1), 10, 0);
      continue;
    }
    if (minutesOfDay > BUSINESS_END_MIN) {
      ist = atTime(addDays(ist, 1), 10, 0);
      continue;
    }
    if (minutesOfDay < BUSINESS_START_MIN) {
      ist = atTime(ist, 10, 0);
    }
    break;
  }

  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return { date: `${y}-${m}-${d}`, time: `${hh}:${mm}` };
}

/**
 * Subtracts N minutes from a plain wall-clock date+time (no timezone
 * conversion — both input and output are just IST-local values as typed/
 * stored, e.g. for "30 minutes before this meeting").
 */
export function subtractMinutes(dateStr: string, timeStr: string, minutes: number): { date: string; time: string } {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0));
  dt.setUTCMinutes(dt.getUTCMinutes() - minutes);
  const ny = dt.getUTCFullYear();
  const nm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const nd = String(dt.getUTCDate()).padStart(2, '0');
  const nhh = String(dt.getUTCHours()).padStart(2, '0');
  const nmm = String(dt.getUTCMinutes()).padStart(2, '0');
  return { date: `${ny}-${nm}-${nd}`, time: `${nhh}:${nmm}` };
}
