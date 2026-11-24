// Outline icons (24×24, currentColor). Decorative only: text always sits next to them.

import { html } from 'htm/preact';

const PATHS = {
  temporal: html`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`,
  version: html`<circle cx="6" cy="5.5" r="2.2"/><circle cx="6" cy="18.5" r="2.2"/><circle cx="18" cy="8.5" r="2.2"/><path d="M6 7.7v8.6"/><path d="M18 10.7c0 3.6-4.5 4.2-10.5 6.3"/>`,
  nominal: html`<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.4"/>`,
  watchlist: html`<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>`,
  publisher: html`<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.8-3.6 3.8-5.8 7.5-5.8s6.7 2.2 7.5 5.8"/>`,
  maintainers: html`<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M18 14.8c1.6.8 2.7 2.4 3 4.7"/>`,
  manifest: html`<path d="M12 2.8l8 4.4v9.6l-8 4.4-8-4.4V7.2z"/><path d="M4 7.2l8 4.4 8-4.4M12 11.6v9.6"/>`,
  repository: html`<path d="M5 4.5h11a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z"/><path d="M5 16.5a3 3 0 0 1 3-3h11"/>`,
  registry: html`<ellipse cx="12" cy="6" rx="7.5" ry="2.8"/><path d="M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8"/>`,
  check: html`<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  alert: html`<path d="M12 3.5L2.8 19.5h18.4z"/><path d="M12 10v4.2"/><path d="M12 17.2v.3"/>`,
  shield: html`<path d="M12 3l7 3v5.5c0 4.3-3 8-7 9.5-4-1.5-7-5.2-7-9.5V6z"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8"/>`,
  pulse: html`<path d="M3 12h4l3-8 4 16 3-8h4"/>`,
  cross: html`<path d="M6 6l12 12M18 6L6 18"/>`,
  clock: html`<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`,
  pause: html`<path d="M8 5v14M16 5v14"/>`,
  play: html`<path d="M7 4.5l12 7.5-12 7.5z"/>`,
  search: html`<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/>`,
};
PATHS.versions = PATHS.version;

export function Icon({ name, size = 16, stroke = 2 }) {
  return html`<svg class="ico" width=${size} height=${size} style=${`width:${size / 16}rem;height:${size / 16}rem`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] ?? PATHS.manifest}</svg>`;
}
