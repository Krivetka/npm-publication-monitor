// Stage 2 worker: takes stage 1 candidates, enriches them and writes the result.

import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from '../config.ts';
import { connect } from '../db.ts';
import { backoffDelay } from '../lib/backoff.ts';
import { errFields, log } from '../log.ts';
import { enrichCandidate, type Stage2Outcome } from './enrich.ts';
import { STAGE2_PARAMS, stage2EngineId } from './params.ts';
import { Sources } from './sources.ts';
import { domainCache, loadQueue, persistOutcome } from './store.ts';

const cfg = loadConfig();
const params = STAGE2_PARAMS;
const engine = stage2EngineId(params);
const sql = connect(cfg.databaseUrl, 'stage2');
const sources = new Sources({ githubToken: cfg.stage2.githubToken, timeoutMs: cfg.stage2.requestTimeoutMs, perHour: cfg.stage2.perHour });
const domains = domainCache(sql, 30);
const MAX_ATTEMPTS = 5;

const stop = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    log.info('shutdown requested', { signal });
    stop.abort();
  });
}

// Deferred candidates: the version is not yet visible in the packument or a source is down.
const deferred = new Map<number, { until: number; attempts: number }>();

async function persistWithRetry(o: Stage2Outcome): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await persistOutcome(sql, engine, o, sources.usage.drain());
    } catch (e) {
      if (stop.signal.aborted) throw e;
      const delayMs = backoffDelay(attempt);
      log.warn('stage2 persist failed, retrying', { ...errFields(e), seq: o.seq, delayMs });
      await sleep(delayMs, undefined, { signal: stop.signal }).catch(() => {});
    }
  }
}

log.info('stage2 started', { engine, github: cfg.stage2.githubToken ? 'token' : 'anonymous', perHour: cfg.stage2.perHour });

let attempt = 0;
let report = { done: 0, alerts: 0, deferred: 0, at: Date.now() };

while (!stop.signal.aborted) {
  try {
    const now = Date.now();
    const queue = await loadQueue(sql, 100, params.settleMs);
    const next = queue.find((c) => (deferred.get(c.seq)?.until ?? 0) <= now);
    attempt = 0;

    if (!next) {
      await sleep(cfg.stage2.pollIntervalMs, undefined, { signal: stop.signal });
    } else {
      const result = await enrichCandidate(next, sources, domains, params);
      if (result === 'defer' || result === 'retry') {
        const d = deferred.get(next.seq) ?? { until: 0, attempts: 0 };
        d.attempts++;
        d.until = Date.now() + (result === 'defer' ? 120_000 : backoffDelay(d.attempts, 30_000, 1_800_000));
        deferred.set(next.seq, d);
        report.deferred++;
        if (result === 'retry' && d.attempts >= MAX_ATTEMPTS) {
          // the packument never arrived: record what we have so the queue does not stall
          deferred.delete(next.seq);
          await persistWithRetry({
            seq: next.seq,
            package: next.package,
            eventTime: next.observedAt,
            kind: 'error',
            versions: [],
            prescore: next.prescore,
            finalScore: next.prescore,
            alert: false,
            features: [],
            evidence: {},
            sources: { registry: { skipped: 'error', attempts: d.attempts } },
          });
        }
      } else {
        deferred.delete(next.seq);
        // One alert per package per window: a pipeline republishing every minute would
        // otherwise raise a new alert per event. The repeat keeps its score and evidence.
        if (result.alert) {
          const [prior] = await sql<{ seq: string }[]>`
            select seq from stage2_result
            where package = ${result.package} and alert and enriched_at > now() - make_interval(hours => ${params.alertRepeatHours})
            order by seq desc limit 1`;
          if (prior) {
            result.alert = false;
            result.sources = { ...result.sources, repeat_of: Number(prior.seq) };
          }
        }
        await persistWithRetry(result);
        report.done++;
        if (result.alert) {
          report.alerts++;
          log.warn('ALERT', {
            package: result.package,
            versions: result.versions,
            score: result.finalScore,
            features: result.features.map((f) => f.id),
          });
        }
      }
    }

    if (Date.now() - report.at >= 60_000) {
      log.info('stage2 progress', { queue: queue.length, done: report.done, alerts: report.alerts, deferred: report.deferred, waiting: deferred.size });
      report = { done: 0, alerts: 0, deferred: 0, at: Date.now() };
      for (const [seq, d] of deferred) if (d.until < Date.now() - 86_400_000) deferred.delete(seq);
    }
  } catch (e) {
    if (stop.signal.aborted) break;
    const delayMs = backoffDelay(attempt++);
    log.warn('stage2 loop failed, retrying', { ...errFields(e), attempt, delayMs });
    await sleep(delayMs, undefined, { signal: stop.signal }).catch(() => {});
  }
}

await sql.end({ timeout: 5 });
log.info('stage2 stopped');
