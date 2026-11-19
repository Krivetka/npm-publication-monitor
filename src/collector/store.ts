import type { Sql } from '../db.ts';
import type { FeedPage } from './feed.ts';

export interface Cursor {
  lastSeq: number;
  // lower bound of the appearance time of the next page's events; null — unknown
  windowStart: Date | null;
}

export async function loadCursor(sql: Sql, feed: string): Promise<Cursor | null> {
  const [row] = await sql<{ last_seq: string; window_start: Date | null }[]>`
    select last_seq, window_start from collector_state where feed = ${feed}`;
  return row ? { lastSeq: Number(row.last_seq), windowStart: row.window_start } : null;
}

export interface PageMeta {
  observedAt: Date;
  observedAfter: Date | null;
  next: Cursor;
  headSeq: number | null;
}

// Events and the cursor are written in one transaction: after a restart reading resumes
// exactly from the stored position. The journal is partitioned by observed_at, so seq alone
// cannot be a unique key; a seq received twice is dropped by the NOT EXISTS check instead.
// Other processes learn about the new rows through NOTIFY 'feed' (delivered on commit).
export async function persistPage(sql: Sql, feed: string, page: FeedPage, meta: PageMeta): Promise<number> {
  return sql.begin(async (tx) => {
    let inserted = 0;
    if (page.changes.length > 0) {
      const res = await tx`
        insert into feed_event (seq, package, rev, deleted, observed_at, observed_after)
        select v.seq, v.package, v.rev, v.deleted, ${meta.observedAt}::timestamptz, ${meta.observedAfter}::timestamptz
        from unnest(
          ${tx.array(page.changes.map((c) => c.seq), 1016)},
          ${tx.array(page.changes.map((c) => c.id), 1009)},
          ${tx.array(page.changes.map((c) => c.rev), 1009)},
          ${tx.array(page.changes.map((c) => c.deleted), 1000)}
        ) as v(seq, package, rev, deleted)
        where not exists (select 1 from feed_event f where f.seq = v.seq)`;
      inserted = res.count;
    }
    await tx`
      insert into collector_state (feed, last_seq, window_start, head_seq, polled_at, advanced_at)
      values (${feed}, ${meta.next.lastSeq}, ${meta.next.windowStart}, ${meta.headSeq}, now(), now())
      on conflict (feed) do update set
        last_seq     = excluded.last_seq,
        window_start = excluded.window_start,
        head_seq     = coalesce(excluded.head_seq, collector_state.head_seq),
        polled_at    = now(),
        advanced_at  = case when excluded.last_seq <> collector_state.last_seq
                            then now() else collector_state.advanced_at end`;
    // pg_notify on the transaction's own connection: delivered to listeners at commit
    if (inserted > 0) await tx`select pg_notify('feed', ${String(page.lastSeq)})`;
    return inserted;
  });
}

// Monthly partition name and bounds for the month containing `d` (UTC).
export function monthPartition(d: Date, offsetMonths = 0): { name: string; from: string; to: string } {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + offsetMonths;
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 1));
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { name: `feed_event_${start.getUTCFullYear()}${String(start.getUTCMonth() + 1).padStart(2, '0')}`, from: iso(start), to: iso(end) };
}

// Make sure the partitions for the current and the next month exist. The database function
// runs with the rights of the journal owner: the pipeline role cannot create tables.
export async function ensurePartitions(sql: Sql, now = new Date()): Promise<string[]> {
  const [row] = await sql<{ created: string[] }[]>`select feed_event_ensure_partitions(${now}) as created`;
  return row?.created ?? [];
}
