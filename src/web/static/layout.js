// Page frame: the band (header + hero) and the main area. The header reads the
// current route from a tiny store so every view can render the frame itself.

import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { BASE } from './api.js';
import { normalisePackageName, validatePackageName } from './forms.js';
import { Icon } from './icons.js';
import { subscribe, wsState } from './ws.js';

const TABS = [
  ['overview', '/', 'Overview'],
  ['feed', '/feed', 'Live feed'],
  ['alerts', '/alerts', 'Alerts'],
  ['dependencies', '/dependencies', 'My dependencies'],
  ['stage2', '/stage2', 'Stage 2'],
  ['stage1', '/stage1', 'Stage 1'],
  ['stats', '/stats', 'Statistics'],
];

const listeners = new Set();
let current = { name: '', params: {}, query: {}, path: '' };
export const routeStore = {
  get: () => current,
  set(r) {
    current = r;
    for (const fn of listeners) fn(r);
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
export let navigate = (to) => {
  location.href = BASE + to;
};
export const setNavigate = (fn) => {
  navigate = fn;
};

function Header() {
  const [route, setRoute] = useState(routeStore.get());
  const [live, setLive] = useState(wsState() === 'open');
  useEffect(() => routeStore.subscribe(setRoute), []);
  useEffect(
    () =>
      subscribe((m) => {
        if (m.type === '_state') setLive(m.state === 'open');
      }),
    [],
  );
  const [searchError, setSearchError] = useState(null);
  const onSearch = (e) => {
    e.preventDefault();
    const raw = new FormData(e.currentTarget).get('name');
    const error = validatePackageName(raw);
    setSearchError(error);
    if (!error) navigate(`/package/${encodeURIComponent(normalisePackageName(raw))}`);
  };
  return html`<header><div class="wrap">
    <a class="brand" href=${`${BASE}/`}><${Icon} name="pulse" size=${22} /><span>npm monitor</span></a>
    <nav class="tabs" aria-label="Sections">${TABS.map(([id, to, name]) => html`<a href=${BASE + to} aria-current=${route.name === id ? 'page' : null} key=${id}>${name}${id === 'feed' && html`<span class=${`live-dot${live ? ' on' : ''}`} title=${live ? 'live' : 'reconnecting'}></span>`}</a>`)}</nav>
    <form class="search" role="search" onSubmit=${onSearch} novalidate>
      <label class="sr" for="pkg">Package</label><input id="pkg" name="name" type="search" placeholder="package, e.g. lodash" autocomplete="off" autocapitalize="none" spellcheck=${false}
        aria-invalid=${searchError ? 'true' : null} aria-describedby=${searchError ? 'pkg-error' : null} onInput=${() => searchError && setSearchError(null)} />
      <button class="btn-ghost" type="submit">Search</button>
      ${searchError && html`<p class="search-error" id="pkg-error" role="alert">${searchError}</p>`}
    </form>
  </div></header>`;
}

const display = () => (typeof window !== 'undefined' && window.npmMonitorDisplay) || null;
const THEME_NAMES = { auto: 'Auto', light: 'Light', dark: 'Dark' };
const SCALE_NAMES = { 100: 'A', 112: 'A+', 125: 'A++' };

// Colour scheme and text size of this viewer (prefs.js keeps them in the browser).
function DisplaySettings() {
  const d = display();
  const [prefs, setPrefs] = useState(() => (d ? d.read() : { theme: 'auto', scale: '100' }));
  if (!d) return null;
  const set = (patch) => {
    const next = { ...prefs, ...patch };
    d.write(next);
    setPrefs(next);
  };
  return html`<div class="display" role="group" aria-label="Display settings">
    <span class="dl">Theme</span>
    ${d.THEMES.map((t) => html`<button type="button" class="seg-btn" key=${t} aria-pressed=${prefs.theme === t ? 'true' : 'false'} onClick=${() => set({ theme: t })}>${THEME_NAMES[t]}</button>`)}
    <span class="dl">Text</span>
    ${d.SCALES.map((s) => html`<button type="button" class="seg-btn" key=${s} aria-pressed=${prefs.scale === s ? 'true' : 'false'} aria-label=${`Text size ${s} %`} onClick=${() => set({ scale: s })}>${SCALE_NAMES[s]}</button>`)}
  </div>`;
}

export function Page({ hero, children, mainClass = '' }) {
  return html`<div class="band"><${Header} /><div class="wrap hero">${hero}</div></div><main class=${`wrap ${mainClass}`}>${children}</main><footer class="wrap foot"><a href=${`${BASE}/privacy`}>Privacy notice</a><span>An alert is a signal for review, not a statement about an account.</span><${DisplaySettings} /></footer>`;
}
