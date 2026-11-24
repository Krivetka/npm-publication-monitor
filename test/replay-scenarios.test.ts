import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chainDropRecorded, HELD_OUT, packumentAt, SCENARIOS } from '../src/replay/scenarios.ts';

const T0 = Date.parse('2026-11-01T12:00:00Z');
const rng = () => 0.5;

describe('replay scenarios', () => {
  it('scenario ids are unique', () => {
    const ids = SCENARIOS.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  describe('held-out incidents of 2025', () => {
    const expected: Record<string, [packages: number, versions: number]> = { nx: [8, 19], qix: [20, 20], 'shai-hulud': [105, 183], 'shai-hulud-2': [583, 810] };

    it('have the recorded sizes, a benign history and no account names', () => {
      assert.deepEqual(HELD_OUT.map((s) => s.id), Object.keys(expected));
      for (const sc of HELD_OUT) {
        const pkgs = sc.build(T0, rng, new Set());
        assert.deepEqual([pkgs.length, pkgs.flatMap((p) => p.burst).length], expected[sc.id], sc.id);
        for (const p of pkgs) {
          assert.ok(p.history.length > 0 && p.history.at(-1)!.t < T0 + p.burst[0]!.offsetMs, p.name);
          const people = [...p.maintainers, ...p.history.map((h) => h.user), ...p.burst.map((b) => b.user)];
          assert.ok(people.every((u) => /^acct-\d+$/.test(u.name ?? '') || u.trustedPublisher), p.name);
        }
      }
    });

    it('the manifest change follows the write-up of each incident', () => {
      const diff = (id: string) => {
        const p = HELD_OUT.find((s) => s.id === id)!.build(T0, rng, new Set())[0]!;
        const pack = packumentAt(p, T0, T0 + 86_400_000 * 3);
        return { mal: pack.versions![p.burst[0]!.v]!, benign: pack.versions![p.history.at(-1)!.v]! };
      };
      const nx = diff('nx');
      assert.equal(nx.mal.scripts!.postinstall, 'node telemetry.js');
      assert.ok(nx.benign.dist!.attestations && !nx.mal.dist!.attestations);
      const qix = diff('qix');
      assert.deepEqual(qix.mal.scripts, qix.benign.scripts);
      assert.equal(qix.mal.dist!.unpackedSize, qix.benign.dist!.unpackedSize);
      assert.equal(diff('shai-hulud').mal.scripts!.postinstall, 'node bundle.js');
      assert.equal(diff('shai-hulud-2').mal.scripts!.preinstall, 'node setup_bun.js');
    });
  });

  describe('ChainDrop as recorded', () => {
    const pkgs = chainDropRecorded.build(T0, rng, new Set());
    const versions = pkgs.flatMap((p) => p.burst);

    it('has the recorded size and duration', () => {
      assert.equal(pkgs.length, 432);
      assert.equal(versions.length, 2053);
      assert.equal(new Set(pkgs.map((p) => p.name)).size, pkgs.length);
      // 09:30:01 … 12:46:37 UTC on 4 August 2026
      assert.equal(Math.round(chainDropRecorded.durationMs / 60_000), 197);
      assert.equal(Math.min(...versions.map((b) => b.offsetMs)), 0);
      assert.equal(Math.max(...versions.map((b) => b.offsetMs)), chainDropRecorded.durationMs);
    });

    it('the wave is a few organisations, not hundreds of unrelated namespaces', () => {
      const namespaces = new Set(pkgs.map((p) => (p.name.startsWith('@') ? p.name.split('/')[0] : p.name)));
      assert.equal(namespaces.size, 45);
      const top = (scope: string) => pkgs.filter((p) => p.name.startsWith(`${scope}/`)).length;
      // 141 in the advisories; ten of them are no longer in the registry
      assert.equal(top('@servicetitan'), 131);
    });

    it('every package has a history that ends before the wave, in order', () => {
      for (const p of pkgs) {
        assert.ok(p.history.length > 0, p.name);
        assert.ok(p.history.every((h, i) => i === 0 || h.t >= p.history[i - 1]!.t), p.name);
        assert.ok(p.history.at(-1)!.t < T0 + p.burst[0]!.offsetMs, p.name);
        assert.ok(p.burst.every((b, i) => i === 0 || b.offsetMs >= p.burst[i - 1]!.offsetMs), p.name);
      }
    });

    it('a malicious version keeps the publisher and adds a preinstall script and two files', () => {
      const p = pkgs.find((x) => x.name === 'keyv')!;
      const pack = packumentAt(p, T0, T0 + chainDropRecorded.durationMs);
      const mal = pack.versions![p.burst[0]!.v]!;
      const benign = pack.versions![p.history.at(-1)!.v]!;
      assert.deepEqual(mal._npmUser, benign._npmUser);
      assert.equal(mal.scripts!.preinstall, 'node setup.mjs');
      assert.equal(benign.scripts!.preinstall, undefined);
      assert.equal(mal.dist!.unpackedSize! - benign.dist!.unpackedSize!, 738_697);
      assert.equal(mal.dist!.fileCount! - benign.dist!.fileCount!, 2);
      assert.deepEqual(mal.dependencies, benign.dependencies);
    });

    it('carries no account name and no e-mail address', () => {
      const people = pkgs.flatMap((p) => [...p.maintainers, ...p.history.map((h) => h.user), ...p.burst.map((b) => b.user)]);
      assert.ok(people.every((u) => /^acct-\d+$/.test(u.name ?? '') || u.trustedPublisher));
      assert.ok(people.every((u) => !u.email || u.trustedPublisher));
    });
  });
});
