// Stage 1 engine: features are computed only from the event, the previous event of the same
// package in the journal and the engine's own window state — no network requests. The engine
// is deterministic: the same event stream yields the same results, so one code path serves
// both production and replays of the journal with injected scenarios.

import type { Feature } from '../lib/feature.ts';
import { parseName, revNumber } from './names.ts';
import type { NameIndex } from './nominal.ts';
import { engineId, type Stage1Params } from './params.ts';
import { type RateStats, WindowRate } from './rate.ts';

export interface FeedEvent {
  seq: number;
  package: string;
  rev: string;
  deleted: boolean;
  observedAt: Date;
  observedAfter: Date | null;
}

// The previous event of the same package in the journal.
export interface PrevInfo {
  seq: number;
  revN: number | null;
  time: number;
  deleted: boolean;
}

export type Lane = 'temporal' | 'nominal' | 'version' | 'watchlist';

export type { Feature };

export interface Stage1Result {
  seq: number;
  package: string;
  eventTime: Date;
  prescore: number;
  candidate: boolean;
  features: Feature[];
}

const MINUTE = 60_000;
const DAY = 86_400_000;
const PRUNE_EVERY_MIN = 30;
const round2 = (x: number): number => Math.round(x * 100) / 100;

export function prevFromEvent(e: FeedEvent): PrevInfo {
  return { seq: e.seq, revN: revNumber(e.rev), time: e.observedAt.getTime(), deleted: e.deleted };
}

export class Stage1Engine {
  readonly params: Stage1Params;
  readonly id: string;
  private names: NameIndex | null;
  private readonly journalStartMs: number;
  private readonly firstMinute: number;
  private readonly global: WindowRate;
  private readonly pkg: WindowRate;
  private readonly scope: WindowRate;
  private readonly cluster: WindowRate;
  private readonly breadth: WindowRate;
  // when a namespace last entered the breadth counter
  private readonly breadthLast = new Map<string, number>();
  private lastT = 0;
  private lastPrune = -Infinity;

  constructor(params: Stage1Params, names: NameIndex | null, journalStart: Date) {
    this.params = params;
    this.id = engineId(params);
    this.names = names;
    this.journalStartMs = journalStart.getTime();
    this.firstMinute = Math.floor(this.journalStartMs / MINUTE);
    const mk = () => new WindowRate(params.windowMin, params.historyMin, params.stdFloor);
    this.global = mk();
    this.pkg = mk();
    this.scope = mk();
    this.cluster = mk();
    this.breadth = mk();
  }

  setNames(names: NameIndex | null): void {
    this.names = names;
  }

  stateSize(): Record<string, number> {
    return { packages: this.pkg.size, scopes: this.scope.size, clusters: this.cluster.size, namespaces: this.breadthLast.size };
  }

  process(e: FeedEvent, prev: PrevInfo | null): Stage1Result | null {
    if (e.package.startsWith('_design/')) return null;
    const p = this.params;
    const t = Math.max(e.observedAt.getTime(), this.lastT);
    this.lastT = t;
    const minute = Math.floor(t / MINUTE);
    // stale buckets never enter the counts; pruning is only about memory
    if (minute - this.lastPrune >= PRUNE_EVERY_MIN) {
      this.prune(minute);
      this.lastPrune = minute;
    }

    const features: Feature[] = [];
    const revN = revNumber(e.rev);
    const precise = e.observedAfter !== null && e.observedAt.getTime() - e.observedAfter.getTime() <= p.maxPrecisionMs;

    // Version lane: document revisions and the engine's own journal.
    let updates = 1;
    if (prev) {
      if (prev.deleted && !e.deleted) {
        features.push({ id: 'rev_regression', lane: 'version', weight: p.weights.rev_regression, value: 'recreated', detail: { prevSeq: prev.seq } });
      } else if (prev.revN !== null && revN !== null && revN < prev.revN) {
        features.push({ id: 'rev_regression', lane: 'version', weight: p.weights.rev_regression, value: `${prev.revN}→${revN}`, detail: { prevSeq: prev.seq } });
      } else if (prev.revN !== null && revN !== null) {
        const delta = revN - prev.revN;
        updates = Math.min(Math.max(delta, 1), p.maxUpdatesPerEvent);
        if (precise && delta >= p.thresholds.revJump) {
          features.push({ id: 'rev_jump', lane: 'version', weight: p.weights.rev_jump, value: delta, threshold: p.thresholds.revJump });
        }
      }
    }
    if (e.deleted) return this.finish(e, t, features, false);

    const parsed = parseName(e.package);
    const mature = revN !== null && revN >= p.matureRev;
    if (revN !== null && revN <= p.newPackageMaxRev) {
      features.push({ id: 'new_package', lane: 'version', weight: p.weights.new_package, value: revN, threshold: p.newPackageMaxRev });
    }
    if (mature) {
      const journalAge = t - this.journalStartMs;
      const gap = prev ? t - prev.time : journalAge;
      const dormant = p.dormantDays * DAY;
      if (journalAge >= dormant && gap >= dormant) {
        features.push({ id: 'dormant_awake', lane: 'version', weight: p.weights.dormant_awake, value: Math.floor(gap / DAY), threshold: p.dormantDays });
      }
    }

    // Watchlist and the nominal lane.
    const rank = this.names?.rank(e.package);
    const watch = rank !== undefined && rank <= p.watchlistSize;
    if (watch) {
      features.push({ id: 'watchlist', lane: 'watchlist', weight: p.weights.watchlist, value: rank, threshold: p.watchlistSize });
    } else if (rank === undefined) {
      const m = this.names?.match(e.package);
      if (m) {
        features.push({
          id: `name_${m.kind}`,
          lane: 'nominal',
          weight: p.weights.name[m.kind],
          value: m.target,
          detail: { targetRank: m.targetRank, ...(m.via ? { via: m.via } : {}) },
        });
      }
    }

    // Temporal lane — only for events with a reliable appearance time.
    if (precise) {
      const th = p.thresholds;
      this.global.add('all', minute);
      this.rate(features, 'rate_global', this.global.stats('all', minute, this.firstMinute), th.globalZ, 0, p.weights.rate_global);

      this.pkg.add(e.package, minute, updates);
      this.rate(features, 'rate_package', this.pkg.stats(e.package, minute, this.firstMinute), th.packageZ, th.packageMin, p.weights.rate_package);

      // Scope and name cluster describe the same monorepo release for scoped packages
      // (@geoblocks/cesium-*): the cluster lane is for unscoped look-alike families only.
      if (parsed.scope !== null) {
        this.scope.add(parsed.namespace, minute);
        this.rate(features, 'rate_scope', this.scope.stats(parsed.namespace, minute, this.firstMinute), th.scopeZ, th.scopeMin, p.weights.rate_scope, parsed.namespace);
      } else if (parsed.cluster !== null) {
        this.cluster.add(parsed.cluster, minute);
        this.rate(features, 'rate_cluster', this.cluster.stats(parsed.cluster, minute, this.firstMinute), th.clusterZ, th.clusterMin, p.weights.rate_cluster, parsed.cluster);
      }

      // Breadth: how many distinct namespaces saw a mature package "wake up" within the window.
      // Each namespace enters the counter at most once per window, so a monorepo release
      // adds +1, while a worm across unrelated namespaces adds one per namespace hit.
      const newlyActive = mature && (prev === null || t - prev.time >= p.historyMin * MINUTE);
      if (newlyActive) {
        const last = this.breadthLast.get(parsed.namespace);
        if (last === undefined || t - last >= p.windowMin * MINUTE) {
          this.breadth.add('all', minute);
          this.breadthLast.set(parsed.namespace, t);
        }
        this.rate(features, 'breadth_mature', this.breadth.stats('all', minute, this.firstMinute), th.breadthZ, th.breadthMin, p.weights.breadth_mature);
      }
    }

    return this.finish(e, t, features, watch);
  }

  private rate(features: Feature[], id: string, s: RateStats, zMin: number, countMin: number, weight: number, key?: string): void {
    if (s.windows < this.params.minBaselineWindows || s.current < countMin || s.z < zMin) return;
    features.push({
      id,
      lane: 'temporal',
      weight,
      value: round2(s.z),
      threshold: zMin,
      detail: { count: s.current, mean: round2(s.mean), std: round2(s.std), ...(key ? { key } : {}) },
    });
  }

  private finish(e: FeedEvent, t: number, features: Feature[], watch: boolean): Stage1Result {
    const prescore = features.reduce((s, f) => s + f.weight, 0);
    return {
      seq: e.seq,
      package: e.package,
      eventTime: new Date(t),
      prescore,
      candidate: watch || prescore >= this.params.candidateThreshold,
      features,
    };
  }

  private prune(minute: number): void {
    for (const r of [this.global, this.pkg, this.scope, this.cluster, this.breadth]) r.prune(minute);
    const horizon = minute * MINUTE - this.params.windowMin * MINUTE;
    for (const [ns, last] of this.breadthLast) if (last < horizon) this.breadthLast.delete(ns);
  }
}
