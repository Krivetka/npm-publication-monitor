// Shared UI pieces: chips, meters, verdicts, tiles, tables, async state.

import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { BASE } from './api.js';
import * as f from './format.js';
import { Icon } from './icons.js';
import { KIND_NAMES, featureValue, labelOf } from './labels.js';

export const href = (to) => `${BASE}${to}`;
export const eventHref = (seq) => href(`/event/${seq}`);
export const packageHref = (name) => href(`/package/${encodeURIComponent(name)}`);

// Run an async loader when deps change; returns { data, error, loading, reload }.
export function useAsync(loader, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(loader)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => { alive = false; };
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

export function LaneIcon({ lane, size = 16 }) {
  return html`<${Icon} name=${lane} size=${size} />`;
}

export function Chips({ features, withValue = false }) {
  return (features ?? []).map((x) => html`<span class="chip" title=${labelOf(x.id).hint} key=${x.id}><${LaneIcon} lane=${x.lane} size=${13} />${labelOf(x.id).title}${withValue && html` <span class="cv">${featureValue(x)}</span>`}</span>`);
}

export function Meter({ value, scaleMax, threshold, hot = false }) {
  const max = Math.max(scaleMax, value);
  return html`<div class="meter"><span class="mv">${f.score(value)}</span><div class="track">
    <div class=${`fill${hot ? ' hot' : ''}`} style="width:${((value / max) * 100).toFixed(1)}%"></div>
    <div class="tickm" style="left:${((threshold / max) * 100).toFixed(1)}%" aria-hidden="true"></div></div></div>`;
}

export function Verdict({ row }) {
  const s1 = row.stage1, s2 = row.stage2;
  if (s2) return s2.alert
    ? html`<span class="verdict-s bad"><${Icon} name="alert" size=${14} stroke=${2.4} />alert</span>`
    : html`<span class="verdict-s ok"><${Icon} name="check" size=${14} stroke=${2.6} />no alert</span>`;
  if (s1?.candidate) return html`<span class="verdict-s wait"><${Icon} name="clock" size=${14} />awaiting enrichment</span>`;
  if (s1) return html`<span class="verdict-s wait">did not pass</span>`;
  return html`<span class="verdict-s wait">—</span>`;
}

export function PipeTile({ name, state, main, note }) {
  const label = state === 'ok' ? 'running' : state === 'warn' ? 'delayed' : 'problem';
  return html`<div class="panel tile"><div class="head"><span style="font-weight:600">${name}</span>
    <span class=${`state ${state}`}><${Icon} name=${state === 'ok' ? 'check' : 'alert'} size=${14} stroke=${2.4} />${label}</span></div>
    <div>${main}</div><div class="n">${note}</div></div>`;
}

export function Empty({ icon = null, title, text }) {
  return html`<div class="panel empty">${icon && html`<${Icon} name=${icon} size=${32} stroke=${1.7} />`}<div style="flex:1 1 320px">${title && html`<div style="font-weight:600">${title}</div>`}<div class="sub" style="margin:0">${text}</div></div></div>`;
}

export function Loading({ text = 'Loading…' }) {
  return html`<div class="loading">${text}</div>`;
}

export function ErrorBox({ error, retry }) {
  return html`<div class="panel error">Could not load: ${error?.message ?? String(error)}${retry && html` · <button class="btn-link" onClick=${retry}>retry</button>`}</div>`;
}

// Rows of events with their stage results — the shared table of the lists and the overview.
export function EventTable({ rows, mode = 'enriched', minWidth = 860 }) {
  return html`<div class="panel scroll"><table style="min-width:${minWidth}px">
    <tr><th>Time</th><th>Package</th>${mode === 'enriched' ? html`<th>Versions</th><th>Score</th><th>Verdict</th>` : html`<th>Features</th><th style="width:210px">Prescore</th><th>Next</th>`}${mode === 'enriched' && html`<th>Features</th>`}</tr>
    ${rows.map((r) => html`<${EventRow} row=${r} mode=${mode} key=${r.seq} />`)}
  </table></div>`;
}

export function EventRow({ row: r, mode }) {
  const s1 = r.stage1, s2 = r.stage2;
  const timeCell = html`<td class="nowrap"><a href=${eventHref(r.seq)}>${f.time(r.observed_at)}</a></td>`;
  const pkgCell = html`<td class="pkg"><a href=${packageHref(r.package)}>${r.package}</a></td>`;
  if (mode === 'enriched') {
    return html`<tr>
      ${timeCell}${pkgCell}
      <td class="mono" style="font-size:13px">${s2?.versions?.length ? s2.versions.join(', ') : html`<span class="muted">${KIND_NAMES[s2?.kind] ?? s2?.kind ?? '—'}</span>`}</td>
      <td>${s2 ? html`<${Meter} value=${s2.final_score} scaleMax=${10} threshold=${4} hot=${s2.alert} />` : '—'}</td>
      <td><${Verdict} row=${r} /></td>
      <td><${Chips} features=${[...(s1?.features ?? []).filter((x) => x.weight > 0 || x.id === 'watchlist'), ...(s2?.features ?? [])]} withValue=${true} /></td>
    </tr>`;
  }
  return html`<tr>
    ${timeCell}${pkgCell}
    <td><${Chips} features=${s1?.features ?? []} withValue=${true} /></td>
    <td>${s1 ? html`<${Meter} value=${s1.prescore} scaleMax=${3} threshold=${2} />` : '—'}</td>
    <td>${s2 ? html`<${Verdict} row=${r} /> <span class="muted">· ${f.score(s2.final_score)}</span>` : html`<${Verdict} row=${r} />`}</td>
  </tr>`;
}

export function Pager({ note, canNewer, canOlder, onNewer, onOlder }) {
  return html`<div class="pager"><span>${note}</span><span class="btns">
    <button class="btn-link" disabled=${!canNewer} onClick=${onNewer}>← Newer</button>
    <button class="btn-link" disabled=${!canOlder} onClick=${onOlder}>Older →</button></span></div>`;
}

export function Pill({ kind = 'ok', icon, children }) {
  return html`<p class=${`pill ${kind}`}>${icon && html`<${Icon} name=${icon} size=${16} stroke=${2.4} />`}${children}</p>`;
}
