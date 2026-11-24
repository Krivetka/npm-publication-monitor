# Getting started

In ten minutes you will start the monitor on your machine, make a request to its API and read
an alert. You need Docker, Node.js 24 and `curl`.

## 1. Start an instance

```sh
git clone https://github.com/Krivetka/npm-publication-monitor.git
cd npm-publication-monitor
npm ci

docker compose -f compose.dev.yml up -d --wait   # PostgreSQL 18 on 127.0.0.1:55432
cp .env.example .env
npm run migrate                              # schema, reference data
npm run db:seed                              # 15 events with stage results, alerts and verdicts
node --env-file=.env src/web/main.ts         # the API and the dashboard on 127.0.0.1:8090
```

The seed gives a small fixed data set, so the examples below answer at once. To collect real
publications instead, start the pipeline: `npm run collector`, then
`node --env-file=.env src/stage1/main.ts` and `node --env-file=.env src/stage2/main.ts`.

Set the base address once:

```sh
BASE=http://127.0.0.1:8090/npm
```

## 2. Check that the API answers

```sh
curl -s "$BASE/api/v1/status"
```

```json
{
  "now": "2026-11-24T15:07:38.120Z",
  "collector": { "last_seq": 1015, "head_seq": 1015, "lag": 0, "polled_at": "2026-11-24T15:07:32.816Z", "advanced_at": "2026-11-24T14:27:32.816Z" },
  "stage1": { "last_seq": 1015, "lag": 0, "updated_at": "2026-11-24T15:07:32.816Z" },
  "stage2": { "queue": 1, "last_at": "2026-11-24T14:29:32.816Z" },
  "popular": { "snapshot": "2026-11-24", "names": 2 },
  "journal": { "first": "2026-10-15T15:07:32.816Z", "estimate": 0 }
}
```

The numbers are those of the seed: 15 events, the newest with `seq` 1015. The times are
relative to the moment you loaded it.

`GET /health` answers the same question for a monitor: 200 when the pipeline keeps up, 503
with the reasons when it does not.

## 3. Read the newest alerts

No credentials are needed to read.

```sh
curl -s "$BASE/api/v1/events?alert=true&limit=2"
```

The answer is a page of events, newest first. Each event carries the results of both stages:

```json
{
  "items": [
    {
      "seq": 1014,
      "package": "@acme/widgets",
      "rev": "15-5555",
      "deleted": false,
      "observed_at": "2026-11-24T14:17:32.816Z",
      "observed_after": "2026-11-24T14:17:27.816Z",
      "stage1": {
        "prescore": 3.5,
        "candidate": true,
        "features": [
          { "id": "name_scope_typo", "lane": "nominal", "value": "@acme/widgets", "weight": 2 },
          { "id": "name_edit", "lane": "nominal", "value": "widgets", "weight": 1.5 }
        ],
        "engine": "v3:a566433d@2026-11-24"
      },
      "stage2": {
        "kind": "publish",
        "versions": ["0.1.0"],
        "prescore": 3.5,
        "final_score": 6,
        "alert": true,
        "features": [
          { "id": "install_script_new_package", "lane": "manifest", "value": ["preinstall"], "detail": { "versions": ["0.1.0"] }, "weight": 2.5 }
        ],
        "enriched_at": "2026-11-24T14:19:32.816Z",
        "engine": "v5:ed7f77fa"
      },
      "finding": null
    },
    { "seq": 1010, "package": "noisy-lib", "…": "the second alert, with a verdict" }
  ],
  "next_before": 1010
}
```

The second item is shortened here; the server returns it in full.

- `stage1.features` and `stage2.features` say why the event got its score: the feature, the
  measured value, the threshold and the weight.
- `stage2.alert` is the decision. `finding` is the verdict of an analyst, when there is one.
- `next_before` is the cursor of the next page: `…/events?alert=true&limit=2&before=1010`.
  See [pagination](../reference/pagination.md).

## 4. Open one event

```sh
curl -s "$BASE/api/v1/events/1014"
```

The card adds what the list leaves out: the evidence snapshot stored at enrichment (manifests
of the new and the previous version, the release history, the answers of the external
sources) and the other journal events of the same package. An example from a production instance is in
[examples/getEvent.md](../examples/getEvent.md).

## 5. When a request is wrong

Every error has the same shape and names the parameter:

```sh
curl -s -i "$BASE/api/v1/events?limit=0"
```

```
HTTP/1.1 400 Bad Request
content-type: application/json; charset=utf-8
content-length: 31
cache-control: no-store
…

{"error":"limit: must be >= 1"}
```

The list of status codes and messages is in [reference/errors.md](../reference/errors.md).

## 6. Browse the reference

Open `http://127.0.0.1:8090/npm/api/docs`. Swagger UI lists every operation with its
parameters, schemas and examples; **Try it out** sends the request to your instance.

## Where to go next

| Goal | Tutorial |
|---|---|
| Only the alerts on the packages I depend on | [tutorial-dependency-alerts.md](tutorial-dependency-alerts.md) |
| A live stream instead of polling | [tutorial-live-feed.md](tutorial-live-feed.md) |
| Record verdicts with the analyst token | [tutorial-verdicts.md](tutorial-verdicts.md) |
