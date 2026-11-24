# npm Publication Monitor

**Continuous Monitoring System for Early Detection of Suspicious npm Package Publications with Multi-Stage Filtering**

| Field | Value |
|---|---|
| Student | Ivan Kuliashov |
| Group | [GROUP] |
| Supervisor | dr hab. prof. UKEN Serhii Semenov |
| Submission | [DATE] |

## Links

| Link | Where |
|---|---|
| Production | the dashboard at `/npm/` on the monitoring node; reachable only inside its private network |
| Repository | https://github.com/Krivetka/npm-publication-monitor |
| Figma / design | interactive dashboard mock-ups (shown at the defence) |
| Demo video | [VIDEO LINK] |

## Selected evaluation criteria

1. Back-end
2. Front-end
3. Adaptive UI (web / mobile)
4. Database
5. Integration with external APIs
6. Cloud (met in part: the deployment is on-premise)
7. API documentation

## Abstract

The system continuously reads the npm registry change feed (about 100 thousand events a day), scores every publication on the *metadata* layer — who published, when, in what rhythm, and how this relates to the package history — and raises alerts for publications that look like a compromised publisher, a worm-like campaign, a version anomaly, a name-squat or a manifest change. A two-stage filter keeps the costly part cheap: stage 1 works without any network requests and lets through 2.5 % of the stream; stage 2 enriches only those candidates from the registry, GitHub, deps.dev, ecosyste.ms and RDAP under per-source quotas, and stores an evidence snapshot before the registry purges the malicious versions. On 31 days of recorded background the system spends 10 400 external requests a day instead of 422 000 and raises 34 alerts a day; in a random sample of 120 alerts an analyst confirmed 5 %. Replayed on that background, the two reference incidents of 2026 raise an alert in every insertion, within 2.5 and 6.6 minutes; of three held-out incidents of 2025 one is detected. The measured limit of the approach is one quiet malicious version of an established package, which leaves no trace before enrichment.

## Keywords

software supply chain security; npm registry; anomaly detection; publication metadata; multi-stage filtering
