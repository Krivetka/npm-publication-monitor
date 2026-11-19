// Structure of the recorded ChainDrop wave against the two rules that decide an alert:
//   stage 1 — `rate_package` needs three events of one package inside the sliding window;
//   stage 2 — the baseline of the comparison is the last version published more than
//             `burstWindowMs` before the event.
// The script reads only the fixture, so it needs no background and no database.
//
//   node evaluation/chaindrop/analyse.mjs

import { readFileSync } from 'node:fs';

const WINDOW_MIN = 10; // stage 1 `windowMin`
const PACKAGE_MIN = 3; // stage 1 `thresholds.packageMin`
const BURST_MS = 600_000; // stage 2 `burstWindowMs`
const MIN = 60_000;

const fx = JSON.parse(readFileSync(new URL('../../src/replay/data/chaindrop.json', import.meta.url), 'utf8'));
const t0 = Date.parse(fx.first);
const pct = (n, d) => `${((100 * n) / d).toFixed(1)} %`;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const rows = fx.packages.map((p) => {
  const times = p.burst.map(([, t]) => Date.parse(t) - t0);
  const minutes = times.map((t) => Math.floor(t / MIN));
  // first event that is the third of the package inside the window
  let burstAt = -1;
  for (let i = 0; i < times.length && burstAt < 0; i++) {
    const inWindow = minutes.filter((m, j) => j <= i && m > minutes[i] - WINDOW_MIN).length;
    if (inWindow >= PACKAGE_MIN) burstAt = i;
  }
  // events whose baseline is still the last benign version
  const cleanBaseline = times.map((t) => times[0] >= t - BURST_MS);
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  return {
    name: p.name,
    versions: times.length,
    first: times[0],
    spanMin: (times.at(-1) - times[0]) / MIN,
    maxInWindow: Math.max(...minutes.map((m, i) => minutes.filter((x, j) => j <= i && x > m - WINDOW_MIN).length)),
    burstAt,
    burstTime: burstAt >= 0 ? times[burstAt] : null,
    burstClean: burstAt >= 0 ? cleanBaseline[burstAt] : null,
    gaps,
    hadInstallScript: ['preinstall', 'install', 'postinstall'].some((k) => k in (p.last.scripts ?? {})),
  };
});

const n = rows.length;
console.log(`packages ${n}, versions ${rows.reduce((s, r) => s + r.versions, 0)}`);

console.log('\nVersions per package:');
for (const [label, test] of [['1', (v) => v === 1], ['2', (v) => v === 2], ['3–5', (v) => v >= 3 && v <= 5], ['6–10', (v) => v >= 6 && v <= 10], ['> 10', (v) => v > 10]]) {
  const c = rows.filter((r) => test(r.versions)).length;
  console.log(`  ${label.padEnd(5)} ${String(c).padStart(4)}  ${pct(c, n)}`);
}

const allGaps = rows.flatMap((r) => r.gaps);
console.log(`\nGap between versions of one package: median ${(median(allGaps) / MIN).toFixed(1)} min; under 1 min ${pct(allGaps.filter((g) => g < MIN).length, allGaps.length)}, 1–10 min ${pct(allGaps.filter((g) => g >= MIN && g < 10 * MIN).length, allGaps.length)}, over 10 min ${pct(allGaps.filter((g) => g >= 10 * MIN).length, allGaps.length)}`);

const few = rows.filter((r) => r.versions < PACKAGE_MIN);
const slow = rows.filter((r) => r.versions >= PACKAGE_MIN && r.burstAt < 0);
const burst = rows.filter((r) => r.burstAt >= 0);
const burstClean = burst.filter((r) => r.burstClean);
const burstDirty = burst.filter((r) => !r.burstClean);
console.log('\nStage 1, rate_package (three events of the package in ten minutes):');
console.log(`  fewer than three versions            ${String(few.length).padStart(4)}  ${pct(few.length, n)}`);
console.log(`  three or more, never three in window ${String(slow.length).padStart(4)}  ${pct(slow.length, n)}`);
console.log(`  three in window                      ${String(burst.length).padStart(4)}  ${pct(burst.length, n)}`);
console.log('\nStage 2 at the first such event (baseline = last version older than ten minutes):');
console.log(`  baseline is the last benign version  ${String(burstClean.length).padStart(4)}  ${pct(burstClean.length, n)}`);
console.log(`  baseline is an earlier malicious one ${String(burstDirty.length).padStart(4)}  ${pct(burstDirty.length, n)}`);
console.log(`  (packages that already had an install script: ${rows.filter((r) => r.hadInstallScript).length})`);

const order = [...burst].sort((a, b) => a.burstTime - b.burstTime);
console.log('\nFirst packages to reach three events in the window:');
for (const r of order.slice(0, 8)) console.log(`  +${(r.burstTime / MIN).toFixed(1).padStart(5)} min  ${r.name}  (version ${r.burstAt + 1} of ${r.versions}, first at +${(r.first / MIN).toFixed(1)} min, baseline ${r.burstClean ? 'benign' : 'malicious'})`);
const firstClean = order.find((r) => r.burstClean);
if (firstClean) console.log(`\nFirst event with three in the window and a benign baseline: +${(firstClean.burstTime / MIN).toFixed(1)} min, ${firstClean.name}`);

console.log('\nNew packages entering the wave, per 10 minutes:');
const perBucket = new Map();
for (const r of rows) perBucket.set(Math.floor(r.first / (10 * MIN)), (perBucket.get(Math.floor(r.first / (10 * MIN))) ?? 0) + 1);
console.log(`  ${[...perBucket].sort((a, b) => a[0] - b[0]).map(([b, c]) => `${b * 10}:${c}`).join('  ')}`);
