# putFinding

An answer of a running instance, captured by `scripts/api-examples.mjs`. Lists are cut to two or three items and account names are replaced by labels, so a list can be shorter than the request asks for. `BASE` is the address of the dashboard, for example `http://127.0.0.1:8090/npm`.

The 200 answer below is written by hand in the shape of a stored verdict: the capture runs without the analyst token. The error answers 401 are captured; 400, 404 and 413 have the messages `verdict must be one of confirmed, false_positive, undecided`, `no such event` and `body too large`.

## Request

```sh
curl -s -X PUT -H 'authorization: Bearer <ANALYST_TOKEN>' -H 'content-type: application/json' -d '{"verdict":"false_positive","note":"nightly build from the project CI"}' "$BASE/api/v1/events/147217305/finding"
```

## Response 200

```json
{
  "seq": 147217305,
  "verdict": "false_positive",
  "note": "nightly build from the project CI",
  "decided_at": "2026-11-24T15:01:37.420Z"
}
```

## Error 401

```sh
curl -s -X PUT -H 'content-type: application/json' -d '{"verdict":"confirmed"}' "$BASE/api/v1/events/147217305/finding"
```

```json
{
  "error": "analyst token required"
}
```

## Error 401

```sh
curl -s -X PUT -H 'authorization: Bearer <wrong token>' -H 'content-type: application/json' -d '{"verdict":"maybe"}' "$BASE/api/v1/events/147217305/finding"
```

```json
{
  "error": "analyst token required"
}
```
