# Criterion 5 — Integration with external APIs

## Context

Stage 2 needs facts the feed does not carry: the packument, the repository state, the attested source repository, whether a commit exists, and when a publisher's e-mail domain was registered. Five public sources provide them with different limits (GitHub: 60/hour anonymously, 5 000 with a token). A source that is down must not stop the pipeline, and the research question depends on counting every request.

## Decision

One `Sources` client wraps all five behind a token-bucket budget per source (registry 3 000/h, ecosyste.ms 2 000/h, deps.dev 1 000/h, GitHub 4 000/h with the token or 50/h without, RDAP 200/h). A request outside the budget is not sent; the skip is recorded on the event and in the hourly `source_usage` table. Candidates are prioritised — watchlist first, then preliminary score — and an unavailable packument is retried with exponential back-off (five attempts).

## Alternatives

| Alternative | Why rejected |
|---|---|
| GitHub API for repository state | ecosyste.ms mirrors the same fields at no GitHub cost |
| A rate-limiting proxy | cannot pause on server headers or record skips per candidate |
| Fetch everything, rely on retries | gets the client banned; makes the cost comparison meaningless |

## Consequences

A score is a lower bound when a source was skipped, and the card says so. The `source_usage` counters are the denominator of the filtering-efficiency metric; any outage but the registry's drops one feature group.

## Key decisions

- Budget per source, enforced before the request, every skip recorded.
- Honour server-announced rate limits by pausing the bucket.
- Prioritise candidates; retry only the registry with back-off.
- Every source optional except the registry.

## Structure

Fig. 2.2 shows the requests of one enrichment.

## Requirements compliance checklist

Table: External API criterion checklist

| Requirement | Status | Where |
|---|---|---|
| npm registry, GitHub, RDAP, deps.dev, ecosyste.ms | done | `src/stage2/sources.ts` |
| Different authentication schemes | done | token (GitHub) vs. anonymous with User-Agent |
| Rate limits; quota queue with priorities | done | token buckets; `loadQueue` ordering |
| Response caching | done | `rdap_cache`, 30 days |
| Retries with exponential back-off | done | `backoffDelay` with full jitter |
| Graceful degradation | done | feature group omitted, `skipped` recorded |
