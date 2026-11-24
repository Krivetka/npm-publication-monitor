// Statistics: funnel totals, hourly charts and tables for a selectable range.

import { html } from 'htm/preact';
import { api } from '../api.js';
import { ErrorBox, Loading, useAsync } from '../components.js';
import * as f from '../format.js';
import { Page } from '../layout.js';
import { buildQuery } from '../router.js';
import { FeatureHits, HourlyCharts, HourlyTable, SourceUsage, useStatus } from './overview.js';

const RANGES = [
  ['24', '24 h'],
  ['48', '48 h'],
  ['168', '7 days'],
  ['720', '30 days'],
];

export function StatsView({ query, nav }) {
  const hours = RANGES.some(([h]) => h === query.hours) ? Number(query.hours) : 48;
  const status = useStatus();
  const data = useAsync(async () => {
    const [totals, hourly, features, usage] = await Promise.all([api.totals(hours), api.hourly(hours), api.featureCounts(hours), api.sourceUsage(hours)]);
    return { totals, hourly, features, usage };
  }, [hours]);
  const t = data.data?.totals;
  const label = RANGES.find(([h]) => Number(h) === hours)[1];
  const hero = html`
    <div class="row-between">
      <div><h1>Statistics</h1><p class="lead">Funnel, hourly counts, feature hits and source requests for the selected range.</p></div>
      <div class="range" role="group" aria-label="Range">${RANGES.map(([h, l]) => html`<a class="fpill" key=${h} href=${nav.href(`/stats${buildQuery({ hours: h === '48' ? null : h })}`)} aria-current=${Number(h) === hours ? 'true' : null}>${l}</a>`)}</div>
    </div>
    ${
      t &&
      html`<div class="funnel">
      ${[
        ['Feed events', t.processed],
        ['Stage 1 hits', t.flagged],
        ['Candidates', t.candidates],
        ['Enriched', t.enriched],
        ['Alerts', t.alerts],
      ].map(
        ([l, v]) => html`<div class="step" key=${l}><div class="lbl"><span>${l}</span></div><div class="val">${f.int(v)}</div><div class="note">${l === 'Feed events' ? `in ${label}` : `${f.pct(v, t.processed)} of the feed`}</div></div>`,
      )}
    </div>`
    }`;
  return html`<${Page} hero=${hero}>
    ${data.error && html`<${ErrorBox} error=${data.error} retry=${data.reload} />`}
    ${data.loading && !data.data && html`<${Loading} />`}
    ${
      data.data &&
      html`
      <section aria-labelledby="h-h"><h2 id="h-h">Hourly, ${label}</h2>
        <${HourlyCharts} hours=${data.data.hourly} journalFirst=${status?.journal?.first} />
        <${HourlyTable} hours=${data.data.hourly} />
      </section>
      <div class="cols">
        <section class="grow-wide"><h2>Feature hits, ${label}</h2><${FeatureHits} features=${data.data.features} /></section>
        <section><h2>Source requests, ${label}</h2><${SourceUsage} usage=${data.data.usage} totals=${t} /></section>
      </div>`
    }
  </${Page}>`;
}
