/**
 * Europe/Madrid wall-clock <-> unix seconds, using only Intl (no tz libraries).
 * Never depends on the server time zone.
 */

export const SALE_TIME_ZONE = 'Europe/Madrid';

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: SALE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Madrid wall-clock components for a UTC instant (ms). */
export function toMadridParts(utcMs: number): WallClock {
  const map: Record<string, number> = {};
  for (const p of partsFormatter.formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour === 24 ? 0 : map.hour,
    minute: map.minute,
    second: map.second,
  };
}

/** Offset of Madrid from UTC (ms) at a given UTC instant. */
function madridOffsetMs(utcMs: number): number {
  const p = toMadridParts(utcMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Madrid wall-clock time -> unix seconds. Handles DST (offset re-checked at the result). */
export function madridToUnix(w: WallClock): number {
  const naive = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const off1 = madridOffsetMs(naive - madridOffsetMs(naive));
  let utc = naive - off1;
  const off2 = madridOffsetMs(utc);
  if (off2 !== off1) utc = naive - off2;
  return Math.floor(utc / 1000);
}

/**
 * Parses `dd.mm.yyyy` (also accepts `/` or `-` separators and 1-digit day/month).
 * - 'start' -> 00:00:00 Madrid of that day
 * - 'end'   -> 23:59:59 Madrid of that day (inclusive end of day)
 * Returns null for malformed or non-existent dates.
 */
export function parseMadridDate(input: string, edge: 'start' | 'end'): number | null {
  const m = input.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) return null;
  return edge === 'start'
    ? madridToUnix({ year, month, day, hour: 0, minute: 0, second: 0 })
    : madridToUnix({ year, month, day, hour: 23, minute: 59, second: 59 });
}

const pad = (n: number) => String(n).padStart(2, '0');

/** unix seconds -> `dd.mm.yyyy hh:mm` in Madrid time. */
export function formatMadrid(unix: number): string {
  const p = toMadridParts(unix * 1000);
  return `${pad(p.day)}.${pad(p.month)}.${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** unix seconds -> `dd.mm.yyyy hh:mm:ss` in Madrid time. */
export function formatMadridWithSeconds(unix: number): string {
  const p = toMadridParts(unix * 1000);
  return `${pad(p.day)}.${pad(p.month)}.${p.year} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/**
 * Parses an exact wall-clock date+time in `Europe/Madrid`:
 * - `YYYY-MM-DD HH:MM` or `YYYY-MM-DD HH:MM:SS`
 * - `DD.MM.YYYY HH:MM` or `DD.MM.YYYY HH:MM:SS`
 * Returns unix seconds or null if malformed / invalid calendar date.
 */
export function parseMadridDateTime(input: string): number | null {
  const trimmed = input.trim();
  let year: number;
  let month: number;
  let day: number;
  let hour: number;
  let minute: number;
  let second: number;

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
    hour = Number(iso[4]);
    minute = Number(iso[5]);
    second = iso[6] !== undefined ? Number(iso[6]) : 0;
  } else {
    const dmy = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!dmy) return null;
    day = Number(dmy[1]);
    month = Number(dmy[2]);
    year = Number(dmy[3]);
    hour = Number(dmy[4]);
    minute = Number(dmy[5]);
    second = dmy[6] !== undefined ? Number(dmy[6]) : 0;
  }

  if (
    year < 2000 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) return null;

  return madridToUnix({ year, month, day, hour, minute, second });
}

