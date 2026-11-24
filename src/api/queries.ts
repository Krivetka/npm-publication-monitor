// SQL behind the REST API and the WebSocket stream. Read-mostly; the only writes are
// analyst findings.

import type { Sql } from '../db.ts';
import type { Feature } from '../lib/feature.ts';
import { type ApiEvent, type ApiFinding, type ApiStage1, type ApiStage2, type EventRow, toEvent, toFinding } from './serialize.ts';
import type { FindingBody } from './validate.ts';

const eventColumns = (sql: Sql) => sql`
  e.seq, e.package, e.rev, e.deleted, e.observed_at, e.observed_after,
  r.prescore as s1_prescore, r.candidate as s1_candidate, r.features as s1_features, r.engine as s1_engine,
  s.kind as s2_kind, s.versions as s2_versions, s.prescore as s2_prescore, s.final_score as s2_final_score,
  s.alert as s2_alert, s.features as s2_features, s.enriched_at as s2_enriched_at, s.engine as s2_engine,
  f.verdict as f_verdict, f.note as f_note, f.reference as f_reference, f.decided_at as f_decided_at`;

export interface EventFilters {
  before?: number;
  after?: number;
  limit: number;
  package?: string;
  flagged?: boolean;
  candidate?: boolean;
  feature?: string;
  alert?: boolean;
  minScore?: number;
}

export interface EventPage {
  items: ApiEvent[];
  next_before: number | null;
}

export async function listEvents(sql: Sql, f: EventFilters): Promise<EventPage> {
  const needS1 = f.flagged === true || f.candidate === true;
  const needS2 = f.alert === true || f.minScore !== undefined;
  const featureJson = f.feature ? sql.json([{ id: f.feature }]) : null;
  const rows = await sql<EventRow[]>`
    select ${eventColumns(sql)}
    from feed_event e
    ${needS1 ? sql`join stage1_result r on r.seq = e.seq` : sql`left join stage1_result r on r.seq = e.seq`}
    ${needS2 ? sql`join stage2_result s on s.seq = e.seq` : sql`left join stage2_result s on s.seq = e.seq`}
    left join finding f on f.seq = e.seq
    where true
      ${f.before !== undefined ? sql`and e.seq < ${f.before}` : sql``}
      ${f.after !== undefined ? sql`and e.seq > ${f.after}` : sql``}
      ${f.package !== undefined ? sql`and e.package = ${f.package}` : sql``}
      ${f.candidate === true ? sql`and r.candidate` : sql``}
      ${featureJson !== null ? sql`and (r.features @> ${featureJson} or s.features @> ${featureJson})` : sql``}
      ${f.alert === true ? sql`and s.alert` : sql``}
      ${f.minScore !== undefined ? sql`and s.final_score >= ${f.minScore}` : sql``}
    order by e.seq ${f.after !== undefined ? sql`asc` : sql`desc`}
    limit ${f.limit + 1}`;
  const more = rows.length > f.limit;
  const items = rows.slice(0, f.limit).map(toEvent);
  return { items, next_before: more && f.after === undefined ? items.at(-1)!.seq : null };
}

export interface DependencyAlerts {
  packages: number;
  days: { day: string; alerts: number }[];
  items: ApiEvent[];
}

// Alerts on the packages of one consumer (US5.7): the list for the period, newest first, and
// the count for every day of it. The time condition lets the planner skip old partitions.
export async function dependencyAlerts(sql: Sql, names: string[], days: number, limit = 500): Promise<DependencyAlerts> {
  const [rows, perDay] = await Promise.all([
    sql<EventRow[]>`
      select ${eventColumns(sql)}
      from stage2_result s
      join feed_event e on e.seq = s.seq and e.observed_at = s.event_time
      left join stage1_result r on r.seq = s.seq
      left join finding f on f.seq = s.seq
      where s.alert
        and s.event_time >= date_trunc('day', now()) - make_interval(days => ${days - 1})
        and s.package = any(${names})
      order by s.seq desc
      limit ${limit}`,
    sql<{ day: string; alerts: number }[]>`
      select to_char(d, 'YYYY-MM-DD') as day, count(s.seq)::int as alerts
      from generate_series(date_trunc('day', now()) - make_interval(days => ${days - 1}), date_trunc('day', now()), interval '1 day') d
      left join stage2_result s on s.alert and s.event_time >= d and s.event_time < d + interval '1 day' and s.package = any(${names})
      group by d
      order by d`,
  ]);
  return { packages: names.length, days: perDay.map((r) => ({ day: r.day, alerts: r.alerts })), items: rows.map(toEvent) };
}

export async function eventBySeq(sql: Sql, seq: number): Promise<ApiEvent | null> {
  const [row] = await sql<EventRow[]>`
    select ${eventColumns(sql)} from feed_event e
    left join stage1_result r on r.seq = e.seq
    left join stage2_result s on s.seq = e.seq
    left join finding f on f.seq = e.seq
    where e.seq = ${seq}`;
  return row ? toEvent(row) : null;
}

export async function eventsBetween(sql: Sql, afterSeq: number, upToSeq: number, limit: number): Promise<ApiEvent[]> {
  const rows = await sql<EventRow[]>`
    select ${eventColumns(sql)} from feed_event e
    left join stage1_result r on r.seq = e.seq
    left join stage2_result s on s.seq = e.seq
    left join finding f on f.seq = e.seq
    where e.seq > ${afterSeq} and e.seq <= ${upToSeq}
    order by e.seq limit ${limit}`;
  return rows.map(toEvent);
}

export async function maxSeq(sql: Sql): Promise<number> {
  const [row] = await sql<{ m: string | null }[]>`select max(seq) as m from feed_event`;
  return row?.m ? Number(row.m) : 0;
}

export interface Stage2Full extends ApiStage2 {
  evidence: Record<string, unknown>;
  sources: Record<string, unknown>;
}

export async function stage2Full(sql: Sql, seq: number): Promise<Stage2Full | null> {
  const [r] = await sql<{ kind: string; versions: string[]; prescore: number; final_score: number; alert: boolean; features: Feature[]; enriched_at: Date; engine: string; evidence: Record<string, unknown>; sources: Record<string, unknown> }[]>`
    select kind, versions, prescore, final_score, alert, features, enriched_at, engine, evidence, sources from stage2_result where seq = ${seq}`;
  return r ? { ...r, enriched_at: r.enriched_at.toISOString() } : null;
}

export async function stage1Summaries(sql: Sql, seqs: number[]): Promise<Map<number, ApiStage1>> {
  const out = new Map<number, ApiStage1>();
  if (seqs.length === 0) return out;
  const rows = await sql<{ seq: string; prescore: number; candidate: boolean; features: Feature[]; engine: string }[]>`
    select seq, prescore, candidate, features, engine from stage1_result where seq in ${sql(seqs)}`;
  for (const r of rows) out.set(Number(r.seq), { prescore: r.prescore, candidate: r.candidate, features: r.features, engine: r.engine });
  return out;
}

export async function stage2Summary(sql: Sql, seq: number): Promise<ApiStage2 | null> {
  const [r] = await sql<{ kind: string; versions: string[]; prescore: number; final_score: number; alert: boolean; features: Feature[]; enriched_at: Date; engine: string }[]>`
    select kind, versions, prescore, final_score, alert, features, enriched_at, engine from stage2_result where seq = ${seq}`;
  return r ? { ...r, enriched_at: r.enriched_at.toISOString() } : null;
}

export async function packageEvents(sql: Sql, name: string, limit: number, excludeSeq?: number): Promise<ApiEvent[]> {
  const rows = await sql<EventRow[]>`
    select ${eventColumns(sql)} from feed_event e
    left join stage1_result r on r.seq = e.seq
    left join stage2_result s on s.seq = e.seq
    left join finding f on f.seq = e.seq
    where e.package = ${name} ${excludeSeq !== undefined ? sql`and e.seq <> ${excludeSeq}` : sql``}
    order by e.seq desc limit ${limit}`;
  return rows.map(toEvent);
}

export interface MaintainerSetRow {
  package: string;
  seq: number;
  observed_at: string;
  maintainers: string[];
  added: string[];
  removed: string[];
}

export async function maintainerHistory(sql: Sql, name: string): Promise<MaintainerSetRow[]> {
  const rows = await sql<{ package: string; seq: string; observed_at: Date; maintainers: string[]; added: string[]; removed: string[] }[]>`
    select package, seq, observed_at, maintainers, added, removed from maintainer_set where package = ${name} order by seq`;
  return rows.map((r) => ({ ...r, seq: Number(r.seq), observed_at: r.observed_at.toISOString() }));
}

export async function eventExists(sql: Sql, seq: number): Promise<boolean> {
  const [row] = await sql<{ ok: boolean }[]>`select true as ok from feed_event where seq = ${seq} limit 1`;
  return row !== undefined;
}

export async function putFinding(sql: Sql, seq: number, body: FindingBody): Promise<ApiFinding> {
  const [row] = await sql<{ verdict: string; note: string | null; reference: string | null; decided_at: Date }[]>`
    insert into finding (seq, observed_at, verdict, note, reference, decided_at)
    select e.seq, e.observed_at, ${body.verdict}, ${body.note}, ${body.reference}, now()
    from feed_event e where e.seq = ${seq}
    on conflict (seq) do update set verdict = excluded.verdict, note = excluded.note, reference = excluded.reference, decided_at = now()
    returning verdict, note, reference, decided_at`;
  return toFinding(seq, row!)!;
}

export async function deleteFinding(sql: Sql, seq: number): Promise<boolean> {
  const res = await sql`delete from finding where seq = ${seq}`;
  return res.count > 0;
}

export async function listFindings(sql: Sql, verdict?: string): Promise<ApiFinding[]> {
  const rows = await sql<{ seq: string; verdict: string; note: string | null; reference: string | null; decided_at: Date }[]>`
    select seq, verdict, note, reference, decided_at from finding
    where true ${verdict ? sql`and verdict = ${verdict}` : sql``}
    order by decided_at desc`;
  return rows.map((r) => toFinding(Number(r.seq), r)!);
}

export interface Totals {
  hours: number;
  events: number;
  processed: number;
  flagged: number;
  candidates: number;
  enriched: number;
  alerts: number;
}

export async function totals(sql: Sql, hours: number): Promise<Totals> {
  const [r] = await sql<{ events: number; processed: number; flagged: number; candidates: number; enriched: number; alerts: number }[]>`
    select
      (select count(*)::int from feed_event where observed_at > now() - make_interval(hours => ${hours})) as events,
      coalesce(sum(processed), 0)::int as processed,
      coalesce(sum(flagged), 0)::int as flagged,
      coalesce(sum(candidates), 0)::int as candidates,
      (select count(*)::int from stage2_result where event_time > now() - make_interval(hours => ${hours})) as enriched,
      (select count(*)::int from stage2_result where alert and event_time > now() - make_interval(hours => ${hours})) as alerts
    from stage1_hourly where hour > now() - make_interval(hours => ${hours})`;
  return { hours, ...r! };
}

export async function featureCounts(sql: Sql, hours: number): Promise<{ stage: number; id: string; count: number }[]> {
  return sql<{ stage: number; id: string; count: number }[]>`
    select stage::int as stage, feature_id as id, count(*)::int as count
    from feature_hit
    where event_time > now() - make_interval(hours => ${hours})
    group by 1, 2 order by 1, 3 desc`;
}

export async function sourceUsage(sql: Sql, hours: number): Promise<{ source: string; requests: number; errors: number; skipped: number }[]> {
  return sql<{ source: string; requests: number; errors: number; skipped: number }[]>`
    select source, sum(requests)::int as requests, sum(errors)::int as errors, sum(skipped)::int as skipped
    from source_usage where hour > now() - make_interval(hours => ${hours}) group by source order by source`;
}
