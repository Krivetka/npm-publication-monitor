# Limits

The API has no rate limiting of its own. It is served inside the deployment's network to a
few analysts and scripts; the limits below keep one request, not one client, within bounds.
If the API is published more widely, put a rate limit in the reverse proxy in front of it.

| Limit | Value | Answer when exceeded |
|---|---|---|
| events per page (`limit`) | 500 | 400 |
| period of the statistics (`hours`) | 720 (30 days) | 400 |
| names in `POST /alerts/query` | 10 000 | 400 |
| period of `POST /alerts/query` (`days`) | 90 | 400 |
| alerts returned by `POST /alerts/query` | 500 | the list is cut; `days` still counts all |
| body of a verdict | 16 KB | 413 |
| body of `POST /alerts/query` | 512 KB | 413 |
| `note` of a verdict | 2 000 characters | 400 |
| `reference` of a verdict | 500 characters | 400 |
| package name | 214 characters (the npm rule) | 400 |
| WebSocket connections | 50 at a time | 503 on the upgrade request |
| WebSocket message from a client | 1 KB; the server ignores client messages | the connection closes |
| statement time of the dashboard's database role | 60 s | 500 |

## What the monitor itself is limited by

The request budgets of the *monitor* towards its external sources are a different thing: they
bound what stage 2 may ask the registry, GitHub, deps.dev, ecosyste.ms and RDAP per hour.
`GET /stats/sources` reports how much of each budget was used and how many requests were
skipped. An event whose enrichment skipped a source says so in the `sources` object of its card.

## Caching

JSON answers carry `Cache-Control: no-store`: the data changes every second.
