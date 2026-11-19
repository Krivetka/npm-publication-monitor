// History-API router: pure matching (testable) plus a tiny navigation layer.

const ROUTES = [
  ['overview', '/'],
  ['feed', '/feed'],
  ['alerts', '/alerts'],
  ['stage2', '/stage2'],
  ['stage1', '/stage1'],
  ['stats', '/stats'],
  ['dependencies', '/dependencies'],
  ['privacy', '/privacy'],
  ['event', '/event/:seq'],
  ['package', '/package/:name'],
];

// "/npm" + "/npm/event/12" → { name: 'event', params: { seq: '12' } }; unknown → { name: 'notfound' }.
export function matchRoute(pathname, base = '') {
  let path = pathname;
  if (base && (path === base || path.startsWith(base + '/'))) path = path.slice(base.length);
  if (path === '') path = '/';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  for (const [name, pattern] of ROUTES) {
    const want = pattern.split('/');
    const got = path.split('/');
    if (want.length !== got.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < want.length; i++) {
      const w = want[i];
      if (w.startsWith(':')) {
        if (got[i] === '') { ok = false; break; }
        params[w.slice(1)] = safeDecode(got[i]);
      } else if (w !== got[i]) { ok = false; break; }
    }
    if (ok) return { name, params };
  }
  return { name: 'notfound', params: {} };
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

// Query string helpers: parse "?a=1&b=" → { a: '1' } (empty values dropped), build the reverse.
export function parseQuery(search) {
  const out = {};
  for (const [k, v] of new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)) if (v !== '') out[k] = v;
  return out;
}
export function buildQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '' || v === false) continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

// Navigation layer (browser only).
export function createNavigator(base, onChange) {
  const current = () => ({ ...matchRoute(location.pathname, base), query: parseQuery(location.search), path: location.pathname + location.search });
  const go = (to, replace = false) => {
    const url = to.startsWith('/') ? base + to : to;
    if (replace) history.replaceState(null, '', url); else history.pushState(null, '', url);
    onChange(current());
  };
  addEventListener('popstate', () => onChange(current()));
  // Intercept in-app links so the page never reloads.
  addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.origin !== location.origin) return;
    const path = a.pathname;
    if (!(path === base || path.startsWith(base + '/')) || path.startsWith(base + '/api') || path.startsWith(base + '/static')) return;
    e.preventDefault();
    if (path + a.search === location.pathname + location.search) return;
    history.pushState(null, '', path + a.search);
    onChange(current());
    scrollTo(0, 0);
  });
  return { current, go, href: (to) => base + to };
}
