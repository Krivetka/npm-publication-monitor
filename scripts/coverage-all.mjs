// Line coverage over every source file, not only the files a test happened to load.
//
//   node scripts/coverage-all.mjs <lcov.info> [minimum-percent]
//
// The built-in coverage of `node --test` reports the files that were loaded. A file that no
// test imports is absent from its table, so the total looks better than it is. This script
// adds those files with zero covered lines and prints the honest figure, per folder and in
// total. With a minimum it exits 1 when the total is below it (the quality gate of CI).

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const [lcovFile, minimum] = process.argv.slice(2);
if (!lcovFile) {
  console.error('usage: node scripts/coverage-all.mjs <lcov.info> [minimum-percent]');
  process.exit(2);
}

const loaded = new Map();
let current = null;
for (const line of readFileSync(lcovFile, 'utf8').split('\n')) {
  if (line.startsWith('SF:')) {
    current = resolve(line.slice(3));
    loaded.set(current, { found: 0, hit: 0 });
  } else if (line.startsWith('LF:')) loaded.get(current).found = Number(line.slice(3));
  else if (line.startsWith('LH:')) loaded.get(current).hit = Number(line.slice(3));
}

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const files = walk('src').filter((f) => /\.(ts|js)$/.test(f) && !f.endsWith('.d.ts'));

const groups = new Map();
const never = [];
let found = 0;
let hit = 0;
for (const f of files) {
  const parts = f.split(sep);
  const group = parts.length > 2 ? parts.slice(1, parts[1] === 'web' && parts[2] === 'static' ? 3 : 2).join('/') : '(root)';
  const g = groups.get(group) ?? { found: 0, hit: 0, files: 0 };
  const s = loaded.get(resolve(f));
  // a file that was never loaded counts with all its non-empty lines and none covered
  const lines = s ? s.found : readFileSync(f, 'utf8').split('\n').filter((l) => l.trim() !== '').length;
  g.found += lines;
  g.hit += s ? s.hit : 0;
  g.files++;
  found += lines;
  hit += s ? s.hit : 0;
  if (!s) never.push(f.split(sep).join('/'));
  groups.set(group, g);
}

const pct = (h, f) => (f === 0 ? '—' : `${((100 * h) / f).toFixed(1)} %`);
console.log('Folder'.padEnd(18), 'Files'.padStart(5), 'Lines'.padStart(7), 'Covered'.padStart(8), 'Share'.padStart(8));
for (const [name, g] of [...groups].sort()) console.log(name.padEnd(18), String(g.files).padStart(5), String(g.found).padStart(7), String(g.hit).padStart(8), pct(g.hit, g.found).padStart(8));
console.log('total'.padEnd(18), String(files.length).padStart(5), String(found).padStart(7), String(hit).padStart(8), pct(hit, found).padStart(8));
console.log(`\nfiles no test loads (${never.length}): ${never.join(', ') || 'none'}`);
if (minimum !== undefined && (100 * hit) / found < Number(minimum)) {
  console.error(`\ncoverage ${pct(hit, found)} is below the minimum of ${minimum} %`);
  process.exit(1);
}
