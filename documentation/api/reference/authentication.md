# Authentication and authorisation

## Who may do what

| Action | Credentials |
|---|---|
| every `GET`, `POST /alerts/query`, the WebSocket stream | none |
| `PUT /events/{seq}/finding`, `DELETE /events/{seq}/finding` | the analyst token |

Reading is open **inside the deployment**: the dashboard and the API are served on the loopback
interface and published only into the private network of the deployment. The API has no public
address and no user accounts. The single secret protects the single thing a client can change,
the analyst verdicts.

## The token

The token is one shared secret, the value of `ANALYST_TOKEN` in the environment of the web
process. Send it as a bearer token:

```
Authorization: Bearer <token>
```

```sh
curl -s -X PUT "$BASE/api/v1/events/147217305/finding" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"verdict":"undecided"}'
```

| Situation | Answer |
|---|---|
| no `Authorization` header | `401 {"error":"analyst token required"}` |
| a header that is not `Bearer <token>` | 401, same message |
| a wrong token | 401, same message |
| the server has no `ANALYST_TOKEN` | 401 for every write: writing is switched off |

The four situations give the same status on purpose, and the first three the same message: the answer does not tell a caller which
part was wrong. The comparison takes the same time for every wrong token of the right length
(`crypto.timingSafeEqual`).

## Handling the token

- Generate it with a random source: `openssl rand -hex 24`.
- It lives only in `.env` on the server (file mode 600). It is not in the repository, not in
  the container image and not in the logs.
- In a browser the dashboard keeps it in `localStorage` of that browser, after the analyst
  typed it once. Do not use the dashboard with the token on a shared computer.
- In a script, read it from the environment or from a prompt. Do not put it on the command
  line of a shared machine: other users can read process arguments.
- To revoke it, change `ANALYST_TOKEN` and restart the web process. There is one token, so a
  change revokes it for everybody.
- Use TLS when the API leaves the loopback interface. The bearer token is sent in clear text
  inside the HTTP request.

## Inside the server

The token decides only whether the request reaches the database. The database enforces the
rest: the web process connects with the role `npm_monitor_web`, which can read the results and
write only the table of verdicts. It cannot change the journal or the stage results, and every
change of a verdict is copied to an audit table by a trigger.

## Limits of this scheme

One shared token does not tell analysts apart: a verdict does not record who gave it. It fits
a deployment with one or two analysts. Per-user credentials are out of the scope of the project.
