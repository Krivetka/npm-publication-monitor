import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Candidate, enrichCandidate } from '../src/stage2/enrich.ts';
import { STAGE2_PARAMS as P } from '../src/stage2/params.ts';
import type { Outcome, Sources } from '../src/stage2/sources.ts';
import type { Packument } from '../src/stage2/types.ts';

const ok = <T>(body: T | null, status = 200): Outcome<T> => ({ ok: true, status, body });
const domains = { get: async () => null, set: async () => {} };

// A packument whose latest version is old: the event carries no new version (dist-tag churn).
const stalePack: Packument = {
  name: 'iterate',
  versions: { '1.0.0': { version: '1.0.0', _npmUser: { name: 'owner' }, maintainers: [{ name: 'owner' }] } },
  time: { '1.0.0': '2024-01-01T00:00:00Z' },
  maintainers: [{ name: 'owner' }],
};
const stub = {
  packument: async () => ok(stalePack),
  ecoPackage: async () => ok(null, 404),
  ecoMaintainer: async () => ok(null, 404),
  depsdevVersion: async () => ok(null, 404),
  githubCommit: async () => ok(null, 404),
  rdap: async () => ok(null, 404),
} as unknown as Sources;

const owner = { _npmUser: { name: 'owner' }, maintainers: [{ name: 'owner' }] };
function released(versions: Record<string, string>): Packument {
  return {
    name: 'lib',
    versions: Object.fromEntries(Object.keys(versions).map((v) => [v, { version: v, ...owner }])),
    time: versions,
    maintainers: owner.maintainers,
  };
}
const history = { '1.0.0': '2026-07-01T00:00:00Z', '1.0.1': '2026-08-01T00:00:00Z', '1.5.0': '2026-09-01T00:00:00Z' };
const burst = (): Candidate => ({
  seq: 2,
  package: 'lib',
  prescore: 3, // rate_package + rate_scope
  observedAt: new Date('2026-10-14T15:00:00Z'),
  observedAfter: new Date('2026-10-14T14:59:55Z'),
  prevObservedAt: null,
});
const withPack = (pack: Packument | null) => ({ ...stub, packument: async () => ok(pack, pack ? 200 : 404) }) as unknown as Sources;

describe('alert rule', () => {
  it('a metadata-only event is never an alert, even when the prescore alone crosses the threshold', async () => {
    const c: Candidate = {
      seq: 1,
      package: 'iterate',
      prescore: 4.5,
      observedAt: new Date('2026-10-14T15:00:00Z'),
      observedAfter: new Date('2026-10-14T14:59:55Z'),
      prevObservedAt: null,
    };
    const r = await enrichCandidate(c, stub, domains, P, Date.parse('2026-10-14T15:30:00Z'));
    assert.ok(r !== 'defer' && r !== 'retry');
    assert.equal(r.kind, 'metadata');
    assert.equal(r.finalScore, 4.5);
    assert.deepEqual(r.features, []);
    assert.equal(r.alert, false);
  });
  it('a package already gone from the registry is flagged but not alerted on: there is nothing to show', async () => {
    const r = await enrichCandidate(burst(), withPack(null), domains, P, Date.parse('2026-10-14T15:30:00Z'));
    assert.ok(r !== 'defer' && r !== 'retry');
    assert.equal(r.kind, 'package_missing');
    assert.equal(r.finalScore, 5);
    assert.equal(r.alert, false);
  });
  it('a burst plus one weak stage-2 feature reaches the threshold but is not an alert', async () => {
    const pack = released({ ...history, '1.5.1': '2026-10-14T14:59:00Z', '2.0.0': '2026-10-14T14:59:30Z' });
    const r = await enrichCandidate(burst(), withPack(pack), domains, P, Date.parse('2026-10-14T15:30:00Z'));
    assert.ok(r !== 'defer' && r !== 'retry');
    assert.deepEqual(r.features.map((f) => f.id), ['multi_branch']);
    assert.equal(r.finalScore, 4);
    assert.equal(r.alert, false);
  });
  it('a burst into non-adjacent release lines is an alert', async () => {
    const pack = released({ '0.3.0': '2026-07-01T00:00:00Z', '0.3.1': '2026-08-01T00:00:00Z', '0.3.2': '2026-09-01T00:00:00Z', '0.5.0': '2026-10-14T14:59:00Z', '0.7.0': '2026-10-14T14:59:30Z' });
    const r = await enrichCandidate(burst(), withPack(pack), domains, P, Date.parse('2026-10-14T15:30:00Z'));
    assert.ok(r !== 'defer' && r !== 'retry');
    assert.deepEqual(r.features.map((f) => f.id), ['non_adjacent_branches']);
    assert.equal(r.finalScore, 5);
    assert.equal(r.alert, true);
  });
  it('a version the registry already removed is a confirmation, not evidence: no alert on it alone', async () => {
    const pack = released({ ...history, '1.5.1': '2026-10-14T14:59:00Z' });
    delete pack.versions!['1.5.1']; // purged: the date survives in `time`, the manifest is gone
    const r = await enrichCandidate(burst(), withPack(pack), domains, P, Date.parse('2026-10-14T15:30:00Z'));
    assert.ok(r !== 'defer' && r !== 'retry');
    assert.deepEqual(r.features.map((f) => f.id), ['version_removed']);
    assert.equal(r.finalScore, 5);
    assert.equal(r.alert, false);
  });
  it('a watchlist package is alerted on the evidence alone; any other package still needs the score', async () => {
    const pack = released({ ...history, '1.5.1': '2026-10-14T14:59:00Z' });
    pack.versions!['1.5.1']!.scripts = { preinstall: 'node setup.mjs' };
    const quiet = { ...burst(), prescore: 0 };
    const at = Date.parse('2026-10-14T15:30:00Z');
    const plain = await enrichCandidate(quiet, withPack(pack), domains, P, at);
    const watched = await enrichCandidate({ ...quiet, watchlist: true }, withPack(pack), domains, P, at);
    assert.ok(plain !== 'defer' && plain !== 'retry' && watched !== 'defer' && watched !== 'retry');
    assert.deepEqual(watched.features.map((f) => f.id), ['install_script_added']);
    assert.equal(watched.finalScore, 2.5);
    assert.equal(plain.alert, false);
    assert.equal(watched.alert, true);
  });
  it('a watchlist package with weak evidence is not alerted', async () => {
    const pack = released({ ...history, '1.5.1': '2026-10-14T14:59:00Z', '2.0.0': '2026-10-14T14:59:30Z' });
    const r = await enrichCandidate({ ...burst(), prescore: 0, watchlist: true }, withPack(pack), domains, P, Date.parse('2026-10-14T15:30:00Z'));
    assert.ok(r !== 'defer' && r !== 'retry');
    assert.deepEqual(r.features.map((f) => f.id), ['multi_branch']);
    assert.equal(r.alert, false);
  });
  it('the staged-publishing placeholder does not make the first real version a non-adjacent line', async () => {
    const pack = released({ '0.0.0-stage': '2026-10-14T14:58:00Z', '0.4.0': '2026-10-14T14:59:00Z', '0.4.1': '2026-10-14T14:59:30Z' });
    const r = await enrichCandidate(burst(), withPack(pack), domains, P, Date.parse('2026-10-14T15:30:00Z'));
    assert.ok(r !== 'defer' && r !== 'retry');
    assert.ok(!r.features.some((f) => f.id === 'non_adjacent_branches' || f.id === 'multi_branch'));
    assert.equal(r.alert, false);
  });
});
