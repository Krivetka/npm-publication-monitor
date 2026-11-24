// REST client for /api/v1 (contract: src/api/openapi.ts). Field names are snake_case as served.

import { buildQuery } from './router.js';

export const BASE = (typeof document !== 'undefined' && document.documentElement.dataset.base) || '/npm';
const API = `${BASE}/api/v1`;
const TOKEN_KEY = 'npm-monitor.analyst-token';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// One observer for every failed request (the application sets it to the toast of errors.js).
// Only failures the reader cannot repair in a form are reported here: no connection and 5xx.
let onFailure = null;
export function setFailureHandler(fn) {
  onFailure = fn;
}

async function call(method, path, { query, body, auth } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (!token) throw new ApiError(401, 'analyst token required');
    headers.authorization = `Bearer ${token}`;
  }
  let res;
  try {
    res = await fetch(`${API}${path}${query ? buildQuery(query) : ''}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    // the request did not reach the server; status 0 tells it from a defect of the page
    const error = new ApiError(0, e?.message || 'network error');
    if (onFailure) onFailure(error);
    throw error;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const error = new ApiError(res.status, data?.error || `HTTP ${res.status}`);
    if (res.status >= 500 && onFailure) onFailure(error);
    throw error;
  }
  return data;
}

const get = (path, query) => call('GET', path, { query });

export const api = {
  status: () => get('/status'),
  health: () => get('/health'),
  events: (q) => get('/events', q),
  event: (seq) => get(`/events/${encodeURIComponent(seq)}`),
  packageEvents: (name, limit = 200) => get(`/packages/${encodeURIComponent(name)}/events`, { limit }),
  maintainerHistory: (name) => get(`/packages/${encodeURIComponent(name)}/maintainers`),
  totals: (hours = 24) => get('/stats/totals', { hours }),
  hourly: (hours = 48) => get('/stats/hourly', { hours }),
  pulse: () => get('/stats/pulse'),
  featureCounts: (hours = 24) => get('/stats/features', { hours }),
  sourceUsage: (hours = 24) => get('/stats/sources', { hours }),
  featureCatalogue: () => get('/features'),
  findings: (verdict) => get('/findings', verdict ? { verdict } : undefined),
  dependencyAlerts: (packages, days = 14) => call('POST', '/alerts/query', { body: { packages, days } }),
  putFinding: (seq, body) => call('PUT', `/events/${encodeURIComponent(seq)}/finding`, { body, auth: true }),
  deleteFinding: (seq) => call('DELETE', `/events/${encodeURIComponent(seq)}/finding`, { auth: true }),
};

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}
export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the token lives for this page only */
  }
}

// Merge a stage message from the WebSocket into an Event row (immutable update).
export function applyStage(row, msg) {
  if (!row || row.seq !== msg.seq) return row;
  if (msg.type === 'stage1') return { ...row, stage1: msg.stage1 };
  if (msg.type === 'stage2') return { ...row, stage2: msg.stage2 };
  return row;
}
