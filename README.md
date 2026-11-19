# npm-publish-monitor

Continuous monitoring of npm registry publications with multi-stage filtering — diploma project
*"Design and Evaluation of a Continuous Monitoring System for Early Detection of Suspicious npm
Package Publications Using Multi-Stage Filtering"* (Ivan Kuliashov, European Humanities University).

Thesis documentation — [documentation/](documentation/) (`npm run docs:pdf` builds the PDF).

![Pipeline](documentation/docs/assets/images/pipeline.png)

## What it does

- **Collector** reads the registry change feed (`replicate.npmjs.com/registry/_changes`) continuously: cursor and events in one transaction, monthly partitions, recovery with back-off.
- **Stage 1** scores every event with no network requests — temporal bursts, look-alike names against the top-10 000 packages, revision anomalies, a top-1000 watchlist — and lets through a few percent as candidates.
- **Stage 2** enriches candidates from the npm registry, ecosyste.ms, deps.dev, GitHub and RDAP under per-source hourly budgets, compares publisher, manifest, versions and repository with the package history, stores an evidence snapshot and raises alerts.
- **API and dashboard**: REST (OpenAPI 3.1, Swagger UI at `/npm/api/docs`), a WebSocket stream, and a single-page dashboard (Preact, no build step) with a live feed, event cards with analyst verdicts, statistics and search. The page *My dependencies* shows only the alerts on the packages of a lock file.
- **Privacy**: see [PRIVACY.md](PRIVACY.md); the dashboard shows the same notice at `/npm/privacy`.

## Status

| Component | Status |
|---|---|
| Changes-feed collector, partitioned journal | done |
| Stage 1 and stage 2 | done, calibration v3 / v5 |
| Database: constraints, triggers, views, roles, retention ([documentation/database/](documentation/database/)) | done |
| REST API + WebSocket, Swagger UI | done |
| Single-page dashboard, adaptive layout | done, `/npm/` |
| Deployment: Docker Compose, health endpoint, log shipping overlay | done |
| Incident scenarios and experimental evaluation | in progress |

## Database

PostgreSQL 18, transactional (OLTP). All database materials are in [documentation/database/](documentation/database/):

| Material | File |
|---|---|
| Description of the database part, with the requirements checklist | [documentation/database/README.md](documentation/database/README.md) |
| Data dictionary: tables, columns, types, keys, constraints, indexes, triggers, views, functions | [documentation/database/data-dictionary.md](documentation/database/data-dictionary.md) |
| Logical schema | [documentation/database/logical-schema.svg](documentation/database/logical-schema.svg) |
| DDL script of the whole structure | [documentation/database/schema.sql](documentation/database/schema.sql) |
| Migrations (source of truth for the structure) | [migrations/](migrations/) |
| Roles | [deploy/db-roles.sql](deploy/db-roles.sql), [migrations/010_roles.sql](migrations/010_roles.sql) |
| Test data and reference data | [db/seed/test-data.sql](db/seed/test-data.sql), `npm run db:reference` |
| Integration tests of the database | [test/db.test.ts](test/db.test.ts) |

The structure is created by the migrations only, never by hand. To build the database and check it (Node 24 and Docker):

```sh
npm ci
cp .env.example .env
docker compose -f compose.dev.yml up -d --wait   # PostgreSQL 18 on 127.0.0.1:55432
npm run migrate                                  # structure, reference data, access rights
npm run db:seed                                  # test data: 15 events in every state
TEST_DATABASE_URL=postgres://npm_monitor:dev@127.0.0.1:55432/npm_monitor npm test   # 134 tests, 38 of them on the database
```

The password in `.env.example` and `compose.dev.yml` belongs to the local development container only. The repository holds no keys or passwords of the deployment; they live in the server's `.env`.

## Running

Production: Docker with Compose v2 and PostgreSQL 18 on the same host (containers in host network mode).

```sh
cp .env.example .env        # DATABASE_URL[_ADMIN|_WEB], GITHUB_TOKEN, ANALYST_TOKEN
docker compose up -d --build
docker compose logs -f collector stage1 stage2
# optional centralised logs (Grafana Cloud Loki credentials in .env):
docker compose -f docker-compose.yml -f deploy/compose.logs.yml up -d
```

Deploying to the server from the developer machine: `sh scripts/deploy.sh` (remote and host in an untracked `.deploy.env`).

Local development (Node 24):

```sh
npm ci
cp .env.example .env
docker compose -f compose.dev.yml up -d --wait   # Postgres 18 on 127.0.0.1:55432
npm run migrate                                  # schema, reference data, access rights
npm run db:seed                                  # optional: a small set of test data
npm run collector                                # likewise: stage1, stage2, popular, web, maintenance
npm run typecheck && npm test                    # without TEST_DATABASE_URL the database tests are skipped
```

The web process listens on `127.0.0.1:8090`; expose it with `deploy/nginx-npm-monitor.conf` or an SSH tunnel.

## Layout

```
src/
  config.ts, db.ts, log.ts, migrate.ts
  db/           migration runner, reference data, test-data loader
  maintenance/  daily: partitions, retention, refresh of daily totals
  collector/    polls the changes feed → feed_event (monthly partitions)
  popular/      daily snapshot of the top popular packages
  stage1/       stage 1 engine (no I/O), prescore, candidates
  stage2/       candidate enrichment, final score, evidence snapshot, alerts
  api/          OpenAPI contract, REST router, WebSocket stream, Swagger UI, static serving
  web/          web process (CSP, routing); static/ — the SPA; pages.ts — SSR fallback
  lib/          shared utilities
migrations/     SQL schema (applied in name order)
test/           node:test (server and client units)
documentation/  thesis: docs/ template, build.mjs (PDF), package.mjs (submission archive)
scripts/        deployment
deploy/         nginx snippet, log-shipping overlay (Grafana Alloy)
```
