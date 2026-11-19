import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildQuery, matchRoute, parseQuery } from '../src/web/static/router.js';

describe('SPA router', () => {
  it('matches every route under the base path', () => {
    assert.deepEqual(matchRoute('/npm/', '/npm'), { name: 'overview', params: {} });
    assert.deepEqual(matchRoute('/npm', '/npm'), { name: 'overview', params: {} });
    assert.deepEqual(matchRoute('/npm/feed', '/npm'), { name: 'feed', params: {} });
    assert.deepEqual(matchRoute('/npm/alerts/', '/npm'), { name: 'alerts', params: {} });
    assert.deepEqual(matchRoute('/npm/event/136858469', '/npm'), { name: 'event', params: { seq: '136858469' } });
    assert.deepEqual(matchRoute('/npm/package/%40scope%2Fname', '/npm'), { name: 'package', params: { name: '@scope/name' } });
    assert.deepEqual(matchRoute('/npm/stats', '/npm'), { name: 'stats', params: {} });
  });

  it('rejects unknown and malformed paths', () => {
    assert.equal(matchRoute('/npm/nothing', '/npm').name, 'notfound');
    assert.equal(matchRoute('/npm/event/', '/npm').name, 'notfound');
    assert.equal(matchRoute('/npm/event/1/extra', '/npm').name, 'notfound');
    assert.equal(matchRoute('/other/feed', '/npm').name, 'notfound');
    assert.equal(matchRoute('/npm/package/%E0%A4%A', '/npm').params.name, '%E0%A4%A'); // bad escape kept verbatim
  });

  it('works without a base path', () => {
    assert.equal(matchRoute('/feed').name, 'feed');
    assert.equal(matchRoute('/').name, 'overview');
  });

  it('round-trips query strings and drops empty values', () => {
    assert.deepEqual(parseQuery('?feature=rev_jump&candidate=1&empty='), { feature: 'rev_jump', candidate: '1' });
    assert.equal(buildQuery({ feature: 'rev_jump', candidate: null, before: 0, page: '' }), '?feature=rev_jump&before=0');
    assert.equal(buildQuery({}), '');
    assert.equal(buildQuery({ package: '@scope/pkg' }), '?package=%40scope%2Fpkg');
  });
});
