# listFindings

An answer of a running instance, captured by `scripts/api-examples.mjs`. Lists are cut to two or three items and account names are replaced by labels, so a list can be shorter than the request asks for. `BASE` is the address of the dashboard, for example `http://127.0.0.1:8090/npm`.

## Request

```sh
curl -s "$BASE/api/v1/findings"
```

## Response 200

```json
[
  {
    "seq": 146042686,
    "verdict": "false_positive",
    "note": "OpenHarmony port scope: new publisher is a scope member; beta builds of the napi-rs port.",
    "decided_at": "2026-11-19T18:24:05.651Z"
  },
  {
    "seq": 145996033,
    "verdict": "false_positive",
    "note": "New tool with repo (commit found); postinstall installs git hooks as the tool's purpose.",
    "decided_at": "2026-11-19T18:24:05.619Z"
  }
]
```

## Error 400

```sh
curl -s "$BASE/api/v1/findings?verdict=maybe"
```

```json
{
  "error": "invalid verdict"
}
```
