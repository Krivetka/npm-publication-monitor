// Human-readable names of the features of both stages: full title, short label
// (for the score bar) and a hint.

export interface FeatureLabel {
  title: string;
  short: string;
  hint: string;
}

const L = (title: string, short: string, hint: string): FeatureLabel => ({ title, short, hint });

export const FEATURE_LABELS: Record<string, FeatureLabel> = {
  // stage 1 — temporal lane
  rate_global: L('Feed burst', 'feed', 'more events per 10 min across the whole registry than usual'),
  rate_package: L('Package burst', 'burst', 'more changes of the package per 10 min than usual for it'),
  rate_scope: L('Scope burst', 'scope', 'more events in the scope per 10 min than usual'),
  rate_cluster: L('Name-cluster burst', 'cluster', 'more events sharing the first name token than usual'),
  breadth_mature: L('Wake-up breadth', 'breadth', 'mature packages waking up across many unrelated namespaces'),
  // stage 1 — version lane
  rev_jump: L('Revision jump', 'revision', 'several changes of the package in a single event'),
  rev_regression: L('Regression or re-creation', 're-created', 'package re-created after deletion, or the revision number decreased'),
  dormant_awake: L('Dormant wake-up', 'wake-up', 'mature package with no events for more than a month'),
  new_package: L('New package', 'new', 'revision ≤ 2 — the package has just been created'),
  // stage 1 — watchlist and nominal lane
  watchlist: L('Watchlist', 'top', 'package from the top 1,000 by downloads — always checked'),
  name_homoglyph: L('Look-alike name: homoglyph', 'homoglyph', 'matches a popular name after replacing look-alike characters'),
  name_scope_typo: L('Look-alike name: scope', 'scope typo', 'scope resembles a popular package scope, the base name matches'),
  name_transposition: L('Look-alike name: transposition', 'transposition', 'adjacent letters of a popular name swapped'),
  name_keyboard: L('Look-alike name: adjacent key', 'adjacent key', 'one letter replaced with a neighbouring keyboard key'),
  name_separator: L('Look-alike name: separators', 'separators', 'differs from a popular name only by hyphens, dots or underscores'),
  name_edit: L('Look-alike name: one edit', 'one edit', 'one character inserted, deleted or replaced'),
  name_reorder: L('Look-alike name: word order', 'word order', 'the same words in a different order'),
  name_affix: L('Look-alike name: affix', 'affix', 'a popular name plus a service word (js, node, cli…)'),
  // stage 2 — registry
  package_missing: L('Package gone', 'gone', 'the packument is no longer available: removed or held by the registry'),
  version_removed: L('Version purged', 'purged', 'the version exists in the time history but was removed from the registry'),
  // publisher
  publisher_new: L('New publisher', 'new publisher', 'the account released none of the previous versions'),
  publisher_from_trusted: L('Token after CI', 'token after CI', 'previous versions came only from CI, this one was uploaded by a person'),
  publisher_to_trusted: L('Switch to CI', 'to CI', 'the package started publishing via trusted publishing'),
  trusted_config_changed: L('CI configuration changed', 'CI config', 'a different trusted-publishing configuration'),
  publisher_returned: L('Returning publisher', 'returned', 'the publisher released nothing for over a year while others did'),
  publisher_recent: L('Young account', 'young account', 'the publisher account appeared less than 30 days ago'),
  // maintainers
  maintainers_added: L('New maintainers', 'maintainers', 'new accounts appeared among the maintainers'),
  email_domain_young: L('Fresh e-mail domain', 'domain', 'the publisher e-mail domain was registered recently'),
  email_domain_expired: L('Expired e-mail domain', 'domain expired', 'the publisher e-mail domain has expired — account takeover is possible'),
  // manifest
  install_script_added: L('Install script appeared', 'script', 'preinstall / install / postinstall that was not there before'),
  install_script_changed: L('Install script changed', 'script changed', 'the lifecycle script command changed'),
  install_script_new_package: L('New package with install script', 'script', 'an install script from the very first version'),
  size_jump: L('Size jump', 'size', 'unpacked size changed 3× or more'),
  files_jump: L('File-count jump', 'files', 'file count changed 2× or more'),
  deps_added: L('New dependencies', 'dependencies', 'new packages appeared among runtime dependencies'),
  // versions
  non_adjacent_branches: L('Non-adjacent branches', 'branches', 'simultaneous versions in non-adjacent lines (9.x and 12.x)'),
  multi_branch: L('Several branches', 'branches', 'simultaneous versions in adjacent lines'),
  major_jump: L('Major jump', 'major', 'the major version grew by 2 or more'),
  dormant_release: L('Release after a pause', 'pause', 'more than a year since the previous version'),
  // repository
  repo_changed: L('Repository changed', 'repository', 'a different repository in the manifest'),
  repo_removed: L('Repository removed', 'no repository', 'the manifest no longer links to a repository'),
  git_head_dropped: L('No gitHead', 'no gitHead', 'previous versions were published from git, this one was not'),
  git_head_unknown: L('Commit not in repository', 'foreign commit', 'the version gitHead was not found in the declared repository'),
  repo_missing: L('Repository not found', 'no repository', 'the declared repository does not exist on GitHub'),
  repo_archived: L('Repository archived', 'archived', 'a new version from an archived repository'),
  repo_inactive: L('Repository dormant', 'dormant', 'no push to the repository for six months or more'),
  provenance_repo_mismatch: L('Attestation from another repository', 'attestation', 'the attested source does not match the declared repository'),
};

export const LANE_LABELS: Record<string, string> = {
  temporal: 'temporal',
  version: 'version',
  nominal: 'nominal',
  watchlist: 'watchlist',
  registry: 'registry',
  publisher: 'publisher',
  maintainers: 'maintainers',
  manifest: 'manifest',
  versions: 'versions',
  repository: 'repository',
};

export const labelOf = (id: string): FeatureLabel => FEATURE_LABELS[id] ?? { title: id, short: id, hint: '' };
