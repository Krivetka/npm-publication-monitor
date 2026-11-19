// Incident scenarios for the replay: built from the documented characteristics of the 2026
// incidents (project description, "Classes of detectable events") and inserted into the
// recorded background at a chosen moment t0. Every scenario states its assumptions: where
// the public write-up gives a number it is used, everything else is a declared parameter.

import { readFileSync } from 'node:fs';
import type { NpmPerson, Packument, VersionManifest } from '../stage2/types.ts';

export interface HistoryVersion {
  v: string;
  t: number; // absolute, ms
  user: NpmPerson;
  m?: Partial<VersionManifest>;
}

export interface BurstVersion {
  v: string;
  offsetMs: number; // from t0
  user: NpmPerson;
  m?: Partial<VersionManifest>;
}

export interface ScenarioPackage {
  name: string;
  rev: number; // document revision before the wave: ≥ 10 is "mature" for stage 1
  history: HistoryVersion[];
  burst: BurstVersion[];
  maintainers: NpmPerson[];
  repository: string;
}

export interface Scenario {
  id: string;
  title: string;
  source: string;
  assumptions: string[];
  durationMs: number; // from t0 to the last publication of the wave
  build(t0: number, rng: () => number, taken: Set<string>): ScenarioPackage[];
}

const SEC = 1000;
const MIN = 60 * SEC;
const DAY = 86_400 * SEC;

export const human = (name: string, email = `${name}@example.org`): NpmPerson => ({ name, email });
export const ci = (config: string): NpmPerson => ({ name: 'GitHub Actions', email: 'npm-oidc-no-reply@github.com', trustedPublisher: { id: 'github', oidcConfigId: config } });

const baseManifest = (): Partial<VersionManifest> => ({
  scripts: { build: 'tsc', test: 'node --test' },
  dependencies: { 'base-dep': '^1.0.0' },
  dist: { unpackedSize: 40_000, fileCount: 10 },
  gitHead: 'a1b2c3d4',
});

// Packument as the registry would serve it at `now`: history plus the burst versions
// published by then. Times go to `time`, manifests to `versions`.
export function packumentAt(pkg: ScenarioPackage, t0: number, now: number): Packument {
  const versions: Record<string, VersionManifest> = {};
  const time: Record<string, string> = {};
  const list: { v: string; t: number; user: NpmPerson; m?: Partial<VersionManifest> }[] = [
    ...pkg.history,
    ...pkg.burst.map((b) => ({ v: b.v, t: t0 + b.offsetMs, user: b.user, m: b.m })).filter((b) => b.t <= now),
  ].sort((a, b) => a.t - b.t);
  for (const x of list) {
    time[x.v] = new Date(x.t).toISOString();
    versions[x.v] = { version: x.v, _npmUser: x.user, maintainers: pkg.maintainers, repository: pkg.repository, ...baseManifest(), ...x.m };
  }
  time.created = time[list[0]!.v]!;
  time.modified = time[list.at(-1)!.v]!;
  return { name: pkg.name, 'dist-tags': { latest: list.at(-1)!.v }, versions, time, maintainers: pkg.maintainers, repository: pkg.repository };
}

// --- node-ipc, 14 May 2026 ------------------------------------------------------------------
// Three versions (12.0.1, 9.2.3, 9.1.6) within 55 seconds into non-adjacent release lines by
// an account that had published none of the previous versions, after 640 days of silence.
const IPC_OWNER = human('owner');
const ipcHistory: HistoryVersion[] = [
  ['9.0.0', '2017-01-10T00:00:00Z'],
  ['9.1.0', '2017-06-10T00:00:00Z'],
  ['9.1.5', '2019-03-10T00:00:00Z'],
  ['9.2.1', '2021-03-10T00:00:00Z'],
  ['10.0.0', '2021-06-10T00:00:00Z'],
  ['11.0.0', '2022-06-10T00:00:00Z'],
  ['11.1.0', '2023-01-10T00:00:00Z'],
  ['12.0.0', '2024-08-12T16:28:35Z'],
].map(([v, t]) => ({ v: v!, t: Date.parse(t!), user: IPC_OWNER }));

export const nodeIpc: Scenario = {
  id: 'node-ipc',
  title: 'node-ipc: compromised publisher, three non-adjacent lines in 55 s',
  source: 'project description, class 1 and class 3; registry `time` field of node-ipc',
  assumptions: [
    'release history as in the registry: 9.0.0 (2017) … 12.0.0 (12 Aug 2024); the replay keeps the absolute dates, so the pause before the wave is 790–800 days instead of 640',
    'publication order and spacing: 12.0.1 at +0 s, 9.2.3 at +31 s, 9.1.6 at +55 s',
    'the attacker account has a custom e-mail domain of unknown age: RDAP is answered 404, so no domain feature is counted',
    'manifests of the malicious versions are identical to the previous ones (no lifecycle script, no size change): the conservative case',
    'the package is not on the top-1000 watchlist (true for the 19 Oct 2026 snapshot)',
  ],
  durationMs: 55 * SEC,
  build: () => {
    const mallory = human('mallory', 'mallory@fresh-domain.dev');
    return [
      {
        name: 'node-ipc',
        rev: 300,
        history: ipcHistory,
        burst: [
          { v: '12.0.1', offsetMs: 0, user: mallory },
          { v: '9.2.3', offsetMs: 31 * SEC, user: mallory },
          { v: '9.1.6', offsetMs: 55 * SEC, user: mallory },
        ],
        maintainers: [IPC_OWNER],
        repository: 'git+https://github.com/owner/node-ipc.git',
      },
    ];
  },
};

// --- ChainDrop, 4 August 2026 ---------------------------------------------------------------
// 444 packages and 2 212 versions in under four hours; the second wave reached 433 further
// packages by 13:20. Malicious files were pushed to the main branch with an immediate release,
// so every version carried a valid GitHub Actions provenance: the publisher matches the history.

const SYL = ['ka', 'ren', 'to', 'mi', 'lu', 'vex', 'or', 'da', 'pel', 'sun', 'ti', 'gro', 'fa', 'nim', 'zo', 'bri', 'cal', 'dex', 'hol', 'jun', 'kir', 'mo', 'nav', 'pur', 'quo', 'ras', 'sel', 'tur', 'ul', 'vin', 'wes', 'yal'];
function word(rng: () => number, syllables: number): string {
  let s = '';
  for (let i = 0; i < syllables; i++) s += SYL[Math.floor(rng() * SYL.length)];
  return s;
}

// Distinct namespaces: unscoped names get distinct first tokens (the name-cluster lane must
// not see a family), scoped names get distinct scopes. Names already in the journal are skipped.
function uniqueNames(count: number, rng: () => number, taken: Set<string>): string[] {
  const names: string[] = [];
  const namespaces = new Set<string>();
  while (names.length < count) {
    const scoped = rng() < 0.5;
    const a = word(rng, 2 + Math.floor(rng() * 2));
    const b = word(rng, 1 + Math.floor(rng() * 2));
    const name = scoped ? `@${a}/${b}` : `${a}-${b}`;
    const ns = scoped ? `@${a}` : a;
    if (taken.has(name) || namespaces.has(ns)) continue;
    namespaces.add(ns);
    names.push(name);
  }
  return names;
}

export interface ChainDropOptions {
  id: string;
  title: string;
  firstWave: number;
  secondWave: number;
  versionsPerPackage: number;
  secondWaveFromMs: number;
  secondWaveToMs: number;
}

export function chainDrop(o: ChainDropOptions): Scenario {
  const total = o.firstWave + o.secondWave;
  return {
    id: o.id,
    title: o.title,
    source: 'project description, class 2 and class 5',
    assumptions: [
      `${o.firstWave} packages in the first wave within 10 minutes of t0, ${o.secondWave} more starting uniformly between +${o.secondWaveFromMs / MIN} and +${o.secondWaveToMs / MIN} minutes`,
      `${o.versionsPerPackage} version(s) per package, 30–45 s apart, patch bumps in the current line (2 212 versions / 444 packages ≈ 5 in the write-up)`,
      'every package is mature (12 earlier versions over two years, document revision ≥ 40) and published from GitHub Actions trusted publishing before and during the wave: no publisher feature can fire',
      'the first malicious version of each package adds a postinstall script, one dependency, 10× the unpacked size and 3× the file count (class 5 of the description); later versions repeat that manifest',
      'package names are synthetic: half scoped, half unscoped, all namespaces distinct and absent from the journal',
      'the last benign release of each package was 5–120 days before the wave',
    ],
    durationMs: o.secondWaveToMs + o.versionsPerPackage * 45 * SEC,
    build: (t0, rng, taken) => {
      const names = uniqueNames(total, rng, taken);
      return names.map((name, i) => {
        const cfg = ci(`cfg-${i}`);
        const lastBenign = t0 - (5 + rng() * 115) * DAY;
        const history: HistoryVersion[] = [];
        for (let k = 0; k < 12; k++) {
          history.push({ v: `1.${Math.floor(k / 4)}.${k % 4}`, t: lastBenign - (11 - k) * 60 * DAY, user: k < 6 ? human(`dev-${i}`) : cfg });
        }
        const start = i < o.firstWave ? rng() * 7 * MIN : o.secondWaveFromMs + rng() * (o.secondWaveToMs - o.secondWaveFromMs);
        const malicious: Partial<VersionManifest> = {
          scripts: { build: 'tsc', test: 'node --test', postinstall: 'node scripts/setup.js' },
          dependencies: { 'base-dep': '^1.0.0', 'ws-helper': '^2.1.0' },
          dist: { unpackedSize: 400_000, fileCount: 30 },
        };
        const burst: BurstVersion[] = [];
        let at = start;
        for (let k = 0; k < o.versionsPerPackage; k++) {
          burst.push({ v: `1.2.${4 + k}`, offsetMs: Math.round(at), user: cfg, m: malicious });
          at += (30 + rng() * 15) * SEC;
        }
        return { name, rev: 40 + Math.floor(rng() * 200), history, burst, maintainers: [human(`dev-${i}`)], repository: `git+https://github.com/org-${i}/${name.replace(/^@[^/]+\//, '')}.git` };
      });
    },
  };
}

// --- Incidents from recorded data ---------------------------------------------------------------
// The packages, the malicious versions and their publication times are the real ones: the
// malware advisories name the versions, and the registry keeps the time of every version it
// removed. evaluation/chaindrop/build.mjs builds a fixture from these two sources. What the
// registry no longer holds, the manifest of a removed version, comes from the write-ups.

interface IncidentFixture {
  source: string;
  first: string;
  last: string;
  packages: {
    name: string;
    earlier: number;
    history: [version: string, time: string, publisher: number, trusted: 0 | 1][];
    last: { scripts: Record<string, string>; deps: string[]; size: number | null; files: number | null; provenance: boolean; gitHead: boolean };
    burst: [version: string, time: string][];
    maintainers: number;
  }[];
}

interface RecordedSpec {
  id: string;
  title: string;
  source: string;
  // what a malicious version changed in the last benign manifest
  script?: [hook: 'preinstall' | 'postinstall', command: string];
  addedBytes?: number;
  addedFiles?: number;
  dropsProvenance?: boolean;
  assumptions: string[];
}

const COMMON_ASSUMPTIONS = [
  'packages, malicious versions and their times are the recorded ones; the whole wave is shifted so that its first publication falls on t0, and the release history is shifted by the same amount, so every interval is kept',
  'the document revision before the wave is not recorded; the number of earlier versions plus one is used, a lower bound. When the journal already holds the package, its revision count continues',
  'package names are real, so the watchlist, the name rules and the background activity of the same scopes act as they would in production',
  'account names are replaced by per-package labels; e-mail addresses are not used, so no domain feature can fire',
];

const fixtures = new Map<string, IncidentFixture>();
function loadFixture(id: string): IncidentFixture {
  let fx = fixtures.get(id);
  if (!fx) {
    fx = JSON.parse(readFileSync(new URL(`./data/${id}.json`, import.meta.url), 'utf8')) as IncidentFixture;
    fixtures.set(id, fx);
  }
  return fx;
}

function recorded(spec: RecordedSpec): Scenario {
  const fx = loadFixture(spec.id);
  return {
    id: spec.id,
    title: spec.title,
    source: spec.source,
    assumptions: [...spec.assumptions, ...COMMON_ASSUMPTIONS],
    durationMs: Date.parse(fx.last) - Date.parse(fx.first),
    build: (t0) => {
      const first = Date.parse(fx.first);
      const shift = t0 - first;
      return fx.packages.map((p) => {
        const person = (label: number, trusted: 0 | 1): NpmPerson => (trusted ? ci(`cfg-${label}`) : { name: `acct-${label}` });
        const provenance = { attestations: { provenance: { predicateType: 'https://slsa.dev/provenance/v1' } } };
        const benign: Partial<VersionManifest> = {
          scripts: p.last.scripts,
          dependencies: Object.fromEntries(p.last.deps.map((d) => [d, '*'])),
          dist: {
            ...(p.last.size !== null ? { unpackedSize: p.last.size } : {}),
            ...(p.last.files !== null ? { fileCount: p.last.files } : {}),
            ...(p.last.provenance ? provenance : {}),
          },
          gitHead: p.last.gitHead ? 'a1b2c3d4' : undefined,
        };
        const malicious: Partial<VersionManifest> = {
          ...benign,
          scripts: spec.script ? { ...p.last.scripts, [spec.script[0]]: spec.script[1] } : p.last.scripts,
          dist: {
            ...(p.last.size !== null ? { unpackedSize: p.last.size + (spec.addedBytes ?? 0) } : {}),
            ...(p.last.files !== null ? { fileCount: p.last.files + (spec.addedFiles ?? 0) } : {}),
            ...(p.last.provenance && !spec.dropsProvenance ? provenance : {}),
          },
        };
        const history: HistoryVersion[] = p.history.map(([v, t, label, trusted]) => ({ v, t: Date.parse(t) + shift, user: person(label, trusted), m: benign }));
        const lastRelease = p.history.at(-1)!;
        const publisher = person(lastRelease[2], lastRelease[3]);
        const accounts = [...new Set(p.history.filter((h) => !h[3]).map((h) => h[2]))];
        const maintainers: NpmPerson[] = (accounts.length > 0 ? accounts : [0]).map((label) => ({ name: `acct-${label}` }));
        return {
          name: p.name,
          rev: p.earlier + 1,
          history,
          burst: p.burst.map(([v, t]) => ({ v, offsetMs: Date.parse(t) - first, user: publisher, m: malicious })),
          maintainers,
          repository: `git+https://github.com/replay/${p.name.replace(/^@[^/]+\//, '')}.git`,
        };
      });
    },
  };
}

const SAME_PUBLISHER = 'the publisher of a malicious version is the account or the trusted-publishing configuration that published the last benign version';

// The dropper and the second stage that every malicious version added (StepSecurity write-up,
// second wave: setup.mjs 11 017 bytes, math_init.js 727 680 bytes; the first wave was 18 901 bytes larger).
export const chainDropRecorded = recorded({
  id: 'chaindrop',
  title: 'ChainDrop as recorded: real packages, versions and publication times of 4 August 2026',
  source: 'GitHub Advisory Database (malware advisories of 4 August 2026) and the registry `time` field of each package; manifest change from the StepSecurity write-up',
  script: ['preinstall', 'node setup.mjs'],
  addedBytes: 11_017 + 727_680,
  addedFiles: 2,
  assumptions: [
    `${SAME_PUBLISHER}: the worm released through the victims' own pipelines and credentials`,
    'every malicious version adds a `preinstall` script and two files of 738 697 bytes in total to the last benign manifest and changes no dependency (write-up: "exactly three differences")',
  ],
});

// --- Held-out incidents of 2025 -----------------------------------------------------------------
// No threshold and no weight was tuned on these four waves. Where a write-up gives no number
// (the size of the added file), the manifest is left unchanged: the conservative case.

export const HELD_OUT: Scenario[] = [
  recorded({
    id: 'nx',
    title: 'Held-out: nx (s1ngularity), 26 August 2025 — stolen publishing token',
    source: 'GitHub Advisory Database (advisory of 27 August 2025) and the registry `time` field; manifest change from the Nx post-mortem and the Kaspersky write-up',
    script: ['postinstall', 'node telemetry.js'],
    addedFiles: 1,
    dropsProvenance: true,
    assumptions: [
      `${SAME_PUBLISHER}: the attackers used the npm token of the project's own release workflow`,
      'every malicious version adds a `postinstall` script and one file; the size of the file is not published, so the size is unchanged',
      'the malicious versions carry no provenance attestation (post-mortem: they "lacked NPM provenance signing")',
    ],
  }),
  recorded({
    id: 'qix',
    title: 'Held-out: chalk, debug and 18 more, 8 September 2025 — phished maintainer account',
    source: 'GitHub Advisory Database (advisories of 8–10 September 2025 with an exact version) and the registry `time` field; write-ups of Wiz, Cycode and StepSecurity',
    assumptions: [
      `${SAME_PUBLISHER}: the attacker published from the maintainer's own account after a phishing attack`,
      'the malicious code is in the runtime source of the package (a browser-side payload); no write-up reports a new lifecycle script, so the manifest and its size are taken as unchanged',
      'the advisories of 9–10 September without an exact version (duckdb, prebid.js) are a later compromise and are not in the wave',
    ],
  }),
  recorded({
    id: 'shai-hulud',
    title: 'Held-out: Shai-Hulud, 14–16 September 2025 — self-propagating worm',
    source: 'GitHub Advisory Database (advisories of 15–19 September 2025 with an exact version) and the registry `time` field; manifest change from the Socket write-up',
    script: ['postinstall', 'node bundle.js'],
    addedFiles: 1,
    assumptions: [
      `${SAME_PUBLISHER}: the worm published with the npm token found on the maintainer's machine`,
      'every malicious version adds a `postinstall` script and one file; the size of the file is not taken from a write-up, so the size is unchanged',
      'the fixture holds 105 packages and 183 versions; the write-ups count more than 500 packages. Advisories that name no exact version, packages gone from the registry and packages without a benign release are left out',
    ],
  }),
  recorded({
    id: 'shai-hulud-2',
    title: 'Held-out: Shai-Hulud, second wave, 24 November 2025',
    source: 'GitHub Advisory Database (advisories of 24–27 November 2025 with an exact version) and the registry `time` field; manifest change from the Socket and Trend Micro write-ups',
    script: ['preinstall', 'node setup_bun.js'],
    addedBytes: 10_000_000,
    addedFiles: 2,
    assumptions: [
      `${SAME_PUBLISHER}: the worm published with stolen npm tokens`,
      'every malicious version adds a `preinstall` script and two files; the write-up describes the larger one as a 10 MB bundle, so 10 000 000 bytes are added',
      'the fixture holds 583 packages and 810 versions: advisories with an exact version, packages still in the registry, with a benign release before the wave',
    ],
  }),
];

export const SCENARIOS: Scenario[] = [
  nodeIpc,
  chainDropRecorded,
  ...HELD_OUT,
  chainDrop({ id: 'chaindrop-model', title: 'ChainDrop, synthetic model: 444 packages in distinct namespaces, ~5 versions each', firstWave: 11, secondWave: 433, versionsPerPackage: 5, secondWaveFromMs: 40 * MIN, secondWaveToMs: 200 * MIN }),
  chainDrop({ id: 'chaindrop-model-1', title: 'ChainDrop, synthetic model: one version per package', firstWave: 11, secondWave: 433, versionsPerPackage: 1, secondWaveFromMs: 40 * MIN, secondWaveToMs: 200 * MIN }),
];
