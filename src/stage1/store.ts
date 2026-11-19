import type { Sql } from '../db.ts';
import { type FeedEvent, type PrevInfo, prevFromEvent, type Stage1Result } from './engine.ts';

interface EventRow {
  seq: string;
  package: string;
  rev: string;
  deleted: boolean;
  observed_at: Date;
  observed_after: Date | null;
}

const toEvent = (r: EventRow): FeedEvent => ({
  seq: Number(r.seq),
  package: r.package,
  rev: r.rev,
  deleted: r.deleted,
  observedAt: r.observed_at,
  observedAfter: r.observed_after,
});

export async function loadStageCursor(sql: Sql, stage: string): Promise<number | null> {
  const [row] = await sql<{ last_seq: string }[]>`select last_seq from stage_cursor where stage = ${stage}`;
  return row ? Number(row.last_seq) : null;
}

export async function journalStart(sql: Sql): Promise<Date | null> {
  const [row] = await sql<{ t: Date | null }[]>`select min(observed_at) as t from feed_event`;
  return row?.t ?? null;
}

export async function loadEvents(sql: Sql, afterSeq: number, limit: number, upToSeq: number | null = null): Promise<FeedEvent[]> {
  const rows = await sql<EventRow[]>`
    select seq, package, rev, deleted, observed_at, observed_after from feed_event
    where seq > ${afterSeq} ${upToSeq === null ? sql`` : sql`and seq <= ${upToSeq}`}
    order by seq limit ${limit}`;
  return rows.map(toEvent);
}

// The last event of each package in the batch before the batch starts — history for the version lane.
export async function prefetchPrev(sql: Sql, packages: string[], beforeSeq: number): Promise<Map<string, PrevInfo>> {
  const prev = new Map<string, PrevInfo>();
  if (packages.length === 0) return prev;
  const rows = await sql<EventRow[]>`
    select distinct on (package) seq, package, rev, deleted, observed_at, observed_after
    from feed_event where package in ${sql(packages)} and seq < ${beforeSeq}
    order by package, seq desc`;
  for (const r of rows) prev.set(r.package, prevFromEvent(toEvent(r)));
  return prev;
}

// The last event before the given time — where window warm-up starts.
export async function seqBefore(sql: Sql, time: Date): Promise<number> {
  const [row] = await sql<{ seq: string | null }[]>`select max(seq) as seq from feed_event where observed_at < ${time}`;
  return row?.seq ? Number(row.seq) : 0;
}

export async function eventTime(sql: Sql, seq: number): Promise<Date | null> {
  const [row] = await sql<{ observed_at: Date }[]>`select observed_at from feed_event where seq = ${seq}`;
  return row?.observed_at ?? null;
}

export interface HourlyCounts {
  processed: number;
  flagged: number;
  candidates: number;
}

export async function persistBatch(
  sql: Sql,
  stage: string,
  engine: string,
  results: Stage1Result[],
  lastSeq: number,
  processed: number,
  hourly: Map<number, HourlyCounts>,
): Promise<void> {
  await sql.begin(async (tx) => {
    const flagged = results.filter((r) => r.features.length > 0);
    if (flagged.length > 0) {
      const rows = flagged.map((r) => ({
        seq: r.seq,
        package: r.package,
        event_time: r.eventTime,
        prescore: r.prescore,
        candidate: r.candidate,
        features: tx.json(r.features as unknown as Parameters<typeof tx.json>[0]),
        engine,
      }));
      await tx`
        insert into stage1_result ${tx(rows)}
        on conflict (seq) do update set
          prescore = excluded.prescore, candidate = excluded.candidate,
          features = excluded.features, engine = excluded.engine, event_time = excluded.event_time`;
    }
    for (const [hourMs, c] of hourly) {
      await tx`
        insert into stage1_hourly (hour, processed, flagged, candidates)
        values (${new Date(hourMs)}, ${c.processed}, ${c.flagged}, ${c.candidates})
        on conflict (hour) do update set
          processed  = stage1_hourly.processed + excluded.processed,
          flagged    = stage1_hourly.flagged + excluded.flagged,
          candidates = stage1_hourly.candidates + excluded.candidates`;
    }
    await tx`
      insert into stage_cursor (stage, last_seq, processed, updated_at)
      values (${stage}, ${lastSeq}, ${processed}, now())
      on conflict (stage) do update set
        last_seq = excluded.last_seq,
        processed = stage_cursor.processed + excluded.processed,
        updated_at = now()`;
    // Tell listeners (the web process) which events got stage-1 results; delivered on commit.
    for (const chunk of chunkSeqs(flagged.map((r) => r.seq))) await tx`select pg_notify('stage1', ${JSON.stringify(chunk)})`;
  });
}

// NOTIFY payloads are limited to 8000 bytes; split long seq lists.
export function chunkSeqs(seqs: number[], maxChars = 7000): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  let len = 2;
  for (const s of seqs) {
    const add = String(s).length + 1;
    if (len + add > maxChars && cur.length > 0) {
      out.push(cur);
      cur = [];
      len = 2;
    }
    cur.push(s);
    len += add;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}
