-- Business rules that the database enforces itself: partition management, the shape of the
-- feature lists, the history of verdicts, data minimisation, the exclusion list and retention.
-- Every rule below holds for any client, also for a manual session or an old application build.

-- ── Journal partitions ──────────────────────────────────────────────────────────────────

-- Creates the monthly partitions for the month of p_now and the next month; returns the names
-- of the partitions it created. SECURITY DEFINER: only the owner of the journal can add a
-- partition, and the pipeline role is not the owner.
create function feed_event_ensure_partitions(p_now timestamptz default now())
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m       date := date_trunc('month', p_now at time zone 'UTC')::date;
  created text[] := '{}';
  part    text;
begin
  for i in 0..1 loop
    part := 'feed_event_' || to_char(m, 'YYYYMM');
    if to_regclass(part) is null then
      execute format('create table %I partition of feed_event for values from (%L) to (%L)',
                     part, m::timestamptz, (m + interval '1 month')::date::timestamptz);
      created := created || part;
    end if;
    m := (m + interval '1 month')::date;
  end loop;
  return created;
end $$;

-- ── Feature lists ───────────────────────────────────────────────────────────────────────

-- The fired features are stored as a JSON array (see the data dictionary for the reason).
-- This trigger gives the array the guarantees of a child table: every element is an object
-- with an id and a numeric weight, and the id is a row of `feature` for the same stage.
create function features_check() returns trigger
language plpgsql
as $$
declare
  v_stage smallint := tg_argv[0]::smallint;
  v_bad   text;
begin
  if tg_op = 'UPDATE' and new.features is not distinct from old.features then
    return new;
  end if;
  select coalesce(e->>'id', '(no id)') into v_bad
  from jsonb_array_elements(new.features) e
  where jsonb_typeof(e) <> 'object'
     or jsonb_typeof(e->'id') is distinct from 'string'
     or jsonb_typeof(e->'weight') is distinct from 'number'
     or not exists (select 1 from feature f where f.id = e->>'id' and f.stage = v_stage)
  limit 1;
  if found then
    raise exception 'feature "%" is not a valid stage-% feature (seq %)', v_bad, v_stage, new.seq
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger stage1_result_features_check
  before insert or update of features on stage1_result
  for each row execute function features_check(1);

create trigger stage2_result_features_check
  before insert or update of features on stage2_result
  for each row execute function features_check(2);

-- ── History of verdicts ─────────────────────────────────────────────────────────────────

-- `finding` holds the current verdict of an event. Every change is copied here, so the
-- ground truth of the evaluation can be audited: who changed a verdict and from what.
create table finding_history (
  id         bigint generated always as identity primary key,
  seq        bigint      not null,
  operation  text        not null check (operation in ('insert', 'update', 'delete')),
  verdict    text        check (verdict in ('confirmed', 'false_positive', 'undecided')),
  note       text,
  reference  text,
  changed_at timestamptz not null default now(),
  changed_by text        not null default session_user
);

create index finding_history_seq_idx on finding_history (seq, changed_at);

create function finding_audit() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    insert into finding_history (seq, operation, verdict, note, reference)
    values (old.seq, 'delete', old.verdict, old.note, old.reference);
    return old;
  end if;
  if tg_op = 'UPDATE' and new.verdict = old.verdict
     and new.note is not distinct from old.note and new.reference is not distinct from old.reference then
    return new;
  end if;
  insert into finding_history (seq, operation, verdict, note, reference)
  values (new.seq, lower(tg_op), new.verdict, new.note, new.reference);
  return new;
end $$;

create trigger finding_audit
  after insert or update or delete on finding
  for each row execute function finding_audit();

-- ── Personal data: minimisation and masking ─────────────────────────────────────────────

-- "a***@example.org": keeps the domain, which is the only part the system uses.
create function mask_email(p_email text) returns text
language sql immutable parallel safe
as $$
  select case when p_email ~ '^[^@]+@[^@]+$'
              then left(p_email, 1) || '***@' || split_part(p_email, '@', 2) end;
$$;

-- A stable pseudonym for an account name: the same account gets the same label, the label
-- does not reveal the name. Used by the masked views for demonstrations and for the read role.
create function pseudonym(p_account text) returns text
language sql immutable parallel safe
as $$
  select 'user-' || left(encode(sha256(convert_to(p_account, 'UTF8')), 'hex'), 10);
$$;

-- Removes e-mail addresses from a metadata snapshot and keeps the domain only:
-- {"email": "jane@example.org"} becomes {"emailDomain": "example.org"}.
-- The pattern works on the canonical text form of jsonb (`"key": value`); a quote inside a
-- JSON string is always escaped, so text inside a script or a description cannot match.
create function evidence_minimise(p jsonb) returns jsonb
language sql immutable parallel safe
as $$
  select case when p::text like '%"email": %' then
    regexp_replace(
      regexp_replace(p::text, '"email": "(?:[^"\\]|\\.)*?@((?:[^"\\]|\\.)*)"', '"emailDomain": "\1"', 'g'),
      '"email": (?:"(?:[^"\\]|\\.)*"|null)', '"emailDomain": null', 'g')::jsonb
  else p end;
$$;

-- Accounts that used the right to object (GDPR Article 21): the name is removed from the
-- stored snapshots and is not stored again.
create table exclusion (
  account      text        primary key check (account ~ '^[A-Za-z0-9][A-Za-z0-9._~-]*$'),
  requested_at timestamptz not null default now(),
  note         text
);

-- Replaces every JSON string and object key equal to an excluded account name.
-- An account name that is also a package name (a dependency key) is replaced too:
-- the function errs on the side of privacy.
create function account_redact(p jsonb, p_accounts text[]) returns jsonb
language plpgsql immutable
as $$
declare
  t text := p::text;
  a text;
begin
  foreach a in array p_accounts loop
    t := replace(t, '"' || a || '"', '"[excluded]"');
  end loop;
  return t::jsonb;
end $$;

create function array_redact(p text[], p_accounts text[]) returns text[]
language sql immutable
as $$
  select coalesce(array_agg(case when x = any (p_accounts) then '[excluded]' else x end order by o), '{}')
  from unnest(p) with ordinality as t(x, o);
$$;

-- Every new snapshot: e-mail addresses are reduced to the domain, excluded accounts are removed.
create function stage2_result_privacy() returns trigger
language plpgsql
as $$
declare
  v_accounts text[];
begin
  new.evidence := evidence_minimise(new.evidence);
  select array_agg(account) into v_accounts from exclusion;
  if v_accounts is not null then
    new.evidence := account_redact(new.evidence, v_accounts);
    new.features := account_redact(new.features, v_accounts);
  end if;
  return new;
end $$;

create trigger stage2_result_privacy
  before insert or update of evidence on stage2_result
  for each row execute function stage2_result_privacy();

create function maintainer_set_privacy() returns trigger
language plpgsql
as $$
declare
  v_accounts text[];
begin
  select array_agg(account) into v_accounts from exclusion;
  if v_accounts is not null then
    new.maintainers := array_redact(new.maintainers, v_accounts);
    new.added := array_redact(new.added, v_accounts);
    new.removed := array_redact(new.removed, v_accounts);
  end if;
  return new;
end $$;

create trigger maintainer_set_privacy
  before insert or update on maintainer_set
  for each row execute function maintainer_set_privacy();

-- A new exclusion cleans the rows that are already stored. An event with a confirmed verdict
-- keeps its data: a confirmed incident is a compelling ground under Article 21(1).
create function exclusion_apply() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_accounts text[] := array[new.account];
  v_token    text := '%"' || new.account || '"%';
begin
  update stage2_result s
     set evidence = account_redact(s.evidence, v_accounts),
         features = account_redact(s.features, v_accounts)
   where (s.evidence::text like v_token or s.features::text like v_token)
     and not exists (select 1 from finding f where f.seq = s.seq and f.verdict = 'confirmed');
  update maintainer_set m
     set maintainers = array_redact(m.maintainers, v_accounts),
         added = array_redact(m.added, v_accounts),
         removed = array_redact(m.removed, v_accounts)
   where (new.account = any (m.maintainers) or new.account = any (m.added) or new.account = any (m.removed))
     and not exists (select 1 from finding f where f.seq = m.seq and f.verdict = 'confirmed');
  return new;
end $$;

create trigger exclusion_apply
  after insert on exclusion
  for each row execute function exclusion_apply();

-- ── Retention ───────────────────────────────────────────────────────────────────────────

-- One row per run of the retention job: the proof that the periods are kept.
create table retention_run (
  ran_at                 timestamptz primary key default now(),
  evidence_days          integer     not null,
  delete_all_after       timestamptz,
  snapshots_purged       integer     not null,
  maintainer_rows_purged integer     not null,
  alerts_purged          integer     not null,
  findings_purged        integer     not null
);

-- Applies the retention periods of the privacy notice.
--   1. A snapshot of a candidate without an alert is removed p_evidence_days after enrichment.
--      The result row stays (score and feature ids are needed for the statistics); a repeat of
--      an alert is part of that alert and stays with it.
--   2. Maintainer-set rows of such snapshots are deleted, except the newest row of a package:
--      stage 2 compares the next observation with it.
-- SECURITY DEFINER: the last step deletes verdicts, which the pipeline role may not touch.
--   3. After p_delete_all_after (six months after the defence) the snapshots of alerts, the
--      maintainer history and the verdicts are removed as well.
create function apply_retention(p_evidence_days integer default 30, p_delete_all_after timestamptz default null)
returns retention_run
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r retention_run;
begin
  if p_evidence_days < 1 then
    raise exception 'p_evidence_days must be at least 1' using errcode = 'invalid_parameter_value';
  end if;
  r.ran_at := clock_timestamp();
  r.evidence_days := p_evidence_days;
  r.delete_all_after := p_delete_all_after;
  r.alerts_purged := 0;
  r.findings_purged := 0;

  with purged as (
    update stage2_result s
       set evidence = '{}'::jsonb, evidence_purged_at = now()
     where s.evidence_purged_at is null
       and not s.alert
       and not (s.sources ? 'repeat_of')
       and s.enriched_at < now() - make_interval(days => p_evidence_days)
    returning 1)
  select count(*) into r.snapshots_purged from purged;

  with gone as (
    delete from maintainer_set m
     using stage2_result s
     where s.seq = m.seq
       and s.evidence_purged_at is not null
       and exists (select 1 from maintainer_set n where n.package = m.package and n.seq > m.seq)
    returning 1)
  select count(*) into r.maintainer_rows_purged from gone;

  if p_delete_all_after is not null and now() >= p_delete_all_after then
    with purged as (
      update stage2_result s
         set evidence = '{}'::jsonb, evidence_purged_at = now()
       where s.evidence_purged_at is null
      returning 1)
    select count(*) into r.alerts_purged from purged;
    with gone as (delete from maintainer_set returning 1)
    select r.maintainer_rows_purged + count(*) into r.maintainer_rows_purged from gone;
    with gone as (delete from finding returning 1)
    select count(*) into r.findings_purged from gone;
    delete from finding_history;
  end if;

  insert into retention_run values (r.*);
  return r;
end $$;
