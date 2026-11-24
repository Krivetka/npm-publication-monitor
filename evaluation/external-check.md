# Were the alerts also reported by other security services?

Checked on 19 November 2026 with `external/check.mjs`. The alerts of the production database
(repeats left out) were matched by package name and version against two public sources:

- the Aikido Intel malware list (`malware-list.aikido.dev`);
- OSV.dev, records `MAL-…` of the OpenSSF malicious-packages database. Their reporters in the
  matched records are the GitHub Advisory Database, Amazon Inspector and OpenSSF Package Analysis.

Socket and Sonatype publish no open list and were not consulted.

## Result

| | All engines, 14 Oct – 19 Nov | Current rule (stage 2 v5 and v6), 28 Oct – 19 Nov |
|---|---|---|
| Alerts / packages | 1 986 / 1 632 | 914 / 719 |
| Same version reported as malware | 36 (1.8 %) | 14 (1.5 %) |
| — by Aikido | 32 | 10 |
| — by OSV | 33 | 12 |
| — by both | 29 | 8 |
| Package reported, but another version | 50 | 46 |
| Not reported by either source | 1 900 | 854 |
| Alert earlier than the OSV record | 29 of 33 | 11 of 12, median lead 12.6 h |

The 14 confirmed alerts of the current rule: ten carry `install_script_new_package` (five of
them with `non_adjacent_branches`), two `install_script_added`, one a new publisher with a size
jump, one an archived repository. Two of the 14 are on the Aikido list only.

## Analyst verdicts on a random sample

`external/sample.mjs` drew 120 of the 914 alerts of the current rule (seed 20261119, list in
`verdict-sample.json`). The analyst gave a verdict to each from the event card, the registry
page and the repository, without the two sources above; the verdicts are in the `finding`
table of the production database.

| Verdict | Alerts |
|---|---|
| Confirmed | 6 (5.0 %; 95 % Wilson interval 2.3–10.5 %) |
| False positive | 110 |
| Undecided | 4 |

At 34 alerts a day this is one or two findings and about 32 false alerts a day. Four of the
six confirmed alerts are one event: a `postinstall` that runs a hidden script with a random
name was added to four packages of one scope within minutes; neither external source reports
them. Of the four sampled alerts that the external sources report, the analyst confirmed two
and left two undecided.

## Reading the figures

- **1.5 % is a lower bound of precision, not precision.** A package absent from both lists is
  not shown to be benign: the lists hold what somebody reported. The share of true alerts lies
  between this bound and the result of the analyst verdicts, which are not recorded yet.
- **"Another version" is not a confirmation.** These are packages that were compromised earlier
  and release ordinary versions now: `@uipath/*` (malicious versions of May 2026), `@operato/*`
  (September 2025). The alerts on them come from non-adjacent pre-release lines.
- The two verdicts recorded so far (`@momo-kits/native-kits`, `@openai/codex`, both "false
  positive") agree with the sources: neither package is reported.
- The reverse question, how many reported packages the monitor alerted on, is in
  `advisory-check.md`: 30 of 1 948 advisory packages of the period.
