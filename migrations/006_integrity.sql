-- Referential integrity, reference tables and value constraints.
--
-- Migration 004 partitioned the journal and had to drop the foreign keys of the result tables:
-- a foreign key must target the whole primary key, and that key now includes the partition
-- column. The result tables already carry the event time, so the keys come back as composite
-- keys (seq, event_time) -> feed_event (seq, observed_at). The same key proves that the copy of
-- the event time in a result row equals the journal value.

-- ── Reference tables ────────────────────────────────────────────────────────────────────

-- External data sources of stage 2. Fixed data: one row per client in src/stage2/sources.ts.
create table source (
  id       text primary key,
  title    text not null,
  base_url text not null check (base_url like 'https://%')
);

insert into source (id, title, base_url) values
  ('registry',   'npm registry (packument)',        'https://registry.npmjs.org'),
  ('ecosystems', 'ecosyste.ms packages API',        'https://packages.ecosyste.ms'),
  ('depsdev',    'deps.dev API',                    'https://api.deps.dev'),
  ('github',     'GitHub REST API',                 'https://api.github.com'),
  ('rdap',       'RDAP domain registration lookup', 'https://rdap.org');

-- Catalogue of the features that the two engines can emit. The rows are written from the code
-- catalogue (src/db/reference.ts) after every migration run, so the table follows the engine.
-- A feature that the engine no longer emits stays in the table with active = false, because
-- stored results still refer to it.
create table feature (
  id         text        primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  stage      smallint    not null check (stage in (1, 2)),
  lane       text        not null check (lane <> ''),
  weight     real        not null,
  title      text        not null,
  hint       text        not null default '',
  active     boolean     not null default true,
  updated_at timestamptz not null default now()
);

-- Features found in stored results, so that the checks below hold before the first sync.
insert into feature (id, stage, lane, weight, title)
select distinct f->>'id', 1, coalesce(f->>'lane', 'unknown'), 0, f->>'id'
from stage1_result, jsonb_array_elements(features) f
on conflict (id) do nothing;

insert into feature (id, stage, lane, weight, title)
select distinct f->>'id', 2, coalesce(f->>'lane', 'unknown'), 0, f->>'id'
from stage2_result, jsonb_array_elements(features) f
on conflict (id) do nothing;

-- ── Journal ─────────────────────────────────────────────────────────────────────────────

alter table feed_event
  add constraint feed_event_package_check check (package <> ''),
  add constraint feed_event_rev_check check (rev ~ '^[0-9]+-'),
  add constraint feed_event_seq_check check (seq > 0),
  add constraint feed_event_interval_check check (observed_after is null or observed_after <= observed_at),
  -- The collector clock has millisecond resolution. The result tables copy this time as part
  -- of their foreign key and the application reads it with millisecond precision, so a finer
  -- value could never be matched again.
  add constraint feed_event_precision_check check (observed_at = date_trunc('milliseconds', observed_at));

alter table collector_state
  add constraint collector_state_seq_check check (last_seq >= 0 and (head_seq is null or head_seq >= 0));

alter table stage_cursor
  add constraint stage_cursor_check check (last_seq >= 0 and processed >= 0);

-- ── Stage 1 ─────────────────────────────────────────────────────────────────────────────

alter table stage1_result
  add constraint stage1_result_seq_time_key unique (seq, event_time),
  add constraint stage1_result_event_fkey
    foreign key (seq, event_time) references feed_event (seq, observed_at),
  add constraint stage1_result_prescore_check check (prescore >= 0),
  add constraint stage1_result_features_check
    check (jsonb_typeof(features) = 'array' and jsonb_array_length(features) > 0),
  -- engine version, hash of the parameters, date of the popular-package snapshot in use
  add constraint stage1_result_engine_check check (engine ~ '^v[0-9]+:[0-9a-f]+@([0-9]{4}-[0-9]{2}-[0-9]{2}|none)$');

alter table stage1_hourly
  add constraint stage1_hourly_check
    check (processed >= 0 and flagged >= 0 and candidates >= 0 and flagged <= processed and candidates <= flagged),
  add constraint stage1_hourly_hour_check check (hour = date_trunc('hour', hour at time zone 'UTC') at time zone 'UTC');

-- ── Stage 2 ─────────────────────────────────────────────────────────────────────────────

-- A stage-2 result exists only for a stage-1 candidate: one-to-one, optional on the stage-2 side.
alter table stage2_result
  add constraint stage2_result_stage1_fkey
    foreign key (seq, event_time) references stage1_result (seq, event_time),
  add constraint stage2_result_kind_check check (kind in ('publish', 'metadata', 'package_missing', 'error')),
  add constraint stage2_result_score_check check (prescore >= 0 and final_score >= 0),
  add constraint stage2_result_json_check
    check (jsonb_typeof(features) = 'array' and jsonb_typeof(evidence) = 'object' and jsonb_typeof(sources) = 'object'),
  add constraint stage2_result_engine_check check (engine ~ '^v[0-9]+:[0-9a-f]+$'),
  -- when the snapshot was removed by the retention job; null — the snapshot is present
  add column evidence_purged_at timestamptz;

alter table source_usage
  add constraint source_usage_source_fkey foreign key (source) references source (id),
  add constraint source_usage_check check (requests >= 0 and errors >= 0 and skipped >= 0);

alter table rdap_cache
  add constraint rdap_cache_domain_check check (domain = lower(domain) and domain like '%.%'),
  add constraint rdap_cache_status_check check (status between 0 and 599);

-- ── Maintainer history and verdicts ─────────────────────────────────────────────────────

-- A maintainer-set row is recorded from one stage-2 snapshot and goes away with it.
alter table maintainer_set
  add constraint maintainer_set_stage2_fkey
    foreign key (seq) references stage2_result (seq) on delete cascade,
  add constraint maintainer_set_package_check check (package <> '');

-- A verdict can be given to any journal event, also to one that the pipeline missed
-- (a false negative), so it refers to the journal and not to a stage result.
alter table finding add column observed_at timestamptz;
update finding f set observed_at = e.observed_at from feed_event e where e.seq = f.seq;
delete from finding where observed_at is null;
alter table finding
  alter column observed_at set not null,
  add constraint finding_event_fkey
    foreign key (seq, observed_at) references feed_event (seq, observed_at),
  add constraint finding_reference_check check (reference is null or reference <> '');

-- ── Popular packages ────────────────────────────────────────────────────────────────────

alter table popular_package
  add constraint popular_package_rank_key unique (snapshot, rank),
  add constraint popular_package_check check (rank > 0 and name <> '' and (downloads is null or downloads >= 0));
