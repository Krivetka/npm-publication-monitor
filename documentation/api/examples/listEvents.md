# listEvents

An answer of a running instance, captured by `scripts/api-examples.mjs`. Lists are cut to two or three items and account names are replaced by labels, so a list can be shorter than the request asks for. `BASE` is the address of the dashboard, for example `http://127.0.0.1:8090/npm`.

## Request

```sh
curl -s "$BASE/api/v1/events?alert=true&limit=2"
```

## Response 200

```json
{
  "items": [
    {
      "seq": 147229822,
      "package": "@koda-sl/baker-cli",
      "rev": "1963-8cc2e21e30457248a6c1f7c09c5fb9e6",
      "deleted": false,
      "observed_at": "2026-11-24T14:46:04.770Z",
      "observed_after": "2026-11-24T14:45:59.031Z",
      "stage1": {
        "prescore": 2,
        "candidate": true,
        "features": [
          {
            "id": "rate_package",
            "lane": "temporal",
            "value": 2.83,
            "detail": {
              "std": 0.43,
              "mean": 0.17,
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
          "0.1030.0-dev.504533c15"
        ],
        "prescore": 2,
        "final_score": 4,
        "alert": true,
        "features": [
          {
            "id": "multi_branch",
            "lane": "versions",
            "value": [
              "0.1029.0-dev.0deaa8ede",
              "0.1030.0-dev.504533c15"
            ],
            "detail": {
              "lines": [
                "0.1029",
                "0.1030"
              ]
            },
            "weight": 1
          },
          {
            "id": "repo_missing",
            "lane": "repository",
            "value": "repo-owner/baker",
            "weight": 1
          }
        ],
        "enriched_at": "2026-11-24T14:47:13.667Z",
        "engine": "v6:49ba8745"
      },
      "finding": null
    },
    {
      "seq": 147227193,
      "package": "@lokalise/maestro-expert-tenant-lib",
      "rev": "306-c55c4e1d1982e8f6292d1631f929028a",
      "deleted": false,
      "observed_at": "2026-11-24T14:37:10.691Z",
      "observed_after": "2026-11-24T14:37:05.377Z",
      "stage1": {
        "prescore": 2,
        "candidate": true,
        "features": [
          {
            "id": "rate_package",
            "lane": "temporal",
            "value": 2.99,
            "detail": {
              "std": 0.08,
              "mean": 0.01,
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
          "15.18.0-beta.0"
        ],
        "prescore": 2,
        "final_score": 4.5,
        "alert": true,
        "features": [
          {
            "id": "publisher_from_trusted",
            "lane": "publisher",
            "value": "user:account-1",
            "detail": {
              "recent": [
                "trusted:github",
                "trusted:github"
              ],
              "versions": [
                "15.18.0-beta.0"
              ]
            },
            "weight": 2.5
          }
        ],
        "enriched_at": "2026-11-24T14:38:15.070Z",
        "engine": "v6:49ba8745"
      },
      "finding": null
    }
  ],
  "next_before": 147227193
}
```

## Error 400

```sh
curl -s "$BASE/api/v1/events?limit=0"
```

```json
{
  "error": "limit: must be >= 1"
}
```

## Error 400

```sh
curl -s "$BASE/api/v1/events?before=10&after=5"
```

```json
{
  "error": "before and after are mutually exclusive"
}
```
