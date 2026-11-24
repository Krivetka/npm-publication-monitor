# Versioning

## The rule

The major version of the API is in the path: `/npm/api/v1`. The full version is in
`info.version` of the OpenAPI document and follows semantic versioning.

| Change | Version | What a client must do |
|---|---|---|
| a new endpoint, a new optional parameter, a new field in an answer, a new feature id, a new message type on the WebSocket | minor (1.**x**.0) | nothing |
| a correction of the documentation or of an example | patch (1.0.**x**) | nothing |
| a removed or renamed endpoint, parameter or field; a changed type; a changed meaning; a new required parameter | major: a new path `/api/v2` | migrate; `/api/v1` keeps working during the transition |

## What a client may rely on

- Fields documented in the schemas keep their names, types and meaning inside `v1`.
- New fields can appear in any object. **Ignore fields you do not know.**
- New values can appear in open lists: feature ids, `lane`, the `type` of a WebSocket message.
  **Ignore values you do not know.** The closed lists are the verdict (`confirmed`,
  `false_positive`, `undecided`) and the event `kind`.
- Error messages are for people. Branch on the status code, not on the text.
- The weights and thresholds behind a score can change with a calibration. Every stage result
  carries the id of the engine that produced it (`engine`: parameter version and a hash), so
  results of different calibrations can be told apart.

## Deprecation

An endpoint that will go away is marked `deprecated: true` in the OpenAPI document for at
least one minor version, with the replacement named in its description and in the
[changelog](../CHANGELOG.md). Nothing is deprecated in 1.1.0.

## Versions of the documentation

The specification file in the repository is written from the code and checked by a test, so
the documentation of a commit always describes the API of that commit. The changelog lists
what changed between versions.
