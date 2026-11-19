import type { Sql } from '../db.ts';
import type { DomainInfo } from './external.ts';
import type { Candidate, Stage2Outcome } from './enrich.ts';
import type { UsageRow } from './sources.ts';

// Candidate queue: the watchlist first (largest blast radius), then by prescore;
// the event must "settle" so that the packument in the CDN has time to update.
export async function loadQueue(sql: Sql, limit: number, settleMs: number): Promise<Candidate[]> {
  const rows = await sql<{ seq: string; package: string; prescore: number; watchlist: boolean; observed_at: Date; observed_after: Date | null; prev_observed_at: Date | null }[]>`
    select r.seq, r.package, r.prescore, (r.features @> '[{"id":"watchlist"}]') as watchlist, e.observed_at, e.observed_after,
      (select max(p.observed_at) from feed_event p where p.package = e.package and p.seq < e.seq) as prev_observed_at
    from stage1_result r
    join feed_event e on e.seq = r.seq
    where r.candidate
      and not exists (select 1 from stage2_result s where s.seq = r.seq)
      and e.observed_at <= now() - make_interval(secs => ${settleMs / 1000})
    order by (r.features @> '[{"id":"watchlist"}]') desc, r.prescore desc, r.seq
    limit ${limit}`;
  return rows.map((r) => ({
    seq: Number(r.seq),
    package: r.package,
    prescore: r.prescore,
    observedAt: r.observed_at,
    observedAfter: r.observed_after,
    prevObservedAt: r.prev_observed_at,
    watchlist: r.watchlist,
  }));
}

// Maintainer set of the package as seen in the packument at enrichment time (names only).
export function maintainersOf(o: Stage2Outcome): string[] | null {
  const reg = o.evidence.registry;
  if (typeof reg !== 'object' || reg === null) return null;
  const m = (reg as Record<string, unknown>).maintainers;
  if (!Array.isArray(m)) return null;
  return [...new Set(m.filter((x): x is string => typeof x === 'string'))].sort();
}

export function setDiff(prev: string[] | null, next: string[]): { added: string[]; removed: string[]; changed: boolean } {
  const before = new Set(prev ?? []);
  const after = new Set(next);
  const added = next.filter((n) => !before.has(n));
  const removed = (prev ?? []).filter((p) => !after.has(p));
  return { added, removed, changed: prev === null || added.length > 0 || removed.length > 0 };
}

export async function persistOutcome(sql: Sql, engine: string, o: Stage2Outcome, usage: UsageRow[]): Promise<void> {
  await sql.begin(async (tx) => {
    const json = (v: unknown) => tx.json(v as Parameters<typeof tx.json>[0]);
    const res = await tx`
      insert into stage2_result (seq, package, event_time, enriched_at, kind, versions, prescore, final_score, alert, features, evidence, sources, engine)
      values (${o.seq}, ${o.package}, ${o.eventTime}, now(), ${o.kind}, ${o.versions}, ${o.prescore}, ${o.finalScore}, ${o.alert},
              ${json(o.features)}, ${json(o.evidence)}, ${json(o.sources)}, ${engine})
      on conflict (seq) do nothing`;
    for (const u of usage) {
      await tx`
        insert into source_usage (hour, source, requests, errors, skipped)
        values (${u.hour}, ${u.source}, ${u.requests}, ${u.errors}, ${u.skipped})
        on conflict (hour, source) do update set
          requests = source_usage.requests + excluded.requests,
          errors   = source_usage.errors + excluded.errors,
          skipped  = source_usage.skipped + excluded.skipped`;
    }
    // Maintainer-set history: one row per observed change of the set.
    const maintainers = maintainersOf(o);
    if (maintainers !== null) {
      const [last] = await tx<{ maintainers: string[] }[]>`
        select maintainers from maintainer_set where package = ${o.package} order by seq desc limit 1`;
      const diff = setDiff(last ? [...last.maintainers].sort() : null, maintainers);
      if (diff.changed) {
        await tx`
          insert into maintainer_set (package, seq, observed_at, maintainers, added, removed)
          values (${o.package}, ${o.seq}, ${o.eventTime}, ${maintainers}, ${diff.added}, ${diff.removed})
          on conflict (package, seq) do nothing`;
      }
    }
    if (res.count > 0) await tx`select pg_notify('stage2', ${String(o.seq)})`;
  });
}

export function domainCache(sql: Sql, ttlDays: number) {
  return {
    async get(domain: string): Promise<DomainInfo | null> {
      const [row] = await sql<{ status: number; registered: Date | null; expires: Date | null }[]>`
        select status, registered, expires from rdap_cache
        where domain = ${domain} and fetched_at > now() - make_interval(days => ${ttlDays})`;
      return row
        ? { status: row.status, registered: row.registered?.toISOString() ?? null, expires: row.expires?.toISOString() ?? null }
        : null;
    },
    async set(domain: string, info: DomainInfo): Promise<void> {
      await sql`
        insert into rdap_cache (domain, fetched_at, status, registered, expires)
        values (${domain}, now(), ${info.status}, ${info.registered}, ${info.expires})
        on conflict (domain) do update set
          fetched_at = now(), status = excluded.status, registered = excluded.registered, expires = excluded.expires`;
    },
  };
}
