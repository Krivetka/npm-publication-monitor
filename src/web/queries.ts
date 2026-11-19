// UI queries. Read-only.

import type { Sql } from '../db.ts';
import type { Feature } from '../lib/feature.ts';

export interface Status {
  collector: { lastSeq: number; headSeq: number | null; polledAt: Date; advancedAt: Date } | null;
  stage1: { lastSeq: number; updatedAt: Date; lag: number } | null;
  stage2: { queue: number; lastAt: Date | null };
  popular: { snapshot: string | null; names: number };
  journal: { first: Date | null; estimate: number };
}

export async function status(sql: Sql): Promise<Status> {
  const [c] = await sql<{ last_seq: string; head_seq: string | null; polled_at: Date; advanced_at: Date }[]>`
    select last_seq, head_seq, polled_at, advanced_at from collector_state where feed = 'npm'`;
  const [s1] = await sql<{ last_seq: string; updated_at: Date }[]>`select last_seq, updated_at from stage_cursor where stage = 'stage1'`;
  const [lag] = s1 ? await sql<{ n: number }[]>`select count(*)::int as n from feed_event where seq > ${s1.last_seq}` : [{ n: 0 }];
  const [q] = await sql<{ n: number; last: Date | null }[]>`
    select (select count(*)::int from stage1_result r
            where r.candidate and not exists (select 1 from stage2_result s where s.seq = r.seq)) as n,
           (select max(enriched_at) from stage2_result) as last`;
  const [p] = await sql<{ s: string | null; n: number }[]>`
    select max(snapshot)::text as s,
           (select count(*)::int from popular_package where snapshot = (select max(snapshot) from popular_package)) as n
    from popular_package`;
  // feed_event is partitioned: the planner estimate lives on the partitions, not the parent
  const [j] = await sql<{ first: Date | null; estimate: string }[]>`
    select (select min(observed_at) from feed_event) as first,
           (select coalesce(sum(greatest(c.reltuples, 0)), 0)::bigint
            from pg_inherits i join pg_class c on c.oid = i.inhrelid
            where i.inhparent = 'feed_event'::regclass) as estimate`;
  return {
    collector: c ? { lastSeq: Number(c.last_seq), headSeq: c.head_seq === null ? null : Number(c.head_seq), polledAt: c.polled_at, advancedAt: c.advanced_at } : null,
    stage1: s1 ? { lastSeq: Number(s1.last_seq), updatedAt: s1.updated_at, lag: lag?.n ?? 0 } : null,
    stage2: { queue: q?.n ?? 0, lastAt: q?.last ?? null },
    popular: { snapshot: p?.s ?? null, names: p?.n ?? 0 },
    journal: { first: j?.first ?? null, estimate: Number(j?.estimate ?? 0) },
  };
}

export interface Totals {
  events: number;
  processed: number;
  flagged: number;
  candidates: number;
  enriched: number;
  alerts: number;
}

export async function totals24h(sql: Sql): Promise<Totals> {
  const [r] = await sql<{ events: number; processed: number; flagged: number; candidates: number; enriched: number; alerts: number }[]>`
    select
      (select count(*)::int from feed_event where observed_at > now() - interval '24 hours') as events,
      coalesce(sum(processed), 0)::int as processed,
      coalesce(sum(flagged), 0)::int as flagged,
      coalesce(sum(candidates), 0)::int as candidates,
      (select count(*)::int from stage2_result where event_time > now() - interval '24 hours') as enriched,
      (select count(*)::int from stage2_result where alert and event_time > now() - interval '24 hours') as alerts
    from stage1_hourly where hour > now() - interval '24 hours'`;
  return r!;
}

export interface HourRow {
  hour: Date;
  processed: number;
  candidates: number;
  enriched: number;
  alerts: number;
}

export async function hourly(sql: Sql, hours: number): Promise<HourRow[]> {
  return sql<HourRow[]>`
    select h.hour,
           coalesce(s.processed, 0)::int as processed,
           coalesce(s.candidates, 0)::int as candidates,
           coalesce(a.enriched, 0)::int as enriched,
           coalesce(a.alerts, 0)::int as alerts
    from generate_series(date_trunc('hour', now()) - make_interval(hours => ${hours - 1}), date_trunc('hour', now()), interval '1 hour') as h(hour)
    left join stage1_hourly s on s.hour = h.hour
    left join (
      select date_trunc('hour', event_time) as hour, count(*) as enriched, count(*) filter (where alert) as alerts
      from stage2_result where event_time > now() - make_interval(hours => ${hours})
      group by 1
    ) a on a.hour = h.hour
    order by h.hour`;
}

// Events per minute over the last hour (the current, incomplete minute is excluded).
export async function pulse(sql: Sql): Promise<{ minute: Date; n: number }[]> {
  return sql<{ minute: Date; n: number }[]>`
    select m as minute, coalesce(x.n, 0)::int as n
    from generate_series(date_trunc('minute', now()) - interval '60 minutes', date_trunc('minute', now()) - interval '1 minute', interval '1 minute') as m
    left join (
      select date_trunc('minute', observed_at) as mm, count(*) as n
      from feed_event where observed_at >= date_trunc('minute', now()) - interval '60 minutes'
      group by 1
    ) x on x.mm = m
    order by m`;
}

export interface UsageRow {
  source: string;
  requests: number;
  errors: number;
  skipped: number;
}

export async function sourceUsage24h(sql: Sql): Promise<UsageRow[]> {
  return sql<UsageRow[]>`
    select source, sum(requests)::int as requests, sum(errors)::int as errors, sum(skipped)::int as skipped
    from source_usage where hour > now() - interval '24 hours' group by source order by source`;
}

export interface FeatureCount {
  stage: number;
  id: string;
  count: number;
}

export async function featureCounts24h(sql: Sql): Promise<FeatureCount[]> {
  return sql<FeatureCount[]>`
    select stage::int as stage, feature_id as id, count(*)::int as count
    from feature_hit
    where event_time > now() - interval '24 hours'
    group by 1, 2 order by 1, 3 desc`;
}

export interface EnrichedRow {
  seq: string;
  package: string;
  event_time: Date;
  versions: string[];
  kind: string;
  prescore: number;
  final_score: number;
  alert: boolean;
  features: Feature[];
  stage1: Feature[] | null;
}

export async function listEnriched(sql: Sql, opts: { alertOnly: boolean; minScore: number; offset: number; limit: number }): Promise<EnrichedRow[]> {
  return sql<EnrichedRow[]>`
    select s.seq, s.package, s.event_time, s.versions, s.kind, s.prescore, s.final_score, s.alert, s.features, r.features as stage1
    from stage2_result s left join stage1_result r on r.seq = s.seq
    where (${!opts.alertOnly} or s.alert) and s.final_score >= ${opts.minScore}
    order by s.seq desc offset ${opts.offset} limit ${opts.limit}`;
}

export interface FlaggedRow {
  seq: string;
  package: string;
  event_time: Date;
  prescore: number;
  candidate: boolean;
  features: Feature[];
  final_score: number | null;
  alert: boolean | null;
}

export async function listFlagged(sql: Sql, opts: { feature: string | null; candidateOnly: boolean; offset: number; limit: number }): Promise<FlaggedRow[]> {
  const byFeature = opts.feature ? sql`and r.features @> ${sql.json([{ id: opts.feature }])}` : sql``;
  return sql<FlaggedRow[]>`
    select r.seq, r.package, r.event_time, r.prescore, r.candidate, r.features, s.final_score, s.alert
    from stage1_result r left join stage2_result s on s.seq = r.seq
    where (${!opts.candidateOnly} or r.candidate) ${byFeature}
    order by r.seq desc offset ${opts.offset} limit ${opts.limit}`;
}

export interface EventCard {
  event: { seq: string; package: string; rev: string; deleted: boolean; observed_at: Date; observed_after: Date | null };
  stage1: { prescore: number; candidate: boolean; features: Feature[]; engine: string } | null;
  stage2: {
    enriched_at: Date;
    kind: string;
    versions: string[];
    prescore: number;
    final_score: number;
    alert: boolean;
    features: Feature[];
    evidence: Record<string, unknown>;
    sources: Record<string, unknown>;
    engine: string;
  } | null;
}

export async function eventCard(sql: Sql, seq: number): Promise<EventCard | null> {
  const [event] = await sql<EventCard['event'][]>`select seq, package, rev, deleted, observed_at, observed_after from feed_event where seq = ${seq}`;
  if (!event) return null;
  const [stage1] = await sql<NonNullable<EventCard['stage1']>[]>`select prescore, candidate, features, engine from stage1_result where seq = ${seq}`;
  const [stage2] = await sql<NonNullable<EventCard['stage2']>[]>`
    select enriched_at, kind, versions, prescore, final_score, alert, features, evidence, sources, engine from stage2_result where seq = ${seq}`;
  return { event, stage1: stage1 ?? null, stage2: stage2 ?? null };
}

export interface PackageEventRow {
  seq: string;
  rev: string;
  deleted: boolean;
  observed_at: Date;
  prescore: number | null;
  candidate: boolean | null;
  s1: Feature[] | null;
  final_score: number | null;
  alert: boolean | null;
  versions: string[] | null;
}

export async function packageEvents(sql: Sql, name: string, limit: number): Promise<PackageEventRow[]> {
  return sql<PackageEventRow[]>`
    select e.seq, e.rev, e.deleted, e.observed_at, r.prescore, r.candidate, r.features as s1, s.final_score, s.alert, s.versions
    from feed_event e
    left join stage1_result r on r.seq = e.seq
    left join stage2_result s on s.seq = e.seq
    where e.package = ${name}
    order by e.seq desc limit ${limit}`;
}
