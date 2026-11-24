# getPulse

An answer of a running instance, captured by `scripts/api-examples.mjs`. Lists are cut to two or three items and account names are replaced by labels, so a list can be shorter than the request asks for. `BASE` is the address of the dashboard, for example `http://127.0.0.1:8090/npm`.

## Request

```sh
curl -s "$BASE/api/v1/stats/pulse"
```

## Response 200

```json
[
  {
    "minute": "2026-11-24T14:01:00.000Z",
    "n": 75
  },
  {
    "minute": "2026-11-24T14:02:00.000Z",
    "n": 44
  },
  {
    "minute": "2026-11-24T14:03:00.000Z",
    "n": 66
  }
]
```
