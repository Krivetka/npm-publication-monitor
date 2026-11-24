# npm Publication Monitor — API documentation

This branch holds the application and, of the project documents, only those of the API
documentation criterion. The whole project is on the branch [main](https://github.com/Krivetka/npm-publication-monitor/tree/main).

The monitor reads the change feed of the npm registry, scores each publication in two stages and
raises alerts. Its REST API and WebSocket stream give the events, the alerts, the statistics and
the verdicts of an analyst; the dashboard uses the same API.

## Where the API documentation is

The API is described in OpenAPI 3.1. Where to find it:

| What | Where |
|---|---|
| Guides, tutorials, reference pages, changelog | [documentation/api/](documentation/api/) — start with its [README](documentation/api/README.md) |
| Getting started | [documentation/api/guides/getting-started.md](documentation/api/guides/getting-started.md) |
| The specification file | [documentation/api/schemas/openapi.json](documentation/api/schemas/openapi.json) |
| Interactive reference (Swagger UI) | `/npm/api/docs` on a running instance; the document itself at `/npm/api/v1/openapi.json` |
| One file per operation with request, answer and error answers | [documentation/api/examples/](documentation/api/examples/) |

`npm run api:spec` writes the specification file from the code; `npm test` fails when the file
differs from the contract in the code or an example does not match its schema; `npm run api:lint` runs Redocly CLI over the file.

To see Swagger UI on your machine, run the project as the next section describes (local
development) and open http://127.0.0.1:8090/npm/api/docs .

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
