// Stage 1 parameters: windows, thresholds and feature weights. Initial values are expert
// estimates; thresholds are calibrated against the accumulated background. Any change alters
// the engine identifier, which is stored next to every result.

import { createHash } from 'node:crypto';
import type { NominalKind } from './nominal.ts';

export interface Stage1Params {
  version: string;
  windowMin: number; // sliding window length of the temporal lane
  historyMin: number; // baseline depth for mean and deviation
  minBaselineWindows: number; // fewer baseline windows — the temporal lane stays silent
  stdFloor: number;
  maxPrecisionMs: number; // wider event appearance interval — the time is unreliable
  maxUpdatesPerEvent: number;
  matureRev: number; // from this many revisions the package counts as mature
  newPackageMaxRev: number;
  dormantDays: number;
  nominalMinLength: number;
  watchlistSize: number;
  candidateThreshold: number;
  thresholds: {
    globalZ: number;
    packageZ: number;
    packageMin: number;
    scopeZ: number;
    scopeMin: number;
    clusterZ: number;
    clusterMin: number;
    breadthZ: number;
    breadthMin: number;
    revJump: number;
  };
  weights: {
    rate_global: number;
    rate_package: number;
    rate_scope: number;
    rate_cluster: number;
    breadth_mature: number;
    rev_jump: number;
    rev_regression: number;
    dormant_awake: number;
    new_package: number;
    watchlist: number;
    name: Record<NominalKind, number>;
  };
}

export const DEFAULT_PARAMS: Stage1Params = {
  // v2 (2026-10-14): first calibration on 3 h of background — scope/cluster thresholds raised,
  // cluster lane limited to unscoped names, 6 h of baseline required.
  // v3 (2026-10-19): breadth_mature weighs 2 — a wave of single-version publications across
  // unrelated namespaces (ChainDrop with one version per package) left no other stage-1 trace;
  // on five days of background the feature fired on 1 024 events (≈ 0.2 % of the stream).
  version: 'v3',
  windowMin: 10,
  historyMin: 1440,
  minBaselineWindows: 36,
  stdFloor: 1,
  maxPrecisionMs: 60_000,
  maxUpdatesPerEvent: 50,
  matureRev: 10,
  newPackageMaxRev: 2,
  dormantDays: 30,
  nominalMinLength: 4,
  watchlistSize: 1000,
  candidateThreshold: 2,
  thresholds: {
    globalZ: 4,
    packageZ: 2.5,
    packageMin: 3,
    scopeZ: 6,
    scopeMin: 10,
    clusterZ: 6,
    clusterMin: 10,
    breadthZ: 4,
    breadthMin: 5,
    revJump: 3,
  },
  weights: {
    rate_global: 0.5,
    rate_package: 2,
    rate_scope: 1,
    rate_cluster: 1,
    breadth_mature: 2,
    rev_jump: 1,
    rev_regression: 2,
    dormant_awake: 1,
    new_package: 0.5,
    watchlist: 0,
    name: {
      homoglyph: 2,
      scope_typo: 2,
      transposition: 1.5,
      keyboard: 1.5,
      separator: 1.5,
      edit: 1.5,
      reorder: 1,
      affix: 1,
    },
  },
};

export function engineId(p: Stage1Params): string {
  return `${p.version}:${createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0, 8)}`;
}
