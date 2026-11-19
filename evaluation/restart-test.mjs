// NFR-1: no event lost or duplicated across restarts and outages.
//
//   node evaluation/restart-test.mjs [events] [seed]
//
// The real collector (src/collector/main.ts) reads a local model of the changes feed and is
// killed without warning again and again until it has read the whole feed. The feed model
// also fails on purpose: some requests get HTTP 500, some connections are cut in the middle of
// the answer. At the end the journal must hold every event of the feed exactly once and the
// cursor must stand on the last event.
//
// Needs the development database (docker compose -f compose.dev.yml up -d). The test makes its
// own database `npm_monitor_restart` and drops it at the end.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import postgres from 'postgres';

const EVENTS = Number(process.argv[2] ?? 30000);
const SEED = Number(process.argv[3] ?? 1);
const ADMIN = process.env.RESTART_TEST_ADMIN_URL ?? 'postgres://npm_monitor:dev@127.0.0.1:55432/postgres';
const DB = 'npm_monitor_restart';
const DB_URL = ADMIN.replace(/\/[^/]*$/, `/${DB}`);
const NODE = process.execPath;

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);

// ── the feed model: increasing seq with gaps, as in the registry ─────────────────────────
const feed = [];
for (let i = 0, seq = 1000; i < EVENTS; i++) {
  seq += 1 + Math.floor(rng() * 3);
  feed.push({ seq, id: `pkg-${i % 7000}`, changes: [{ rev: `${1 + Math.floor(i / 7000)}-${seq.toString(16)}` }], ...(rng() < 0.01 ? { deleted: true } : {}) });
}
const HEAD = feed.at(-1).seq;
const faults = { http500: 0, cut: 0, served: 0 };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/registry/' || url.pathname === '/registry') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return void res.end(JSON.stringify({ update_seq: HEAD }));
  }
  if (url.pathname !== '/registry/_changes') return void res.writeHead(404).end();
  const r = rng();
  if (r < 0.04) {
    faults.http500++;
    return void res.writeHead(500).end('{}');
  }
  const since = Number(url.searchParams.get('since'));
  const limit = Number(url.searchParams.get('limit'));
  // binary search for the first event above `since`
  let lo = 0, hi = feed.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (feed[mid].seq > since) hi = mid; else lo = mid + 1; }
  const results = feed.slice(lo, lo + limit);
  const body = JSON.stringify({ results, last_seq: results.at(-1)?.seq ?? since });
  res.writeHead(200, { 'content-type': 'application/json' });
  if (r < 0.08) {
    faults.cut++;
    res.write(body.slice(0, Math.floor(body.length / 2)));
    return void res.socket.destroy();
  }
  faults.served++;
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const FEED_URL = `http://127.0.0.1:${server.address().port}/registry`;

// ── the database ─────────────────────────────────────────────────────────────────────────
const admin = postgres(ADMIN, { max: 1, onnotice: () => {} });
await admin.unsafe(`drop database if exists ${DB} with (force)`);
await admin.unsafe(`create database ${DB}`);
const run = (script, env) => spawn(NODE, [script], { env: { ...process.env, DATABASE_URL: DB_URL, DATABASE_URL_ADMIN: DB_URL, LOG_LEVEL: 'warn', ...env }, stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise((resolve, reject) => run('src/migrate.ts', {}).on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`migrate exited with ${code}`)))));
const db = postgres(DB_URL, { max: 1, onnotice: () => {} });
const cursor = async () => Number((await db`select last_seq from collector_state where feed = 'npm'`)[0]?.last_seq ?? 0);

// ── kill and restart until the feed is read ──────────────────────────────────────────────
const started = Date.now();
let kills = 0;
const progress = [];
for (let round = 0; round < 200; round++) {
  const child = run('src/collector/main.ts', { FEED_URL, FEED_START_SEQ: '0', FEED_BATCH_LIMIT: '200', FEED_POLL_INTERVAL_MS: '100', FEED_REQUEST_TIMEOUT_MS: '5000', FEED_HEAD_CHECK_INTERVAL_MS: '500' });
  const exited = new Promise((r) => child.on('exit', r));
  await sleep(350 + Math.floor(rng() * 900)); // the process is cut at a random moment
  child.kill('SIGKILL');
  await exited;
  kills++;
  const at = await cursor();
  progress.push(at);
  if (at >= HEAD) break;
}

// ── the journal against the feed ─────────────────────────────────────────────────────────
const rows = await db`select seq::bigint as seq, package, rev, deleted from feed_event order by seq`;
const got = rows.map((r) => Number(r.seq));
const want = feed.map((e) => e.seq);
const gotSet = new Set(got);
const missing = want.filter((s) => !gotSet.has(s));
const wantSet = new Set(want);
const extra = got.filter((s) => !wantSet.has(s));
const duplicates = got.length - gotSet.size;
const byseq = new Map(feed.map((e) => [e.seq, e]));
const wrong = rows.filter((r) => { const e = byseq.get(Number(r.seq)); return e && (e.id !== r.package || e.changes[0].rev !== r.rev || Boolean(e.deleted) !== r.deleted); }).length;
const last = await cursor();
const stalled = progress.filter((p, i) => i > 0 && p === progress[i - 1]).length;

console.log(`feed model: ${EVENTS} events, seq ${want[0]} … ${HEAD}; seed ${SEED}`);
console.log(`faults of the feed: ${faults.http500} answers HTTP 500, ${faults.cut} connections cut; ${faults.served} pages served`);
console.log(`collector killed ${kills} times in ${((Date.now() - started) / 1000).toFixed(0)} s (${stalled} runs made no progress)`);
console.log(`journal: ${got.length} rows; missing ${missing.length}, duplicated ${duplicates}, unknown ${extra.length}, with wrong content ${wrong}`);
console.log(`cursor: ${last} (feed head ${HEAD})`);
const ok = missing.length === 0 && duplicates === 0 && extra.length === 0 && wrong === 0 && last === HEAD;
console.log(ok ? 'RESULT: no event lost or duplicated' : 'RESULT: FAILED');

await db.end();
await admin.unsafe(`drop database if exists ${DB} with (force)`);
await admin.end();
server.close();
process.exit(ok ? 0 : 1);
