import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FeedError, parseChangesResponse } from '../src/collector/feed.ts';
import { backoffDelay } from '../src/lib/backoff.ts';

describe('parseChangesResponse', () => {
  it('parses a response in the real format', () => {
    const page = parseChangesResponse(
      {
        results: [
          { seq: 136844645, id: '@hyper.software/common-helpers', changes: [{ rev: '565-c7a2' }] },
          { seq: 136844647, id: '@tokamakdev/tok-win32-x64', changes: [{ rev: '62-167d' }] },
          { seq: 136844651, id: 'gone', changes: [{ rev: '3-aaaa' }], deleted: true },
        ],
        last_seq: 136844651,
      },
      136844600,
    );
    assert.equal(page.lastSeq, 136844651);
    assert.deepEqual(
      page.changes.map((c) => c.id),
      ['@hyper.software/common-helpers', '@tokamakdev/tok-win32-x64', 'gone'],
    );
    assert.equal(page.changes[0]!.rev, '565-c7a2');
    assert.deepEqual(page.changes.map((c) => c.deleted), [false, false, true]);
  });

  it('an empty page keeps the position', () => {
    assert.deepEqual(parseChangesResponse({ results: [], last_seq: 100 }, 100), { changes: [], lastSeq: 100 });
    assert.deepEqual(parseChangesResponse({ results: [] }, 100), { changes: [], lastSeq: 100 });
  });

  it('accepts seq as a digit string', () => {
    const page = parseChangesResponse({ results: [{ seq: '101', id: 'a', changes: [{ rev: '1-x' }] }], last_seq: '101' }, 100);
    assert.equal(page.changes[0]!.seq, 101);
  });

  it('rejects cursor rollback and unordered seq', () => {
    assert.throws(() => parseChangesResponse({ results: [], last_seq: 99 }, 100), FeedError);
    assert.throws(() => parseChangesResponse({ results: [{ seq: 100, id: 'a', changes: [] }] }, 100), FeedError);
    assert.throws(
      () => parseChangesResponse({ results: [{ seq: 102, id: 'a' }, { seq: 101, id: 'b' }], last_seq: 102 }, 100),
      FeedError,
    );
  });

  it('rejects a malformed response', () => {
    assert.throws(() => parseChangesResponse({ error: 'not_found' }, 0), FeedError);
    assert.throws(() => parseChangesResponse({ results: [{ seq: 1 }] }, 0), FeedError);
    assert.throws(() => parseChangesResponse({ results: [{ seq: 'abc', id: 'a' }] }, 0), FeedError);
  });
});

describe('backoffDelay', () => {
  it('grows exponentially and hits the cap', () => {
    const max = () => 0.999999;
    assert.equal(backoffDelay(0, 1000, 300_000, max), 999);
    assert.equal(backoffDelay(3, 1000, 300_000, max), 7999);
    assert.equal(backoffDelay(50, 1000, 300_000, max), 299_999);
    assert.equal(backoffDelay(5, 1000, 300_000, () => 0), 0);
  });
});
