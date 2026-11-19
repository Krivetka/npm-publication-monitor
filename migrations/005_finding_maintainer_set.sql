-- Analyst verdicts: the ground truth for the evaluation (confirmed findings, false positives).
create table finding (
  seq        bigint      primary key,
  verdict    text        not null check (verdict in ('confirmed', 'false_positive', 'undecided')),
  note       text,
  reference  text,                                 -- advisory, issue or write-up confirming the finding
  decided_at timestamptz not null
);

-- History of the maintainer set of a package: one row per observed change, recorded by
-- stage 2 at every enrichment where the set differs from the last recorded one.
create table maintainer_set (
  package     text        not null,
  seq         bigint      not null,
  observed_at timestamptz not null,
  maintainers text[]      not null,
  added       text[]      not null default '{}',
  removed     text[]      not null default '{}',
  primary key (package, seq)
);

-- Containment lookups by feature id (`features @> '[{"id":…}]'`) for the API filters.
create index stage1_result_features_idx on stage1_result using gin (features jsonb_path_ops);
create index stage2_result_features_idx on stage2_result using gin (features jsonb_path_ops);
