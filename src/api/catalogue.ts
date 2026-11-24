// Feature catalogue for the API: id, stage, lane, labels and weight of every feature the
// two engines can emit.

import { DEFAULT_PARAMS } from '../stage1/params.ts';
import { STAGE2_WEIGHTS } from '../stage2/params.ts';
import { FEATURE_LABELS } from '../web/labels.ts';

export interface FeatureInfo {
  id: string;
  stage: 1 | 2;
  lane: string;
  title: string;
  short: string;
  hint: string;
  weight: number;
}

const STAGE1_LANES: Record<string, string> = {
  rate_global: 'temporal',
  rate_package: 'temporal',
  rate_scope: 'temporal',
  rate_cluster: 'temporal',
  breadth_mature: 'temporal',
  rev_jump: 'version',
  rev_regression: 'version',
  dormant_awake: 'version',
  new_package: 'version',
  watchlist: 'watchlist',
};

const STAGE2_LANES: Record<string, string> = {
  package_missing: 'registry',
  version_removed: 'registry',
  publisher_new: 'publisher',
  publisher_from_trusted: 'publisher',
  publisher_to_trusted: 'publisher',
  trusted_config_changed: 'publisher',
  publisher_returned: 'publisher',
  publisher_recent: 'publisher',
  maintainers_added: 'maintainers',
  email_domain_young: 'maintainers',
  email_domain_expired: 'maintainers',
  install_script_added: 'manifest',
  install_script_changed: 'manifest',
  install_script_new_package: 'manifest',
  size_jump: 'manifest',
  files_jump: 'manifest',
  deps_added: 'manifest',
  non_adjacent_branches: 'versions',
  multi_branch: 'versions',
  major_jump: 'versions',
  dormant_release: 'versions',
  repo_changed: 'repository',
  repo_removed: 'repository',
  git_head_dropped: 'repository',
  git_head_unknown: 'repository',
  repo_missing: 'repository',
  repo_archived: 'repository',
  repo_inactive: 'repository',
  provenance_repo_mismatch: 'repository',
};

export function laneOf(id: string): string {
  if (id.startsWith('name_')) return 'nominal';
  return STAGE1_LANES[id] ?? STAGE2_LANES[id] ?? 'repository';
}

export function featureCatalogue(): FeatureInfo[] {
  const w1 = DEFAULT_PARAMS.weights;
  const out: FeatureInfo[] = [];
  const stage1Ids = [...Object.keys(STAGE1_LANES), ...Object.keys(w1.name).map((k) => `name_${k}`)];
  for (const id of stage1Ids) {
    const weight = id.startsWith('name_') ? w1.name[id.slice(5) as keyof typeof w1.name] : (w1 as unknown as Record<string, number>)[id];
    const l = FEATURE_LABELS[id] ?? { title: id, short: id, hint: '' };
    out.push({ id, stage: 1, lane: laneOf(id), title: l.title, short: l.short, hint: l.hint, weight: weight ?? 0 });
  }
  for (const [id, weight] of Object.entries(STAGE2_WEIGHTS)) {
    const l = FEATURE_LABELS[id] ?? { title: id, short: id, hint: '' };
    out.push({ id, stage: 2, lane: laneOf(id), title: l.title, short: l.short, hint: l.hint, weight });
  }
  return out;
}
