// Enrichment of one candidate: packument → registry analysis → external sources within budget
// → final score. The metadata snapshot is stored immediately: the registry purges malicious
// versions, and later there would be no evidence left.

import { type Feature, scoreOf } from '../lib/feature.ts';
import {
  type Analysis,
  analyzeDepsDev,
  analyzeDomain,
  analyzeEcoMaintainer,
  analyzeEcoPackage,
  analyzeGithubCommit,
  customDomain,
  type DomainInfo,
  parseRdap,
} from './external.ts';
import type { Stage2FeatureId, Stage2Params } from './params.ts';
import { analyzeRegistry, type RegistryAnalysis } from './registry.ts';
import type { Outcome, Sources } from './sources.ts';

export interface Candidate {
  seq: number;
  package: string;
  prescore: number;
  observedAt: Date;
  observedAfter: Date | null;
  prevObservedAt: Date | null; // the previous event of the same package
  watchlist?: boolean; // stage 1 put the package on the watchlist
}

// The alert rule. An alert needs stage-2 evidence worth at least alertEvidenceMin: a
// metadata-only event whose stage-1 prescore alone crosses the threshold (dist-tag churn), or a
// burst plus one 0.5–1 feature (multi_branch, repo_missing), is a candidate, not an alert. A
// package already gone from the registry is not alerted on either: there is no snapshot to
// show. A watchlist package needs the evidence only, not the final score.
export function isAlert(x: { finalScore: number; evidence: number; kind: string; watchlist: boolean }, p: Stage2Params): boolean {
  if (x.kind === 'package_missing' || x.evidence < p.alertEvidenceMin) return false;
  return x.finalScore >= p.alertThreshold || (x.watchlist && x.evidence >= p.watchlistEvidenceMin);
}

// Evidence: the stage-2 weights without the features that only confirm the registry acted.
export function evidenceOf(features: Feature[], p: Stage2Params): number {
  return scoreOf(features.filter((f) => !p.confirmationFeatures.includes(f.id as Stage2FeatureId)));
}

export interface Stage2Outcome {
  seq: number;
  package: string;
  eventTime: Date;
  kind: RegistryAnalysis['kind'] | 'error';
  versions: string[];
  prescore: number;
  finalScore: number;
  alert: boolean;
  features: Feature[];
  evidence: Record<string, unknown>;
  sources: Record<string, unknown>;
}

export interface DomainCache {
  get(domain: string): Promise<DomainInfo | null>;
  set(domain: string, info: DomainInfo): Promise<void>;
}

const IMPRECISE_SPAN_MS = 10 * 60_000;

function describe<T>(o: Outcome<T>): Record<string, unknown> {
  return o.ok ? { status: o.status } : { skipped: o.reason, ...(o.error ? { error: o.error } : {}) };
}

export async function enrichCandidate(
  c: Candidate,
  src: Sources,
  domains: DomainCache,
  p: Stage2Params,
  now = Date.now(),
): Promise<Stage2Outcome | 'defer' | 'retry'> {
  const pack = await src.packument(c.package);
  if (!pack.ok) return 'retry';

  // A version is released before it reaches the feed, but not after the collector received
  // the event; versions before the previous event of the same package belong to that event.
  const lower = (c.observedAfter?.getTime() ?? c.observedAt.getTime() - IMPRECISE_SPAN_MS) - p.feedLagMs;
  const span = {
    from: Math.max(lower, c.prevObservedAt ? c.prevObservedAt.getTime() + 1 : lower),
    to: c.observedAt.getTime() + p.clockSkewMs,
  };
  const reg = analyzeRegistry(pack.body, span, p);
  // The registry CDN serves the packument with a delay: the fresh version may not be in it yet.
  if (reg.kind === 'metadata' && now - c.observedAt.getTime() < p.missingVersionRetryMs) return 'defer';

  const sources: Record<string, unknown> = { registry: describe(pack) };
  const extra: Record<string, Analysis> = {};
  const tasks: Promise<void>[] = [];
  const run = <T>(name: string, req: Promise<Outcome<T>>, analyze: (body: T | null, status: number) => Analysis) =>
    tasks.push(
      req.then((o) => {
        sources[name] = describe(o);
        if (o.ok) extra[name] = analyze(o.body, o.status);
      }),
    );

  const primary = reg.primary;
  const publishTime = reg.publishTime;
  if (reg.kind === 'publish' && primary && reg.primaryVersion && publishTime !== null) {
    run('ecosystems_package', src.ecoPackage(c.package), (b) => analyzeEcoPackage(b, publishTime, p));
    run('depsdev', src.depsdevVersion(c.package, reg.primaryVersion), (b) => analyzeDepsDev(b, reg.repo, p));

    const user = primary._npmUser;
    if (user?.name && !user.trustedPublisher) {
      run('ecosystems_publisher', src.ecoMaintainer(user.name), (b) => analyzeEcoMaintainer(b, publishTime, reg.mature, p));
    }
    if (reg.repo && primary.gitHead) {
      const repo = reg.repo;
      const sha = primary.gitHead;
      run('github_commit', src.githubCommit(repo.owner, repo.name, sha), (_b, status) => analyzeGithubCommit(status, repo, sha, p));
    }
    const domain = customDomain(user?.trustedPublisher ? null : user?.email);
    if (domain) {
      tasks.push(
        (async () => {
          let info = await domains.get(domain);
          if (info) {
            sources.rdap = { cached: true };
          } else {
            const o = await src.rdap(domain);
            sources.rdap = describe(o);
            if (!o.ok) return;
            info = parseRdap(o.status, o.body);
            await domains.set(domain, info);
          }
          extra.rdap = analyzeDomain(domain, info, publishTime, now, p);
        })(),
      );
    }
  }
  await Promise.all(tasks);

  const features = [...reg.features, ...Object.values(extra).flatMap((a) => a.features)];
  const finalScore = c.prescore + scoreOf(features);
  return {
    seq: c.seq,
    package: c.package,
    eventTime: c.observedAt,
    kind: reg.kind,
    versions: reg.versions,
    prescore: c.prescore,
    finalScore,
    alert: isAlert({ finalScore, evidence: evidenceOf(features, p), kind: reg.kind, watchlist: c.watchlist === true }, p),
    features,
    evidence: { registry: reg.evidence, ...Object.fromEntries(Object.entries(extra).map(([k, a]) => [k, a.evidence])) },
    sources,
  };
}
