# Replay of incident scenarios on the recorded background

Generated 2026-11-19T10:04:19.770Z by `src/replay/main.ts` (seed 1, 10 runs per scenario). Stage-1 parameters `v3`, stage-2 `v6:49ba8745`.

Background: 3168370 journal events from 2026-10-14T11:29:18.937Z to 2026-11-15T11:06:01.692Z; full days 2026-10-15 … 2026-11-14 (31).

## Background per full day

Every background alert is counted as false: no confirmed incident is known in the period, so the figure is an upper bound of the false-alert rate.

| Day | Events | Stage-1 candidates | Enriched | Requests to sources | Alerts (current rule) |
|---|---|---|---|---|---|
| 2026-10-15 | 116543 | 4575 (3.9 %) | 4582 | 18813 | 40 |
| 2026-10-16 | 99614 | 2482 (2.5 %) | 2477 | 9909 | 14 |
| 2026-10-17 | 71723 | 1304 (1.8 %) | 1310 | 6210 | 15 |
| 2026-10-18 | 66977 | 1305 (1.9 %) | 1282 | 5957 | 25 |
| 2026-10-19 | 103963 | 3301 (3.2 %) | 3324 | 14077 | 32 |
| 2026-10-20 | 111883 | 2710 (2.4 %) | 2683 | 11503 | 17 |
| 2026-10-21 | 112236 | 2724 (2.4 %) | 2751 | 12041 | 34 |
| 2026-10-22 | 113412 | 2294 (2.0 %) | 2293 | 9579 | 63 |
| 2026-10-23 | 105215 | 2541 (2.4 %) | 2539 | 10686 | 45 |
| 2026-10-24 | 74628 | 1509 (2.0 %) | 1508 | 6932 | 22 |
| 2026-10-25 | 79597 | 2568 (3.2 %) | 2571 | 8830 | 20 |
| 2026-10-26 | 106416 | 3379 (3.2 %) | 3377 | 13164 | 41 |
| 2026-10-27 | 112583 | 2270 (2.0 %) | 2273 | 9307 | 29 |
| 2026-10-28 | 107929 | 954 (0.9 %) | 942 | 3751 | 25 |
| 2026-10-29 | 111943 | 981 (0.9 %) | 986 | 4072 | 15 |
| 2026-10-30 | 102840 | 864 (0.8 %) | 870 | 3802 | 10 |
| 2026-10-31 | 71836 | 1067 (1.5 %) | 1064 | 4711 | 12 |
| 2026-11-01 | 67586 | 1170 (1.7 %) | 1173 | 5082 | 36 |
| 2026-11-02 | 114000 | 3337 (2.9 %) | 3316 | 14281 | 54 |
| 2026-11-03 | 119207 | 3277 (2.7 %) | 3297 | 13926 | 75 |
| 2026-11-04 | 115760 | 3218 (2.8 %) | 3220 | 14131 | 27 |
| 2026-11-05 | 88600 | 1547 (1.7 %) | 1544 | 6395 | 7 |
| 2026-11-06 | 106043 | 2952 (2.8 %) | 2955 | 13123 | 24 |
| 2026-11-07 | 72841 | 1572 (2.2 %) | 1571 | 7023 | 30 |
| 2026-11-08 | 74318 | 1980 (2.7 %) | 1977 | 8611 | 16 |
| 2026-11-09 | 110519 | 4152 (3.8 %) | 4136 | 17016 | 69 |
| 2026-11-10 | 117046 | 4399 (3.8 %) | 4408 | 19194 | 61 |
| 2026-11-11 | 112841 | 3271 (2.9 %) | 3277 | 14499 | 43 |
| 2026-11-12 | 116154 | 2996 (2.6 %) | 3000 | 13093 | 51 |
| 2026-11-13 | 107204 | 2939 (2.7 %) | 2892 | 13195 | 48 |
| 2026-11-14 | 78845 | 2183 (2.8 %) | 2230 | 10282 | 52 |
| mean | 99042 | 2446 (2.5 %) | 2446 | 10426 | 33.9 |

Enrichment costs 4.3 requests per enriched event; enriching every event would cost about 422138 requests a day against 10426 with stage 1 (a reduction of 97.5 %).

Most frequent background alert compositions: non_adjacent_branches 217, install_script_new_package 75, email_domain_expired+multi_branch 45, deps_added+files_jump+size_jump 38, multi_branch+repo_missing 36, repo_inactive+repo_missing 29, files_jump+publisher_recent+size_jump 28, publisher_recent+repo_missing 26.

## Validation of the replay engine

The replay engine (v3) was run over the journal without scenarios and compared with the stored stage-1 results of engine `v3:` (635674 production hits). A different parameter version explains score differences on the features whose weights changed; the feature sets must match.

| Check | Result |
|---|---|
| Same preliminary score and candidate flag | 635592 (99.99 %) |
| Same feature set | 635589 (99.99 %) |
| Hits in the replay absent from production | 86 |

First differences: seq 138056319: production 1/name_reorder vs replay 0/; seq 138109160: production 1/rate_scope vs replay 1/rate_scope+watchlist; seq 138154403: production 1.5/name_edit vs replay 0/; seq 138361235: production 1/rate_scope vs replay 1/rate_scope+watchlist; seq 138399620: production 0.5/new_package vs replay 2.5/name_scope_typo+new_package.

## Scenarios

### node-ipc: compromised publisher, three non-adjacent lines in 55 s

Source: project description, class 1 and class 3; registry `time` field of node-ipc.

Assumptions:

- release history as in the registry: 9.0.0 (2017) … 12.0.0 (12 Aug 2024); the replay keeps the absolute dates, so the pause before the wave is 790–800 days instead of 640
- publication order and spacing: 12.0.1 at +0 s, 9.2.3 at +31 s, 9.1.6 at +55 s
- the attacker account has a custom e-mail domain of unknown age: RDAP is answered 404, so no domain feature is counted
- manifests of the malicious versions are identical to the previous ones (no lifecycle script, no size change): the conservative case
- the package is not on the top-1000 watchlist (true for the 19 Oct 2026 snapshot)

| Measure | Value |
|---|---|
| Runs / insertion window | 10, t0 uniform in 2026-10-15T17:29 … 2026-11-15T10:05 |
| Events / packages per run | 3 / 1 |
| Runs with a stage-1 candidate | 10 / 10 |
| Candidates per run (mean) | 1.0 of 3 events, 1.0 of 1 packages |
| Stage-1 features (total over runs) | rate_package 10 |
| Runs with an alert (recall) | 10 / 10 |
| Packages alerted per run (mean) | 1.0 of 1 (100.0 %) |
| Alerts per run (mean) | 1.0 |
| Final score of enriched events (median / min / max) | 8.5 / 8.5 / 8.5 |
| Stage-2 features (total over runs) | publisher_new 10, non_adjacent_branches 10, dormant_release 10 |
| First candidate after wave start (median) | 1.0 min |
| First alert after wave start (median) | 2.5 min |
| Background alerts in the wave window + 1 h (mean) | 1.8 |
| Precision in the window (scenario alerts / all alerts, mean) | 57.8 % |
| Source requests per run | 6 |

### ChainDrop as recorded: real packages, versions and publication times of 4 August 2026

Source: GitHub Advisory Database (malware advisories of 4 August 2026) and the registry `time` field of each package; manifest change from the StepSecurity write-up.

Assumptions:

- the publisher of a malicious version is the account or the trusted-publishing configuration that published the last benign version: the worm released through the victims' own pipelines and credentials
- every malicious version adds a `preinstall` script and two files of 738 697 bytes in total to the last benign manifest and changes no dependency (write-up: "exactly three differences")
- packages, malicious versions and their times are the recorded ones; the whole wave is shifted so that its first publication falls on t0, and the release history is shifted by the same amount, so every interval is kept
- the document revision before the wave is not recorded; the number of earlier versions plus one is used, a lower bound. When the journal already holds the package, its revision count continues
- package names are real, so the watchlist, the name rules and the background activity of the same scopes act as they would in production
- account names are replaced by per-package labels; e-mail addresses are not used, so no domain feature can fire

| Measure | Value |
|---|---|
| Runs / insertion window | 10, t0 uniform in 2026-10-15T17:29 … 2026-11-15T06:49 |
| Events / packages per run | 2053 / 432 |
| Runs with a stage-1 candidate | 10 / 10 |
| Candidates per run (mean) | 330.4 of 2053 events, 192.4 of 432 packages |
| Stage-1 features (total over runs) | rate_scope 10409, rate_package 3274, rate_global 1204, rate_cluster 51, watchlist 30, rev_jump 2 |
| Runs with an alert (recall) | 10 / 10 |
| Packages alerted per run (mean) | 167.4 of 432 (38.7 %) |
| Alerts per run (mean) | 167.4 |
| Final score of enriched events (median / min / max) | 5.5 / 2 / 8.5 |
| Stage-2 features (total over runs) | install_script_added 1734, size_jump 1083, dormant_release 400 |
| First candidate after wave start (median) | 5.1 min |
| First alert after wave start (median) | 6.6 min |
| Background alerts in the wave window + 1 h (mean) | 4.3 |
| Precision in the window (scenario alerts / all alerts, mean) | 97.5 % |
| Source requests per run | 1617 |

### Held-out: nx (s1ngularity), 26 August 2025 — stolen publishing token

Source: GitHub Advisory Database (advisory of 27 August 2025) and the registry `time` field; manifest change from the Nx post-mortem and the Kaspersky write-up.

Assumptions:

- the publisher of a malicious version is the account or the trusted-publishing configuration that published the last benign version: the attackers used the npm token of the project's own release workflow
- every malicious version adds a `postinstall` script and one file; the size of the file is not published, so the size is unchanged
- the malicious versions carry no provenance attestation (post-mortem: they "lacked NPM provenance signing")
- packages, malicious versions and their times are the recorded ones; the whole wave is shifted so that its first publication falls on t0, and the release history is shifted by the same amount, so every interval is kept
- the document revision before the wave is not recorded; the number of earlier versions plus one is used, a lower bound. When the journal already holds the package, its revision count continues
- package names are real, so the watchlist, the name rules and the background activity of the same scopes act as they would in production
- account names are replaced by per-package labels; e-mail addresses are not used, so no domain feature can fire

| Measure | Value |
|---|---|
| Runs / insertion window | 10, t0 uniform in 2026-10-15T17:29 … 2026-11-15T08:00 |
| Events / packages per run | 19 / 8 |
| Runs with a stage-1 candidate | 0 / 10 |
| Candidates per run (mean) | 0.0 of 19 events, 0.0 of 8 packages |
| Stage-1 features (total over runs) | — |
| Runs with an alert (recall) | 0 / 10 |
| Packages alerted per run (mean) | 0.0 of 8 (0.0 %) |
| Alerts per run (mean) | 0.0 |
| Final score of enriched events (median / min / max) | — / — / — |
| Stage-2 features (total over runs) | — |
| First candidate after wave start (median) | — |
| First alert after wave start (median) | — |
| Background alerts in the wave window + 1 h (mean) | 3.6 |
| Precision in the window (scenario alerts / all alerts, mean) | 10.0 % |
| Source requests per run | 0 |

### Held-out: chalk, debug and 18 more, 8 September 2025 — phished maintainer account

Source: GitHub Advisory Database (advisories of 8–10 September 2025 with an exact version) and the registry `time` field; write-ups of Wiz, Cycode and StepSecurity.

Assumptions:

- the publisher of a malicious version is the account or the trusted-publishing configuration that published the last benign version: the attacker published from the maintainer's own account after a phishing attack
- the malicious code is in the runtime source of the package (a browser-side payload); no write-up reports a new lifecycle script, so the manifest and its size are taken as unchanged
- the advisories of 9–10 September without an exact version (duckdb, prebid.js) are a later compromise and are not in the wave
- packages, malicious versions and their times are the recorded ones; the whole wave is shifted so that its first publication falls on t0, and the release history is shifted by the same amount, so every interval is kept
- the document revision before the wave is not recorded; the number of earlier versions plus one is used, a lower bound. When the journal already holds the package, its revision count continues
- package names are real, so the watchlist, the name rules and the background activity of the same scopes act as they would in production
- account names are replaced by per-package labels; e-mail addresses are not used, so no domain feature can fire

| Measure | Value |
|---|---|
| Runs / insertion window | 10, t0 uniform in 2026-10-15T17:29 … 2026-11-15T06:26 |
| Events / packages per run | 20 / 20 |
| Runs with a stage-1 candidate | 10 / 10 |
| Candidates per run (mean) | 12.0 of 20 events, 12.0 of 20 packages |
| Stage-1 features (total over runs) | watchlist 120, dormant_awake 13 |
| Runs with an alert (recall) | 0 / 10 |
| Packages alerted per run (mean) | 0.0 of 20 (0.0 %) |
| Alerts per run (mean) | 0.0 |
| Final score of enriched events (median / min / max) | 1.5 / 0 / 2.5 |
| Stage-2 features (total over runs) | dormant_release 70 |
| First candidate after wave start (median) | 0.1 min |
| First alert after wave start (median) | — |
| Background alerts in the wave window + 1 h (mean) | 8.9 |
| Precision in the window (scenario alerts / all alerts, mean) | 10.0 % |
| Source requests per run | 60 |

### Held-out: Shai-Hulud, 14–16 September 2025 — self-propagating worm

Source: GitHub Advisory Database (advisories of 15–19 September 2025 with an exact version) and the registry `time` field; manifest change from the Socket write-up.

Assumptions:

- the publisher of a malicious version is the account or the trusted-publishing configuration that published the last benign version: the worm published with the npm token found on the maintainer's machine
- every malicious version adds a `postinstall` script and one file; the size of the file is not taken from a write-up, so the size is unchanged
- the fixture holds 105 packages and 183 versions; the write-ups count more than 500 packages. Advisories that name no exact version, packages gone from the registry and packages without a benign release are left out
- packages, malicious versions and their times are the recorded ones; the whole wave is shifted so that its first publication falls on t0, and the release history is shifted by the same amount, so every interval is kept
- the document revision before the wave is not recorded; the number of earlier versions plus one is used, a lower bound. When the journal already holds the package, its revision count continues
- package names are real, so the watchlist, the name rules and the background activity of the same scopes act as they would in production
- account names are replaced by per-package labels; e-mail addresses are not used, so no domain feature can fire

| Measure | Value |
|---|---|
| Runs / insertion window | 10, t0 uniform in 2026-10-15T17:29 … 2026-11-13T16:57 |
| Events / packages per run | 183 / 105 |
| Runs with a stage-1 candidate | 10 / 10 |
| Candidates per run (mean) | 8.3 of 183 events, 8.3 of 105 packages |
| Stage-1 features (total over runs) | rate_scope 192, rate_package 70, name_scope_typo 10, rate_global 8, breadth_mature 4, rate_cluster 3 |
| Runs with an alert (recall) | 10 / 10 |
| Packages alerted per run (mean) | 1.3 of 105 (1.2 %) |
| Alerts per run (mean) | 1.3 |
| Final score of enriched events (median / min / max) | 3 / 2 / 6.5 |
| Stage-2 features (total over runs) | install_script_added 13, dormant_release 1 |
| First candidate after wave start (median) | 130.9 min |
| First alert after wave start (median) | 132.4 min |
| Background alerts in the wave window + 1 h (mean) | 58.2 |
| Precision in the window (scenario alerts / all alerts, mean) | 2.8 % |
| Source requests per run | 41 |

### Held-out: Shai-Hulud, second wave, 24 November 2025

Source: GitHub Advisory Database (advisories of 24–27 November 2025 with an exact version) and the registry `time` field; manifest change from the Socket and Trend Micro write-ups.

Assumptions:

- the publisher of a malicious version is the account or the trusted-publishing configuration that published the last benign version: the worm published with stolen npm tokens
- every malicious version adds a `preinstall` script and two files; the write-up describes the larger one as a 10 MB bundle, so 10 000 000 bytes are added
- the fixture holds 583 packages and 810 versions: advisories with an exact version, packages still in the registry, with a benign release before the wave
- packages, malicious versions and their times are the recorded ones; the whole wave is shifted so that its first publication falls on t0, and the release history is shifted by the same amount, so every interval is kept
- the document revision before the wave is not recorded; the number of earlier versions plus one is used, a lower bound. When the journal already holds the package, its revision count continues
- package names are real, so the watchlist, the name rules and the background activity of the same scopes act as they would in production
- account names are replaced by per-package labels; e-mail addresses are not used, so no domain feature can fire

| Measure | Value |
|---|---|
| Runs / insertion window | 10, t0 uniform in 2026-10-15T17:29 … 2026-11-14T19:21 |
| Events / packages per run | 810 / 583 |
| Runs with a stage-1 candidate | 10 / 10 |
| Candidates per run (mean) | 5.4 of 810 events, 5.4 of 583 packages |
| Stage-1 features (total over runs) | rate_scope 1693, rate_cluster 100, rate_package 54, rate_global 2, rev_jump 1 |
| Runs with an alert (recall) | 10 / 10 |
| Packages alerted per run (mean) | 4.1 of 583 (0.7 %) |
| Alerts per run (mean) | 4.1 |
| Final score of enriched events (median / min / max) | 6.5 / 2 / 7 |
| Stage-2 features (total over runs) | install_script_added 41, size_jump 31, dormant_release 20 |
| First candidate after wave start (median) | 8.9 min |
| First alert after wave start (median) | 10.4 min |
| Background alerts in the wave window + 1 h (mean) | 15.1 |
| Precision in the window (scenario alerts / all alerts, mean) | 33.7 % |
| Source requests per run | 27 |

### ChainDrop, synthetic model: 444 packages in distinct namespaces, ~5 versions each

Source: project description, class 2 and class 5.

Assumptions:

- 11 packages in the first wave within 10 minutes of t0, 433 more starting uniformly between +40 and +200 minutes
- 5 version(s) per package, 30–45 s apart, patch bumps in the current line (2 212 versions / 444 packages ≈ 5 in the write-up)
- every package is mature (12 earlier versions over two years, document revision ≥ 40) and published from GitHub Actions trusted publishing before and during the wave: no publisher feature can fire
- the first malicious version of each package adds a postinstall script, one dependency, 10× the unpacked size and 3× the file count (class 5 of the description); later versions repeat that manifest
- package names are synthetic: half scoped, half unscoped, all namespaces distinct and absent from the journal
- the last benign release of each package was 5–120 days before the wave

| Measure | Value |
|---|---|
| Runs / insertion window | 10, t0 uniform in 2026-10-15T17:29 … 2026-11-15T06:42 |
| Events / packages per run | 2220 / 444 |
| Runs with a stage-1 candidate | 10 / 10 |
| Candidates per run (mean) | 1332.5 of 2220 events, 444.0 of 444 packages |
| Stage-1 features (total over runs) | rate_package 13320, dormant_awake 444, breadth_mature 5 |
| Runs with an alert (recall) | 10 / 10 |
| Packages alerted per run (mean) | 444.0 of 444 (100.0 %) |
| Alerts per run (mean) | 444.0 |
| Final score of enriched events (median / min / max) | 6.5 / 6.5 / 6.5 |
| Stage-2 features (total over runs) | install_script_added 13325, size_jump 13325, files_jump 13325, deps_added 13325 |
| First candidate after wave start (median) | 1.6 min |
| First alert after wave start (median) | 3.1 min |
| Background alerts in the wave window + 1 h (mean) | 5.9 |
| Precision in the window (scenario alerts / all alerts, mean) | 98.7 % |
| Source requests per run | 5330 |

### ChainDrop, synthetic model: one version per package

Source: project description, class 2 and class 5.

Assumptions:

- 11 packages in the first wave within 10 minutes of t0, 433 more starting uniformly between +40 and +200 minutes
- 1 version(s) per package, 30–45 s apart, patch bumps in the current line (2 212 versions / 444 packages ≈ 5 in the write-up)
- every package is mature (12 earlier versions over two years, document revision ≥ 40) and published from GitHub Actions trusted publishing before and during the wave: no publisher feature can fire
- the first malicious version of each package adds a postinstall script, one dependency, 10× the unpacked size and 3× the file count (class 5 of the description); later versions repeat that manifest
- package names are synthetic: half scoped, half unscoped, all namespaces distinct and absent from the journal
- the last benign release of each package was 5–120 days before the wave

| Measure | Value |
|---|---|
| Runs / insertion window | 10, t0 uniform in 2026-10-15T17:29 … 2026-11-15T06:45 |
| Events / packages per run | 444 / 444 |
| Runs with a stage-1 candidate | 2 / 10 |
| Candidates per run (mean) | 3.7 of 444 events, 3.7 of 444 packages |
| Stage-1 features (total over runs) | breadth_mature 37, rate_global 9 |
| Runs with an alert (recall) | 2 / 10 |
| Packages alerted per run (mean) | 3.7 of 444 (0.8 %) |
| Alerts per run (mean) | 3.7 |
| Final score of enriched events (median / min / max) | 6.5 / 6.5 / 6.5 |
| Stage-2 features (total over runs) | install_script_added 37, size_jump 37, files_jump 37, deps_added 37 |
| First candidate after wave start (median) | 79.6 min |
| First alert after wave start (median) | 81.1 min |
| Background alerts in the wave window + 1 h (mean) | 4.4 |
| Precision in the window (scenario alerts / all alerts, mean) | 11.0 % |
| Source requests per run | 15 |

