// Feature labels for first paint; GET /features can refresh them (same shape).

const L = (title, short, hint) => ({ title, short, hint });

export const FEATURE_LABELS = {
  rate_global: L('Feed burst', 'feed', 'more events per 10 min across the whole registry than usual'),
  rate_package: L('Package burst', 'burst', 'more changes of the package per 10 min than usual for it'),
  rate_scope: L('Scope burst', 'scope', 'more events in the scope per 10 min than usual'),
  rate_cluster: L('Name-cluster burst', 'cluster', 'more events sharing the first name token than usual'),
  breadth_mature: L('Wake-up breadth', 'breadth', 'mature packages waking up across many unrelated namespaces'),
  rev_jump: L('Revision jump', 'revision', 'several changes of the package in a single event'),
  rev_regression: L('Regression or re-creation', 're-created', 'package re-created after deletion, or the revision number decreased'),
  dormant_awake: L('Dormant wake-up', 'wake-up', 'mature package with no events for more than a month'),
  new_package: L('New package', 'new', 'revision ≤ 2 — the package has just been created'),
  watchlist: L('Watchlist', 'top', 'package from the top 1,000 by downloads — always checked'),
  name_homoglyph: L('Look-alike name: homoglyph', 'homoglyph', 'matches a popular name after replacing look-alike characters'),
  name_scope_typo: L('Look-alike name: scope', 'scope typo', 'scope resembles a popular package scope, the base name matches'),
  name_transposition: L('Look-alike name: transposition', 'transposition', 'adjacent letters of a popular name swapped'),
  name_keyboard: L('Look-alike name: adjacent key', 'adjacent key', 'one letter replaced with a neighbouring keyboard key'),
  name_separator: L('Look-alike name: separators', 'separators', 'differs from a popular name only by hyphens, dots or underscores'),
  name_edit: L('Look-alike name: one edit', 'one edit', 'one character inserted, deleted or replaced'),
  name_reorder: L('Look-alike name: word order', 'word order', 'the same words in a different order'),
  name_affix: L('Look-alike name: affix', 'affix', 'a popular name plus a service word (js, node, cli…)'),
  package_missing: L('Package gone', 'gone', 'the packument is no longer available: removed or held by the registry'),
  version_removed: L('Version purged', 'purged', 'the version exists in the time history but was removed from the registry'),
  publisher_new: L('New publisher', 'new publisher', 'the account released none of the previous versions'),
  publisher_from_trusted: L('Token after CI', 'token after CI', 'previous versions came only from CI, this one was uploaded by a person'),
  publisher_to_trusted: L('Switch to CI', 'to CI', 'the package started publishing via trusted publishing'),
  trusted_config_changed: L('CI configuration changed', 'CI config', 'a different trusted-publishing configuration'),
  publisher_returned: L('Returning publisher', 'returned', 'the publisher released nothing for over a year while others did'),
  publisher_recent: L('Young account', 'young account', 'the publisher account appeared less than 30 days ago'),
  maintainers_added: L('New maintainers', 'maintainers', 'new accounts appeared among the maintainers'),
  email_domain_young: L('Fresh e-mail domain', 'domain', 'the publisher e-mail domain was registered recently'),
  email_domain_expired: L('Expired e-mail domain', 'domain expired', 'the publisher e-mail domain has expired — account takeover is possible'),
  install_script_added: L('Install script appeared', 'script', 'preinstall / install / postinstall that was not there before'),
  install_script_changed: L('Install script changed', 'script changed', 'the lifecycle script command changed'),
  install_script_new_package: L('New package with install script', 'script', 'an install script from the very first version'),
  size_jump: L('Size jump', 'size', 'unpacked size changed 3× or more'),
  files_jump: L('File-count jump', 'files', 'file count changed 2× or more'),
  deps_added: L('New dependencies', 'dependencies', 'new packages appeared among runtime dependencies'),
  non_adjacent_branches: L('Non-adjacent branches', 'branches', 'simultaneous versions in non-adjacent lines (9.x and 12.x)'),
  multi_branch: L('Several branches', 'branches', 'simultaneous versions in adjacent lines'),
  major_jump: L('Major jump', 'major', 'the major version grew by 2 or more'),
  dormant_release: L('Release after a pause', 'pause', 'more than a year since the previous version'),
  repo_changed: L('Repository changed', 'repository', 'a different repository in the manifest'),
  repo_removed: L('Repository removed', 'no repository', 'the manifest no longer links to a repository'),
  git_head_dropped: L('No gitHead', 'no gitHead', 'previous versions were published from git, this one was not'),
  git_head_unknown: L('Commit not in repository', 'foreign commit', 'the version gitHead was not found in the declared repository'),
  repo_missing: L('Repository not found', 'no repository', 'the declared repository does not exist on GitHub'),
  repo_archived: L('Repository archived', 'archived', 'a new version from an archived repository'),
  repo_inactive: L('Repository dormant', 'dormant', 'no push to the repository for six months or more'),
  provenance_repo_mismatch: L('Attestation from another repository', 'attestation', 'the attested source does not match the declared repository'),
};

export const LANE_LABELS = {
  temporal: 'temporal', version: 'version', nominal: 'nominal', watchlist: 'watchlist', registry: 'registry',
  publisher: 'publisher', maintainers: 'maintainers', manifest: 'manifest', versions: 'versions', repository: 'repository',
};

export const SOURCE_NAMES = { registry: 'npm registry', ecosystems: 'ecosyste.ms', depsdev: 'deps.dev', github: 'GitHub', rdap: 'RDAP' };
export const KIND_NAMES = { metadata: 'metadata', package_missing: 'package gone', error: 'error', publish: 'publication' };

export const labelOf = (id) => FEATURE_LABELS[id] ?? { title: id, short: id, hint: '' };

// Lane of a feature by id (hit counts carry only the id).
export function laneOf(id) {
  if (id.startsWith('rate_') || id === 'breadth_mature') return 'temporal';
  if (id.startsWith('name_')) return 'nominal';
  if (id === 'watchlist') return 'watchlist';
  if (['rev_jump', 'rev_regression', 'dormant_awake', 'new_package'].includes(id)) return 'version';
  if (['package_missing', 'version_removed'].includes(id)) return 'registry';
  if (id.startsWith('publisher_') || id === 'trusted_config_changed') return 'publisher';
  if (id === 'maintainers_added' || id.startsWith('email_')) return 'maintainers';
  if (id.startsWith('install_') || ['size_jump', 'files_jump', 'deps_added'].includes(id)) return 'manifest';
  if (['non_adjacent_branches', 'multi_branch', 'major_jump', 'dormant_release'].includes(id)) return 'versions';
  return 'repository';
}

// Feature value in short form — for chips and tables.
export function featureValue(x) {
  const v = x.value;
  if (Array.isArray(v)) return v.join(', ');
  if (x.id.startsWith('name_')) return `→ ${v}`;
  if (x.id === 'rev_jump') return `+${v}`;
  if (x.id === 'watchlist') return `#${v}`;
  if (x.id.startsWith('rate_') || x.id === 'breadth_mature') return `z ${v}`;
  if (x.id === 'new_package') return `revision ${v}`;
  if (x.id === 'dormant_awake' || x.id === 'dormant_release' || x.id === 'publisher_returned') return `${v} d`;
  if (x.id === 'size_jump' || x.id === 'files_jump') return `×${v}`;
  return String(v);
}

// Feature details for the event card.
export function featureDetail(x) {
  const d = x.detail ?? {};
  if (x.id.startsWith('rate_') || x.id === 'breadth_mature') {
    const key = d.key ? ` · ${d.key}` : '';
    return `${d.count} in 10 min against a baseline of ${d.mean} (σ ${d.std})${key}`;
  }
  const rest = Object.entries(d).filter(([k]) => k !== 'versions');
  const versions = Array.isArray(d.versions) ? ` · versions ${d.versions.join(', ')}` : '';
  return rest.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('; ') + versions;
}
