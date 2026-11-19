# Evaluation: replay of incident scenarios

`report.md` and `report.json` are produced by `src/replay/main.ts` from exports of the
production database. The scenarios live in `src/replay/scenarios.ts`; every assumption they
make is printed in the report next to the results.

## Exporting the background

On the server, with `DATABASE_URL` from `.env` (the exports are not committed):

```sh
psql "$DATABASE_URL" -qAt -c "select json_build_object('seq',seq,'package',package,'rev',rev,'deleted',deleted,'observed_at',observed_at,'observed_after',observed_after) from feed_event order by seq" | gzip -1 > background.jsonl.gz
psql "$DATABASE_URL" -qAt -c "select json_build_object('name',name,'rank',rank) from popular_package where snapshot=(select max(snapshot) from popular_package) order by rank" > popular.jsonl
psql "$DATABASE_URL" -qAt -c "select json_build_object('seq',seq,'prescore',prescore,'candidate',candidate,'features',features,'engine',engine) from stage1_result order by seq" | gzip -1 > stage1.jsonl.gz
psql "$DATABASE_URL" -qAt -c "select json_build_object('seq',seq,'package',package,'t',event_time,'at',enriched_at,'kind',kind,'versions',versions,'prescore',prescore,'final',final_score,'alert',alert,'features',features,'repeat',sources->>'repeat_of','engine',engine) from stage2_result order by seq" > stage2-all.jsonl
psql "$DATABASE_URL" -qAt -c "select json_build_object('hour',hour,'source',source,'requests',requests,'errors',errors,'skipped',skipped) from source_usage order by hour" > source_usage.jsonl
```

## Running

```sh
node --max-old-space-size=12000 src/replay/main.ts --data <dir-with-exports> --out evaluation/report.md --runs 10 --seed 1
```

Options: `--scenario <id>` runs one scenario, `--no-validate` skips the comparison of the
replay engine with the stored stage-1 results. A run takes about 50 seconds per insertion
on a laptop with a month of background (3.2 million events per pass).

## The ChainDrop scenario is built from recorded data

`src/replay/data/chaindrop.json` holds the real wave of 4 August 2026: 432 packages and
2 053 malicious versions with their publication times, and the release history of each
package. `evaluation/chaindrop/build.mjs` builds it from two public sources:

- the GitHub Advisory Database — the malware advisories published that day name the packages
  and the exact malicious versions;
- the npm registry — the `time` field of a package document keeps the publication time of
  every version, also of the versions the registry removed.

The write-ups count 444 packages and 2 212 versions. Seventeen packages are no longer in the
registry and one advisory of that day belongs to another campaign, so the fixture is 97 % of
the wave. Account names are replaced by labels. What the registry no longer holds — the
manifests of the removed versions — is taken from the StepSecurity write-up: a `preinstall`
script and two added files, no dependency change, the victims' own publishers.

The two `chaindrop-model` scenarios are the earlier synthetic model (444 packages in distinct
namespaces). They stay for comparison: the recorded wave is concentrated in a few
organisations, and that changes which stage-1 features fire.

## Held-out incidents

The parameters were tuned on node-ipc and ChainDrop. Four waves of 2025 are replayed with the
same frozen parameters and were never used for tuning: nx (26 August), chalk and debug
(8 September), Shai-Hulud (14–16 September) and its second wave (24 November). The same
builder makes their fixtures:

```sh
node evaluation/chaindrop/build.mjs nx            # also: qix, shai-hulud, shai-hulud-2
```

A fixture holds only what the two sources still give: advisories that name an exact version,
packages still in the registry, with a benign release before the wave. The scenario titles in
the report state the coverage and what the manifest change is taken from.

`chaindrop-analysis.md` explains why the recorded ChainDrop wave is alerted late and in part;
`chaindrop/analyse.mjs` computes its figures from the fixture.

## Delayed confirmation

`advisory-check.md` compares the journal with the malware advisories published during the
observation period; the scripts are in `advisory/`.

## Restart test

`restart-test.mjs` checks that no event is lost or duplicated across restarts (NFR-1). The real
collector reads a local model of the changes feed that fails on purpose (HTTP 500, connections
cut in the middle of an answer) and is killed at a random moment again and again until the
whole feed is read. The journal is then compared with the feed event by event.

```sh
docker compose -f compose.dev.yml up -d
node evaluation/restart-test.mjs 200000 1      # events, seed
```

Result of 19 November 2026, two runs of 200 000 events (seeds 1 and 2): 86 and 94 kills, 108
answers HTTP 500 and 81 cut connections in total; 0 events missing, 0 duplicated, the cursor on
the last event.

`coverage.mjs` computes KPI-1, the share of the observation period without a gap in the journal.

## What is measured

- **Background** per full day: events, stage-1 candidates, enriched events, requests to
  sources and alerts under the current alert rule (stored results of earlier engines are
  re-read with the current rules). Every background alert counts as false.
- **Per scenario**, over the runs: whether stage 1 produced a candidate and stage 2 an alert
  (recall), the share of packages alerted, final scores, the delay from the first publication
  of the wave to the first candidate and to the first alert (stage-2 settle included), the
  background alerts in the same window and the resulting precision, and the source requests
  the scenario cost.
- **Validation**: the replay engine over the journal without scenarios reproduces the stored
  stage-1 results of the same parameter set.
