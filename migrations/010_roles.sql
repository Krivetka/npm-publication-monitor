-- Access rights. The roles are created once by a database administrator
-- (deploy/db-roles.sql); this migration defines what each role may do. The grants live in a
-- function that the migration runner calls after every run, so a table added by a later
-- migration gets its rights without a manual step.
--
--   npm_monitor        owner of all objects; runs migrations; no application process uses it
--   npm_monitor_write  the pipeline: collector, popular, stage 1, stage 2, maintenance
--   npm_monitor_web    the API and the dashboard: reads everything, writes verdicts only
--   npm_monitor_read   reports and demonstrations: no snapshots, account names masked

create function grant_app_privileges() returns text[]
language plpgsql
as $$
declare
  granted text[] := '{}';
begin
  if exists (select 1 from pg_roles where rolname = 'npm_monitor_write') then
    revoke all on all tables in schema public from npm_monitor_write;
    grant select on all tables in schema public to npm_monitor_write;
    revoke select on finding_history from npm_monitor_write;
    grant insert, update, delete on
      feed_event, collector_state, popular_package, stage_cursor, stage1_result, stage1_hourly,
      stage2_result, source_usage, rdap_cache, maintainer_set, retention_run
      to npm_monitor_write;
    grant execute on function feed_event_ensure_partitions(timestamptz), refresh_daily_stats(),
      apply_retention(integer, timestamptz) to npm_monitor_write;
    granted := granted || 'npm_monitor_write'::text;
  end if;

  if exists (select 1 from pg_roles where rolname = 'npm_monitor_web') then
    revoke all on all tables in schema public from npm_monitor_web;
    grant select on all tables in schema public to npm_monitor_web;
    grant insert, update, delete on finding to npm_monitor_web;
    granted := granted || 'npm_monitor_web'::text;
  end if;

  if exists (select 1 from pg_roles where rolname = 'npm_monitor_read') then
    revoke all on all tables in schema public from npm_monitor_read;
    grant select on
      feed_event, collector_state, stage_cursor, popular_package, source, feature,
      stage1_result, stage1_hourly, source_usage, finding, retention_run,
      feature_hit, alert, stage2_result_masked, maintainer_set_masked, daily_stats, data_quality
      to npm_monitor_read;
    granted := granted || 'npm_monitor_read'::text;
  end if;

  return granted;
end $$;

-- Functions are executable by PUBLIC by default; keep only what each role needs.
revoke execute on function feed_event_ensure_partitions(timestamptz) from public;
revoke execute on function refresh_daily_stats() from public;
revoke execute on function apply_retention(integer, timestamptz) from public;
revoke execute on function grant_app_privileges() from public;

select grant_app_privileges();
