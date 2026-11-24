-- Database roles of npm-monitor. Run once, as a database administrator (a role with
-- CREATEROLE), in the npm_monitor database:
--
--   psql -d npm_monitor -f deploy/db-roles.sql
--   \password npm_monitor_write     -- then set a password for each of the three roles
--   \password npm_monitor_web
--   \password npm_monitor_read
--
-- The script is idempotent. It creates the roles only; what each role may do is defined in
-- migrations/010_roles.sql and is applied by the migration service on every start
-- (function grant_app_privileges). Passwords are stored by the server as SCRAM-SHA-256
-- verifiers (password_encryption = scram-sha-256, the default since PostgreSQL 14); they
-- never appear in this repository. Each process gets its own connection string in .env:
--
--   DATABASE_URL_ADMIN   npm_monitor         owner; the migration service only
--   DATABASE_URL         npm_monitor_write   collector, popular, stage 1, stage 2, maintenance
--   DATABASE_URL_WEB     npm_monitor_web     API and dashboard
--   (reports, demos)     npm_monitor_read    no snapshots, account names masked

do $$
declare
  r text;
begin
  if current_setting('password_encryption') <> 'scram-sha-256' then
    raise exception 'password_encryption must be scram-sha-256, found %', current_setting('password_encryption');
  end if;
  foreach r in array array['npm_monitor_write', 'npm_monitor_web', 'npm_monitor_read'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I login nosuperuser nocreatedb nocreaterole noinherit connection limit 20', r);
    else
      execute format('alter role %I login nosuperuser nocreatedb nocreaterole', r);
    end if;
  end loop;
end $$;

-- Nobody but the listed roles may connect to the database or create objects in the schema.
revoke all on database npm_monitor from public;
grant connect on database npm_monitor to npm_monitor, npm_monitor_write, npm_monitor_web, npm_monitor_read;
revoke create on schema public from public;
grant usage on schema public to npm_monitor_write, npm_monitor_web, npm_monitor_read;

-- A slow report must not hold the pipeline: the read role gets a statement timeout.
alter role npm_monitor_read set statement_timeout = '30s';
alter role npm_monitor_web set statement_timeout = '60s';
