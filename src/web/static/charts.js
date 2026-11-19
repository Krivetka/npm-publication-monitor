// SVG charts as Preact components, geometry kept in pure functions (tested):
// columns ≤ 24 px with rounded tops, hairline grid, a tooltip on every column;
// a pulse sparkline; the version timeline (beeswarm on a time axis).

import { html } from 'htm/preact';
import * as f from './format.js';

export function niceMax(max) {
  if (max <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= max) return m * pow;
  return 10 * pow;
}

const tick = (n) => (n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : String(+n.toFixed(1)));

export function columnPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`;
}

// Geometry of a column chart: returns bars, ticks, labels in a 560×132 box.
export function columnGeometry(points, { startAt = null, labelEvery = 6 } = {}) {
  const W = 560, H = 132, L = 40, R = 4, T = 8, B = 20;
  const plotW = W - L - R, plotH = H - T - B;
  const rawMax = Math.max(0, ...points.map((p) => p.value));
  const max = niceMax(rawMax);
  const slot = plotW / Math.max(1, points.length);
  const barW = Math.max(1, Math.min(24, slot - 2));
  const y = (v) => T + plotH - (v / max) * plotH;
  const half = max / 2;
  const ticks = (Number.isInteger(half) || max >= 5 ? [0, half, max] : [0, max]).map((v) => ({ v, y: y(v), label: tick(v) }));
  const bars = points.map((p, i) => {
    const x0 = L + i * slot;
    const h = Math.max((p.value / max) * plotH, p.value > 0 ? 1 : 0);
    return { i, x0, slot, bx: x0 + (slot - barW) / 2, w: barW, h, y: T + plotH - h, label: p.label, value: p.value, tickLabel: i % labelEvery === 0 ? p.label.slice(-5) : null };
  });
  let last = -1;
  points.forEach((p, i) => { if (p.value > 0) last = i; });
  const marker = startAt !== null && startAt > 0 && startAt < points.length ? L + startAt * slot : null;
  return { W, H, L, T, plotW, plotH, max, rawMax, slot, ticks, bars, last, marker, y };
}

export function ColumnChart({ title, points, startAt = null, labelEvery = 6 }) {
  const g = columnGeometry(points, { startAt, labelEvery });
  const lastBar = g.last >= 0 ? g.bars[g.last] : null;
  return html`<figure class="chart panel">
    <figcaption>${title}</figcaption>
    <svg viewBox="0 0 ${g.W} ${g.H}" role="img" aria-label=${title}>
      ${g.ticks.map((t, i) => html`<line class=${i === 0 ? 'axis' : 'grid'} x1=${g.L} x2=${g.W - 4} y1=${t.y} y2=${t.y}/><text class="tick" x=${g.L - 6} y=${t.y + 4} text-anchor="end">${t.label}</text>`)}
      ${g.marker !== null && html`<line class="marker" x1=${g.marker} x2=${g.marker} y1=${g.T} y2=${g.T + g.plotH}/><text class="tick" x=${g.marker - 6} y=${g.T + g.plotH - 8} text-anchor="end">observation start</text>`}
      ${g.bars.map((b) => html`<g class="col" tabindex="0"><title>${b.label} — ${f.int(b.value)}</title><rect class="hit" x=${b.x0} y=${g.T} width=${b.slot} height=${g.plotH}/>${b.h > 0 && html`<path class="bar" d=${columnPath(b.bx, b.y, b.w, b.h)}/>`}</g>${b.tickLabel !== null && html`<text class="tick" x=${b.x0 + b.slot / 2} y=${g.H - 5} text-anchor="middle">${b.tickLabel}</text>`}`)}
      ${lastBar && html`<text class="value" x=${Math.min(lastBar.bx + lastBar.w / 2, g.W - 16)} y=${Math.max(g.T + 9, lastBar.y - 4)} text-anchor="middle">${f.int(lastBar.value)}</text>`}
      ${g.rawMax === 0 && html`<text class="tick" x=${g.L + g.plotW / 2} y=${g.T + g.plotH / 2} text-anchor="middle">none in this range</text>`}
    </svg>
  </figure>`;
}

// Sparkline geometry: path over 600×120, baseline 110, top 10.
export function sparkGeometry(values) {
  const W = 600, top = 10, base = 110;
  if (values.length < 2) return null;
  const max = niceMax(Math.max(...values) * 1.1);
  const x = (i) => +(i * (W / (values.length - 1))).toFixed(1);
  const y = (v) => +(base - (v / max) * (base - top)).toFixed(1);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
  const mid = Math.round(max / 2);
  return { W, base, max, mid, midY: y(mid), lastY: y(values[values.length - 1]), line, area: `${line}L${W},${base}L0,${base}Z` };
}

export function Sparkline({ values, aria }) {
  const g = sparkGeometry(values);
  if (!g) return html`<p class="band-muted">No data for the last hour yet.</p>`;
  return html`<div class="pulse-plot">
    <svg viewBox="0 0 ${g.W} 120" preserveAspectRatio="none" role="img" aria-label=${aria}>
      <line class="p-grid" x1="0" x2=${g.W} y1=${g.midY} y2=${g.midY} vector-effect="non-scaling-stroke"/>
      <line class="p-axis" x1="0" x2=${g.W} y1=${g.base} y2=${g.base} vector-effect="non-scaling-stroke"/>
      <path class="p-area" d=${g.area}/>
      <path class="p-line" d=${g.line} vector-effect="non-scaling-stroke"/>
    </svg>
    <span class="p-label" style="top:calc(${((g.midY / 120) * 100).toFixed(1)}% - 16px)">${g.mid}</span>
    <span class="p-dot" style="top:calc(${((g.lastY / 120) * 100).toFixed(1)}% - 5px)" aria-hidden="true"></span>
  </div>`;
}

// Timeline layout: points {version, t(ms), kind}; event dots are placed last (on top).
export function timelineLayout(points, gap = null) {
  const W = 1120, X0 = 40, X1 = 1090, AXIS = 140, STEP = 7.6, MAX_LEVELS = 15;
  if (points.length === 0) return null;
  const tMin = Math.min(...points.map((p) => p.t));
  const tMax = Math.max(...points.map((p) => p.t));
  const span = Math.max(tMax - tMin, 86_400_000);
  const pad = span * 0.02;
  const d0 = tMin - pad, d1 = tMax + pad;
  const x = (t) => +(X0 + ((t - d0) / (d1 - d0)) * (X1 - X0)).toFixed(1);
  const ticks = [];
  const years = span / (365.25 * 86_400_000);
  if (years >= 1.5) {
    const stepY = Math.max(1, Math.ceil(years / 7));
    for (let yr = new Date(d0).getUTCFullYear() + 1; ; yr += stepY) {
      const t = Date.UTC(yr, 0, 1);
      if (t > d1) break;
      ticks.push({ x: x(t), label: String(yr) });
    }
  } else {
    const months = Math.max(1, Math.ceil(span / (30.44 * 86_400_000) / 7));
    const start = new Date(d0);
    for (let m = start.getUTCMonth() + 1, yr = start.getUTCFullYear(); ; m += months) {
      const t = Date.UTC(yr, m, 1);
      if (t > d1) break;
      const dt = new Date(t);
      ticks.push({ x: x(t), label: `${String(dt.getUTCMonth() + 1).padStart(2, '0')}.${dt.getUTCFullYear()}` });
    }
  }
  const placed = [];
  const dots = [];
  const ordered = [...points].sort((p, q) => (p.kind === 'event' ? 1 : 0) - (q.kind === 'event' ? 1 : 0) || p.t - q.t);
  for (const p of ordered) {
    const px = x(p.t);
    let py = AXIS - 8;
    let level = 0;
    while (level < MAX_LEVELS && placed.some((o) => Math.hypot(o.x - px, o.y - py) < STEP)) { py -= STEP; level++; }
    placed.push({ x: px, y: py });
    dots.push({ x: px, y: +py.toFixed(1), r: p.kind === 'event' ? 4.5 : 3.5, kind: p.kind, version: p.version, t: p.t });
  }
  let bracket = null;
  if (gap && x(gap.to) - x(gap.from) > 60) bracket = { a: x(gap.from) + 4, b: x(gap.to) - 4, label: gap.label };
  return { W, X0, X1, AXIS, ticks, dots, bracket };
}

export function VersionTimeline({ points, gap, aria }) {
  const g = timelineLayout(points, gap);
  if (!g) return null;
  return html`<svg class="timeline" viewBox="0 0 ${g.W} 168" role="img" aria-label=${aria}>
    <line class="axis" x1=${g.X0} x2=${g.X1} y1=${g.AXIS} y2=${g.AXIS}/>
    ${g.ticks.map((t) => html`<line class="axis" x1=${t.x} x2=${t.x} y1=${g.AXIS} y2=${g.AXIS + 5}/><text class="tick" x=${t.x} y=${g.AXIS + 20} text-anchor="middle">${t.label}</text>`)}
    ${g.bracket && html`<path class="bracket" d="M${g.bracket.a},118V112H${g.bracket.b}V118"/><text class="t-note strong" x=${(g.bracket.a + g.bracket.b) / 2} y="104" text-anchor="middle">${g.bracket.label}</text>`}
    ${g.dots.map((d) => html`<circle class="dot ${d.kind}" cx=${d.x} cy=${d.y} r=${d.r}><title>${d.version} — ${new Date(d.t).toISOString().slice(0, 10)}</title></circle>`)}
  </svg>`;
}
