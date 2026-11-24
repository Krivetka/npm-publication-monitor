// Live feed: WebSocket stream of journal events, newest on top, in a virtualized list.
// Backfills the gap after (re)connect from GET /events?after=, pages older rows with
// GET /events?before=, updates rows in place when stage results arrive.

import { html } from 'htm/preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { api, applyStage } from '../api.js';
import { Chips, ErrorBox, eventHref, Loading, Meter, packageHref, Verdict } from '../components.js';
import { logError } from '../errors.js';
import * as f from '../format.js';
import { Icon } from '../icons.js';
import { Page } from '../layout.js';
import { buildQuery } from '../router.js';
import { VirtualList } from '../virtual-list.js';
import { subscribe, wsState } from '../ws.js';

const PAGE = 200;
const MAX_ROWS = 50_000;
const FILTERS = [
  ['all', 'All events'],
  ['flagged', 'Stage 1 hits'],
  ['candidates', 'Candidates'],
  ['alerts', 'Alerts'],
];

function matches(row, filter) {
  if (filter === 'flagged') return (row.stage1?.features?.length ?? 0) > 0;
  if (filter === 'candidates') return row.stage1?.candidate === true;
  if (filter === 'alerts') return row.stage2?.alert === true;
  return true;
}

function filterParams(filter, pkg) {
  const q = { limit: PAGE };
  if (pkg) q.package = pkg;
  if (filter === 'flagged') q.flagged = true;
  if (filter === 'candidates') q.candidate = true;
  if (filter === 'alerts') q.alert = true;
  return q;
}

// Insert rows keeping the array sorted by seq descending and unique.
function merge(rows, incoming) {
  if (incoming.length === 0) return rows;
  const map = new Map(rows.map((r) => [r.seq, r]));
  for (const r of incoming) map.set(r.seq, map.has(r.seq) ? { ...map.get(r.seq), ...r } : r);
  return [...map.values()].sort((a, b) => b.seq - a.seq).slice(0, MAX_ROWS);
}

function FeedRow({ row: r, fresh }) {
  const s1 = r.stage1,
    s2 = r.stage2;
  const chips = [...(s1?.features ?? []).filter((x) => x.weight > 0 || x.id === 'watchlist'), ...(s2?.features ?? [])];
  return html`<div class=${`frow${s2?.alert ? ' alert' : ''}${fresh ? ' fresh' : ''}`}>
    <a class="t" href=${eventHref(r.seq)}>${f.clock(r.observed_at)}</a>
    <a class="p" href=${packageHref(r.package)} title=${r.package}>${r.package}${r.deleted && html` <span class="muted">· deleted</span>`}</a>
    <div class="f">${chips.length ? html`<${Chips} features=${chips} withValue=${true} />` : html`<span class="muted">—</span>`}</div>
    <div class="m">${s2 ? html`<${Meter} value=${s2.final_score} scaleMax=${10} threshold=${4} hot=${s2.alert} />` : s1 ? html`<${Meter} value=${s1.prescore} scaleMax=${3} threshold=${2} />` : html`<span class="muted mono fs-xs">rev ${String(r.rev).split('-')[0]}</span>`}</div>
    <div class="v"><${Verdict} row=${r} /></div>
  </div>`;
}

const measureRow = () => (matchMedia('(max-width: 760px)').matches ? (matchMedia('(pointer: coarse)').matches ? 6.25 : 4.5) : 3.5) * parseFloat(getComputedStyle(document.documentElement).fontSize);

export function FeedView({ query, nav }) {
  const filter = FILTERS.some(([k]) => k === query.filter) ? query.filter : 'all';
  const pkg = query.package || '';
  const [rows, setRows] = useState([]);
  const [paused, setPaused] = useState(false);
  const [buffer, setBuffer] = useState([]); // rows received while paused or scrolled away
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exhausted, setExhausted] = useState(false);
  const [state, setState] = useState(wsState());
  const [count, setCount] = useState(0); // live events seen since page open
  const freshRef = useRef(new Set());
  const atTop = useRef(true);
  const loadingOlder = useRef(false);
  const listRef = useRef(null);
  // rows are 3.5rem high, 4.5rem on a narrow screen, 6.25rem on a phone (two 44 px targets): the list needs the same figure in pixels
  // the figure follows the breakpoint: a rotation or a resized window changes the row of the stylesheet
  const [rowHeight, setRowHeight] = useState(measureRow);
  useEffect(() => {
    const queries = [matchMedia('(max-width: 760px)'), matchMedia('(pointer: coarse)')];
    const update = () => setRowHeight(measureRow());
    for (const q of queries) q.addEventListener('change', update);
    return () => {
      for (const q of queries) q.removeEventListener('change', update);
    };
  }, []);

  // Initial page and whenever the filter changes.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setRows([]);
    setBuffer([]);
    setExhausted(false);
    api
      .events(filterParams(filter, pkg))
      .then((res) => {
        if (!alive) return;
        setRows(res.items);
        setExhausted(res.next_before === null || res.next_before === undefined);
      })
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [filter, pkg]);

  // Live stream.
  useEffect(
    () =>
      subscribe((m) => {
        if (m.type === '_state') {
          setState(m.state);
          return;
        }
        if (m.type === '_resume') {
          // Reconnected: fetch what happened while the socket was down (gap-free resume).
          if (m.from !== null && m.last_seq !== null && m.last_seq > m.from) {
            api
              .events({ ...filterParams(filter, pkg), after: m.from, limit: 500 })
              .then((res) => setRows((r) => merge(r, res.items)))
              .catch((e) => logError('feed: resume', e));
          }
          return;
        }
        if (m.type === 'event') {
          const ev = m.event;
          if (pkg && ev.package !== pkg) return;
          setCount((c) => c + 1);
          if (!matches(ev, filter)) return; // stage results for filtered views arrive via stage messages below
          freshRef.current.add(ev.seq);
          setTimeout(() => freshRef.current.delete(ev.seq), 1500);
          if (paused || !atTop.current) setBuffer((b) => merge(b, [ev]));
          else setRows((r) => merge(r, [ev]));
          return;
        }
        if (m.type === 'stage1' || m.type === 'stage2') {
          const apply = (list) => list.map((r) => applyStage(r, m));
          setRows(apply);
          setBuffer(apply);
          // A filtered view may gain a row only now (e.g. "alerts" when stage 2 finishes).
          if (filter !== 'all' && !pkg) {
            setRows((r) => {
              if (r.some((x) => x.seq === m.seq)) return r;
              const probe = { seq: m.seq, stage1: m.stage1 ?? null, stage2: m.stage2 ?? null };
              if (!matches(probe, filter)) return r;
              api
                .event(m.seq)
                .then((card) => setRows((rr) => merge(rr, [{ ...card.event, stage1: card.stage1, stage2: card.stage2 }])))
                .catch((e) => logError('feed: stage result', e));
              return r;
            });
          }
        }
      }),
    [filter, pkg, paused],
  );

  const release = useCallback(() => {
    setRows((r) => merge(r, buffer));
    setBuffer([]);
    const el = listRef.current?.querySelector('.vlist');
    if (el) el.scrollTop = 0;
  }, [buffer]);

  const onNearEnd = useCallback(() => {
    if (loadingOlder.current || exhausted || rows.length === 0) return;
    loadingOlder.current = true;
    const oldest = rows[rows.length - 1].seq;
    api
      .events({ ...filterParams(filter, pkg), before: oldest })
      .then((res) => {
        setRows((r) => merge(r, res.items));
        if (res.next_before === null || res.next_before === undefined || res.items.length === 0) setExhausted(true);
      })
      .catch((e) => logError('feed: older rows', e))
      .finally(() => {
        loadingOlder.current = false;
      });
  }, [rows, exhausted, filter, pkg]);

  const onScrollTop = useCallback((top) => {
    atTop.current = top;
  }, []);
  const setFilter = (k) => nav.go(`/feed${buildQuery({ filter: k === 'all' ? null : k, package: pkg || null })}`);
  const onSearch = (e) => {
    e.preventDefault();
    nav.go(`/feed${buildQuery({ filter: filter === 'all' ? null : filter, package: String(new FormData(e.currentTarget).get('package') ?? '').trim() || null })}`);
  };

  const hero = html`
    <div class="row-between">
      <div><h1>Live feed</h1><p class="lead">Every change of the npm registry as the collector sees it · stage results attach to rows as they arrive${pkg && html` · package <span class="mono">${pkg}</span>`}</p></div>
      <p class=${`pill ${state === 'open' ? 'ok' : 'warn'}`}>${state === 'open' ? html`<${Icon} name="check" size=${16} stroke=${2.4} />Live · ${f.int(count)} events since open` : html`<${Icon} name="clock" size=${16} stroke=${2.2} />${state === 'connecting' ? 'Connecting…' : 'Reconnecting…'}`}</p>
    </div>
    <div class="filters">
      ${FILTERS.map(([k, label]) => html`<button type="button" class="fpill" key=${k} aria-pressed=${filter === k ? 'true' : 'false'} onClick=${() => setFilter(k)}>${label}</button>`)}
      <button type="button" class="fpill" aria-pressed=${paused ? 'true' : 'false'} onClick=${() => {
        setPaused(!paused);
        if (paused) release();
      }} aria-label=${paused ? 'Resume the feed' : 'Pause the feed'}><${Icon} name=${paused ? 'play' : 'pause'} size=${14} />${paused ? 'Resume' : 'Pause'}</button>
      <form class="inline" onSubmit=${onSearch} role="search">
        <label class="sr" for="feed-pkg">Package</label><input id="feed-pkg" type="search" name="package" value=${pkg} placeholder="filter by package" autocomplete="off" />
        <button class="btn-ghost" type="submit">Filter</button>
      </form>
    </div>`;

  const header = buffer.length > 0 && html`<button type="button" class="banner" onClick=${release}><span role="status">${f.int(buffer.length)} new ${buffer.length === 1 ? 'event' : 'events'} — show</span></button>`;
  return html`<${Page} hero=${hero} mainClass="feed-main">
    <section ref=${listRef}>
      ${error && html`<${ErrorBox} error=${error} />`}
      <div class="panel feed-wrap">
        <div class="feed-head" aria-hidden="true"><span>Time</span><span>Package</span><span>Features</span><span>Score</span><span>Verdict</span></div>
        ${
          loading && rows.length === 0
            ? html`<${Loading} text="Loading the feed…" lines=${6} />`
            : html`<${VirtualList} items=${rows} rowHeight=${rowHeight} header=${header} onNearEnd=${onNearEnd} onScrollTop=${onScrollTop}
              renderRow=${(r) => html`<${FeedRow} row=${r} fresh=${freshRef.current.has(r.seq)} key=${r.seq} />`} />`
        }
      </div>
      <p class="muted m-0 fs-s">${f.int(rows.length)} rows loaded${exhausted ? ' · start of the journal reached' : ' · scroll down for older events'}${paused ? ' · paused' : ''}.</p>
    </section>
  </${Page}>`;
}
