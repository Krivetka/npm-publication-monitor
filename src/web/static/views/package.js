// Package page: every journal event of one package, plus the maintainer-set history.

import { html } from 'htm/preact';
import { api } from '../api.js';
import { Empty, ErrorBox, EventTable, Loading, useAsync } from '../components.js';
import * as f from '../format.js';
import { Page } from '../layout.js';

export function MaintainerHistory({ rows }) {
  if (!rows || rows.length === 0) return null;
  return html`<section aria-labelledby="mh-h"><h2 id="mh-h">Maintainer set history</h2>
    <div class="panel scroll"><table>
      <tr><th>Observed</th><th>Maintainers</th><th>Added</th><th>Removed</th></tr>
      ${rows.map((m) => html`<tr key=${m.seq}><td class="nowrap">${f.time(m.observed_at)}</td><td>${m.maintainers.join(', ')}</td><td>${(m.added ?? []).join(', ') || '—'}</td><td>${(m.removed ?? []).join(', ') || '—'}</td></tr>`)}
    </table></div></section>`;
}

export function PackageView({ name }) {
  const data = useAsync(async () => {
    const [events, maintainers] = await Promise.all([
      api.packageEvents(name, 200).catch((e) => { if (e.status === 404) return { items: [] }; throw e; }),
      api.maintainerHistory(name).catch(() => []),
    ]);
    return { events: events.items, maintainers };
  }, [name]);
  const n = data.data?.events.length ?? 0;
  const hero = html`<div><h1>${name}</h1><p class="lead">Journal events of the package${n ? ` — the latest ${f.int(n)}` : ''} ·
    <a href=${`https://www.npmjs.com/package/${name}`} rel="noreferrer">npmjs.com</a> · <a href=${`https://deps.dev/npm/${encodeURIComponent(name)}`} rel="noreferrer">deps.dev</a></p></div>`;
  return html`<${Page} hero=${hero}>
    ${data.error && html`<${ErrorBox} error=${data.error} retry=${data.reload} />`}
    ${data.loading && html`<${Loading} />`}
    ${data.data && html`<section>
      ${n === 0 ? html`<${Empty} text="No events of this package in the journal — it has not changed since observation started." />` : html`<${EventTable} rows=${data.data.events} mode="stage1" minWidth=${760} />`}
    </section>
    <${MaintainerHistory} rows=${data.data.maintainers} />`}
  </${Page}>`;
}
