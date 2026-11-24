# Delayed confirmation: the journal against published malware advisories

Date of the check: 2026-11-15. Period: 2026-10-14 to 2026-11-15 (32 days of continuous observation, 3.17 million events).

## Method

The GitHub Advisory Database publishes an advisory of type *malware* for every npm package that the registry removed as malicious. The check takes all such advisories published on or after the first day of the journal and asks, for every package they name: is the package in the journal, did stage 1 fire a feature, did the event become a candidate, did stage 2 raise an alert, and when.

This is the third evaluation line of the project (delayed confirmation). It uses no data that the features were designed on.

```sh
node evaluation/advisory/fetch.mjs 2026-10-14 > evaluation/data/malware.tsv
psql "$DATABASE_URL" -X -A -q -f evaluation/advisory/match.sql   < evaluation/data/malware.tsv   # funnel
psql "$DATABASE_URL" -X -A -q -f evaluation/advisory/history.sql < evaluation/data/malware.tsv   # packages with a history
psql "$DATABASE_URL" -X -A -q -f evaluation/advisory/load.sql    < evaluation/data/malware.tsv   # cost of a wider stage 1
```

Run the queries on a copy of the database, not on the production server: they join the whole journal.

## Result

| Step | Packages | Share of the journal |
|---|---|---|
| Named in a malware advisory | 1 948 | — |
| Present in the journal | 1 629 | 100 % |
| Stage 1 fired at least one feature | 973 | 60 % |
| Candidate (reached stage 2) | 219 | 13 % |
| **Alert** | **30** | **1.8 %** |

- All 30 alerts are true positives by definition. They are the first alerts of the system that an independent source confirms.
- Median lead of the alert over the advisory: **16 hours** (0 to 420 hours).
- Median delay from the first event of the package to the alert: **4 minutes**.

Why the other packages did not get an alert:

| Reason | Packages |
|---|---|
| Stage 1: no feature fired | 656 |
| Stage 1: a feature fired, the score stayed below the candidate threshold (most often one `rate_cluster` or one `new_package`) | 754 |
| Stage 2: the score stayed below the alert threshold (for 15 of them the package was already removed) | 189 |

## Interpretation

**Most of the sample is outside the main scope.** The advisories of the period are dominated by packages that are malicious from their first version: clones of one messaging library, and names of internal packages of companies (dependency confusion). The project description puts this class fourth and fifth in priority. Such a package has no history, so the history-based features of stage 2 have nothing to compare with.

**The sample also contains the main class, and the system missed it.** About 50 of the packages had a long history before the advisory (document revision 25 or higher at the first event in the journal), and the advisory names specific versions. This is the pattern of a compromised publisher. Examples: `@injectivelabs/sdk-ts` 1.20.21 (1 623 document revisions before the event), `@ethersphere/bee-js` 13.3.0, several `@adminide-stack/*` packages, `@hello.nrfcloud.com/proto-map`. None of them got an alert; 10 of the 50 reached stage 2.

The cause is structural. Stage 1 sees only the feed event: a package name and a revision. A single publication into an established package that is not on the watchlist (top 1 000) produces no burst, no name similarity and no revision anomaly. The comparison of the publisher and the manifest with the history, which would expose it, belongs to stage 2, and stage 2 never runs for this event.

No package of the top 10 000 was named in an advisory in the period, so the watchlist missed nothing.

Limits of the check: that these 50 packages were compromised is inferred from the form of the advisory and from the history of the package; the incident reports were not read. The registry had removed the malicious versions before the check, so stage 2 could not be run on them after the fact.

## Cost of closing the gap

The obvious remedy is to send to stage 2 every event of a package with a history, also without a stage-1 feature. The table gives the extra events a day for several forms of this rule, measured on the 31 full days of the journal (99 000 events and 2 446 candidates a day today).

| Rule: not a candidate, and … | Extra events / day | Malicious packages with a history that the rule reaches |
|---|---|---|
| revision ≥ 25 | 62 000 | — |
| revision ≥ 25, first event of the package in 6 hours | 27 100 | 46 of 50 |
| revision ≥ 25, first event in 24 hours | 15 700 | — |
| revision ≥ 50, first event in 6 hours | 20 900 | 32 of 32 |
| revision ≥ 50, first event in 24 hours | 11 500 | — |
| package is in the top 10 000 (wider watchlist) | 940 | 0 (no incident there) |

Stage 2 sends 4.3 requests per event today (2.1 of them to the registry), 10 400 requests a day in total. KPI-3 allows 15 000.

- **Full enrichment** of the cheapest useful rule (revision ≥ 50, quiet for 24 hours) adds about 49 000 requests a day: more than three times KPI-3.
- **A light check** — one registry request per event, publisher and install scripts against the history only — adds 11 500 requests a day for the same rule: 21 900 in total, 46 % over KPI-3, but far inside the technical limit of the registry (72 000 a day at 3 000 an hour).
- **A wider watchlist** (top 10 000) costs about 4 000 requests a day and keeps KPI-3, but would have caught nothing in this period.

Expected extra alerts are harder to estimate. Among today's candidates with a history, 0.19 % of the publish events have stage-2 evidence of 4 points or more without any stage-1 score. Applied to 11 500 extra events a day this gives about 17 extra alerts a day, most of them false. The sample is biased (today's candidates are bursts), so the figure is an order of magnitude only.

## Conclusions

1. On independent data the system confirms early warning for what it detects: 30 confirmed alerts, 16 hours before the advisory.
2. Recall is low for malicious new packages (out of the main scope) and, more important, for a quiet single publication into an established package outside the watchlist (inside the main scope).
3. Closing the second gap is a trade-off against the request budget, not a parameter change: it needs either a higher KPI-3 or a light third stage between stage 1 and stage 2. The parameters stay frozen until the held-out replay is done.
