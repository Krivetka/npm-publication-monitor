# Errors

## Shape

Every error answer is JSON with one field:

```json
{ "error": "limit: must be >= 1" }
```

The message is written for a developer. When a parameter is wrong, the message starts with its
name. The HTTP status code says which class of problem it is; a client should branch on the
status code, not on the text of the message.

## Status codes

| Code | Meaning | Typical cause | What the client should do |
|---|---|---|---|
| 200 | OK | | |
| 204 | No content | a verdict was removed | |
| 400 | Bad request | a parameter or the body failed validation | fix the request; a retry gives the same answer |
| 401 | Unauthorised | a write without the analyst token, or with a wrong one | send `Authorization: Bearer <token>` |
| 404 | Not found | no event with this `seq`; no journal events for this package; an unknown path | check the identifier |
| 405 | Method not allowed | a method the path does not have, for example `GET /alerts/query`; any method other than GET on an unknown path. `/alerts/query` and `/events/{seq}/finding` also send an `Allow` header | use the method of the reference |
| 413 | Payload too large | a body over 16 KB (verdict) or 512 KB (package list) | send less |
| 500 | Internal error | a failure inside the server, for example the database is away | retry with back-off; if it stays, read the server log |
| 503 | Service unavailable | only from `GET /health`: the pipeline is behind. The body is a `Health` object, not an `Error` | alert the operator |

## Messages by cause

Validation errors (400):

| Message | Cause |
|---|---|
| `<name>: expected an integer` | a query parameter that must be a whole number is not one |
| `<name>: must be >= <n>`, `<name>: must be <= <n>` | out of range: `limit` is 1–500, `hours` is 1–720 |
| `<name>: out of range` | a number too large to be exact |
| `<name>: expected a number` | `min_score` is not a number |
| `<name>: expected true or false` | a boolean filter got another value (`true`, `false`, `1`, `0` are accepted) |
| `<name>: too long` | a string parameter over its limit |
| `before and after are mutually exclusive` | both cursors in one request |
| `seq: expected a positive integer` | the path segment of an event is not a number |
| `invalid package name` | the name in the path is not a valid npm name (lower case, at most 214 characters) |
| `invalid verdict` | `GET /findings?verdict=` got an unknown value |
| `empty body`, `body is not valid JSON`, `body must be a JSON object` | a write without a usable body |
| `verdict must be one of confirmed, false_positive, undecided` | a wrong or missing `verdict` |
| `note must be a string`, `note is longer than 2000 characters`, `reference is longer than 500 characters` | fields of a verdict |
| `packages must be a non-empty array of package names` | `POST /alerts/query` without names |
| `packages: at most 10000 names` | too many names |
| `packages: every name must be a string of 1 to 214 characters` | a wrong element in the list |
| `days must be an integer from 1 to 90` | a wrong period |

Other errors:

| Status and message | Cause |
|---|---|
| `401 analyst token required` | see [authentication](authentication.md) |
| `404 no such event` | `seq` is not in the journal |
| `404 no events for this package in the journal` | the package has not published since the journal began, or the name is misspelled |
| `404 no such endpoint` | an unknown path under `/api/v1` |
| `405 method not allowed` | the path has no such method, or the path is unknown and the method is not GET |
| `413 body too large` | see the limits in [limits.md](limits.md) |
| `500 internal error` | the detail is in the server log, never in the answer |

## Empty is not an error

A list endpoint with nothing to return answers 200 with an empty list:
`GET /events?package=…` gives `{"items":[],"next_before":null}`, and
`GET /packages/{name}/maintainers` gives `[]` for a package that was never enriched.
`GET /packages/{name}/events` is the exception: it answers 404, because the dashboard uses it
as the search and must tell "no such package in the journal" from "no events on this page".

## Retrying

| Answer | Retry? |
|---|---|
| 400, 401, 404, 405, 413 | no: the same request gives the same answer |
| 500, a network error, a timeout | yes, with exponential back-off and jitter |
| `PUT` and `DELETE` of a verdict | safe to retry: both are idempotent |
| `POST /alerts/query` | safe to retry: it reads only |

Captured error answers of every operation are in [`../examples/`](../examples/).
