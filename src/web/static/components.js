// Shared UI pieces: chips, meters, verdicts, tiles, tables, async state.

import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { BASE } from './api.js';
import { describeError } from './errors.js';
import * as f from './format.js';
import { Icon } from './icons.js';
import { featureValue, KIND_NAMES, labelOf } from './labels.js';

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
    return () => {
      alive = false;
    };
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
  const s1 = row.stage1,
    s2 = row.stage2;
  if (s2) return s2.alert ? html`<span class="verdict-s bad"><${Icon} name="alert" size=${14} stroke=${2.4} />alert</span>` : html`<span class="verdict-s ok"><${Icon} name="check" size=${14} stroke=${2.6} />no alert</span>`;
  if (s1?.candidate) return html`<span class="verdict-s wait"><${Icon} name="clock" size=${14} />awaiting enrichment</span>`;
  if (s1) return html`<span class="verdict-s wait">did not pass</span>`;
  return html`<span class="verdict-s wait">—</span>`;
}

export function PipeTile({ name, state, main, note }) {
  const label = state === 'ok' ? 'running' : state === 'warn' ? 'delayed' : 'problem';
  return html`<div class="panel tile"><div class="head"><span class="fw-600">${name}</span>
    <span class=${`state ${state}`}><${Icon} name=${state === 'ok' ? 'check' : 'alert'} size=${14} stroke=${2.4} />${label}</span></div>
    <div>${main}</div><div class="n">${note}</div></div>`;
}

export function Empty({ icon = null, title, text }) {
  return html`<div class="panel empty">${icon && html`<${Icon} name=${icon} size=${32} stroke=${1.7} />`}<div class="grow">${title && html`<div class="fw-600">${title}</div>`}<div class="sub m-0">${text}</div></div></div>`;
}

// Loading state of an asynchronous block: grey lines in the shape of the content to come.
export function Loading({ text = 'Loading…', lines = 4 }) {
  return html`<div class="panel skeleton" role="status" aria-live="polite"><span class="sr">${text}</span>${Array.from({ length: lines }, (_, i) => html`<div class="sk-line" key=${i} style=${`width:${[92, 78, 85, 64, 88, 71][i % 6]}%`}></div>`)}</div>`;
}

// Loading state of a whole page (a route whose module is still on its way).
export function PageSkeleton() {
  return html`<div class="band"><div class="wrap hero"><div class="sk-title" role="status"><span class="sr">Loading the page…</span></div></div></div><main class="wrap"><${Loading} lines=${6} /></main>`;
}

// Error state of an asynchronous block. The text depends on what failed (errors.js); a retry
// is offered only when repeating the request can help.
export function ErrorBox({ error, retry }) {
  const d = describeError(error);
  return html`<div class="panel error" role="alert"><strong>${d.title}.</strong> ${d.text}${retry && d.retry && html` <button type="button" class="btn-link" onClick=${retry}>Try again</button>`}</div>`;
}

// A labelled form field with its validation message. `error` is a string or null.
export function Field({ id, label, error = null, hint = null, children }) {
  return html`<div class=${`field${error ? ' invalid' : ''}`}><label for=${id}>${label}</label>${children}
    ${error ? html`<p class="field-error" id=${`${id}-error`} role="alert">${error}</p>` : hint && html`<p class="field-hint" id=${`${id}-hint`}>${hint}</p>`}</div>`;
}

// Rows of events with their stage results — the shared table of the lists and the overview.
export function EventTable({ rows, mode = 'enriched', minWidth = 860 }) {
  return html`<div class="panel scroll"><table style="min-width:${minWidth / 16}rem">
    <tr><th>Time</th><th>Package</th>${mode === 'enriched' ? html`<th>Versions</th><th>Score</th><th>Verdict</th>` : html`<th>Features</th><th class="col-prescore">Prescore</th><th>Next</th>`}${mode === 'enriched' && html`<th>Features</th>`}</tr>
    ${rows.map((r) => html`<${EventRow} row=${r} mode=${mode} key=${r.seq} />`)}
  </table></div>`;
}

export function EventRow({ row: r, mode }) {
  const s1 = r.stage1,
    s2 = r.stage2;
  const timeCell = html`<td class="nowrap"><a href=${eventHref(r.seq)}>${f.time(r.observed_at)}</a></td>`;
  const pkgCell = html`<td class="pkg"><a href=${packageHref(r.package)}>${r.package}</a></td>`;
  if (mode === 'enriched') {
    return html`<tr>
      ${timeCell}${pkgCell}
      <td class="mono fs-s">${s2?.versions?.length ? s2.versions.join(', ') : html`<span class="muted">${KIND_NAMES[s2?.kind] ?? s2?.kind ?? '—'}</span>`}</td>
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
