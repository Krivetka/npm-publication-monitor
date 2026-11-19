import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Feature } from '../src/lib/feature.ts';
import { STAGE2_WEIGHTS, STAGE2_PARAMS } from '../src/stage2/params.ts';
import { analyzeRegistry } from '../src/stage2/registry.ts';
import type { Packument } from '../src/stage2/types.ts';
import { columnChart, niceMax, versionTimeline } from '../src/web/chart.ts';
import { html, qs } from '../src/web/html.ts';
import { FEATURE_LABELS } from '../src/web/labels.ts';
import { eventPage, featureValue, flaggedPage, overviewPage } from '../src/web/pages.ts';
import type { EventCard, Status, Totals } from '../src/web/queries.ts';

const ctx = { base: '/npm' };
const EVIL = '<img src=x onerror=alert(1)>';

describe('templates', () => {
  it('escape values and pass nested templates through', () => {
    const inner = html`<i>${'a&b'}</i>`;
    assert.equal(html`<b title="${'"x"'}">${EVIL}${inner}${null}${false}${[1, 2]}</b>`.value,
      '<b title="&quot;x&quot;">&lt;img src=x onerror=alert(1)&gt;<i>a&amp;b</i>12</b>');
    assert.equal(qs({ name: '@scope/pkg', page: 2, empty: '', no: null }), '?name=%40scope%2Fpkg&page=2');
  });
});

describe('feature labels', () => {
  it('exist for every feature of both stages', () => {
    const stage1 = ['rate_global', 'rate_package', 'rate_scope', 'rate_cluster', 'breadth_mature', 'rev_jump', 'rev_regression', 'dormant_awake', 'new_package', 'watchlist',
      'name_homoglyph', 'name_scope_typo', 'name_transposition', 'name_keyboard', 'name_separator', 'name_edit', 'name_reorder', 'name_affix'];
    for (const id of [...stage1, ...Object.keys(STAGE2_WEIGHTS)]) assert.ok(FEATURE_LABELS[id], `no label for ${id}`);
  });

  it('feature values in short form', () => {
    const f = (id: string, value: Feature['value']): Feature => ({ id, lane: 'x', weight: 1, value });
    assert.equal(featureValue(f('name_keyboard', 'clone')), '→ clone');
    assert.equal(featureValue(f('rev_jump', 4)), '+4');
    assert.equal(featureValue(f('watchlist', 756)), '#756');
    assert.equal(featureValue(f('rate_package', 2.97)), 'z 2.97');
    assert.equal(featureValue(f('deps_added', ['a', 'b'])), 'a, b');
  });
});

describe('charts', () => {
  it('niceMax', () => {
    assert.equal(niceMax(3680), 5000);
    assert.equal(niceMax(2), 2);
    assert.equal(niceMax(0), 1);
  });

  it('columns: tooltips are escaped, an empty series is labelled', () => {
    const out = columnChart('T', [{ label: EVIL, value: 3 }, { label: 'b', value: 0 }]).value;
    assert.ok(!out.includes('<img'));
    assert.match(out, /class="bar"/);
    assert.match(columnChart('T', [{ label: 'a', value: 0 }]).value, /none in 48 hours/);
  });

  it('version timeline: events on top, with their own class', () => {
    const t = Date.UTC(2020, 0, 1);
    const out = versionTimeline(
      [
        { version: '1.0.0', t, kind: 'pub0' },
        { version: '1.0.1', t: t + 1000, kind: 'pub0' },
        { version: '2.0.0', t: t + 400 * 86_400_000, kind: 'event' },
      ],
      { from: t + 1000, to: t + 400 * 86_400_000, label: '400 days of silence' },
      'timeline',
    ).value;
    assert.equal(out.match(/<circle/g)?.length, 3);
    assert.match(out, /class="dot event"/);
    assert.match(out, /400 days of silence/);
  });
});

const status: Status = {
  collector: { lastSeq: 10, headSeq: 12, polledAt: new Date(), advancedAt: new Date() },
  stage1: { lastSeq: 10, updatedAt: new Date(), lag: 0 },
  stage2: { queue: 0, lastAt: new Date() },
  popular: { snapshot: '2026-10-14', names: 10000 },
  journal: { first: new Date(Date.now() - 3 * 3_600_000), estimate: 7748 },
};
const totals: Totals = { events: 7748, processed: 7740, flagged: 589, candidates: 2, enriched: 2, alerts: 0 };

describe('pages', () => {
  it('the overview renders both on empty data and on data', () => {
    const empty = overviewPage(ctx, { status, totals: { ...totals, processed: 0, flagged: 0, candidates: 0, enriched: 0 }, hours: [], pulse: [], usage: [], features: [], alerts: [], recent: [] });
    assert.match(empty, /No alerts yet/);
    const hours = Array.from({ length: 48 }, (_, i) => ({ hour: new Date(Date.now() - (47 - i) * 3_600_000), processed: i > 44 ? 3000 : 0, candidates: i === 46 ? 2 : 0, enriched: 0, alerts: 0 }));
    const pulse = Array.from({ length: 60 }, (_, i) => ({ minute: new Date(Date.now() - (60 - i) * 60_000), n: 80 + (i % 7) * 10 }));
    const page = overviewPage(ctx, {
      status, totals, hours, pulse,
      usage: [{ source: 'registry', requests: 2, errors: 0, skipped: 0 }],
      features: [{ stage: 1, id: 'new_package', count: 573 }, { stage: 1, id: 'name_keyboard', count: 1 }],
      alerts: [],
      recent: [{ seq: '5', package: EVIL, event_time: new Date(), versions: ['1.0.0'], kind: 'publish', prescore: 0, final_score: 0, alert: false, features: [], stage1: [{ id: 'watchlist', lane: 'watchlist', weight: 0, value: 384 }] }],
    });
    assert.ok(!page.includes('<img src=x'));
    assert.match(page, /99\.97% cut of the feed/);
    assert.match(page, /≈ 7,740 requests <span>instead of 2<\/span>/);
  });

  it('stage 1: feature filters', () => {
    const page = flaggedPage(ctx, [{ seq: '1', package: 'cline', event_time: new Date(), prescore: 1.5, candidate: false, features: [{ id: 'name_keyboard', lane: 'nominal', weight: 1.5, value: 'clone' }], final_score: null, alert: null }],
      [{ stage: 1, id: 'name_keyboard', count: 1 }], { feature: 'name_keyboard', candidateOnly: false, page: 1, pageSize: 50 });
    assert.match(page, /→ clone/);
    assert.match(page, /aria-current="true">.*Look-alike name: adjacent key/s);
  });

  it('node-ipc card: verdict, score bar and version timeline from the real analysis', () => {
    const owner = { name: 'riaevangelist', email: 'b@diginow.it' };
    const mal = { name: 'mallory', email: 'm@fresh.dev' };
    const m = (v: string, u = owner) => ({ version: v, _npmUser: u, maintainers: [owner], dist: { unpackedSize: 118_929, fileCount: 23 } });
    const pack: Packument = {
      name: 'node-ipc',
      versions: { '9.2.1': m('9.2.1'), '10.0.0': m('10.0.0'), '12.0.0': m('12.0.0'), '12.0.1': m('12.0.1', mal) },
      time: { '9.2.1': '2021-03-10T00:00:00Z', '10.0.0': '2021-06-10T00:00:00Z', '9.2.2': '2022-03-15T05:40:26Z', '12.0.0': '2024-08-12T16:28:35Z', '12.0.1': '2026-05-14T14:25:30Z', '9.2.3': '2026-05-14T14:26:01Z' },
      maintainers: [owner],
    };
    const t = Date.parse('2026-05-14T14:25:30Z');
    const reg = analyzeRegistry(pack, { from: t - 5000, to: t + 5000 }, STAGE2_PARAMS);
    const rate: Feature = { id: 'rate_package', lane: 'temporal', weight: 2, value: 2.97, threshold: 2.5, detail: { count: 3, mean: 0.03, std: 0.18 } };
    const card: EventCard = {
      event: { seq: '136', package: 'node-ipc', rev: '83-abc', deleted: false, observed_at: new Date(t + 4000), observed_after: new Date(t - 1000) },
      stage1: { prescore: 2, candidate: true, features: [rate], engine: 'v1' },
      stage2: {
        enriched_at: new Date(t + 70_000), kind: 'publish', versions: reg.versions, prescore: 2,
        final_score: 2 + reg.features.reduce((a, x) => a + x.weight, 0), alert: true,
        features: reg.features, evidence: { registry: reg.evidence }, sources: { registry: { status: 200 }, github_commit: { skipped: 'quota' } }, engine: 'v1',
      },
    };
    const page = eventPage(ctx, card, []);
    assert.match(page, /Alert/);
    assert.match(page, /class="seg s1"/);
    assert.match(page, /class="seg s2"/);
    assert.match(page, /Package version history/);
    assert.match(page, /class="dot event"/);
    assert.match(page, /class="dot removed"/);
    assert.match(page, /days of silence/);
    assert.match(page, /skipped: quota/);
  });
});
