// Client for the npm registry changes feed (replicate.npmjs.com/registry/_changes).
// An event carries only the package id, the document revision and the seq position.

export interface FeedChange {
  seq: number;
  id: string;
  rev: string;
  deleted: boolean;
}

export interface FeedPage {
  changes: FeedChange[];
  lastSeq: number;
}

export class FeedError extends Error {
  override name = 'FeedError';
}

const USER_AGENT = 'npm-publish-monitor/0.1 (research)';

function toSeq(v: unknown, where: string): number {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
    throw new FeedError(`${where}: invalid seq ${JSON.stringify(v)}`);
  }
  return n;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseChangesResponse(body: unknown, since: number): FeedPage {
  if (!isRecord(body) || !Array.isArray(body.results)) throw new FeedError('response has no results');

  const changes = body.results.map((r: unknown, i): FeedChange => {
    if (!isRecord(r) || typeof r.id !== 'string' || r.id === '') throw new FeedError(`results[${i}]: missing id`);
    const first = Array.isArray(r.changes) ? r.changes[0] : undefined;
    const rev = isRecord(first) && typeof first.rev === 'string' ? first.rev : '';
    return { seq: toSeq(r.seq, `results[${i}]`), id: r.id, rev, deleted: r.deleted === true };
  });

  for (let i = 1; i < changes.length; i++) {
    if (changes[i]!.seq <= changes[i - 1]!.seq) throw new FeedError(`results[${i}]: seq is not increasing`);
  }

  const lastSeq = body.last_seq !== undefined ? toSeq(body.last_seq, 'last_seq') : (changes.at(-1)?.seq ?? since);
  if (lastSeq < since) throw new FeedError(`last_seq ${lastSeq} is below since ${since}`);
  if (changes.length > 0 && changes[0]!.seq <= since) {
    throw new FeedError(`seq ${changes[0]!.seq} is not above since ${since}`);
  }

  return { changes, lastSeq };
}

async function getJson(url: string, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
  const signals = [AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])];
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    signal: AbortSignal.any(signals),
  });
  if (!res.ok) throw new FeedError(`HTTP ${res.status} ${url}`);
  return res.json();
}

export async function fetchChanges(
  baseUrl: string,
  since: number,
  limit: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<FeedPage> {
  const body = await getJson(`${baseUrl}/_changes?since=${since}&limit=${limit}`, timeoutMs, signal);
  return parseChangesResponse(body, since);
}

export async function fetchHeadSeq(baseUrl: string, timeoutMs: number, signal?: AbortSignal): Promise<number> {
  const body = await getJson(`${baseUrl}/`, timeoutMs, signal);
  if (!isRecord(body)) throw new FeedError('feed root: not an object');
  return toSeq(body.update_seq, 'update_seq');
}
