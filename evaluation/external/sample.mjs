// A random sample of alerts for analyst verdicts.
//
//   node evaluation/external/sample.mjs <alerts.jsonl> <n> <seed> <out.json> <out.html> [base-url]
//
// The population is the alerts of the current rule (stage 2 v5 and v6), repeats left out. The
// sample is drawn without replacement by a seeded generator, so it can be drawn again. The page
// shows no external confirmation: the verdict must not depend on it.

import { readFileSync, writeFileSync } from 'node:fs';

const [alertsFile, nArg, seedArg, outJson, outHtml, base = 'http://localhost:18090/npm'] = process.argv.slice(2);
if (!outHtml) {
  console.error('usage: node evaluation/external/sample.mjs <alerts.jsonl> <n> <seed> <out.json> <out.html> [base-url]');
  process.exit(2);
}
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const population = readFileSync(alertsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((a) => !a.repeat && /^v[56]:/.test(a.engine));
const rng = mulberry32(Number(seedArg));
const pool = [...population];
for (let i = pool.length - 1; i > 0; i--) {
  const j = Math.floor(rng() * (i + 1));
  [pool[i], pool[j]] = [pool[j], pool[i]];
}
const sample = pool.slice(0, Number(nArg)).sort((a, b) => a.seq - b.seq);

writeFileSync(outJson, `${JSON.stringify({ drawn: new Date().toISOString().slice(0, 10), seed: Number(seedArg), population: population.length, from: population[0].t, to: population.at(-1).t, seqs: sample.map((a) => a.seq) }, null, 1)}\n`);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const rows = sample.map((a, i) => `<tr><td>${i + 1}</td><td><a href="${base}/event/${a.seq}" target="card">${esc(a.package)}</a></td><td>${esc((a.versions ?? []).slice(0, 3).join(', '))}${(a.versions ?? []).length > 3 ? ' …' : ''}</td><td>${esc(a.t.slice(0, 16).replace('T', ' '))}</td><td>${a.final}</td><td>${esc(a.features.join(', '))}</td><td><a href="https://www.npmjs.com/package/${esc(a.package)}" target="npm">npm</a></td><td><input type="checkbox" data-seq="${a.seq}"></td></tr>`).join('\n');
writeFileSync(outHtml, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Verdict sample</title><style>
body{font:14px/1.45 system-ui,sans-serif;margin:24px;max-width:1200px;color:#1a1a1a;background:#fff}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
th{position:sticky;top:0;background:#f4f4f4}tr.done td{color:#888;background:#f7faf7}td:nth-child(6){font-size:12px;color:#555}
#left{font-weight:600}
</style></head><body>
<h1>Verdict sample: ${sample.length} of ${population.length} alerts</h1>
<p>Open the card, store a verdict there (Confirmed / False positive / Undecided), then tick the row. The ticks are kept in this browser only. Left: <span id="left"></span></p>
<table><thead><tr><th>#</th><th>Package (event card)</th><th>Versions</th><th>Event time</th><th>Score</th><th>Features</th><th></th><th>Done</th></tr></thead><tbody>
${rows}
</tbody></table>
<script>
const KEY='verdict-sample-${seedArg}';let done={};try{done=JSON.parse(localStorage.getItem(KEY)||'{}')}catch{}
const boxes=[...document.querySelectorAll('input[data-seq]')];
const paint=()=>{let n=0;for(const b of boxes){const d=!!done[b.dataset.seq];b.checked=d;b.closest('tr').className=d?'done':'';if(!d)n++}document.getElementById('left').textContent=n};
for(const b of boxes)b.addEventListener('change',()=>{done[b.dataset.seq]=b.checked;try{localStorage.setItem(KEY,JSON.stringify(done))}catch{}paint()});
paint();
</script></body></html>
`);
console.log(`population ${population.length} (${population[0].t.slice(0, 10)} … ${population.at(-1).t.slice(0, 10)}), sample ${sample.length}`);
