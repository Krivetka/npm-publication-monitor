// Request validation for the REST API: query parameters, path parameters and bodies.
// Every rejection is an ApiError with the HTTP status the client should see.

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function intParam(params: URLSearchParams, name: string, opts: { min?: number; max?: number; def?: number } = {}): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw === '') return opts.def;
  if (!/^-?\d+$/.test(raw)) throw new ApiError(400, `${name}: expected an integer`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) throw new ApiError(400, `${name}: out of range`);
  if (opts.min !== undefined && n < opts.min) throw new ApiError(400, `${name}: must be >= ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new ApiError(400, `${name}: must be <= ${opts.max}`);
  return n;
}

export function numberParam(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw === '') return undefined;
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n)) throw new ApiError(400, `${name}: expected a number`);
  return n;
}

export function boolParam(params: URLSearchParams, name: string): boolean | undefined {
  const raw = params.get(name);
  if (raw === null || raw === '') return undefined;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new ApiError(400, `${name}: expected true or false`);
}

export function stringParam(params: URLSearchParams, name: string, maxLength = 214): string | undefined {
  const raw = params.get(name);
  if (raw === null || raw === '') return undefined;
  if (raw.length > maxLength) throw new ApiError(400, `${name}: too long`);
  return raw;
}

export interface ListParams {
  before?: number;
  after?: number;
  limit: number;
}

export function listParams(params: URLSearchParams, defaultLimit = 100): ListParams {
  const before = intParam(params, 'before', { min: 0 });
  const after = intParam(params, 'after', { min: 0 });
  if (before !== undefined && after !== undefined) throw new ApiError(400, 'before and after are mutually exclusive');
  const limit = intParam(params, 'limit', { min: 1, max: 500, def: defaultLimit })!;
  return { before, after, limit };
}

export function seqParam(raw: string): number {
  if (!/^\d{1,18}$/.test(raw)) throw new ApiError(400, 'seq: expected a positive integer');
  return Number(raw);
}

// Package names: npm rules (lower case, ≤ 214 chars, optional @scope/).
const PACKAGE_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function packageParam(raw: string): string {
  const name = decodeURIComponent(raw);
  if (name.length > 214 || !PACKAGE_RE.test(name)) throw new ApiError(400, 'invalid package name');
  return name;
}

export const VERDICTS = ['confirmed', 'false_positive', 'undecided'] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface FindingBody {
  verdict: Verdict;
  note: string | null;
  reference: string | null;
}

export function findingBody(body: unknown): FindingBody {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ApiError(400, 'body must be a JSON object');
  const b = body as Record<string, unknown>;
  if (!VERDICTS.includes(b.verdict as Verdict)) throw new ApiError(400, `verdict must be one of ${VERDICTS.join(', ')}`);
  const text = (key: string, max: number): string | null => {
    const v = b[key];
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string') throw new ApiError(400, `${key} must be a string`);
    if (v.length > max) throw new ApiError(400, `${key} is longer than ${max} characters`);
    return v;
  };
  return { verdict: b.verdict as Verdict, note: text('note', 2000), reference: text('reference', 500) };
}

export interface DependencyQuery {
  packages: string[];
  days: number;
}

export const MAX_DEPENDENCIES = 10_000;

// The dependency list of one consumer: names only. Legacy names (upper case) are allowed,
// so only the type and the length are checked; a name is matched as it is.
export function dependencyQuery(body: unknown): DependencyQuery {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ApiError(400, 'body must be a JSON object');
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.packages) || b.packages.length === 0) throw new ApiError(400, 'packages must be a non-empty array of package names');
  if (b.packages.length > MAX_DEPENDENCIES) throw new ApiError(400, `packages: at most ${MAX_DEPENDENCIES} names`);
  for (const n of b.packages) {
    if (typeof n !== 'string' || n.length === 0 || n.length > 214) throw new ApiError(400, 'packages: every name must be a string of 1 to 214 characters');
  }
  const days = b.days === undefined ? 14 : b.days;
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 90) throw new ApiError(400, 'days must be an integer from 1 to 90');
  return { packages: [...new Set(b.packages as string[])], days };
}
