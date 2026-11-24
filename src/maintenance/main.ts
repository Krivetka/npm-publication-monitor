// Daily database maintenance: journal partitions, the retention periods of the privacy
// notice, and the refresh of the materialised daily totals. All three are database functions;
// this process only calls them on schedule and logs the result.

import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from '../config.ts';
import { connect } from '../db.ts';
import { backoffDelay } from '../lib/backoff.ts';
import { errFields, log } from '../log.ts';
import { runMaintenance } from './run.ts';

const cfg = loadConfig();
const sql = connect(cfg.databaseUrl, 'maintenance');
const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop.abort());

let attempt = 0;
while (!stop.signal.aborted) {
  let delayMs = cfg.maintenance.intervalMs;
  try {
    const started = Date.now();
    const report = await runMaintenance(sql, cfg.maintenance);
    log.info('maintenance done', { ...report, ms: Date.now() - started });
    attempt = 0;
  } catch (e) {
    if (stop.signal.aborted) break;
    delayMs = backoffDelay(attempt++, 60_000, 3_600_000);
    log.warn('maintenance failed', { ...errFields(e), attempt, delayMs });
  }
  await sleep(delayMs, undefined, { signal: stop.signal }).catch(() => {});
}

await sql.end({ timeout: 5 });
