-- Journal of registry changes-feed events: the pipeline's work queue
-- and the benign background for the experimental evaluation.
--
-- An event carries no time of its own. The moment it appeared in the feed is known
-- to within the interval (observed_after, observed_at]: between the previous poll after
-- which the feed was fully drained, and the receipt of this page.
-- During live polling the interval equals the poll period; after collector downtime or
-- while catching up it stretches over the whole outage — the temporal lane must not
-- mistake such events for a burst.
create table feed_event (
  seq            bigint      primary key,        -- position in the registry changes feed
  package        text        not null,
  rev            text        not null,           -- document revision "<n>-<hash>"
  deleted        boolean     not null default false,
  observed_at    timestamptz not null,           -- received by the collector
  observed_after timestamptz                     -- lower bound of appearance; null — unknown
                                                 -- (history backfilled from FEED_START_SEQ)
);

create index feed_event_observed_at_idx on feed_event (observed_at);
create index feed_event_package_idx on feed_event (package, seq);

-- Collector read position; changes in the same transaction as the event write.
create table collector_state (
  feed         text        primary key,
  last_seq     bigint      not null,
  window_start timestamptz,                      -- observed_after for the next page
  head_seq     bigint,                           -- feed head at the last check
  polled_at    timestamptz not null,             -- last successful poll (heartbeat)
  advanced_at  timestamptz not null              -- last cursor advance
);
