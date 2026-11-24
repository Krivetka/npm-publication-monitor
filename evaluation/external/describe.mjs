// One compact description per sampled alert: what the monitor stored at alert time and what
// the registry shows now. Reads only metadata (package documents); no tarball is downloaded.
//
//   node evaluation/external/describe.mjs <sample-full.jsonl> <cache-dir> [from] [to]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [file, cacheDir, from = '0', to = '9999'] = process.argv.slice(2);
const rows = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const dir = join(cacheDir, 'registry');
mkdirSync(dir, { recursive: true });
const enc = (n) => (n.startsWith('@') ? `@${encodeURIComponent(n.slice(1))}` : encodeURIComponent(n));
const fileOf = (n) => join(dir, `${n.replace(/[@/]/g, '_')}.json`);

const queue = [...new Set(rows.map((r) => r.package))].filter((n) => !existsSync(fileOf(n)));
async function worker() {
  for (let name = queue.pop(); name; name = queue.pop()) {
    const res = await fetch(`https://registry.npmjs.org/${enc(name)}`, { headers: { 'user-agent': 'npm-publish-monitor (research)' } });
    if (res.status === 404) { writeFileSync(fileOf(name), 'null'); continue; }
    if (!res.ok) throw new Error(`${name}: ${res.status}`);
    const p = await res.json();
    const versions = {};
    for (const [v, m] of Object.entries(p.versions ?? {})) {
      versions[v] = { scripts: Object.fromEntries(Object.entries(m.scripts ?? {}).filter(([k]) => /^(pre|post)?install$|^prepare$/.test(k))), user: m._npmUser?.name ?? null, trusted: Boolean(m._npmUser?.trustedPublisher), size: m.dist?.unpackedSize ?? null, files: m.dist?.fileCount ?? null, deps: Object.keys(m.dependencies ?? {}).length, bin: Object.keys(typeof m.bin === 'string' ? { x: 1 } : m.bin ?? {}).length };
    }
    writeFileSync(fileOf(name), JSON.stringify({ time: p.time ?? {}, versions, latest: p['dist-tags']?.latest ?? null, description: (p.description ?? '').slice(0, 140), repository: typeof p.repository === 'string' ? p.repository : p.repository?.url ?? null, maintainers: (p.maintainers ?? []).length, homepage: p.homepage ?? null }));
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

const short = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
rows.slice(Number(from), Number(to)).forEach((r, i) => {
  const p = JSON.parse(readFileSync(fileOf(r.package), 'utf8'));
  const ev = r.evidence ?? {};
  const feats = r.features.map((f) => {
    let d = '';
    if (f.id === 'install_script_added' || f.id === 'install_script_changed') d = `=${short(JSON.stringify(f.detail?.commands ?? f.value), 150)}`;
    else if (f.id === 'install_script_new_package') d = `=${short(JSON.stringify(f.value), 60)}`;
    else if (f.id === 'size_jump' || f.id === 'files_jump') d = `=${f.detail?.from}→${f.detail?.to}`;
    else if (f.id === 'non_adjacent_branches' || f.id === 'multi_branch') d = `=${short(JSON.stringify(f.detail?.lines ?? f.value), 70)}`;
    else if (f.id === 'publisher_new' || f.id === 'publisher_from_trusted') d = `=${short(String(f.value), 40)}`;
    else if (f.id === 'deps_added' || f.id === 'maintainers_added') d = `=${short(JSON.stringify(f.value), 80)}`;
    else if (f.value !== undefined && typeof f.value !== 'object') d = `=${short(String(f.value), 30)}`;
    return `${f.id}${d}`;
  });
  const s1 = (r.s1 ?? []).map((f) => (f.id.startsWith('name_') ? `${f.id}=${f.value}` : f.id)).join(',');
  let now;
  if (!p) now = 'REGISTRY: package gone (404)';
  else {
    const vs = Object.keys(p.versions);
    const holding = vs.length === 1 && vs[0] === '0.0.1-security';
    const present = (r.versions ?? []).map((v) => (p.versions[v] ? 'present' : p.time[v] ? 'REMOVED' : 'unknown'));
    const m = p.versions[(r.versions ?? []).at(-1)] ?? null;
    now = holding ? 'REGISTRY: security holding package' : `now: ${vs.length} versions, created ${String(p.time.created).slice(0, 10)}, alert versions ${[...new Set(present)].join('/')}, maint ${p.maintainers}, repo ${p.repository ? short(p.repository.replace(/^git\+|\.git$/g, '').replace('https://github.com/', 'gh:'), 50) : 'NONE'}${m ? `, scripts ${short(JSON.stringify(m.scripts), 160)}, size ${m.size}, files ${m.files}, deps ${m.deps}, bin ${m.bin}, by ${m.trusted ? 'CI' : m.user}` : ''} | "${p.description}"`;
  }
  const hist = ev.history ? `hist ${ev.history.versions}v since ${String(ev.history.first).slice(0, 10)}, publishers ${short(Object.entries(ev.history.publishers ?? {}).map(([k, v]) => `${k.replace('user:', '')}×${v.count}`).join(' '), 70)}` : '';
  console.log(`#${Number(from) + i + 1} seq ${r.seq} ${r.package} ${short(JSON.stringify(r.versions), 70)} ${String(r.t).slice(0, 10)} final ${r.final} (pre ${r.prescore}: ${s1})\n   F: ${feats.join('; ')}\n   ${hist}\n   ${now}`);
});
