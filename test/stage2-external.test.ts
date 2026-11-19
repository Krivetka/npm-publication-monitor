import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Candidate, enrichCandidate } from '../src/stage2/enrich.ts';
import {
  analyzeDepsDev,
  analyzeDomain,
  analyzeEcoMaintainer,
  analyzeEcoPackage,
  analyzeGithubCommit,
  customDomain,
  type DomainInfo,
  parseRdap,
} from '../src/stage2/external.ts';
import { STAGE2_PARAMS as P } from '../src/stage2/params.ts';
import { Budget, type Outcome, type Sources } from '../src/stage2/sources.ts';
import type { Packument } from '../src/stage2/types.ts';

const DAY = 86_400_000;
const PUBLISH = Date.parse('2026-05-14T14:25:30Z');
const ids = (a: { features: { id: string }[] }) => a.features.map((f) => f.id).sort();

describe('external sources', () => {
  it('ecosyste.ms: archived and long-inactive repository', () => {
    const a = analyzeEcoPackage({ repo_metadata: { full_name: 'o/r', archived: true, pushed_at: '2025-01-01T00:00:00Z' } }, PUBLISH, P);
    assert.deepEqual(ids(a), ['repo_archived', 'repo_inactive']);
    assert.deepEqual(ids(analyzeEcoPackage({ repo_metadata: { archived: false, pushed_at: '2026-05-01T00:00:00Z' } }, PUBLISH, P)), []);
    assert.deepEqual(analyzeEcoPackage(null, PUBLISH, P).evidence, { found: false, repo: null });
  });

  it('ecosyste.ms: publisher first seen recently — only for a mature package', () => {
    const recent = { created_at: new Date(PUBLISH - 5 * DAY).toISOString(), packages_count: 1 };
    assert.deepEqual(ids(analyzeEcoMaintainer(recent, PUBLISH, true, P)), ['publisher_recent']);
    assert.deepEqual(ids(analyzeEcoMaintainer(recent, PUBLISH, false, P)), []);
  });

  it('deps.dev: attested source does not match the declared one', () => {
    const body = {
      relatedProjects: [
        { projectKey: { id: 'github.com/evil/fork' }, relationProvenance: 'SLSA_ATTESTATION', relationType: 'SOURCE_REPO' },
        { projectKey: { id: 'github.com/owner/lib' }, relationProvenance: 'UNVERIFIED_METADATA', relationType: 'SOURCE_REPO' },
      ],
      attestations: [{}],
    };
    assert.deepEqual(ids(analyzeDepsDev(body, { owner: 'owner', name: 'lib' }, P)), ['provenance_repo_mismatch']);
    assert.deepEqual(ids(analyzeDepsDev(body, { owner: 'evil', name: 'fork' }, P)), []);
  });

  it('GitHub: a commit missing from the repository, and a missing repository', () => {
    const repo = { owner: 'o', name: 'r' };
    assert.deepEqual(ids(analyzeGithubCommit(200, repo, 'abc', P)), []);
    assert.deepEqual(ids(analyzeGithubCommit(422, repo, 'abc', P)), ['git_head_unknown']);
    assert.deepEqual(ids(analyzeGithubCommit(404, repo, 'abc', P)), ['repo_missing']);
  });

  it('RDAP: fresh and expired e-mail domain', () => {
    const info = parseRdap(200, {
      events: [
        { eventAction: 'registration', eventDate: '2026-04-01T00:00:00Z' },
        { eventAction: 'expiration', eventDate: '2026-06-01T00:00:00Z' },
      ],
    });
    assert.deepEqual(info, { status: 200, registered: '2026-04-01T00:00:00Z', expires: '2026-06-01T00:00:00Z' });
    assert.deepEqual(ids(analyzeDomain('fresh.dev', info, PUBLISH, Date.parse('2026-10-14T00:00:00Z'), P)), ['email_domain_expired', 'email_domain_young']);
    assert.deepEqual(ids(analyzeDomain('x.it', parseRdap(404, null), PUBLISH, PUBLISH, P)), []);
  });

  it('e-mail domain for RDAP', () => {
    assert.equal(customDomain('someone@gmail.com'), null);
    assert.equal(customDomain('npm-oidc-no-reply@github.com'), 'github.com');
    assert.equal(customDomain('brandon@diginow.it'), 'diginow.it');
    assert.equal(customDomain('a@mail.example.co.uk'), 'example.co.uk');
    assert.equal(customDomain('a@dev.team.example.com'), 'example.com');
    assert.equal(customDomain(undefined), null);
  });

  it('budget: the token bucket refills over time', () => {
    const b = new Budget(2, 0);
    assert.ok(b.take(0));
    assert.ok(b.take(0));
    assert.ok(!b.take(0));
    assert.ok(b.take(1_800_000));
    b.pauseUntil(5_000_000);
    assert.ok(!b.take(4_000_000));
  });
});

// Stub sources: return canned responses and count calls.
function stubSources(pack: Packument | null, extra: Partial<Record<string, Outcome<unknown>>> = {}) {
  const calls: string[] = [];
  const ok = <T>(body: T | null, status = 200): Outcome<T> => ({ ok: true, status, body });
  const src = {
    packument: async () => (calls.push('packument'), ok(pack, pack ? 200 : 404)),
    ecoPackage: async () => (calls.push('ecoPackage'), extra.ecoPackage ?? ok(null, 404)),
    ecoMaintainer: async () => (calls.push('ecoMaintainer'), extra.ecoMaintainer ?? ok(null, 404)),
    depsdevVersion: async () => (calls.push('depsdev'), extra.depsdev ?? ok(null, 404)),
    githubCommit: async () => (calls.push('github'), extra.github ?? { ok: false, reason: 'quota' }),
    rdap: async () => (calls.push('rdap'), extra.rdap ?? ok(null, 404)),
  };
  return { src: src as unknown as Sources, calls };
}

const memoryDomains = () => {
  const m = new Map<string, DomainInfo>();
  return { get: async (d: string) => m.get(d) ?? null, set: async (d: string, i: DomainInfo) => void m.set(d, i) };
};

function ipcPack(): Packument {
  const owner = { name: 'owner', email: 'owner@example.org' };
  const v = (version: string, user = owner) => ({
    version,
    _npmUser: user,
    maintainers: [owner],
    gitHead: 'deadbeef',
    repository: 'git+https://github.com/owner/node-ipc.git',
    dist: { unpackedSize: 50_000, fileCount: 20 },
  });
  const mallory = { name: 'mallory', email: 'mallory@fresh-domain.dev' };
  return {
    name: 'node-ipc',
    versions: { '9.2.1': v('9.2.1'), '10.0.0': v('10.0.0'), '12.0.0': v('12.0.0'), '12.0.1': v('12.0.1', mallory), '9.2.3': v('9.2.3', mallory) },
    time: { '9.2.1': '2021-03-10T00:00:00Z', '10.0.0': '2021-06-10T00:00:00Z', '12.0.0': '2024-08-12T16:28:35Z', '12.0.1': '2026-05-14T14:25:30Z', '9.2.3': '2026-05-14T14:26:01Z' },
    maintainers: [owner],
  };
}

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  seq: 1,
  package: 'node-ipc',
  prescore: 2,
  observedAt: new Date('2026-05-14T14:25:34Z'),
  observedAfter: new Date('2026-05-14T14:25:29Z'),
  prevObservedAt: null,
  ...over,
});

describe('enrichCandidate', () => {
  it('node-ipc: final score above the threshold, GitHub skipped by quota, RDAP on the publisher domain', async () => {
    const rdap: Outcome<unknown> = { ok: true, status: 200, body: { events: [{ eventAction: 'registration', eventDate: '2026-05-01T00:00:00Z' }] } };
    const { src, calls } = stubSources(ipcPack(), { rdap });
    const r = await enrichCandidate(candidate(), src, memoryDomains(), P, Date.parse('2026-05-14T14:30:00Z'));
    assert.ok(r !== 'defer' && r !== 'retry');
    assert.equal(r.kind, 'publish');
    assert.deepEqual(r.versions, ['12.0.1']);
    assert.deepEqual(ids(r), ['dormant_release', 'email_domain_young', 'non_adjacent_branches', 'publisher_new']);
    assert.ok(r.alert);
    assert.equal(r.finalScore, 2 + 1.5 + 1.5 + 2 + 3);
    assert.deepEqual(r.sources.github_commit, { skipped: 'quota' });
    assert.deepEqual(calls.sort(), ['depsdev', 'ecoMaintainer', 'ecoPackage', 'github', 'packument', 'rdap']);
  });

  it('a fresh event without the version in the packument is deferred; an old one is recorded as metadata', async () => {
    const { src } = stubSources(ipcPack());
    const c = candidate({ observedAt: new Date('2026-10-14T10:00:00Z'), observedAfter: new Date('2026-10-14T09:59:55Z') });
    assert.equal(await enrichCandidate(c, src, memoryDomains(), P, Date.parse('2026-10-14T10:02:00Z')), 'defer');
    const late = await enrichCandidate(c, src, memoryDomains(), P, Date.parse('2026-10-14T10:30:00Z'));
    assert.ok(late !== 'defer' && late !== 'retry');
    assert.equal(late.kind, 'metadata');
    assert.ok(!late.alert);
  });

  it('the previous event of the package cuts off its versions', async () => {
    const { src } = stubSources(ipcPack());
    const c = candidate({
      observedAt: new Date('2026-05-14T14:26:04Z'),
      observedAfter: new Date('2026-05-14T14:25:59Z'),
      prevObservedAt: new Date('2026-05-14T14:25:34Z'),
    });
    const r = await enrichCandidate(c, src, memoryDomains(), P, Date.parse('2026-05-14T14:30:00Z'));
    assert.ok(r !== 'defer' && r !== 'retry');
    assert.deepEqual(r.versions, ['9.2.3']);
  });

  it('packument unavailable — retry later', async () => {
    const src = { packument: async () => ({ ok: false, reason: 'error', error: 'timeout' }) } as unknown as Sources;
    assert.equal(await enrichCandidate(candidate(), src, memoryDomains(), P), 'retry');
  });
});
