# listMaintainerHistory

An answer of a running instance, captured by `scripts/api-examples.mjs`. Lists are cut to two or three items and account names are replaced by labels, so a list can be shorter than the request asks for. `BASE` is the address of the dashboard, for example `http://127.0.0.1:8090/npm`.

## Request

```sh
curl -s "$BASE/api/v1/packages/dsh-project-recall/maintainers"
```

## Response 200

```json
[
  {
    "package": "dsh-project-recall",
    "seq": 147217305,
    "observed_at": "2026-11-24T14:02:38.021Z",
    "maintainers": [
      "account-1"
    ],
    "added": [
      "account-1"
    ],
    "removed": []
  }
]
```

## Error 400

```sh
curl -s "$BASE/api/v1/packages/Not%20A%20Name/maintainers"
```

```json
{
  "error": "invalid package name"
}
```
