# WebSocket stream

The stream pushes every change of the journal and of the stage results as it is committed to
the database. It is read-only.

| | |
|---|---|
| Address | `ws://<host>/npm/api/v1/ws` (`wss://` behind TLS) |
| Credentials | none |
| Direction | server to client; messages from the client are ignored |
| Format | one JSON object per text frame |
| Connections | up to 50; the next upgrade request gets `503 Service Unavailable` |
| Keep-alive | the server pings every 30 s and drops a client that did not answer the previous ping |
| Shutdown | the server closes with code 1001 (`server shutting down`) |

## Messages

Every message has a `type`. Bodies reuse the schemas of the OpenAPI document.

### `hello`

The first message after the connection opens.

```json
{ "type": "hello", "last_seq": 147233999 }
```

`last_seq` is the newest event the server has broadcast. A client that knows an older position
fetches the difference with `GET /events?after=<its position>`.

### `event`

A new journal event. The stage results are `null`; they arrive in later messages.

```json
{ "type": "event", "event": { "seq": 147234003, "package": "playwright-core", "rev": "5731-…", "deleted": false,
  "observed_at": "2026-11-24T15:02:11.118Z", "observed_after": "2026-11-24T15:02:06.007Z",
  "stage1": null, "stage2": null, "finding": null } }
```

### `stage1`

Stage 1 found at least one feature on an event. Events without a feature get no message.

```json
{ "type": "stage1", "seq": 147234003, "stage1": { "prescore": 2, "candidate": true,
  "features": [ { "id": "rate_package", "lane": "temporal", "weight": 2, "value": 2.83, "threshold": 2.5 } ],
  "engine": "v3:a566433d@2026-11-24" } }
```

### `stage2`

Stage 2 enriched a candidate, about a minute after the event. `alert` is the decision.

```json
{ "type": "stage2", "seq": 147234003, "stage2": { "kind": "publish", "versions": ["1.61.0"], "prescore": 2,
  "final_score": 4.5, "alert": true, "features": [ … ], "enriched_at": "2026-11-24T15:03:14.902Z", "engine": "v6:49ba8745" } }
```

### `status`

The pipeline status, every 10 seconds: the same object as `GET /status`.

```json
{ "type": "status", "status": { "now": "2026-11-24T15:02:20.000Z", "collector": { "lag": 0, … }, … } }
```

## Sequence of one publication

```
registry            collector        stage 1          stage 2          client
   │  new version       │               │                │               │
   ├───────────────────►│ journal row   │                │               │
   │                    ├──────────────────────────────────────────────►│ event
   │                    │               │ features       │               │
   │                    │               ├───────────────────────────────►│ stage1   (≈ 1 s)
   │                    │               │                │ settle 60 s,  │
   │                    │               │                │ sources       │
   │                    │               │                ├──────────────►│ stage2   (≈ 65 s)
```

The measured delay from the event to an alert in production: median 65 s, 99 % within ten
minutes.

## Guarantees

| Property | Guarantee |
|---|---|
| Order within one event | `event`, then `stage1`, then `stage2` |
| Order between events | `event` messages arrive in `seq` order; stage messages of different events interleave |
| Delivery | at most once per connection: a message sent while the client is disconnected is not repeated |
| Completeness | by the client: after a reconnect, read over REST the events after your position and the alerts raised meanwhile (a stage result of an earlier event is not sent again). The [tutorial](../guides/tutorial-live-feed.md) shows the code and its limit |
| Volume | about one `event` a second, about 2.5 % of the events get a `stage1` message with the candidate flag, about 34 `stage2` messages a day are alerts |

## Client rules

1. Reconnect with exponential back-off and jitter (1 s doubling to 30 s).
2. On every `hello`, fill the gap from your last `seq`.
3. Ignore message types you do not know: new ones can be added in a minor version.
4. Do not send anything; a frame over 1 KB closes the connection.
