# Problem, goals and success criteria

## Problem statement

npm carried 96.6 % of all malicious open-source packages recorded by Sonatype in Q2 2026. The registry's pre-publication scan blocks the malware it can recognise; two classes of attack pass it by construction. First, compromise of a trusted publisher: the attacker publishes from a legitimate account or a hijacked pipeline with a valid attestation — in `node-ipc` (14 May 2026) three malicious versions were published within 55 seconds into three non-adjacent release lines by an account that had never published before. Second, name squatting (`l0dash`, `electorn`, `@typescript_eslint/parser`). Both are visible in publication metadata before anyone reads the code. A research problem follows: the registry deletes malicious versions, so of 40 random entries of an open malware corpus none could be recovered with its publication date.

## User pain points

A security engineer learns about a compromised package from the news, when nothing is left to investigate. A maintainer has no signal that their own package was published by someone else. A researcher cannot measure the residual risk, because the evidence disappears.

## Business goals and objectives

**Goal.** Design and experimentally evaluate a continuous monitoring system for npm publications that flags suspicious publications from a combination of metadata features and quantifies the residual risk left after the registry's own gate.

**Objectives.** The six tasks of the Introduction: the attack classes visible in metadata, a durable collector, stage 1, stage 2, storage with an API and a dashboard, and the evaluation.

## Success criteria

Table: Key performance indicators

| KPI | Target | Measured | Met |
|---|---|---|---|
| KPI-1 Feed coverage | ≥ 99 % of the period | 95.4 %: one 10 h outage, 161 silences of unrecorded cause; no event lost | no |
| KPI-2 Stage-1 pass-through | ≤ 3 % of events | 2.5 % (31 full days) | yes |
| KPI-3 Requests per day | ≤ 15 000 | 10 400 instead of ≈ 422 000 | yes |
| KPI-4 Recall in replay | both reference incidents; ≥ 2 of 3 held-out | node-ipc and ChainDrop 10/10 (39 % of ChainDrop packages); held-out 1 of 3 | in part |
| KPI-5 Alerts per day | ≤ 30 over the registry; ≤ 3 per consumer list | 34, 5 % confirmed by verdict; 0.6 for 1 523 dependencies | in part |
| KPI-6 Detection delay | ≤ 10 min | 2.5 and 6.6 min on the reference incidents; 132 min on Shai-Hulud | in part |

## Non-functional requirements

Table: Non-functional requirements

| Area | Requirement and how it is met |
|---|---|
| Durability | no event lost across restarts and outages — cursor and events in one transaction; 180 test kills, no loss |
| Throughput | ≥ 1 000 events/s — stage 1 scores 70 000 events/s in replay |
| Availability | unattended, auto-restart after reboot — `restart: unless-stopped`, health endpoint |
| Storage | ≈ 100 000 events/day for the whole period — monthly partitions, results only for hits |
| Security | no public surface, one authenticated write, no secrets in Git — three database roles, parameterised SQL, strict CSP |

## Regulatory and compliance needs

Only openly published registry data is processed. Publisher account names are personal data under the GDPR; they are processed for the legitimate interest of supply-chain security research and shown only inside the deployment. An e-mail address is reduced to its domain before storage, snapshots without an alert are emptied after 30 days, and an account can be put on an exclusion list. A public privacy notice states this (`PRIVACY.md`, page *Privacy notice*). External APIs are used within their terms; the project has no commercial use.
