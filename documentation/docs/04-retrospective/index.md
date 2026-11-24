# 4. Retrospective

## What went well

- **Measuring before designing.** One afternoon of probing the feed (≈ 1.4 events/s, no payload), packument sizes (71 KB median, 8 MB at the 99th percentile) and API quotas fixed the two-stage architecture as a consequence of numbers.
- **Deterministic engines.** Because stage 1 and the registry analysis never touch the network while scoring, the node-ipc incident was reconstructed as a unit test from the registry's own `time` field before the system had seen a real alert.
- **Contract-first API.** The server and the client were built in parallel from one OpenAPI file, without renegotiation.
- **Evidence snapshots.** Storing packument slices at enrichment paid off on day one: the node-ipc versions of May 2026 are already gone from `versions` and survive only in `time`.
- **Honest time semantics.** Storing the interval in which an event appeared made catch-ups after restarts harmless for the temporal lane.

## What did not work and why

- **Version rules on stage 1 as described.** A feed event carries no version, so "non-adjacent release lines" and "major jump" moved from stage 1 to stage 2, where the packument is fetched anyway (agreed with the supervisor).
- **Expert thresholds on day one.** With two hours of baseline, stage 1 produced 681 candidates in three hours: the scope and name-cluster bursts fired together on every package of a monorepo release. Calibration v2 limited the cluster lane to unscoped names, raised those thresholds, required six hours of baseline, exempted packages with fewer than three versions from manifest and branch comparisons and limited alerts to one per package per six hours. Stage 2 still raised about 300 alerts a day, nine in ten from three causes: the `0.0.0-stage` placeholder of npm's staged publishing (252 packages in three days) read as a non-adjacent line; alerts on packages already purged, with nothing to show; a stage-1 burst plus one 0.5–1 feature. Calibration v3 (17 October) removed the three: 67 alerts instead of 662 in replay. Among the survivors: seven packages published at 1.0.1 within five hours from one e-mail domain registered six weeks earlier, without a repository — the shape the system was built for.
- **The first replay found two blind spots.** Stage 2 compared each version with the previous one of its line, which inside a wave is the wave's own earlier version: the third event of node-ipc saw a known publisher and no pause, and no ChainDrop package alerted. The history now ends ten minutes before the event's first version; both scenarios then alert in 10 of 10 runs.
- **A scenario built from a summary flattered the system.** The first ChainDrop model (444 namespaces, five versions each, 30–45 s apart) alerted on every package in 3 minutes. The wave rebuilt from advisories and the registry `time` field has 45 namespaces and a median gap of 6.8 minutes: 38 % of 432 packages alerted, the first at minute 51. `keyv` (rank 188) was enriched at minute 5 and its new `preinstall` script found, but the watchlist adds no score. In v6 a watchlist package is alerted on stage-2 evidence alone: first alert at 6.6 minutes, 0.6 more background alerts a day.
- **Held-out incidents of 2025**, never used for tuning: nx and chalk/debug raised no alert; two Shai-Hulud waves alerted in 10 of 10 runs, but on 1.2 % and 0.7 % of packages. One malicious version of an established package leaves no stage-1 trace; in chalk/debug the manifest did not change. v6 was adopted after this replay and does not alter it.

## Technical debt and known issues

Table: Known issues

| Issue | Impact | Plan |
|---|---|---|
| About 32 of 34 alerts a day are false (verdicts on a sample of 120) | many cards per finding | review only the alerts on one's own dependencies (page *My dependencies*) |
| 162 journal gaps over five minutes, 35 h in total: one reboot of 10 h, the rest of unrecorded cause | KPI-1 at 95.4 % against 99 % | log collector polls apart from feed silence |
| One quiet malicious version of an established package is not enriched | nx missed; ≈ 1 % of Shai-Hulud packages alerted | light check of install scripts and publisher: +11 500 requests a day |
| Cloud criterion not met | on-premise node, no external alerting | the stack deploys unchanged to a cloud VM; log shipping is prepared |
| `publisher_recent` uses the ecosyste.ms first-seen date | a lower bound of account age, not npm registration | documented; npm has no public account-age API |
| Single node, single database | no redundancy | nightly `pg_dumpall`; acceptable for a research system |

## Lessons learned

- Measure the external world before designing around it.
- Keep scoring logic free of I/O: restarts, replays, tests and calibration become simple.
- An honest "skipped: quota" or "repeat of" in the evidence is worth more than a silently missing feature.
- Replay through the real event sequence, built from recorded data: a model of an incident repeats the author's assumptions.
