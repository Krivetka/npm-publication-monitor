// Were the alerts of the monitor also reported by other security services?
//
//   node evaluation/external/check.mjs <alerts.jsonl> <cache-dir>
//
// alerts.jsonl: one JSON object per alert of `stage2_result` (seq, package, t, versions, final,
// features, repeat, engine). Two public sources are consulted, by package name only:
//   - Aikido Intel malware list  https://malware-list.aikido.dev/malware_predictions.json
//   - OSV.dev (MAL-… records of the OpenSSF malicious-packages database, which aggregates the
//     GitHub Advisory Database, Socket, Amazon Inspector, Datadog and other reporters)
// Downloads are cached in <cache-dir>.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [alertsFile, cacheDir] = process.argv.slice(2);
if (!alertsFile || !cacheDir) {
  console.error('usage: node evaluation/external/check.mjs <alerts.jsonl> <cache-dir>');
  process.exit(2);
}
mkdirSync(cacheDir, { recursive: true });
const UA = { 'user-agent': 'npm-publish-monitor (research)' };
const cached = async (name, load) => {
  const f = join(cacheDir, name);
  if (!existsSync(f)) writeFileSync(f, JSON.stringify(await load()));
  return JSON.parse(readFileSync(f, 'utf8'));
};

const alerts = readFileSync(alertsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((a) => !a.repeat);
const packages = [...new Set(alerts.map((a) => a.package))];

// ── Aikido ────────────────────────────────────────────────────────────────────────────────
const aikidoList = await cached('aikido.json', async () => (await fetch('https://malware-list.aikido.dev/malware_predictions.json', { headers: UA })).json());
const aikido = new Map(); // package → Set(version)
for (const r of aikidoList) {
  if (!aikido.has(r.package_name)) aikido.set(r.package_name, new Set());
  aikido.get(r.package_name).add(r.version);
}

// ── OSV ───────────────────────────────────────────────────────────────────────────────────
const osvIds = await cached('osv-ids.json', async () => {
  const out = {};
  for (let i = 0; i < packages.length; i += 500) {
    const chunk = packages.slice(i, i + 500);
    const res = await fetch('https://api.osv.dev/v1/querybatch', { method: 'POST', headers: { ...UA, 'content-type': 'application/json' }, body: JSON.stringify({ queries: chunk.map((name) => ({ package: { name, ecosystem: 'npm' } })) }) });
    if (!res.ok) throw new Error(`osv querybatch ${res.status}`);
    const body = await res.json();
    chunk.forEach((name, j) => {
      const ids = (body.results[j]?.vulns ?? []).map((v) => v.id).filter((id) => id.startsWith('MAL-'));
      if (ids.length > 0) out[name] = ids;
    });
  }
  return out;
});
const malIds = [...new Set(Object.values(osvIds).flat())];
const osvRecords = await cached('osv-records.json', async () => {
  const out = {};
  for (const id of malIds) {
    const res = await fetch(`https://api.osv.dev/v1/vulns/${id}`, { headers: UA });
    if (!res.ok) throw new Error(`osv ${id} ${res.status}`);
    const v = await res.json();
    out[id] = {
      published: v.published,
      aliases: v.aliases ?? [],
      sources: [...new Set((v.database_specific?.['malicious-packages-origins'] ?? []).map((o) => o.source))],
      affected: (v.affected ?? []).filter((a) => a.package?.ecosystem === 'npm').map((a) => ({ name: a.package.name, versions: a.versions ?? [], all: (a.ranges ?? []).some((r) => r.events?.some((e) => e.introduced === '0') && !r.events?.some((e) => e.fixed || e.last_affected)) })),
    };
  }
  return out;
});

// ── match ─────────────────────────────────────────────────────────────────────────────────
const rows = [];
for (const a of alerts) {
  const t = Date.parse(a.t);
  const av = aikido.get(a.package);
  const aikidoVersion = av ? (a.versions ?? []).some((v) => av.has(v)) : false;
  let osv = null;
  for (const id of osvIds[a.package] ?? []) {
    const r = osvRecords[id];
    const aff = r.affected.find((x) => x.name === a.package);
    if (!aff) continue;
    const version = aff.all || (a.versions ?? []).some((v) => aff.versions.includes(v));
    const cand = { id, published: Date.parse(r.published), sources: r.sources, version };
    if (!osv || (cand.version && !osv.version) || (cand.version === osv.version && cand.published < osv.published)) osv = cand;
  }
  rows.push({ ...a, t, aikido: Boolean(av), aikidoVersion, osv });
}

const current = (r) => /^v[56]:/.test(r.engine);
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)} %` : '—');
const median = (xs) => (xs.length ? [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)] : null);
function summary(label, set) {
  const known = set.filter((r) => r.aikidoVersion || r.osv?.version);
  const pkgOnly = set.filter((r) => !(r.aikidoVersion || r.osv?.version) && (r.aikido || r.osv));
  const both = set.filter((r) => r.aikidoVersion && r.osv?.version).length;
  const leads = known.filter((r) => r.osv?.version).map((r) => (r.osv.published - r.t) / 3600e3);
  console.log(`\n${label}: ${set.length} alerts, ${new Set(set.map((r) => r.package)).size} packages`);
  console.log(`  same version reported as malware elsewhere: ${known.length} (${pct(known.length, set.length)})  — Aikido ${set.filter((r) => r.aikidoVersion).length}, OSV ${set.filter((r) => r.osv?.version).length}, both ${both}`);
  console.log(`  package reported, another version:          ${pkgOnly.length}`);
  console.log(`  not reported by either source:              ${set.length - known.length - pkgOnly.length}`);
  if (leads.length) console.log(`  alert before the OSV record: ${leads.filter((h) => h > 0).length} of ${leads.length}; median lead ${median(leads).toFixed(1)} h`);
  const src = new Map();
  for (const r of known) for (const s of r.osv?.sources ?? []) src.set(s, (src.get(s) ?? 0) + 1);
  if (src.size) console.log(`  reporters behind the OSV records: ${[...src].sort((x, y) => y[1] - x[1]).map(([s, n]) => `${s} ${n}`).join(', ')}`);
  return known;
}
summary('All engines', rows);
const known = summary('Current rule (stage 2 v5 and v6)', rows.filter(current));

const combos = new Map();
for (const r of known) {
  const c = r.features.filter((f) => f !== 'version_removed').sort().join('+');
  combos.set(c, (combos.get(c) ?? 0) + 1);
}
console.log('\nFeature sets of the confirmed alerts (current rule):');
for (const [c, n] of [...combos].sort((x, y) => y[1] - x[1]).slice(0, 8)) console.log(`  ${String(n).padStart(3)}  ${c}`);

writeFileSync(join(cacheDir, 'matched.json'), JSON.stringify(rows.filter((r) => r.aikido || r.osv).map((r) => ({ seq: r.seq, package: r.package, t: new Date(r.t).toISOString(), versions: r.versions, engine: r.engine, aikido: r.aikido, aikidoVersion: r.aikidoVersion, osv: r.osv && { id: r.osv.id, published: new Date(r.osv.published).toISOString(), version: r.osv.version, sources: r.osv.sources } })), null, 1));
