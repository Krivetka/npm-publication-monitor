import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseName, revNumber } from '../src/stage1/names.ts';
import { editKind, homoglyphKey, keyboardAdjacent, NameIndex } from '../src/stage1/nominal.ts';
import { WindowRate } from '../src/stage1/rate.ts';

describe('parseName', () => {
  it('scope, base name, namespace and cluster', () => {
    assert.deepEqual(parseName('@TokamakDev/tok-win32-x64'), {
      scope: 'tokamakdev',
      base: 'tok-win32-x64',
      namespace: '@tokamakdev',
      cluster: 'tok',
    });
    assert.deepEqual(parseName('eslint-plugin-foo'), { scope: null, base: 'eslint-plugin-foo', namespace: 'eslint', cluster: 'eslint' });
    assert.deepEqual(parseName('ms'), { scope: null, base: 'ms', namespace: 'ms', cluster: null });
  });

  it('revision number', () => {
    assert.equal(revNumber('273-bbb8b1fb'), 273);
    assert.equal(revNumber('garbage'), null);
  });
});

describe('WindowRate', () => {
  it('no baseline without history windows', () => {
    const r = new WindowRate(10, 1440, 1);
    r.add('k', 1000, 5);
    assert.equal(r.stats('k', 1000, 1000).windows, 0);
  });

  it('z against a baseline of non-overlapping windows, with the std floor', () => {
    const r = new WindowRate(10, 60, 1);
    // baseline: 2 events in each of 6 windows → mean 2, std 0 → denominator 1
    for (let w = 0; w < 6; w++) r.add('k', 100 + w * 10, 2);
    r.add('k', 165, 7);
    const s = r.stats('k', 169, 0);
    assert.equal(s.windows, 6);
    assert.equal(s.current, 7);
    assert.equal(s.mean, 2);
    assert.equal(s.std, 0);
    assert.equal(s.z, 5);
  });

  it('windows before the journal start are not counted', () => {
    const r = new WindowRate(10, 1440, 1);
    r.add('k', 130, 1);
    assert.equal(r.stats('k', 150, 100).windows, 4);
  });

  it('prune removes stale keys', () => {
    const r = new WindowRate(10, 60, 1);
    r.add('old', 0, 1);
    r.add('new', 100, 1);
    r.prune(100);
    assert.equal(r.size, 1);
  });
});

describe('nominal lane', () => {
  it('editKind distinguishes transposition, adjacent key and edit', () => {
    assert.equal(editKind('electorn', 'electron'), 'transposition');
    assert.equal(editKind('reacr', 'react'), 'keyboard');
    assert.equal(editKind('reacq', 'react'), 'edit');
    assert.equal(editKind('requst', 'request'), 'edit');
    assert.equal(editKind('expresss', 'express'), 'edit');
    assert.equal(editKind('abcd', 'badc'), null);
  });

  it('key adjacency and homoglyphs', () => {
    assert.ok(keyboardAdjacent('s', 'e'));
    assert.ok(!keyboardAdjacent('s', 'q'));
    assert.equal(homoglyphKey('l0dash'), homoglyphKey('lodash'));
    assert.equal(homoglyphKey('rnoment'), homoglyphKey('moment'));
  });

  const index = new NameIndex(
    ['lodash', 'react', 'electron', 'request', 'cross-env', 'node-fetch', 'moment', 'ms', 'ws', '@babel/core', '@typescript-eslint/parser'].map(
      (name, i) => ({ name, rank: i + 1 }),
    ),
  );

  it('finds the typosquatting kinds', () => {
    const kind = (n: string) => index.match(n)?.kind ?? null;
    assert.deepEqual(index.match('l0dash'), { kind: 'homoglyph', target: 'lodash', targetRank: 1 });
    assert.equal(kind('electorn'), 'transposition');
    assert.equal(kind('reacr'), 'keyboard');
    assert.equal(kind('requst'), 'edit');
    assert.equal(kind('crossenv'), 'separator');
    assert.equal(kind('env-cross'), 'reorder');
    assert.equal(kind('lodash-js'), 'affix');
    assert.deepEqual(index.match('@typescript_eslint/parser'), {
      kind: 'scope_typo',
      target: '@typescript-eslint/parser',
      targetRank: 11,
      via: 'separator',
    });
    assert.equal(index.match('@bable/core')?.kind, 'scope_typo');
  });

  it('does not fire on the popular package itself, short names and foreign scopes', () => {
    assert.equal(index.match('lodash'), null);
    assert.equal(index.match('LoDash'), null);
    assert.equal(index.match('qs'), null); // ms/ws are below the minimum length
    assert.equal(index.match('@babel/coer'), null); // nothing can be substituted inside a real scope
    assert.equal(index.match('@acme/core'), null);
    assert.equal(index.match('totally-unrelated'), null);
    assert.equal(index.rank('React'), 2);
  });
});
