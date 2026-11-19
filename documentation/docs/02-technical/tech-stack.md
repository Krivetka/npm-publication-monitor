# Technology stack

Table: Technologies and their justification

| Layer | Technology | Why this one |
|---|---|---|
| Runtime | Node.js 24 | the subject is npm; built-in `fetch`, `node:test` and native TypeScript type stripping remove every build step |
| Language | TypeScript 7, `tsc --noEmit` | static types over registry JSON of many shapes; the source that runs is the source that is tested |
| Database | PostgreSQL 18, postgres.js | one transactional store with native partitioning and `NOTIFY`; tagged-template queries, no ORM between the evaluation and its SQL |
| API | `node:http`, `ws`, OpenAPI 3.1, Swagger UI (vendored) | 16 operations and one WebSocket need no framework; contract first |
| Front-end | Preact 11 + htm via import map; hand-drawn SVG charts | components without JSX or bundler; validated palettes; 25 KB of modules |
| Tests | `node:test` | 151 tests, 38 of them against a real database |
| Containers | Docker Engine 29, Compose v2 | one image, seven services, host network to reach the host PostgreSQL |
| Operations | Docker Compose, nginx, Tailscale (private access), nightly `pg_dumpall` | no public surface, no hosting cost |
| External data | npm feed and registry, ecosyste.ms, deps.dev, GitHub REST, RDAP | all public; ecosyste.ms gives repository state without GitHub quota |

Deliberately not used: a message broker (the journal table is the queue), an ORM, a bundler, a machine-learning library (no labelled corpus, explainability required) and a scheduler (every worker is a loop with its own cursor).
