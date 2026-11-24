import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { windowRange } from '../src/web/static/virtual-list.js';

describe('virtual list window math', () => {
  it('renders only the visible rows plus overscan', () => {
    // 50 000 rows of 56 px, viewport 600 px, scrolled to row 1000
    const w = windowRange(1000 * 56, 600, 56, 50_000, 6);
    assert.equal(w.start, 994);
    assert.equal(w.end, 1000 + Math.ceil(600 / 56) + 1 + 6);
    assert.equal(w.offsetTop, 994 * 56);
    assert.equal(w.totalHeight, 50_000 * 56);
    assert.ok(w.end - w.start < 30, 'DOM holds a few dozen rows, not thousands');
  });

  it('clamps at both ends', () => {
    const top = windowRange(0, 600, 56, 20, 6);
    assert.equal(top.start, 0);
    assert.equal(top.end, Math.min(20, Math.ceil(600 / 56) + 1 + 6));
    assert.equal(windowRange(0, 600, 56, 10, 6).end, 10);
    const bottom = windowRange(50_000 * 56, 600, 56, 50_000, 6);
    assert.equal(bottom.end, 50_000);
    assert.ok(bottom.start < 50_000);
    assert.deepEqual(windowRange(0, 600, 56, 0), { start: 0, end: 0, offsetTop: 0, totalHeight: 0 });
    assert.equal(windowRange(-10, 600, 56, 10).start, 0);
  });

  it('covers the viewport for any fractional scroll position', () => {
    for (let s = 0; s < 56 * 40; s += 7) {
      const w = windowRange(s, 500, 56, 1000, 2);
      assert.ok(w.start * 56 <= s, 'first rendered row starts above the viewport');
      assert.ok(w.end * 56 >= s + 500, 'last rendered row ends below the viewport');
    }
  });
});
