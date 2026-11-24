import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { columnGeometry, niceMax, sparkGeometry, timelineLayout } from '../src/web/static/charts.js';

describe('client chart geometry', () => {
  it('niceMax picks round upper bounds', () => {
    assert.equal(niceMax(3680), 5000);
    assert.equal(niceMax(2), 2);
    assert.equal(niceMax(0), 1);
    assert.equal(niceMax(101), 200);
  });

  it('columns never exceed 24 px, sit on the baseline and keep inside the box', () => {
    const points = Array.from({ length: 48 }, (_, i) => ({ label: `14.10 ${String(i % 24).padStart(2, '0')}:00`, value: i === 47 ? 4587 : i > 44 ? 3000 : 0 }));
    const g = columnGeometry(points, { startAt: 45.5 });
    assert.equal(g.bars.length, 48);
    for (const b of g.bars) {
      assert.ok(b.w <= 24);
      assert.ok(b.y + b.h <= g.T + g.plotH + 1e-9, 'bar bottom at the baseline');
      assert.ok(b.bx >= g.L && b.bx + b.w <= g.W);
    }
    assert.equal(g.last, 47);
    assert.ok(g.marker !== null && g.marker > g.L);
    assert.equal(g.max, 5000);
    assert.equal(g.bars[0]!.h, 0);
    assert.equal(columnGeometry([{ label: 'a', value: 0 }]).rawMax, 0);
  });

  it('sparkline path spans the full width and stays inside the plot', () => {
    const g = sparkGeometry([80, 120, 179, 59, 100]);
    assert.ok(g);
    assert.ok(g.line.startsWith('M0,') && g.line.includes('L600,'));
    for (const m of g.line.matchAll(/[ML][\d.]+,([\d.]+)/g)) {
      const y = Number(m[1]);
      assert.ok(y >= 10 && y <= 110);
    }
    assert.equal(sparkGeometry([1]), null);
  });

  it('timeline stacks coincident versions upward and draws the silence bracket', () => {
    const t = Date.UTC(2020, 0, 1);
    const g = timelineLayout(
      [
        { version: '1.0.0', t, kind: 'pub0' },
        { version: '1.0.1', t: t + 1000, kind: 'pub0' },
        { version: '1.0.2', t: t + 2000, kind: 'removed' },
        { version: '2.0.0', t: t + 400 * 86_400_000, kind: 'event' },
      ],
      { from: t + 2000, to: t + 400 * 86_400_000, label: '400 days of silence' },
    );
    assert.ok(g);
    assert.equal(g.dots.length, 4);
    const ys = g.dots.filter((d) => d.kind !== 'event').map((d) => d.y);
    assert.equal(new Set(ys).size, 3, 'three coincident dots get three different rows');
    assert.equal(g.dots[g.dots.length - 1]!.kind, 'event', 'event dots are drawn last (on top)');
    assert.ok(g.bracket && g.bracket.label === '400 days of silence');
    assert.ok(g.ticks.length > 0);
    assert.equal(timelineLayout([]), null);
  });
});
