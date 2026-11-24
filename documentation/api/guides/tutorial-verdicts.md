# Tutorial: record analyst verdicts

A verdict is the judgement of an analyst on an alert: confirmed, false positive or undecided.
Verdicts are the ground truth of the evaluation, and they are the only thing the API lets a
client write. This tutorial authenticates, records a verdict, changes it and removes it.

You need a running instance and the analyst token of that instance.

## Step 1. Get the token

The token is the value of `ANALYST_TOKEN` in the `.env` of the server. For a local instance,
choose one and restart the web process:

```sh
TOKEN=$(openssl rand -hex 24)
echo "ANALYST_TOKEN=$TOKEN" >> .env      # the last line with this name wins
node --env-file=.env src/web/main.ts
```

Keep it out of scripts and shell history:

```sh
BASE=http://127.0.0.1:8090/npm
read -rs TOKEN          # for a token you did not just make: paste it; nothing is echoed
```

When the server has no `ANALYST_TOKEN`, every write answers 401: writing is switched off.
Details are in [reference/authentication.md](../reference/authentication.md).

## Step 2. Pick an alert

```sh
curl -s "$BASE/api/v1/events?alert=true&limit=1"
```

Take `items[0].seq` from the answer:

```sh
SEQ=147217305
```

## Step 3. Record the verdict

```sh
curl -s -X PUT "$BASE/api/v1/events/$SEQ/finding" \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"verdict":"false_positive","note":"nightly build from the project CI"}'
```

```json
{
  "seq": 147217305,
  "verdict": "false_positive",
  "note": "nightly build from the project CI",
  "decided_at": "2026-11-24T15:20:03.417Z"
}
```

| Field of the body | Rule |
|---|---|
| `verdict` | required: `confirmed`, `false_positive` or `undecided` |
| `note` | optional, up to 2 000 characters: why this verdict |
| `reference` | optional, up to 500 characters: an advisory or a write-up that confirms it |

From now on `GET /events`, the event card and the dashboard show this verdict with the event.

## Step 4. Change it

Send the request again with another body. One event has one verdict; `PUT` replaces it:

```sh
curl -s -X PUT "$BASE/api/v1/events/$SEQ/finding" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"verdict":"confirmed","note":"removed by the registry","reference":"GHSA-xxxx-xxxx-xxxx"}'
```

The call is idempotent: the same body twice leaves the same verdict. This makes a retry after
a timeout safe. The database keeps every earlier value in an audit table, so a changed verdict
is not lost for the evaluation.

## Step 5. Read verdicts back

```sh
curl -s "$BASE/api/v1/findings?verdict=confirmed"
```

The answer is the list of verdicts, newest first. Reading needs no token.

## Step 6. Remove a verdict

```sh
curl -s -i -X DELETE "$BASE/api/v1/events/$SEQ/finding" -H "authorization: Bearer $TOKEN"
```

```
HTTP/1.1 204 No Content
```

## What can go wrong

| Answer | Cause | What to do |
|---|---|---|
| `401 {"error":"analyst token required"}` | no `authorization` header, a wrong token, or the server has no token set | check the header; ask the operator for the token |
| `400 {"error":"verdict must be one of confirmed, false_positive, undecided"}` | a misspelled verdict | fix the body |
| `400 {"error":"note is longer than 2000 characters"}` | the note is too long | shorten it; put the long text behind `reference` |
| `400 {"error":"body is not valid JSON"}` | broken JSON, often shell quoting | send the body from a file: `-d @verdict.json` |
| `404 {"error":"no such event"}` | no journal event has this `seq` | take `seq` from `GET /events` |
| `413 {"error":"body too large"}` | a body over 16 KB | a verdict never needs that much |

## Recording many verdicts

Verdicts prepared in a file can be loaded in a loop; the calls are independent, so a failed
one can be repeated alone:

```sh
# verdicts.tsv: seq <TAB> verdict <TAB> note
while IFS=$'\t' read -r seq verdict note; do
  jq -n --arg v "$verdict" --arg n "$note" '{verdict:$v, note:$n}' |
    curl -s -o /dev/null -w "$seq %{http_code}\n" -X PUT "$BASE/api/v1/events/$seq/finding" \
      -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d @-
done < verdicts.tsv
```
