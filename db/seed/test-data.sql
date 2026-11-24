-- Test data: a small journal that covers every state of an event and the edge cases of the
-- schema. Load it into an empty, migrated database:
--
--   npm run migrate && npm run db:seed
--
-- The loader runs the file as one transaction: either all rows are stored or none.
--
-- The reference tables (`source`, `feature`) are filled by the migrations and by
-- `npm run db:reference`; this script adds transactional rows only. All times are relative
-- to now() (cut to milliseconds, the resolution of the journal), so the retention rules
-- can be shown at any date.
--
-- seq    package            state
-- 1001   left-pad           plain event, no feature fired
-- 1002   left-pad           history loaded without a lower time bound (observed_after is null)
-- 1003   gone-pkg           the package document was deleted
-- 1004   busy-lib           stage 1 fired a feature, not a candidate
-- 1005   queued-lib         candidate that waits for stage 2
-- 1006   calm-lib           candidate, enriched, no alert, snapshot with an e-mail address
-- 1007   old-lib            candidate without an alert, 40 days old: the retention job removes the snapshot
-- 1008   old-lib            newer event of the same package, maintainer set changed
-- 1009   evil-lib           alert, 40 days old, verdict "confirmed": kept by retention
-- 1010   noisy-lib          alert, verdict "false_positive"
-- 1011   noisy-lib          repeat of alert 1010, 40 days old: kept with its alert
-- 1012   vanished-lib       the registry no longer has the package (kind package_missing)
-- 1013   broken-lib         enrichment failed (kind error, empty snapshot)
-- 1014   @acme/widgets      scoped package, alert without a verdict
-- 1015   left-pad           event on the watchlist, candidate by watchlist alone


-- Partitions for the old rows (40 days back) and for the current month.
select feed_event_ensure_partitions(date_trunc('milliseconds', now()) - interval '45 days');
select feed_event_ensure_partitions(date_trunc('milliseconds', now()));

insert into feed_event (seq, package, rev, deleted, observed_at, observed_after) values
  (1001, 'left-pad',      '12-a1b2c3', false, date_trunc('milliseconds', now()) - interval '3 hours',              date_trunc('milliseconds', now()) - interval '3 hours 5 seconds'),
  (1002, 'left-pad',      '11-0f0f0f', false, date_trunc('milliseconds', now()) - interval '50 hours',             null),
  (1003, 'gone-pkg',      '4-deadbe',  true,  date_trunc('milliseconds', now()) - interval '2 hours',              date_trunc('milliseconds', now()) - interval '2 hours 5 seconds'),
  (1004, 'busy-lib',      '310-ab12',  false, date_trunc('milliseconds', now()) - interval '100 minutes',          date_trunc('milliseconds', now()) - interval '100 minutes 5 seconds'),
  (1005, 'queued-lib',    '2-77aa',    false, date_trunc('milliseconds', now()) - interval '1 minute',             date_trunc('milliseconds', now()) - interval '65 seconds'),
  (1006, 'calm-lib',      '9-c0ffee',  false, date_trunc('milliseconds', now()) - interval '90 minutes',           date_trunc('milliseconds', now()) - interval '90 minutes 5 seconds'),
  (1007, 'old-lib',       '5-aaaa',    false, date_trunc('milliseconds', now()) - interval '40 days',              date_trunc('milliseconds', now()) - interval '40 days 5 seconds'),
  (1008, 'old-lib',       '6-bbbb',    false, date_trunc('milliseconds', now()) - interval '80 minutes',           date_trunc('milliseconds', now()) - interval '80 minutes 5 seconds'),
  (1009, 'evil-lib',      '21-eeee',   false, date_trunc('milliseconds', now()) - interval '40 days' + interval '1 hour', date_trunc('milliseconds', now()) - interval '40 days' + interval '59 minutes'),
  (1010, 'noisy-lib',     '40-1111',   false, date_trunc('milliseconds', now()) - interval '40 days' + interval '2 hours', date_trunc('milliseconds', now()) - interval '40 days' + interval '119 minutes'),
  (1011, 'noisy-lib',     '41-2222',   false, date_trunc('milliseconds', now()) - interval '40 days' + interval '3 hours', date_trunc('milliseconds', now()) - interval '40 days' + interval '179 minutes'),
  (1012, 'vanished-lib',  '3-3333',    false, date_trunc('milliseconds', now()) - interval '70 minutes',           date_trunc('milliseconds', now()) - interval '70 minutes 5 seconds'),
  (1013, 'broken-lib',    '8-4444',    false, date_trunc('milliseconds', now()) - interval '60 minutes',           date_trunc('milliseconds', now()) - interval '60 minutes 5 seconds'),
  (1014, '@acme/widgets', '15-5555',   false, date_trunc('milliseconds', now()) - interval '50 minutes',           date_trunc('milliseconds', now()) - interval '50 minutes 5 seconds'),
  (1015, 'left-pad',      '13-6666',   false, date_trunc('milliseconds', now()) - interval '40 minutes',           date_trunc('milliseconds', now()) - interval '40 minutes 5 seconds');

insert into collector_state (feed, last_seq, window_start, head_seq, polled_at, advanced_at)
values ('npm', 1015, date_trunc('milliseconds', now()), 1015, date_trunc('milliseconds', now()), date_trunc('milliseconds', now()) - interval '40 minutes');

insert into popular_package (snapshot, rank, name, downloads) values
  (current_date, 1, 'left-pad', 5000000),
  (current_date, 2, 'noisy-lib', null);

-- Stage 1: only events with a fired feature get a row.
insert into stage1_result (seq, package, event_time, prescore, candidate, features, engine)
select e.seq, e.package, e.observed_at, v.prescore, v.candidate, v.features::jsonb, 'v3:a566433d@' || current_date
from (values
  (1004, 1.0, false, '[{"id":"rate_package","lane":"temporal","weight":1,"value":14,"threshold":10}]'),
  (1005, 2.0, true,  '[{"id":"new_package","lane":"version","weight":2,"value":true}]'),
  (1006, 2.0, true,  '[{"id":"dormant_awake","lane":"version","weight":2,"value":420}]'),
  (1007, 2.0, true,  '[{"id":"dormant_awake","lane":"version","weight":2,"value":900}]'),
  (1008, 2.0, true,  '[{"id":"rev_jump","lane":"version","weight":2,"value":3}]'),
  (1009, 4.0, true,  '[{"id":"breadth_mature","lane":"temporal","weight":2,"value":31},{"id":"dormant_awake","lane":"version","weight":2,"value":600}]'),
  (1010, 2.0, true,  '[{"id":"rate_package","lane":"temporal","weight":2,"value":40,"threshold":10}]'),
  (1011, 2.0, true,  '[{"id":"rate_package","lane":"temporal","weight":2,"value":41,"threshold":10}]'),
  (1012, 2.0, true,  '[{"id":"new_package","lane":"version","weight":2,"value":true}]'),
  (1013, 2.0, true,  '[{"id":"new_package","lane":"version","weight":2,"value":true}]'),
  (1014, 3.5, true,  '[{"id":"name_scope_typo","lane":"nominal","weight":2,"value":"@acme/widgets"},{"id":"name_edit","lane":"nominal","weight":1.5,"value":"widgets"}]'),
  (1015, 0.0, true,  '[{"id":"watchlist","lane":"watchlist","weight":0,"value":1}]')
) as v(seq, prescore, candidate, features)
join feed_event e on e.seq = v.seq;

insert into stage1_hourly (hour, processed, flagged, candidates) values
  (date_trunc('hour', date_trunc('milliseconds', now()) - interval '1 hour'), 5200, 31, 4),
  (date_trunc('hour', date_trunc('milliseconds', now())), 1800, 9, 2);

insert into stage_cursor (stage, last_seq, processed, updated_at) values ('stage1', 1015, 15, date_trunc('milliseconds', now()));

-- Stage 2. The snapshots contain e-mail addresses on purpose: the trigger
-- stage2_result_privacy must reduce them to the domain.
insert into stage2_result (seq, package, event_time, enriched_at, kind, versions, prescore, final_score, alert, features, evidence, sources, engine)
select e.seq, e.package, e.observed_at, e.observed_at + interval '2 minutes', v.kind, v.versions::text[], v.prescore, v.final_score, v.alert,
       v.features::jsonb, v.evidence::jsonb, v.sources::jsonb, 'v5:ed7f77fa'
from (values
  (1006, 'publish', '{2.4.1}', 2.0, 2.0, false, '[]',
   '{"registry":{"kind":"publish","maintainers":["carol"],"versions":[{"version":"2.4.1","publisher":{"name":"carol","email":"carol@calm.example","trusted":null},"maintainers":["carol"]}],"previous":{"version":"2.4.0","publisher":{"name":"carol","email":"carol@calm.example","trusted":null}}}}',
   '{"registry":{"status":200}}'),
  (1007, 'publish', '{1.0.5}', 2.0, 2.5, false, '[{"id":"publisher_recent","lane":"publisher","weight":0.5,"value":"dave"}]',
   '{"registry":{"kind":"publish","maintainers":["dave","erin"],"versions":[{"version":"1.0.5","publisher":{"name":"dave","email":"dave@old.example","trusted":null},"maintainers":["dave","erin"]}]}}',
   '{"registry":{"status":200}}'),
  (1008, 'metadata', '{}', 2.0, 3.0, false, '[{"id":"maintainers_added","lane":"maintainers","weight":1,"value":["frank"],"detail":{"since":"1.0.5"}}]',
   '{"registry":{"kind":"metadata","maintainers":["dave","frank"],"distTags":{"latest":"1.0.5"}}}',
   '{"registry":{"status":200}}'),
  (1009, 'publish', '{9.9.9,9.9.10}', 4.0, 9.5, true,
   '[{"id":"publisher_new","lane":"publisher","weight":3,"value":"mallory"},{"id":"install_script_added","lane":"manifest","weight":2.5,"value":["postinstall"]}]',
   '{"registry":{"kind":"publish","maintainers":["alice","mallory"],"versions":[{"version":"9.9.9","publisher":{"name":"mallory","email":"mallory@fresh-domain.example","trusted":null},"maintainers":["alice","mallory"],"scripts":{"postinstall":"node setup.js"}}],"previous":{"version":"9.9.8","publisher":{"name":"alice","email":null,"trusted":null}},"history":{"versions":40,"publishers":{"alice":{"count":40}}}},"rdap":{"domain":"fresh-domain.example","status":200}}',
   '{"registry":{"status":200},"rdap":{"status":200}}'),
  (1010, 'publish', '{3.0.0}', 2.0, 5.0, true, '[{"id":"publisher_new","lane":"publisher","weight":3,"value":"bob"}]',
   '{"registry":{"kind":"publish","maintainers":["bob"],"versions":[{"version":"3.0.0","publisher":{"name":"bob","email":"bob@noisy.example","trusted":null},"maintainers":["bob"]}]}}',
   '{"registry":{"status":200}}'),
  (1011, 'publish', '{3.0.1}', 2.0, 5.0, false, '[{"id":"publisher_new","lane":"publisher","weight":3,"value":"bob"}]',
   '{"registry":{"kind":"publish","maintainers":["bob"],"versions":[{"version":"3.0.1","publisher":{"name":"bob","email":"bob@noisy.example","trusted":null},"maintainers":["bob"]}]}}',
   '{"registry":{"status":200},"repeat_of":1010}'),
  (1012, 'package_missing', '{}', 2.0, 2.0, false, '[{"id":"package_missing","lane":"registry","weight":0,"value":true}]',
   '{"registry":{"packument":null}}',
   '{"registry":{"status":404}}'),
  (1013, 'error', '{}', 2.0, 2.0, false, '[]', '{}', '{"registry":{"skipped":"error","attempts":5}}'),
  (1014, 'publish', '{0.1.0}', 3.5, 6.0, true, '[{"id":"install_script_new_package","lane":"manifest","weight":2.5,"value":["preinstall"],"detail":{"versions":["0.1.0"]}}]',
   '{"registry":{"kind":"publish","maintainers":["trent"],"versions":[{"version":"0.1.0","publisher":{"name":"trent","email":"gmail.com","trusted":null},"maintainers":["trent"],"scripts":{"preinstall":"echo \"email\": \"not-a-field@example.org\""}}]}}',
   '{"registry":{"status":200},"depsdev":{"status":404}}'),
  (1015, 'publish', '{1.3.1}', 0.0, 0.0, false, '[]',
   '{"registry":{"kind":"publish","maintainers":["azer"],"versions":[{"version":"1.3.1","publisher":{"name":"GitHub Actions","email":"github.com","trusted":{"id":"github","config":"azer/left-pad"}},"maintainers":["azer"]}]}}',
   '{"registry":{"status":200}}')
) as v(seq, kind, versions, prescore, final_score, alert, features, evidence, sources)
join feed_event e on e.seq = v.seq;

insert into source_usage (hour, source, requests, errors, skipped) values
  (date_trunc('hour', date_trunc('milliseconds', now())), 'registry', 12, 1, 0),
  (date_trunc('hour', date_trunc('milliseconds', now())), 'rdap', 1, 0, 0),
  (date_trunc('hour', date_trunc('milliseconds', now())), 'github', 0, 0, 3);

insert into rdap_cache (domain, fetched_at, status, registered, expires) values
  ('fresh-domain.example', date_trunc('milliseconds', now()) - interval '40 days', 200, date_trunc('milliseconds', now()) - interval '50 days', date_trunc('milliseconds', now()) + interval '300 days'),
  ('unknown.example', date_trunc('milliseconds', now()), 404, null, null);

-- Maintainer-set history: first observation, then a change.
insert into maintainer_set (package, seq, observed_at, maintainers, added, removed)
select e.package, e.seq, e.observed_at, v.maintainers::text[], v.added::text[], v.removed::text[]
from (values
  (1007, '{dave,erin}',     '{dave,erin}', '{}'),
  (1008, '{dave,frank}',    '{frank}',     '{erin}'),
  (1009, '{alice,mallory}', '{mallory}',   '{}'),
  (1010, '{bob}',           '{bob}',       '{}')
) as v(seq, maintainers, added, removed)
join feed_event e on e.seq = v.seq;

-- Verdicts; every row also lands in finding_history through the audit trigger.
insert into finding (seq, observed_at, verdict, note, reference, decided_at)
select e.seq, e.observed_at, v.verdict, v.note, v.reference, date_trunc('milliseconds', now())
from (values
  (1009, 'confirmed',      'new publisher added a postinstall script', 'https://example.org/advisories/evil-lib'),
  (1010, 'false_positive', 'the project moved to a new release account', null)
) as v(seq, verdict, note, reference)
join feed_event e on e.seq = v.seq;


select refresh_daily_stats();
