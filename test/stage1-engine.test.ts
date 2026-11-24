import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type FeedEvent, type PrevInfo, prevFromEvent, Stage1Engine, type Stage1Result } from '../src/stage1/engine.ts';
import { NameIndex } from '../src/stage1/nominal.ts';
import { DEFAULT_PARAMS, engineId } from '../src/stage1/params.ts';

const T0 = Date.UTC(2026, 9, 14, 0, 0, 0);
const MIN = 60_000;

// Runs the stream through the engine, tracking package history like the worker does.
function run(engine: Stage1Engine, events: FeedEvent[]): Stage1Result[] {
  const prev = new Map<string, PrevInfo>();
  const out: Stage1Result[] = [];
  for (const e of events) {
    const r = engine.process(e, prev.get(e.package) ?? null);
    prev.set(e.package, prevFromEvent(e));
    if (r) out.push(r);
  }
  return out;
}

let seq = 1;
function ev(package_: string, rev: number, minute: number, opts: { imprecise?: boolean; deleted?: boolean } = {}): FeedEvent {
  const at = new Date(T0 + minute * MIN + (seq % 50) * 100);
  return {
    seq: seq++,
    package: package_,
    rev: `${rev}-abc`,
    deleted: opts.deleted ?? false,
    observedAt: at,
    observedAfter: opts.imprecise ? new Date(at.getTime() - 30 * MIN) : new Date(at.getTime() - 5000),
  };
}

// Benign background: one event per minute from different packages and scopes.
function background(fromMin: number, toMin: number): FeedEvent[] {
  const out: FeedEvent[] = [];
  for (let m = fromMin; m < toMin; m++) {
    out.push(ev(`@bg${m % 97}/pkg-${m}`, 3 + (m % 5), m));
    out.push(ev(`plain-${m % 211}-x`, 1 + Math.floor(m / 211), m));
  }
  return out;
}

const names = new NameIndex(['lodash', 'react', 'node-ipc'].map((name, i) => ({ name, rank: i + 1 })));
const ids = (r: Stage1Result | undefined) => r?.features.map((f) => f.id).sort() ?? [];

describe('Stage1Engine', () => {
  it('the engine identifier depends on the parameters', () => {
    assert.notEqual(engineId(DEFAULT_PARAMS), engineId({ ...DEFAULT_PARAMS, candidateThreshold: 3 }));
  });

  it('a burst of updates of a mature package against the background is a candidate (node-ipc: three versions at once)', () => {
    const engine = new Stage1Engine(DEFAULT_PARAMS, null, new Date(T0));
    const events = [...background(0, 420), ev('quiet-lib', 40, 10)];
    events.push(ev('quiet-lib', 41, 420), ev('quiet-lib', 42, 420), ev('quiet-lib', 43, 420));
    const results = run(engine, events);
    const last = results.at(-1)!;
    assert.equal(last.package, 'quiet-lib');
    assert.ok(ids(last).includes('rate_package'), ids(last).join());
    assert.ok(last.candidate);
  });

  it('updates merged into one event: revision jump and a burst by increments', () => {
    const engine = new Stage1Engine(DEFAULT_PARAMS, null, new Date(T0));
    const results = run(engine, [...background(0, 420), ev('quiet-lib', 40, 10), ev('quiet-lib', 43, 420)]);
    const last = results.at(-1)!;
    assert.deepEqual(ids(last), ['rate_package', 'rev_jump']);
    assert.ok(last.candidate);
  });

  it('an event with an unreliable time does not enter the temporal lane', () => {
    const engine = new Stage1Engine(DEFAULT_PARAMS, null, new Date(T0));
    const tail = [ev('quiet-lib', 41, 420, { imprecise: true }), ev('quiet-lib', 42, 420, { imprecise: true }), ev('quiet-lib', 43, 420, { imprecise: true })];
    const results = run(engine, [...background(0, 420), ev('quiet-lib', 40, 10), ...tail]);
    assert.deepEqual(ids(results.at(-1)), []);
  });

  it('the temporal lane stays silent until the baseline accumulates', () => {
    const engine = new Stage1Engine(DEFAULT_PARAMS, null, new Date(T0));
    const results = run(engine, [ev('x-lib', 40, 1), ev('x-lib', 41, 1), ev('x-lib', 42, 1), ev('x-lib', 43, 1)]);
    assert.ok(results.every((r) => !r.features.some((f) => f.lane === 'temporal')));
  });

  it('package re-created after deletion, and a revision rollback', () => {
    const engine = new Stage1Engine(DEFAULT_PARAMS, null, new Date(T0));
    const results = run(engine, [ev('gone', 50, 1), ev('gone', 51, 2, { deleted: true }), ev('gone', 1, 3), ev('other', 30, 4), ev('other', 2, 5)]);
    assert.equal(results[2]!.features[0]!.value, 'recreated');
    assert.equal(results[4]!.features.find((f) => f.id === 'rev_regression')!.value, '30→2');
  });

  it('a new package with a look-alike of a popular name is a candidate; the popular one itself goes to the watchlist', () => {
    const engine = new Stage1Engine(DEFAULT_PARAMS, names, new Date(T0));
    const [squat, plainNew, popular] = run(engine, [ev('l0dash', 1, 1), ev('brand-new-thing', 1, 1), ev('react', 900, 1)]);
    assert.deepEqual(ids(squat), ['name_homoglyph', 'new_package']);
    assert.ok(squat!.candidate);
    assert.deepEqual(ids(plainNew), ['new_package']);
    assert.ok(!plainNew!.candidate);
    assert.deepEqual(ids(popular), ['watchlist']);
    assert.ok(popular!.candidate);
  });

  it('worm: mature packages wake up in dozens of unrelated namespaces — breadth', () => {
    const engine = new Stage1Engine(DEFAULT_PARAMS, null, new Date(T0));
    const wave: FeedEvent[] = [];
    for (let i = 0; i < 40; i++) wave.push(ev(`@victim${i}/lib`, 25 + i, 1500 + Math.floor(i / 8)));
    const results = run(engine, [...background(0, 1500), ...wave]);
    const flagged = results.filter((r) => r.features.some((f) => f.id === 'breadth_mature'));
    assert.ok(flagged.length >= 20, `breadth flagged ${flagged.length}`);
    assert.ok(flagged.every((r) => r.package.startsWith('@victim')));
  });

  it('determinism: a replay yields the same results', () => {
    const stream = [...background(0, 200), ev('quiet-lib', 40, 10), ev('quiet-lib', 43, 200)];
    const a = run(new Stage1Engine(DEFAULT_PARAMS, names, new Date(T0)), stream);
    const b = run(new Stage1Engine(DEFAULT_PARAMS, names, new Date(T0)), stream);
    assert.deepEqual(a, b);
  });
});
