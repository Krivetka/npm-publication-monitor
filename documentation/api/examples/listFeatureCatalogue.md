# listFeatureCatalogue

An answer of a running instance, captured by `scripts/api-examples.mjs`. Lists are cut to two or three items and account names are replaced by labels, so a list can be shorter than the request asks for. `BASE` is the address of the dashboard, for example `http://127.0.0.1:8090/npm`.

## Request

```sh
curl -s "$BASE/api/v1/features"
```

## Response 200

```json
[
  {
    "id": "rate_global",
    "stage": 1,
    "lane": "temporal",
    "title": "Feed burst",
    "short": "feed",
    "hint": "more events per 10 min across the whole registry than usual",
    "weight": 0.5
  },
  {
    "id": "rate_package",
    "stage": 1,
    "lane": "temporal",
    "title": "Package burst",
    "short": "burst",
    "hint": "more changes of the package per 10 min than usual for it",
    "weight": 2
  },
  {
    "id": "rate_scope",
    "stage": 1,
    "lane": "temporal",
    "title": "Scope burst",
    "short": "scope",
    "hint": "more events in the scope per 10 min than usual",
    "weight": 1
  }
]
```
