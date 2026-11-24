# Tutorial: follow publications in real time

Polling `GET /events` every few seconds works, but the server already pushes every change.
This tutorial builds a client that prints alerts the moment stage 2 raises them and reads what
it missed when the connection drops.

You need a running instance with the pipeline started and Node.js 22 or newer (it has a
built-in `WebSocket`). No token is needed.

## The idea

The stream is at `ws://<host>/npm/api/v1/ws` (`wss://` behind TLS). The server sends JSON
messages and ignores anything the client sends. Five message types exist; the full protocol
is in [reference/websocket.md](../reference/websocket.md).

| `type` | When | Body |
|---|---|---|
| `hello` | once, right after the connection opens | `last_seq`: the newest event the server has sent to its clients |
| `event` | a new journal event | `event`: an `Event` whose stage results are still `null` |
| `stage1` | stage 1 found at least one feature on an event | `seq`, `stage1` |
| `stage2` | stage 2 enriched a candidate | `seq`, `stage2`; an alert has `stage2.alert = true` |
| `status` | every 10 seconds | `status`: the pipeline status |

A package becomes an alert in three messages: first `event`, about a second later `stage1`,
and about a minute later `stage2` (seven minutes or more when the queue of stage 2 is long). The minute is the settle time: the registry's CDN needs it
to serve the new version.

## Step 1. Connect and print alerts

```js
// live-alerts.mjs
const BASE = process.env.MONITOR_URL ?? 'http://127.0.0.1:8090/npm';
const WS = `${BASE.replace(/^http/, 'ws')}/api/v1/ws`;

const packages = new Map();          // seq → package name, from `event` messages
const printed = new Set();           // seq of the alerts already printed

function onMessage(msg) {
  if (msg.type === 'event') packages.set(msg.event.seq, msg.event.package);
  if (msg.type === 'stage2' && msg.stage2.alert && !printed.has(msg.seq)) {
    printed.add(msg.seq);
    const name = packages.get(msg.seq) ?? `seq ${msg.seq}`;
    const why = msg.stage2.features.map((f) => f.id).join(', ');
    console.log(`ALERT ${name}@${msg.stage2.versions.join(',')} score ${msg.stage2.final_score} [${why}] ${BASE}/event/${msg.seq}`);
  }
}

const ws = new WebSocket(WS);
ws.addEventListener('message', (e) => onMessage(JSON.parse(e.data)));
```

This works until the connection drops. After a reconnect the client would miss everything
that happened in between.

## Step 2. Remember where you are

Keep the highest `seq` you have processed:

```js
let lastSeq = 0;

function onMessage(msg) {
  if (msg.type === 'event') {
    packages.set(msg.event.seq, msg.event.package);
    lastSeq = Math.max(lastSeq, msg.event.seq);
  }
  // … stage2 as before
}
```

## Step 3. Fill the gap after a reconnect

Two things happen while the client is away. New events enter the journal. Stage 2 also finishes
events that the client saw before the drop, and those results are not sent again. So the client
reads two lists over REST: the events after its position, and the alerts of a range that starts
some way before its position. `after` returns events oldest first.

```js
const MARGIN = 2000;                 // about 30 minutes of events: stage 2 can still work on them

async function pages(filter, from, each) {
  let cursor = from;
  for (;;) {
    const res = await fetch(`${BASE}/api/v1/events?${filter}after=${cursor}&limit=500`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { items } = await res.json();
    for (const event of items) each(event);
    if (items.length < 500) return;  // the last page
    cursor = items.at(-1).seq;
  }
}

async function backfill() {
  const from = lastSeq;
  // 1. the events that came while the connection was down
  await pages('', from, (event) => onMessage({ type: 'event', event }));
  // 2. the alerts raised meanwhile, also on events seen before the drop
  await pages('alert=true&', Math.max(0, from - MARGIN), (event) => {
    packages.set(event.seq, event.package);
    onMessage({ type: 'stage2', seq: event.seq, stage2: event.stage2 });
  });
}
```

The set `printed` of step 1 keeps an alert from appearing twice.

## Step 4. Reconnect with back-off

Messages are handled one after another: a live message that arrives during the backfill waits
for its end, so the position never jumps over a gap.

```js
let attempt = 0;

async function handle(msg) {
  if (msg.type !== 'hello') return onMessage(msg);
  attempt = 0;
  if (lastSeq === 0) lastSeq = msg.last_seq;          // first start: begin from now
  else await backfill();                              // later: read what was missed
}

function connect() {
  const ws = new WebSocket(WS);
  let chain = Promise.resolve();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    chain = chain.then(() => handle(msg)).catch((err) => {
      console.error(err);                             // a failed backfill: reconnect and try again
      ws.close();
    });
  });
  ws.addEventListener('close', () => {
    const delay = Math.min(30_000, 1000 * 2 ** attempt++) * (0.5 + Math.random() / 2);
    setTimeout(connect, delay);
  });
  ws.addEventListener('error', () => ws.close());
}
connect();
```

The delay doubles up to 30 seconds and is randomised, so many clients do not reconnect at the
same moment after a restart of the server.

## Step 5. Run it

```sh
MONITOR_URL=http://127.0.0.1:8090/npm node live-alerts.mjs
```

```
ALERT dsh-project-recall@1.4.2 score 4.5 [publisher_recent, repo_missing] http://127.0.0.1:8090/npm/event/147217305
```

To test the gap handling, stop the web process for a minute and start it again: the client
reconnects, reads `hello`, fetches the missed events and prints the alerts among them.

**The limit.** An alert is missed in one case: stage 2 finishes an event more than `MARGIN`
events after it, and the client is disconnected at that moment. A client that must not miss
any alert reads `GET /events?alert=true` from time to time and compares.

## Things to know

- **Order.** Messages of one event arrive in the order `event`, `stage1`, `stage2`. Messages
  of different events interleave.
- **Volume.** About one `event` message a second; a browser tab or a script handles it easily.
  Keep the `packages` map bounded in a long-running process (drop entries older than an hour).
- **Limits.** The server accepts up to 50 connections and answers 503 to the next one; it
  pings every 30 seconds and drops a client that does not answer. The built-in `WebSocket`
  answers pings by itself.
- **Shutdown.** On a restart the server closes with code 1001; reconnect as in step 4.
