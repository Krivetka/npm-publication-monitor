// REST API router: every path under `${base}/api`. Returns false for paths it does not own,
// so the caller can fall through to static files and the SSR pages.

import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Sql } from '../db.ts';
import { status as loadStatus } from '../web/queries.ts';
import * as q from '../web/queries.ts';
import { featureCatalogue } from './catalogue.ts';
import { openapi } from './openapi.ts';
import * as api from './queries.ts';
import { healthFrom, toStatus } from './serialize.ts';
import { swaggerInit, swaggerPage } from './swagger.ts';
import { ApiError, boolParam, dependencyQuery, findingBody, intParam, listParams, numberParam, packageParam, seqParam, stringParam } from './validate.ts';

export interface ApiDeps {
  sql: Sql;
  base: string;
  analystToken: string | null;
  headers: Record<string, string>;
}

const MAX_BODY = 16 * 1024;
// a dependency list of 10 000 names
const MAX_LIST_BODY = 512 * 1024;

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string>, head = false): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(text)), 'cache-control': 'no-store', ...headers });
  res.end(head ? undefined : text);
}

async function readJson(req: IncomingMessage, max = MAX_BODY): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new ApiError(413, 'body too large');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') throw new ApiError(400, 'empty body');
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, 'body is not valid JSON');
  }
}

export function checkBearer(header: string | undefined, token: string | null): boolean {
  if (!token || !header) return false;
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) return false;
  const a = Buffer.from(m[1]!);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApi(deps: ApiDeps) {
  const { sql, base, headers } = deps;
  const prefix = `${base}/api`;
  const v1 = `${prefix}/v1`;

  async function dispatch(req: IncomingMessage, res: ServerResponse, url: URL, head: boolean): Promise<void> {
    const method = head ? 'GET' : (req.method ?? 'GET');
    const path = url.pathname;
    const p = url.searchParams;
    const json = (status: number, body: unknown) => sendJson(res, status, body, headers, head);

    // documentation
    if (path === `${prefix}/docs` || path === `${prefix}/docs/`) {
      const html = swaggerPage(base);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', ...headers });
      return void res.end(head ? undefined : html);
    }
    if (path === `${prefix}/docs/init.js`) {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', ...headers });
      return void res.end(head ? undefined : swaggerInit(base));
    }
    if (path === `${v1}/openapi.json`) return json(200, openapi);

    if (!path.startsWith(`${v1}/`)) throw new ApiError(404, 'no such endpoint');
    const rel = path.slice(v1.length);

    if (method === 'GET') {
      if (rel === '/status') return json(200, toStatus(await loadStatus(sql)));
      if (rel === '/health') {
        const h = healthFrom(await loadStatus(sql));
        return json(h.ok ? 200 : 503, h);
      }
      if (rel === '/events') {
        const lp = listParams(p);
        return json(200, await api.listEvents(sql, {
          ...lp,
          package: stringParam(p, 'package'),
          flagged: boolParam(p, 'flagged'),
          candidate: boolParam(p, 'candidate'),
          feature: stringParam(p, 'feature', 64),
          alert: boolParam(p, 'alert'),
          minScore: numberParam(p, 'min_score'),
        }));
      }
      const ev = /^\/events\/([^/]+)$/.exec(rel);
      if (ev) {
        const seq = seqParam(ev[1]!);
        const event = await api.eventBySeq(sql, seq);
        if (!event) throw new ApiError(404, 'no such event');
        const [stage2, packageEvents] = await Promise.all([api.stage2Full(sql, seq), api.packageEvents(sql, event.package, 30, seq)]);
        return json(200, { event, stage1: event.stage1, stage2, finding: event.finding, package_events: packageEvents });
      }
      if (rel === '/findings') {
        const verdict = stringParam(p, 'verdict', 32);
        if (verdict !== undefined && !['confirmed', 'false_positive', 'undecided'].includes(verdict)) throw new ApiError(400, 'invalid verdict');
        return json(200, await api.listFindings(sql, verdict));
      }
      const pe = /^\/packages\/([^/]+)\/events$/.exec(rel);
      if (pe) {
        const name = packageParam(pe[1]!);
        const limit = intParam(p, 'limit', { min: 1, max: 500, def: 200 })!;
        const items = await api.packageEvents(sql, name, limit);
        if (items.length === 0) throw new ApiError(404, 'no events for this package in the journal');
        return json(200, { items, next_before: null });
      }
      const pm = /^\/packages\/([^/]+)\/maintainers$/.exec(rel);
      if (pm) return json(200, await api.maintainerHistory(sql, packageParam(pm[1]!)));
      if (rel === '/stats/totals') return json(200, await api.totals(sql, intParam(p, 'hours', { min: 1, max: 720, def: 24 })!));
      if (rel === '/stats/hourly') {
        const rows = await q.hourly(sql, intParam(p, 'hours', { min: 1, max: 720, def: 48 })!);
        return json(200, rows.map((r) => ({ hour: new Date(r.hour).toISOString(), processed: r.processed, candidates: r.candidates, enriched: r.enriched, alerts: r.alerts })));
      }
      if (rel === '/stats/pulse') return json(200, (await q.pulse(sql)).map((r) => ({ minute: new Date(r.minute).toISOString(), n: r.n })));
      if (rel === '/stats/features') return json(200, await api.featureCounts(sql, intParam(p, 'hours', { min: 1, max: 720, def: 24 })!));
      if (rel === '/stats/sources') return json(200, await api.sourceUsage(sql, intParam(p, 'hours', { min: 1, max: 720, def: 24 })!));
      if (rel === '/features') return json(200, featureCatalogue());
      if (rel !== '/alerts/query') throw new ApiError(404, 'no such endpoint');
    }

    // A query, not a write: the list of names does not fit a URL, so it travels in a body.
    if (rel === '/alerts/query') {
      if (method !== 'POST') {
        res.writeHead(405, { allow: 'POST', 'content-type': 'application/json', ...headers });
        return void res.end(JSON.stringify({ error: 'method not allowed' }));
      }
      const dq = dependencyQuery(await readJson(req, MAX_LIST_BODY));
      return json(200, await api.dependencyAlerts(sql, dq.packages, dq.days));
    }

    const fin = /^\/events\/([^/]+)\/finding$/.exec(rel);
    if (fin && (method === 'PUT' || method === 'DELETE')) {
      if (!checkBearer(req.headers.authorization, deps.analystToken)) throw new ApiError(401, 'analyst token required');
      const seq = seqParam(fin[1]!);
      if (!(await api.eventExists(sql, seq))) throw new ApiError(404, 'no such event');
      if (method === 'DELETE') {
        await api.deleteFinding(sql, seq);
        res.writeHead(204, headers);
        return void res.end();
      }
      const body = findingBody(await readJson(req));
      return json(200, await api.putFinding(sql, seq, body));
    }
    if (fin) {
      res.writeHead(405, { allow: 'PUT, DELETE', 'content-type': 'application/json', ...headers });
      return void res.end(JSON.stringify({ error: 'method not allowed' }));
    }
    throw new ApiError(method === 'GET' ? 404 : 405, method === 'GET' ? 'no such endpoint' : 'method not allowed');
  }

  // true when the request was an API request (handled, successfully or with an error).
  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith(prefix + '/') && url.pathname !== prefix) return false;
    const head = req.method === 'HEAD';
    try {
      await dispatch(req, res, url, head);
    } catch (e) {
      if (e instanceof ApiError) sendJson(res, e.status, { error: e.message }, headers, head);
      else throw e;
    }
    return true;
  };
}
