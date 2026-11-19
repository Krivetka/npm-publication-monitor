// Entry point: routing and view selection. The page frame lives in layout.js.

import { html, render } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { BASE } from './api.js';
import { routeStore, setNavigate } from './layout.js';
import { createNavigator } from './router.js';
import { EventView } from './views/event.js';
import { FeedView } from './views/feed.js';
import { ListView } from './views/lists.js';
import { NotFoundView } from './views/notfound.js';
import { DependenciesView } from './views/dependencies.js';
import { OverviewView } from './views/overview.js';
import { PackageView } from './views/package.js';
import { PrivacyView } from './views/privacy.js';
import { StatsView } from './views/stats.js';

const nav = createNavigator(BASE, (r) => routeStore.set(r));
setNavigate((to) => nav.go(to));
routeStore.set(nav.current());

const TITLES = { overview: 'Overview', feed: 'Live feed', alerts: 'Alerts', stage2: 'Stage 2', stage1: 'Stage 1', stats: 'Statistics', dependencies: 'My dependencies', privacy: 'Privacy notice', event: 'Event', package: 'Package', notfound: 'Not found' };

function App() {
  const [route, setRoute] = useState(routeStore.get());
  useEffect(() => routeStore.subscribe(setRoute), []);
  useEffect(() => {
    const t = route.name === 'event' ? `Event ${route.params.seq}` : route.name === 'package' ? route.params.name : TITLES[route.name] ?? 'npm monitor';
    document.title = `${t} · npm monitor`;
  }, [route]);

  switch (route.name) {
    case 'overview': return html`<${OverviewView} />`;
    case 'feed': return html`<${FeedView} query=${route.query} nav=${nav} />`;
    case 'alerts': return html`<${ListView} kind="alerts" query=${route.query} nav=${nav} key="alerts" />`;
    case 'stage2': return html`<${ListView} kind="stage2" query=${route.query} nav=${nav} key="stage2" />`;
    case 'stage1': return html`<${ListView} kind="stage1" query=${route.query} nav=${nav} key="stage1" />`;
    case 'stats': return html`<${StatsView} query=${route.query} nav=${nav} />`;
    case 'dependencies': return html`<${DependenciesView} />`;
    case 'privacy': return html`<${PrivacyView} />`;
    case 'event': return html`<${EventView} seq=${route.params.seq} key=${route.params.seq} />`;
    case 'package': return html`<${PackageView} name=${route.params.name} key=${route.params.name} />`;
    default: return html`<${NotFoundView} path=${route.path} />`;
  }
}

render(html`<${App} />`, document.getElementById('app'));
