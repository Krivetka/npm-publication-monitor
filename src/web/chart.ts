// Inline SVG charts, server-rendered.
// Columns ≤ 24 px with a rounded top, hairline grid, a tooltip on every mark;
// colours come from theme CSS variables (light and dark are chosen separately).

import { esc, html, type Raw, raw } from './html.ts';

export interface Point {
  label: string;
  value: number;
}

const fmt = new Intl.NumberFormat('en-US');

// Upper bound of the scale: a "round" number not below the maximum.
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}

const tick = (n: number): string =>
  n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : String(+n.toFixed(1));

function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`;
}

export interface ColumnOptions {
  startAt?: number | null; // fractional column index where observation started
  labelEvery?: number;
}

export function columnChart(title: string, points: Point[], opts: ColumnOptions = {}): Raw {
  const W = 560;
  const H = 132;
  const L = 40;
  const R = 4;
  const T = 8;
  const B = 20;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const rawMax = Math.max(0, ...points.map((p) => p.value));
  const max = niceMax(rawMax);
  const slot = plotW / Math.max(1, points.length);
  const barW = Math.max(1, Math.min(24, slot - 2));
  const y = (v: number) => T + plotH - (v / max) * plotH;
  const every = opts.labelEvery ?? 6;
  const half = max / 2;
  const ticks = Number.isInteger(half) || max >= 5 ? [0, half, max] : [0, max];

  let svg = ticks
    .map((v, i) => `<line class="${i === 0 ? 'axis' : 'grid'}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${tick(v)}</text>`)
    .join('');

  if (opts.startAt !== null && opts.startAt !== undefined && opts.startAt > 0 && opts.startAt < points.length) {
    const sx = L + opts.startAt * slot;
    svg += `<line class="marker" x1="${sx}" x2="${sx}" y1="${T}" y2="${T + plotH}"/>`;
    svg += `<text class="tick" x="${sx - 6}" y="${T + plotH - 8}" text-anchor="end">observation start</text>`;
  }

  let lastIdx = -1;
  points.forEach((p, i) => {
    const x0 = L + i * slot;
    const bx = x0 + (slot - barW) / 2;
    const h = Math.max((p.value / max) * plotH, p.value > 0 ? 1 : 0);
    if (p.value > 0) lastIdx = i;
    svg += `<g class="col" tabindex="0"><title>${esc(p.label)} — ${fmt.format(p.value)}</title><rect class="hit" x="${x0}" y="${T}" width="${slot}" height="${plotH}"/>`;
    if (h > 0) svg += `<path class="bar" d="${columnPath(bx, T + plotH - h, barW, h)}"/>`;
    svg += '</g>';
    if (i % every === 0) svg += `<text class="tick" x="${x0 + slot / 2}" y="${H - 5}" text-anchor="middle">${esc(p.label.slice(-5))}</text>`;
  });
  if (lastIdx >= 0) {
    const p = points[lastIdx]!;
    svg += `<text class="value" x="${L + lastIdx * slot - 4}" y="${Math.max(T + 10, y(p.value) + 8)}" text-anchor="end">${fmt.format(p.value)}</text>`;
  }
  if (rawMax === 0) svg += `<text class="tick" x="${L + plotW / 2}" y="${T + plotH / 2}" text-anchor="middle">none in 48 hours</text>`;

  return html`<figure class="chart panel">
    <figcaption>${title}</figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">${raw(svg)}</svg>
  </figure>`;
}

// Feed pulse: a line with a fill across the full container width.
export function sparkline(values: number[], aria: string): Raw {
  if (values.length < 2) return html`<p class="band-muted">No data for the last hour yet.</p>`;
  const W = 600;
  const top = 10;
  const base = 110;
  const max = niceMax(Math.max(...values) * 1.1);
  const x = (i: number) => +(i * (W / (values.length - 1))).toFixed(1);
  const y = (v: number) => +(base - (v / max) * (base - top)).toFixed(1);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
  const mid = Math.round(max / 2);
  const last = values.at(-1)!;
  return html`<div class="pulse-plot">
    <svg viewBox="0 0 ${W} 120" preserveAspectRatio="none" role="img" aria-label="${aria}">
      <line class="p-grid" x1="0" x2="${W}" y1="${y(mid)}" y2="${y(mid)}" vector-effect="non-scaling-stroke"/>
      <line class="p-axis" x1="0" x2="${W}" y1="${base}" y2="${base}" vector-effect="non-scaling-stroke"/>
      <path class="p-area" d="${line}L${W},${base}L0,${base}Z"/>
      <path class="p-line" d="${line}" vector-effect="non-scaling-stroke"/>
    </svg>
    <span class="p-label" style="top:calc(${((y(mid) / 120) * 100).toFixed(1)}% - 16px)">${mid}</span>
    <span class="p-dot" style="top:calc(${((y(last) / 120) * 100).toFixed(1)}% - 5px)" aria-hidden="true"></span>
  </div>`;
}

export interface TimelinePoint {
  version: string;
  t: number; // ms
  kind: 'pub0' | 'pub1' | 'other' | 'removed' | 'event';
}

// Version timeline: every version is a dot on the time axis; versions of the same period
// stack upwards, event versions are drawn on top, larger and red.
export function versionTimeline(points: TimelinePoint[], gap: { from: number; to: number; label: string } | null, aria: string): Raw {
  if (points.length === 0) return html``;
  const W = 1120;
  const X0 = 40;
  const X1 = 1090;
  const AXIS = 140;
  const STEP = 7.6;
  const MAX_LEVELS = 15;
  const tMin = Math.min(...points.map((p) => p.t));
  const tMax = Math.max(...points.map((p) => p.t));
  const span = Math.max(tMax - tMin, 86_400_000);
  const pad = span * 0.02;
  const d0 = tMin - pad;
  const d1 = tMax + pad;
  const x = (t: number) => +(X0 + ((t - d0) / (d1 - d0)) * (X1 - X0)).toFixed(1);

  let svg = `<line class="axis" x1="${X0}" x2="${X1}" y1="${AXIS}" y2="${AXIS}"/>`;
  const years = span / (365.25 * 86_400_000);
  if (years >= 1.5) {
    const stepY = Math.max(1, Math.ceil(years / 7));
    for (let yr = new Date(d0).getUTCFullYear() + 1; ; yr += stepY) {
      const t = Date.UTC(yr, 0, 1);
      if (t > d1) break;
      svg += `<line class="axis" x1="${x(t)}" x2="${x(t)}" y1="${AXIS}" y2="${AXIS + 5}"/><text class="tick" x="${x(t)}" y="${AXIS + 20}" text-anchor="middle">${yr}</text>`;
    }
  } else {
    const months = Math.max(1, Math.ceil((span / (30.44 * 86_400_000)) / 7));
    const start = new Date(d0);
    for (let m = start.getUTCMonth() + 1, yr = start.getUTCFullYear(); ; m += months) {
      const t = Date.UTC(yr, m, 1);
      if (t > d1) break;
      const dt = new Date(t);
      svg += `<line class="axis" x1="${x(t)}" x2="${x(t)}" y1="${AXIS}" y2="${AXIS + 5}"/><text class="tick" x="${x(t)}" y="${AXIS + 20}" text-anchor="middle">${String(dt.getUTCMonth() + 1).padStart(2, '0')}.${dt.getUTCFullYear()}</text>`;
    }
  }

  if (gap && x(gap.to) - x(gap.from) > 60) {
    const a = x(gap.from) + 4;
    const b = x(gap.to) - 4;
    svg += `<path class="bracket" d="M${a},118V112H${b}V118"/><text class="t-note strong" x="${(a + b) / 2}" y="104" text-anchor="middle">${esc(gap.label)}</text>`;
  }

  const placed: { x: number; y: number }[] = [];
  const dots: string[] = [];
  const ordered = [...points].sort((p, q) => (p.kind === 'event' ? 1 : 0) - (q.kind === 'event' ? 1 : 0) || p.t - q.t);
  for (const p of ordered) {
    const px = x(p.t);
    let py = AXIS - 8;
    let level = 0;
    while (level < MAX_LEVELS && placed.some((o) => Math.hypot(o.x - px, o.y - py) < STEP)) {
      py -= STEP;
      level++;
    }
    placed.push({ x: px, y: py });
    const r = p.kind === 'event' ? 4.5 : 3.5;
    dots.push(`<circle class="dot ${p.kind}" cx="${px}" cy="${py.toFixed(1)}" r="${r}"><title>${esc(p.version)} — ${new Date(p.t).toISOString().slice(0, 10)}</title></circle>`);
  }
  svg += dots.join('');
  return html`<svg class="timeline" viewBox="0 0 ${W} 168" role="img" aria-label="${aria}">${raw(svg)}</svg>`;
}
