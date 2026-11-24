# getHealth

An answer of a running instance, captured by `scripts/api-examples.mjs`. Lists are cut to two or three items and account names are replaced by labels, so a list can be shorter than the request asks for. `BASE` is the address of the dashboard, for example `http://127.0.0.1:8090/npm`.

## Request

```sh
curl -s "$BASE/api/v1/health"
```

## Response 200

```json
{
  "ok": true,
  "checks": {
    "collector": {
      "ok": true,
      "detail": "polled 4 s ago"
    },
    "stage1": {
      "ok": true,
      "detail": "0 events behind the journal"
    },
    "stage2": {
      "ok": true,
      "detail": "5 candidates queued (informational)"
    }
  }
}
```
