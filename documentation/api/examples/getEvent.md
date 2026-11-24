# getEvent

An answer of a running instance, captured by `scripts/api-examples.mjs`. Lists are cut to two or three items and account names are replaced by labels, so a list can be shorter than the request asks for. `BASE` is the address of the dashboard, for example `http://127.0.0.1:8090/npm`.

## Request

```sh
curl -s "$BASE/api/v1/events/147217305"
```

## Response 200

```json
{
  "event": {
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
  },
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
    "engine": "v6:49ba8745",
    "evidence": {
      "depsdev": {
        "found": false
      },
      "registry": {
        "kind": "publish",
        "burst": [
          {
            "time": "2026-11-24T13:54:25.977Z",
            "present": true,
            "version": "0.7.0"
          }
        ],
        "event": [
          "0.7.2"
        ],
        "history": {
          "first": "2026-11-07T07:56:24.222Z",
          "versions": 10,
          "publishers": {
            "user:account-1": {
              "last": "2026-11-22T07:45:24.616Z",
              "count": 10
            }
          }
        },
        "removed": [],
        "distTags": {
          "latest": "0.7.2"
        },
        "previous": {
          "dist": {
            "tarball": "https://registry.npmjs.org/dsh-project-recall/-/dsh-project-recall-0.6.0.tgz",
            "fileCount": 17,
            "integrity": "sha512-mQLocn8Zz/MCFqVvAOfc1yZotaWG6Vel4AWhEA5/INaURZJ7Mg/j74iiKGU0aaxxElsrNa29e8fhXibezIRZQg==",
            "provenance": null,
            "unpackedSize": 206537
          },
          "time": "2026-11-22T07:45:24.616Z",
          "gitHead": "775c19cad3d7836f2a7e5fe0454a604fb8e2d4e1",
          "scripts": {
            "test": "node --test",
            "check": "node --check index.js && node --check client.js && node --check lib/model.js && node --check lib/store.js && node --check lib/http.js && node --check lib/too…"
          },
          "version": "0.6.0",
          "lifecycle": {},
          "publisher": {
            "name": "account-1",
            "trusted": null,
            "emailDomain": "qq.com"
          },
          "repository": "git+https://github.com/repo-owner/dsh-backup.git",
          "maintainers": [
            "account-1"
          ],
          "dependencies": {
            "zod": "^4.6.7"
          },
          "optionalDependencies": {}
        },
        "timeline": {
          "total": 13,
          "points": [
            [
              "0.0.0-stage",
              1794038184
            ],
            [
              "0.1.0",
              1794038261
            ]
          ],
          "publishers": [
            "user:account-1"
          ]
        },
        "versions": [
          {
            "dist": {
              "tarball": "https://registry.npmjs.org/dsh-project-recall/-/dsh-project-recall-0.7.2.tgz",
              "fileCount": 18,
              "integrity": "sha512-rcaGuxzobYaueDZ/W7hbtVv50rtA6Mj5bq3dQvinpocFwxgsxWLZROvAmyosRyupHTbAAsMCghPOGwUptsl4kA==",
              "provenance": null,
              "unpackedSize": 231273
            },
            "time": "2026-11-24T14:02:26.361Z",
            "gitHead": "68b06ce92acc8d2e4a562131cdbb45a5189b6621",
            "scripts": {
              "test": "node --test",
              "check": "node --check index.js && node --check client.js && node --check lib/model.js && node --check lib/store.js && node --check lib/http.js && node --check lib/too…"
            },
            "version": "0.7.2",
            "lifecycle": {},
            "publisher": {
              "name": "account-1",
              "trusted": null,
              "emailDomain": "qq.com"
            },
            "repository": "git+https://github.com/repo-owner/dsh-backup.git",
            "maintainers": [
              "account-1"
            ],
            "dependencies": {
              "zod": "^4.6.7"
            },
            "optionalDependencies": {}
          }
        ],
        "maintainers": [
          "account-1"
        ]
      },
      "github_commit": {
        "sha": "68b06ce92acc8d2e4a562131cdbb45a5189b6621",
        "repo": "repo-owner/dsh-backup",
        "repoFound": false
      },
      "ecosystems_package": {
        "repo": "hhse/dsh-project-recall",
        "found": true,
        "stars": 0,
        "archived": false,
        "pushedAt": "2026-11-07T08:17:16.000Z",
        "syncedAt": "2026-11-07T09:22:33.418Z"
      },
      "ecosystems_publisher": {
        "found": true,
        "packages": 3,
        "firstSeen": "2026-11-07T08:10:42.721366Z"
      }
    },
    "sources": {
      "depsdev": {
        "status": 404
      },
      "registry": {
        "status": 200
      },
      "github_commit": {
        "status": 404
      },
      "ecosystems_package": {
        "status": 200
      },
      "ecosystems_publisher": {
        "status": 200
      }
    }
  },
  "finding": null,
  "package_events": [
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
    }
  ]
}
```

## Error 404

```sh
curl -s "$BASE/api/v1/events/1"
```

```json
{
  "error": "no such event"
}
```

## Error 400

```sh
curl -s "$BASE/api/v1/events/abc"
```

```json
{
  "error": "seq: expected a positive integer"
}
```
