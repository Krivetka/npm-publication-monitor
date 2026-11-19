\pset footer off
create temp table mal(name text, ghsa text, published timestamptz, range text);
\copy mal from pstdin
create temp table m as select name, min(published) published, bool_or(range !~ '^>= ?0') specific from mal group by 1;
create index on m(name);

-- every journal event of the full days, with its revision number and stage results
create temp table ev as
select e.seq, e.package, split_part(e.rev, '-', 1)::int as rev, e.deleted, e.observed_at,
       (e.observed_at at time zone 'UTC')::date as day, date_trunc('hour', e.observed_at) as hour,
       coalesce(r.candidate, false) as candidate, r.prescore
from feed_event e left join stage1_result r on r.seq = e.seq
where e.observed_at >= '2026-10-15' and e.observed_at < '2026-11-15';
create index on ev(package);
analyze ev;

\echo == days and events
select count(distinct day) days, count(*) events, round(count(*)::numeric / count(distinct day)) per_day,
       round(count(*) filter (where candidate)::numeric / count(distinct day)) candidates_per_day from ev;

\echo == extra stage-2 load by rule "revision >= K and not a candidate today" (events per day, peak hour)
select k,
       round(count(*)::numeric / (select count(distinct day) from ev)) extra_per_day,
       round(count(distinct (package, day))::numeric / (select count(distinct day) from ev)) distinct_pkg_per_day,
       (select max(n) from (select count(*) n from ev e2 where not e2.candidate and not e2.deleted and e2.rev >= k group by hour) h) peak_hour
from ev, (values (2), (5), (10), (25), (50), (100)) v(k)
where not candidate and not deleted and rev >= k group by k order by k;

\echo == the same, first event of a package after a quiet period (no event of the package in the previous N hours)
create temp table gaps as
select *, observed_at - lag(observed_at) over (partition by package order by seq) as since_prev from ev;
select k, quiet_h,
       round(count(*)::numeric / (select count(distinct day) from ev)) extra_per_day,
       (select max(n) from (select count(*) n from gaps g2 where not g2.candidate and not g2.deleted and g2.rev >= k
          and (g2.since_prev is null or g2.since_prev >= make_interval(hours => quiet_h)) group by hour) h) peak_hour
from gaps, (values (10), (25), (50)) v(k), (values (1), (6), (24)) q(quiet_h)
where not candidate and not deleted and rev >= k and (since_prev is null or since_prev >= make_interval(hours => quiet_h))
group by k, quiet_h order by k, quiet_h;

\echo == malicious packages with history (specific versions named): how many would reach stage 2 under each rule
create temp table malev as select g.*, m.published from gaps g join m on m.name = g.package where m.specific;
select k, count(distinct package) pkgs_rev_ge_k,
       count(distinct package) filter (where candidate) already_candidate,
       count(distinct package) filter (where since_prev is null or since_prev >= interval '6 hours') reached_by_quiet6h_rule
from malev, (values (2), (10), (25), (50)) v(k) where rev >= k group by k order by k;

\echo == what stage 2 gives on events with history today (candidates with revision >= 25): kinds and stage-2 evidence
select s.kind, count(*) n,
       count(*) filter (where s.final_score - s.prescore >= 4) stage2_alone_ge_4,
       count(*) filter (where s.final_score - s.prescore >= 2) stage2_alone_ge_2,
       count(*) filter (where s.alert) alerts
from stage2_result s join ev on ev.seq = s.seq where ev.rev >= 25 group by 1 order by 2 desc;

\echo == requests per enriched event and per day by source (full days)
select u.source, round(sum(u.requests)::numeric / 31) req_per_day, max(u.requests) peak_hour,
       round(sum(u.requests)::numeric / (select count(*) from stage2_result s where s.enriched_at >= '2026-10-15' and s.enriched_at < '2026-11-15'), 2) per_event,
       sum(u.skipped) skipped
from source_usage u where u.hour >= '2026-10-15' and u.hour < '2026-11-15' group by 1 order by 1;

\echo == watchlist alternative: events of the top-10 000 packages
select round(count(*)::numeric / (select count(distinct day) from ev)) events_per_day,
       round(count(*) filter (where not candidate)::numeric / (select count(distinct day) from ev)) not_candidate_per_day
from ev where exists (select 1 from popular_package p where p.name = ev.package);
