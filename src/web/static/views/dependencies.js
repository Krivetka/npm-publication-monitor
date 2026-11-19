// "My dependencies": the alerts on the packages of one consumer and their count per day.
// The list of names is read in the browser and kept in this browser only.

import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { api } from '../api.js';
import { Empty, ErrorBox, EventTable, Loading, useAsync } from '../components.js';
import { parseDependencyList } from '../deps.js';
import * as f from '../format.js';
import { Page } from '../layout.js';

const KEY = 'npm-monitor.dependencies';
const DAYS = 14;
const MAX = 10000;

function stored() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((n) => typeof n === 'string') : [];
  } catch { return []; }
}
function store(names) {
  try {
    if (names.length > 0) localStorage.setItem(KEY, JSON.stringify(names)); else localStorage.removeItem(KEY);
  } catch { /* private mode: the list lives for this page only */ }
}

function ListForm({ onList, onCancel }) {
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const submit = (source) => {
    const names = parseDependencyList(source);
    if (names.length === 0) return setError('No package name found. Paste a package-lock.json, a package.json or one name per line.');
    if (names.length > MAX) return setError(`The list has ${f.int(names.length)} names; the limit is ${f.int(MAX)}.`);
    setError(null);
    onList(names);
  };
  const onFile = async (e) => {
    const file = e.currentTarget.files?.[0];
    if (file) submit(await file.text());
  };
  return html`<section aria-labelledby="dep-h"><h2 id="dep-h">Dependency list</h2>
    <form class="panel dep-form" onSubmit=${(e) => { e.preventDefault(); submit(text); }}>
      <label for="dep-text">Paste a <span class="mono">package-lock.json</span>, a <span class="mono">package.json</span> or one package name per line</label>
      <textarea id="dep-text" rows="8" spellcheck="false" value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>
      <div class="dep-actions">
        <button class="btn" type="submit">Show alerts</button>
        <label class="btn secondary dep-file">Open a file<input type="file" accept=".json,.txt,application/json,text/plain" onChange=${onFile} /></label>
        ${onCancel && html`<button class="btn-link" type="button" onClick=${onCancel}>Cancel</button>`}
      </div>
      ${error && html`<p class="dep-error" role="alert">${error}</p>`}
      <p class="note">The file is read in this browser. Only the package names are sent to the monitor; they are not stored there.</p>
    </form>
  </section>`;
}

function PerDay({ days }) {
  const max = Math.max(1, ...days.map((d) => d.alerts));
  return html`<div class="panel scroll"><table class="dep-days">
    <tr><th>Day</th><th>Alerts</th><th aria-hidden="true"></th></tr>
    ${days.map((d) => html`<tr key=${d.day}><td class="mono">${d.day}</td><td class="num">${d.alerts}</td>
      <td aria-hidden="true"><span class="dep-bar" style=${`width:${Math.round((100 * d.alerts) / max)}%`}></span></td></tr>`)}
  </table></div>`;
}

export function DependenciesView() {
  const [names, setNames] = useState(stored);
  const [editing, setEditing] = useState(false);
  const data = useAsync(() => (names.length > 0 ? api.dependencyAlerts(names, DAYS) : Promise.resolve(null)), [names]);
  const setList = (list) => { store(list); setNames(list); setEditing(false); };

  const total = data.data ? data.data.days.reduce((a, d) => a + d.alerts, 0) : null;
  const hero = html`<div><h1>My dependencies</h1>
    <p class="lead">${names.length === 0
      ? 'Alerts on the packages you depend on. Give the list once; it stays in this browser.'
      : html`${f.int(names.length)} packages${total !== null && html` · ${f.int(total)} ${total === 1 ? 'alert' : 'alerts'} in ${DAYS} days (${(total / DAYS).toFixed(1)} a day)`}`}</p></div>
    ${names.length > 0 && html`<div class="filters">
      <button class="btn-ghost" type="button" onClick=${() => setEditing(true)}>Change the list</button>
      <button class="btn-ghost" type="button" onClick=${() => setList([])}>Forget the list</button>
    </div>`}`;

  return html`<${Page} hero=${hero}>
    ${(names.length === 0 || editing) && html`<${ListForm} onList=${setList} onCancel=${editing ? () => setEditing(false) : null} />`}
    ${names.length > 0 && !editing && html`
      ${data.error && html`<section><${ErrorBox} error=${data.error} retry=${data.reload} /></section>`}
      ${data.loading && !data.data && html`<section><${Loading} /></section>`}
      ${data.data && html`
        <section aria-labelledby="dep-list-h"><h2 id="dep-list-h">Alerts on these packages</h2>
          ${data.data.items.length === 0
            ? html`<${Empty} icon="shield" text=${`No alert on these packages in the last ${DAYS} days.`} />`
            : html`<${EventTable} rows=${data.data.items} mode="enriched" minWidth=${860} />`}
        </section>
        <section aria-labelledby="dep-days-h"><h2 id="dep-days-h">Alerts per day</h2><${PerDay} days=${data.data.days} /></section>`}`}
  </${Page}>`;
}
