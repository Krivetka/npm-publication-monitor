import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { featureCatalogue, laneOf } from '../src/api/catalogue.ts';
import { openapi } from '../src/api/openapi.ts';
import { checkBearer } from '../src/api/router.ts';
import { healthFrom, toEvent, toStatus } from '../src/api/serialize.ts';
import { contentType, resolveUnder, resolveVendor, VENDOR_PACKAGES } from '../src/api/static.ts';
import { ApiError, boolParam, findingBody, intParam, listParams, numberParam, packageParam, seqParam } from '../src/api/validate.ts';
import { eventMessage, helloMessage, parseSeqList, stage1Message, stage2Message, statusMessage } from '../src/api/ws.ts';
import { monthPartition } from '../src/collector/store.ts';
import { chunkSeqs } from '../src/stage1/store.ts';
import { maintainersOf, setDiff } from '../src/stage2/store.ts';
import { FEATURE_LABELS } from '../src/web/labels.ts';
import type { Status } from '../src/web/queries.ts';

const sp = (s: string) => new URLSearchParams(s);
const throwsApi = (fn: () => unknown, status: number) =>
  assert.throws(fn, (e: unknown) => e instanceof ApiError && e.status === status, `expected ApiError ${status}`);

describe('OpenAPI description', () => {
  const doc = openapi as unknown as { paths: Record<string, Record<string, { operationId?: string; responses: Record<string, unknown> }>>; components: { schemas: Record<string, unknown> } };

  it('every operation has an operationId and a success response', () => {
    const ids = new Set<string>();
    for (const [path, ops] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        assert.ok(op.operationId, `${method} ${path} has no operationId`);
        assert.ok(!ids.has(op.operationId!), `duplicate operationId ${op.operationId}`);
        ids.add(op.operationId!);
        assert.ok(Object.keys(op.responses).some((c) => c.startsWith('2')), `${method} ${path} has no 2xx response`);
      }
    }
    assert.ok(ids.size >= 15);
  });

  it('every $ref resolves to a component schema', () => {
    const refs = new Set<string>();
    JSON.stringify(doc, (k, v) => {
      if (k === '$ref' && typeof v === 'string') refs.add(v);
      return v;
    });
    assert.ok(refs.size > 0);
    for (const r of refs) {
      const m = /^#\/components\/schemas\/(\w+)$/.exec(r);
      assert.ok(m && doc.components.schemas[m[1]!], `unresolved ${r}`);
    }
  });
});

describe('request validation', () => {
  it('integers with bounds and defaults', () => {
    assert.equal(intParam(sp('limit=20'), 'limit', { min: 1, max: 500, def: 100 }), 20);
    assert.equal(intParam(sp(''), 'limit', { def: 100 }), 100);
    throwsApi(() => intParam(sp('limit=0'), 'limit', { min: 1 }), 400);
    throwsApi(() => intParam(sp('limit=abc'), 'limit'), 400);
    throwsApi(() => intParam(sp('limit=99999999999999999999'), 'limit'), 400);
  });

  it('list params: before/after exclusive, limit capped', () => {
    assert.deepEqual(listParams(sp('before=100&limit=5')), { before: 100, after: undefined, limit: 5 });
    assert.deepEqual(listParams(sp('')), { before: undefined, after: undefined, limit: 100 });
    throwsApi(() => listParams(sp('before=1&after=2')), 400);
    throwsApi(() => listParams(sp('limit=501')), 400);
  });

  it('booleans, numbers, seq and package names', () => {
    assert.equal(boolParam(sp('alert=1'), 'alert'), true);
    assert.equal(boolParam(sp('alert=false'), 'alert'), false);
    throwsApi(() => boolParam(sp('alert=yes'), 'alert'), 400);
    assert.equal(numberParam(sp('min_score=2,5'), 'min_score'), 2.5);
    assert.equal(seqParam('136858469'), 136858469);
    throwsApi(() => seqParam('-1'), 400);
    assert.equal(packageParam('%40scope%2Fname'), '@scope/name');
    assert.equal(packageParam('lodash'), 'lodash');
    throwsApi(() => packageParam('Lodash'), 400);
    throwsApi(() => packageParam('..%2Fetc'), 400);
  });

  it('finding body', () => {
    assert.deepEqual(findingBody({ verdict: 'confirmed', note: 'x', reference: 'GHSA-1' }), { verdict: 'confirmed', note: 'x', reference: 'GHSA-1' });
    assert.deepEqual(findingBody({ verdict: 'undecided' }), { verdict: 'undecided', note: null, reference: null });
    throwsApi(() => findingBody({ verdict: 'maybe' }), 400);
    throwsApi(() => findingBody({ verdict: 'confirmed', note: 'x'.repeat(2001) }), 400);
    throwsApi(() => findingBody([]), 400);
  });

  it('bearer token check is exact', () => {
    assert.ok(checkBearer('Bearer s3cret', 's3cret'));
    assert.ok(checkBearer('bearer s3cret', 's3cret'));
    assert.ok(!checkBearer('Bearer s3cre', 's3cret'));
    assert.ok(!checkBearer('Bearer s3cret', null));
    assert.ok(!checkBearer(undefined, 's3cret'));
    assert.ok(!checkBearer('Basic s3cret', 's3cret'));
  });
});

describe('serialisation', () => {
  const base = {
    seq: '136858469', package: 'playwright-core', rev: '5730-abc', deleted: false,
    observed_at: new Date('2026-10-14T11:55:10Z'), observed_after: new Date('2026-10-14T11:55:04Z'),
    s1_prescore: null, s1_candidate: null, s1_features: null, s1_engine: null,
    s2_kind: null, s2_versions: null, s2_prescore: null, s2_final_score: null, s2_alert: null, s2_features: null, s2_enriched_at: null, s2_engine: null,
    f_verdict: null, f_note: null, f_reference: null, f_decided_at: null,
  };

  it('event with no stage results', () => {
    const e = toEvent(base);
    assert.equal(e.seq, 136858469);
    assert.equal(e.observed_at, '2026-10-14T11:55:10.000Z');
    assert.equal(e.stage1, null);
    assert.equal(e.stage2, null);
    assert.equal(e.finding, null);
  });

  it('event with both stages and a finding', () => {
    const e = toEvent({
      ...base,
      s1_prescore: 0, s1_candidate: true, s1_features: [{ id: 'watchlist', lane: 'watchlist', weight: 0, value: 384 }], s1_engine: 'v1',
      s2_kind: 'publish', s2_versions: ['1.64.1'], s2_prescore: 0, s2_final_score: 0, s2_alert: false, s2_features: [], s2_enriched_at: new Date('2026-10-14T12:27:13Z'), s2_engine: 'v1',
      f_verdict: 'false_positive', f_note: null, f_reference: 'manual', f_decided_at: new Date('2026-10-14T13:00:00Z'),
    });
    assert.equal(e.stage1?.candidate, true);
    assert.deepEqual(e.stage2?.versions, ['1.64.1']);
    assert.equal(e.stage2?.enriched_at, '2026-10-14T12:27:13.000Z');
    assert.deepEqual(e.finding, { seq: 136858469, verdict: 'false_positive', reference: 'manual', decided_at: '2026-10-14T13:00:00.000Z' });
  });

  const status: Status = {
    collector: { lastSeq: 100, headSeq: 110, polledAt: new Date(Date.now() - 20_000), advancedAt: new Date() },
    stage1: { lastSeq: 90, updatedAt: new Date(), lag: 10 },
    stage2: { queue: 3, lastAt: null },
    popular: { snapshot: '2026-10-14', names: 10000 },
    journal: { first: null, estimate: 7748 },
  };

  it('status in snake_case with lag', () => {
    const s = toStatus(status);
    assert.equal(s.collector?.lag, 10);
    assert.equal(s.stage1?.last_seq, 90);
    assert.equal(s.stage2.last_at, null);
    assert.match(s.now, /^\d{4}-/);
  });

  it('health: collector stale or stage 1 far behind → not ok; stage 2 informational', () => {
    assert.equal(healthFrom(status).ok, true);
    assert.equal(healthFrom({ ...status, collector: { ...status.collector!, polledAt: new Date(Date.now() - 400_000) } }).ok, false);
    assert.equal(healthFrom({ ...status, stage1: { ...status.stage1!, lag: 6000 } }).ok, false);
    const h = healthFrom({ ...status, stage2: { queue: 900, lastAt: null } });
    assert.equal(h.ok, true);
    assert.equal(h.checks.stage2!.ok, false);
    assert.equal(healthFrom({ ...status, collector: null }).checks.collector!.detail, 'never polled');
  });
});

describe('feature catalogue', () => {
  it('covers every labelled feature with a lane and a weight', () => {
    const cat = featureCatalogue();
    const ids = new Set(cat.map((f) => f.id));
    for (const id of Object.keys(FEATURE_LABELS)) assert.ok(ids.has(id), `${id} missing from catalogue`);
    for (const f of cat) {
      assert.ok(FEATURE_LABELS[f.id], `${f.id} has no label`);
      assert.ok(typeof f.weight === 'number', `${f.id} weight`);
      assert.ok(f.lane.length > 0);
    }
    assert.equal(cat.find((f) => f.id === 'name_homoglyph')?.weight, 2);
    assert.equal(cat.find((f) => f.id === 'publisher_new')?.weight, 3);
    assert.equal(laneOf('rate_scope'), 'temporal');
    assert.equal(laneOf('name_edit'), 'nominal');
    assert.equal(laneOf('git_head_unknown'), 'repository');
  });
});

describe('static file resolution', () => {
  const root = process.platform === 'win32' ? 'C:\\srv\\static' : '/srv/static';
  it('stays under the root', () => {
    assert.ok(resolveUnder(root, 'index.html')!.endsWith('index.html'));
    assert.ok(resolveUnder(root, 'js/app.js')!.includes('static'));
    assert.equal(resolveUnder(root, '../secret'), null);
    assert.equal(resolveUnder(root, 'a/../../secret'), null);
    assert.equal(resolveUnder(root, '/etc/passwd'), null);
    assert.equal(resolveUnder(root, 'a\\..\\b'), null);
    assert.equal(resolveUnder(root, 'a\0b'), null);
    assert.equal(resolveUnder(root, 'a//b'), null);
  });

  it('vendor whitelist by package and extension', () => {
    assert.deepEqual([...VENDOR_PACKAGES], ['preact', 'htm', 'swagger-ui-dist']);
    assert.ok(resolveVendor('preact', 'dist/preact.mjs')!.endsWith('preact.mjs'));
    assert.equal(resolveVendor('preact', 'package.json'), null);
    assert.equal(resolveVendor('postgres', 'src/index.js'), null);
    assert.equal(resolveVendor('preact', '../postgres/src/index.js'), null);
    assert.equal(contentType('x.mjs'), 'text/javascript; charset=utf-8');
    assert.equal(contentType('x.svg'), 'image/svg+xml');
    assert.equal(contentType('x.bin'), 'application/octet-stream');
  });
});

describe('realtime messages', () => {
  it('builders and payload parsing', () => {
    assert.deepEqual(helloMessage(5), { type: 'hello', last_seq: 5 });
    assert.equal(eventMessage({ seq: 1 } as never).type, 'event');
    assert.equal(stage1Message(1, { prescore: 0, candidate: false, features: [], engine: 'v1' }).seq, 1);
    assert.equal(stage2Message(1, { kind: 'publish', versions: [], prescore: 0, final_score: 0, alert: false, features: [], enriched_at: '', engine: '' }).type, 'stage2');
    assert.equal(statusMessage({} as never).type, 'status');
    assert.deepEqual(parseSeqList('[1,2,3]'), [1, 2, 3]);
    assert.deepEqual(parseSeqList('42'), [42]);
    assert.deepEqual(parseSeqList('nonsense'), []);
    assert.deepEqual(parseSeqList('[1,"x",-2]'), [1]);
  });

  it('stage-1 notify payloads stay under the limit', () => {
    const seqs = Array.from({ length: 2000 }, (_, i) => 136_000_000 + i);
    const chunks = chunkSeqs(seqs);
    assert.ok(chunks.length > 1);
    assert.deepEqual(chunks.flat(), seqs);
    for (const c of chunks) assert.ok(JSON.stringify(c).length <= 7000);
    assert.deepEqual(chunkSeqs([]), []);
  });
});

describe('journal partitions and maintainer history', () => {
  it('monthly partition bounds in UTC', () => {
    assert.deepEqual(monthPartition(new Date('2026-10-14T12:00:00Z')), { name: 'feed_event_202610', from: '2026-10-01', to: '2026-11-01' });
    assert.deepEqual(monthPartition(new Date('2026-12-31T23:59:59Z'), 1), { name: 'feed_event_202701', from: '2027-01-01', to: '2027-02-01' });
  });

  it('maintainer set diff', () => {
    assert.deepEqual(setDiff(null, ['a', 'b']), { added: ['a', 'b'], removed: [], changed: true });
    assert.deepEqual(setDiff(['a', 'b'], ['a', 'b']), { added: [], removed: [], changed: false });
    assert.deepEqual(setDiff(['a', 'b'], ['b', 'c']), { added: ['c'], removed: ['a'], changed: true });
    const o = { evidence: { registry: { maintainers: ['zed', 'amy', 'amy'] } } } as never;
    assert.deepEqual(maintainersOf(o), ['amy', 'zed']);
    assert.equal(maintainersOf({ evidence: {} } as never), null);
  });
});
