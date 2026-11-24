# Architecture overview

Where the API sits in the system, what happens to a request, and which resources it exposes.

## System context

```mermaid
flowchart LR
  subgraph clients [Clients]
    dash[Dashboard<br/>single-page app]
    script[Scripts and CI jobs]
    monitor[Uptime check]
  end
  subgraph node [Monitoring node]
    web[web process<br/>REST API · WebSocket · Swagger UI]
    db[(PostgreSQL 18<br/>journal · results · verdicts)]
    pipe[collector → stage 1 → stage 2]
  end
  feed[npm change feed]
  src[registry · GitHub · deps.dev<br/>ecosyste.ms · RDAP]

  dash -- REST + WebSocket --> web
  script -- REST --> web
  monitor -- GET /health --> web
  web -- SQL, role npm_monitor_web --> db
  db -- NOTIFY --> web
  pipe -- SQL, role npm_monitor_write --> db
  feed --> pipe
  pipe --> src
```

The API is the only way into the data for a client, and it is a thin layer: the web process
holds no state of its own. The pipeline writes to the database; the web process reads from it,
relays the database's notifications to WebSocket clients, and writes one table, the verdicts.
A slow or crashed web process therefore cannot stop the collection, and a restart of the web
process loses nothing.

## Life of a request

```mermaid
sequenceDiagram
  participant C as Client
  participant R as Router (src/api/router.ts)
  participant V as Validation (src/api/validate.ts)
  participant Q as Queries (src/api/queries.ts)
  participant D as PostgreSQL
  C->>R: GET /npm/api/v1/events?alert=true&limit=2
  R->>V: query parameters
  alt a parameter is wrong
    V-->>C: 400 {"error":"limit: must be >= 1"}
  else
    R->>Q: listEvents(filters)
    Q->>D: one parameterised statement
    D-->>Q: rows
    Q-->>R: Event objects (src/api/serialize.ts)
    R-->>C: 200 {"items":[…],"next_before":…}
  end
```

A write adds one step before validation: the bearer token is compared with `ANALYST_TOKEN`
(401 when it does not match), then the body is read with a size limit (413) and validated (400).

| Step | Where | What can go wrong |
|---|---|---|
| Routing | `router.ts` | 404 unknown path, 405 wrong method |
| Token (writes only) | `checkBearer` | 401 |
| Validation | `validate.ts` | 400, 413 |
| Query | `queries.ts`, one to three statements per request, parameters always bound | 404 when nothing matches a single-resource request; 500 when the database fails |
| Serialisation | `serialize.ts` | — |

## Life of a pushed message

```mermaid
sequenceDiagram
  participant P as Pipeline process
  participant D as PostgreSQL
  participant W as web process (src/api/ws.ts)
  participant C as WebSocket client
  P->>D: INSERT results + NOTIFY, in one transaction
  D-->>W: notification on commit (channel feed, stage1 or stage2)
  W->>D: read the rows the notification names
  W-->>C: {"type":"event" | "stage1" | "stage2", …}
```

The notification is sent by the same transaction that stores the data, so a client never hears
about a row that was rolled back. The web process handles notifications one at a time, in
order.

## Resources

| Resource | Identified by | Read | Write | Comes from |
|---|---|---|---|---|
| Event | `seq` | list, card, per package | — | collector (journal), stage 1, stage 2 |
| Stage result | the event's `seq` | inside the event | — | stage 1, stage 2 |
| Finding (verdict) | the event's `seq` | list, inside the event | put, delete (token) | analyst |
| Maintainer history | package name | list | — | stage 2 |
| Statistics | time window | totals, hourly, pulse, features, sources | — | counters of both stages |
| Feature catalogue | feature id | list | — | the code (`src/api/catalogue.ts`) |
| Status, health | — | status, health | — | cursors of the pipeline |

Relations: one event has at most one stage-1 result, one stage-2 result and one verdict. A
package has many events. Stage results exist only for events where something fired (stage 1)
or that were candidates (stage 2), so most events have `stage1: null`.

## Modules

| File | Role |
|---|---|
| `src/api/openapi.ts` | the contract: paths, schemas, security; examples are attached from `examples.ts` |
| `src/api/examples.ts` | captured answers of a running instance (generated) |
| `src/api/router.ts` | maps a request to a query; the only place that knows HTTP |
| `src/api/validate.ts` | parameters and bodies; every rejection is an `ApiError` with a status |
| `src/api/queries.ts` | SQL of the API |
| `src/api/serialize.ts` | database rows → the objects of the contract |
| `src/api/ws.ts` | the WebSocket stream |
| `src/api/swagger.ts`, `static.ts` | Swagger UI and static files, served from the same process |
