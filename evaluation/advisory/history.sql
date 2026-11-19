create temp table mal(name text, ghsa text, published timestamptz, range text);
\copy mal from pstdin
create temp table m as select name, min(published) published, string_agg(distinct range, '; ') ranges from mal group by 1;
select e.package, min(split_part(e.rev,'-',1)::int) first_rev, count(*) events, to_char(min(e.observed_at),'MM-DD') first_seen, to_char(m.published,'MM-DD') advisory,
  coalesce((select count(*) from stage1_result r where r.package=e.package and r.candidate),0) cand,
  coalesce((select count(*) from stage2_result s where s.package=e.package and s.alert),0) alerts,
  (select max(final_score) from stage2_result s where s.package=e.package) score,
  (select string_agg(distinct f->>'id', ',') from stage2_result s, jsonb_array_elements(s.features) f where s.package=e.package) s2,
  left(m.ranges, 40) ranges
from feed_event e join m on m.name=e.package group by e.package, m.published, m.ranges
having min(split_part(e.rev,'-',1)::int) >= 25 order by 2 desc limit 30;
