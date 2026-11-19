// Builds the ChainDrop replay fixture from public data. No number in it is invented.
//
//   1. GitHub Advisory Database: malware advisories for npm published on 4 August 2026 between
//      10:00 and 18:00 UTC give the affected packages and the exact malicious versions.
//   2. npm registry: the `time` field of each package document keeps the publication time of
//      every version, also of the versions the registry removed. The remaining versions give
//      the release history, the publisher of each release and the last benign manifest.
//
//   node evaluation/chaindrop/build.mjs [incident]
//
// The same two sources describe the incidents of 2025 that the parameters were not tuned on
// (the held-out set): nx, qix, shai-hulud, shai-hulud-2. Only packages that had a benign
// release before the wave are taken: a package created as malware is another class of event.
//
// Downloads are cached in evaluation/data/<incident>/ (not committed). The result is
// src/replay/data/<incident>.json. Account names are replaced by per-package labels: the replay
// needs to know only whether the publisher of a version published earlier versions.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// days: publication days of the advisories; adv: the advisories of the incident inside them;
// burst: malicious versions published in this interval are taken; a package whose first one is
// earlier than waveFrom belongs to another campaign.
const INCIDENTS = {
  chaindrop: { days: '2026-08-04..2026-08-04', adv: ['2026-08-04T10:00:00Z', '2026-08-04T18:00:00Z'], burst: ['2026-08-04T00:00:00Z', '2026-08-05T00:00:00Z'], waveFrom: '2026-08-04T09:00:00Z' },
  nx: { days: '2025-08-26..2025-08-29', adv: ['2025-08-26T00:00:00Z', '2025-08-30T00:00:00Z'], burst: ['2025-08-26T12:00:00Z', '2025-08-27T12:00:00Z'], waveFrom: '2025-08-26T12:00:00Z' },
  qix: { days: '2025-09-08..2025-09-10', adv: ['2025-09-08T00:00:00Z', '2025-09-11T00:00:00Z'], burst: ['2025-09-08T00:00:00Z', '2025-09-09T00:00:00Z'], waveFrom: '2025-09-08T00:00:00Z' },
  'shai-hulud': { days: '2025-09-15..2025-09-19', adv: ['2025-09-15T00:00:00Z', '2025-09-20T00:00:00Z'], burst: ['2025-09-14T12:00:00Z', '2025-09-17T12:00:00Z'], waveFrom: '2025-09-14T12:00:00Z' },
  'shai-hulud-2': { days: '2025-11-24..2025-11-27', adv: ['2025-11-24T00:00:00Z', '2025-11-28T00:00:00Z'], burst: ['2025-11-23T12:00:00Z', '2025-11-26T12:00:00Z'], waveFrom: '2025-11-23T12:00:00Z' },
};
const ID = process.argv[2] ?? 'chaindrop';
const cfg = INCIDENTS[ID];
if (!cfg) throw new Error(`unknown incident ${ID}; known: ${Object.keys(INCIDENTS).join(', ')}`);
const FROM = Date.parse(cfg.adv[0]);
const TO = Date.parse(cfg.adv[1]);
const BURST_FROM = Date.parse(cfg.burst[0]);
const BURST_TO = Date.parse(cfg.burst[1]);
const WAVE_FROM = Date.parse(cfg.waveFrom);
const HISTORY_MAX = 40;

const cache = new URL(`../data/${ID}/`, import.meta.url);
const raw = new URL('raw/', cache);
mkdirSync(raw, { recursive: true });
const UA = { 'user-agent': 'npm-publish-monitor (research)' };

// ── 1. advisories ─────────────────────────────────────────────────────────────────────────
const advFile = new URL('advisories.json', cache);
if (!existsSync(advFile)) {
  const all = [];
  let url = `https://api.github.com/advisories?type=malware&ecosystem=npm&per_page=100&sort=published&direction=asc&published=${cfg.days}`;
  while (url) {
    const res = await fetch(url, { headers: { ...UA, accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`advisories: ${res.status}, rate limit left ${res.headers.get('x-ratelimit-remaining')}`);
    for (const a of await res.json()) {
      all.push({ id: a.ghsa_id, published: a.published_at, summary: a.summary,
        packages: (a.vulnerabilities ?? []).filter((v) => v.package?.ecosystem === 'npm').map((v) => [v.package.name, v.vulnerable_version_range ?? '']) });
    }
    url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') ?? '')?.[1] ?? null;
  }
  writeFileSync(advFile, JSON.stringify(all));
}
const advisories = JSON.parse(readFileSync(advFile, 'utf8'));
const named = new Map(); // package → exact malicious versions
for (const a of advisories) {
  const t = Date.parse(a.published);
  if (t < FROM || t >= TO) continue;
  for (const [name, range] of a.packages) {
    const m = /^= (.+)$/.exec(range);
    if (!m) continue;
    if (!named.has(name)) named.set(name, new Set());
    named.get(name).add(m[1]);
  }
}

// ── 2. package documents ──────────────────────────────────────────────────────────────────
const enc = (n) => (n.startsWith('@') ? `@${encodeURIComponent(n.slice(1))}` : encodeURIComponent(n));
const rawFile = (n) => new URL(`${n.replace(/[@/]/g, '_')}.json`, raw);
const queue = [...named.keys()].filter((n) => !existsSync(rawFile(n)));
async function worker() {
  for (let name = queue.pop(); name; name = queue.pop()) {
    const res = await fetch(`https://registry.npmjs.org/${enc(name)}`, { headers: UA });
    if (res.status === 404) { writeFileSync(rawFile(name), 'null'); continue; }
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    const p = await res.json();
    const versions = {};
    for (const [v, m] of Object.entries(p.versions ?? {})) {
      versions[v] = {
        user: m._npmUser?.name ?? null,
        trusted: m._npmUser?.trustedPublisher ? { id: m._npmUser.trustedPublisher.id, config: m._npmUser.trustedPublisher.oidcConfigId ?? null } : null,
        scripts: Object.fromEntries(Object.entries(m.scripts ?? {}).filter(([k]) => /^(pre|post)?install$|^prepare$/.test(k))),
        deps: Object.keys({ ...m.dependencies, ...m.optionalDependencies }),
        size: m.dist?.unpackedSize ?? null,
        files: m.dist?.fileCount ?? null,
        provenance: Boolean(m.dist?.attestations?.provenance),
        gitHead: Boolean(m.gitHead),
      };
    }
    writeFileSync(rawFile(name), JSON.stringify({ name: p.name, time: p.time ?? {}, versions,
      maintainers: (p.maintainers ?? []).map((x) => x.name), repository: typeof p.repository === 'string' ? p.repository : p.repository?.url ?? null }));
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

// ── 3. fixture ────────────────────────────────────────────────────────────────────────────
const skipped = { noDocument: 0, noTimes: 0, otherCampaign: 0, noBenignHistory: 0 };
const packages = [];
for (const [name, versions] of named) {
  const p = JSON.parse(readFileSync(rawFile(name), 'utf8'));
  if (!p) { skipped.noDocument++; continue; }
  const burst = [...versions].map((v) => ({ v, t: Date.parse(p.time[v] ?? '') }))
    .filter((b) => b.t >= BURST_FROM && b.t < BURST_TO).sort((a, b) => a.t - b.t);
  if (burst.length === 0) { skipped.noTimes++; continue; }
  if (burst[0].t < WAVE_FROM) { skipped.otherCampaign++; continue; }

  const before = Object.entries(p.time)
    .filter(([v, t]) => v !== 'created' && v !== 'modified' && Date.parse(t) < burst[0].t && p.versions[v])
    .map(([v, t]) => ({ v, t: Date.parse(t), m: p.versions[v] })).sort((a, b) => a.t - b.t);
  if (before.length === 0) { skipped.noBenignHistory++; continue; }
  const earlier = Object.entries(p.time).filter(([v, t]) => v !== 'created' && v !== 'modified' && Date.parse(t) < burst[0].t).length;

  // account names → labels that are stable inside one package
  const labels = new Map();
  const label = (m) => {
    const key = m.trusted ? `ci:${m.trusted.id}:${m.trusted.config}` : `user:${m.user}`;
    if (!labels.has(key)) labels.set(key, labels.size);
    return [labels.get(key), m.trusted ? 1 : 0];
  };
  const history = before.slice(-HISTORY_MAX).map((h) => [h.v, new Date(h.t).toISOString(), ...label(h.m)]);
  const last = before.at(-1)?.m ?? null;
  packages.push({
    name,
    earlier, // versions published before the wave, removed ones included
    history, // [version, time, publisher label, 1 = trusted publishing]
    last: last && { scripts: last.scripts, deps: last.deps, size: last.size, files: last.files, provenance: last.provenance, gitHead: last.gitHead },
    burst: burst.map((b) => [b.v, new Date(b.t).toISOString()]),
    maintainers: p.maintainers.length,
  });
}
packages.sort((a, b) => a.burst[0][1].localeCompare(b.burst[0][1]) || a.name.localeCompare(b.name));

const outDir = new URL('../../src/replay/data/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const versionsTotal = packages.reduce((s, p) => s + p.burst.length, 0);
writeFileSync(new URL(`${ID}.json`, outDir), JSON.stringify({
  source: `GitHub Advisory Database (malware, npm, published ${cfg.adv[0].slice(0, 16)}–${cfg.adv[1].slice(0, 16)} UTC) and the npm registry "time" field, read ${new Date().toISOString().slice(0, 10)}`,
  first: packages[0].burst[0][1],
  last: packages.map((p) => p.burst.at(-1)[1]).sort().at(-1),
  packages,
}) + '\n');
console.log(`${ID}: advisory packages ${named.size}; in the fixture ${packages.length} packages, ${versionsTotal} versions; skipped`, skipped);
