# getTotals

An answer of a running instance, captured by `scripts/api-examples.mjs`. Lists are cut to two or three items and account names are replaced by labels, so a list can be shorter than the request asks for. `BASE` is the address of the dashboard, for example `http://127.0.0.1:8090/npm`.

## Request

```sh
curl -s "$BASE/api/v1/stats/totals?hours=24"
```

## Response 200

```json
{
  "hours": 24,
  "events": 115170,
  "processed": 109764,
  "flagged": 31648,
  "candidates": 4887,
  "enriched": 5162,
  "alerts": 52
}
```

## Error 400

```sh
curl -s "$BASE/api/v1/stats/totals?hours=0"
```

```json
{
  "error": "hours: must be >= 1"
}
```
