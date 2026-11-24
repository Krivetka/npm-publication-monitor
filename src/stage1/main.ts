// Stage 1 worker: reads the event journal in seq order, computes features and writes
// the results together with the cursor in one transaction.

import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from '../config.ts';
import { connect } from '../db.ts';
import { backoffDelay } from '../lib/backoff.ts';
import { errFields, log } from '../log.ts';
import { loadLatestSnapshot } from '../popular/source.ts';
import { prevFromEvent, Stage1Engine, type Stage1Result } from './engine.ts';
import { NameIndex } from './nominal.ts';
import { DEFAULT_PARAMS } from './params.ts';
import {
  eventTime,
  type HourlyCounts,
  journalStart,
  loadEvents,
  loadStageCursor,
  persistBatch,
  prefetchPrev,
  seqBefore,
} from './store.ts';

const STAGE = 'stage1';
const cfg = loadConfig();
const { batchLimit, pollIntervalMs, popularReloadMs } = cfg.stage1;
const params = DEFAULT_PARAMS;
const sql = connect(cfg.databaseUrl, STAGE);

const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    log.info('shutdown requested', { signal });
    stop.abort();
  });
}

let start: Date | null = null;
while (!stop.signal.aborted && (start = await journalStart(sql)) === null) {
  log.info('journal is empty, waiting for collector');
  await sleep(10_000, undefined, { signal: stop.signal }).catch(() => {});
}

// On the first start the popular-package snapshot may still be loading — wait for it,
// otherwise the journal is processed without the nominal lane and the watchlist.
let snapshot = await loadLatestSnapshot(sql);
for (let waited = 0; !snapshot && waited < 300_000 && !stop.signal.aborted; waited += 15_000) {
  log.info('waiting for popular snapshot');
  await sleep(15_000, undefined, { signal: stop.signal }).catch(() => {});
  snapshot = await loadLatestSnapshot(sql);
}
const buildIndex = () => (snapshot ? new NameIndex(snapshot.names, params.nominalMinLength) : null);
const engine = new Stage1Engine(params, buildIndex(), start ?? new Date());
const engineTag = () => `${engine.id}@${snapshot?.snapshot ?? 'none'}`;
if (!snapshot) log.warn('no popular snapshot yet: nominal and watchlist lanes are off until it appears');

async function processBatch(afterSeq: number, upToSeq: number | null, persist: boolean) {
  const events = await loadEvents(sql, afterSeq, batchLimit, upToSeq);
  if (events.length === 0) return { count: 0, lastSeq: afterSeq, candidates: 0 };

  const prev = await prefetchPrev(sql, [...new Set(events.map((e) => e.package))], events[0]!.seq);
  const results: Stage1Result[] = [];
  const hourly = new Map<number, HourlyCounts>();
  for (const e of events) {
    const r = engine.process(e, prev.get(e.package) ?? null);
    prev.set(e.package, prevFromEvent(e));
    if (!r) continue;
    results.push(r);
    const hour = Math.floor(r.eventTime.getTime() / 3_600_000) * 3_600_000;
    const c = hourly.get(hour) ?? { processed: 0, flagged: 0, candidates: 0 };
    c.processed++;
    if (r.features.length > 0) c.flagged++;
    if (r.candidate) c.candidates++;
    hourly.set(hour, c);
  }
  const lastSeq = events.at(-1)!.seq;
  // The engine has already counted the batch in its windows: on failure only the write is retried.
  if (persist) await persistWithRetry(() => persistBatch(sql, STAGE, engineTag(), results, lastSeq, events.length, hourly));
  return { count: events.length, lastSeq, candidates: results.filter((r) => r.candidate).length };
}

async function persistWithRetry(write: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await write();
    } catch (e) {
      if (stop.signal.aborted) throw e;
      const delayMs = backoffDelay(attempt);
      log.warn('stage1 persist failed, retrying', { ...errFields(e), attempt: attempt + 1, delayMs });
      await sleep(delayMs, undefined, { signal: stop.signal }).catch(() => {});
    }
  }
}

let cursor = (await loadStageCursor(sql, STAGE)) ?? 0;

// Warm-up: the temporal-lane windows are rebuilt by replaying the history before the cursor.
if (cursor > 0 && !stop.signal.aborted) {
  const t = await eventTime(sql, cursor);
  if (t) {
    let from = await seqBefore(sql, new Date(t.getTime() - (params.historyMin + params.windowMin) * 60_000));
    const started = Date.now();
    let warmed = 0;
    while (from < cursor && !stop.signal.aborted) {
      const r = await processBatch(from, cursor, false);
      if (r.count === 0) break;
      warmed += r.count;
      from = r.lastSeq;
    }
    log.info('windows warmed up', { events: warmed, ms: Date.now() - started, state: engine.stateSize() });
  }
}

log.info('stage1 started', { engine: engineTag(), cursor, journalStart: start, popular: snapshot?.names.length ?? 0 });

let attempt = 0;
let lastReload = Date.now();
let report = { events: 0, candidates: 0, at: Date.now() };

while (!stop.signal.aborted) {
  try {
    const r = await processBatch(cursor, null, true);
    cursor = r.lastSeq;
    attempt = 0;
    report.events += r.count;
    report.candidates += r.candidates;

    if (Date.now() - lastReload >= popularReloadMs) {
      lastReload = Date.now();
      const fresh = await loadLatestSnapshot(sql);
      if (fresh && fresh.snapshot !== snapshot?.snapshot) {
        snapshot = fresh;
        engine.setNames(buildIndex());
        log.info('popular snapshot loaded', { snapshot: fresh.snapshot, names: fresh.names.length, engine: engineTag() });
      }
    }

    if (Date.now() - report.at >= 60_000) {
      const [lag] = await sql<{ n: string }[]>`select count(*) as n from feed_event where seq > ${cursor}`;
      log.info('stage1 progress', {
        cursor,
        lag: Number(lag?.n ?? 0),
        events: report.events,
        candidates: report.candidates,
        state: engine.stateSize(),
      });
      report = { events: 0, candidates: 0, at: Date.now() };
    }

    if (r.count < batchLimit) await sleep(pollIntervalMs, undefined, { signal: stop.signal });
  } catch (e) {
    if (stop.signal.aborted) break;
    const delayMs = backoffDelay(attempt++);
    log.warn('stage1 batch failed, retrying', { ...errFields(e), attempt, delayMs, cursor });
    await sleep(delayMs, undefined, { signal: stop.signal }).catch(() => {});
  }
}

await sql.end({ timeout: 5 });
log.info('stage1 stopped', { cursor });
