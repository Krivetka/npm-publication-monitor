// Page frame: dark band (header + hero) and the light main area. The header reads the
// current route from a tiny store so every view can render the frame itself.

import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { BASE } from './api.js';
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
  set(r) { current = r; for (const fn of listeners) fn(r); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
export let navigate = (to) => { location.href = BASE + to; };
export const setNavigate = (fn) => { navigate = fn; };

function Header() {
  const [route, setRoute] = useState(routeStore.get());
  const [live, setLive] = useState(wsState() === 'open');
  useEffect(() => routeStore.subscribe(setRoute), []);
  useEffect(() => subscribe((m) => { if (m.type === '_state') setLive(m.state === 'open'); }), []);
  const onSearch = (e) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
    if (name) navigate(`/package/${encodeURIComponent(name)}`);
  };
  return html`<header><div class="wrap">
    <a class="brand" href=${`${BASE}/`}><${Icon} name="pulse" size=${22} /><span>npm monitor</span></a>
    <nav class="tabs" aria-label="Sections">${TABS.map(([id, to, name]) => html`<a href=${BASE + to} aria-current=${route.name === id ? 'page' : null} key=${id}>${name}${id === 'feed' && html`<span class=${`live-dot${live ? ' on' : ''}`} title=${live ? 'live' : 'reconnecting'}></span>`}</a>`)}</nav>
    <form class="search" role="search" onSubmit=${onSearch}>
      <label class="sr" for="pkg">Package</label><input id="pkg" name="name" type="search" placeholder="package, e.g. lodash" autocomplete="off" />
      <button class="btn-ghost" type="submit">Search</button>
    </form>
  </div></header>`;
}

export function Page({ hero, children, mainClass = '' }) {
  return html`<div class="band"><${Header} /><div class="wrap hero">${hero}</div></div><main class=${`wrap ${mainClass}`}>${children}</main><footer class="wrap foot"><a href=${`${BASE}/privacy`}>Privacy notice</a><span>An alert is a signal for review, not a statement about an account.</span></footer>`;
}
