// Display preferences of the viewer: colour scheme and text size. Loaded as a classic script in
// <head>, before the stylesheet paints, so a stored choice never flashes. The choice lives in
// this browser only.
(() => {
  const KEY = 'npm-monitor.display';
  const THEMES = ['auto', 'light', 'dark'];
  const SCALES = ['100', '112', '125'];
  function read() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || '{}');
      return { theme: THEMES.indexOf(v.theme) >= 0 ? v.theme : 'auto', scale: SCALES.indexOf(v.scale) >= 0 ? v.scale : '100' };
    } catch (_e) {
      return { theme: 'auto', scale: '100' };
    }
  }
  function apply(p) {
    const root = document.documentElement;
    if (p.theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', p.theme);
    if (p.scale === '100') root.removeAttribute('data-scale');
    else root.setAttribute('data-scale', p.scale);
  }
  function write(p) {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch (_e) {
      /* private mode: this page only */
    }
    apply(p);
    window.dispatchEvent(new CustomEvent('npm-monitor:display', { detail: p }));
  }
  apply(read());
  window.npmMonitorDisplay = { read: read, write: write, THEMES: THEMES, SCALES: SCALES };
})();
