// Event card: verdict, score composition, version history, why this score, publication,
// sources, other events of the package, the full snapshot — and the analyst verdict control.

import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { ApiError, api, applyStage, getToken, setToken } from '../api.js';
import { VersionTimeline } from '../charts.js';
import { Empty, ErrorBox, EventTable, Loading, href, packageHref, useAsync } from '../components.js';
import * as f from '../format.js';
import { Icon } from '../icons.js';
import { LANE_LABELS, featureDetail, featureValue, labelOf } from '../labels.js';
import { Page } from '../layout.js';
import { subscribe } from '../ws.js';

const obj = (v) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);
const s = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));

function VersionBlock({ v, title }) {
  const pub = obj(v.publisher), trusted = obj(pub.trusted), dist = obj(v.dist);
  const lifecycle = Object.entries(obj(v.lifecycle));
  const scripts = Object.keys(obj(v.scripts));
  const deps = Object.keys(obj(v.dependencies));
  const maint = arr(v.maintainers).map(String);
  const domain = typeof pub.emailDomain === 'string' ? pub.emailDomain : '';
  return html`<div class="panel ver"><h3>${title} <span class="mono" style="font-weight:500">${s(v.version)}</span></h3><dl class="kv">
    <dt>Published</dt><dd>${f.time(v.time)}</dd>
    <dt>Publisher</dt><dd>${trusted.id ? html`CI: ${s(trusted.id)} <span class="muted mono">${s(trusted.config)}</span>` : html`${s(pub.name)}${domain && html` <span class="muted">· e-mail at ${domain}</span>`}`}</dd>
    <dt>Maintainers</dt><dd>${maint.length === 0 ? '—' : maint.length > 4 ? `${maint.length} accounts: ${maint.slice(0, 4).join(', ')}…` : maint.join(', ')}</dd>
    <dt>Install scripts</dt><dd>${lifecycle.length === 0 ? html`none${scripts.length > 0 && html` <span class="muted">(${scripts.slice(0, 5).join(', ')} do not run on install)</span>`}` : lifecycle.map(([k, cmd]) => html`<div key=${k}><code>${k}: ${String(cmd)}</code></div>`)}</dd>
    <dt>Size</dt><dd>${f.bytes(dist.unpackedSize)} · ${s(dist.fileCount)} files</dd>
    <dt>Dependencies</dt><dd>${deps.length === 0 ? 'none' : `${deps.length}: ${deps.slice(0, 12).join(', ')}${deps.length > 12 ? '…' : ''}`}</dd>
    <dt>Attestation</dt><dd>${dist.provenance ? html`yes <span class="muted">${String(dist.provenance).replace('https://', '')}</span>` : 'none'}</dd>
    <dt>Repository</dt><dd>${s(v.repository)}</dd>
    <dt>gitHead</dt><dd>${v.gitHead ? html`<span class="mono" style="font-size:12px">${String(v.gitHead)}</span>` : 'none'}</dd>
  </dl></div>`;
}

const GithubLink = ({ repo }) => {
  const m = typeof repo === 'string' ? /^([\w.-]+)\/([\w.-]+)$/.exec(repo) : null;
  return m ? html`<a href=${`https://github.com/${m[1]}/${m[2]}`} rel="noreferrer">${repo}</a>` : html`${s(repo)}`;
};

function SourceRow({ name, src, children }) {
  const o = obj(src);
  const status = o.cached ? 'cached' : o.status !== undefined ? String(o.status) : o.skipped === 'quota' ? 'skipped: quota' : o.skipped ? `error${o.error ? `: ${o.error}` : ''}` : 'not requested';
  const ok = o.status === 200 || o.cached === true;
  return html`<tr><td style="font-weight:500">${name}</td><td class="nowrap"><span class=${`status-chip${ok ? ' ok' : ''}`}>${status}</span></td><td>${children}</td></tr>`;
}

function TimelineSection({ reg, s2Features }) {
  const tl = obj(reg.timeline);
  const pts = arr(tl.points);
  if (pts.length === 0) return null;
  const publishers = arr(tl.publishers).map(String);
  const eventSet = new Set(arr(reg.event).map(String));
  const counts = publishers.map((_, i) => pts.filter((p) => p[2] === i && !eventSet.has(p[0])).length);
  const order = counts.map((c, i) => [c, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  const kindOf = (p) => (eventSet.has(p[0]) ? 'event' : p[2] === -1 ? 'removed' : p[2] === order[0] ? 'pub0' : p[2] === order[1] ? 'pub1' : 'other');
  const points = pts.map((p) => ({ version: p[0], t: p[1] * 1000, kind: kindOf(p) }));
  const events = points.filter((p) => p.kind === 'event');
  const before = points.filter((p) => p.kind !== 'event' && events.length > 0 && p.t < Math.min(...events.map((e) => e.t)));
  let gap = null;
  if (events.length > 0 && before.length > 0) {
    const from = Math.max(...before.map((p) => p.t)), to = Math.min(...events.map((e) => e.t));
    const days = Math.floor((to - from) / 86_400_000);
    if (days >= 90) gap = { from, to, label: `${days} days of silence` };
  }
  const removed = points.filter((p) => p.kind === 'removed').length;
  const short = (k) => k.replace(/^user:/, '').replace(/^trusted:/, 'CI ');
  const total = Number(tl.total ?? pts.length);
  const burst = s2Features.find((x) => x.id === 'non_adjacent_branches' || x.id === 'multi_branch');
  return html`<section class="panel tl" aria-labelledby="tl-h">
    <div class="row-between" style="align-items:baseline">
      <h2 id="tl-h">Package version history</h2>
      <div class="legend">
        ${order[0] !== undefined && counts[order[0]] > 0 && html`<span><span class="ldot pub0"></span>${short(publishers[order[0]])} · ${counts[order[0]]}</span>`}
        ${order[1] !== undefined && counts[order[1]] > 0 && html`<span><span class="ldot pub1"></span>${short(publishers[order[1]])} · ${counts[order[1]]}</span>`}
        ${order.length > 2 && counts[order[2]] > 0 && html`<span><span class="ldot other"></span>other publishers</span>`}
        ${removed > 0 && html`<span><span class="ldot removed"></span>purged by the registry · ${removed}</span>`}
        <span><span class="ldot event"></span>event versions</span>
      </div>
    </div>
    <p class="sub" style="margin:0">From the registry's <span class="mono">time</span> field — it keeps the dates of purged versions too${total > pts.length ? `; showing the last ${pts.length} of ${total}` : `, since ${points[0] ? new Date(points[0].t).getFullYear() : ''}`}.${burst ? ` ${labelOf(burst.id).title}: ${featureValue(burst)}.` : ''}</p>
    <div class="scroll"><${VersionTimeline} points=${points} gap=${gap} aria=${`Version timeline: ${pts.length} versions, ${events.length} in the event`} /></div>
  </section>`;
}

// Analyst verdict: PUT /events/{seq}/finding with a bearer token kept in localStorage.
function VerdictControl({ seq, finding, onSaved }) {
  const [verdict, setVerdict] = useState(finding?.verdict ?? 'undecided');
  const [note, setNote] = useState(finding?.note ?? '');
  const [reference, setReference] = useState(finding?.reference ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => { setVerdict(finding?.verdict ?? 'undecided'); setNote(finding?.note ?? ''); setReference(finding?.reference ?? ''); }, [finding]);

  const askToken = () => {
    const t = prompt('Analyst token (ANALYST_TOKEN on the server). It is kept in this browser only.', getToken());
    if (t === null) return false;
    setToken(t.trim());
    return t.trim() !== '';
  };
  const save = async (remove = false) => {
    if (!getToken() && !askToken()) return;
    setBusy(true); setMsg(null);
    try {
      const res = remove ? await api.deleteFinding(seq) : await api.putFinding(seq, { verdict, note: note || undefined, reference: reference || undefined });
      setMsg(remove ? 'Verdict removed.' : 'Verdict stored.');
      onSaved(remove ? null : res);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setToken('');
        if (askToken()) return save(remove);
        setMsg('Not stored: a valid analyst token is required.');
      } else setMsg(`Not stored: ${e.message}`);
    } finally { setBusy(false); }
  };
  const opts = [['confirmed', 'Confirmed', 'alert'], ['false_positive', 'False positive', 'check'], ['undecided', 'Undecided', 'clock']];
  return html`<section aria-labelledby="vc-h"><h2 id="vc-h">Analyst verdict</h2>
    <div class="panel verdict-box">
      <div class="opts" role="group" aria-label="Verdict">${opts.map(([k, label, ic]) => html`<button type="button" key=${k} class=${`vbtn ${k}`} aria-pressed=${verdict === k ? 'true' : 'false'} onClick=${() => setVerdict(k)}><${Icon} name=${ic} size=${14} stroke=${2.4} />${label}</button>`)}</div>
      <div class="row">
        <label>Note<input type="text" value=${note} maxlength="2000" onInput=${(e) => setNote(e.currentTarget.value)} placeholder="why this verdict" /></label>
        <label>Reference<input type="text" value=${reference} onInput=${(e) => setReference(e.currentTarget.value)} placeholder="advisory, issue or write-up" /></label>
      </div>
      <div class="row" style="align-items:center">
        <button type="button" class="btn" disabled=${busy} onClick=${() => save(false)}>Store verdict</button>
        ${finding && html`<button type="button" class="btn secondary" disabled=${busy} onClick=${() => save(true)}>Remove</button>`}
        ${finding && html`<span class="muted">stored ${f.time(finding.decided_at)}</span>`}
        ${msg && html`<span role="status">${msg}</span>`}
      </div>
    </div>
  </section>`;
}

export function EventView({ seq }) {
  const data = useAsync(() => api.event(seq), [seq]);
  const [card, setCard] = useState(null);
  useEffect(() => { setCard(data.data); }, [data.data]);
  // Stage results that arrive while the card is open.
  useEffect(() => subscribe((m) => {
    if ((m.type === 'stage1' || m.type === 'stage2') && card && m.seq === Number(seq)) {
      setCard((c) => ({ ...c, stage1: m.type === 'stage1' ? m.stage1 : c.stage1, stage2: m.type === 'stage2' ? { ...c.stage2, ...m.stage2 } : c.stage2, event: applyStage(c.event, m) }));
    }
  }), [seq, card !== null]);

  if (data.error) {
    const hero = html`<div><h1>${data.error.status === 404 ? 'Event not found' : 'Error'}</h1><p class="lead">${data.error.status === 404 ? `There is no event seq ${seq} in the journal.` : data.error.message}</p></div>`;
    return html`<${Page} hero=${hero}><section><${ErrorBox} error=${data.error} retry=${data.reload} /></section></${Page}>`;
  }
  if (!card) return html`<${Page} hero=${html`<div><h1>Event ${seq}</h1><p class="lead">Loading…</p></div>`}><${Loading} /></${Page}>`;

  const { event: e, stage1: st1, stage2: st2, finding, package_events: others } = card;
  const ev = obj(st2?.evidence), reg = obj(ev.registry);
  const versions = arr(reg.versions).map(obj);
  const prev = reg.previous ? obj(reg.previous) : null;
  const removedNow = new Set(arr(reg.removed).map((r) => String(obj(r).version)));
  const sources = obj(st2?.sources);
  const eco = obj(ev.ecosystems_package), dd = obj(ev.depsdev), gh = obj(ev.github_commit), rdap = obj(ev.rdap), pubEco = obj(ev.ecosystems_publisher);
  const s1f = st1?.features ?? [], s2f = st2?.features ?? [];
  const s1Sum = s1f.reduce((a, x) => a + x.weight, 0), s2Sum = s2f.reduce((a, x) => a + x.weight, 0);
  const finalScore = st2 ? st2.final_score : st1?.prescore ?? 0;
  const versionText = st2?.versions?.length ? st2.versions.join(', ') : '';
  const segs = [...s1f.map((x) => ({ x, stage: 1 })), ...s2f.map((x) => ({ x, stage: 2 }))].filter((g) => g.x.weight > 0);
  const scaleMax = Math.max(10, Math.ceil(finalScore));
  const thr = st2 ? 4 : 2;
  const pill = st2
    ? st2.alert ? html`<span class="pill bad"><${Icon} name="alert" size=${18} stroke=${2.2} />Alert</span>` : html`<span class="pill ok"><${Icon} name="check" size=${16} stroke=${2.4} />No alert</span>`
    : st1?.candidate ? html`<span class="pill warn"><${Icon} name="clock" size=${16} stroke=${2.2} />Awaiting enrichment</span>` : html`<span class="pill neutral">Did not pass stage 1</span>`;
  const crumb = st2?.alert ? ['/alerts', 'Alerts'] : st2 ? ['/stage2', 'Stage 2'] : ['/stage1', 'Stage 1'];

  const hero = html`
    <div style="display:flex;flex-direction:column;gap:6px">
      <nav class="crumbs" aria-label="Breadcrumbs"><a href=${href(crumb[0])}>${crumb[1]}</a> / ${e.package}</nav>
      <div class="title-row"><h1>${e.package}</h1>${versionText && html`<span class="ver">${versionText}</span>`}${pill}${finding && finding.verdict !== 'undecided' && html`<span class=${`pill ${finding.verdict === 'confirmed' ? 'bad' : 'ok'}`}>analyst: ${finding.verdict === 'confirmed' ? 'confirmed' : 'false positive'}</span>`}</div>
      <p class="lead">event seq ${e.seq} · revision <span class="mono">${String(e.rev).split('-')[0]}</span>${e.deleted && ' · package deletion'} ·
        <a href=${`https://www.npmjs.com/package/${e.package}`} rel="noreferrer">npmjs.com</a> · <a href=${`https://deps.dev/npm/${encodeURIComponent(e.package)}`} rel="noreferrer">deps.dev</a> · <a href=${packageHref(e.package)}>${e.package}</a>: all events</p>
    </div>
    <div class="verdict">
      <div class="big-score"><div class="k">${st2 ? 'Final score' : 'Prescore'}</div><div class="v">${f.score(finalScore)}</div><div class="n">${st2 ? 'alert' : 'candidate'} threshold ${thr}</div></div>
      ${segs.length > 0 ? html`<div class="compose">
        <div class="legend"><span><span class="sw" style="background:var(--band-s1)"></span>stage 1 · ${f.score(s1Sum)}</span>${st2 && html`<span><span class="sw" style="background:var(--band-s2)"></span>stage 2 · ${f.score(s2Sum)}</span>`}</div>
        <div class="scorebar">
          <div class="thr-l" style="left:${((thr / scaleMax) * 100).toFixed(1)}%">threshold ${thr}</div>
          <div class="thr" style="left:${((thr / scaleMax) * 100).toFixed(1)}%" aria-hidden="true"></div>
          <div class="bar" role="img" aria-label=${`Score composition: ${segs.map((g) => `${labelOf(g.x.id).title} ${f.score(g.x.weight)}`).join(', ')}`}>
            ${segs.map((g) => html`<div class=${`seg s${g.stage}`} key=${g.x.id} style="width:${((g.x.weight / scaleMax) * 100).toFixed(1)}%" title=${`${labelOf(g.x.id).title}: ${f.score(g.x.weight)}`}><span class="lt">${f.score(g.x.weight)} · ${labelOf(g.x.id).short}</span></div>`)}
          </div>
          <div class="scale"><span>0</span><span>${scaleMax}</span></div>
        </div></div>`
      : html`<div class="compose"><p class="band-muted" style="font-size:13px">${s1f.length + s2f.length === 0 ? 'No feature fired.' : `Only zero-weight features fired: ${[...s1f, ...s2f].map((x) => labelOf(x.id).title).join(', ')}.`}</p></div>`}
    </div>`;

  const firstVersion = versions[0];
  const rows = [...s1f.map((x) => ({ x, stage: 1 })), ...s2f.map((x) => ({ x, stage: 2 }))];
  return html`<${Page} hero=${hero}>
    <${TimelineSection} reg=${reg} s2Features=${s2f} />
    <section aria-label="Timing" class="grid-auto">
      <div class="panel tile"><div class="k">Published</div><div class="v">${firstVersion ? f.time(firstVersion.time) : '—'}</div><div class="n">registry time, ${f.tz}</div></div>
      <div class="panel tile"><div class="k">Observed</div><div class="v">${f.time(e.observed_at)}</div><div class="n">appeared after ${f.time(e.observed_after)}</div></div>
      <div class="panel tile"><div class="k">Enriched</div><div class="v">${st2 ? f.time(st2.enriched_at) : '—'}</div><div class="n">${st2 ? `${Math.max(0, Math.round((new Date(st2.enriched_at).getTime() - new Date(e.observed_at).getTime()) / 60000))} min after observation` : 'not performed'}</div></div>
      <div class="panel tile"><div class="k">Stage 1</div><div class="v">${st1?.candidate ? 'candidate' : st1 ? 'not a candidate' : 'no features'}</div><div class="n">prescore ${f.score(st1?.prescore ?? 0)} against a threshold of 2</div></div>
    </section>
    <section aria-labelledby="why-h"><h2 id="why-h">Why this score</h2>
      ${rows.length === 0 ? html`<${Empty} text="No feature fired." />` : html`<div class="panel scroll"><table style="min-width:760px">
        <tr><th style="width:80px">Stage</th><th>Feature</th><th>Value</th><th class="num">Weight</th></tr>
        ${rows.map(({ x, stage }) => html`<tr key=${`${stage}-${x.id}`}>
          <td><span style="display:inline-flex;align-items:center;gap:6px"><span class="sw" style=${`width:10px;height:10px;background:${stage === 1 ? 'var(--series)' : 'var(--series-2)'}`}></span>${stage}</span></td>
          <td><div class="feat"><span class="ibox"><${Icon} name=${x.lane} /></span><div><div class="t">${labelOf(x.id).title}</div><div class="h">${LANE_LABELS[x.lane] ?? x.lane} · ${labelOf(x.id).hint} · <span class="idl">${x.id}</span></div></div></div></td>
          <td>${featureValue(x)}${x.threshold !== undefined && html` <span class="muted">(threshold ${x.threshold})</span>`}<div class="muted" style="font-size:13px">${featureDetail(x)}</div></td>
          <td class="num" style="font-weight:600">${f.score(x.weight)}</td>
        </tr>`)}
        <tr><td colspan="3" style="font-weight:600">Total <span class="muted" style="font-weight:400">· ${st2 ? 'alert' : 'candidate'} threshold ${thr}</span></td><td class="num" style="font-weight:600;font-size:16px">${f.score(finalScore)}</td></tr>
      </table></div>`}
    </section>
    <${VerdictControl} seq=${e.seq} finding=${finding} onSaved=${(fnd) => setCard((c) => ({ ...c, finding: fnd }))} />
    ${(versions.length > 0 || prev) && html`<section aria-labelledby="pub-h"><h2 id="pub-h">Publication</h2><div class="grid-auto">
      ${versions.map((v) => html`<${VersionBlock} v=${v} title="Version" key=${v.version} />`)}
      ${prev && html`<${VersionBlock} v=${prev} title="Previous version" />`}
    </div></section>`}
    ${st2 && arr(obj(reg.timeline).points).length === 0 && arr(reg.burst).length > 0 && html`<section aria-labelledby="burst-h"><h2 id="burst-h">Versions nearby in time</h2><div class="panel scroll"><table>
      <tr><th>Version</th><th>Time</th><th>In the registry</th></tr>
      ${arr(reg.burst).map(obj).map((b) => html`<tr key=${b.version}><td class="mono">${s(b.version)}</td><td>${f.time(b.time)}</td><td>${b.present ? 'yes' : html`<span class="verdict-s bad"><${Icon} name="cross" size=${14} stroke=${2.4} />purged</span>`}</td></tr>`)}
    </table></div></section>`}
    ${st2 ? html`<section aria-labelledby="src-h2"><h2 id="src-h2">Sources</h2><div class="panel scroll"><table style="min-width:640px">
      <tr><th>Source</th><th>Answer</th><th>What it gave</th></tr>
      <${SourceRow} name="npm registry" src=${sources.registry}>packument: ${versions.length} event version(s), history of ${s(obj(reg.history).versions)} versions${removedNow.size > 0 && `, ${removedNow.size} purged`}</${SourceRow}>
      <${SourceRow} name="ecosyste.ms" src=${sources.ecosystems_package}>${eco.found ? html`<${GithubLink} repo=${eco.repo} /> · ${eco.archived ? 'archived' : 'not archived'} · push ${f.date(eco.pushedAt)}` : 'package not in the index'}</${SourceRow}>
      ${sources.ecosystems_publisher && html`<${SourceRow} name="ecosyste.ms: publisher" src=${sources.ecosystems_publisher}>${pubEco.found ? `in the index since ${f.date(pubEco.firstSeen)} · ${s(pubEco.packages)} packages` : 'account not in the index'}</${SourceRow}>`}
      <${SourceRow} name="deps.dev" src=${sources.depsdev}>${dd.found ? `attested source: ${arr(dd.attestedSource).join(', ') || 'none'} · ${s(dd.attestations)} attestations` : 'version not in the index'}</${SourceRow}>
      <${SourceRow} name="GitHub" src=${sources.github_commit}>${gh.repo ? html`<${GithubLink} repo=${gh.repo} /> · commit <span class="mono" style="font-size:12px">${String(gh.sha ?? '').slice(0, 12)}</span>: ${gh.found === true ? 'found' : gh.found === false ? html`<strong style="color:var(--bad)">not found</strong>` : s(gh.status)}` : 'no gitHead — nothing to check'}</${SourceRow}>
      <${SourceRow} name="RDAP" src=${sources.rdap}>${rdap.domain ? `${rdap.domain} · registered ${f.date(rdap.registered)} · expires ${f.date(rdap.expires)}` : 'publisher e-mail at a public provider or CI'}</${SourceRow}>
    </table></div></section>`
    : html`<section><${Empty} text=${st1?.candidate ? 'The candidate is waiting for stage 2 enrichment.' : 'The event did not pass stage 1; no enrichment was performed.'} /></section>`}
    <section aria-labelledby="other-h"><h2 id="other-h">Other events of this package</h2>
      ${(others ?? []).length === 0 ? html`<${Empty} text="No other events." />` : html`<${EventTable} rows=${others} mode="stage1" minWidth=${760} />`}
    </section>
    <details class="panel raw"><summary>Full snapshot (JSON) · <a href=${href(`/api/v1/events/${e.seq}`)} onClick=${(ev2) => ev2.stopPropagation()}>open as JSON</a></summary><pre>${JSON.stringify({ event: e, stage1: st1, stage2: st2, finding }, null, 2)}</pre></details>
  </${Page}>`;
}
