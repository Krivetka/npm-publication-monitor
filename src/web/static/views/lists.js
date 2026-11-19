// Alerts / Stage 2 / Stage 1 lists: cursor-paginated tables with filter pills in the band.

import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { api } from '../api.js';
import { Empty, ErrorBox, EventTable, Loading, Pager, useAsync } from '../components.js';
import * as f from '../format.js';
import { Icon } from '../icons.js';
import { labelOf, laneOf } from '../labels.js';
import { Page } from '../layout.js';
import { buildQuery } from '../router.js';

const PAGE = 50;

export function ListView({ kind, query, nav }) {
  const alertOnly = kind === 'alerts' || query.alert === '1';
  const minScore = Math.max(0, Number(String(query.min ?? '').replace(',', '.')) || 0);
  const feature = query.feature || null;
  const candidateOnly = query.candidate === '1';
  const before = query.before ? Number(query.before) : null;
  const [history, setHistory] = useState([]); // stack of `before` cursors for "Newer"
  const base = kind === 'stage1' ? '/stage1' : kind === 'alerts' ? '/alerts' : '/stage2';

  const data = useAsync(async () => {
    const params = { limit: PAGE, before: before ?? undefined };
    if (kind === 'stage1') { params.flagged = true; if (feature) params.feature = feature; if (candidateOnly) params.candidate = true; }
    else { params.min_score = minScore; if (alertOnly) params.alert = true; }
    const [list, counts] = await Promise.all([api.events(params), kind === 'stage1' ? api.featureCounts(24) : Promise.resolve([])]);
    return { list, counts };
  }, [kind, alertOnly, minScore, feature, candidateOnly, before]);

  const go = (q) => nav.go(`${base}${buildQuery(q)}`);
  const baseQuery = kind === 'stage1' ? { feature, candidate: candidateOnly ? 1 : null } : { alert: kind === 'stage2' && alertOnly ? 1 : null, min: minScore || null };
  const onOlder = () => {
    const nb = data.data?.list.next_before;
    if (nb === null || nb === undefined) return;
    setHistory((h) => [...h, before]);
    go({ ...baseQuery, before: nb });
  };
  const onNewer = () => {
    const h = [...history];
    const prev = h.pop();
    setHistory(h);
    go({ ...baseQuery, before: prev ?? null });
  };

  let hero;
  if (kind === 'stage1') {
    const s1 = (data.data?.counts ?? []).filter((x) => x.stage === 1);
    const total = s1.reduce((a, x) => a + x.count, 0);
    const link = (fe, cand) => `${base}${buildQuery({ feature: fe, candidate: cand ? 1 : null })}`;
    hero = html`
      <div><h1>Stage 1${feature && html` · ${labelOf(feature).title}`}</h1>
        <p class="lead">${feature ? labelOf(feature).hint : 'Events where at least one feature fired. Candidate threshold — prescore 2.'}</p></div>
      <div class="filters">
        <a class="fpill" href=${nav.href(link(null, candidateOnly))} aria-current=${feature === null ? 'true' : null}>All features <span class="c">${f.int(total)}</span></a>
        ${s1.map((x) => html`<a class="fpill" key=${x.id} href=${nav.href(link(x.id, candidateOnly))} aria-current=${x.id === feature ? 'true' : null}><${Icon} name=${laneOf(x.id)} size=${14} />${labelOf(x.id).title} <span class="c">${f.int(x.count)}</span></a>`)}
        <a class="fpill" href=${nav.href(link(feature, !candidateOnly))} aria-current=${candidateOnly ? 'true' : null} style="margin-left:auto">${candidateOnly && html`<${Icon} name="check" size=${14} stroke=${2.4} />`}candidates only</a>
      </div>
      <p class="band-muted">Counts are for the last 24 hours.</p>`;
  } else {
    const title = alertOnly ? 'Alerts' : 'Stage 2';
    const onMin = (e) => { e.preventDefault(); go({ ...baseQuery, min: String(new FormData(e.currentTarget).get('min') ?? '').trim() || null }); };
    hero = html`
      <div><h1>${title}</h1><p class="lead">${alertOnly ? 'Candidates whose final score reached the threshold of 4.' : 'Candidates after enrichment: final score, verdict and the fired features of both stages.'}</p></div>
      <div class="filters">
        <a class="fpill" href=${nav.href('/stage2')} aria-current=${!alertOnly ? 'true' : null}>All enriched</a>
        <a class="fpill" href=${nav.href('/alerts')} aria-current=${alertOnly ? 'true' : null}><${Icon} name="alert" size=${14} stroke=${2.2} />Alerts only</a>
        <form class="inline" onSubmit=${onMin}>
          <label for="min">score from</label><input id="min" type="text" name="min" value=${minScore || ''} inputmode="decimal" />
          <button class="btn-ghost" type="submit">Show</button>
        </form>
      </div>`;
  }

  const rows = data.data?.list.items ?? [];
  return html`<${Page} hero=${hero}>
    <section>
      ${data.error && html`<${ErrorBox} error=${data.error} retry=${data.reload} />`}
      ${data.loading && !data.data && html`<${Loading} />`}
      ${data.data && (rows.length === 0
        ? html`<${Empty} icon=${kind === 'stage1' ? null : 'shield'} text=${alertOnly ? 'No alerts.' : 'Nothing found.'} />`
        : html`<${EventTable} rows=${rows} mode=${kind === 'stage1' ? 'stage1' : 'enriched'} minWidth=${kind === 'stage1' ? 900 : 860} />`)}
      ${data.data && html`<${Pager} note=${kind === 'stage1' ? 'Bar — score on a scale to 3; the black tick is the candidate threshold of 2.' : 'Bar — score on a scale to 10; the black tick is the alert threshold of 4.'}
        canNewer=${history.length > 0 || before !== null} canOlder=${data.data.list.next_before !== null && data.data.list.next_before !== undefined} onNewer=${onNewer} onOlder=${onOlder} />`}
    </section>
  </${Page}>`;
}
