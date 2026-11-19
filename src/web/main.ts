// Web process: REST API + WebSocket stream (src/api), static SPA (src/web/static) with
// history routing, vendored client libraries, Swagger UI, and the server-rendered pages as a
// fallback while the SPA is absent. Listens on 127.0.0.1 — exposed by nginx or an ssh tunnel.

import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname } from 'node:path';
import { createApi } from '../api/router.ts';
import { resolveUnder, resolveVendor, serveFile, spaIndexPath, STATIC_ROOT } from '../api/static.ts';
import { Realtime } from '../api/ws.ts';
import { loadConfig } from '../config.ts';
import { connect } from '../db.ts';
import { errFields, log } from '../log.ts';
import { buildCsp, inlineScriptHashes } from './csp.ts';
import * as pages from './pages.ts';
import * as q from './queries.ts';

const cfg = loadConfig();
const sql = connect(cfg.databaseWebUrl, 'web');
const base = cfg.web.basePath;
const ctx: pages.Ctx = { base };
const PAGE = 50;

// One policy for the SPA, the SSR pages and Swagger UI: scripts and connections only from
// this origin (the WebSocket is same-origin), inline styles allowed for charts and Swagger;
// the SPA's inline import map is allowed by its hash.
const spaShell = spaIndexPath();
const HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': buildCsp(spaShell ? inlineScriptHashes(readFileSync(spaShell, 'utf8')) : []),
};

const api = createApi({ sql, base, analystToken: cfg.web.analystToken, headers: HEADERS });
const realtime = new Realtime(sql, `${base}/api/v1/ws`);

function send(res: ServerResponse, status: number, body: string, type = 'text/html; charset=utf-8'): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...HEADERS });
  res.end(body);
}

const intParam = (v: string | null, def: number) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : def;
};

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const head = req.method === 'HEAD';

  if (path === '/healthz' || path === `${base}/healthz`) {
    res.writeHead(302, { location: `${base}/api/v1/health` });
    return void res.end();
  }
  if (await api(req, res, url)) return;

  if (req.method !== 'GET' && !head) return send(res, 405, 'method not allowed', 'text/plain');
  if (path === '/' || path === base) {
    res.writeHead(302, { location: `${base}/` });
    return void res.end();
  }
  if (!path.startsWith(`${base}/`)) return send(res, 404, pages.messagePage(ctx, 'Not found', 'There is no such page.'));
  const p = path.slice(base.length);

  // vendored client libraries and the SPA's own files
  const vendor = /^\/vendor\/([^/]+)\/(.+)$/.exec(p);
  if (vendor) {
    const abs = resolveVendor(vendor[1]!, vendor[2]!);
    if (abs && (await serveFile(res, abs, HEADERS, head))) return;
    return send(res, 404, 'not found', 'text/plain');
  }
  if (p.startsWith('/static/')) {
    const abs = resolveUnder(STATIC_ROOT, p.slice('/static/'.length));
    if (abs && (await serveFile(res, abs, HEADERS, head))) return;
    return send(res, 404, 'not found', 'text/plain');
  }

  // single-page app: index.html owns every extension-less path once it exists
  const spa = spaIndexPath();
  if (spa && extname(p) === '') {
    await serveFile(res, spa, { ...HEADERS, 'cache-control': 'no-store' }, head);
    return;
  }

  // server-rendered fallback pages
  if (p === '/') {
    const [status, totals, hours, pulse, usage, features, alerts, recent] = await Promise.all([
      q.status(sql),
      q.totals24h(sql),
      q.hourly(sql, 48),
      q.pulse(sql),
      q.sourceUsage24h(sql),
      q.featureCounts24h(sql),
      q.listEnriched(sql, { alertOnly: true, minScore: 0, offset: 0, limit: 10 }),
      q.listEnriched(sql, { alertOnly: false, minScore: 0, offset: 0, limit: 12 }),
    ]);
    return send(res, 200, pages.overviewPage(ctx, { status, totals, hours, pulse, usage, features, alerts, recent }));
  }
  if (p === '/enriched') {
    const alertOnly = url.searchParams.get('alert') === '1';
    const minScore = Math.max(0, Number((url.searchParams.get('min') ?? '').replace(',', '.')) || 0);
    const page = intParam(url.searchParams.get('page'), 1);
    const rows = await q.listEnriched(sql, { alertOnly, minScore, offset: (page - 1) * PAGE, limit: PAGE + 1 });
    return send(res, 200, pages.enrichedPage(ctx, rows, { alertOnly, minScore, page, pageSize: PAGE }));
  }
  if (p === '/flagged') {
    const feature = url.searchParams.get('feature') || null;
    const candidateOnly = url.searchParams.get('candidate') === '1';
    const page = intParam(url.searchParams.get('page'), 1);
    const [rows, counts] = await Promise.all([
      q.listFlagged(sql, { feature, candidateOnly, offset: (page - 1) * PAGE, limit: PAGE + 1 }),
      q.featureCounts24h(sql),
    ]);
    return send(res, 200, pages.flaggedPage(ctx, rows, counts, { feature, candidateOnly, page, pageSize: PAGE }));
  }
  const ev = /^\/event\/(\d+)$/.exec(p);
  if (ev) {
    const card = await q.eventCard(sql, Number(ev[1]));
    if (!card) return send(res, 404, pages.messagePage(ctx, 'Event not found', `The journal has no event with seq ${ev[1]}.`));
    const others = await q.packageEvents(sql, card.event.package, 30);
    return send(res, 200, pages.eventPage(ctx, card, others));
  }
  if (p === '/package') {
    const name = (url.searchParams.get('name') ?? '').trim();
    if (!name) return send(res, 200, pages.messagePage(ctx, 'Package', 'Enter a package name in the search box.'));
    const rows = await q.packageEvents(sql, name, 200);
    if (rows.length === 0 && name !== name.toLowerCase()) {
      const lower = await q.packageEvents(sql, name.toLowerCase(), 200);
      if (lower.length > 0) return send(res, 200, pages.packagePage(ctx, name.toLowerCase(), lower));
    }
    if (rows.length === 0) {
      return send(res, 404, pages.messagePage(ctx, name, 'The journal has no events for this package — it has not changed since observation started.'));
    }
    return send(res, 200, pages.packagePage(ctx, name, rows));
  }
  return send(res, 404, pages.messagePage(ctx, 'Not found', 'There is no such page.'));
}

const server = createServer((req, res) => {
  const started = Date.now();
  route(req, res)
    .catch((e) => {
      log.error('request failed', { ...errFields(e), url: req.url });
      if (!res.headersSent) {
        if ((req.url ?? '').startsWith(`${base}/api/`)) send(res, 500, JSON.stringify({ error: 'internal error' }), 'application/json; charset=utf-8');
        else send(res, 500, pages.messagePage(ctx, 'Error', 'Could not build the page; see the log for details.'));
      } else res.end();
    })
    .finally(() => log.debug('request', { method: req.method, url: req.url, status: res.statusCode, ms: Date.now() - started }));
});
realtime.attach(server);

server.listen(cfg.web.port, cfg.web.host, () => {
  log.info('web started', { host: cfg.web.host, port: cfg.web.port, base, spa: spaIndexPath() !== null, analystToken: cfg.web.analystToken !== null });
  realtime.start().catch((e) => log.error('realtime failed to start', errFields(e)));
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    log.info('shutdown requested', { signal });
    server.close(() => void sql.end({ timeout: 5 }).then(() => log.info('web stopped')));
    void realtime.stop();
    server.closeAllConnections();
  });
}
