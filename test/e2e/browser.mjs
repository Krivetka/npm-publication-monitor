// A small driver for a headless Chromium browser over the DevTools protocol, enough for the
// end-to-end tests: open a page, wait for something, click, type, read. It uses the `ws`
// package the server already depends on; no test framework is downloaded.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import WebSocket from 'ws';

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
export const browserPath = () => CANDIDATES.find((p) => p && existsSync(p)) ?? null;

export async function launch({ width = 1280, height = 900 } = {}) {
  const exe = browserPath();
  if (!exe) throw new Error('no Chromium browser found; set BROWSER_PATH');
  const profile = mkdtempSync(join(tmpdir(), 'npm-monitor-e2e-'));
  const port = 9600 + Math.floor(Math.random() * 300);
  const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', `--window-size=${width},${height}`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page');
    } catch {
      await sleep(250);
    }
  }
  if (!target) throw new Error('the browser did not open a page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
    if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.result?.exceptionDetails) throw new Error(`in the page: ${res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text}`);
    return res.result?.result?.value;
  };
  const q = (selector) => JSON.stringify(selector);

  // Waits until the expression is truthy in the page; the error names what was waited for.
  const waitFor = async (expression, what = expression, timeoutMs = 15_000) => {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const value = await evaluate(expression).catch(() => null);
      if (value) return value;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}; the page shows: ${String(await evaluate('document.body.innerText').catch(() => '')).slice(0, 300)}`);
      await sleep(100);
    }
  };

  return {
    consoleErrors,
    evaluate,
    waitFor,
    open: async (url) => {
      await send('Page.navigate', { url });
      await waitFor('document.readyState === "complete"', `the page ${url}`);
    },
    waitForSelector: (selector, timeoutMs) => waitFor(`!!document.querySelector(${q(selector)})`, `the element ${selector}`, timeoutMs),
    waitForText: (text, timeoutMs) => waitFor(`document.body.innerText.includes(${q(text)})`, `the text "${text}"`, timeoutMs),
    text: (selector) => evaluate(`(document.querySelector(${q(selector)})?.innerText ?? '').trim()`),
    count: (selector) => evaluate(`document.querySelectorAll(${q(selector)}).length`),
    exists: (selector) => evaluate(`!!document.querySelector(${q(selector)})`),
    path: () => evaluate('location.pathname + location.search'),
    click: async (selector) => {
      await waitFor(`!!document.querySelector(${q(selector)})`, `the element ${selector}`);
      await evaluate(`document.querySelector(${q(selector)}).click()`);
    },
    // Types into a controlled input: the value goes through the native setter, then the input
    // event the framework listens to is fired.
    fill: async (selector, value) => {
      await waitFor(`!!document.querySelector(${q(selector)})`, `the field ${selector}`);
      await evaluate(
        `(() => { const el = document.querySelector(${q(selector)}); const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`,
      );
    },
    submit: (selector) => evaluate(`document.querySelector(${q(selector)}).requestSubmit()`),
    close: async () => {
      await send('Browser.close').catch(() => {});
      ws.close();
      proc.kill();
      await sleep(300);
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        /* the browser may still hold a file */
      }
    },
  };
}
