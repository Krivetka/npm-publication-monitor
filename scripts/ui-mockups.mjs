// Builds the material of the Adaptive-UI criterion from an audit run:
//   documentation/adaptive-ui/screens/*.png   screenshots of the main screens on three devices
//   documentation/adaptive-ui/audit.json      the measurements
//   documentation/adaptive-ui/mockups.pdf     layouts for three devices + the component library
//   the tables of documentation/adaptive-ui/README.md (contrast, audit, list of screenshots)
//
//   node scripts/ui-mockups.mjs <audit-dir> <base-url>
//
// <audit-dir> is the output of scripts/ui-audit.mjs; <base-url> is the running dashboard, from
// which the component library page is printed.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const [auditDir, base] = process.argv.slice(2);
if (!auditDir || !base) {
  console.error('usage: node scripts/ui-mockups.mjs <audit-dir> <base-url>');
  process.exit(2);
}
const OUT = 'documentation/adaptive-ui';
const SCREENS = join(OUT, 'screens');
const audit = JSON.parse(readFileSync(join(auditDir, 'audit.json'), 'utf8'));
const EDGE = process.env.EDGE_PATH ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));

// ── which screenshots go into the repository ─────────────────────────────────────────────
const PAGES = [
  ['overview', 'Overview', 'the funnel, the pulse of the feed, the pipeline status, the latest alerts'],
  ['feed', 'Live feed', 'every publication as it arrives; filters and pause'],
  ['alerts', 'Alerts', 'enriched candidates with score, verdict and the fired features'],
  ['event', 'Event card', 'why the event got its score, the version history, the evidence, the verdict'],
  ['dependencies', 'My dependencies', 'only the alerts on the packages of one lock file'],
];
const DEVICES = [['phone-portrait', 'Phone 390 × 844'], ['tablet-portrait', 'Tablet 768 × 1024'], ['desktop', 'Desktop 1440 × 900']];
const VARIANTS = [
  ['phone-landscape--feed', 'Phone held sideways (844 × 390): the header and the hero shrink'],
  ['phone-small--overview', 'Small phone (320 × 568): one funnel step per row'],
  ['tablet-landscape--event', 'Tablet, landscape (1024 × 768): event card'],
  ['desktop-zoom-200--alerts', 'Desktop at 200 % browser zoom: the phone layout applies'],
  ['desktop-text-125--overview', 'Desktop, text size 125 %: the whole layout scales with the text'],
  ['wide--overview', 'Large screen (2560 × 1440): wider content, readable line length'],
];
// the dark theme: one page, the three devices side by side
const DARK = [['phone-portrait--overview--dark', 'phone', 'Phone 390 × 844: overview'], ['tablet-portrait--event--dark', 'tablet', 'Tablet 768 × 1024: event card'], ['desktop--alerts--dark', 'desktop', 'Desktop 1440 × 900: alerts']];
const wanted = [...PAGES.flatMap(([p]) => DEVICES.map(([d]) => `${d}--${p}`)), ...VARIANTS.map(([f]) => f), ...DARK.map(([f]) => f), 'desktop--kit', 'phone-portrait--kit'];

rmSync(SCREENS, { recursive: true, force: true });
mkdirSync(SCREENS, { recursive: true });
const have = new Set(readdirSync(auditDir).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4)));
for (const name of wanted) {
  if (!have.has(name)) throw new Error(`the audit has no screenshot ${name}`);
  copyFileSync(join(auditDir, `${name}.png`), join(SCREENS, `${name}.png`));
}
writeFileSync(join(OUT, 'audit.json'), `${JSON.stringify(audit, null, 1)}\n`);

// ── the sheet of layouts ─────────────────────────────────────────────────────────────────
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const sheet = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Adaptive UI: layouts for three devices</title><style>
@page{size:A4 landscape;margin:12mm}
*{box-sizing:border-box}
body{font:11pt/1.45 'Segoe UI',system-ui,sans-serif;color:#17181C;margin:0}
h1{font-size:22pt;margin:0 0 4mm}h2{font-size:15pt;margin:0 0 1mm}p{margin:0 0 3mm;color:#4F4D48}
.page{page-break-after:always;min-height:180mm;display:flex;flex-direction:column}
.devices{display:flex;gap:6mm;align-items:flex-start;flex:1}
figure{margin:0;display:flex;flex-direction:column;align-items:flex-start;gap:2mm}
figcaption{font-size:9pt;color:#4F4D48;font-weight:600}
/* an image keeps its proportions: one side is set, the other follows */
img{display:block;border:0.3mm solid #B9B7B0;border-radius:2mm;height:auto}
.phone img{width:44mm}.tablet img{width:78mm}.desktop img{width:142mm}
.one img{width:auto;height:auto;max-width:255mm;max-height:140mm}
.cover{justify-content:center}
table{border-collapse:collapse;font-size:10pt}td,th{border-bottom:0.2mm solid #E3E1DB;padding:1.5mm 4mm 1.5mm 0;text-align:left}
</style></head><body>
<section class="page cover"><h1>npm Publication Monitor — adaptive UI</h1>
<p>Layouts of the main screens for a phone, a tablet and a desktop, variants for orientation, zoom, text size, a large screen and the dark theme, and the library of reusable components with their states.</p>
<p>The layouts are rendered from the implemented design system (one stylesheet with the tokens and the components), ${audit.date}. Each screen shows the first screen of the device.</p>
<table><tr><th>Part</th><th>Pages</th></tr>
<tr><td>1. Main screens on three devices</td><td>${PAGES.map(([, t]) => t).join(', ')}</td></tr>
<tr><td>2. Variants</td><td>landscape, small phone, tablet in landscape, 200 % zoom, text size 125 %, large screen, dark theme</td></tr>
<tr><td>3. Component library</td><td>tokens, typography, spacing, buttons, pills, inputs, labels, data, navigation, messages</td></tr></table></section>
${PAGES.map(([p, title, what], i) => `<section class="page"><h2>1.${i + 1} ${esc(title)}</h2><p>${esc(what)}</p><div class="devices">
${DEVICES.map(([d, label]) => `<figure class="${d.split('-')[0]}"><figcaption>${esc(label)}</figcaption><img src="screens/${d}--${p}.png" alt="${esc(title)} on ${esc(label)}"></figure>`).join('\n')}
</div></section>`).join('\n')}
${VARIANTS.map(([f, label], i) => `<section class="page one"><h2>2.${i + 1} ${esc(label)}</h2><p>&nbsp;</p><figure><img src="screens/${f}.png" alt="${esc(label)}"></figure></section>`).join('\n')}
<section class="page"><h2>2.${VARIANTS.length + 1} Dark theme</h2><p>The header, the hero and the page use one palette in each theme.</p><div class="devices">
${DARK.map(([f, cls, label]) => `<figure class="${cls}"><figcaption>${esc(label)}</figcaption><img src="screens/${f}.png" alt="Dark theme, ${esc(label)}"></figure>`).join('\n')}
</div></section>
</body></html>`;
const sheetPath = join(OUT, 'mockups.html');
writeFileSync(sheetPath, sheet);

// ── PDF: the sheet, then the component library printed from the running application ──────
if (!EDGE) throw new Error('no Edge or Chrome found; set EDGE_PATH');
const tmp = join(auditDir, 'pdf');
mkdirSync(tmp, { recursive: true });
const print = (url, file) => execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--virtual-time-budget=8000', `--print-to-pdf=${resolve(tmp, file)}`, url], { stdio: 'ignore', timeout: 120_000 });
print(pathToFileURL(resolve(sheetPath)).href, 'sheet.pdf');
print(`${base.replace(/\/$/, '')}/static/kit.html`, 'kit.pdf');
const out = await PDFDocument.create();
for (const f of ['sheet.pdf', 'kit.pdf']) {
  const src = await PDFDocument.load(readFileSync(join(tmp, f)));
  for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
}
out.setTitle('npm Publication Monitor — adaptive UI: layouts and component library');
writeFileSync(join(OUT, 'mockups.pdf'), await out.save());
if (!process.env.KEEP_SHEET) rmSync(sheetPath); // KEEP_SHEET=1 leaves the HTML sheet for a look in a browser

// ── tables of the README ─────────────────────────────────────────────────────────────────
const contrast = execFileSync(process.execPath, ['scripts/ui-contrast.mjs', '--markdown'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const auditRows = audit.viewports.map((vp) => {
  const rows = audit.report.filter((r) => r.viewport === vp.id);
  const small = rows.reduce((s, r) => s + r.smallCount, 0);
  const targets = rows.reduce((s, r) => s + r.targets, 0);
  return `| ${vp.label} | ${vp.width} × ${vp.height} | ${rows.length} | ${rows.filter((r) => r.overflow > 1).length} | ${rows.filter((r) => !r.navInView && r.page !== 'kit').length} | ${vp.touch ? `${small} of ${targets}` : 'not a touch screen'} |`;
});
const auditTable = ['| Viewport | Size, CSS px | Pages | Pages with horizontal scroll | Pages without the navigation in view | Touch targets under 44 px |', '|---|---|---|---|---|---|', ...auditRows, '', `Run of ${audit.date}; ${audit.report.length} page–size pairs. The component library page is one of the ten pages; it has no navigation and is not counted in the navigation column. The last column counts the visible targets under 44 px against all targets of the pages.`].join('\n');
const screens = ['| Screen | Phone | Tablet | Desktop |', '|---|---|---|---|', ...PAGES.map(([p, title]) => `| ${title} | ${DEVICES.map(([d]) => `[${d.split('-')[0]}](screens/${d}--${p}.png)`).join(' | ')} |`), '', '| Variant | File |', '|---|---|', ...VARIANTS.map(([f, label]) => `| ${label} | [${f}.png](screens/${f}.png) |`), ...DARK.map(([f, , label]) => `| Dark theme. ${label} | [${f}.png](screens/${f}.png) |`), '| Component library, desktop and phone | [desktop](screens/desktop--kit.png), [phone](screens/phone-portrait--kit.png) |'].join('\n');

let readme = readFileSync(join(OUT, 'README.md'), 'utf8');
const put = (marker, text) => {
  const re = new RegExp(`<!-- ${marker} -->[\\s\\S]*?<!-- /${marker} -->|<!-- ${marker} -->`);
  if (!re.test(readme)) throw new Error(`README has no marker ${marker}`);
  readme = readme.replace(re, () => `<!-- ${marker} -->\n${text}\n<!-- /${marker} -->`);
};
put('contrast', contrast);
put('audit', auditTable);
put('screens', screens);
writeFileSync(join(OUT, 'README.md'), readme);
console.log(`screens: ${wanted.length}; mockups.pdf: ${out.getPageCount()} pages`);
