// Entry point: routing and view selection. The page frame lives in layout.js.

import { html, render } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { BASE, setFailureHandler } from './api.js';
import { ErrorBoundary, installGlobalHandlers, notifyError, Toasts, toastStore } from './errors.js';
import { routeStore, setNavigate } from './layout.js';
import { lazy } from './lazy.js';
import { createNavigator } from './router.js';
import { NotFoundView } from './views/notfound.js';
import { OverviewView } from './views/overview.js';

// The overview is in the first chunk: it is the landing page. Every other page is a chunk of
// its own, fetched when its route is opened.
const FeedView = lazy(
  () => import('./views/feed.js'),
  (m) => m.FeedView,
);
const ListView = lazy(
  () => import('./views/lists.js'),
  (m) => m.ListView,
);
const EventView = lazy(
  () => import('./views/event.js'),
  (m) => m.EventView,
);
const PackageView = lazy(
  () => import('./views/package.js'),
  (m) => m.PackageView,
);
const StatsView = lazy(
  () => import('./views/stats.js'),
  (m) => m.StatsView,
);
const DependenciesView = lazy(
  () => import('./views/dependencies.js'),
  (m) => m.DependenciesView,
);
const PrivacyView = lazy(
  () => import('./views/privacy.js'),
  (m) => m.PrivacyView,
);

// every failure nobody handles ends in the log and in a toast
installGlobalHandlers();
setFailureHandler(notifyError);

const nav = createNavigator(BASE, (r) => routeStore.set(r));
setNavigate((to) => nav.go(to));
routeStore.set(nav.current());

const TITLES = {
  overview: 'Overview',
  feed: 'Live feed',
  alerts: 'Alerts',
  stage2: 'Stage 2',
  stage1: 'Stage 1',
  stats: 'Statistics',
  dependencies: 'My dependencies',
  privacy: 'Privacy notice',
  event: 'Event',
  package: 'Package',
  notfound: 'Not found',
};

function ToastHost() {
  const [items, setItems] = useState(toastStore.get());
  useEffect(() => toastStore.subscribe(setItems), []);
  return html`<${Toasts} items=${items} />`;
}

function App() {
  const [route, setRoute] = useState(routeStore.get());
  useEffect(() => routeStore.subscribe(setRoute), []);
  return html`<${ErrorBoundary} resetKey=${route.path} home=${`${BASE}/`}><${Page} route=${route} /></${ErrorBoundary}><${ToastHost} />`;
}

function Page({ route }) {
  useEffect(() => {
    const t = route.name === 'event' ? `Event ${route.params.seq}` : route.name === 'package' ? route.params.name : (TITLES[route.name] ?? 'npm monitor');
    document.title = `${t} · npm monitor`;
  }, [route]);

  switch (route.name) {
    case 'overview':
      return html`<${OverviewView} />`;
    case 'feed':
      return html`<${FeedView} query=${route.query} nav=${nav} />`;
    case 'alerts':
      return html`<${ListView} kind="alerts" query=${route.query} nav=${nav} key="alerts" />`;
    case 'stage2':
      return html`<${ListView} kind="stage2" query=${route.query} nav=${nav} key="stage2" />`;
    case 'stage1':
      return html`<${ListView} kind="stage1" query=${route.query} nav=${nav} key="stage1" />`;
    case 'stats':
      return html`<${StatsView} query=${route.query} nav=${nav} />`;
    case 'dependencies':
      return html`<${DependenciesView} />`;
    case 'privacy':
      return html`<${PrivacyView} />`;
    case 'event':
      return html`<${EventView} seq=${route.params.seq} key=${route.params.seq} />`;
    case 'package':
      return html`<${PackageView} name=${route.params.name} key=${route.params.name} />`;
    default:
      return html`<${NotFoundView} path=${route.path} />`;
  }
}

// A new text size changes the pixel height of the feed rows: the app mounts again with it.
const mount = () => render(html`<${App} key=${document.documentElement.dataset.scale ?? '100'} />`, document.getElementById('app'));
addEventListener('npm-monitor:display', mount);
mount();
