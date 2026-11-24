// Adaptive-UI audit: opens every page of the dashboard in a headless browser at the sizes of a
// phone, a tablet and a desktop (both orientations, a large screen, a zoomed desktop) and checks
// what the criterion asks for: no horizontal page scroll, the main navigation in view, touch
// targets of at least 44 px. It also saves a screenshot of every combination.
//
//   node scripts/ui-audit.mjs <base-url> <out-dir> [--card-base <url>] [--real-names]
//
// --card-base: another instance from which the event card and the package page are taken. Use
// one loaded with the test data (npm run db:seed) when the screenshots are to be published: its
// account names are invented, the ones of a production journal are not.
//
// Needs a running dashboard and Microsoft Edge or Chrome (EDGE_PATH overrides the location).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const [base, outDir] = process.argv.slice(2);
const cardBase = process.argv.includes('--card-base') ? process.argv[process.argv.indexOf('--card-base') + 1] : base;
const baseOf = (page) => (page === 'event' || page === 'package' ? cardBase : base);
if (!base || !outDir) {
  console.error('usage: node scripts/ui-audit.mjs <base-url> <out-dir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

export const VIEWPORTS = [
  { id: 'phone-portrait', label: 'Phone, portrait', width: 390, height: 844, dpr: 3, touch: true },
  { id: 'phone-landscape', label: 'Phone, landscape', width: 844, height: 390, dpr: 3, touch: true },
  { id: 'phone-small', label: 'Small phone', width: 320, height: 568, dpr: 2, touch: true },
  { id: 'tablet-portrait', label: 'Tablet, portrait', width: 768, height: 1024, dpr: 2, touch: true },
  { id: 'tablet-landscape', label: 'Tablet, landscape', width: 1024, height: 768, dpr: 2, touch: true },
  { id: 'desktop', label: 'Desktop', width: 1440, height: 900, dpr: 2, touch: false },
  { id: 'desktop-zoom-200', label: 'Desktop at 200 % browser zoom', width: 720, height: 450, dpr: 2, touch: false },
  { id: 'desktop-text-125', label: 'Desktop, text size 125 %', width: 1440, height: 900, dpr: 2, touch: false, scale: '125' },
  { id: 'wide', label: 'Large screen', width: 2560, height: 1440, dpr: 1, touch: false },
];

const EDGE = process.env.EDGE_PATH ?? ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe', '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
if (!EDGE) throw new Error('no Edge or Chrome found; set EDGE_PATH');
const profile = mkdtempSync(join(tmpdir(), 'ui-audit-'));
const PORT = 9400 + Math.floor(Math.random() * 400);
const browser = spawn(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--disable-features=Translate,TranslateUI', '--lang=en-US', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

let target;
for (let i = 0; i < 60 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch { await sleep(250); }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.once('open', r));
let id = 0;
const pending = new Map();
ws.on('message', (m) => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

// pages: an alert and a package are taken from the running instance
const api = async (path, from = base) => (await fetch(`${from}/api/v1${path}`)).json();
const alerts = (await api('/events?alert=true&limit=5')).items;
const alert = (await api('/events?alert=true&limit=5', cardBase)).items[0];
const deps = [...new Set(alerts.map((a) => a.package))];
const PAGES = [
  ['overview', '/'],
  ['feed', '/feed'],
  ['alerts', '/alerts'],
  ['event', alert ? `/event/${alert.seq}` : '/alerts'],
  ['package', alert ? `/package/${encodeURIComponent(alert.package)}` : '/alerts'],
  ['stage1', '/stage1'],
  ['stats', '/stats'],
  ['dependencies', '/dependencies'],
  ['privacy', '/privacy'],
  ['kit', '/static/kit.html'],
];

const CHECK = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('.sr'); };
  const small = [];
  for (const el of document.querySelectorAll('a[href], button, input, select, textarea, summary')) {
    if (!visible(el)) continue;
    if (el.type === 'file' || el.type === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.height < 43.5 || r.width < 43.5) small.push((el.className && String(el.className).split(' ')[0] ? '.' + String(el.className).split(' ')[0] : el.tagName.toLowerCase()) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' "' + (el.textContent || el.placeholder || '').trim().slice(0, 18) + '"');
  }
  const nav = document.querySelector('nav.tabs');
  const nr = nav ? nav.getBoundingClientRect() : null;
  return {
    overflow: document.documentElement.scrollWidth - vw,
    navInView: Boolean(nr && nr.height > 0 && nr.bottom > 0 && nr.top < vh + (scrollY === 0 ? 400 : 0)),
    navFixedBottom: Boolean(nr && getComputedStyle(nav).position === 'fixed'),
    targets: document.querySelectorAll('a[href], button, input, select, textarea, summary').length,
    small: [...new Set(small)].slice(0, 12),
    smallCount: small.length,
    height: document.documentElement.scrollHeight,
    fontSize: getComputedStyle(document.documentElement).fontSize,
  };
})()`;

// a page is ready when its loading placeholders are gone (the data came), 12 s at most
const settled = async (least) => {
  await sleep(least);
  for (let i = 0; i < 40 && (await evaluate(`Boolean(document.querySelector('[aria-busy="true"], [class*="sk-"]')) || /Loading…|Reconnecting/.test(document.body.innerText)`)); i++) await sleep(300);
  await sleep(400);
};

// UI_ONLY=<viewport>--<page>[,…] retakes the named screenshots (the report is then partial); a
// dark one is <viewport>--<page>--dark
const ONLY = process.env.UI_ONLY ? process.env.UI_ONLY.split(',') : null;
await send('Page.enable');
// Published screenshots must not show npm account names (see PRIVACY.md). The page gets its data
// through JSON.parse; this hook replaces the account names in feature values with stable
// pseudonyms before the application sees them. --real-names turns it off.
const PSEUDONYMS = `(() => {
  const NAMED = /^(publisher_new|publisher_from_trusted|publisher_to_trusted|maintainers_added)$/;
  const alias = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return 'account-' + (h % 65536).toString(16).padStart(4, '0'); };
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    if (typeof v.id === 'string' && NAMED.test(v.id)) {
      if (typeof v.value === 'string') v.value = alias(v.value);
      else if (Array.isArray(v.value)) v.value = v.value.map(alias);
      delete v.detail;
      return;
    }
    Object.values(v).forEach(walk);
  };
  const parse = JSON.parse;
  JSON.parse = function (...args) { const out = parse.apply(this, args); try { walk(out); } catch { /* keep the data as it is */ } return out; };
})()`;
if (!process.argv.includes('--real-names')) await send('Page.addScriptToEvaluateOnNewDocument', { source: PSEUDONYMS });
const report = [];
for (const vp of VIEWPORTS) {
  await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.touch });
  await send('Emulation.setTouchEmulationEnabled', { enabled: vp.touch, maxTouchPoints: vp.touch ? 5 : 0 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'pointer', value: vp.touch ? 'coarse' : 'fine' }, { name: 'hover', value: vp.touch ? 'none' : 'hover' }, { name: 'prefers-color-scheme', value: 'light' }] });
  for (const [name, path] of PAGES) {
    if (ONLY && !ONLY.includes(`${vp.id}--${name}`)) continue;
    await send('Page.navigate', { url: `${baseOf(name)}/privacy` });
    await sleep(600);
    await evaluate(`localStorage.setItem('npm-monitor.dependencies', ${JSON.stringify(JSON.stringify(deps))}); localStorage.setItem('npm-monitor.display', ${JSON.stringify(JSON.stringify({ theme: 'light', scale: vp.scale ?? '100' }))})`);
    await send('Page.navigate', { url: `${baseOf(name)}${path}` });
    if (name === 'kit') await sleep(1500); // the library shows a placeholder as a component
    else await settled(name === 'event' || name === 'overview' ? 3000 : 1800);
    const r = await evaluate(CHECK);
    report.push({ viewport: vp.id, page: name, ...r });
    // the first screen, as the device shows it: a fixed bar stays where the viewer sees it
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: vp.dpr > 1 ? Math.min(vp.dpr, 2) / vp.dpr : 1 } });
    if (shot.result?.data) writeFileSync(join(outDir, `${vp.id}--${name}.png`), Buffer.from(shot.result.data, 'base64'));
  }
}
// dark theme: three pages on the three devices
for (const vp of VIEWPORTS.filter((v) => ['phone-portrait', 'tablet-portrait', 'desktop'].includes(v.id))) {
  await send('Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, mobile: vp.touch });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'pointer', value: vp.touch ? 'coarse' : 'fine' }] });
  for (const [name, path] of PAGES.filter(([n]) => ['overview', 'event', 'alerts'].includes(n))) {
    if (ONLY && !ONLY.includes(`${vp.id}--${name}--dark`)) continue;
    await send('Page.navigate', { url: `${baseOf(name)}/privacy` });
    await sleep(500);
    await evaluate(`localStorage.setItem('npm-monitor.display', ${JSON.stringify(JSON.stringify({ theme: 'dark', scale: '100' }))})`);
    await send('Page.navigate', { url: `${baseOf(name)}${path}` });
    await settled(3000);
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: vp.width, height: vp.height, scale: vp.dpr > 1 ? Math.min(vp.dpr, 2) / vp.dpr : 1 } });
    if (shot.result?.data) writeFileSync(join(outDir, `${vp.id}--${name}--dark.png`), Buffer.from(shot.result.data, 'base64'));
  }
}

await send('Browser.close').catch(() => {});
ws.close();
browser.kill();
await sleep(500);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold a file */ }

writeFileSync(join(outDir, 'audit.json'), `${JSON.stringify({ base: 'dashboard under audit', date: new Date().toISOString().slice(0, 10), viewports: VIEWPORTS, report }, null, 1)}\n`);
let failed = 0;
for (const vp of VIEWPORTS) {
  const rows = report.filter((r) => r.viewport === vp.id);
  const overflow = rows.filter((r) => r.overflow > 1);
  // the component library is a reference page outside the application frame
  const noNav = rows.filter((r) => !r.navInView && r.page !== 'kit');
  const small = vp.touch ? rows.reduce((s, r) => s + r.smallCount, 0) : 0;
  if (overflow.length || noNav.length || small) failed++;
  console.log(`${vp.label.padEnd(30)} ${vp.width}x${vp.height}  pages ${rows.length}  horizontal overflow ${overflow.length}  navigation missing ${noNav.length}${vp.touch ? `  targets under 44 px ${small}` : ''}`);
  for (const r of overflow) console.log(`    overflow ${r.page}: +${r.overflow}px`);
  if (vp.touch) for (const r of rows.filter((x) => x.smallCount)) console.log(`    small on ${r.page}: ${r.small.join(' | ')}`);
}
console.log(failed === 0 ? 'RESULT: all checks pass' : `RESULT: ${failed} viewport(s) with findings`);
process.exit(failed === 0 ? 0 : 1);
