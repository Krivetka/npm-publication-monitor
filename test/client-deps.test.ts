import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError, dependencyQuery } from '../src/api/validate.ts';
import { parseDependencyList } from '../src/web/static/deps.js';

describe('dependency list of a consumer', () => {
  it('reads a lock file of version 2 or 3: nested and scoped paths, links and the root skipped', () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { name: 'app' },
        'node_modules/lodash': { version: '4.17.21' },
        'node_modules/@scope/b': { version: '1.0.0' },
        'node_modules/a/node_modules/@scope/c': { version: '2.0.0' },
        'node_modules/alias': { name: 'real-name', version: '1.0.0' },
        'packages/local': { link: true },
      },
    };
    assert.deepEqual(parseDependencyList(JSON.stringify(lock)), ['@scope/b', '@scope/c', 'lodash', 'real-name']);
  });

  it('reads a lock file of version 1 with nested dependencies', () => {
    const lock = { lockfileVersion: 1, dependencies: { a: { version: '1.0.0', dependencies: { b: { version: '1.0.0' } } }, '@s/c': { version: '1.0.0' } } };
    assert.deepEqual(parseDependencyList(JSON.stringify(lock)), ['@s/c', 'a', 'b']);
  });

  it('reads a package.json: all four dependency fields', () => {
    const pkg = { dependencies: { a: '^1' }, devDependencies: { b: '^1' }, optionalDependencies: { c: '^1' }, peerDependencies: { a: '^1', d: '*' } };
    assert.deepEqual(parseDependencyList(JSON.stringify(pkg)), ['a', 'b', 'c', 'd']);
  });

  it('reads plain lines: versions, bullets and comments dropped, duplicates merged', () => {
    assert.deepEqual(parseDependencyList('lodash@4.17.21\n- @scope/name@1.0.0\nchalk  # colours\nlodash\n\n'), ['@scope/name', 'chalk', 'lodash']);
  });

  it('gives an empty list for broken or empty input', () => {
    assert.deepEqual(parseDependencyList('{ not json'), []);
    assert.deepEqual(parseDependencyList(''), []);
    assert.deepEqual(parseDependencyList('{}'), []);
  });
});

describe('dependency query of the API', () => {
  const throwsApi = (fn: () => unknown, status: number) => assert.throws(fn, (e: unknown) => e instanceof ApiError && e.status === status);

  it('accepts a list of names, merges duplicates and applies the default period', () => {
    assert.deepEqual(dependencyQuery({ packages: ['b', 'a', 'b'] }), { packages: ['b', 'a'], days: 14 });
    assert.deepEqual(dependencyQuery({ packages: ['a'], days: 30 }), { packages: ['a'], days: 30 });
  });

  it('rejects a missing, empty or oversized list and a wrong period', () => {
    throwsApi(() => dependencyQuery(null), 400);
    throwsApi(() => dependencyQuery({ packages: [] }), 400);
    throwsApi(() => dependencyQuery({ packages: 'lodash' }), 400);
    throwsApi(() => dependencyQuery({ packages: ['a', 5] }), 400);
    throwsApi(() => dependencyQuery({ packages: ['x'.repeat(215)] }), 400);
    throwsApi(() => dependencyQuery({ packages: Array.from({ length: 10_001 }, (_, i) => `p${i}`) }), 400);
    throwsApi(() => dependencyQuery({ packages: ['a'], days: 0 }), 400);
    throwsApi(() => dependencyQuery({ packages: ['a'], days: 91 }), 400);
  });
});
