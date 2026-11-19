# Scope, assumptions, constraints and risks

## In scope

Continuous collection of the change feed with a persisted cursor; stage 1 (temporal, nominal, version lanes, watchlist) without network requests; stage 2 enrichment from five sources under quotas; weighted-sum scoring, evidence snapshots, maintainer-set history, analyst verdicts; REST API (OpenAPI 3.1) and WebSocket stream; a single-page dashboard usable on a phone; containerised deployment with a health check and nightly backups; replay-based evaluation.

## Out of scope

Table: Exclusions

| Excluded | Why |
|---|---|
| Code content analysis | the layer the registry closes at publication |
| Machine learning | no labelled corpus; explainability is a requirement |
| Comparing the tarball with the repository | high traffic cost for a signal cheaper features approximate |
| Dependency confusion | needs a second data source — corporate namespaces |

## Assumptions

Every publication produces at least one feed event. The packument `time` field keeps the publication time of purged versions (verified on `node-ipc`). The top-10 000 packages by downloads is an adequate proxy for "popular".

## Constraints

A feed event carries only the package name and the document revision, so version rules run on stage 2. A packument per event would cost 18.6–27 GB/day. One shared home server, no hosting budget, an observation period of weeks, English as the language of code and documentation.

## Risks, dependencies and mitigation

Table: Risk register

| Risk / dependency | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Feed format change or rate limiting | low | high | strict validation; configurable URL; cursor backfill |
| A source blocks the client | medium | medium | budgets below limits; graceful degradation |
| Home server downtime | medium | medium | auto-restart, cursor resume, nightly backup |
| Too few real incidents in the period | high | medium | replay of documented incidents |
| Expert thresholds too loose | high | medium | calibration on the recorded background |
