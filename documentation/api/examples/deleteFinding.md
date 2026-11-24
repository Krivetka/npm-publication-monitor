# deleteFinding

Written by hand: the capture of `scripts/api-examples.mjs` runs without the analyst token, so only the 401 answer below is a captured one. `BASE` is the address of the dashboard, for example `http://127.0.0.1:8090/npm`.

## Request

```sh
curl -s -X DELETE -H 'authorization: Bearer <ANALYST_TOKEN>' -o /dev/null -w '%{http_code}\n' "$BASE/api/v1/events/147217305/finding"
```

## Response 204

No body. The command above prints `204`. A second call also answers 204: the operation is idempotent.

## Error 401

```sh
curl -s -X DELETE "$BASE/api/v1/events/147217305/finding"
```

```json
{
  "error": "analyst token required"
}
```

## Error 404

```sh
curl -s -X DELETE -H 'authorization: Bearer <ANALYST_TOKEN>' "$BASE/api/v1/events/1/finding"
```

```json
{
  "error": "no such event"
}
```
