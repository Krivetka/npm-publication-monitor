# API documentation

The REST API and the WebSocket stream of the npm Publication Monitor. The dashboard is built on
this API; a script or another service can use it in the same way.

| I want to… | Read |
|---|---|
| make the first request | [guides/getting-started.md](guides/getting-started.md) |
| get the alerts on my own dependencies | [guides/tutorial-dependency-alerts.md](guides/tutorial-dependency-alerts.md) |
| follow publications in real time | [guides/tutorial-live-feed.md](guides/tutorial-live-feed.md) |
| record a verdict on an alert (needs a token) | [guides/tutorial-verdicts.md](guides/tutorial-verdicts.md) |
| see how the API fits into the system | [architecture.md](architecture.md) |
| look up an endpoint | [reference/endpoints.md](reference/endpoints.md), or Swagger UI at `/npm/api/docs` |
| understand an error | [reference/errors.md](reference/errors.md) |
| know what changed | [CHANGELOG.md](CHANGELOG.md) |

## Structure of this folder

```
documentation/api/
├── README.md                 this page
├── architecture.md           context, request flow, resources
├── CHANGELOG.md              versions of the API
├── guides/                   getting started and three step-by-step tutorials
├── reference/                endpoints, authentication, errors, pagination, limits,
│                             versioning, the WebSocket protocol
├── examples/                 one file per operation: request, answer, error answers
└── schemas/openapi.json      the OpenAPI 3.1 document, as the server serves it
```

## Where the documentation is published

| Form | Where |
|---|---|
| Interactive reference (Swagger UI, "Try it out" works against the server) | `/npm/api/docs` on a running instance |
| OpenAPI 3.1 document | `/npm/api/v1/openapi.json` on a running instance; [schemas/openapi.json](schemas/openapi.json) in the repository |
| Guides, tutorials, reference pages | this folder (Markdown) |

To see the interactive reference on your machine, start the project as the
[README of the repository](../../README.md) describes and open
`http://127.0.0.1:8090/npm/api/docs`.

## Documentation strategy

**One source of truth.** The contract is a TypeScript object, `src/api/openapi.ts`. The server
serves it unchanged, Swagger UI renders it, and `schemas/openapi.json` is written from it by
`npm run api:spec`. A test fails when the file and the code differ, so the file cannot go stale.

**Examples are answers of the server.** `scripts/api-examples.mjs` calls every read operation
of a running instance, and the calls that must fail, and writes the answers into the
specification and into `examples/`. Long lists are cut to two or three items and account names
are replaced by labels; each example file says so. The answers behind the analyst token are
written by hand (see the gaps below). An example that no longer matches its schema fails a test.

**Checks that run with `npm test`** (`test/api-contract.test.ts`, `test/api.test.ts`):

- the specification file equals the document the server serves;
- the document is well-formed OpenAPI 3.1: unique operation ids, declared tags, declared path
  parameters, resolvable references, no OpenAPI 3.0 leftovers;
- every operation has a summary and a description; every response has a description;
- every JSON response and every request body has an example, and every example matches its schema;
- the write operations require the token and document the 401 answer;
- the examples hold no e-mail address and no account name.

`npm run api:lint` runs Redocly CLI over the file with the recommended rule set and the
additions of `redocly.yaml` (it needs network access to fetch the tool). Result of 24 November
2026: the description is valid, no error. The run gave four warnings of one rule,
`operation-4xx-response`, on the four operations that take no parameter and need no
credentials (`getStatus`, `getHealth`, `getPulse`, `listFeatureCatalogue`): they have no
client-error answer to document, so the rule is now switched off in `redocly.yaml` with this reason.

**Conventions.**

| Topic | Rule |
|---|---|
| Paths | plural nouns, lower case: `/events`, `/packages/{name}/events`; a query that needs a body is a `POST` on a noun (`/alerts/query`) |
| Fields | `snake_case`; times in ISO 8601, UTC; identifiers of events are the registry `seq` |
| Operation ids | `verbNoun` in camel case: `listEvents`, `getEvent`, `putFinding` |
| Schemas | `PascalCase` nouns: `Event`, `Stage2Summary`, `Finding` |
| Errors | one shape for all: `{"error": "<message>"}` |
| Versioning | the major version is in the path (`/api/v1`); see [reference/versioning.md](reference/versioning.md) |
| Files | lower case with hyphens; one topic per file; one example file per operation id |

## Known gaps

- The WebSocket protocol is described in prose and tables, not in a machine-readable form
  (AsyncAPI). The message bodies reuse the schemas of the OpenAPI document.
- The tests compare the specification with the contract in the code and with its examples.
  No test sends requests to a running server and compares its answers with the specification.
- There is no mock server and no public sandbox. "Try it out" in Swagger UI works against a
  running instance; the examples show what it answers.
- The 200 and 204 answers of the write operations and the 400, 404 and 413 answers behind the
  token are written by hand from the code, not captured: capturing them would write to the
  database. `examples/putFinding.md` and `examples/deleteFinding.md` say which part is which.
- The dashboard and the API are reachable only inside the deployment's network, so the
  interactive reference has no public address.
