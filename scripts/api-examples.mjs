// Captures the examples of the API reference from a running instance, so that every example in
// the specification is an answer the server really gave.
//
//   node scripts/api-examples.mjs <base-url> [degraded-base-url]     e.g. http://127.0.0.1:8090/npm
//
// The optional second instance is one whose collector is stopped: it gives the 503 answer of /health.
//
// Writes src/api/examples.ts (used by the OpenAPI document) and documentation/api/examples/*.
// Long lists are cut to two items and account names are replaced by neutral labels: the
// reference must not publish personal data.

import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2];
if (!base) {
  console.error('usage: node scripts/api-examples.mjs <base-url>');
  process.exit(2);
}
const API = `${base.replace(/\/$/, '')}/api/v1`;

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${API}${path}`, { method, headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// ── shorten: at most two items of a list, at most `depth` levels of nested evidence ────────
function shorten(v, keep = 2) {
  if (Array.isArray(v)) return v.slice(0, keep).map((x) => shorten(x, keep));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shorten(x, keep)]));
  if (typeof v === 'string' && v.length > 160) return `${v.slice(0, 157)}…`;
  return v;
}

// ── account names → labels ───────────────────────────────────────────────────────────────
function accountNames(v, out = new Set(), key = '') {
  if (Array.isArray(v)) {
    if (['maintainers', 'added', 'removed'].includes(key)) for (const x of v) if (typeof x === 'string') out.add(x);
    for (const x of v) accountNames(x, out, key);
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const m = /^user:(.+)$/.exec(k);
      if (m) out.add(m[1]);
      if (k === 'publisher' && x && typeof x === 'object' && typeof x.name === 'string') out.add(x.name);
      if ((k === 'value' || k === 'recent') && key !== 'time') for (const s of [x].flat()) { const u = typeof s === 'string' && /^user:(.+)$/.exec(s); if (u) out.add(u[1]); }
      accountNames(x, out, k);
    }
  }
  return out;
}
function relabel(value) {
  const names = [...accountNames(value)].filter((n) => n.length > 1).sort((a, b) => b.length - a.length);
  let text = JSON.stringify(value);
  names.forEach((n, i) => {
    const label = `account-${i + 1}`;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`"${esc}"`, 'g'), `"${label}"`).replace(new RegExp(`user:${esc}(?=["\\s])`, 'g'), `user:${label}`);
  });
  // owners of repositories are accounts too
  const owners = new Set([...text.matchAll(/github\.com[/:]([A-Za-z0-9_.-]+)\//g)].map((m) => m[1]));
  for (const o of owners) text = text.split(`${o}/`).join('repo-owner/');
  const fixRepo = (v) => {
    if (Array.isArray(v)) return v.map(fixRepo);
    if (v && typeof v === 'object') {
      const o = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fixRepo(x)]));
      if (o.lane === 'repository' && typeof o.value === 'string' && /^[^/\s]+\/[^/\s]+$/.test(o.value)) o.value = `repo-owner/${o.value.split('/')[1]}`;
      return o;
    }
    return v;
  };
  return fixRepo(JSON.parse(text));
}
const tidy = (v, keep) => relabel(shorten(v, keep));

// The event card carries the whole evidence snapshot (tens of kilobytes). The example keeps its
// structure and one entry of every list.
function cardExample(card) {
  const c = structuredClone(card);
  c.package_events = c.package_events.slice(0, 1);
  const ev = c.stage2?.evidence?.registry;
  if (ev) {
    for (const k of ['burst', 'versions', 'removed']) if (Array.isArray(ev[k])) ev[k] = ev[k].slice(0, 1);
    if (ev.recent) ev.recent = ev.recent.slice(0, 2);
    if (ev.history?.publishers) ev.history.publishers = Object.fromEntries(Object.entries(ev.history.publishers).slice(0, 2));
    for (const v of [ev.previous, ...(ev.versions ?? [])]) {
      if (!v) continue;
      if (v.dependencies) v.dependencies = Object.fromEntries(Object.entries(v.dependencies).slice(0, 2));
      if (v.scripts) v.scripts = Object.fromEntries(Object.entries(v.scripts).slice(0, 2));
    }
  }
  return c;
}

// ── what to capture ──────────────────────────────────────────────────────────────────────
const alerts = (await call('GET', '/events?alert=true&limit=20')).body.items;
// an alert of a publication with few versions keeps the card example short
const alert = alerts.find((a) => a.stage2?.versions?.length === 1 && !a.package.startsWith('@')) ?? alerts[0];
const pkg = alert.package;
const enc = encodeURIComponent(pkg);

const plan = [
  ['getStatus', 'GET', '/status'],
  ['getHealth', 'GET', '/health'],
  ['listEvents', 'GET', '/events?alert=true&limit=2'],
  ['getEvent', 'GET', `/events/${alert.seq}`],
  ['queryDependencyAlerts', 'POST', '/alerts/query', { packages: [pkg, 'lodash'], days: 14 }],
  ['listFindings', 'GET', '/findings'],
  ['listPackageEvents', 'GET', `/packages/${enc}/events?limit=2`],
  ['listMaintainerHistory', 'GET', `/packages/${enc}/maintainers`],
  ['getTotals', 'GET', '/stats/totals?hours=24'],
  ['getHourly', 'GET', '/stats/hourly?hours=3'],
  ['getPulse', 'GET', '/stats/pulse'],
  ['getFeatureCounts', 'GET', '/stats/features?hours=720'],
  ['getSourceUsage', 'GET', '/stats/sources?hours=720'],
  ['listFeatureCatalogue', 'GET', '/features'],
];
const errors = [
  ['listEvents', 'GET', '/events?limit=0'],
  ['listEvents', 'GET', '/events?before=10&after=5'],
  ['getEvent', 'GET', '/events/1'],
  ['getEvent', 'GET', '/events/abc'],
  ['listPackageEvents', 'GET', '/packages/Not%20A%20Name/events'],
  ['listPackageEvents', 'GET', '/packages/no-such-package-in-the-journal/events'],
  ['queryDependencyAlerts', 'POST', '/alerts/query', { packages: [] }],
  ['queryDependencyAlerts', 'GET', '/alerts/query'],
  ['putFinding', 'PUT', `/events/${alert.seq}/finding`, { verdict: 'confirmed' }],
  ['putFinding', 'PUT', `/events/${alert.seq}/finding`, { verdict: 'maybe' }, { authorization: 'Bearer wrong-token' }],
  ['deleteFinding', 'DELETE', `/events/${alert.seq}/finding`],
  ['listFindings', 'GET', '/findings?verdict=maybe'],
  ['getTotals', 'GET', '/stats/totals?hours=0'],
  ['getHourly', 'GET', '/stats/hourly?hours=721'],
  ['getFeatureCounts', 'GET', '/stats/features?hours=x'],
  ['getSourceUsage', 'GET', '/stats/sources?hours=0'],
  ['listMaintainerHistory', 'GET', '/packages/Not%20A%20Name/maintainers'],
];

const examples = {};
for (const [op, method, path, body] of plan) {
  const r = await call(method, path, body);
  if (r.status !== 200 && !(op === 'getHealth' && r.status === 503)) throw new Error(`${op}: ${method} ${path} → ${r.status}`);
  examples[op] = { request: { method, path, ...(body ? { body } : {}) }, status: r.status, response: tidy(op === 'getEvent' ? cardExample(r.body) : r.body, ['listFeatureCatalogue', 'getFeatureCounts', 'getPulse', 'getSourceUsage'].includes(op) ? 3 : 2) };
}
// the answer of /health when the pipeline is behind, from an instance whose collector is stopped
let degraded = null;
if (process.argv[3]) {
  const res = await fetch(`${process.argv[3].replace(/\/$/, '')}/api/v1/health`);
  if (res.status === 503) degraded = { request: { method: 'GET', path: '/health' }, status: 503, response: await res.json() };
}
const errorExamples = [];
for (const [op, method, path, body, headers] of errors) {
  const r = await call(method, path, body, headers);
  if (r.status < 400) throw new Error(`${op}: ${method} ${path} was expected to fail, got ${r.status}`);
  errorExamples.push({ operation: op, request: { method, path, ...(body ? { body } : {}), ...(headers ? { headers: { authorization: 'Bearer <wrong token>' } } : {}) }, status: r.status, response: r.body });
}
// the verdict a real token would get back: shape of the stored finding, not sent to this instance
examples.putFinding = { request: { method: 'PUT', path: `/events/${alert.seq}/finding`, headers: { authorization: 'Bearer <ANALYST_TOKEN>' }, body: { verdict: 'false_positive', note: 'nightly build from the project CI' } }, status: 200, response: { seq: alert.seq, verdict: 'false_positive', note: 'nightly build from the project CI', decided_at: examples.getStatus.response.now } };

const header = `// Generated by scripts/api-examples.mjs from the answers of a running instance — do not edit by hand.\n// Lists are cut to two or three items; account names are replaced by labels.\n`;
writeFileSync('src/api/examples.ts', `${header}\nexport const EXAMPLES: Record<string, { request: unknown; status: number; response: unknown }> = ${JSON.stringify(examples, null, 2)};\n\nexport const HEALTH_DEGRADED: { request: unknown; status: number; response: unknown } | null = ${JSON.stringify(degraded, null, 2)};

export const ERROR_EXAMPLES: { operation: string; request: unknown; status: number; response: { error: string } }[] = ${JSON.stringify(errorExamples, null, 2)};\n`);

mkdirSync('documentation/api/examples', { recursive: true });
const HEADER = "An answer of a running instance, captured by `scripts/api-examples.mjs`. Lists are cut to two or three items and account names are replaced by labels, so a list can be shorter than the request asks for. `BASE` is the address of the dashboard, for example `http://127.0.0.1:8090/npm`.";
const PUT_NOTE = "The 200 answer below is written by hand in the shape of a stored verdict: the capture runs without the analyst token. The error answers 401 are captured; 400, 404 and 413 have the messages `verdict must be one of confirmed, false_positive, undecided`, `no such event` and `body too large`.";
// documentation/api/examples/deleteFinding.md is written by hand: its 204 answer has no body and needs the token
const curl = (r) => `curl -s${r.method === 'GET' ? '' : ` -X ${r.method}`}${r.headers ? ` -H 'authorization: ${r.headers.authorization}'` : ''}${r.body ? ` -H 'content-type: application/json' -d '${JSON.stringify(r.body)}'` : ''} "$BASE/api/v1${r.path}"`;
for (const [op, ex] of Object.entries(examples)) {
  const errs = errorExamples.filter((e) => e.operation === op);
  writeFileSync(`documentation/api/examples/${op}.md`, [
    `# ${op}`, '', HEADER, '', ...(op === 'putFinding' ? [PUT_NOTE, ''] : []),
    '## Request', '', '```sh', curl(ex.request), '```', '', `## Response ${ex.status}`, '', '```json', JSON.stringify(ex.response, null, 2), '```', '',
    ...errs.flatMap((e) => [`## Error ${e.status}`, '', '```sh', curl(e.request), '```', '', '```json', JSON.stringify(e.response, null, 2), '```', '']),
  ].join('\n'));
}
console.log(`examples: ${Object.keys(examples).length} operations, ${errorExamples.length} error answers; alert used: ${pkg} seq ${alert.seq}`);
