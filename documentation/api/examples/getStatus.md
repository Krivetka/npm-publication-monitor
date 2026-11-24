# getStatus

An answer of a running instance, captured by `scripts/api-examples.mjs`. Lists are cut to two or three items and account names are replaced by labels, so a list can be shorter than the request asks for. `BASE` is the address of the dashboard, for example `http://127.0.0.1:8090/npm`.

## Request

```sh
curl -s "$BASE/api/v1/status"
```

## Response 200

```json
{
  "now": "2026-11-24T15:01:37.420Z",
  "collector": {
    "last_seq": 147233999,
    "head_seq": 147233937,
    "lag": 0,
    "polled_at": "2026-11-24T15:01:33.870Z",
    "advanced_at": "2026-11-24T15:01:33.870Z"
  },
  "stage1": {
    "last_seq": 147233999,
    "lag": 0,
    "updated_at": "2026-11-24T15:01:35.265Z"
  },
  "stage2": {
    "queue": 5,
    "last_at": "2026-11-24T15:01:23.380Z"
  },
  "popular": {
    "snapshot": "2026-11-24",
    "names": 10000
  },
  "journal": {
    "first": "2026-10-14T11:29:18.937Z",
    "estimate": 4062781
  }
}
```
