# getFeatureCounts

An answer of a running instance, captured by `scripts/api-examples.mjs`. Lists are cut to two or three items and account names are replaced by labels, so a list can be shorter than the request asks for. `BASE` is the address of the dashboard, for example `http://127.0.0.1:8090/npm`.

## Request

```sh
curl -s "$BASE/api/v1/stats/features?hours=720"
```

## Response 200

```json
[
  {
    "stage": 1,
    "id": "rate_scope",
    "count": 440546
  },
  {
    "stage": 1,
    "id": "new_package",
    "count": 252087
  },
  {
    "stage": 1,
    "id": "rate_package",
    "count": 86450
  }
]
```

## Error 400

```sh
curl -s "$BASE/api/v1/stats/features?hours=x"
```

```json
{
  "error": "hours: expected an integer"
}
```
