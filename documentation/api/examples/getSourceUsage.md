# getSourceUsage

An answer of a running instance, captured by `scripts/api-examples.mjs`. Lists are cut to two or three items and account names are replaced by labels, so a list can be shorter than the request asks for. `BASE` is the address of the dashboard, for example `http://127.0.0.1:8090/npm`.

## Request

```sh
curl -s "$BASE/api/v1/stats/sources?hours=720"
```

## Response 200

```json
[
  {
    "source": "depsdev",
    "requests": 65427,
    "errors": 6,
    "skipped": 0
  },
  {
    "source": "ecosystems",
    "requests": 92529,
    "errors": 511,
    "skipped": 0
  },
  {
    "source": "github",
    "requests": 28463,
    "errors": 15,
    "skipped": 0
  }
]
```

## Error 400

```sh
curl -s "$BASE/api/v1/stats/sources?hours=0"
```

```json
{
  "error": "hours: must be >= 1"
}
```
