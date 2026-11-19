# Criterion 1 — Back-end

## Context

The back-end must ingest ≈ 100 000 registry events a day without losing one, score each cheaply enough for real time, and spend a bounded budget of external requests on the few events that deserve it. A feed event carries only a package name and a revision, so the expensive part can only be reduced.

## Decision

Node.js 24 with native TypeScript, as a pipeline of single-purpose processes around one PostgreSQL database (Fig. 2.1). Stage 1 is a deterministic engine with three lanes — temporal (sliding-window z-scores per package, scope and name cluster), nominal (symmetric-delete index over the top-10 000 names: homoglyphs, transpositions, keyboard neighbours, separators, edits, scope typos) and version (revision jumps and regressions, dormant wake-ups, new packages) — plus a top-1000 watchlist; no network requests, only hits stored. Stage 2 is an asynchronous worker over a database-backed queue (watchlist first, then preliminary score, after a 60 s settle) with per-source quotas, back-off and deferral. Scores are weighted sums: candidate at preliminary ≥ 2, alert at final ≥ 4 with stage-2 evidence ≥ 2.

## Alternatives

| Alternative | Why rejected |
|---|---|
| One monolithic process | a crash in enrichment would stall collection |
| Message broker between stages | the journal table is already an ordered, durable, queryable queue |
| Trained classifier | no labelled corpus; verdicts must be explainable per feature |

## Consequences

Exactly-once processing without a broker. Stage 1 rebuilds its ≈ 80 MB of sliding windows on start from the last 24 h of the journal in under a second.

## Key decisions

- Cursor and results in the same transaction, in every process.
- Stage 1 computes from the event and the journal only; stage 2 alone talks to external sources.
- Deterministic engines with an engine id (version + parameter hash) on every result.

## Structure

Fig. 2.2 shows one event on its way through the pipeline.

## Requirements compliance checklist

Table: Back-end criterion checklist

| Requirement | Status | Where |
|---|---|---|
| Collector with persisted cursor, idempotent, recovering | done | `src/collector/` |
| Stage 1: three lanes and watchlist | done | `src/stage1/` |
| Stage 2: asynchronous handlers, job queue, quotas | done | `src/stage2/` |
| Preliminary and final scores, alerts | done | `params.ts`; `stage2_result.alert` |
| REST API for the client | done | `src/api/` |
