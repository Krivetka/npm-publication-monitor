// Replay of incident scenarios on the recorded background.
//
//   node src/replay/main.ts --data <dir> [--out evaluation/report.md] [--runs 10] [--seed 1]
//                           [--scenario id] [--no-validate] [--validate-engine prefix]
//
// <dir> holds exports of the production database (see evaluation/README.md):
//   background.jsonl[.gz]  the journal `feed_event` in seq order
//   popular.jsonl          the latest top-10 000 snapshot (name, rank)
//   stage1.jsonl[.gz]      `stage1_result` (seq, prescore, candidate, features, engine) — validation
//   stage2-all.jsonl       `stage2_result` — background alerts under the current alert rule
//   source_usage.jsonl     hourly request counts per source
//
// For every run a scenario is inserted at a random moment t0 of the background, the whole
// stream goes through the stage-1 engine (fresh windows, warmed up by the journal itself), and
// every scenario candidate is enriched by stage 2 against a packument the registry would have
// served at that moment, with external sources answering "unknown". Background alerts come
// from the stored stage-2 results re-evaluated under the current alert rule.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Feature } from '../lib/feature.ts';
import { type FeedEvent, type PrevInfo, prevFromEvent, Stage1Engine, type Stage1Result } from '../stage1/engine.ts';
import { NameIndex } from '../stage1/nominal.ts';
import { DEFAULT_PARAMS } from '../stage1/params.ts';
import { type Candidate, enrichCandidate, evidenceOf, isAlert, type Stage2Outcome } from '../stage2/enrich.ts';
import { STAGE2_PARAMS, stage2EngineId } from '../stage2/params.ts';
import { hasLineGap } from '../stage2/registry.ts';
import type { Outcome, Sources } from '../stage2/sources.ts';
import type { Packument } from '../stage2/types.ts';
import { packumentAt, SCENARIOS, type Scenario, type ScenarioPackage } from './scenarios.ts';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const SETTLE_MS = STAGE2_PARAMS.settleMs + 30 * SEC; // settle plus polling and enrichment
const SCENARIO_SEQ = 1_000_000_000;

// --- arguments --------------------------------------------------------------------------------

const argv = process.argv.slice(2);
const opt = (name: string, def?: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const dataDir = opt('data');
if (!dataDir) {
  console.error('usage: node src/replay/main.ts --data <dir> [--out file] [--runs n] [--seed n] [--scenario id] [--no-validate]');
  process.exit(2);
}
const outFile = opt('out', 'evaluation/report.md')!;
const runs = Number(opt('runs', '10'));
const seed = Number(opt('seed', '1'));
const only = opt('scenario')?.split(',');
const validate = !argv.includes('--no-validate');
// stored results to validate against: by default those of the current stage-1 parameter version
const validateEngine = opt('validate-engine', `${DEFAULT_PARAMS.version}:`)!;

// --- loading ----------------------------------------------------------------------------------

// Lines are cut from the buffer one by one: a month of the journal is larger than the longest
// string the runtime allows, so the file cannot be decoded as one string.
function* readLines(dir: string, base: string): Generator<string> {
  const gz = join(dir, `${base}.gz`);
  const buf = existsSync(gz) ? gunzipSync(readFileSync(gz)) : readFileSync(join(dir, base));
  let start = 0;
  while (start < buf.length) {
    let end = buf.indexOf(10, start);
    if (end === -1) end = buf.length;
    if (end > start) yield buf.toString('utf8', start, end);
    start = end + 1;
  }
}

interface BgRow {
  seq: number;
  package: string;
  rev: string;
  deleted: boolean;
  observed_at: string;
  observed_after: string | null;
}
const t = Date.now();
const background: FeedEvent[] = [];
// day of the server's zone, as the export printed it
const bgDay = new Map<number, string>();
for (const l of readLines(dataDir, 'background.jsonl')) {
  const r = JSON.parse(l) as BgRow;
  background.push({ seq: r.seq, package: r.package, rev: r.rev, deleted: r.deleted, observedAt: new Date(r.observed_at), observedAfter: r.observed_after ? new Date(r.observed_after) : null });
  bgDay.set(r.seq, r.observed_at.slice(0, 10));
}
const popular = [...readLines(dataDir, 'popular.jsonl')].map((l) => JSON.parse(l) as { name: string; rank: number });
const names = new NameIndex(popular, DEFAULT_PARAMS.nominalMinLength);
const taken = new Set(background.map((e) => e.package));
const journalStart = background[0]!.observedAt;
const journalEnd = background.at(-1)!.observedAt;
console.error(`background: ${background.length} events, ${journalStart.toISOString()} … ${journalEnd.toISOString()}, ${popular.length} popular names (${Date.now() - t} ms)`);

// --- stage-1 pass -----------------------------------------------------------------------------

interface PassResult {
  results: Map<number, Stage1Result>; // for scenario events only (or all when collectAll)
  prevAt: Map<number, Date | null>; // previous event time of the package, per scenario seq
}

function runStage1(extra: FeedEvent[], collectAll = false): PassResult {
  const engine = new Stage1Engine(DEFAULT_PARAMS, names, journalStart);
  const stream = extra.length === 0 ? background : [...background, ...extra].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime() || a.seq - b.seq);
  const prev = new Map<string, PrevInfo>();
  const results = new Map<number, Stage1Result>();
  const prevAt = new Map<number, Date | null>();
  for (const e of stream) {
    const p = prev.get(e.package) ?? null;
    const r = engine.process(e, p);
    if (e.seq >= SCENARIO_SEQ) prevAt.set(e.seq, p ? new Date(p.time) : null);
    prev.set(e.package, prevFromEvent(e));
    if (r && (collectAll || e.seq >= SCENARIO_SEQ)) results.set(e.seq, r);
  }
  return { results, prevAt };
}

// --- validation: the replay reproduces production ---------------------------------------------

interface S1Row {
  seq: number;
  prescore: number;
  candidate: boolean;
  features: Feature[];
  engine: string;
}

function validateAgainstProduction(): string {
  const started = Date.now();
  const pass = runStage1([], true);
  const rows = [...readLines(dataDir!, 'stage1.jsonl')].map((l) => JSON.parse(l) as S1Row);
  const current = validateEngine;
  let compared = 0;
  let same = 0;
  let sameFeatures = 0;
  const diffs: string[] = [];
  for (const r of rows) {
    if (!r.engine.startsWith(current)) continue;
    const mine = pass.results.get(r.seq);
    if (!mine) continue;
    compared++;
    const ids = (f: Feature[]) => f.map((x) => x.id).sort().join('+');
    if (mine.prescore === r.prescore && mine.candidate === r.candidate) same++;
    else if (diffs.length < 5) diffs.push(`seq ${r.seq}: production ${r.prescore}/${ids(r.features)} vs replay ${mine.prescore}/${ids(mine.features)}`);
    if (ids(mine.features) === ids(r.features)) sameFeatures++;
  }
  // hits the replay has that production has not (only for the period production ran the same engine)
  const prodSeqs = new Set(rows.filter((r) => r.engine.startsWith(current)).map((r) => r.seq));
  let minProd = Infinity;
  for (const s of prodSeqs) if (s < minProd) minProd = s;
  let extraHits = 0;
  for (const [seq, r] of pass.results) if (seq >= minProd && r.features.length > 0 && !prodSeqs.has(seq)) extraHits++;
  console.error(`validation: ${compared} production hits compared, ${same} same prescore+candidate, ${sameFeatures} same feature set, ${extraHits} replay-only hits (${Date.now() - started} ms)`);
  const pct = (n: number) => `${((100 * n) / Math.max(compared, 1)).toFixed(2)} %`;
  return [
    `The replay engine (${DEFAULT_PARAMS.version}) was run over the journal without scenarios and compared with the stored stage-1 results of engine \`${current}\` (${compared} production hits). A different parameter version explains score differences on the features whose weights changed; the feature sets must match.`,
    '',
    `| Check | Result |`,
    `|---|---|`,
    `| Same preliminary score and candidate flag | ${same} (${pct(same)}) |`,
    `| Same feature set | ${sameFeatures} (${pct(sameFeatures)}) |`,
    `| Hits in the replay absent from production | ${extraHits} |`,
    '',
    diffs.length > 0 ? `First differences: ${diffs.join('; ')}.` : 'No differences.',
  ].join('\n');
}

// --- background under the current alert rule --------------------------------------------------

interface S2Row {
  seq: number;
  package: string;
  t: string;
  at: string;
  kind: string;
  prescore: number;
  final: number;
  alert: boolean;
  features: Feature[];
  engine: string;
}

// Events that stage 1 put on the watchlist: the alert rule treats them differently.
const watchlistSeqs = new Set<number>();
for (const l of readLines(dataDir, 'stage1.jsonl')) {
  if (!l.includes('"watchlist"')) continue;
  const r = JSON.parse(l) as { seq: number; features: Feature[] };
  if (r.features.some((f) => f.id === 'watchlist')) watchlistSeqs.add(r.seq);
}

// Stored results of earlier engines are re-read with the current rules: the 0.0.x line is not
// a release line, and the alert rule is the current one (enrich.ts).
function normalise(r: S2Row): { final: number; alert: boolean; features: Feature[] } {
  const features = r.features.flatMap((f): Feature[] => {
    if (f.id !== 'non_adjacent_branches' && f.id !== 'multi_branch') return [f];
    const g = hasLineGap(f.value as string[]);
    if (g.lines.length < 2) return [];
    return [{ ...f, id: g.gap ? 'non_adjacent_branches' : 'multi_branch', weight: g.gap ? STAGE2_PARAMS.weights.non_adjacent_branches : STAGE2_PARAMS.weights.multi_branch }];
  });
  const s2 = features.reduce((s, f) => s + f.weight, 0);
  const final = r.prescore + s2;
  const alert = isAlert({ finalScore: final, evidence: evidenceOf(features, STAGE2_PARAMS), kind: r.kind, watchlist: watchlistSeqs.has(r.seq) }, STAGE2_PARAMS);
  return { final, alert, features };
}

interface BgAlert {
  seq: number;
  package: string;
  t: number;
  day: string;
  final: number;
  combo: string;
}

function backgroundAlerts(): { alerts: BgAlert[]; enrichedByDay: Map<string, number> } {
  const rows = [...readLines(dataDir!, 'stage2-all.jsonl')].map((l) => JSON.parse(l) as S2Row).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  const last = new Map<string, number>();
  const alerts: BgAlert[] = [];
  const enrichedByDay = new Map<string, number>();
  for (const r of rows) {
    const day = r.at.slice(0, 10);
    enrichedByDay.set(day, (enrichedByDay.get(day) ?? 0) + 1);
    const n = normalise(r);
    if (!n.alert) continue;
    const tt = Date.parse(r.t);
    const l = last.get(r.package);
    if (l !== undefined && tt - l < STAGE2_PARAMS.alertRepeatHours * HOUR) continue;
    last.set(r.package, tt);
    alerts.push({ seq: r.seq, package: r.package, t: tt, day: r.t.slice(0, 10), final: n.final, combo: n.features.map((f) => f.id).sort().join('+') });
  }
  return { alerts, enrichedByDay };
}

// --- stage 2 for scenario candidates ----------------------------------------------------------

const ok = <T>(body: T | null, status = 200): Outcome<T> => ({ ok: true, status, body });
// External sources answer neutrally: the repository exists, was pushed to recently and holds the
// commit; deps.dev, the maintainer profile and RDAP know nothing. No scenario gets credit from a
// source the replay cannot consult.
function stubSources(pack: Packument, now: number, calls: { n: number }): Sources {
  const count = <T>(o: Outcome<T>) => (calls.n++, o);
  const eco = { repo_metadata: { archived: false, pushed_at: new Date(now - 2 * 86_400 * SEC).toISOString(), last_synced_at: new Date(now).toISOString() } };
  return {
    packument: async () => count(ok(pack)),
    ecoPackage: async () => count(ok(eco)),
    ecoMaintainer: async () => count(ok(null, 404)),
    depsdevVersion: async () => count(ok(null, 404)),
    githubCommit: async () => count(ok({ sha: 'a1b2c3d4' })),
    rdap: async () => count(ok(null, 404)),
  } as unknown as Sources;
}
const noDomains = { get: async () => null, set: async () => {} };

// --- a run ------------------------------------------------------------------------------------

interface RunResult {
  t0: number;
  events: number;
  packages: number;
  candidates: number;
  candidatePackages: number;
  firstCandidateMs: number | null;
  s1Features: Map<string, number>;
  enriched: number;
  alerts: number;
  alertPackages: number;
  firstAlertMs: number | null;
  scores: number[];
  s2Features: Map<string, number>;
  requests: number;
  bgAlertsInWindow: number;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

async function runScenario(sc: Scenario, t0: number, rng: () => number, bg: BgAlert[]): Promise<RunResult> {
  const pkgs = sc.build(t0, rng, taken);
  const byName = new Map<string, ScenarioPackage>(pkgs.map((p) => [p.name, p]));
  // feed events: one per published version, visible to the collector five seconds later
  const events: FeedEvent[] = [];
  let seq = SCENARIO_SEQ;
  // A scenario with real package names can meet the same package in the journal. Its revision
  // count then continues from the last journal event before each scenario event: a lower number
  // would look like a revision regression and give the scenario a feature it did not earn. A
  // wave can last two days, so the journal is read up to the event, not up to t0.
  const journal = new Map<string, { t: number; rev: number }[]>();
  const tEnd = t0 + sc.durationMs + 5 * SEC;
  for (const e of background) {
    const t = e.observedAt.getTime();
    if (t > tEnd) break;
    if (!byName.has(e.package)) continue;
    const list = journal.get(e.package) ?? [];
    list.push({ t, rev: Number.parseInt(e.rev, 10) });
    journal.set(e.package, list);
  }
  for (const p of pkgs) {
    const seen = journal.get(p.name) ?? [];
    let rev = p.rev;
    let j = 0;
    for (const b of p.burst) {
      const at = t0 + b.offsetMs + 5 * SEC;
      for (; j < seen.length && seen[j]!.t <= at; j++) rev = Math.max(rev, seen[j]!.rev);
      rev++;
      events.push({ seq: seq++, package: p.name, rev: `${rev}-replay`, deleted: false, observedAt: new Date(at), observedAfter: new Date(at - 5 * SEC) });
    }
  }
  events.sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const pass = runStage1(events);

  const r: RunResult = {
    t0,
    events: events.length,
    packages: pkgs.length,
    candidates: 0,
    candidatePackages: 0,
    firstCandidateMs: null,
    s1Features: new Map(),
    enriched: 0,
    alerts: 0,
    alertPackages: 0,
    firstAlertMs: null,
    scores: [],
    s2Features: new Map(),
    requests: 0,
    bgAlertsInWindow: 0,
  };
  const candPkgs = new Set<string>();
  const alertPkgs = new Set<string>();
  const lastAlert = new Map<string, number>();
  for (const e of events) {
    const s1 = pass.results.get(e.seq);
    if (!s1) continue;
    for (const f of s1.features) r.s1Features.set(f.id, (r.s1Features.get(f.id) ?? 0) + 1);
    if (!s1.candidate) continue;
    r.candidates++;
    candPkgs.add(e.package);
    const offset = e.observedAt.getTime() - t0;
    if (r.firstCandidateMs === null || offset < r.firstCandidateMs) r.firstCandidateMs = offset;

    const now = e.observedAt.getTime() + SETTLE_MS;
    const pack = packumentAt(byName.get(e.package)!, t0, now);
    const calls = { n: 0 };
    const c: Candidate = { seq: e.seq, package: e.package, prescore: s1.prescore, observedAt: e.observedAt, observedAfter: e.observedAfter, prevObservedAt: pass.prevAt.get(e.seq) ?? null, watchlist: s1.features.some((f) => f.id === 'watchlist') };
    const out: Stage2Outcome | 'defer' | 'retry' = await enrichCandidate(c, stubSources(pack, now, calls), noDomains, STAGE2_PARAMS, now);
    r.requests += calls.n;
    if (out === 'defer' || out === 'retry') continue;
    r.enriched++;
    r.scores.push(out.finalScore);
    for (const f of out.features) r.s2Features.set(f.id, (r.s2Features.get(f.id) ?? 0) + 1);
    if (!out.alert) continue;
    const la = lastAlert.get(e.package);
    if (la !== undefined && e.observedAt.getTime() - la < STAGE2_PARAMS.alertRepeatHours * HOUR) continue;
    lastAlert.set(e.package, e.observedAt.getTime());
    r.alerts++;
    alertPkgs.add(e.package);
    const alertAt = now - t0;
    if (r.firstAlertMs === null || alertAt < r.firstAlertMs) r.firstAlertMs = alertAt;
  }
  r.candidatePackages = candPkgs.size;
  r.alertPackages = alertPkgs.size;
  const winEnd = t0 + sc.durationMs + HOUR;
  r.bgAlertsInWindow = bg.filter((a) => a.t >= t0 && a.t <= winEnd).length;
  return r;
}

// --- report -----------------------------------------------------------------------------------

const fmtMin = (ms: number | null) => (ms === null ? '—' : `${(ms / MIN).toFixed(1)} min`);
const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};
const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
const topFeatures = (m: Map<string, number>, n = 6) =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ') || '—';

async function main() {
  const { alerts: bg, enrichedByDay } = backgroundAlerts();
  const days = [...new Set(background.map((e) => bgDay.get(e.seq)!))].sort();
  const fullDays = days.slice(1, -1);
  const eventsByDay = new Map<string, number>();
  for (const e of background) eventsByDay.set(bgDay.get(e.seq)!, (eventsByDay.get(bgDay.get(e.seq)!) ?? 0) + 1);
  const candByDay = new Map<string, number>();
  for (const l of readLines(dataDir!, 'stage1.jsonl')) {
    const r = JSON.parse(l) as S1Row;
    if (!r.candidate) continue;
    const d = bgDay.get(r.seq);
    if (d) candByDay.set(d, (candByDay.get(d) ?? 0) + 1);
  }
  const reqByDay = new Map<string, number>();
  for (const l of readLines(dataDir!, 'source_usage.jsonl')) {
    const r = JSON.parse(l) as { hour: string; requests: number };
    reqByDay.set(r.hour.slice(0, 10), (reqByDay.get(r.hour.slice(0, 10)) ?? 0) + r.requests);
  }
  const bgByDay = new Map<string, number>();
  for (const a of bg) bgByDay.set(a.day, (bgByDay.get(a.day) ?? 0) + 1);

  const lines: string[] = [];
  lines.push('# Replay of incident scenarios on the recorded background', '');
  lines.push(`Generated ${new Date().toISOString()} by \`src/replay/main.ts\` (seed ${seed}, ${runs} runs per scenario). Stage-1 parameters \`${DEFAULT_PARAMS.version}\`, stage-2 \`${stage2EngineId(STAGE2_PARAMS)}\`.`, '');
  lines.push(`Background: ${background.length} journal events from ${journalStart.toISOString()} to ${journalEnd.toISOString()}; full days ${fullDays[0]} … ${fullDays.at(-1)} (${fullDays.length}).`, '');

  lines.push('## Background per full day', '');
  lines.push('Every background alert is counted as false: no confirmed incident is known in the period, so the figure is an upper bound of the false-alert rate.', '');
  lines.push('| Day | Events | Stage-1 candidates | Enriched | Requests to sources | Alerts (current rule) |', '|---|---|---|---|---|---|');
  for (const d of fullDays) {
    const ev = eventsByDay.get(d) ?? 0;
    const c = candByDay.get(d) ?? 0;
    lines.push(`| ${d} | ${ev} | ${c} (${((100 * c) / ev).toFixed(1)} %) | ${enrichedByDay.get(d) ?? 0} | ${reqByDay.get(d) ?? 0} | ${bgByDay.get(d) ?? 0} |`);
  }
  const sum = (m: Map<string, number>) => fullDays.reduce((s, d) => s + (m.get(d) ?? 0), 0);
  const evTotal = sum(eventsByDay);
  const reqTotal = sum(reqByDay);
  const enrTotal = sum(enrichedByDay);
  const perEnriched = enrTotal > 0 ? reqTotal / enrTotal : 0;
  lines.push(`| mean | ${Math.round(evTotal / fullDays.length)} | ${Math.round(sum(candByDay) / fullDays.length)} (${((100 * sum(candByDay)) / evTotal).toFixed(1)} %) | ${Math.round(enrTotal / fullDays.length)} | ${Math.round(reqTotal / fullDays.length)} | ${(sum(bgByDay) / fullDays.length).toFixed(1)} |`, '');
  lines.push(`Enrichment costs ${perEnriched.toFixed(1)} requests per enriched event; enriching every event would cost about ${Math.round((perEnriched * evTotal) / fullDays.length)} requests a day against ${Math.round(reqTotal / fullDays.length)} with stage 1 (a reduction of ${(100 - (100 * reqTotal) / (perEnriched * evTotal)).toFixed(1)} %).`, '');
  const combos = new Map<string, number>();
  for (const a of bg) if (fullDays.includes(a.day)) combos.set(a.combo, (combos.get(a.combo) ?? 0) + 1);
  lines.push(`Most frequent background alert compositions: ${topFeatures(combos, 8)}.`, '');

  if (validate) lines.push('## Validation of the replay engine', '', validateAgainstProduction(), '');

  lines.push('## Scenarios', '');
  const summary: Record<string, unknown>[] = [];
  for (const sc of SCENARIOS) {
    if (only && !only.includes(sc.id)) continue;
    const rng = mulberry32(seed * 7919 + sc.id.length);
    const lo = journalStart.getTime() + 30 * HOUR;
    const hi = journalEnd.getTime() - sc.durationMs - HOUR;
    const results: RunResult[] = [];
    for (let i = 0; i < runs; i++) {
      const t0 = Math.round(lo + rng() * (hi - lo));
      const started = Date.now();
      const r = await runScenario(sc, t0, rng, bg);
      results.push(r);
      console.error(`${sc.id} run ${i + 1}/${runs} at ${new Date(t0).toISOString()}: ${r.candidates}/${r.events} candidates, ${r.alerts} alerts, ${r.alertPackages}/${r.packages} packages (${Date.now() - started} ms)`);
    }
    const detected = results.filter((r) => r.alerts > 0).length;
    const candRuns = results.filter((r) => r.candidates > 0).length;
    const s1 = new Map<string, number>();
    const s2 = new Map<string, number>();
    for (const r of results) {
      for (const [k, v] of r.s1Features) s1.set(k, (s1.get(k) ?? 0) + v);
      for (const [k, v] of r.s2Features) s2.set(k, (s2.get(k) ?? 0) + v);
    }
    const pkgRecall = mean(results.map((r) => r.alertPackages / r.packages))!;
    const precision = mean(results.map((r) => (r.alerts + r.bgAlertsInWindow > 0 ? r.alerts / (r.alerts + r.bgAlertsInWindow) : 1)))!;
    lines.push(`### ${sc.title}`, '', `Source: ${sc.source}.`, '', 'Assumptions:', '', ...sc.assumptions.map((a) => `- ${a}`), '');
    lines.push('| Measure | Value |', '|---|---|');
    lines.push(`| Runs / insertion window | ${runs}, t0 uniform in ${new Date(lo).toISOString().slice(0, 16)} … ${new Date(hi).toISOString().slice(0, 16)} |`);
    lines.push(`| Events / packages per run | ${results[0]!.events} / ${results[0]!.packages} |`);
    lines.push(`| Runs with a stage-1 candidate | ${candRuns} / ${runs} |`);
    lines.push(`| Candidates per run (mean) | ${mean(results.map((r) => r.candidates))!.toFixed(1)} of ${results[0]!.events} events, ${mean(results.map((r) => r.candidatePackages))!.toFixed(1)} of ${results[0]!.packages} packages |`);
    lines.push(`| Stage-1 features (total over runs) | ${topFeatures(s1)} |`);
    lines.push(`| Runs with an alert (recall) | ${detected} / ${runs} |`);
    lines.push(`| Packages alerted per run (mean) | ${mean(results.map((r) => r.alertPackages))!.toFixed(1)} of ${results[0]!.packages} (${(100 * pkgRecall).toFixed(1)} %) |`);
    lines.push(`| Alerts per run (mean) | ${mean(results.map((r) => r.alerts))!.toFixed(1)} |`);
    lines.push(`| Final score of enriched events (median / min / max) | ${median(results.flatMap((r) => r.scores)) ?? '—'} / ${results.some((r) => r.scores.length) ? Math.min(...results.flatMap((r) => r.scores)) : '—'} / ${results.some((r) => r.scores.length) ? Math.max(...results.flatMap((r) => r.scores)) : '—'} |`);
    lines.push(`| Stage-2 features (total over runs) | ${topFeatures(s2)} |`);
    lines.push(`| First candidate after wave start (median) | ${fmtMin(median(results.map((r) => r.firstCandidateMs).filter((x): x is number => x !== null)))} |`);
    lines.push(`| First alert after wave start (median) | ${fmtMin(median(results.map((r) => r.firstAlertMs).filter((x): x is number => x !== null)))} |`);
    lines.push(`| Background alerts in the wave window + 1 h (mean) | ${mean(results.map((r) => r.bgAlertsInWindow))!.toFixed(1)} |`);
    lines.push(`| Precision in the window (scenario alerts / all alerts, mean) | ${(100 * precision).toFixed(1)} % |`);
    lines.push(`| Source requests per run | ${mean(results.map((r) => r.requests))!.toFixed(0)} |`, '');
    summary.push({ id: sc.id, runs, detected, candRuns, pkgRecall, precision, firstAlertMs: results.map((r) => r.firstAlertMs), firstCandidateMs: results.map((r) => r.firstCandidateMs), alerts: results.map((r) => r.alerts), bg: results.map((r) => r.bgAlertsInWindow), t0: results.map((r) => new Date(r.t0).toISOString()) });
  }
  writeFileSync(outFile, `${lines.join('\n')}\n`);
  writeFileSync(outFile.replace(/\.md$/, '.json'), `${JSON.stringify({ generated: new Date().toISOString(), seed, runs, scenarios: summary }, null, 2)}\n`);
  console.error(`report: ${outFile}`);
}

await main();
