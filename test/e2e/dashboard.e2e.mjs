// End-to-end tests of the dashboard: a real browser, the real web process, a real PostgreSQL
// loaded with the test data of the repository.
//
//   docker compose -f compose.dev.yml up -d
//   npm run test:e2e
//
// The suite makes its own database (npm_monitor_e2e on the server of E2E_ADMIN_URL), migrates
// and seeds it, starts the web process on a free port and drives a headless Chromium. Set
// E2E_BUNDLE=1 to test the production bundle (run `npm run build:web` first); without it the
// source modules are served. The suite is skipped when no browser or no database is there.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, renameSync } from 'node:fs';
import { createServer } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import postgres from 'postgres';
import { browserPath, launch } from './browser.mjs';

const ADMIN = process.env.E2E_ADMIN_URL ?? 'postgres://npm_monitor:dev@127.0.0.1:55432/postgres';
const DB = 'npm_monitor_e2e';
const DB_URL = ADMIN.replace(/\/[^/]*$/, `/${DB}`);
const TOKEN = randomBytes(24).toString('hex');
const DIST = 'src/web/static/dist';

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
const run = (script, env) =>
  new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [script], { env: { ...process.env, DATABASE_URL: DB_URL, DATABASE_URL_ADMIN: DB_URL, LOG_LEVEL: 'warn', ...env }, stdio: ['ignore', 'ignore', 'inherit'] });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited with ${code}`))));
  });

let reason = null;
if (!browserPath()) reason = 'no Chromium browser found (set BROWSER_PATH)';
let admin = null;
if (!reason) {
  try {
    admin = postgres(ADMIN, { max: 1, onnotice: () => {}, connect_timeout: 5 });
    await admin`select 1`;
  } catch (e) {
    reason = `no database at E2E_ADMIN_URL (${e.code ?? e.message})`;
    admin = null;
  }
}

describe('dashboard, end to end', { skip: reason ?? false }, () => {
  let web = null;
  let browser = null;
  let base = '';
  let hidDist = false;

  before(async () => {
    await admin.unsafe(`drop database if exists ${DB} with (force)`);
    await admin.unsafe(`create database ${DB}`);
    await run('src/migrate.ts');
    await run('src/db/seed.ts');
    // without E2E_BUNDLE the source modules are tested even when a bundle lies in the tree
    if (process.env.E2E_BUNDLE !== '1' && existsSync(DIST)) {
      renameSync(DIST, `${DIST}.off`);
      hidDist = true;
    }
    const port = await freePort();
    base = `http://127.0.0.1:${port}/npm`;
    web = spawn(process.execPath, ['src/web/main.ts'], { env: { ...process.env, DATABASE_URL: DB_URL, DATABASE_URL_WEB: DB_URL, WEB_PORT: String(port), ANALYST_TOKEN: TOKEN, LOG_LEVEL: 'warn' }, stdio: ['ignore', 'ignore', 'inherit'] });
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(`${base}/api/v1/status`)).ok) break;
      } catch {
        /* not up yet */
      }
      await sleep(250);
    }
    browser = await launch();
  });

  after(async () => {
    await browser?.close();
    web?.kill();
    if (hidDist) renameSync(`${DIST}.off`, DIST);
    await sleep(300);
    await admin.unsafe(`drop database if exists ${DB} with (force)`).catch(() => {});
    await admin.end();
  });

  it('an analyst opens an alert, the form refuses an unexplained confirmation, then stores the verdict', async () => {
    await browser.open(`${base}/alerts`);
    await browser.waitForSelector('main table tr td a');
    assert.equal(await browser.text('h1'), 'Alerts');
    assert.ok((await browser.count('main table tr')) >= 3, 'the seeded alerts are listed');

    // the newest alert of the test data has no verdict yet
    await browser.click('main table tr td a[href$="/event/1014"]');
    await browser.waitForText('Why this score');
    assert.equal(await browser.path(), '/npm/event/1014', 'the router changed the address without a reload');
    assert.ok((await browser.text('h1')).includes('@acme/widgets'));
    await browser.waitForSelector('form.verdict-box');

    // a confirmed verdict without a note or a reference is refused in the browser
    const before = (await (await fetch(`${base}/api/v1/findings`)).json()).length;
    await browser.click('form.verdict-box .vbtn.confirmed');
    await browser.fill('#vc-token', TOKEN);
    await browser.submit('form.verdict-box');
    await browser.waitForSelector('#vc-note-error');
    assert.match(await browser.text('#vc-note-error'), /needs a note or a reference/);
    assert.equal((await (await fetch(`${base}/api/v1/findings`)).json()).length, before, 'nothing was sent');

    // a wrong token: the server answers 401, the form says so and asks again
    await browser.fill('#vc-note', 'new package with a preinstall script and a look-alike scope');
    await browser.fill('#vc-token', 'f'.repeat(48));
    await browser.submit('form.verdict-box');
    await browser.waitForSelector('.form-status.error');
    assert.match(await browser.text('.form-status.error'), /token is missing or wrong/);
    assert.ok(await browser.exists('#vc-token'), 'the token is asked again');

    // the right token: stored, confirmed by a toast, shown after a reload
    await browser.fill('#vc-token', TOKEN);
    await browser.submit('form.verdict-box');
    await browser.waitForSelector('.form-status.ok');
    assert.equal(await browser.text('.form-status.ok'), 'Verdict stored.');
    await browser.waitForSelector('.toast.ok');
    const stored = (await (await fetch(`${base}/api/v1/findings`)).json()).find((f) => f.seq === 1014);
    assert.equal(stored.verdict, 'confirmed');
    assert.equal(stored.note, 'new package with a preinstall script and a look-alike scope');

    await browser.open(`${base}/event/1014`);
    await browser.waitForSelector('form.verdict-box');
    assert.equal(await browser.evaluate('document.querySelector("#vc-note").value'), stored.note);
    assert.ok(!(await browser.exists('#vc-token')), 'the token is kept in the browser, the field is gone');
  });

  it('a consumer gives a dependency list and gets only the alerts on these packages', async () => {
    await browser.open(`${base}/dependencies`);
    await browser.evaluate('localStorage.removeItem("npm-monitor.dependencies")');
    await browser.open(`${base}/dependencies`);
    await browser.waitForSelector('#dep-text');

    // an empty list is refused with a message
    await browser.submit('form.dep-form');
    await browser.waitForSelector('.dep-error');
    assert.match(await browser.text('.dep-error'), /No package name found/);

    // a package.json with one package that has an alert and one that has none
    await browser.fill('#dep-text', JSON.stringify({ dependencies: { '@acme/widgets': '^0.1.0', 'left-pad': '^1.3.0' } }));
    await browser.submit('form.dep-form');
    await browser.waitForText('2 packages');
    await browser.waitForSelector('main table tr td a');
    const packages = await browser.evaluate('[...document.querySelectorAll("main table td.pkg a")].map((a) => a.textContent)');
    assert.deepEqual([...new Set(packages)], ['@acme/widgets'], 'only the alert on a listed package');
    assert.ok((await browser.text('.lead')).includes('1 alert'));

    // the list survives a reload: it is kept in the browser
    await browser.open(`${base}/dependencies`);
    await browser.waitForText('2 packages');
  });

  it('wrong input and wrong addresses get a clear message, and nothing fails silently', async () => {
    await browser.open(`${base}/`);
    await browser.waitForSelector('#pkg');
    await browser.fill('#pkg', 'Not A Name');
    await browser.submit('form.search');
    await browser.waitForSelector('#pkg-error');
    assert.match(await browser.text('#pkg-error'), /no spaces/);
    assert.equal(await browser.path(), '/npm/', 'an invalid name does not navigate');

    // a valid name of a package that is not in the journal: the page says so
    await browser.fill('#pkg', 'no-such-package-in-the-journal');
    await browser.submit('form.search');
    await browser.waitForText('No events of this package');
    assert.equal(await browser.path(), '/npm/package/no-such-package-in-the-journal');

    // an event that does not exist
    await browser.open(`${base}/event/999999999`);
    await browser.waitForText('Not found');
    assert.ok(await browser.exists('[role="alert"]'));

    // an address that is not a route
    await browser.open(`${base}/nothing-here`);
    await browser.waitForText('Not found');

    assert.deepEqual(browser.consoleErrors, [], 'no uncaught exception in the page');
  });
});
