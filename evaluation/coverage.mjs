// KPI-1: coverage of the observation period by the collector, from an export of the journal.
//   node evaluation/coverage.mjs <background.jsonl.gz> [gap-minutes]
// A gap is an interval between two consecutive journal events longer than the limit. The feed
// itself is never silent that long (≈ 1 event/s), so a gap is collector or node downtime.
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const [file, limitArg = '5'] = process.argv.slice(2);
const limit = Number(limitArg) * 60_000;
let prev = null, first = null, n = 0, lost = 0;
const gaps = [];
for await (const line of createInterface({ input: createReadStream(file).pipe(createGunzip()) })) {
  const i = line.indexOf('"observed_at"');
  const t = Date.parse(line.slice(line.indexOf('"', i + 14) + 1, line.indexOf('"', line.indexOf('"', i + 14) + 1)));
  if (first === null) first = t;
  if (prev !== null && t - prev > limit) { gaps.push([prev, t]); lost += t - prev; }
  prev = t; n++;
}
const span = prev - first;
console.log(`events ${n}, period ${new Date(first).toISOString()} … ${new Date(prev).toISOString()} (${(span / 86_400_000).toFixed(1)} days)`);
console.log(`gaps longer than ${limitArg} min: ${gaps.length}, in total ${(lost / 3_600_000).toFixed(2)} h; coverage ${(100 * (1 - lost / span)).toFixed(2)} %`);
for (const [a, b] of gaps.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0])).slice(0, 12)) console.log(`  ${new Date(a).toISOString()}  ${((b - a) / 60_000).toFixed(0)} min`);
