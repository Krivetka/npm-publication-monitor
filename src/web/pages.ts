// UI pages after the "npm monitor — web interface" mock-up.
// Server-rendered without client-side JS. Every page opens with a dark band holding
// what matters most on that page (funnel, verdict, filters), light panels follow.

import type { Feature } from '../lib/feature.ts';
import { columnChart, sparkline, type TimelinePoint, versionTimeline } from './chart.ts';
import * as f from './format.ts';
import { html, qs, type Raw, raw } from './html.ts';
import { icon } from './icons.ts';
import { LANE_LABELS, labelOf } from './labels.ts';
import type { EnrichedRow, EventCard, FeatureCount, FlaggedRow, HourRow, PackageEventRow, Status, Totals, UsageRow } from './queries.ts';

export interface Ctx {
  base: string; // path prefix, e.g. /npm
}

const FONTS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap';

const CSS = `
:root{color-scheme:light;
  --bg:#F7F6F3;--panel:#FFFFFF;--line:#E3E1DB;--line-2:#EFEDE8;--ink:#17181C;--ink-2:#4F4D48;--ink-3:#6E6C66;
  --chip:#F1EFEA;--link:#1F63B8;--link-h:#174C8F;--series:#2A78D6;--series-2:#EB6834;--on-series-2:#17181C;
  --good:#1C6B1C;--good-bg:#ECF6EC;--warn:#8A5A00;--warn-bg:#FDF3DC;--bad:#A32A2A;--bad-dot:#D03B3B;--bad-bg:#FBEDEC;--bad-line:#E8C4C1;
  --grid:#EFEDE8;--axis:#E3E1DB;--marker:#B9B7B0;--removed:#8A8880;--pub1:#1BAF7A;--other:#9A988F;
  --band:#17181C;--band-2:#1E1F24;--band-line:#2A2B30;--band-ink:#F7F6F3;--band-ink-2:#B9B7B0;--band-ink-3:#8A8880;
  --band-accent:#6DA7EC;--band-link:#9EC5F4;--band-s1:#3987E5;--band-s2:#D95926;--band-input:#24252A;--band-input-line:#3A3B40}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])){color-scheme:dark;
  --bg:#141413;--panel:#1C1C1B;--line:#34342F;--line-2:#292926;--ink:#F0EFEC;--ink-2:#C3C2B7;--ink-3:#9A988F;
  --chip:#2A2A27;--link:#7FB0F0;--link-h:#A8C9F5;--series:#3987E5;--series-2:#D95926;--on-series-2:#17181C;
  --good:#7BD17B;--good-bg:#1F3322;--warn:#FAB219;--warn-bg:#3A2E12;--bad:#FF9C97;--bad-dot:#E66767;--bad-bg:#3A1D1D;--bad-line:#5A2A2A;
  --grid:#292926;--axis:#3A3A36;--marker:#5A5953;--removed:#9A988F;--pub1:#199E70;--other:#6E6C66;
  --band:#0E0F11;--band-2:#18191D;--band-line:#26272C}}
:root[data-theme="dark"]{color-scheme:dark;
  --bg:#141413;--panel:#1C1C1B;--line:#34342F;--line-2:#292926;--ink:#F0EFEC;--ink-2:#C3C2B7;--ink-3:#9A988F;
  --chip:#2A2A27;--link:#7FB0F0;--link-h:#A8C9F5;--series:#3987E5;--series-2:#D95926;--on-series-2:#17181C;
  --good:#7BD17B;--good-bg:#1F3322;--warn:#FAB219;--warn-bg:#3A2E12;--bad:#FF9C97;--bad-dot:#E66767;--bad-bg:#3A1D1D;--bad-line:#5A2A2A;
  --grid:#292926;--axis:#3A3A36;--marker:#5A5953;--removed:#9A988F;--pub1:#199E70;--other:#6E6C66;
  --band:#0E0F11;--band-2:#18191D;--band-line:#26272C}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',sans-serif}
a{color:var(--link);text-decoration:none}a:hover{color:var(--link-h);text-decoration:underline}
.mono{font-family:'IBM Plex Mono',ui-monospace,Consolas,monospace}
.wrap{max-width:1240px;margin:0 auto;padding:0 24px}
.muted{color:var(--ink-3)}.sub{color:var(--ink-2);margin:4px 0 0}
.ico{flex:none;vertical-align:middle}
/* dark band */
.band{background:var(--band);color:var(--band-ink)}
.band a{color:var(--band-link)}
.band header{border-bottom:1px solid var(--band-line)}
.band header .wrap{display:flex;flex-wrap:wrap;align-items:center;gap:0 28px;min-height:56px}
.brand{display:flex;align-items:center;gap:10px;color:var(--band-ink)!important;font-weight:600;font-size:15px;min-height:44px}
.brand .ico{color:var(--band-accent)}
nav.tabs{display:flex;flex-wrap:wrap;gap:0 22px}
nav.tabs a{color:#C9C7C0;padding:15px 0 13px;border-bottom:2px solid transparent}
nav.tabs a:hover{color:#FFF;text-decoration:none}
nav.tabs a[aria-current]{color:#FFF;font-weight:500;border-bottom-color:var(--band-accent)}
form.search{margin-left:auto;display:flex;gap:8px;padding:8px 0}
form.search input{font:inherit;width:220px;min-height:40px;padding:0 12px;border-radius:6px;border:1px solid var(--band-input-line);background:var(--band-input);color:var(--band-ink)}
.btn-ghost{font:inherit;font-weight:500;min-height:40px;padding:0 16px;border-radius:6px;border:1px solid var(--band-accent);background:transparent;color:var(--band-ink);cursor:pointer}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.hero{padding:28px 0 34px;display:flex;flex-direction:column;gap:26px}
.hero h1{margin:0;font-size:30px;font-weight:600;letter-spacing:-.01em;color:#FFF;word-break:break-all}
.hero .lead{margin:4px 0 0;color:var(--band-ink-2)}
.band-muted{color:var(--band-ink-3);font-size:12px;margin:0}
.row-between{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:12px}
.pill{display:inline-flex;align-items:center;gap:8px;padding:6px 14px;border-radius:999px;font-weight:500;margin:0}
.pill.ok{background:#1F3322;color:#9BDC9B}.pill.warn{background:#3A2E12;color:#F5C76A}.pill.bad{background:#4A1F1F;color:#FFB4B0;font-weight:600}
.funnel{display:flex;flex-wrap:wrap;gap:20px 12px}
.step{flex:1 1 190px;min-width:0;display:flex;flex-direction:column;gap:6px}
.step .lbl{display:flex;gap:8px;color:var(--band-ink-2);font-size:13px}.step .num{color:var(--band-ink-3);font-size:12px}
.step .val{font-family:'IBM Plex Mono',monospace;font-size:38px;font-weight:500;line-height:1.1;color:#FFF}
.step .note{color:var(--band-ink-2);font-size:13px}
.logbar{height:6px;background:var(--band-line);border-radius:3px}.logbar>div{height:6px;border-radius:3px;background:var(--band-accent)}
.logbar.alert>div{background:#E66767}
.pulse{background:var(--band-2);border:1px solid var(--band-line);border-radius:10px;padding:14px 18px 10px}
.pulse .head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:6px 16px;margin-bottom:8px}
.pulse .head .t{color:#E6E4DE;font-weight:500}.pulse .head .s{color:var(--band-ink-2);font-size:13px}.pulse .head b{color:#FFF;font-weight:400;font-family:'IBM Plex Mono',monospace}
.pulse-plot{position:relative;height:120px}
.pulse-plot svg{position:absolute;inset:0;width:100%;height:100%;display:block}
.p-grid{stroke:#2E2F35;stroke-width:1}.p-axis{stroke:#3A3B40;stroke-width:1}
.p-area{fill:var(--band-accent);fill-opacity:.12}.p-line{fill:none;stroke:var(--band-accent);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.p-label{position:absolute;left:0;font-size:11px;color:var(--band-ink-3)}
.p-dot{position:absolute;right:-5px;width:10px;height:10px;border-radius:50%;background:var(--band-accent);box-shadow:0 0 0 2px var(--band-2)}
.pulse .axis-x{display:flex;justify-content:space-between;color:var(--band-ink-3);font-size:11px;margin-top:4px}
.crumbs{font-size:13px;color:var(--band-ink-3)}
.title-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px}
.title-row .ver{font-family:'IBM Plex Mono',monospace;font-size:20px;color:#C9C7C0}
.verdict{display:flex;flex-wrap:wrap;gap:20px 40px;align-items:flex-end}
.big-score .k{color:var(--band-ink-2);font-size:13px}
.big-score .v{font-family:'IBM Plex Mono',monospace;font-size:56px;font-weight:500;line-height:1;color:#FFF}
.big-score .n{color:var(--band-ink-3);font-size:13px;margin-top:6px}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px}
.legend span{display:inline-flex;align-items:center;gap:6px}
.sw{width:12px;height:12px;border-radius:3px;display:inline-block}
.compose{flex:1 1 520px;min-width:0;display:flex;flex-direction:column;gap:8px;color:#C9C7C0}
.scorebar{position:relative;padding-top:20px}
.scorebar .bar{display:flex;gap:2px;height:34px;background:var(--band-input);border-radius:6px}
.seg{display:flex;align-items:center;padding-left:8px;font-size:12px;font-weight:600;white-space:nowrap;min-width:0}
.seg.s1{background:var(--band-s1);color:#FFF}.seg.s2{background:var(--band-s2);color:#17181C}
.seg:first-child{border-radius:6px 0 0 6px}.seg:last-child{border-radius:0 6px 6px 0}
.seg .lt{overflow:hidden;text-overflow:ellipsis}
.thr{position:absolute;top:18px;bottom:-4px;width:2px;background:#FFF}
.thr-l{position:absolute;top:0;transform:translateX(-50%);font-size:12px;color:#E6E4DE}
.scale{display:flex;justify-content:space-between;margin-top:4px;font-size:11px;color:var(--band-ink-3)}
.filters{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.fpill{display:inline-flex;align-items:center;gap:8px;min-height:40px;padding:0 14px;border-radius:999px;border:1px solid var(--band-input-line);color:#E6E4DE!important}
.fpill:hover{text-decoration:none;border-color:var(--band-accent)}
.fpill .c{font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--band-ink-3)}
.fpill[aria-current]{background:var(--band-accent);border-color:var(--band-accent);color:#17181C!important}.fpill[aria-current] .c{color:#17181C}
.band form.inline{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-left:auto;color:#E6E4DE}
.band form.inline input[type=text]{font:inherit;min-height:40px;width:70px;padding:0 10px;border-radius:6px;border:1px solid var(--band-input-line);background:var(--band-input);color:var(--band-ink)}
/* light part */
main.wrap{padding-top:30px;padding-bottom:64px;display:flex;flex-direction:column;gap:34px}
section{display:flex;flex-direction:column;gap:12px}
h2{margin:0;font-size:18px;font-weight:600}h3{margin:0 0 10px;font-size:15px;font-weight:600}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px}
.grid-auto{display:flex;flex-direction:row;flex-wrap:wrap;gap:12px}
.tile{flex:1 1 260px;padding:14px 18px;display:flex;flex-direction:column;gap:4px}
.tile .k{color:var(--ink-2);font-size:13px}.tile .v{font-size:17px;font-weight:600}.tile .n{color:var(--ink-3);font-size:13px}
.tile .head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.state{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500}
.state.ok{color:var(--good)}.state.warn{color:var(--warn)}.state.bad{color:var(--bad)}
.chart{flex:1 1 520px;margin:0;padding:12px 14px 6px}
.chart figcaption{color:var(--ink-2);font-size:13px;margin-bottom:4px}
.chart svg{width:100%;height:auto;display:block;font-family:'IBM Plex Sans',sans-serif}
.chart .grid{stroke:var(--grid);stroke-width:1}.chart .axis{stroke:var(--axis);stroke-width:1}.chart .marker{stroke:var(--marker);stroke-width:1}
.chart .tick{fill:var(--ink-3);font-size:10px;font-variant-numeric:tabular-nums}.chart .value{fill:var(--ink);font-size:10px}
.chart .bar{fill:var(--series)}.chart .hit{fill:transparent}
.chart .col:hover .bar,.chart .col:focus .bar{opacity:.75}.chart .col:focus{outline:none}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{padding:10px 16px;font-weight:500;font-size:13px;color:var(--ink-2);text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:10px 16px;border-bottom:1px solid var(--line-2);vertical-align:top}
tr:last-child td{border-bottom:0}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.nowrap{white-space:nowrap}
.pkg{font-weight:500;overflow-wrap:anywhere}
.chip{display:inline-flex;align-items:center;gap:6px;background:var(--chip);border-radius:4px;padding:2px 8px;margin:1px 4px 1px 0;font-size:13px;white-space:nowrap}
.chip .cv{font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--ink-2)}
.ibox{flex:none;width:28px;height:28px;border-radius:6px;background:var(--chip);color:var(--ink-2);display:inline-flex;align-items:center;justify-content:center}
.feat{display:flex;align-items:flex-start;gap:10px}
.feat .t{font-weight:600}.feat .h{color:var(--ink-3);font-size:13px}
.idl{font-family:'IBM Plex Mono',monospace;font-size:12px}
.share{height:8px;background:var(--line-2);border-radius:4px}.share>div{height:8px;min-width:3px;background:var(--series);border-radius:4px}
.meter{display:flex;align-items:center;gap:10px;min-width:170px}
.meter .mv{width:32px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums}
.meter .track{position:relative;flex:1;height:8px;background:var(--line-2);border-radius:4px}
.meter .fill{height:8px;min-width:3px;background:var(--series);border-radius:4px}.meter .fill.hot{background:var(--bad-dot)}
.meter .tickm{position:absolute;top:-3px;width:2px;height:14px;background:var(--ink)}
.verdict-s{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;white-space:nowrap}
.verdict-s.ok{color:var(--good)}.verdict-s.bad{color:var(--bad)}.verdict-s.wait{color:var(--ink-3)}
.empty{padding:24px 20px;display:flex;flex-wrap:wrap;align-items:center;gap:16px}.empty .ico{color:var(--good)}
.saving{padding:14px 18px;display:flex;flex-direction:column;gap:4px}
.saving .v{font-size:22px;font-weight:600}.saving .v span{color:var(--ink-3);font-weight:400;font-size:15px}
.cols{display:flex;flex-wrap:wrap;gap:24px}.cols>section{flex:1 1 420px;min-width:0}
.ver{flex:1 1 480px;min-width:0;padding:16px 20px}
dl.kv{margin:0;display:grid;grid-template-columns:minmax(0,150px) minmax(0,1fr);gap:6px 16px}
dl.kv dt{color:var(--ink-2)}dl.kv dd{margin:0;overflow-wrap:anywhere}
.status-chip{display:inline-block;border-radius:4px;padding:1px 8px;font-size:12px;background:var(--chip)}
.status-chip.ok{background:var(--good-bg)}
.tl{padding:18px 20px 12px}
.tl .legend{color:var(--ink-2)}
.timeline{width:100%;height:auto;display:block;font-family:'IBM Plex Sans',sans-serif}
.timeline .axis{stroke:var(--axis);stroke-width:1}.timeline .tick{fill:var(--ink-3);font-size:11px}
.timeline .bracket{fill:none;stroke:var(--removed);stroke-width:1}
.timeline .t-note{fill:var(--ink-2);font-size:11px}.timeline .t-note.strong{fill:var(--ink);font-size:12px;font-weight:600}
.dot{stroke:var(--panel);stroke-width:1.5}
.dot.pub0{fill:var(--series)}.dot.pub1{fill:var(--pub1)}.dot.other{fill:var(--other)}
.dot.removed{fill:var(--panel);stroke:var(--removed)}.dot.event{fill:var(--bad-dot);stroke-width:2}
.ldot{width:10px;height:10px;border-radius:50%;display:inline-block}
.ldot.pub0{background:var(--series)}.ldot.pub1{background:var(--pub1)}.ldot.other{background:var(--other)}
.ldot.removed{border:1.5px solid var(--removed)}.ldot.event{background:var(--bad-dot)}
details.raw{padding:12px 16px}details.raw summary{cursor:pointer;color:var(--ink-2)}
pre{margin:12px 0 0;font:12px/1.45 'IBM Plex Mono',monospace;background:var(--chip);border-radius:6px;padding:12px;overflow:auto;max-height:560px}
code{font-family:'IBM Plex Mono',monospace;font-size:12px;background:var(--chip);border-radius:4px;padding:0 4px;overflow-wrap:anywhere}
.pager{display:flex;justify-content:space-between;align-items:center;gap:12px;color:var(--ink-3);font-size:13px}
.pager a{font-size:14px;min-height:44px;display:inline-flex;align-items:center}
@media (max-width:640px){form.search{margin-left:0;width:100%}form.search input{flex:1;width:auto}.step .val{font-size:30px}.big-score .v{font-size:44px}}
`;

// ── shared frame ─────────────────────────────────────────────────────

type Tab = 'overview' | 'alerts' | 'enriched' | 'flagged' | '';

function layout(ctx: Ctx, title: string, tab: Tab, hero: Raw, body: Raw, opts: { refresh?: number } = {}): string {
  const b = ctx.base;
  const tabs: [Tab, string, string][] = [
    ['overview', `${b}/`, 'Overview'],
    ['alerts', `${b}/enriched?alert=1`, 'Alerts'],
    ['enriched', `${b}/enriched`, 'Stage 2'],
    ['flagged', `${b}/flagged`, 'Stage 1'],
  ];
  return `<!doctype html>${html`<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · npm monitor</title>${opts.refresh ? raw(`<meta http-equiv="refresh" content="${opts.refresh}">`) : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${FONTS}">
<style>${raw(CSS)}</style></head>
<body><div class="band">
<header><div class="wrap">
  <a class="brand" href="${b}/">${icon('pulse', 22)}<span>npm monitor</span></a>
  <nav class="tabs" aria-label="Sections">${tabs.map(([id, href, name]) => (id === tab ? html`<a href="${href}" aria-current="page">${name}</a>` : html`<a href="${href}">${name}</a>`))}</nav>
  <form class="search" action="${b}/package" method="get" role="search">
    <label class="sr" for="pkg">Package</label><input id="pkg" name="name" type="search" placeholder="package, e.g. lodash">
    <button class="btn-ghost" type="submit">Search</button>
  </form>
</div></header>
<div class="wrap hero">${hero}</div>
</div>
<main class="wrap">${body}</main></body></html>`}`;
}

const eventLink = (ctx: Ctx, seq: string | number, text: unknown) => html`<a href="${ctx.base}/event/${seq}">${text}</a>`;
const pkgLink = (ctx: Ctx, name: string) => html`<a href="${ctx.base}/package${qs({ name })}">${name}</a>`;

const LANE_ICON: Record<string, string> = {
  temporal: 'temporal',
  version: 'version',
  nominal: 'nominal',
  watchlist: 'watchlist',
  registry: 'registry',
  publisher: 'publisher',
  maintainers: 'maintainers',
  manifest: 'manifest',
  versions: 'versions',
  repository: 'repository',
};
const laneIcon = (lane: string, size = 16) => icon(LANE_ICON[lane] ?? 'manifest', size);

// Feature value in short form — for chips and tables.
export function featureValue(x: Feature): string {
  const v = x.value;
  if (Array.isArray(v)) return v.join(', ');
  if (x.id.startsWith('name_')) return `→ ${v}`;
  if (x.id === 'rev_jump') return `+${v}`;
  if (x.id === 'watchlist') return `#${v}`;
  if (x.id.startsWith('rate_') || x.id === 'breadth_mature') return `z ${v}`;
  if (x.id === 'new_package') return `revision ${v}`;
  if (x.id === 'dormant_awake' || x.id === 'dormant_release' || x.id === 'publisher_returned') return `${v} d`;
  if (x.id === 'size_jump' || x.id === 'files_jump') return `×${v}`;
  return String(v);
}

// Feature details for the event card.
function featureDetail(x: Feature): string {
  const d = x.detail ?? {};
  if (x.id.startsWith('rate_') || x.id === 'breadth_mature') {
    const key = d.key ? ` · ${d.key}` : '';
    return `${d.count} in 10 min against a baseline of ${d.mean} (σ ${d.std})${key}`;
  }
  const rest = Object.entries(d).filter(([k]) => k !== 'versions');
  const versions = Array.isArray(d.versions) ? ` · versions ${(d.versions as string[]).join(', ')}` : '';
  return rest.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('; ') + versions;
}

function chips(features: Feature[] | null | undefined, withValue = false): Raw {
  return html`${(features ?? []).map(
    (x) => html`<span class="chip" title="${labelOf(x.id).hint}">${laneIcon(x.lane, 13)}${labelOf(x.id).title}${withValue ? html` <span class="cv">${featureValue(x)}</span>` : ''}</span>`,
  )}`;
}

function meter(value: number, scaleMax: number, threshold: number, hot = false): Raw {
  const max = Math.max(scaleMax, value);
  return html`<div class="meter"><span class="mv">${f.score(value)}</span><div class="track">
    <div class="fill${hot ? ' hot' : ''}" style="width:${((value / max) * 100).toFixed(1)}%"></div>
    <div class="tickm" style="left:${((threshold / max) * 100).toFixed(1)}%" aria-hidden="true"></div></div></div>`;
}

function verdictText(alert: boolean | null | undefined, enriched: boolean, candidate = true): Raw {
  if (!enriched) return candidate ? html`<span class="verdict-s wait">${icon('clock', 14)}awaiting enrichment</span>` : html`<span class="verdict-s wait">did not pass</span>`;
  return alert
    ? html`<span class="verdict-s bad">${icon('alert', 14, 2.4)}alert</span>`
    : html`<span class="verdict-s ok">${icon('check', 14, 2.6)}no alert</span>`;
}

// ── Overview ──────────────────────────────────────────────────────────

export interface OverviewData {
  status: Status;
  totals: Totals;
  hours: HourRow[];
  pulse: { minute: Date; n: number }[];
  usage: UsageRow[];
  features: FeatureCount[];
  alerts: EnrichedRow[];
  recent: EnrichedRow[];
}

const logWidth = (n: number, max: number) => (n <= 0 || max <= 0 ? 0 : (Math.log10(n + 1) / Math.log10(max + 1)) * 100);

export function overviewPage(ctx: Ctx, d: OverviewData): string {
  const { status: s, totals: t } = d;
  const c = s.collector;
  const polledAgo = c ? (Date.now() - new Date(c.polledAt).getTime()) / 1000 : Infinity;
  const lag1 = s.stage1?.lag ?? Infinity;
  const problems: string[] = [];
  if (polledAgo > 120) problems.push(`collector silent, last poll ${f.ago(c?.polledAt)}`);
  if (lag1 > 5000) problems.push(`stage 1 is ${f.int(lag1)} events behind`);
  if (s.stage2.queue > 200) problems.push(`stage 2 queue: ${f.int(s.stage2.queue)}`);
  const pill = problems.length === 0
    ? html`<p class="pill ok">${icon('check', 16, 2.4)}Pipeline running · polled ${f.ago(c?.polledAt)}</p>`
    : html`<p class="pill warn">${icon('alert', 16, 2.2)}${problems.join(' · ')}</p>`;

  const steps = [
    { n: '01', label: 'Registry feed', value: t.processed, note: 'events in 24 hours' },
    { n: '02', label: 'Stage 1 hits', value: t.flagged, note: `${f.pct(t.flagged, t.processed)} of the feed` },
    { n: '03', label: 'Stage 2 candidates', value: t.candidates, note: `${f.pct(t.candidates, t.processed)} of the feed` },
    { n: '04', label: 'Enriched', value: t.enriched, note: s.stage2.queue === 0 ? 'queue empty' : `${f.int(s.stage2.queue)} in queue` },
    { n: '05', label: 'Alerts', value: t.alerts, note: 'final score threshold 4', alert: true },
  ];
  const kept = t.processed > 0 ? 100 - (100 * t.candidates) / t.processed : 0;

  const pv = d.pulse.map((p) => p.n);
  const pAvg = pv.length ? Math.round(pv.reduce((a, b) => a + b, 0) / pv.length) : 0;
  const pFirst = d.pulse[0];
  const pMid = d.pulse[Math.floor(d.pulse.length / 2)];
  const pLast = d.pulse.at(-1);
  const hm = (x: { minute: Date } | undefined) => (x ? f.hour(x.minute).slice(-5) : '');

  const hero = html`
    <div class="row-between">
      <div><h1>Overview</h1><p class="lead">Last 24 hours · time zone ${f.tz} · observing since ${f.dateTime(s.journal.first)}</p></div>
      ${pill}
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <div class="funnel">${steps.map(
        (st) => html`<div class="step">
          <div class="lbl"><span class="num mono">${st.n}</span><span>${st.label}</span></div>
          <div class="val">${f.int(st.value)}</div>
          <div class="logbar${st.alert ? ' alert' : ''}"><div style="width:${logWidth(st.value, t.processed).toFixed(1)}%"></div></div>
          <div class="note">${st.note}</div>
        </div>`,
      )}</div>
      <p class="band-muted">Bar widths are logarithmic: otherwise the ${kept.toFixed(2)}% cut of the feed before costly enrichment is invisible.</p>
    </div>
    <div class="pulse">
      <div class="head"><div class="t">Feed pulse <span style="color:var(--band-ink-3);font-weight:400">· events per minute, last hour</span></div>
        <div class="s">now <b>${pv.at(-1) ?? 0}</b> · average <b>${pAvg}</b> · from ${pv.length ? Math.min(...pv) : 0} to ${pv.length ? Math.max(...pv) : 0}</div></div>
      ${sparkline(pv, `Events per minute over the last hour: average ${pAvg}`)}
      <div class="axis-x mono"><span>${hm(pFirst)}</span><span>${hm(pMid)}</span><span>${hm(pLast)}</span></div>
    </div>`;

  // The hour observation started, on the 48-hour axis.
  let startAt: number | null = null;
  if (s.journal.first && d.hours.length > 0) {
    const first = new Date(s.journal.first).getTime();
    const h0 = new Date(d.hours[0]!.hour).getTime();
    const idx = (first - h0) / 3_600_000;
    if (idx > 0 && idx < d.hours.length) startAt = idx;
  }
  const pts = (key: 'processed' | 'candidates') => d.hours.map((h) => ({ label: f.hour(h.hour), value: Number(h[key]) }));

  const requests = d.usage.reduce((a, u) => a + u.requests, 0);
  const perCandidate = t.enriched > 0 ? requests / t.enriched : 0;
  const featMax = Math.max(1, ...d.features.filter((x) => x.stage === 1).map((x) => x.count));
  const stageState = (ok: boolean, warn: boolean) => (ok ? 'ok' : warn ? 'warn' : 'bad');

  const body = html`
  <section aria-labelledby="pipe-h">
    <h2 id="pipe-h">Pipeline status</h2>
    <div class="grid-auto">
      ${pipeTile('Collector', stageState(polledAgo < 60, polledAgo < 600), `Polled ${f.ago(c?.polledAt)}`, `lag behind the feed head: ${c && c.headSeq !== null ? f.int(Math.max(0, c.headSeq - c.lastSeq)) : '—'} seq`)}
      ${pipeTile('Stage 1', stageState(lag1 < 500, lag1 < 5000), lag1 < 500 ? 'In step with the journal' : `${f.int(lag1)} events behind`, `popular-package snapshot of ${s.popular.snapshot ?? '—'}: ${f.int(s.popular.names)} names`)}
      ${pipeTile('Stage 2', stageState(s.stage2.queue < 50, s.stage2.queue < 500), `${f.int(s.stage2.queue)} in queue`, `last enrichment ${f.ago(s.stage2.lastAt)}`)}
    </div>
  </section>

  <section aria-labelledby="hours-h">
    <h2 id="hours-h">Hourly, 48 hours</h2>
    <div class="grid-auto">
      ${columnChart('Feed events per hour', pts('processed'), { startAt })}
      ${columnChart('Stage 2 candidates per hour', pts('candidates'), { startAt })}
    </div>
    <details class="panel raw"><summary>Hourly table</summary><div class="scroll"><table>
      <tr><th>Hour</th><th class="num">Events</th><th class="num">Candidates</th><th class="num">Share</th><th class="num">Enriched</th><th class="num">Alerts</th></tr>
      ${[...d.hours].reverse().filter((h) => h.processed > 0).map((h) => html`<tr><td>${f.hour(h.hour)}</td><td class="num">${f.int(h.processed)}</td><td class="num">${f.int(h.candidates)}</td><td class="num">${f.pct(h.candidates, h.processed)}</td><td class="num">${f.int(h.enriched)}</td><td class="num">${f.int(h.alerts)}</td></tr>`)}
    </table></div></details>
  </section>

  <section aria-labelledby="alerts-h">
    <h2 id="alerts-h">Latest alerts</h2>
    ${
      d.alerts.length === 0
        ? html`<div class="panel empty">${icon('shield', 32, 1.7)}<div style="flex:1 1 320px"><div style="font-weight:600">No alerts yet</div>
            <div class="sub" style="margin:0">No candidate's final score has reached the threshold of 4.</div></div></div>`
        : enrichedTable(ctx, d.alerts)
    }
  </section>

  <div class="cols">
    <section aria-labelledby="feat-h" style="flex:1 1 540px">
      <h2 id="feat-h">Feature hits, 24 hours</h2>
      <div class="panel scroll"><table>
        <tr><th>Feature</th><th style="width:30%">Share of stage 1 events</th><th class="num">Events</th></tr>
        ${d.features.map(
          (x) => html`<tr>
            <td><div class="feat"><span class="ibox">${laneIcon(laneOf(x.id))}</span><div style="min-width:0">
              <a href="${x.stage === 1 ? `${ctx.base}/flagged${qs({ feature: x.id })}` : `${ctx.base}/enriched`}">${labelOf(x.id).title}</a>
              <div class="h">stage ${x.stage} · ${LANE_LABELS[laneOf(x.id)] ?? ''} · <span class="idl">${x.id}</span></div></div></div></td>
            <td>${x.stage === 1 ? html`<div class="share"><div style="width:${((x.count / featMax) * 100).toFixed(1)}%"></div></div>` : ''}</td>
            <td class="num">${f.int(x.count)}</td>
          </tr>`,
        )}
      </table></div>
    </section>
    <section aria-labelledby="src-h">
      <h2 id="src-h">Source requests, 24 hours</h2>
      <div class="panel scroll"><table>
        <tr><th>Source</th><th class="num">Requests</th><th class="num">Errors</th><th class="num">Quota skips</th></tr>
        ${d.usage.length === 0 ? html`<tr><td colspan="4" class="muted">No requests yet.</td></tr>` : ''}
        ${d.usage.map((u) => html`<tr><td>${SOURCE_NAMES[u.source] ?? u.source}</td><td class="num">${f.int(u.requests)}</td><td class="num">${f.int(u.errors)}</td><td class="num">${f.int(u.skipped)}</td></tr>`)}
      </table></div>
      ${
        perCandidate > 0
          ? html`<div class="panel saving"><div class="sub" style="margin:0;font-size:13px">Without stage 1 the whole feed would need enrichment</div>
              <div class="v">≈ ${f.compact(Math.round(t.processed * perCandidate))} requests <span>instead of ${f.int(requests)}</span></div>
              <div class="muted" style="font-size:13px">${f.int(t.processed)} events × ${+perCandidate.toFixed(1)} requests per candidate</div></div>`
          : ''
      }
    </section>
  </div>

  <section aria-labelledby="recent-h">
    <h2 id="recent-h">Latest enriched</h2>
    ${d.recent.length === 0 ? html`<div class="panel empty"><div class="muted">None yet.</div></div>` : enrichedTable(ctx, d.recent)}
  </section>`;
  return layout(ctx, 'Overview', 'overview', hero, body, { refresh: 60 });
}

const SOURCE_NAMES: Record<string, string> = { registry: 'npm registry', ecosystems: 'ecosyste.ms', depsdev: 'deps.dev', github: 'GitHub', rdap: 'RDAP' };

// Lane of a feature by id (for the hit table, which stores only the id).
function laneOf(id: string): string {
  if (id.startsWith('rate_') || id === 'breadth_mature') return 'temporal';
  if (id.startsWith('name_')) return 'nominal';
  if (id === 'watchlist') return 'watchlist';
  if (['rev_jump', 'rev_regression', 'dormant_awake', 'new_package'].includes(id)) return 'version';
  if (['package_missing', 'version_removed'].includes(id)) return 'registry';
  if (id.startsWith('publisher_') || id === 'trusted_config_changed') return 'publisher';
  if (id === 'maintainers_added' || id.startsWith('email_')) return 'maintainers';
  if (id.startsWith('install_') || ['size_jump', 'files_jump', 'deps_added'].includes(id)) return 'manifest';
  if (['non_adjacent_branches', 'multi_branch', 'major_jump', 'dormant_release'].includes(id)) return 'versions';
  return 'repository';
}

function pipeTile(name: string, state: string, main: string, note: string): Raw {
  const label = state === 'ok' ? 'running' : state === 'warn' ? 'delayed' : 'problem';
  return html`<div class="panel tile"><div class="head"><span style="font-weight:600">${name}</span>
    <span class="state ${state}">${icon(state === 'ok' ? 'check' : 'alert', 14, 2.4)}${label}</span></div>
    <div>${main}</div><div class="n">${note}</div></div>`;
}

function enrichedTable(ctx: Ctx, rows: EnrichedRow[]): Raw {
  return html`<div class="panel scroll"><table style="min-width:860px">
    <tr><th>Time</th><th>Package</th><th>Versions</th><th>Score</th><th>Verdict</th><th>Features</th></tr>
    ${rows.map(
      (r) => html`<tr>
        <td class="nowrap">${eventLink(ctx, r.seq, f.time(r.event_time))}</td>
        <td class="pkg">${pkgLink(ctx, r.package)}</td>
        <td class="mono" style="font-size:13px">${r.versions.length > 0 ? r.versions.join(', ') : html`<span class="muted">${KIND_NAMES[r.kind] ?? r.kind}</span>`}</td>
        <td>${meter(r.final_score, 10, 4, r.alert)}</td>
        <td>${verdictText(r.alert, true)}</td>
        <td>${chips([...(r.stage1 ?? []).filter((x) => x.weight > 0 || x.id === 'watchlist'), ...r.features], true)}</td>
      </tr>`,
    )}
  </table></div>`;
}

const KIND_NAMES: Record<string, string> = { metadata: 'metadata', package_missing: 'package gone', error: 'error', publish: 'publication' };

// ── Lists ─────────────────────────────────────────────────────────────

function pager(ctx: Ctx, path: string, params: Record<string, string | number | boolean | null>, page: number, hasMore: boolean, note: string): Raw {
  return html`<div class="pager"><span>${note}</span><span style="display:flex;gap:18px">
    ${page > 1 ? html`<a href="${ctx.base}${path}${qs({ ...params, page: page - 1 })}">← Newer</a>` : ''}
    ${hasMore ? html`<a href="${ctx.base}${path}${qs({ ...params, page: page + 1 })}">Older →</a>` : ''}</span></div>`;
}

export function enrichedPage(ctx: Ctx, rows: EnrichedRow[], q: { alertOnly: boolean; minScore: number; page: number; pageSize: number }): string {
  const title = q.alertOnly ? 'Alerts' : 'Stage 2';
  const hero = html`
    <div><h1>${title}</h1><p class="lead">${q.alertOnly ? 'Candidates whose final score reached the threshold of 4.' : 'Candidates after enrichment: final score, verdict and the fired features of both stages.'}</p></div>
    <div class="filters">
      ${!q.alertOnly ? html`<a class="fpill" href="${ctx.base}/enriched" aria-current="true">All enriched</a>` : html`<a class="fpill" href="${ctx.base}/enriched">All enriched</a>`}
      ${q.alertOnly ? html`<a class="fpill" href="${ctx.base}/enriched?alert=1" aria-current="true">${icon('alert', 14, 2.2)}Alerts only</a>` : html`<a class="fpill" href="${ctx.base}/enriched?alert=1">${icon('alert', 14, 2.2)}Alerts only</a>`}
      <form class="inline" method="get" action="${ctx.base}/enriched">
        ${q.alertOnly ? html`<input type="hidden" name="alert" value="1">` : ''}
        <label for="min">score from</label><input id="min" type="text" name="min" value="${q.minScore || ''}" inputmode="decimal">
        <button class="btn-ghost" type="submit">Show</button>
      </form>
    </div>`;
  const body = html`<section>
    ${rows.length === 0 ? html`<div class="panel empty">${icon('shield', 28, 1.7)}<div>${q.alertOnly ? 'No alerts.' : 'Nothing found.'}</div></div>` : enrichedTable(ctx, rows.slice(0, q.pageSize))}
    ${pager(ctx, '/enriched', { alert: q.alertOnly ? 1 : null, min: q.minScore || null }, q.page, rows.length > q.pageSize, 'Bar — score on a scale to 10; the black tick is the alert threshold of 4.')}
  </section>`;
  return layout(ctx, title, q.alertOnly ? 'alerts' : 'enriched', hero, body);
}

export function flaggedPage(ctx: Ctx, rows: FlaggedRow[], counts: FeatureCount[], q: { feature: string | null; candidateOnly: boolean; page: number; pageSize: number }): string {
  const s1 = counts.filter((x) => x.stage === 1);
  const total = s1.reduce((a, x) => a + x.count, 0);
  const link = (feature: string | null, candidate: boolean) => `${ctx.base}/flagged${qs({ feature, candidate: candidate ? 1 : null })}`;
  const hero = html`
    <div><h1>Stage 1${q.feature ? html` · ${labelOf(q.feature).title}` : ''}</h1>
      <p class="lead">${q.feature ? labelOf(q.feature).hint : 'Events where at least one feature fired. Candidate threshold — prescore 2.'}</p></div>
    <div class="filters">
      ${q.feature === null ? html`<a class="fpill" href="${link(null, q.candidateOnly)}" aria-current="true">All features <span class="c">${f.int(total)}</span></a>` : html`<a class="fpill" href="${link(null, q.candidateOnly)}">All features <span class="c">${f.int(total)}</span></a>`}
      ${s1.map((x) =>
        x.id === q.feature
          ? html`<a class="fpill" href="${link(x.id, q.candidateOnly)}" aria-current="true">${laneIcon(laneOf(x.id), 14)}${labelOf(x.id).title} <span class="c">${f.int(x.count)}</span></a>`
          : html`<a class="fpill" href="${link(x.id, q.candidateOnly)}">${laneIcon(laneOf(x.id), 14)}${labelOf(x.id).title} <span class="c">${f.int(x.count)}</span></a>`,
      )}
      ${q.candidateOnly ? html`<a class="fpill" href="${link(q.feature, false)}" aria-current="true" style="margin-left:auto">${icon('check', 14, 2.4)}candidates only</a>` : html`<a class="fpill" href="${link(q.feature, true)}" style="margin-left:auto">candidates only</a>`}
    </div>
    <p class="band-muted">Counts are for the last 24 hours.</p>`;
  const body = html`<section>
    ${
      rows.length === 0
        ? html`<div class="panel empty"><div class="muted">Nothing found.</div></div>`
        : html`<div class="panel scroll"><table style="min-width:900px">
      <tr><th>Time</th><th>Package</th><th>Features</th><th style="width:210px">Prescore</th><th>Next</th></tr>
      ${rows.slice(0, q.pageSize).map(
        (r) => html`<tr>
          <td class="nowrap">${eventLink(ctx, r.seq, f.time(r.event_time))}</td>
          <td class="pkg">${pkgLink(ctx, r.package)}</td>
          <td>${chips(r.features, true)}</td>
          <td>${meter(r.prescore, 3, 2)}</td>
          <td>${r.final_score === null ? verdictText(null, false, r.candidate) : html`${verdictText(r.alert, true)} <span class="muted">· ${f.score(r.final_score)}</span>`}</td>
        </tr>`,
      )}
    </table></div>`
    }
    ${pager(ctx, '/flagged', { feature: q.feature, candidate: q.candidateOnly ? 1 : null }, q.page, rows.length > q.pageSize, 'Bar — score on a scale to 3; the black tick is the candidate threshold of 2.')}
  </section>`;
  return layout(ctx, 'Stage 1', 'flagged', hero, body);
}

// ── Event card ────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : String(v));

function versionBlock(v: Json, title: string, inRegistry: string | null): Raw {
  const pub = obj(v.publisher);
  const trusted = obj(pub.trusted);
  const dist = obj(v.dist);
  const lifecycle = Object.entries(obj(v.lifecycle));
  const scripts = Object.keys(obj(v.scripts));
  const deps = Object.keys(obj(v.dependencies));
  const maint = arr(v.maintainers).map(String);
  const domain = typeof pub.emailDomain === 'string' ? pub.emailDomain : '';
  return html`<div class="panel ver"><h3>${title} <span class="mono" style="font-weight:500">${s(v.version)}</span></h3><dl class="kv">
    <dt>Published</dt><dd>${f.time(v.time as string)}</dd>
    <dt>Publisher</dt><dd>${trusted.id ? html`CI: ${s(trusted.id)} <span class="muted mono">${s(trusted.config)}</span>` : html`${s(pub.name)}${domain ? html` <span class="muted">· e-mail at ${domain}</span>` : ''}`}</dd>
    <dt>Maintainers</dt><dd>${maint.length === 0 ? '—' : maint.length > 4 ? `${maint.length} accounts: ${maint.slice(0, 4).join(', ')}…` : maint.join(', ')}</dd>
    <dt>Install scripts</dt><dd>${lifecycle.length === 0 ? html`none${scripts.length ? html` <span class="muted">(${scripts.slice(0, 5).join(', ')} do not run on install)</span>` : ''}` : lifecycle.map(([k, cmd]) => html`<div><code>${k}: ${String(cmd)}</code></div>`)}</dd>
    <dt>Size</dt><dd>${f.bytes(dist.unpackedSize as number | null)} · ${s(dist.fileCount)} files</dd>
    <dt>Dependencies</dt><dd>${deps.length === 0 ? 'none' : `${deps.length}: ${deps.slice(0, 12).join(', ')}${deps.length > 12 ? '…' : ''}`}</dd>
    <dt>Attestation</dt><dd>${dist.provenance ? html`yes <span class="muted">${String(dist.provenance).replace('https://', '')}</span>` : 'none'}</dd>
    <dt>Repository</dt><dd>${s(v.repository)}</dd>
    <dt>gitHead</dt><dd>${v.gitHead ? html`<span class="mono" style="font-size:12px">${String(v.gitHead)}</span>` : 'none'}</dd>
    ${inRegistry ? html`<dt>In the registry now</dt><dd>${inRegistry}</dd>` : ''}
  </dl></div>`;
}

function githubLink(repo: unknown): Raw {
  const m = typeof repo === 'string' ? /^([\w.-]+)\/([\w.-]+)$/.exec(repo) : null;
  return m ? html`<a href="https://github.com/${m[1]}/${m[2]}" rel="noreferrer">${repo}</a>` : html`${s(repo)}`;
}

function sourceRow(name: string, src: unknown, gave: Raw | string): Raw {
  const o = obj(src);
  const status = o.cached ? 'cached' : o.status !== undefined ? String(o.status) : o.skipped === 'quota' ? 'skipped: quota' : o.skipped ? `error${o.error ? `: ${o.error}` : ''}` : 'not requested';
  const ok = o.status === 200 || o.cached === true;
  return html`<tr><td style="font-weight:500">${name}</td><td class="nowrap"><span class="status-chip${ok ? ' ok' : ''}">${status}</span></td><td>${gave}</td></tr>`;
}

function timelineSection(reg: Json, s2Features: Feature[]): Raw {
  const tl = obj(reg.timeline);
  const pts = arr(tl.points) as [string, number, number][];
  if (pts.length === 0) return html``;
  const publishers = arr(tl.publishers).map(String);
  const eventSet = new Set(arr(reg.event).map(String));
  const counts = publishers.map((_, i) => pts.filter((p) => p[2] === i && !eventSet.has(p[0])).length);
  const order = counts.map((c, i) => [c, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  const kindOf = (p: [string, number, number]): TimelinePoint['kind'] => {
    if (eventSet.has(p[0])) return 'event';
    if (p[2] === -1) return 'removed';
    if (p[2] === order[0]) return 'pub0';
    if (p[2] === order[1]) return 'pub1';
    return 'other';
  };
  const points: TimelinePoint[] = pts.map((p) => ({ version: p[0], t: p[1] * 1000, kind: kindOf(p) }));
  const events = points.filter((p) => p.kind === 'event');
  const before = points.filter((p) => p.kind !== 'event' && events.length > 0 && p.t < Math.min(...events.map((e) => e.t)));
  let gap: { from: number; to: number; label: string } | null = null;
  if (events.length > 0 && before.length > 0) {
    const from = Math.max(...before.map((p) => p.t));
    const to = Math.min(...events.map((e) => e.t));
    const days = Math.floor((to - from) / 86_400_000);
    if (days >= 90) gap = { from, to, label: `${days} days of silence` };
  }
  const removed = points.filter((p) => p.kind === 'removed').length;
  const short = (k: string) => k.replace(/^user:/, '').replace(/^trusted:/, 'CI ');
  const total = Number(tl.total ?? pts.length);
  const spanFirst = points[0] ? new Date(points[0].t).getFullYear() : '';
  const burstNote = s2Features.find((x) => x.id === 'non_adjacent_branches' || x.id === 'multi_branch');
  return html`<section class="panel tl" aria-labelledby="tl-h">
    <div class="row-between" style="align-items:baseline">
      <h2 id="tl-h">Package version history</h2>
      <div class="legend">
        ${order[0] !== undefined ? html`<span><span class="ldot pub0"></span>${short(publishers[order[0]]!)} · ${counts[order[0]]}</span>` : ''}
        ${order[1] !== undefined ? html`<span><span class="ldot pub1"></span>${short(publishers[order[1]]!)} · ${counts[order[1]]}</span>` : ''}
        ${order.length > 2 ? html`<span><span class="ldot other"></span>other publishers</span>` : ''}
        ${removed > 0 ? html`<span><span class="ldot removed"></span>purged by the registry · ${removed}</span>` : ''}
        <span><span class="ldot event"></span>event versions</span>
      </div>
    </div>
    <p class="sub" style="margin:0">From the registry's <span class="mono">time</span> field — it keeps the dates of purged versions too${total > pts.length ? `; showing the last ${pts.length} of ${total}` : `, since ${spanFirst}`}.${burstNote ? ` ${labelOf(burstNote.id).title}: ${featureValue(burstNote)}.` : ''}</p>
    ${versionTimeline(points, gap, `Version timeline: ${pts.length} versions, ${events.length} in the event`)}
  </section>`;
}

export function eventPage(ctx: Ctx, card: EventCard, others: PackageEventRow[]): string {
  const { event: e, stage1: st1, stage2: st2 } = card;
  const ev = obj(st2?.evidence);
  const reg = obj(ev.registry);
  const versions = arr(reg.versions).map(obj);
  const prev = reg.previous ? obj(reg.previous) : null;
  const removedNow = new Set(arr(reg.removed).map((r) => String(obj(r).version)));
  const sources = obj(st2?.sources);
  const eco = obj(ev.ecosystems_package);
  const dd = obj(ev.depsdev);
  const gh = obj(ev.github_commit);
  const rdap = obj(ev.rdap);
  const pubEco = obj(ev.ecosystems_publisher);
  const s1f = st1?.features ?? [];
  const s2f = st2?.features ?? [];
  const s1Sum = s1f.reduce((a, x) => a + x.weight, 0);
  const s2Sum = s2f.reduce((a, x) => a + x.weight, 0);
  const finalScore = st2 ? st2.final_score : st1?.prescore ?? 0;
  const versionText = st2 && st2.versions.length > 0 ? st2.versions.join(', ') : '';

  const segs = [...s1f.map((x) => ({ x, stage: 1 })), ...s2f.map((x) => ({ x, stage: 2 }))].filter((g) => g.x.weight > 0);
  const scaleMax = Math.max(10, Math.ceil(finalScore));
  const thr = st2 ? 4 : 2;
  const pill = st2
    ? st2.alert
      ? html`<span class="pill bad">${icon('alert', 18, 2.2)}Alert</span>`
      : html`<span class="pill ok">${icon('check', 16, 2.4)}No alert</span>`
    : st1?.candidate
      ? html`<span class="pill warn">${icon('clock', 16, 2.2)}Awaiting enrichment</span>`
      : html`<span class="pill warn" style="background:#2A2B30;color:#C9C7C0">Did not pass stage 1</span>`;

  const hero = html`
    <div style="display:flex;flex-direction:column;gap:6px">
      <nav class="crumbs" aria-label="Breadcrumbs"><a href="${ctx.base}/${st2?.alert ? 'enriched?alert=1' : st2 ? 'enriched' : 'flagged'}">${st2?.alert ? 'Alerts' : st2 ? 'Stage 2' : 'Stage 1'}</a> / ${e.package}</nav>
      <div class="title-row"><h1>${e.package}</h1>${versionText ? html`<span class="ver">${versionText}</span>` : ''}${pill}</div>
      <p class="lead">event seq ${e.seq} · revision <span class="mono">${e.rev.split('-')[0]}</span>${e.deleted ? ' · package deletion' : ''} ·
        <a href="https://www.npmjs.com/package/${e.package}" rel="noreferrer">npmjs.com</a> · <a href="https://deps.dev/npm/${encodeURIComponent(e.package)}" rel="noreferrer">deps.dev</a> · ${pkgLink(ctx, e.package)}: all events</p>
    </div>
    <div class="verdict">
      <div class="big-score"><div class="k">${st2 ? 'Final score' : 'Prescore'}</div><div class="v">${f.score(finalScore)}</div><div class="n">${st2 ? 'alert' : 'candidate'} threshold ${thr}</div></div>
      ${
        segs.length > 0
          ? html`<div class="compose">
          <div class="legend"><span><span class="sw" style="background:var(--band-s1)"></span>stage 1 · ${f.score(s1Sum)}</span>${st2 ? html`<span><span class="sw" style="background:var(--band-s2)"></span>stage 2 · ${f.score(s2Sum)}</span>` : ''}</div>
          <div class="scorebar">
            <div class="thr-l" style="left:${((thr / scaleMax) * 100).toFixed(1)}%">threshold ${thr}</div>
            <div class="thr" style="left:${((thr / scaleMax) * 100).toFixed(1)}%" aria-hidden="true"></div>
            <div class="bar" role="img" aria-label="Score composition: ${segs.map((g) => `${labelOf(g.x.id).title} ${f.score(g.x.weight)}`).join(', ')}">
              ${segs.map((g) => html`<div class="seg s${g.stage}" style="width:${((g.x.weight / scaleMax) * 100).toFixed(1)}%" title="${labelOf(g.x.id).title}: ${f.score(g.x.weight)}"><span class="lt">${f.score(g.x.weight)} · ${labelOf(g.x.id).short}</span></div>`)}
            </div>
            <div class="scale"><span>0</span><span>${scaleMax}</span></div>
          </div></div>`
          : html`<div class="compose"><p class="band-muted" style="font-size:13px">${s1f.length + s2f.length === 0 ? 'No feature fired.' : `Only zero-weight features fired: ${[...s1f, ...s2f].map((x) => labelOf(x.id).title).join(', ')}.`}</p></div>`
      }
    </div>`;

  const firstVersion = versions[0];
  const body = html`
  ${timelineSection(reg, s2f)}

  <section aria-label="Timing" class="grid-auto">
    <div class="panel tile"><div class="k">Published</div><div class="v">${firstVersion ? f.time(firstVersion.time as string) : '—'}</div><div class="n">registry time, ${f.tz}</div></div>
    <div class="panel tile"><div class="k">Observed</div><div class="v">${f.time(e.observed_at)}</div><div class="n">appeared after ${f.time(e.observed_after)}</div></div>
    <div class="panel tile"><div class="k">Enriched</div><div class="v">${st2 ? f.time(st2.enriched_at) : '—'}</div><div class="n">${st2 ? `${Math.max(0, Math.round((new Date(st2.enriched_at).getTime() - new Date(e.observed_at).getTime()) / 60000))} min after observation` : 'not performed'}</div></div>
    <div class="panel tile"><div class="k">Stage 1</div><div class="v">${st1?.candidate ? 'candidate' : st1 ? 'not a candidate' : 'no features'}</div><div class="n">prescore ${f.score(st1?.prescore ?? 0)} against a threshold of 2</div></div>
  </section>

  <section aria-labelledby="why-h">
    <h2 id="why-h">Why this score</h2>
    ${
      s1f.length + s2f.length === 0
        ? html`<div class="panel empty"><div class="muted">No feature fired.</div></div>`
        : html`<div class="panel scroll"><table style="min-width:760px">
        <tr><th style="width:80px">Stage</th><th>Feature</th><th>Value</th><th class="num">Weight</th></tr>
        ${[...s1f.map((x) => ({ x, stage: 1 })), ...s2f.map((x) => ({ x, stage: 2 }))].map(
          ({ x, stage }) => html`<tr>
            <td><span style="display:inline-flex;align-items:center;gap:6px"><span class="sw" style="width:10px;height:10px;background:${stage === 1 ? 'var(--series)' : 'var(--series-2)'}"></span>${stage}</span></td>
            <td><div class="feat"><span class="ibox">${laneIcon(x.lane)}</span><div><div class="t">${labelOf(x.id).title}</div>
              <div class="h">${LANE_LABELS[x.lane] ?? x.lane} · ${labelOf(x.id).hint} · <span class="idl">${x.id}</span></div></div></div></td>
            <td>${featureValue(x)}${x.threshold !== undefined ? html` <span class="muted">(threshold ${x.threshold})</span>` : ''}<div class="muted" style="font-size:13px">${featureDetail(x)}</div></td>
            <td class="num" style="font-weight:600">${f.score(x.weight)}</td>
          </tr>`,
        )}
        <tr><td colspan="3" style="font-weight:600">Total <span class="muted" style="font-weight:400">· ${st2 ? 'alert' : 'candidate'} threshold ${thr}</span></td><td class="num" style="font-weight:600;font-size:16px">${f.score(finalScore)}</td></tr>
      </table></div>`
    }
  </section>

  ${
    versions.length > 0 || prev
      ? html`<section aria-labelledby="pub-h"><h2 id="pub-h">Publication</h2><div class="grid-auto">
      ${versions.map((v) => versionBlock(v, 'Version', null))}
      ${prev ? versionBlock(prev, 'Previous version', null) : ''}
    </div></section>`
      : ''
  }

  ${
    st2 && arr(obj(reg.timeline).points).length === 0 && arr(reg.burst).length > 0
      ? html`<section aria-labelledby="burst-h"><h2 id="burst-h">Versions close in time</h2><div class="panel scroll"><table>
      <tr><th>Version</th><th>Time</th><th>In the registry</th></tr>
      ${arr(reg.burst).map(obj).map((b) => html`<tr><td class="mono">${s(b.version)}</td><td>${f.time(b.time as string)}</td><td>${b.present ? 'present' : html`<span class="verdict-s bad">${icon('cross', 14, 2.4)}purged</span>`}</td></tr>`)}
    </table></div></section>`
      : ''
  }

  ${
    st2
      ? html`<section aria-labelledby="src-h2"><h2 id="src-h2">Sources</h2><div class="panel scroll"><table style="min-width:640px">
      <tr><th>Source</th><th>Response</th><th>What it gave</th></tr>
      ${sourceRow('npm registry', sources.registry, `packument: ${versions.length} event version(s), history of ${s(obj(reg.history).versions)} versions${removedNow.size ? `, ${removedNow.size} purged` : ''}`)}
      ${sourceRow('ecosyste.ms', sources.ecosystems_package, eco.found ? html`${githubLink(eco.repo)} · ${eco.archived ? 'archived' : 'not archived'} · push ${f.date(eco.pushedAt as string)}` : 'package not in the index')}
      ${sources.ecosystems_publisher ? sourceRow('ecosyste.ms: publisher', sources.ecosystems_publisher, pubEco.found ? `in the index since ${f.date(pubEco.firstSeen as string)} · ${s(pubEco.packages)} packages` : 'account not in the index') : ''}
      ${sourceRow('deps.dev', sources.depsdev, dd.found ? `attested source: ${arr(dd.attestedSource).join(', ') || 'none'} · ${s(dd.attestations)} attestations` : 'version not in the index')}
      ${sourceRow('GitHub', sources.github_commit, gh.repo ? html`${githubLink(gh.repo)} · commit <span class="mono" style="font-size:12px">${String(gh.sha ?? '').slice(0, 12)}</span>: ${gh.found === true ? 'found' : gh.found === false ? html`<strong class="bad">not found</strong>` : s(gh.status)}` : 'no gitHead — nothing to check')}
      ${sourceRow('RDAP', sources.rdap, rdap.domain ? `${String(rdap.domain)} · registered ${f.date(rdap.registered as string)} · expires ${f.date(rdap.expires as string)}` : 'publisher e-mail at a mass provider or CI')}
    </table></div></section>`
      : html`<section><div class="panel empty"><div class="muted">${st1?.candidate ? 'The candidate is awaiting enrichment at stage 2.' : 'The event did not pass stage 1; enrichment was not performed.'}</div></div></section>`
  }

  <section aria-labelledby="other-h"><h2 id="other-h">Other events of this package</h2>${packageTable(ctx, others, Number(e.seq))}</section>

  <details class="panel raw"><summary>Full snapshot (JSON)</summary><pre>${JSON.stringify({ event: e, stage1: st1, stage2: st2 }, null, 2)}</pre></details>`;
  return layout(ctx, e.package, st2?.alert ? 'alerts' : '', hero, body);
}

function packageTable(ctx: Ctx, rows: PackageEventRow[], current?: number): Raw {
  if (rows.length === 0) return html`<div class="panel empty"><div class="muted">No events.</div></div>`;
  return html`<div class="panel scroll"><table style="min-width:760px">
    <tr><th>Time</th><th>Revision</th><th>Stage 1 features</th><th>Versions</th><th>Result</th></tr>
    ${rows.map(
      (r) => html`<tr>
        <td class="nowrap">${Number(r.seq) === current ? html`<strong>${f.time(r.observed_at)}</strong> <span class="muted">· this event</span>` : eventLink(ctx, r.seq, f.time(r.observed_at))}</td>
        <td class="mono">${r.rev.split('-')[0]}${r.deleted ? ' · deletion' : ''}</td>
        <td>${chips(r.s1, true)}</td>
        <td class="mono" style="font-size:13px">${r.versions?.join(', ') ?? ''}</td>
        <td>${r.final_score === null ? (r.candidate ? verdictText(null, false, true) : '') : html`${verdictText(r.alert, true)} <span class="muted">· ${f.score(r.final_score)}</span>`}</td>
      </tr>`,
    )}
  </table></div>`;
}

export function packagePage(ctx: Ctx, name: string, rows: PackageEventRow[]): string {
  const hero = html`<div><h1>${name}</h1><p class="lead">Events of this package in the journal — last ${rows.length} ·
    <a href="https://www.npmjs.com/package/${name}" rel="noreferrer">npmjs.com</a> · <a href="https://deps.dev/npm/${encodeURIComponent(name)}" rel="noreferrer">deps.dev</a></p></div>`;
  return layout(ctx, name, '', hero, html`<section>${packageTable(ctx, rows)}</section>`);
}

export function messagePage(ctx: Ctx, title: string, text: string): string {
  return layout(ctx, title, '', html`<div><h1>${title}</h1><p class="lead">${text}</p></div>`, html``);
}
