// Refreshes the snapshot of the top popular packages once a day (UTC).

import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from '../config.ts';
import { connect } from '../db.ts';
import { backoffDelay } from '../lib/backoff.ts';
import { errFields, log } from '../log.ts';
import { fetchTopPackages, latestSnapshotDate, storeSnapshot } from './source.ts';

const cfg = loadConfig();
const sql = connect(cfg.databaseUrl, 'popular');
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort());

let attempt = 0;
while (!stop.signal.aborted) {
  let delayMs = cfg.popular.checkIntervalMs;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const latest = await latestSnapshotDate(sql);
    if (latest !== today) {
      const started = Date.now();
      const rows = await fetchTopPackages(cfg.popular.size, cfg.popular.requestTimeoutMs, stop.signal);
      await storeSnapshot(sql, today, rows, 7);
      log.info('popular snapshot stored', { snapshot: today, count: rows.length, ms: Date.now() - started });
    }
    attempt = 0;
  } catch (e) {
    if (stop.signal.aborted) break;
    delayMs = backoffDelay(attempt++, 30_000, 3_600_000);
    log.warn('popular refresh failed', { ...errFields(e), attempt, delayMs });
  }
  await sleep(delayMs, undefined, { signal: stop.signal }).catch(() => {});
}

await sql.end({ timeout: 5 });
