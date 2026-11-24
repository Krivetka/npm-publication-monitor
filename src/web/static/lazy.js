// Route-level code splitting: a page module is fetched the first time its route is opened.
// The bundler turns each dynamic import into a chunk; without a bundler the browser loads the
// module file itself. While the module is on its way the page shows a skeleton; a failed load
// is thrown into the error boundary.

import { html } from 'htm/preact';
import { useEffect, useState } from 'preact/hooks';
import { PageSkeleton } from './components.js';

export function lazy(load, pick) {
  let Loaded = null;
  let failure = null;
  let pending = null;
  return function LazyPage(props) {
    const [, rerender] = useState(0);
    useEffect(() => {
      if (Loaded || failure) return undefined;
      let alive = true;
      pending ??= load().then(
        (m) => {
          Loaded = pick(m);
        },
        (e) => {
          failure = e;
        },
      );
      pending.then(() => {
        if (alive) rerender((n) => n + 1);
      });
      return () => {
        alive = false;
      };
    }, []);
    if (failure) {
      const e = failure;
      failure = null; // "Try again" of the boundary starts a new attempt
      pending = null;
      throw e;
    }
    return Loaded ? html`<${Loaded} ...${props} />` : html`<${PageSkeleton} />`;
  };
}
