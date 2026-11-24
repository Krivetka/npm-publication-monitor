# getHourly

An answer of a running instance, captured by `scripts/api-examples.mjs`. Lists are cut to two or three items and account names are replaced by labels, so a list can be shorter than the request asks for. `BASE` is the address of the dashboard, for example `http://127.0.0.1:8090/npm`.

## Request

```sh
curl -s "$BASE/api/v1/stats/hourly?hours=3"
```

## Response 200

```json
[
  {
    "hour": "2026-11-24T13:00:00.000Z",
    "processed": 5451,
    "candidates": 144,
    "enriched": 144,
    "alerts": 2
  },
  {
    "hour": "2026-11-24T14:00:00.000Z",
    "processed": 5564,
    "candidates": 266,
    "enriched": 265,
    "alerts": 4
  }
]
```

## Error 400

```sh
curl -s "$BASE/api/v1/stats/hourly?hours=721"
```

```json
{
  "error": "hours: must be <= 720"
}
```
