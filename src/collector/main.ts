// Collector: continuous polling of the changes feed with a cursor, writing into the event journal.

import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from '../config.ts';
import { connect } from '../db.ts';
import { backoffDelay } from '../lib/backoff.ts';
import { errFields, log } from '../log.ts';
import { fetchChanges, fetchHeadSeq } from './feed.ts';
import { type Cursor, ensurePartitions, loadCursor, persistPage } from './store.ts';

const FEED = 'npm';
const cfg = loadConfig();
const { url, batchLimit, pollIntervalMs, requestTimeoutMs, headCheckIntervalMs } = cfg.feed;
const sql = connect(cfg.databaseUrl, 'collector');
const PARTITION_CHECK_MS = 86_400_000;

const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    log.info('shutdown requested', { signal });
    stop.abort();
  });
}

async function startPosition(): Promise<Cursor> {
  const saved = await loadCursor(sql, FEED);
  if (saved !== null) {
    log.info('resuming from saved cursor', { since: saved.lastSeq, windowStart: saved.windowStart });
    return saved;
  }
  if (cfg.feed.startSeq !== null) {
    log.info('starting from FEED_START_SEQ', { since: cfg.feed.startSeq });
    return { lastSeq: cfg.feed.startSeq, windowStart: null };
  }
  const now = new Date();
  const head = await fetchHeadSeq(url, requestTimeoutMs, stop.signal);
  log.info('starting from current feed head', { since: head });
  return { lastSeq: head, windowStart: now };
}

// The journal is partitioned by month; the current and the next month must always exist.
async function maintainPartitions(): Promise<void> {
  const created = await ensurePartitions(sql);
  if (created.length > 0) log.info('journal partitions created', { created });
}

let cursor: Cursor | null = null;
let attempt = 0;
let lastHeadCheck = 0;
let lastPartitionCheck = 0;
let stats = { polls: 0, events: 0, inserted: 0, startedAt: Date.now() };

while (!stop.signal.aborted) {
  try {
    if (Date.now() - lastPartitionCheck >= PARTITION_CHECK_MS) {
      await maintainPartitions();
      lastPartitionCheck = Date.now();
    }
    cursor ??= await startPosition();

    const page = await fetchChanges(url, cursor.lastSeq, batchLimit, requestTimeoutMs, stop.signal);
    const observedAt = new Date();
    // a full page means the feed is not drained yet: the window bound stays until we catch up
    const backlog = page.changes.length >= batchLimit;
    const next: Cursor = { lastSeq: page.lastSeq, windowStart: backlog ? cursor.windowStart : observedAt };

    let headSeq: number | null = null;
    if (Date.now() - lastHeadCheck >= headCheckIntervalMs) {
      headSeq = await fetchHeadSeq(url, requestTimeoutMs, stop.signal);
      lastHeadCheck = Date.now();
    }

    const inserted = await persistPage(sql, FEED, page, { observedAt, observedAfter: cursor.windowStart, next, headSeq });
    cursor = next;
    attempt = 0;

    stats.polls++;
    stats.events += page.changes.length;
    stats.inserted += inserted;
    if (headSeq !== null) {
      const elapsedS = Math.max(1, (Date.now() - stats.startedAt) / 1000);
      log.info('collector progress', {
        since: cursor.lastSeq,
        headSeq,
        lag: Math.max(0, headSeq - cursor.lastSeq),
        polls: stats.polls,
        events: stats.events,
        inserted: stats.inserted,
        eventsPerSec: +(stats.events / elapsedS).toFixed(2),
      });
      stats = { polls: 0, events: 0, inserted: 0, startedAt: Date.now() };
    }

    if (!backlog) await sleep(pollIntervalMs, undefined, { signal: stop.signal });
  } catch (e) {
    if (stop.signal.aborted) break;
    const delayMs = backoffDelay(attempt++);
    log.warn('poll failed, retrying', { ...errFields(e), attempt, delayMs, since: cursor?.lastSeq });
    await sleep(delayMs, undefined, { signal: stop.signal }).catch(() => {});
  }
}

await sql.end({ timeout: 5 });
log.info('collector stopped', { since: cursor?.lastSeq });
