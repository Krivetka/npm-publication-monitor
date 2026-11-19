# Why the recorded ChainDrop wave is alerted late and in part

Under the stage-2 parameters `v5` the replay of the recorded wave gave an alert in every run,
but only 164 of the 432 packages were alerted on average (38.1 %) and the first alert came
51.3 minutes after the first publication. This note explains both figures; they are the `v5`
figures (`report.md` of 18 November, commit `ca7d344`).

Outcome: the first change in the table at the end was accepted as stage-2 `v6` on 19 November,
after the replay of the held-out incidents. The replay under `v6` measured a first alert at
6.6 minutes and 167.4 packages alerted (38.7 %); the background has 33.9 alerts a day, 18 of
them in 31 days from the new rule. The results of the held-out incidents did not change.

Method: `chaindrop/analyse.mjs` reads the fixture and applies the two rules that decide an
alert. It needs no background, so its result is a prediction. The prediction is 164 packages
and a first alert at 51.2 minutes; the replay measured 164.4 and 51.3.

## The wave came in phases

| Minutes from start | New packages | Namespaces | With one malicious version |
|---|---|---|---|
| 0–10 | 21 | 3 | 20 |
| 40–50 | 55 | 12 | 8 |
| 60–70 | 156 | 6 | 2 |
| 70–80 | 194 | 21 | 54 |

The first phase is `keyv` and 19 packages of the `@keyv` scope, one version each, in five
minutes. The fast republishing that the earlier synthetic model assumed for the whole wave
starts only at minute 49 (`@ornikar`).

## Stage 1 decides the result

A package of the wave becomes a candidate through `rate_package`: three events of one package
in ten minutes. The other feature that fires, `rate_scope`, weighs 1 and the candidate
threshold is 2.

| Group | Packages | Share |
|---|---|---|
| Fewer than three malicious versions | 105 | 24.3 % |
| Three or more, but never three in ten minutes | 143 | 33.1 % |
| Three in ten minutes, baseline is an earlier malicious version | 20 | 4.6 % |
| Three in ten minutes, baseline is the last benign version — alert | 164 | 38.0 % |

The median gap between two versions of one package is 6.8 minutes, and 42 % of the gaps are
longer than ten minutes.

Stage 2 is not the limit. Every malicious version adds a `preinstall` script; 430 of the 432
packages had no install script before, so `install_script_added` (2.5) is there for any event
that reaches stage 2. The 20 packages of the third row reach stage 2 late: the comparison
baseline is the last version older than ten minutes, and by then it is a malicious one.

`breadth_mature` does not fire: the wave has 45 namespaces and at most 21 new ones in ten
minutes, against a background where mature packages of many namespaces wake up all the time.

## Why 51 minutes

- Minute 0–2.4: 19 `@keyv/*` packages. `rate_scope` fires, prescore 1, no candidate.
- Minute 5.0: `keyv` (rank 188) is a candidate through the watchlist. Stage 2 finds the new
  `preinstall` script. The final score is the stage-2 weight alone, below the alert threshold
  of 4, because the watchlist adds no score. No alert.
- Minute 40–49: `cacheable`, `flat-cache` (rank 228), `file-entry-cache` (rank 238) and others,
  one version each. Same outcome.
- Minute 49.7: the third version of nine `@ornikar` packages. First `rate_package`, first
  alert after the settle pause, at minute 51.2.

## What would change the result

Estimates on the 31 days of background. Nothing is applied: the parameters stay frozen until
the replay of the held-out incidents.

| Change | Effect on the wave | Cost on the background |
|---|---|---|
| A watchlist package is alerted when the stage-2 evidence is 2 or more, whatever the prescore | first alert at about minute 6.5 (`keyv`), inside KPI-6; three packages alerted (`keyv`, `flat-cache`, `file-entry-cache`) | 18 more alerts in 31 days (0.6 a day), no extra request |
| `rate_scope` alone makes a candidate | most of the scoped packages reach stage 2 at their first version | 11 684 more enriched events a day; at 4.3 requests each about 50 000 requests a day against 10 426 now |
| Baseline = last version before the first event of the package in the last 24 h | 20 more packages alerted | none on requests; effect on background alerts not measured |

The second row is the same limit as in `advisory-check.md`: one quiet malicious version in an
established package leaves no stage-1 trace. A scope burst is an everyday event (5 432 scopes
in the period), so it cannot pay for enrichment by itself.

## Limits of this analysis

- The prediction ignores the minute alignment of the window and the background activity of the
  same packages; it differs from the replay by less than one package.
- Three of the 432 packages are in the top 1 000, so the first change shortens the delay and
  does not raise the share of packages alerted.
- The effect of each change on the wave is computed from the fixture, not replayed.
