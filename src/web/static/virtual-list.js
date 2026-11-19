// Windowed (virtualized) list: only the rows in view ± overscan exist in the DOM,
// so a feed of tens of thousands of rows scrolls like a short one.

import { html } from 'htm/preact';
import { useEffect, useRef, useState } from 'preact/hooks';

// Pure window math: which rows to render and where to put them.
export function windowRange(scrollTop, viewportHeight, rowHeight, total, overscan = 6) {
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0, offsetTop: 0, totalHeight: 0 };
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1;
  const start = Math.max(0, first - overscan);
  const end = Math.min(total, first + visible + overscan);
  return { start, end, offsetTop: start * rowHeight, totalHeight: total * rowHeight };
}

// items: array; renderRow(item, index) → vnode; rowHeight px; onNearEnd() when the
// last rows come into view; onScrollTop(bool) reports whether the list is at the top.
export function VirtualList({ items, rowHeight, renderRow, onNearEnd, onScrollTop, className = '', header = null }) {
  const ref = useRef(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const atTop = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = (e) => {
    const el = e.currentTarget;
    setView({ top: el.scrollTop, height: el.clientHeight });
    const nowTop = el.scrollTop < rowHeight;
    if (nowTop !== atTop.current) {
      atTop.current = nowTop;
      onScrollTop && onScrollTop(nowTop);
    }
    if (onNearEnd && el.scrollTop + el.clientHeight >= el.scrollHeight - rowHeight * 10) onNearEnd();
  };

  const { start, end, offsetTop, totalHeight } = windowRange(view.top, view.height, rowHeight, items.length);
  const rows = [];
  for (let i = start; i < end; i++) rows.push(renderRow(items[i], i));
  return html`<div class="vlist ${className}" ref=${ref} onScroll=${onScroll}>
    ${header}
    <div class="spacer" style="height:${totalHeight}px">
      <div class="rows" style="transform:translateY(${offsetTop}px)">${rows}</div>
    </div>
  </div>`;
}

export function scrollListToTop(container) {
  const el = container?.querySelector?.('.vlist') ?? container;
  if (el) el.scrollTop = 0;
}
