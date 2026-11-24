// Contrast of every text colour of the dashboard against the background it is used on, for the
// light and the dark palette, by the WCAG 2.1 formula. Level AA asks for 4.5:1 for text.
//
//   node scripts/ui-contrast.mjs [--markdown]
//
// The colours are read from the design tokens in src/web/static/styles.css; the pairs below say
// where each token is used.

import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/web/static/styles.css', import.meta.url), 'utf8');
const tokens = (block) => Object.fromEntries([...block.matchAll(/--([a-z0-9-]+):(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
const light = tokens(/:root\{color-scheme:light;([\s\S]*?)\}/.exec(css)[1]);
const dark = { ...light, ...tokens(/:root\[data-theme="dark"\]\{color-scheme:dark;([\s\S]*?)\}/.exec(css)[1]) };

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [text, background, where it is used]
const PAIRS = [
  ['ink', 'bg', 'body text on the page'],
  ['ink', 'panel', 'text in panels and tables'],
  ['ink-2', 'panel', 'secondary text, table headers'],
  ['ink-3', 'panel', 'muted text, notes'],
  ['ink-3', 'bg', 'muted text on the page, footer'],
  ['ink', 'chip', 'feature chips'],
  ['ink-2', 'chip', 'values inside chips, code'],
  ['link', 'panel', 'links in panels'],
  ['link', 'bg', 'links on the page'],
  ['good', 'panel', 'state "ok", verdict "not an alert"'],
  ['good', 'good-bg', 'banner of new events'],
  ['warn', 'panel', 'state "warning"'],
  ['bad', 'panel', 'state "bad", verdict "alert"'],
  ['bad', 'bad-bg', 'error box, alert row of the feed'],
  ['ink', 'bad-bg', 'text of an alert row'],
  ['band-ink', 'band', 'text in the band (header and hero)'],
  ['band-ink-2', 'band', 'lead text in the band'],
  ['band-ink-3', 'band', 'muted text in the band'],
  ['band-link', 'band', 'links in the band'],
  ['band-tab', 'band', 'navigation, inactive tab'],
  ['band-strong', 'band', 'navigation, active tab; headings'],
  ['band-soft', 'band', 'filter pills'],
  ['on-accent', 'band-accent', 'selected filter pill'],
  ['band-ink', 'band-2', 'pulse panel'],
  ['band-ink-2', 'band-2', 'pulse panel, secondary'],
  ['band-ink', 'band-input', 'search field'],
  ['band-placeholder', 'band-input', 'placeholder of the search field'],
  ['ink-3', 'bg', 'placeholder of a field on the page'],
  ['band-ink-3', 'band-2', 'pulse panel, axis labels'],
  ['band-err', 'band', 'error under the search field'],
  ['pill-ok', 'pill-ok-bg', 'state pill "ok"'],
  ['pill-warn', 'pill-warn-bg', 'state pill "warning"'],
  ['pill-bad', 'pill-bad-bg', 'state pill "problem"'],
  ['pill-neutral', 'pill-neutral-bg', 'state pill, neutral'],
  ['on-s', 'band-s1', 'score segment of stage 1'],
  ['on-s', 'band-s2', 'score segment of stage 2'],
];

const rows = [];
for (const [theme, t] of [['light', light], ['dark', dark]]) {
  for (const [fg, bg, where] of PAIRS) {
    const a = fg.startsWith('#') ? fg : t[fg];
    const b = bg.startsWith('#') ? bg : t[bg];
    rows.push({ theme, fg, bg, a, b, where, ratio: contrast(a, b) });
  }
}
const low = rows.filter((r) => r.ratio < 4.5);
if (process.argv.includes('--markdown')) {
  console.log('| Text | Background | Used for | Light | Dark |\n|---|---|---|---|---|');
  for (const [fg, bg, where] of PAIRS) {
    const cell = (theme) => { const r = rows.find((x) => x.theme === theme && x.fg === fg && x.bg === bg); return `${r.ratio.toFixed(1)}:1`; };
    console.log(`| \`${fg}\` | \`${bg}\` | ${where} | ${cell('light')} | ${cell('dark')} |`);
  }
} else {
  for (const r of rows) console.log(`${r.theme.padEnd(5)} ${r.ratio.toFixed(2).padStart(6)}  ${`${r.fg} (${r.a})`.padEnd(24)} on ${`${r.bg} (${r.b})`.padEnd(24)} ${r.where}${r.ratio < 4.5 ? '   << below 4.5' : ''}`);
}
console.error(`${rows.length} pairs; lowest ${Math.min(...rows.map((r) => r.ratio)).toFixed(2)}:1; below 4.5:1: ${low.length}`);
process.exit(low.length === 0 ? 0 : 1);
