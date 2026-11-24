// Overview: funnel, live pulse, pipeline status, hourly charts, latest alerts,
// feature hits, source requests, latest enriched.

import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { api, applyStage } from '../api.js';
import { ColumnChart, Sparkline } from '../charts.js';
import { Empty, ErrorBox, EventTable, href, Loading, Pill, PipeTile, useAsync } from '../components.js';
import { logError } from '../errors.js';
import * as f from '../format.js';
import { Icon } from '../icons.js';
import { LANE_LABELS, labelOf, laneOf, SOURCE_NAMES } from '../labels.js';
import { Page } from '../layout.js';
import { subscribe } from '../ws.js';

const logWidth = (n, max) => (n <= 0 || max <= 0 ? 0 : (Math.log10(n + 1) / Math.log10(max + 1)) * 100);
const stageState = (ok, warn) => (ok ? 'ok' : warn ? 'warn' : 'bad');

// Pipeline status: WS pushes it every 10 s; GET /status is the fallback and the first value.
export function useStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    api
      .status()
      .then(setStatus)
      .catch((e) => logError('overview: status', e));
    return subscribe((m) => {
      if (m.type === 'status') setStatus(m.status);
    });
  }, []);
  return status;
}

// Live pulse: start from GET /stats/pulse, then count WS events per minute.
function usePulse() {
  const [pulse, setPulse] = useState([]);
  useEffect(() => {
    api
      .pulse()
      .then((rows) => setPulse(rows.map((r) => ({ minute: new Date(r.minute).getTime(), n: r.n }))))
      .catch((e) => logError('overview: pulse', e));
    return subscribe((m) => {
      if (m.type !== 'event') return;
      const minute = Math.floor(new Date(m.event.observed_at).getTime() / 60_000) * 60_000;
      setPulse((p) => {
        const last = p[p.length - 1];
        if (last && last.minute === minute) return [...p.slice(0, -1), { minute, n: last.n + 1 }];
        if (last && minute < last.minute) return p;
        return [...p, { minute, n: 1 }].slice(-61);
      });
    });
  }, []);
  return pulse;
}

export function StatusPill({ status: s }) {
  if (!s) return html`<${Pill} kind="warn" icon="clock">Waiting for status…</${Pill}>`;
  const c = s.collector;
  const polledAgo = c ? (Date.now() - new Date(c.polled_at).getTime()) / 1000 : Infinity;
  const lag1 = s.stage1?.lag ?? Infinity;
  const problems = [];
  if (polledAgo > 120) problems.push(`collector silent, last poll ${f.ago(c?.polled_at)}`);
  if (lag1 > 5000) problems.push(`stage 1 is ${f.int(lag1)} events behind`);
  if (s.stage2.queue > 200) problems.push(`stage 2 queue: ${f.int(s.stage2.queue)}`);
  return problems.length === 0 ? html`<${Pill} kind="ok" icon="check">Pipeline running · polled ${f.ago(c?.polled_at)}</${Pill}>` : html`<${Pill} kind="warn" icon="alert">${problems.join(' · ')}</${Pill}>`;
}

export function PipelineTiles({ status: s }) {
  if (!s) return html`<${Loading} />`;
  const c = s.collector;
  const polledAgo = c ? (Date.now() - new Date(c.polled_at).getTime()) / 1000 : Infinity;
  const lag1 = s.stage1?.lag ?? Infinity;
  const lagC = c ? (c.lag ?? (c.head_seq !== null && c.head_seq !== undefined ? Math.max(0, c.head_seq - c.last_seq) : null)) : null;
  return html`<div class="grid-auto">
    <${PipeTile} name="Collector" state=${stageState(polledAgo < 60, polledAgo < 600)} main=${`Polled ${f.ago(c?.polled_at)}`} note=${`lag behind the feed head: ${lagC === null ? '—' : f.int(lagC)} seq`} />
    <${PipeTile} name="Stage 1" state=${stageState(lag1 < 500, lag1 < 5000)} main=${lag1 < 500 ? 'In step with the journal' : `${f.int(lag1)} events behind`} note=${`popular-package snapshot of ${s.popular?.snapshot ?? '—'}: ${f.int(s.popular?.names ?? 0)} names`} />
    <${PipeTile} name="Stage 2" state=${stageState(s.stage2.queue < 50, s.stage2.queue < 500)} main=${`${f.int(s.stage2.queue)} in queue`} note=${`last enrichment ${f.ago(s.stage2.last_at)}`} />
  </div>`;
}

export function HourlyCharts({ hours, journalFirst, titleSuffix = '' }) {
  let startAt = null;
  if (journalFirst && hours.length > 0) {
    const idx = (new Date(journalFirst).getTime() - new Date(hours[0].hour).getTime()) / 3_600_000;
    if (idx > 0 && idx < hours.length) startAt = idx;
  }
  const every = hours.length > 100 ? 24 : 6;
  const pts = (key) => hours.map((h) => ({ label: f.hour(h.hour), value: Number(h[key]) }));
  return html`<div class="grid-auto">
    <${ColumnChart} title=${`Feed events per hour${titleSuffix}`} points=${pts('processed')} startAt=${startAt} labelEvery=${every} />
    <${ColumnChart} title=${`Stage 2 candidates per hour${titleSuffix}`} points=${pts('candidates')} startAt=${startAt} labelEvery=${every} />
  </div>`;
}

export function HourlyTable({ hours }) {
  return html`<details class="panel raw"><summary>Hourly table</summary><div class="scroll"><table>
    <tr><th>Hour</th><th class="num">Events</th><th class="num">Candidates</th><th class="num">Share</th><th class="num">Enriched</th><th class="num">Alerts</th></tr>
    ${[...hours]
      .reverse()
      .filter((h) => h.processed > 0)
      .map(
        (h) =>
          html`<tr key=${h.hour}><td>${f.hour(h.hour)}</td><td class="num">${f.int(h.processed)}</td><td class="num">${f.int(h.candidates)}</td><td class="num">${f.pct(h.candidates, h.processed)}</td><td class="num">${f.int(h.enriched)}</td><td class="num">${f.int(h.alerts)}</td></tr>`,
      )}
  </table></div></details>`;
}

export function FeatureHits({ features }) {
  const featMax = Math.max(1, ...features.filter((x) => x.stage === 1).map((x) => x.count));
  return html`<div class="panel scroll"><table>
    <tr><th>Feature</th><th class="col-30">Share of stage 1 events</th><th class="num">Events</th></tr>
    ${features.length === 0 && html`<tr><td colspan="3" class="muted">No hits yet.</td></tr>`}
    ${features.map(
      (x) => html`<tr key=${`${x.stage}-${x.id}`}>
      <td><div class="feat"><span class="ibox"><${Icon} name=${laneOf(x.id)} /></span><div class="minw-0">
        <a href=${x.stage === 1 ? href(`/stage1?feature=${encodeURIComponent(x.id)}`) : href('/stage2')}>${labelOf(x.id).title}</a>
        <div class="h">stage ${x.stage} · ${LANE_LABELS[laneOf(x.id)] ?? ''} · <span class="idl">${x.id}</span></div></div></div></td>
      <td>${x.stage === 1 && html`<div class="share"><div style="width:${((x.count / featMax) * 100).toFixed(1)}%"></div></div>`}</td>
      <td class="num">${f.int(x.count)}</td>
    </tr>`,
    )}
  </table></div>`;
}

export function SourceUsage({ usage, totals }) {
  const requests = usage.reduce((a, u) => a + u.requests, 0);
  const perCandidate = totals && totals.enriched > 0 ? requests / totals.enriched : 0;
  return html`<div class="panel scroll"><table>
      <tr><th>Source</th><th class="num">Requests</th><th class="num">Errors</th><th class="num">Quota skips</th></tr>
      ${usage.length === 0 && html`<tr><td colspan="4" class="muted">No requests yet.</td></tr>`}
      ${usage.map((u) => html`<tr key=${u.source}><td>${SOURCE_NAMES[u.source] ?? u.source}</td><td class="num">${f.int(u.requests)}</td><td class="num">${f.int(u.errors)}</td><td class="num">${f.int(u.skipped)}</td></tr>`)}
    </table></div>
    ${
      perCandidate > 0 &&
      totals &&
      html`<div class="panel saving"><div class="sub m-0 fs-s">Without stage 1 the whole feed would need enrichment</div>
      <div class="v">≈ ${f.compact(Math.round(totals.processed * perCandidate))} requests <span>instead of ${f.int(requests)}</span></div>
      <div class="muted fs-s">${f.int(totals.processed)} events × ${+perCandidate.toFixed(1)} requests per candidate</div></div>`
    }`;
}

export function OverviewView() {
  const status = useStatus();
  const pulse = usePulse();
  const data = useAsync(async () => {
    const [totals, hours, usage, features, alerts, recent] = await Promise.all([api.totals(24), api.hourly(48), api.sourceUsage(24), api.featureCounts(24), api.events({ alert: true, limit: 10 }), api.events({ min_score: 0, limit: 12 })]);
    return { totals, hours, usage, features, alerts: alerts.items, recent: recent.items };
  }, []);
  // Keep the recent lists current as stage messages arrive.
  const [live, setLive] = useState({ alerts: null, recent: null });
  useEffect(
    () =>
      subscribe((m) => {
        if (m.type !== 'stage2' && m.type !== 'stage1') return;
        setLive((l) => ({
          alerts: l.alerts?.map((r) => applyStage(r, m)),
          recent: l.recent?.map((r) => applyStage(r, m)),
        }));
      }),
    [],
  );
  useEffect(() => {
    if (data.data) setLive({ alerts: data.data.alerts, recent: data.data.recent });
  }, [data.data]);

  const t = data.data?.totals;
  const steps = t
    ? [
        { n: '01', label: 'Registry feed', value: t.processed, note: 'events in 24 hours' },
        { n: '02', label: 'Stage 1 hits', value: t.flagged, note: `${f.pct(t.flagged, t.processed)} of the feed` },
        { n: '03', label: 'Stage 2 candidates', value: t.candidates, note: `${f.pct(t.candidates, t.processed)} of the feed` },
        { n: '04', label: 'Enriched', value: t.enriched, note: status && status.stage2.queue === 0 ? 'queue empty' : `${f.int(status?.stage2.queue ?? 0)} in queue` },
        { n: '05', label: 'Alerts', value: t.alerts, note: 'final score threshold 4', alert: true },
      ]
    : [];
  const kept = t && t.processed > 0 ? 100 - (100 * t.candidates) / t.processed : 0;
  const pv = pulse.map((p) => p.n);
  const pAvg = pv.length ? Math.round(pv.reduce((a, b) => a + b, 0) / pv.length) : 0;
  const hm = (p) => (p ? f.hour(p.minute).slice(-5) : '');

  const hero = html`
    <div class="row-between">
      <div><h1>Overview</h1><p class="lead">Last 24 hours · time zone ${f.tz} · observing since ${f.dateTime(status?.journal?.first)}</p></div>
      <${StatusPill} status=${status} />
    </div>
    ${
      t &&
      html`<div class="stack">
      <div class="funnel">${steps.map(
        (st) => html`<div class="step" key=${st.n}>
        <div class="lbl"><span class="num mono">${st.n}</span><span>${st.label}</span></div>
        <div class="val">${f.int(st.value)}</div>
        <div class=${`logbar${st.alert ? ' alert' : ''}`}><div style="width:${logWidth(st.value, t.processed).toFixed(1)}%"></div></div>
        <div class="note">${st.note}</div>
      </div>`,
      )}</div>
      <p class="band-muted">Bar widths are logarithmic: otherwise the ${kept.toFixed(2)}% cut of the feed before costly enrichment is invisible.</p>
    </div>`
    }
    <div class="pulse">
      <div class="head"><div class="t">Feed pulse <span class="band-note">· events per minute, last hour · live</span></div>
        <div class="s">now <b>${pv[pv.length - 1] ?? 0}</b> · average <b>${pAvg}</b> · from ${pv.length ? Math.min(...pv) : 0} to ${pv.length ? Math.max(...pv) : 0}</div></div>
      <${Sparkline} values=${pv} aria=${`Events per minute over the last hour: average ${pAvg}`} />
      <div class="axis-x mono"><span>${hm(pulse[0])}</span><span>${hm(pulse[Math.floor(pulse.length / 2)])}</span><span>${hm(pulse[pulse.length - 1])}</span></div>
    </div>`;

  return html`<${Page} hero=${hero}>
    <section aria-labelledby="pipe-h"><h2 id="pipe-h">Pipeline status</h2><${PipelineTiles} status=${status} /></section>
    ${data.error && html`<${ErrorBox} error=${data.error} retry=${data.reload} />`}
    ${data.loading && !data.data && html`<${Loading} />`}
    ${
      data.data &&
      html`
      <section aria-labelledby="hours-h"><h2 id="hours-h">Hourly, 48 hours</h2>
        <${HourlyCharts} hours=${data.data.hours} journalFirst=${status?.journal?.first} />
        <${HourlyTable} hours=${data.data.hours} />
      </section>
      <section aria-labelledby="alerts-h"><h2 id="alerts-h">Latest alerts</h2>
        ${
          (live.alerts ?? data.data.alerts).length === 0
            ? html`<${Empty} icon="shield" title="No alerts yet" text="No candidate's final score has reached the threshold of 4." />`
            : html`<${EventTable} rows=${live.alerts ?? data.data.alerts} />`
        }
      </section>
      <div class="cols">
        <section aria-labelledby="feat-h" class="grow-wide"><h2 id="feat-h">Feature hits, 24 hours</h2><${FeatureHits} features=${data.data.features} /></section>
        <section aria-labelledby="src-h"><h2 id="src-h">Source requests, 24 hours</h2><${SourceUsage} usage=${data.data.usage} totals=${t} /></section>
      </div>
      <section aria-labelledby="recent-h"><h2 id="recent-h">Latest enriched</h2>
        ${(live.recent ?? data.data.recent).length === 0 ? html`<${Empty} text="None yet." />` : html`<${EventTable} rows=${live.recent ?? data.data.recent} />`}
      </section>`
    }
  </${Page}>`;
}
