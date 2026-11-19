// Features from external sources. Pure functions over responses already received.

import type { Feature } from '../lib/feature.ts';
import type { Stage2FeatureId, Stage2Params } from './params.ts';
import type { GithubRepo } from './registry.ts';

const DAY = 86_400_000;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const time = (v: unknown): number | null => {
  const s = str(v);
  const t = s ? Date.parse(s) : Number.NaN;
  return Number.isNaN(t) ? null : t;
};

function mk(p: Stage2Params, id: Stage2FeatureId, lane: string, value: Feature['value'], detail?: Record<string, unknown>): Feature {
  return { id, lane, weight: p.weights[id], value, ...(detail ? { detail } : {}) };
}

export interface Analysis {
  features: Feature[];
  evidence: Record<string, unknown>;
}

// ecosyste.ms /packages/<name>: repository state from their cache — no GitHub quota spent.
export function analyzeEcoPackage(body: unknown, publishTime: number, p: Stage2Params): Analysis {
  const repo = obj(obj(body)?.repo_metadata);
  if (!repo) return { features: [], evidence: { found: body !== null, repo: null } };
  const pushedAt = time(repo.pushed_at);
  const syncedAt = str(repo.last_synced_at);
  const features: Feature[] = [];
  if (repo.archived === true) features.push(mk(p, 'repo_archived', 'repository', true));
  if (pushedAt !== null) {
    const days = Math.floor((publishTime - pushedAt) / DAY);
    if (days >= p.repoInactiveDays) features.push(mk(p, 'repo_inactive', 'repository', days, { pushedAt: repo.pushed_at, syncedAt }));
  }
  return {
    features,
    evidence: {
      found: true,
      repo: str(repo.full_name),
      archived: repo.archived === true,
      pushedAt: str(repo.pushed_at),
      syncedAt,
      stars: repo.stargazers_count ?? null,
    },
  };
}

// ecosyste.ms /maintainers/<login>: created_at — when the account first appeared in their index
// (not the npm registration date, but for accounts younger than the index — a lower bound of age).
export function analyzeEcoMaintainer(body: unknown, publishTime: number, mature: boolean, p: Stage2Params): Analysis {
  const m = obj(body);
  if (!m) return { features: [], evidence: { found: false } };
  const firstSeen = time(m.created_at);
  const features: Feature[] = [];
  if (firstSeen !== null && mature) {
    const days = Math.floor((publishTime - firstSeen) / DAY);
    if (days < p.publisherRecentDays) features.push(mk(p, 'publisher_recent', 'publisher', days, { firstSeen: m.created_at }));
  }
  return { features, evidence: { found: true, firstSeen: str(m.created_at), packages: m.packages_count ?? null } };
}

// deps.dev: the source repository confirmed by attestation against the one declared in the manifest.
export function analyzeDepsDev(body: unknown, declared: GithubRepo | null, p: Stage2Params): Analysis {
  const v = obj(body);
  if (!v) return { features: [], evidence: { found: false } };
  const related = Array.isArray(v.relatedProjects) ? v.relatedProjects.map(obj).filter((x): x is Json => x !== null) : [];
  const attested = related
    .filter((r) => r.relationType === 'SOURCE_REPO' && str(r.relationProvenance) !== 'UNVERIFIED_METADATA')
    .map((r) => str(obj(r.projectKey)?.id))
    .filter((x): x is string => x !== null);
  const features: Feature[] = [];
  const declaredId = declared ? `github.com/${declared.owner}/${declared.name}` : null;
  const mismatch = attested.find((a) => a.toLowerCase().startsWith('github.com/') && declaredId !== null && a.toLowerCase() !== declaredId);
  if (mismatch) features.push(mk(p, 'provenance_repo_mismatch', 'repository', mismatch, { declared: declaredId }));
  const attestations = Array.isArray(v.attestations) ? v.attestations.length : 0;
  const slsa = Array.isArray(v.slsaProvenances) ? v.slsaProvenances.length : 0;
  return { features, evidence: { found: true, attestedSource: attested, attestations, slsaProvenances: slsa } };
}

// GitHub: does the commit the version was published from exist in the declared repository.
export function analyzeGithubCommit(status: number, repo: GithubRepo, sha: string, p: Stage2Params): Analysis {
  const where = `${repo.owner}/${repo.name}`;
  if (status === 200) return { features: [], evidence: { repo: where, sha, found: true } };
  if (status === 422) return { features: [mk(p, 'git_head_unknown', 'repository', sha, { repo: where })], evidence: { repo: where, sha, found: false } };
  if (status === 404) return { features: [mk(p, 'repo_missing', 'repository', where)], evidence: { repo: where, sha, repoFound: false } };
  return { features: [], evidence: { repo: where, sha, status } };
}

export interface DomainInfo {
  status: number; // 200 — record exists, 404 — none (or a TLD without RDAP)
  registered: string | null;
  expires: string | null;
}

export function parseRdap(status: number, body: unknown): DomainInfo {
  const events = Array.isArray(obj(body)?.events) ? (obj(body)!.events as unknown[]).map(obj) : [];
  const at = (action: string) => str(events.find((e) => e?.eventAction === action)?.eventDate);
  return { status, registered: at('registration'), expires: at('expiration') };
}

// The publisher's e-mail domain: a fresh registration or an expired term — a path to account
// takeover via password recovery.
export function analyzeDomain(domain: string, info: DomainInfo, publishTime: number, now: number, p: Stage2Params): Analysis {
  const features: Feature[] = [];
  const registered = info.registered ? Date.parse(info.registered) : Number.NaN;
  const expires = info.expires ? Date.parse(info.expires) : Number.NaN;
  if (!Number.isNaN(registered)) {
    const days = Math.floor((publishTime - registered) / DAY);
    if (days < p.domainYoungDays) features.push(mk(p, 'email_domain_young', 'maintainers', days, { domain, registered: info.registered }));
  }
  if (!Number.isNaN(expires) && expires < now) features.push(mk(p, 'email_domain_expired', 'maintainers', domain, { expires: info.expires }));
  return { features, evidence: { domain, ...info } };
}

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'pm.me', 'aol.com', 'gmx.com', 'gmx.net',
  'gmx.de', 'web.de', 'mail.ru', 'yandex.ru', 'yandex.com', 'ya.ru', 'qq.com', '163.com', '126.com', 'foxmail.com',
  'zoho.com', 'fastmail.com', 'hey.com', 'tutanota.com', 'tuta.io', 'duck.com', 'users.noreply.github.com',
]);

// Domain for RDAP, unless the e-mail belongs to a mass provider.
export function customDomain(email: string | undefined | null): string | null {
  const m = email ? /@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(email.trim()) : null;
  if (!m) return null;
  const domain = m[1]!.toLowerCase();
  if (FREE_MAIL.has(domain) || domain.endsWith('.noreply.github.com')) return null;
  // registrable domain: a.b.example.com → example.com, mail.example.co.uk → example.co.uk
  const labels = domain.split('.');
  const take = SECOND_LEVEL.has(labels.slice(-2).join('.')) ? 3 : 2;
  return labels.slice(-take).join('.');
}

const SECOND_LEVEL = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'ne.jp', 'or.jp',
  'com.br', 'com.cn', 'net.cn', 'org.cn', 'co.in', 'co.kr', 'com.tr', 'com.mx', 'com.ar', 'co.za', 'com.ua',
]);
