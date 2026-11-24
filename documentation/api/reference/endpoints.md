# Endpoints

All paths are relative to `/npm/api/v1`. The machine-readable form of this page is
[`../schemas/openapi.json`](../schemas/openapi.json); the interactive form is Swagger UI at
`/npm/api/docs`. The column *Example* links the captured request and answers of each operation.

## Status

| Method and path | Operation | What it does | Example |
|---|---|---|---|
| `GET /status` | `getStatus` | positions and lag of the collector and both stages, the enrichment queue, the watchlist snapshot | [getStatus](../examples/getStatus.md) |
| `GET /health` | `getHealth` | 200 when the pipeline keeps up, 503 with the reasons when it does not; made for an uptime check | [getHealth](../examples/getHealth.md) |

## Events

| Method and path | Operation | What it does | Example |
|---|---|---|---|
| `GET /events` | `listEvents` | the journal, newest first, with filters and a cursor | [listEvents](../examples/listEvents.md) |
| `GET /events/{seq}` | `getEvent` | the event card: both stage results in full, the evidence snapshot, the verdict, other events of the package | [getEvent](../examples/getEvent.md) |
| `GET /packages/{name}/events` | `listPackageEvents` | the newest events of one package | [listPackageEvents](../examples/listPackageEvents.md) |
| `GET /packages/{name}/maintainers` | `listMaintainerHistory` | every observed change of the maintainer set of a package | [listMaintainerHistory](../examples/listMaintainerHistory.md) |

Filters of `GET /events` (all optional, combined with AND):

| Parameter | Type | Meaning |
|---|---|---|
| `package` | string | exact package name |
| `flagged` | boolean | only events where a stage-1 feature fired |
| `candidate` | boolean | only stage-1 candidates |
| `feature` | string | only events where this feature id fired in stage 1 or stage 2 (ids: `GET /features`) |
| `alert` | boolean | only alerts |
| `min_score` | number | final score at least this (enriched events only) |
| `before`, `after`, `limit` | integer | the cursor; see [pagination](pagination.md) |

A scoped package name goes into the path URL-encoded: `/packages/%40scope%2Fname/events`.

## Results

| Method and path | Operation | What it does | Example |
|---|---|---|---|
| `POST /alerts/query` | `queryDependencyAlerts` | the alerts on a list of packages for the last days, with the count per day; reads only | [queryDependencyAlerts](../examples/queryDependencyAlerts.md) |

## Findings (analyst verdicts)

| Method and path | Operation | What it does | Example |
|---|---|---|---|
| `GET /findings` | `listFindings` | every verdict, newest first; `verdict` narrows to one value | [listFindings](../examples/listFindings.md) |
| `PUT /events/{seq}/finding` | `putFinding` | store or replace the verdict of an event; **needs the token** | [putFinding](../examples/putFinding.md) |
| `DELETE /events/{seq}/finding` | `deleteFinding` | remove the verdict; **needs the token** | [tutorial](../guides/tutorial-verdicts.md#step-6-remove-a-verdict) |

## Statistics

| Method and path | Operation | What it does | Example |
|---|---|---|---|
| `GET /stats/totals` | `getTotals` | the funnel from journal events to alerts for the last `hours` (1–720, default 24) | [getTotals](../examples/getTotals.md) |
| `GET /stats/hourly` | `getHourly` | one row per hour for charts (`hours` 1–720, default 48) | [getHourly](../examples/getHourly.md) |
| `GET /stats/pulse` | `getPulse` | events per minute for the last hour | [getPulse](../examples/getPulse.md) |
| `GET /stats/features` | `getFeatureCounts` | how often each feature fired | [getFeatureCounts](../examples/getFeatureCounts.md) |
| `GET /stats/sources` | `getSourceUsage` | requests sent, failed and skipped for quota, per external source | [getSourceUsage](../examples/getSourceUsage.md) |
| `GET /features` | `listFeatureCatalogue` | every feature with its label, lane and weight | [listFeatureCatalogue](../examples/listFeatureCatalogue.md) |

## Documentation endpoints

| Path | What it serves |
|---|---|
| `GET /npm/api/v1/openapi.json` | the OpenAPI 3.1 document |
| `GET /npm/api/docs` | Swagger UI over that document |
| `GET /npm/api/v1/ws` (upgrade) | the WebSocket stream; see [websocket.md](websocket.md) |

## Schemas

The data models are defined once, under `components.schemas` of the OpenAPI document.

| Schema | What it is |
|---|---|
| `Event` | a journal event: `seq`, `package`, `rev`, `deleted`, the interval it appeared in (`observed_after`, `observed_at`), and `stage1`, `stage2`, `finding` when they exist |
| `Stage1Summary` | preliminary score, the candidate flag, the fired features, the engine id |
| `Stage2Summary` | kind of the event, the versions it published, final score, the alert flag, the fired features |
| `Feature` | one fired feature: `id`, `lane`, `weight`, the measured `value`, the `threshold`, `detail` |
| `EventCard` | `Event` plus the full stage-2 result with the `evidence` snapshot and the `sources` answers, plus `package_events` |
| `EventList` | `items` and the cursor `next_before` |
| `DependencyAlerts` | `packages`, `days` (count per day), `items` |
| `Finding` | `seq`, `verdict`, `note`, `reference`, `decided_at` |
| `MaintainerSet` | the maintainer names of a package at one event, with `added` and `removed` |
| `Status`, `Health` | pipeline status; health checks with a `detail` text |
| `Totals`, `HourRow`, `PulsePoint`, `FeatureCount`, `SourceUsage`, `FeatureInfo` | rows of the statistics endpoints |
| `Error` | `{"error": "<message>"}` |

Field conventions: `snake_case`; times are ISO 8601 in UTC; `seq` is the registry's sequence
number, a 64-bit integer that only grows; a value that can be absent is `null`, not omitted,
for `stage1`, `stage2`, `finding` and `observed_after`.
