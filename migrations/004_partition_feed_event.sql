-- Partition the journal by month on observed_at: the table grows by ~120k rows a day for the
-- whole observation period, and every query that matters is either a seq-ordered scan near the
-- head, a per-package lookup, or a time range — all of which prune to one or two partitions.
--
-- The primary key of a partitioned table must include the partition key, so it becomes
-- (seq, observed_at). stage1_result.seq and stage2_result.seq used to reference feed_event(seq);
-- a foreign key cannot target a partitioned table on a non-key column, so those constraints
-- are dropped. The stages still write results only for seqs they read from the journal, and
-- the API joins by seq as before.

alter table stage1_result drop constraint if exists stage1_result_seq_fkey;
alter table stage2_result drop constraint if exists stage2_result_seq_fkey;

alter table feed_event rename to feed_event_old;
alter index feed_event_pkey rename to feed_event_old_pkey;
alter index feed_event_observed_at_idx rename to feed_event_old_observed_at_idx;
alter index feed_event_package_idx rename to feed_event_old_package_idx;

create table feed_event (
  seq            bigint      not null,           -- position in the registry changes feed
  package        text        not null,
  rev            text        not null,           -- document revision "<n>-<hash>"
  deleted        boolean     not null default false,
  observed_at    timestamptz not null,           -- received by the collector
  observed_after timestamptz,                    -- lower bound of appearance; null — unknown
  primary key (seq, observed_at)
) partition by range (observed_at);

create index feed_event_package_idx on feed_event (package, seq);
create index feed_event_observed_at_idx on feed_event (observed_at);

-- Safety net for rows outside every monthly partition (clock skew, backfill of old history).
create table feed_event_default partition of feed_event default;

-- One partition per month from the first journal row to the end of next month; the collector
-- keeps creating the current and next month's partitions from here on.
do $$
declare
  m date;
  last_month date;
begin
  select date_trunc('month', coalesce(min(observed_at), now()))::date into m from feed_event_old;
  last_month := (date_trunc('month', now()) + interval '1 month')::date;
  while m <= last_month loop
    execute format(
      'create table if not exists %I partition of feed_event for values from (%L) to (%L)',
      'feed_event_' || to_char(m, 'YYYYMM'), m, (m + interval '1 month')::date
    );
    m := (m + interval '1 month')::date;
  end loop;
end $$;

insert into feed_event (seq, package, rev, deleted, observed_at, observed_after)
select seq, package, rev, deleted, observed_at, observed_after from feed_event_old;

drop table feed_event_old;
