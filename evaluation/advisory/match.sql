create temp table mal(name text, ghsa text, published timestamptz, range text);
\copy mal from pstdin
create temp table m as select name, min(published) published from mal group by 1;
create index on m(name);
analyze m;
create temp table ev as select e.package name, count(*) events, min(e.observed_at) first_seen, max(e.observed_at) last_seen, bool_or(e.deleted) deleted
  from feed_event e join m on m.name = e.package group by 1;
create temp table s1 as select r.package name, count(*) flagged, count(*) filter (where r.candidate) candidates, max(r.prescore) max_pre
  from stage1_result r join m on m.name = r.package group by 1;
create temp table s2 as select s.package name, count(*) enriched, count(*) filter (where s.alert) alerts, min(s.event_time) filter (where s.alert) first_alert,
  max(s.final_score) max_score, bool_or(s.kind = 'package_missing') missing, min(s.event_time) first_enriched
  from stage2_result s join m on m.name = s.package group by 1;
create temp table agg as select m.name, m.published, coalesce(ev.events,0) events, ev.first_seen, ev.last_seen, coalesce(ev.deleted,false) deleted,
  coalesce(s1.flagged,0) flagged, coalesce(s1.candidates,0) candidates, s1.max_pre,
  coalesce(s2.enriched,0) enriched, coalesce(s2.alerts,0) alerts, s2.first_alert, s2.max_score, coalesce(s2.missing,false) missing, s2.first_enriched,
  exists(select 1 from popular_package p where p.name = m.name) popular
  from m left join ev using(name) left join s1 using(name) left join s2 using(name);
\echo == funnel
select count(*) advisory_pkgs, count(*) filter (where events>0) in_journal, count(*) filter (where flagged>0) flagged, count(*) filter (where candidates>0) candidate,
  count(*) filter (where enriched>0) enriched, count(*) filter (where alerts>0) alerted, count(*) filter (where popular) popular from agg;
\echo == packages first seen inside the journal window (published after the journal started)
select count(*) n, count(*) filter (where candidates>0) candidate, count(*) filter (where alerts>0) alerted,
  count(*) filter (where missing) seen_missing from agg where events>0;
\echo == lead of the first alert over the advisory, hours
select count(*) n, round(percentile_cont(0.5) within group (order by extract(epoch from published-first_alert)/3600)) median_h,
  round(min(extract(epoch from published-first_alert)/3600)) min_h, round(max(extract(epoch from published-first_alert)/3600)) max_h
  from agg where alerts>0;
\echo == delay first event -> first alert, minutes
select round(percentile_cont(0.5) within group (order by extract(epoch from first_alert-first_seen)/60)) median_min from agg where alerts>0;
\echo == max final score of enriched advisory packages
select floor(max_score)::int score, count(*) from agg where enriched>0 group by 1 order by 1;
\echo == popular packages with a malware advisory
select name, events, flagged, candidates, enriched, alerts, max_score, first_seen::date, published::date from agg where popular order by events desc limit 20;
\echo == alerted packages
select name, events, alerts, max_score, to_char(first_alert,'MM-DD HH24:MI') first_alert, to_char(published,'MM-DD HH24:MI') advisory from agg where alerts>0 order by first_alert limit 40;
\echo == why not: in journal but no alert
select case when candidates=0 and flagged=0 then 'stage 1: no feature fired'
            when candidates=0 then 'stage 1: flagged, below candidate threshold'
            when enriched=0 then 'candidate, not enriched'
            when missing and max_score < 4 then 'stage 2: package already removed'
            else 'stage 2: score below alert threshold' end reason, count(*)
  from agg where events>0 and alerts=0 group by 1 order by 2 desc;
\echo == stage-1 features on advisory packages
select f->>'id' feature, count(distinct r.package) pkgs from stage1_result r join m on m.name=r.package, jsonb_array_elements(r.features) f group by 1 order by 2 desc limit 12;
\echo == stage-2 features on advisory packages without alert
select f->>'id' feature, count(distinct s.package) pkgs from stage2_result s join agg a on a.name=s.package, jsonb_array_elements(s.features) f where a.alerts=0 group by 1 order by 2 desc limit 12;
\echo == events per advisory package
select case when events=1 then '1' when events<=3 then '2-3' when events<=10 then '4-10' else '>10' end events, count(*) from agg where events>0 group by 1 order by 1;
