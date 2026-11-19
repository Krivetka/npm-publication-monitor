-- Snapshots of the popular-package list (top by downloads): the watchlist and the targets
-- of the nominal lane. A snapshot records which list stage 1 worked with.
create table popular_package (
  snapshot  date    not null,
  rank      integer not null,
  name      text    not null,
  downloads bigint,
  primary key (snapshot, name)
);

-- Journal processing position of each pipeline stage.
create table stage_cursor (
  stage      text        primary key,
  last_seq   bigint      not null,
  processed  bigint      not null default 0,
  updated_at timestamptz not null
);

-- Stage 1 results — only events where at least one feature fired.
-- The rest are recoverable by replaying the journal: the engine is deterministic.
create table stage1_result (
  seq        bigint      primary key references feed_event (seq),
  package    text        not null,
  event_time timestamptz not null,
  prescore   real        not null,
  candidate  boolean     not null,
  features   jsonb       not null,               -- fired features: value, threshold, weight
  engine     text        not null                -- stage version and parameter hash
);

create index stage1_result_candidate_idx on stage1_result (seq) where candidate;
create index stage1_result_time_idx on stage1_result (event_time);

-- Hourly share of events that passed stage 1 (denominator for the filtering evaluation).
create table stage1_hourly (
  hour       timestamptz primary key,
  processed  integer not null,
  flagged    integer not null,
  candidates integer not null
);
