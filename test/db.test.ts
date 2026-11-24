// Integration tests of the database: migrations, constraints, triggers, functions, views,
// retention, privacy rules and access rights. They need a PostgreSQL 18 server:
//
//   docker compose -f compose.dev.yml up -d
//   TEST_DATABASE_URL=postgres://npm_monitor:dev@127.0.0.1:55432/npm_monitor npm test
//
// The URL must belong to a role that can create databases and roles. The tests create their
// own database (npm_monitor_it) and never touch the one in the URL. Without the variable the
// suite is skipped.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { putFinding } from '../src/api/queries.ts';
import { ensurePartitions, loadCursor, persistPage } from '../src/collector/store.ts';
import { connect, type Sql } from '../src/db.ts';
import { runMigrations } from '../src/db/migrate.ts';
import { syncReference } from '../src/db/reference.ts';
import { loadSeed } from '../src/db/seed.ts';
import { runMaintenance } from '../src/maintenance/run.ts';
import { persistBatch } from '../src/stage1/store.ts';
import { persistOutcome } from '../src/stage2/store.ts';

const BASE = process.env.TEST_DATABASE_URL;
const DB = 'npm_monitor_it';
const ROLES = ['npm_monitor_write', 'npm_monitor_web', 'npm_monitor_read'] as const;

const urlFor = (user?: string): string => {
  const u = new URL(BASE!);
  u.pathname = `/${DB}`;
  if (user) {
    u.username = user;
    u.password = 'test';
  }
  return u.toString();
};

const rejects = (p: Promise<unknown>, code: string) =>
  assert.rejects(p, (e: unknown) => {
    assert.equal((e as { code?: string }).code, code, (e as Error).message);
    return true;
  });

const CHECK = '23514';
const FK = '23503';
const DENIED = '42501';

describe('database', { skip: BASE ? false : 'TEST_DATABASE_URL is not set' }, () => {
  let admin: Sql; // owner of the schema: migrations and set-up
  let write: Sql; // pipeline role
  let web: Sql; // API and dashboard role
  let read: Sql; // reports and demonstrations

  before(async () => {
    const root = connect(BASE!, 'test-root');
    await root.unsafe(`drop database if exists ${DB} with (force)`);
    await root.unsafe(`create database ${DB}`);
    for (const role of ROLES) {
      const [found] = await root`select 1 from pg_roles where rolname = ${role}`;
      await root.unsafe(`${found ? 'alter' : 'create'} role ${role} login password 'test' nosuperuser nocreatedb nocreaterole`);
    }
    await root.end();

    admin = connect(urlFor(), 'test-admin');
    const report = await runMigrations(admin);
    assert.equal(report.applied.length, report.total);
    assert.deepEqual(report.roles, [...ROLES]);
    await loadSeed(admin);

    write = connect(urlFor('npm_monitor_write'), 'test-write');
    web = connect(urlFor('npm_monitor_web'), 'test-web');
    read = connect(urlFor('npm_monitor_read'), 'test-read');
  });

  after(async () => {
    await Promise.all([admin, write, web, read].map((s) => s?.end({ timeout: 5 })));
  });

  describe('migrations and reference data', () => {
    it('a second run applies nothing and keeps the reference data', async () => {
      const report = await runMigrations(admin);
      assert.deepEqual(report.applied, []);
      assert.equal(report.reference.retired, 0);
      const [n] = await admin<{ n: number }[]>`select count(*)::int as n from schema_migrations`;
      assert.equal(n!.n, report.total);
    });

    it('the feature catalogue covers both stages and the five sources exist', async () => {
      const stages = await admin<{ stage: number; n: number }[]>`select stage, count(*)::int as n from feature where active group by stage order by stage`;
      assert.deepEqual(stages.map((s) => s.stage), [1, 2]);
      assert.ok(stages.every((s) => s.n >= 10));
      const [src] = await admin<{ ids: string[] }[]>`select array_agg(id order by id) as ids from source`;
      assert.deepEqual(src!.ids, ['depsdev', 'ecosystems', 'github', 'rdap', 'registry']);
    });

    it('a feature that the code no longer emits is retired, not deleted', async () => {
      await admin`insert into feature (id, stage, lane, weight, title) values ('old_rule', 2, 'registry', 1, 'Old rule')`;
      const sync = await syncReference(admin);
      assert.equal(sync.retired, 1);
      const [row] = await admin<{ active: boolean }[]>`select active from feature where id = 'old_rule'`;
      assert.equal(row!.active, false);
      await admin`delete from feature where id = 'old_rule'`;
    });
  });

  describe('integrity', () => {
    it('a stage-1 result needs its journal event', async () => {
      await rejects(
        write`insert into stage1_result (seq, package, event_time, prescore, candidate, features, engine)
              values (999999, 'ghost', now(), 2, true, '[{"id":"new_package","weight":2}]', 'v3:a566433d@none')`,
        FK,
      );
    });

    it('a stage-1 result cannot carry another time than its event', async () => {
      await rejects(
        write`insert into stage1_result (seq, package, event_time, prescore, candidate, features, engine)
              values (1001, 'left-pad', now(), 2, true, '[{"id":"new_package","weight":2}]', 'v3:a566433d@none')`,
        FK,
      );
    });

    it('a stage-2 result needs a stage-1 result', async () => {
      await rejects(
        write`insert into stage2_result (seq, package, event_time, enriched_at, kind, versions, prescore, final_score, alert, features, evidence, sources, engine)
              select seq, package, observed_at, now(), 'publish', '{}', 0, 0, false, '[]', '{}', '{}', 'v5:ed7f77fa' from feed_event where seq = 1001`,
        FK,
      );
    });

    it('a journal event with results cannot be deleted', async () => {
      await rejects(write`delete from feed_event where seq = 1006`, FK);
    });

    it('value constraints reject bad rows', async () => {
      await rejects(write`insert into feed_event (seq, package, rev, observed_at) values (2001, 'x', 'not-a-rev', now())`, CHECK);
      await rejects(write`insert into feed_event (seq, package, rev, observed_at) values (2001, '', '1-a', now())`, CHECK);
      await rejects(write`insert into feed_event (seq, package, rev, observed_at) values (2001, 'x', '1-a', '2026-11-01T00:00:00.000001Z')`, CHECK);
      await rejects(
        write`insert into feed_event (seq, package, rev, observed_at, observed_after) values (2001, 'x', '1-a', now(), now() + interval '1 minute')`,
        CHECK,
      );
      await rejects(write`update stage2_result set kind = 'unknown' where seq = 1006`, CHECK);
      await rejects(write`update stage2_result set final_score = -1 where seq = 1006`, CHECK);
      await rejects(write`update stage2_result set evidence = '[]' where seq = 1006`, CHECK);
      await rejects(write`insert into source_usage (hour, source, requests, errors, skipped) values (date_trunc('hour', now()), 'whois', 1, 0, 0)`, FK);
      await rejects(web`update finding set verdict = 'maybe' where seq = 1009`, CHECK);
    });

    it('the feature list must refer to the catalogue of the same stage', async () => {
      await rejects(write`update stage1_result set features = '[{"id":"no_such_rule","weight":1}]' where seq = 1004`, CHECK);
      await rejects(write`update stage1_result set features = '[{"id":"publisher_new","weight":3}]' where seq = 1004`, CHECK);
      await rejects(write`update stage1_result set features = '[{"id":"rate_package"}]' where seq = 1004`, CHECK);
      await rejects(write`update stage1_result set features = '[]' where seq = 1004`, CHECK);
    });
  });

  describe('transactions', () => {
    const meta = (lastSeq: number) => ({ observedAt: new Date(), observedAfter: new Date(Date.now() - 5000), next: { lastSeq, windowStart: new Date() }, headSeq: lastSeq });

    it('a page and the cursor are stored together; a repeated seq is dropped', async () => {
      const page = { changes: [{ seq: 3001, id: 'pkg-a', rev: '1-aa', deleted: false }, { seq: 3002, id: 'pkg-b', rev: '2-bb', deleted: true }], lastSeq: 3002 };
      assert.equal(await persistPage(write, 'npm', page, meta(3002)), 2);
      assert.equal(await persistPage(write, 'npm', page, meta(3002)), 0);
      assert.equal((await loadCursor(write, 'npm'))!.lastSeq, 3002);
      const [n] = await write<{ n: number }[]>`select count(*)::int as n from feed_event where seq in (3001, 3002)`;
      assert.equal(n!.n, 2);
    });

    it('a page with one bad row is rolled back as a whole: no event, no cursor move', async () => {
      const page = { changes: [{ seq: 3003, id: 'pkg-c', rev: '1-cc', deleted: false }, { seq: 3004, id: 'pkg-d', rev: 'broken', deleted: false }], lastSeq: 3004 };
      await rejects(persistPage(write, 'npm', page, meta(3004)), CHECK);
      assert.equal((await loadCursor(write, 'npm'))!.lastSeq, 3002);
      const [n] = await write<{ n: number }[]>`select count(*)::int as n from feed_event where seq in (3003, 3004)`;
      assert.equal(n!.n, 0);
    });

    it('a stage-1 batch, the hourly counters and the stage cursor are one transaction', async () => {
      const [ev] = await write<{ observed_at: Date }[]>`select observed_at from feed_event where seq = 3001`;
      const hour = Math.floor(ev!.observed_at.getTime() / 3_600_000) * 3_600_000;
      const row = (seq: number, id: string) => ({
        seq, package: 'pkg-a', eventTime: ev!.observed_at, prescore: 2, candidate: true,
        features: [{ id, lane: 'version', weight: 2, value: true }],
      });
      const counts = () => new Map([[hour, { processed: 2, flagged: 1, candidates: 1 }]]);
      await persistBatch(write, 'stage1', 'v3:a566433d@none', [row(3001, 'new_package')], 3002, 2, counts());
      const [c1] = await write<{ last_seq: string; processed: string }[]>`select last_seq, processed from stage_cursor where stage = 'stage1'`;
      assert.equal(Number(c1!.last_seq), 3002);
      const hourly = () => write<{ processed: number }[]>`select processed from stage1_hourly where hour = ${new Date(hour)}`;
      const [h1] = await hourly();

      // a feature that the catalogue does not know: the batch, the counters and the cursor stay as they were
      await rejects(persistBatch(write, 'stage1', 'v3:a566433d@none', [row(3002, 'made_up_rule')], 3999, 5, counts()), CHECK);
      const [c2] = await write<{ last_seq: string; processed: string }[]>`select last_seq, processed from stage_cursor where stage = 'stage1'`;
      assert.deepEqual(c2, c1);
      const [h2] = await hourly();
      assert.equal(h2!.processed, h1!.processed);
      const [n] = await write<{ n: number }[]>`select count(*)::int as n from stage1_result where seq = 3002`;
      assert.equal(n!.n, 0);
    });

    it('a stage-2 result, its request counters and the maintainer change are one transaction', async () => {
      const [ev] = await write<{ observed_at: Date }[]>`select observed_at from feed_event where seq = 1005`;
      const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
      const outcome = {
        seq: 1005, package: 'queued-lib', eventTime: ev!.observed_at, kind: 'publish' as const, versions: ['1.0.0'],
        prescore: 2, finalScore: 2, alert: false, features: [],
        evidence: { registry: { maintainers: ['grace'], versions: [{ version: '1.0.0', publisher: { name: 'grace', emailDomain: 'queued.example' } }] } },
        sources: { registry: { status: 200 } },
      };
      await persistOutcome(write, 'v5:ed7f77fa', outcome, [{ hour, source: 'registry', requests: 1, errors: 0, skipped: 0 }]);
      const [m] = await write<{ added: string[] }[]>`select added from maintainer_set where package = 'queued-lib'`;
      assert.deepEqual(m!.added, ['grace']);

      // the same event again with a source that does not exist: nothing of the second call may stay
      const before = await write<{ requests: number }[]>`select requests from source_usage where hour = ${hour} and source = 'registry'`;
      await rejects(persistOutcome(write, 'v5:ed7f77fa', { ...outcome, seq: 1004, package: 'busy-lib' }, [
        { hour, source: 'registry', requests: 5, errors: 0, skipped: 0 },
        { hour, source: 'whois' as 'rdap', requests: 1, errors: 0, skipped: 0 },
      ]), FK);
      const afterRows = await write<{ requests: number }[]>`select requests from source_usage where hour = ${hour} and source = 'registry'`;
      assert.equal(afterRows[0]!.requests, before[0]!.requests);
      const [none] = await write<{ n: number }[]>`select count(*)::int as n from stage2_result where seq = 1004`;
      assert.equal(none!.n, 0);
    });
  });

  describe('partitions', () => {
    it('the function creates the month and the next month once', async () => {
      const first = await ensurePartitions(write, new Date('2031-05-20T00:00:00Z'));
      assert.deepEqual(first, ['feed_event_203105', 'feed_event_203106']);
      assert.deepEqual(await ensurePartitions(write, new Date('2031-05-21T00:00:00Z')), []);
    });

    it('a row goes to the partition of its month; the default partition stays empty', async () => {
      await write`insert into feed_event (seq, package, rev, observed_at) values (4001, 'future', '1-ff', '2031-06-30T23:59:59Z')`;
      const [row] = await write<{ part: string }[]>`select tableoid::regclass::text as part from feed_event where seq = 4001`;
      assert.equal(row!.part, 'feed_event_203106');
      const [d] = await write<{ n: number }[]>`select count(*)::int as n from feed_event_default`;
      assert.equal(d!.n, 0);
    });

    it('the pipeline role cannot create tables itself', async () => {
      await rejects(write`create table sneaky (id int)`, DENIED);
    });
  });

  describe('personal data', () => {
    it('an e-mail address in a snapshot is reduced to its domain on insert', async () => {
      const [row] = await admin<{ evidence: { registry: { versions: { publisher: Record<string, unknown>; scripts?: Record<string, string> }[] } } }[]>`
        select evidence from stage2_result where seq = 1014`;
      const v = row!.evidence.registry.versions[0]!;
      assert.equal(v.publisher.emailDomain, 'gmail.com');
      assert.equal('email' in v.publisher, false);
      // text that only looks like the field, inside a script, is left alone
      assert.equal(v.scripts!.preinstall, 'echo "email": "not-a-field@example.org"');
      const [left] = await admin<{ n: number }[]>`select count(*)::int as n from stage2_result where evidence::text ~ '[a-z]+@[a-z-]+\\.example'`;
      assert.equal(left!.n, 0);
    });

    it('a null e-mail becomes a null domain', async () => {
      const [row] = await admin<{ d: string | null; has: boolean }[]>`
        select evidence #>> '{registry,previous,publisher,emailDomain}' as d,
               (evidence #> '{registry,previous,publisher}') ? 'emailDomain' as has
        from stage2_result where seq = 1009`;
      assert.equal(row!.d, null);
      assert.equal(row!.has, true);
    });

    it('mask_email and pseudonym', async () => {
      const [r] = await admin<{ m: string; bad: string | null; p1: string; p2: string; p3: string }[]>`
        select mask_email('jane.doe@example.org') as m, mask_email('not an address') as bad,
               pseudonym('alice') as p1, pseudonym('alice') as p2, pseudonym('bob') as p3`;
      assert.equal(r!.m, 'j***@example.org');
      assert.equal(r!.bad, null);
      assert.equal(r!.p1, r!.p2);
      assert.notEqual(r!.p1, r!.p3);
      assert.match(r!.p1, /^user-[0-9a-f]{10}$/);
    });

    it('an excluded account is removed from stored rows, except from a confirmed incident', async () => {
      await admin`insert into exclusion (account, note) values ('bob', 'request of 2026-11-15'), ('mallory', 'request')`;
      const [noisy] = await admin<{ t: string; f: string }[]>`select evidence::text as t, features::text as f from stage2_result where seq = 1010`;
      assert.equal(noisy!.t.includes('"bob"'), false);
      assert.equal(noisy!.f.includes('"bob"'), false);
      assert.ok(noisy!.t.includes('[excluded]'));
      const [set] = await admin<{ maintainers: string[]; added: string[] }[]>`select maintainers, added from maintainer_set where seq = 1010`;
      assert.deepEqual(set!.maintainers, ['[excluded]']);
      assert.deepEqual(set!.added, ['[excluded]']);
      // 1009 has the verdict "confirmed": the data of the incident stays
      const [evil] = await admin<{ t: string }[]>`select evidence::text as t from stage2_result where seq = 1009`;
      assert.ok(evil!.t.includes('"mallory"'));
    });

    it('an excluded account is not stored again', async () => {
      const [ev] = await write<{ observed_at: Date }[]>`select observed_at from feed_event where seq = 1004`;
      await write`update stage1_result set candidate = true where seq = 1004`;
      await persistOutcome(write, 'v5:ed7f77fa', {
        seq: 1004, package: 'busy-lib', eventTime: ev!.observed_at, kind: 'publish', versions: ['2.0.0'], prescore: 1, finalScore: 4, alert: false,
        features: [{ id: 'publisher_new', lane: 'publisher', weight: 3, value: 'bob' }],
        evidence: { registry: { maintainers: ['bob', 'heidi'], versions: [{ version: '2.0.0', publisher: { name: 'bob' } }] } },
        sources: {},
      }, []);
      const [row] = await admin<{ t: string; f: string }[]>`select evidence::text as t, features::text as f from stage2_result where seq = 1004`;
      assert.equal(row!.t.includes('"bob"'), false);
      assert.equal(row!.f.includes('"bob"'), false);
      const [set] = await admin<{ maintainers: string[] }[]>`select maintainers from maintainer_set where seq = 1004`;
      assert.deepEqual(set!.maintainers, ['[excluded]', 'heidi']);
    });

    it('an account name must look like an npm user name', async () => {
      await rejects(admin`insert into exclusion (account) values ('x"; drop table finding; --')`, CHECK);
    });
  });

  describe('verdicts', () => {
    it('every change of a verdict is kept in the history', async () => {
      await putFinding(web, 1014, { verdict: 'undecided', note: null, reference: null });
      await putFinding(web, 1014, { verdict: 'false_positive', note: 'known publisher', reference: null });
      await putFinding(web, 1014, { verdict: 'false_positive', note: 'known publisher', reference: null }); // no change: no row
      await web`delete from finding where seq = 1014`;
      const rows = await admin<{ operation: string; verdict: string; changed_by: string }[]>`
        select operation, verdict, changed_by from finding_history where seq = 1014 order by id`;
      assert.deepEqual(rows.map((r) => `${r.operation}:${r.verdict}`), ['insert:undecided', 'update:false_positive', 'delete:false_positive']);
      assert.ok(rows.every((r) => r.changed_by === 'npm_monitor_web'));
    });

    it('a verdict for an event that does not exist stores nothing', async () => {
      await assert.rejects(putFinding(web, 987654, { verdict: 'confirmed', note: null, reference: null }));
      const [n] = await admin<{ n: number }[]>`select count(*)::int as n from finding where seq = 987654`;
      assert.equal(n!.n, 0);
    });
  });

  describe('retention', () => {
    it('removes old snapshots without an alert and keeps alerts, repeats and recent rows', async () => {
      const report = await runMaintenance(write, { evidenceDays: 30, deleteAllAfter: null });
      assert.deepEqual(report.retention, { snapshots: 1, maintainerRows: 1, alerts: 0, findings: 0 });
      const rows = await admin<{ seq: string; empty: boolean; purged: boolean }[]>`
        select seq, evidence = '{}'::jsonb as empty, evidence_purged_at is not null as purged
        from stage2_result where seq in (1006, 1007, 1009, 1011) order by seq`;
      assert.deepEqual(rows.map((r) => [Number(r.seq), r.empty, r.purged]), [
        [1006, false, false], // recent
        [1007, true, true], // 40 days old, no alert
        [1009, false, false], // alert
        [1011, false, false], // repeat of an alert
      ]);
      // the score and the feature ids of the purged row stay for the statistics
      const [kept] = await admin<{ final_score: number; n: number }[]>`select final_score, jsonb_array_length(features) as n from stage2_result where seq = 1007`;
      assert.equal(kept!.final_score, 2.5);
      assert.equal(kept!.n, 1);
      // old-lib: the row of the purged snapshot is gone, the newest row stays as the baseline
      const sets = await admin<{ seq: string }[]>`select seq from maintainer_set where package = 'old-lib'`;
      assert.deepEqual(sets.map((s) => Number(s.seq)), [1008]);
    });

    it('a second run finds nothing and every run is logged', async () => {
      const report = await runMaintenance(write, { evidenceDays: 30, deleteAllAfter: null });
      assert.deepEqual(report.retention, { snapshots: 0, maintainerRows: 0, alerts: 0, findings: 0 });
      const [n] = await admin<{ n: number }[]>`select count(*)::int as n from retention_run`;
      assert.equal(n!.n, 2);
    });

    it('after the final date the alerts lose their snapshots and the verdicts are deleted', async () => {
      await admin.begin(async (tx) => {
        const [r] = await tx<{ alerts_purged: number; findings_purged: number }[]>`select * from apply_retention(30, now() - interval '1 second')`;
        assert.ok(r!.alerts_purged >= 3);
        assert.equal(r!.findings_purged, 2);
        const [left] = await tx<{ snapshots: number; sets: number; history: number }[]>`
          select (select count(*)::int from stage2_result where evidence <> '{}'::jsonb) as snapshots,
                 (select count(*)::int from maintainer_set) as sets,
                 (select count(*)::int from finding_history) as history`;
        assert.deepEqual(left, { snapshots: 0, sets: 0, history: 0 });
        throw new Error('rollback'); // keep the data for the tests below
      }).catch((e: Error) => assert.equal(e.message, 'rollback'));
    });

    it('rejects a period shorter than one day', async () => {
      await rejects(write`select apply_retention(0, null)`, '22023');
    });
  });

  describe('views', () => {
    it('feature_hit gives one row per fired feature with the catalogue stage', async () => {
      const rows = await read<{ stage: number; feature_id: string; n: number }[]>`
        select h.stage::int as stage, h.feature_id, count(*)::int as n
        from feature_hit h join feature f on f.id = h.feature_id and f.stage = h.stage
        where h.seq in (1009, 1014) group by 1, 2 order by 1, 2`;
      assert.deepEqual(rows.map((r) => `${r.stage}:${r.feature_id}:${r.n}`), [
        '1:breadth_mature:1', '1:dormant_awake:1', '1:name_edit:1', '1:name_scope_typo:1',
        '2:install_script_added:1', '2:install_script_new_package:1', '2:publisher_new:1',
      ]);
    });

    it('alert lists every alert with its verdict', async () => {
      const rows = await read<{ seq: string; verdict: string; stage2_features: string[] }[]>`select seq, verdict, stage2_features from alert order by seq`;
      assert.deepEqual(rows.map((r) => [Number(r.seq), r.verdict]), [[1009, 'confirmed'], [1010, 'false_positive'], [1014, 'open']]);
      assert.deepEqual(rows[0]!.stage2_features, ['install_script_added', 'publisher_new']);
    });

    it('maintainer_change unfolds the arrays', async () => {
      const rows = await web<{ account: string; change: string }[]>`select account, change from maintainer_change where package = 'old-lib' order by change, account`;
      assert.deepEqual(rows.map((r) => `${r.change}:${r.account}`), ['added:frank', 'removed:erin']);
    });

    it('daily_stats is refreshed by the pipeline role and counts the funnel', async () => {
      await write`select refresh_daily_stats()`;
      const [t] = await read<{ days: number; events: number; alerts: number; popular: number; confirmed: number }[]>`
        select count(*)::int as days, sum(events)::int as events, sum(alerts)::int as alerts,
               sum(alerts_popular)::int as popular, sum(confirmed)::int as confirmed from daily_stats`;
      assert.ok(t!.days >= 41);
      const [j] = await admin<{ n: number }[]>`select count(*)::int as n from feed_event where observed_at <= now()`;
      assert.equal(t!.events, j!.n);
      assert.equal(t!.alerts, 3);
      assert.equal(t!.popular, 1); // noisy-lib is in the popular snapshot
      assert.equal(t!.confirmed, 1);
    });

    it('the data-quality report is clean', async () => {
      const rows = await read<{ expectation: string; violations: string }[]>`select expectation, violations from data_quality`;
      assert.equal(rows.length, 7);
      assert.deepEqual(rows.filter((r) => Number(r.violations) !== 0), []);
    });
  });

  describe('access rights', () => {
    it('no application role is a superuser or can create roles and databases', async () => {
      const rows = await admin<{ bad: boolean }[]>`
        select (rolsuper or rolcreaterole or rolcreatedb or rolbypassrls) as bad from pg_roles where rolname = any (${[...ROLES]})`;
      assert.equal(rows.length, 3);
      assert.ok(rows.every((r) => !r.bad));
    });

    it('the pipeline role writes pipeline tables and nothing else', async () => {
      await rejects(write`insert into finding (seq, observed_at, verdict, decided_at) select seq, observed_at, 'confirmed', now() from feed_event where seq = 1001`, DENIED);
      await rejects(write`insert into exclusion (account) values ('zed')`, DENIED);
      await rejects(write`update feature set weight = 99`, DENIED);
      await rejects(write`select * from finding_history`, DENIED);
      await rejects(write`drop table feed_event`, DENIED);
      await rejects(write`select grant_app_privileges()`, DENIED);
    });

    it('the web role reads everything and writes verdicts only', async () => {
      const [n] = await web<{ n: number }[]>`select count(*)::int as n from stage2_result`;
      assert.ok(n!.n > 0);
      await rejects(web`update stage2_result set alert = false`, DENIED);
      await rejects(web`delete from feed_event`, DENIED);
      await rejects(web`insert into finding_history (seq, operation) values (1, 'insert')`, DENIED);
      await rejects(web`select apply_retention(30, null)`, DENIED);
    });

    it('the read role sees no snapshots and no account names', async () => {
      await rejects(read`select evidence from stage2_result limit 1`, DENIED);
      await rejects(read`select * from maintainer_set limit 1`, DENIED);
      await rejects(read`select * from exclusion`, DENIED);
      await rejects(read`update finding set verdict = 'confirmed'`, DENIED);
      const [m] = await read<{ maintainers: string[] }[]>`select maintainers from maintainer_set_masked where seq = 1009`;
      assert.equal(m!.maintainers.length, 2);
      assert.ok(m!.maintainers.every((x) => /^user-[0-9a-f]{10}$/.test(x)));
      const [s] = await read<{ features: { id: string; value?: unknown }[] }[]>`select features from stage2_result_masked where seq = 1009`;
      assert.deepEqual(s!.features.map((f) => f.id), ['publisher_new', 'install_script_added']);
      assert.ok(s!.features.every((f) => !('value' in f)));
    });

    it('a table added later gets its rights from the next migration run', async () => {
      await admin`create table later_table (id int primary key)`;
      await rejects(web`select * from later_table`, DENIED);
      await runMigrations(admin);
      assert.equal((await web`select * from later_table`).length, 0);
      await rejects(read`select * from later_table`, DENIED);
      await admin`drop table later_table`;
    });
  });
});
