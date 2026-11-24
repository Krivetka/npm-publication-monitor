// Formatting for the UI: times in the server time zone (Europe/Warsaw), English locale.

const TZ = process.env.WEB_TZ || 'Europe/Warsaw';

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const shortFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const intFmt = new Intl.NumberFormat('en-US');

export const tz = TZ;

const toDate = (d: Date | string | null | undefined): Date | null => (d === null || d === undefined ? null : d instanceof Date ? d : new Date(d));

// en-GB joins date and time with ", " and uses "/" — normalise to "dd.mm hh:mm:ss"
const tidy = (s: string): string => s.replace(/\//g, '.').replace(', ', ' ');

// 14.10 13:29:18
export function time(d: Date | string | null | undefined): string {
  const x = toDate(d);
  return x && !Number.isNaN(x.getTime()) ? tidy(timeFmt.format(x)) : '—';
}

// 14.10.2026
export function date(d: Date | string | null | undefined): string {
  const x = toDate(d);
  return x && !Number.isNaN(x.getTime()) ? tidy(dateFmt.format(x)) : '—';
}

// 14.10.2026 13:29
export function dateTime(d: Date | string | null | undefined): string {
  const x = toDate(d);
  return x && !Number.isNaN(x.getTime()) ? tidy(shortFmt.format(x)) : '—';
}

// 14.10 13:00
export function hour(d: Date | string): string {
  return tidy(hourFmt.format(toDate(d)!));
}

export function ago(d: Date | string | null | undefined, now = Date.now()): string {
  const x = toDate(d);
  if (!x) return '—';
  const s = Math.round((now - x.getTime()) / 1000);
  if (s < 0) return 'just now';
  if (s < 90) return `${s} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172_800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

export const int = (n: number | string | null | undefined): string => (n === null || n === undefined ? '—' : intFmt.format(Number(n)));

// 1,284 / 12.9K / 4.2M
export function compact(n: number): string {
  if (Math.abs(n) < 10_000) return intFmt.format(n);
  if (Math.abs(n) < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function pct(part: number, whole: number): string {
  if (!whole) return '—';
  const v = (100 * part) / whole;
  return `${v < 1 ? v.toFixed(2) : v.toFixed(1)}%`;
}

export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const score = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : String(Math.round(n * 10) / 10));
