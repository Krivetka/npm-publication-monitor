import { html } from 'htm/preact';
import { BASE } from '../api.js';
import { Page } from '../layout.js';

export function NotFoundView({ path }) {
  return html`<${Page} hero=${html`<div><h1>Not found</h1><p class="lead">There is no page at <span class="mono">${path}</span>.</p></div>`}>
    <section><p><a href=${`${BASE}/`}>Back to the overview</a></p></section>
  </${Page}>`;
}
