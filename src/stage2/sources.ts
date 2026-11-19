// Clients of the external sources with a request budget per source and usage accounting
// (the accounting is the denominator for "how much costly analysis stage 1 removes").

import type { Packument } from './types.ts';

export type SourceName = 'registry' | 'ecosystems' | 'depsdev' | 'github' | 'rdap';
export const SOURCES: SourceName[] = ['registry', 'ecosystems', 'depsdev', 'github', 'rdap'];

const USER_AGENT = 'npm-publish-monitor/0.1 (research)';

// Token bucket: perHour requests per hour, refilled evenly.
export class Budget {
  readonly perHour: number;
  private tokens: number;
  private last: number;
  private pausedUntil = 0;

  constructor(perHour: number, now = Date.now()) {
    this.perHour = perHour;
    this.tokens = perHour;
    this.last = now;
  }

  take(now = Date.now()): boolean {
    if (now < this.pausedUntil) return false;
    this.tokens = Math.min(this.perHour, this.tokens + ((now - this.last) * this.perHour) / 3_600_000);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  pauseUntil(t: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, t);
  }
}

export interface UsageRow {
  hour: Date;
  source: SourceName;
  requests: number;
  errors: number;
  skipped: number;
}

export class Usage {
  private readonly rows = new Map<string, UsageRow>();

  note(source: SourceName, kind: 'requests' | 'errors' | 'skipped', now = Date.now()): void {
    const hour = Math.floor(now / 3_600_000) * 3_600_000;
    const key = `${hour}:${source}`;
    const row = this.rows.get(key) ?? { hour: new Date(hour), source, requests: 0, errors: 0, skipped: 0 };
    row[kind]++;
    this.rows.set(key, row);
  }

  drain(): UsageRow[] {
    const out = [...this.rows.values()];
    this.rows.clear();
    return out;
  }
}

// Outcome of a source request for the card: what was asked and how it went.
export type Outcome<T> = { ok: true; status: number; body: T | null } | { ok: false; reason: 'quota' | 'error'; error?: string };

export interface SourcesOptions {
  githubToken: string | null;
  timeoutMs: number;
  perHour: Record<SourceName, number>;
}

const enc = (name: string) => encodeURIComponent(name);

export class Sources {
  readonly usage = new Usage();
  private readonly budgets: Record<SourceName, Budget>;
  private readonly opts: SourcesOptions;

  constructor(opts: SourcesOptions) {
    this.opts = opts;
    this.budgets = Object.fromEntries(SOURCES.map((s) => [s, new Budget(opts.perHour[s])])) as Record<SourceName, Budget>;
  }

  private async get<T>(source: SourceName, url: string, headers: Record<string, string> = {}, okStatuses = [404]): Promise<Outcome<T>> {
    if (!this.budgets[source].take()) {
      this.usage.note(source, 'skipped');
      return { ok: false, reason: 'quota' };
    }
    this.usage.note(source, 'requests');
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...headers },
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
      if (source === 'github' && (res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
        const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
        this.budgets.github.pauseUntil(Number.isFinite(reset) ? reset : Date.now() + 3_600_000);
        this.usage.note(source, 'skipped');
        return { ok: false, reason: 'quota' };
      }
      if (res.ok) return { ok: true, status: res.status, body: (await res.json()) as T };
      if (okStatuses.includes(res.status)) {
        await res.body?.cancel();
        return { ok: true, status: res.status, body: null };
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      this.usage.note(source, 'errors');
      return { ok: false, reason: 'error', error: e instanceof Error ? e.message : String(e) };
    }
  }

  packument(name: string): Promise<Outcome<Packument>> {
    return this.get('registry', `https://registry.npmjs.org/${name.startsWith('@') ? `@${enc(name.slice(1))}` : enc(name)}`);
  }

  ecoPackage(name: string): Promise<Outcome<unknown>> {
    return this.get('ecosystems', `https://packages.ecosyste.ms/api/v1/registries/npmjs.org/packages/${enc(name)}`);
  }

  ecoMaintainer(login: string): Promise<Outcome<unknown>> {
    return this.get('ecosystems', `https://packages.ecosyste.ms/api/v1/registries/npmjs.org/maintainers/${enc(login)}`);
  }

  depsdevVersion(name: string, version: string): Promise<Outcome<unknown>> {
    return this.get('depsdev', `https://api.deps.dev/v3/systems/npm/packages/${enc(name)}/versions/${enc(version)}`);
  }

  githubCommit(owner: string, repo: string, sha: string): Promise<Outcome<unknown>> {
    const auth: Record<string, string> = this.opts.githubToken ? { authorization: `Bearer ${this.opts.githubToken}` } : {};
    return this.get(
      'github',
      `https://api.github.com/repos/${enc(owner)}/${enc(repo)}/commits/${enc(sha)}`,
      { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...auth },
      [404, 422],
    );
  }

  rdap(domain: string): Promise<Outcome<unknown>> {
    return this.get('rdap', `https://rdap.org/domain/${enc(domain)}`, { accept: 'application/rdap+json, application/json' });
  }
}
