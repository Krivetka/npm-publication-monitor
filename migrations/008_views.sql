-- Views: a relational form of the JSON feature lists and of the array columns, the alert
-- list, masked forms of the tables with personal data, and daily totals for the KPIs.

-- One row per fired feature. The JSON array in the result row is the storage form; this
-- view is the form for queries and joins with the `feature` catalogue. Value and detail are
-- left out: for stage 2 they can hold account names.
create view feature_hit as
select r.seq, 1::smallint as stage, e->>'id' as feature_id, (e->>'weight')::real as weight, r.event_time
from stage1_result r, jsonb_array_elements(r.features) e
union all
select s.seq, 2::smallint, e->>'id', (e->>'weight')::real, s.event_time
from stage2_result s, jsonb_array_elements(s.features) e;

-- The dashboard counts stage-2 results and their features per time range (totals, hourly
-- chart, feature frequencies). Without this index each of these reads the whole table;
-- measured on 78 000 rows: 12 ms as a sequential scan, 0.13 ms as an index-only scan.
create index stage2_result_time_idx on stage2_result (event_time);

-- One row per account added to or removed from the maintainer set of a package.
create view maintainer_change as
select m.package, m.seq, m.observed_at, a.account, 'added'::text as change
from maintainer_set m, unnest(m.added) as a(account)
union all
select m.package, m.seq, m.observed_at, a.account, 'removed'
from maintainer_set m, unnest(m.removed) as a(account);

-- Alerts with the stage-1 score and the current verdict: the analyst's work list.
create view alert as
select s.seq, s.package, s.event_time, s.enriched_at, s.kind, s.versions,
       r.prescore as stage1_score, s.final_score, s.engine,
       (select array_agg(e->>'id' order by e->>'id') from jsonb_array_elements(s.features) e) as stage2_features,
       coalesce(f.verdict, 'open') as verdict, f.reference, f.decided_at
from stage2_result s
join stage1_result r on r.seq = s.seq
left join finding f on f.seq = s.seq
where s.alert;

-- Masked forms for the read-only role and for demonstrations: account names become stable
-- pseudonyms, snapshots are not exposed at all.
create view maintainer_set_masked as
select m.package, m.seq, m.observed_at,
       (select coalesce(array_agg(pseudonym(x) order by o), '{}') from unnest(m.maintainers) with ordinality t(x, o)) as maintainers,
       (select coalesce(array_agg(pseudonym(x) order by o), '{}') from unnest(m.added) with ordinality t(x, o)) as added,
       (select coalesce(array_agg(pseudonym(x) order by o), '{}') from unnest(m.removed) with ordinality t(x, o)) as removed
from maintainer_set m;

create view stage2_result_masked as
select s.seq, s.package, s.event_time, s.enriched_at, s.kind, s.versions, s.prescore, s.final_score, s.alert,
       (select coalesce(jsonb_agg(jsonb_build_object('id', e->'id', 'lane', e->'lane', 'weight', e->'weight') order by o), '[]'::jsonb)
          from jsonb_array_elements(s.features) with ordinality t(e, o)) as features,
       s.sources, s.engine, s.evidence_purged_at
from stage2_result s;

-- Daily totals of the pipeline funnel and of the verdicts: the source of KPI-5 (alerts per
-- day) and of the precision estimate. Reading the journal for the whole period costs seconds,
-- so the result is materialised and refreshed by the maintenance process.
create materialized view daily_stats as
with days as (
  select generate_series(
           (select date_trunc('day', min(observed_at) at time zone 'UTC') from feed_event),
           date_trunc('day', now() at time zone 'UTC'), interval '1 day')::date as day
), ev as (
  select (observed_at at time zone 'UTC')::date as day, count(*) as events, count(distinct package) as packages
  from feed_event group by 1
), s1 as (
  select (event_time at time zone 'UTC')::date as day, count(*) as flagged, count(*) filter (where candidate) as candidates
  from stage1_result group by 1
), s2 as (
  select (s.event_time at time zone 'UTC')::date as day, count(*) as enriched,
         count(*) filter (where s.alert) as alerts,
         count(*) filter (where s.alert and exists (select 1 from popular_package p where p.name = s.package)) as alerts_popular,
         count(*) filter (where f.verdict = 'confirmed') as confirmed,
         count(*) filter (where f.verdict = 'false_positive') as false_positive
  from stage2_result s left join finding f on f.seq = s.seq group by 1
)
select d.day,
       coalesce(ev.events, 0)::integer as events, coalesce(ev.packages, 0)::integer as packages,
       coalesce(s1.flagged, 0)::integer as flagged, coalesce(s1.candidates, 0)::integer as candidates,
       coalesce(s2.enriched, 0)::integer as enriched, coalesce(s2.alerts, 0)::integer as alerts,
       coalesce(s2.alerts_popular, 0)::integer as alerts_popular,
       coalesce(s2.confirmed, 0)::integer as confirmed, coalesce(s2.false_positive, 0)::integer as false_positive
from days d
left join ev on ev.day = d.day
left join s1 on s1.day = d.day
left join s2 on s2.day = d.day;

-- REFRESH ... CONCURRENTLY needs a unique index; readers are not blocked during a refresh.
create unique index daily_stats_day_key on daily_stats (day);

-- Only the owner can refresh a materialised view; the maintenance process is not the owner.
create function refresh_daily_stats() returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  refresh materialized view concurrently daily_stats;
end $$;

-- Data-quality report: every row is an expectation from the data dictionary with the number
-- of rows that break it. All counts are zero on a healthy database.
create view data_quality as
select 'stage1_result.package equals the journal value'::text as expectation,
       (select count(*) from stage1_result r join feed_event e on e.seq = r.seq and e.observed_at = r.event_time
         where r.package <> e.package) as violations
union all
select 'stage2_result.package equals the journal value',
       (select count(*) from stage2_result s join feed_event e on e.seq = s.seq and e.observed_at = s.event_time
         where s.package <> e.package)
union all
select 'maintainer_set.package equals the stage-2 value',
       (select count(*) from maintainer_set m join stage2_result s on s.seq = m.seq where m.package <> s.package)
union all
select 'every candidate older than one day has a stage-2 result',
       (select count(*) from stage1_result r
         where r.candidate and r.event_time < now() - interval '1 day'
           and not exists (select 1 from stage2_result s where s.seq = r.seq))
union all
select 'no e-mail address in a stored snapshot',
       (select count(*) from stage2_result where evidence::text like '%"email": "%')
union all
select 'no snapshot without an alert is older than the retention period plus one day',
       (select count(*) from stage2_result s
         where not s.alert and not (s.sources ? 'repeat_of') and s.evidence_purged_at is null
           and s.evidence <> '{}'::jsonb
           and s.enriched_at < now() - interval '31 days')
union all
select 'no journal row in the default partition',
       (select count(*) from feed_event_default);
