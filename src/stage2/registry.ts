// Packument analysis: which versions were published within the event interval and how they
// differ from the package history. A pure function — no network, tested on samples.
//
// The time field keeps the dates of versions the registry has purged: node-ipc still shows
// 9.1.6, 9.2.3 and 12.0.1, which are gone from versions. So a simultaneous publication and
// the removal of versions remain visible after the fact.

import { type Feature, FeatureSet } from '../lib/feature.ts';
import type { Stage2FeatureId, Stage2Params } from './params.ts';
import type { NpmPerson, Packument, RepositoryField, VersionManifest } from './types.ts';

const DAY = 86_400_000;
const LIFECYCLE = ['preinstall', 'install', 'postinstall'];

// Interval in which the event's versions were published (already corrected for feed delay).
export interface EventSpan {
  from: number;
  to: number;
}

export interface GithubRepo {
  owner: string;
  name: string;
}

export interface RegistryAnalysis {
  kind: 'publish' | 'metadata' | 'package_missing';
  versions: string[]; // the event's versions that are present in the registry
  features: Feature[];
  evidence: Record<string, unknown>;
  primaryVersion: string | null; // the latest of the event's versions
  primary: VersionManifest | null;
  publishTime: number | null;
  repo: GithubRepo | null;
  mature: boolean;
  hasHistory: boolean;
}

interface Entry {
  version: string;
  t: number;
  present: boolean;
}

function timeline(pack: Packument): Entry[] {
  const out: Entry[] = [];
  for (const [version, raw] of Object.entries(pack.time ?? {})) {
    if (version === 'created' || version === 'modified' || typeof raw !== 'string') continue;
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) out.push({ version, t, present: pack.versions?.[version] !== undefined });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function personName(p: NpmPerson | string): string | null {
  if (typeof p === 'string') return p.split(/[\s<]/)[0] || null;
  return p.name ?? null;
}

const names = (list: (NpmPerson | string)[] | undefined): string[] =>
  (list ?? []).map(personName).filter((n): n is string => n !== null);

// Publisher identity: a person by name, trusted publishing by provider.
export function publisherKey(u: NpmPerson | undefined): string | null {
  if (!u) return null;
  if (u.trustedPublisher) return `trusted:${u.trustedPublisher.id ?? 'unknown'}`;
  return u.name ? `user:${u.name}` : null;
}

// The registry records the config id both as "oidc:<uuid>" and as "<uuid>" (@tanstack has both) —
// without normalisation the package's own CI would look like a configuration change.
export function trustedConfig(u: NpmPerson | undefined): string | null {
  const c = u?.trustedPublisher?.oidcConfigId;
  return c ? String(c).replace(/^oidc:/, '') : null;
}

export function repoUrl(repo: RepositoryField | undefined): string | null {
  const url = typeof repo === 'string' ? repo : repo?.url;
  return url ? url.trim() : null;
}

export function githubRepo(repo: RepositoryField | undefined): GithubRepo | null {
  const url = repoUrl(repo);
  if (!url) return null;
  const m =
    /^(?:github:)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i.exec(url) ??
    /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i.exec(url);
  return m ? { owner: m[1]!.toLowerCase(), name: m[2]!.toLowerCase() } : null;
}

export function versionLine(v: string): { major: number; minor: number; key: string } | null {
  const m = /^v?(\d+)\.(\d+)\./.exec(v);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return { major, minor, key: major > 0 ? `${major}` : `0.${minor}` };
}

// Is there a gap between neighbouring release lines: 9.x and 12.x — yes, 4.x and 5.x — no.
// The 0.0.x line is not a release line: npm's staged publishing creates a temporary 0.0.0-stage
// placeholder a minute before the first real version (252 packages in three days of background).
export function hasLineGap(versions: string[]): { lines: string[]; gap: boolean } {
  const byKey = new Map<string, { major: number; minor: number }>();
  for (const v of versions) {
    const l = versionLine(v);
    if (l && !(l.major === 0 && l.minor === 0)) byKey.set(l.key, l);
  }
  const lines = [...byKey.entries()].sort((a, b) => a[1].major - b[1].major || a[1].minor - b[1].minor);
  let gap = false;
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1]![1];
    const b = lines[i]![1];
    if (a.major === 0 && b.major === 0) gap ||= b.minor - a.minor > 1;
    else if (a.major === 0) gap ||= b.major > 1;
    else gap ||= b.major - a.major > 1;
  }
  return { lines: lines.map(([k]) => k), gap };
}

function lifecycle(m: VersionManifest | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of LIFECYCLE) {
    const cmd = m?.scripts?.[k];
    if (typeof cmd === 'string') out[k] = cmd;
  }
  return out;
}

const runtimeDeps = (m: VersionManifest | undefined): string[] =>
  Object.keys({ ...m?.dependencies, ...m?.optionalDependencies });

// Data minimisation: the snapshot keeps the domain of the publisher's e-mail, never the address.
const emailDomain = (email: string | undefined): string | null => {
  const at = email ? email.lastIndexOf('@') : -1;
  return email && at > 0 && at < email.length - 1 ? email.slice(at + 1).toLowerCase() : null;
};

function summarize(version: string, m: VersionManifest, t: number) {
  const u = m._npmUser;
  return {
    version,
    time: new Date(t).toISOString(),
    publisher: u
      ? { name: u.name ?? null, emailDomain: emailDomain(u.email), trusted: u.trustedPublisher ? { id: u.trustedPublisher.id, config: trustedConfig(u) } : null }
      : null,
    maintainers: names(m.maintainers),
    lifecycle: lifecycle(m),
    scripts: m.scripts ?? {},
    dependencies: m.dependencies ?? {},
    optionalDependencies: m.optionalDependencies ?? {},
    dist: {
      fileCount: m.dist?.fileCount ?? null,
      unpackedSize: m.dist?.unpackedSize ?? null,
      integrity: m.dist?.integrity ?? null,
      tarball: m.dist?.tarball ?? null,
      provenance: m.dist?.attestations?.provenance?.predicateType ?? null,
    },
    gitHead: m.gitHead ?? null,
    repository: repoUrl(m.repository),
  };
}

const TIMELINE_MAX = 400;

// Version timeline for the event card: [version, unix seconds, publisher index; -1 — purged,
// -2 — publisher not recorded]. The last max versions: large monorepos have thousands.
export function compactTimeline(entries: Entry[], versions: Record<string, VersionManifest>, max: number) {
  const tail = entries.slice(-max);
  const publishers: string[] = [];
  const points = tail.map((e): [string, number, number] => {
    const key = e.present ? publisherKey(versions[e.version]?._npmUser) : null;
    let idx = e.present ? -2 : -1;
    if (key) {
      idx = publishers.indexOf(key);
      if (idx < 0) idx = publishers.push(key) - 1;
    }
    return [e.version, Math.round(e.t / 1000), idx];
  });
  return { total: entries.length, publishers, points };
}

export function analyzeRegistry(pack: Packument | null, span: EventSpan, p: Stage2Params): RegistryAnalysis {
  const w = p.weights;
  const mk = (id: Stage2FeatureId, lane: string, value: Feature['value'], detail?: Record<string, unknown>): Feature => ({
    id,
    lane,
    weight: w[id],
    value,
    ...(detail ? { detail } : {}),
  });
  const empty = { versions: [], primaryVersion: null, primary: null, publishTime: null, repo: null, mature: false, hasHistory: false };

  if (pack === null) {
    return { ...empty, kind: 'package_missing', features: [mk('package_missing', 'registry', true)], evidence: { packument: null } };
  }

  const versions = pack.versions ?? {};
  const all = timeline(pack);
  const inSpan = all.filter((e) => e.t >= span.from && e.t <= span.to);
  const fs = new FeatureSet();
  const base = { distTags: pack['dist-tags'] ?? {}, maintainers: names(pack.maintainers) };

  const removed = inSpan.filter((e) => !e.present);
  if (removed.length > 0) fs.add(mk('version_removed', 'registry', removed.map((e) => e.version)));

  if (inSpan.length === 0) {
    // Event without new versions: dist-tag, deprecation, maintainer change.
    const latest = pack['dist-tags']?.latest;
    const lm = latest ? versions[latest] : undefined;
    // Only for packages with a history: a pipeline republishing a pre-release tag changes the
    // document every minute, and a young package's maintainer list settles over its first versions.
    const presentCount = all.filter((e) => e.present).length;
    if (lm?.maintainers && presentCount >= p.minHistory) {
      const before = new Set(names(lm.maintainers));
      const added = names(pack.maintainers).filter((n) => !before.has(n));
      if (added.length > 0) fs.add(mk('maintainers_added', 'maintainers', added, { since: latest }));
    }
    return { ...empty, kind: 'metadata', features: fs.list(), evidence: { kind: 'metadata', ...base } };
  }

  const first = inSpan[0]!;
  const last = inSpan.at(-1)!;
  // The history is the package as it was before the burst this event belongs to. Versions of
  // the same wave published minutes earlier are not a baseline: measured against them the third
  // version of node-ipc had a known publisher and no pause, and a worm's third version had the
  // same manifest as its second. The replay of both scenarios found this blind spot.
  const history = all.filter((e) => e.t < first.t - p.burstWindowMs);
  const historyPresent = history.filter((e) => e.present);
  const prev = historyPresent.at(-1);
  const mature = history.length >= p.matureVersions || (history.length > 0 && first.t - history[0]!.t >= 365 * DAY);
  const fresh = inSpan.filter((e) => e.present);

  // Publisher history: how many versions and when the last one was.
  const publishers = new Map<string, { count: number; last: number }>();
  for (const e of historyPresent) {
    const key = publisherKey(versions[e.version]?._npmUser);
    if (!key) continue;
    const s = publishers.get(key) ?? { count: 0, last: 0 };
    s.count++;
    s.last = e.t;
    publishers.set(key, s);
  }
  const knownPublishers = [...publishers.values()].reduce((s, x) => s + x.count, 0);

  for (const e of fresh) {
    const m = versions[e.version]!;
    const line = versionLine(e.version)?.key;
    // Compare with the previous version of the same line: 9.1.6 against 12.0.0 are different branches.
    const sameLine = [...historyPresent].reverse().find((h) => versionLine(h.version)?.key === line);
    const base_ = sameLine ?? prev;
    const pm = base_ ? versions[base_.version] : undefined;

    // Publisher against the release history.
    const key = publisherKey(m._npmUser);
    if (key && knownPublishers >= p.minHistory) {
      const known = publishers.get(key);
      const recent = historyPresent.slice(-5).map((h) => publisherKey(versions[h.version]?._npmUser));
      // The project published only from CI, and this version was uploaded by a person with a
      // token — even a former publisher: this is what a stolen maintainer token looks like.
      if (!key.startsWith('trusted:') && recent.length > 0 && recent.every((k) => k?.startsWith('trusted:'))) {
        fs.add(mk('publisher_from_trusted', 'publisher', key, { recent: recent as string[] }), e.version);
      } else if (!known) {
        if (key.startsWith('trusted:')) {
          const anyTrusted = [...publishers.keys()].some((k) => k.startsWith('trusted:'));
          fs.add(anyTrusted ? mk('publisher_new', 'publisher', key) : mk('publisher_to_trusted', 'publisher', key), e.version);
        } else {
          fs.add(mk('publisher_new', 'publisher', key, { history: Object.fromEntries([...publishers].map(([k, v]) => [k, v.count])) }), e.version);
        }
      } else if (key.startsWith('trusted:')) {
        const lastTrusted = [...historyPresent].reverse().find((h) => publisherKey(versions[h.version]?._npmUser) === key);
        const was = trustedConfig(lastTrusted ? versions[lastTrusted.version]?._npmUser : undefined);
        const now = trustedConfig(m._npmUser);
        if (was && now && was !== now) fs.add(mk('trusted_config_changed', 'publisher', now, { was }), e.version);
      } else {
        const othersSince = historyPresent.some((h) => h.t > known.last && publisherKey(versions[h.version]?._npmUser) !== key);
        const days = Math.floor((e.t - known.last) / DAY);
        if (othersSince && days >= p.publisherReturnDays) fs.add(mk('publisher_returned', 'publisher', days, { lastPublish: new Date(known.last).toISOString() }), e.version);
      }
    }

    // Comparisons with the previous version are meaningful once the package has a history:
    // the first versions of a new package grow, add maintainers and files by nature.
    const settled = historyPresent.length >= p.minHistory;
    if (pm) {
      // Maintainers: any new ones relative to the previous version.
      if (pm.maintainers && settled) {
        const before = new Set(names(pm.maintainers));
        const added = [...new Set([...names(m.maintainers), ...names(pack.maintainers)])].filter((n) => !before.has(n));
        if (added.length > 0) fs.add(mk('maintainers_added', 'maintainers', added), e.version);
      }

      // Lifecycle scripts.
      const was = lifecycle(pm);
      const now = lifecycle(m);
      const added = Object.keys(now).filter((k) => !(k in was));
      const changed = Object.keys(now).filter((k) => k in was && was[k] !== now[k]);
      if (added.length > 0) fs.add(mk('install_script_added', 'manifest', added, { commands: Object.fromEntries(added.map((k) => [k, now[k]!.slice(0, 300)])) }), e.version);
      if (changed.length > 0) fs.add(mk('install_script_changed', 'manifest', changed), e.version);

      // Size, file count, dependencies.
      const s0 = pm.dist?.unpackedSize;
      const s1 = m.dist?.unpackedSize;
      if (s0 && s1 && settled) {
        const ratio = Math.max(s1 / s0, s0 / s1);
        if (ratio >= p.sizeRatio && Math.abs(s1 - s0) >= p.sizeMinDelta) fs.add(mk('size_jump', 'manifest', Math.round(ratio * 10) / 10, { from: s0, to: s1 }), e.version);
      }
      const f0 = pm.dist?.fileCount;
      const f1 = m.dist?.fileCount;
      if (f0 && f1 && settled) {
        const ratio = Math.max(f1 / f0, f0 / f1);
        if (ratio >= p.filesRatio && Math.abs(f1 - f0) >= p.filesMinDelta) fs.add(mk('files_jump', 'manifest', Math.round(ratio * 10) / 10, { from: f0, to: f1 }), e.version);
      }
      const prevDeps = new Set(runtimeDeps(pm));
      const newDeps = runtimeDeps(m).filter((d) => !prevDeps.has(d));
      if (newDeps.length > 0) fs.add(mk('deps_added', 'manifest', newDeps), e.version);

      // Repository and gitHead.
      const r0 = githubRepo(pm.repository);
      const r1 = githubRepo(m.repository);
      const u0 = repoUrl(pm.repository);
      const u1 = repoUrl(m.repository);
      if (r0 && r1 && (r0.owner !== r1.owner || r0.name !== r1.name)) {
        fs.add(mk('repo_changed', 'repository', `${r1.owner}/${r1.name}`, { was: `${r0.owner}/${r0.name}` }), e.version);
      } else if (u0 && !u1) {
        fs.add(mk('repo_removed', 'repository', u0), e.version);
      }
      if (pm.gitHead && !m.gitHead) fs.add(mk('git_head_dropped', 'repository', true), e.version);
    } else if (history.length === 0 && Object.keys(lifecycle(m)).length > 0) {
      fs.add(mk('install_script_new_package', 'manifest', Object.keys(lifecycle(m))), e.version);
    }
  }

  // Rules over version numbers: branches, major jump, pause.
  const burst = all.filter((e) => e.t >= first.t - p.burstWindowMs && e.t <= last.t + p.burstWindowMs);
  const spread = hasLineGap(burst.map((e) => e.version));
  // Adjacent lines (0.0.x → 0.1.0, 4.x + 5.x) are normal for a young package; non-adjacent ones never are.
  if (spread.lines.length >= 2 && (spread.gap || history.length >= p.minHistory)) {
    fs.add(mk(spread.gap ? 'non_adjacent_branches' : 'multi_branch', 'versions', burst.map((e) => e.version), { lines: spread.lines }));
  }
  if (mature) {
    const histMajor = Math.max(...history.map((e) => versionLine(e.version)?.major ?? -1));
    for (const e of inSpan) {
      const major = versionLine(e.version)?.major;
      if (major !== undefined && histMajor >= 0 && histMajor < p.calendarMajor && major - histMajor >= p.majorJump) {
        fs.add(mk('major_jump', 'versions', e.version, { previousMax: histMajor }));
      }
    }
  }
  const prevAny = history.at(-1);
  if (prevAny && history.length >= p.minHistory) {
    const days = Math.floor((first.t - prevAny.t) / DAY);
    if (days >= p.dormantDays) fs.add(mk('dormant_release', 'versions', days, { previous: prevAny.version }));
  }

  const primaryEntry = fresh.at(-1) ?? null;
  const primary = primaryEntry ? versions[primaryEntry.version]! : null;
  return {
    kind: 'publish',
    versions: fresh.map((e) => e.version),
    features: fs.list(),
    evidence: {
      kind: 'publish',
      ...base,
      versions: fresh.map((e) => summarize(e.version, versions[e.version]!, e.t)),
      removed: removed.map((e) => ({ version: e.version, time: new Date(e.t).toISOString() })),
      previous: prev ? summarize(prev.version, versions[prev.version]!, prev.t) : null,
      history: {
        versions: history.length,
        first: history[0] ? new Date(history[0].t).toISOString() : null,
        publishers: Object.fromEntries([...publishers].map(([k, v]) => [k, { count: v.count, last: new Date(v.last).toISOString() }])),
      },
      burst: burst.map((e) => ({ version: e.version, time: new Date(e.t).toISOString(), present: e.present })),
      timeline: compactTimeline(all.filter((e) => e.t <= last.t + p.burstWindowMs), versions, TIMELINE_MAX),
      event: inSpan.map((e) => e.version),
    },
    primaryVersion: primaryEntry?.version ?? null,
    primary,
    publishTime: primaryEntry?.t ?? null,
    repo: githubRepo(primary?.repository ?? pack.repository),
    mature,
    hasHistory: history.length > 0,
  };
}
