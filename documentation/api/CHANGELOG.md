# API changelog

The version is `info.version` of the OpenAPI document. Rules: [reference/versioning.md](reference/versioning.md).

## 1.1.0 — 2026-11-24

Added

- `POST /alerts/query`: the alerts on a list of package names with the count per day
  (operation `queryDependencyAlerts`, schema `DependencyAlerts`).
- An example for every JSON response and every request body, captured from a running instance.
- The 400 answers of `GET /events/{seq}`, `GET /findings`, `GET /packages/{name}/events`,
  `GET /packages/{name}/maintainers`, `DELETE /events/{seq}/finding` and the four statistics
  endpoints are now in the document. The server gave them before; only the document changed.
- A description for every operation; `info.contact`; an explicit empty default `security`.

Changed

- The document is valid OpenAPI 3.1: `nullable: true` (an OpenAPI 3.0 keyword) became a union
  with `"null"`. The answers of the server did not change.
- A watchlist package raises an alert on stage-2 evidence alone (stage-2 parameters v6,
  19 November). The fields of `Stage2Summary` did not change; `alert` is true more often for
  packages of the top 1 000.

## 1.0.0 — 2026-10-17

First version: status and health, the journal with filters and a cursor, the event card,
events and maintainer history of a package, verdicts with the analyst token, statistics, the
feature catalogue, the WebSocket stream, Swagger UI.
