// Formatting for the UI: times in the server time zone, English locale (mirrors src/web/format.ts).

const TZ = (typeof document !== 'undefined' && document.documentElement.dataset.tz) || 'Europe/Warsaw';

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const shortFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const intFmt = new Intl.NumberFormat('en-US');

export const tz = TZ;

const toDate = (d) => (d === null || d === undefined ? null : d instanceof Date ? d : new Date(d));
const valid = (x) => x && !Number.isNaN(x.getTime());
// en-GB joins date and time with ", " and uses "/" — normalise to "dd.mm hh:mm:ss"
const tidy = (s) => s.replace(/\//g, '.').replace(', ', ' ');

export function time(d) {
  const x = toDate(d);
  return valid(x) ? tidy(timeFmt.format(x)) : '—';
}
export function clock(d) {
  const x = toDate(d);
  return valid(x) ? clockFmt.format(x) : '—';
}
export function date(d) {
  const x = toDate(d);
  return valid(x) ? tidy(dateFmt.format(x)) : '—';
}
export function dateTime(d) {
  const x = toDate(d);
  return valid(x) ? tidy(shortFmt.format(x)) : '—';
}
export function hour(d) {
  const x = toDate(d);
  return valid(x) ? tidy(hourFmt.format(x)) : '—';
}
export function ago(d, now = Date.now()) {
  const x = toDate(d);
  if (!valid(x)) return '—';
  const s = Math.round((now - x.getTime()) / 1000);
  if (s < 0) return 'just now';
  if (s < 90) return `${s} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172_800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}
export const int = (n) => (n === null || n === undefined ? '—' : intFmt.format(Number(n)));
export function compact(n) {
  if (Math.abs(n) < 10_000) return intFmt.format(n);
  if (Math.abs(n) < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
export function pct(part, whole) {
  if (!whole) return '—';
  const v = (100 * part) / whole;
  return `${v < 1 ? v.toFixed(2) : v.toFixed(1)}%`;
}
export function bytes(n) {
  if (n === null || n === undefined) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
export const score = (n) => (n === null || n === undefined ? '—' : String(Math.round(n * 10) / 10));
