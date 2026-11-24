// Stage 2 parameters: thresholds and weights of the enrichment features, alert threshold.
// Any change alters the engine identifier stored with the result.

import { createHash } from 'node:crypto';

export const STAGE2_WEIGHTS = {
  // registry
  package_missing: 2,
  version_removed: 2,
  // publisher
  publisher_new: 3,
  publisher_from_trusted: 2.5,
  publisher_to_trusted: 0.5,
  trusted_config_changed: 1.5,
  publisher_returned: 1,
  publisher_recent: 1.5,
  // maintainers
  maintainers_added: 1,
  email_domain_young: 1.5,
  email_domain_expired: 2,
  // manifest and contents
  install_script_added: 2.5,
  install_script_changed: 1,
  install_script_new_package: 2,
  size_jump: 1,
  files_jump: 0.5,
  deps_added: 0.5,
  // versions
  non_adjacent_branches: 2,
  multi_branch: 1,
  major_jump: 1.5,
  dormant_release: 1.5,
  // repository
  repo_changed: 1.5,
  repo_removed: 1,
  git_head_dropped: 1,
  repo_missing: 1,
  repo_archived: 1,
  repo_inactive: 1.5,
  // publish-before-push is common practice: the commit often appears minutes later
  git_head_unknown: 0.5,
  provenance_repo_mismatch: 2,
} as const;

export type Stage2FeatureId = keyof typeof STAGE2_WEIGHTS;

export interface Stage2Params {
  version: string;
  settleMs: number; // pause after the event: the registry CDN lags behind the feed
  missingVersionRetryMs: number; // how long to wait for the version to appear in the packument
  feedLagMs: number; // how much earlier than observed the version may have been released (feed delay)
  clockSkewMs: number; // clock skew between the registry and the collector
  burstWindowMs: number; // window of a "simultaneous" publication of several versions
  minHistory: number; // fewer versions in the history — nothing to compare the publisher against
  matureVersions: number;
  publisherReturnDays: number;
  dormantDays: number;
  majorJump: number;
  calendarMajor: number; // majors from this number are calendar versioning, jumps are not counted
  sizeRatio: number;
  sizeMinDelta: number;
  filesRatio: number;
  filesMinDelta: number;
  repoInactiveDays: number;
  publisherRecentDays: number;
  domainYoungDays: number;
  alertThreshold: number;
  alertEvidenceMin: number; // minimal sum of stage-2 weights behind an alert: a stage-1 burst plus a 0.5 feature is not evidence
  // a watchlist package is alerted on stage-2 evidence of this weight, whatever the final score:
  // the watchlist adds no prescore, so the alert threshold was out of reach for a quiet release
  watchlistEvidenceMin: number;
  // features that confirm the registry already acted and leave nothing to show the analyst:
  // counted in the score, not towards alertEvidenceMin
  confirmationFeatures: Stage2FeatureId[];
  alertRepeatHours: number; // one alert per package per window; later ones are marked as repeats
  weights: typeof STAGE2_WEIGHTS;
}

export const STAGE2_PARAMS: Stage2Params = {
  // v2 (2026-10-14): first calibration — young packages exempt from manifest/branch comparisons,
  // git_head_unknown down-weighted, alerts require stage-2 evidence.
  // v3 (2026-10-17): calibration on 64 h of background (8 118 enriched events, 662 alerts) —
  // the staged-publishing placeholder 0.0.0-stage no longer counts as a release line, a package
  // that has already vanished from the registry is not alerted on (nothing to show), an alert
  // needs stage-2 weights of at least 2, a new package with an install script weighs 2.
  // v4 (2026-10-19): the replay of node-ipc and ChainDrop showed that versions of the same burst
  // served as the baseline for later events of the wave; the history now ends burstWindowMs
  // before the first version of the event.
  // v5 (2026-10-28): nine days of v4 gave 32 alerts a day; 19 of the 21 alerts carried only by
  // version_removed were the registry's own self-test packages (pkg-ops-*, pkg-rollback-*). A
  // version the registry removed is a confirmation, not evidence: nothing is left to show.
  // v6 (2026-11-19): the replay of the recorded ChainDrop wave showed that keyv (rank 188) was
  // enriched at minute 5, stage 2 found the new preinstall script, and no alert followed: the
  // score was the stage-2 weight alone. A watchlist package now needs only the evidence. On 31
  // days of background the rule adds 18 alerts. The change was made after the replay of the
  // held-out incidents of 2025 and does not alter their result.
  version: 'v6',
  settleMs: 60_000,
  missingVersionRetryMs: 600_000,
  feedLagMs: 300_000,
  clockSkewMs: 5_000,
  burstWindowMs: 600_000,
  minHistory: 3,
  matureVersions: 10,
  publisherReturnDays: 365,
  dormantDays: 365,
  majorJump: 2,
  calendarMajor: 100,
  sizeRatio: 3,
  sizeMinDelta: 100_000,
  filesRatio: 2,
  filesMinDelta: 10,
  repoInactiveDays: 180,
  publisherRecentDays: 30,
  domainYoungDays: 180,
  alertThreshold: 4,
  alertEvidenceMin: 2,
  watchlistEvidenceMin: 2,
  confirmationFeatures: ['version_removed'],
  alertRepeatHours: 6,
  weights: STAGE2_WEIGHTS,
};

export function stage2EngineId(p: Stage2Params): string {
  return `${p.version}:${createHash('sha256').update(JSON.stringify(p)).digest('hex').slice(0, 8)}`;
}
