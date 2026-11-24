# listPackageEvents

An answer of a running instance, captured by `scripts/api-examples.mjs`. Lists are cut to two or three items and account names are replaced by labels, so a list can be shorter than the request asks for. `BASE` is the address of the dashboard, for example `http://127.0.0.1:8090/npm`.

## Request

```sh
curl -s "$BASE/api/v1/packages/dsh-project-recall/events?limit=2"
```

## Response 200

```json
{
  "items": [
    {
      "seq": 147222372,
      "package": "dsh-project-recall",
      "rev": "14-cbaad3625fb8742c26c90120b72def2c",
      "deleted": false,
      "observed_at": "2026-11-24T14:24:02.605Z",
      "observed_after": "2026-11-24T14:23:37.615Z",
      "stage1": null,
      "stage2": null,
      "finding": null
    },
    {
      "seq": 147217305,
      "package": "dsh-project-recall",
      "rev": "13-0eb9a076412de7db76ae84eac76678ef",
      "deleted": false,
      "observed_at": "2026-11-24T14:02:38.021Z",
      "observed_after": "2026-11-24T14:02:32.712Z",
      "stage1": {
        "prescore": 2,
        "candidate": true,
        "features": [
          {
            "id": "rate_package",
            "lane": "temporal",
            "value": 3,
            "detail": {
              "std": 0,
              "mean": 0,
              "count": 3
            },
            "weight": 2,
            "threshold": 2.5
          }
        ],
        "engine": "v3:a566433d@2026-11-24"
      },
      "stage2": {
        "kind": "publish",
        "versions": [
          "0.7.2"
        ],
        "prescore": 2,
        "final_score": 4.5,
        "alert": true,
        "features": [
          {
            "id": "publisher_recent",
            "lane": "publisher",
            "value": 17,
            "detail": {
              "firstSeen": "2026-11-07T08:10:42.721366Z"
            },
            "weight": 1.5
          },
          {
            "id": "repo_missing",
            "lane": "repository",
            "value": "repo-owner/dsh-backup",
            "weight": 1
          }
        ],
        "enriched_at": "2026-11-24T14:03:40.576Z",
        "engine": "v6:49ba8745"
      },
      "finding": null
    }
  ],
  "next_before": null
}
```

## Error 400

```sh
curl -s "$BASE/api/v1/packages/Not%20A%20Name/events"
```

```json
{
  "error": "invalid package name"
}
```

## Error 404

```sh
curl -s "$BASE/api/v1/packages/no-such-package-in-the-journal/events"
```

```json
{
  "error": "no events for this package in the journal"
}
```
