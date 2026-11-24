-- Stage 2 results: enrichment features, final score and a snapshot of the metadata
-- at enrichment time (the registry later purges malicious versions).
create table stage2_result (
  seq          bigint      primary key references feed_event (seq),
  package      text        not null,
  event_time   timestamptz not null,
  enriched_at  timestamptz not null,
  kind         text        not null,               -- publish | metadata | package_missing | error
  versions     text[]      not null,
  prescore     real        not null,
  final_score  real        not null,
  alert        boolean     not null,
  features     jsonb       not null,
  evidence     jsonb       not null,
  sources      jsonb       not null,               -- what was asked of the sources, what was skipped by quota
  engine       text        not null
);

create index stage2_result_alert_idx on stage2_result (event_time) where alert;
create index stage2_result_package_idx on stage2_result (package);

-- Requests to external sources per hour: denominator for the filtering evaluation.
create table source_usage (
  hour     timestamptz not null,
  source   text        not null,
  requests integer     not null,
  errors   integer     not null,
  skipped  integer     not null,                    -- not asked: quota exhausted
  primary key (hour, source)
);

-- RDAP cache by publisher e-mail domain.
create table rdap_cache (
  domain     text        primary key,
  fetched_at timestamptz not null,
  status     integer     not null,
  registered timestamptz,
  expires    timestamptz
);
