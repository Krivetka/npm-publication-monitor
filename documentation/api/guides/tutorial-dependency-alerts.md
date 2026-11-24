# Tutorial: alerts on your own dependencies

The registry gets about 100 000 publications a day and the monitor raises about 34 alerts a
day over all of them. A team needs only the alerts on the packages it installs. This tutorial
builds a small script that reads a `package-lock.json`, asks the monitor for the alerts on
exactly these packages, and fails a CI job when there is a new one.

You need a running instance ([getting started](getting-started.md)) and Node.js 20 or newer.
No token is needed: the request only reads.

## Step 1. Collect the package names

A lock file of version 2 or 3 lists every installed package under `packages`, keyed by its
path in `node_modules`:

```js
// alerts-on-my-deps.mjs
import { readFileSync } from 'node:fs';

const lock = JSON.parse(readFileSync(process.argv[2] ?? 'package-lock.json', 'utf8'));
const names = new Set();
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (path === '' || entry.link) continue;                           // the project itself, workspace links
  names.add(entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 13));
}
console.log(`${names.size} packages in the lock file`);
```

Only the names leave your machine. Versions, paths and the rest of the file stay local, and
the monitor does not store the list.

## Step 2. Ask for the alerts

The list can hold thousands of names, so it travels in the body of a `POST`. The request does
not change anything on the server.

```js
const BASE = process.env.MONITOR_URL ?? 'http://127.0.0.1:8090/npm';

const res = await fetch(`${BASE}/api/v1/alerts/query`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ packages: [...names], days: 14 }),
});
if (!res.ok) {
  const { error } = await res.json();
  throw new Error(`monitor answered ${res.status}: ${error}`);
}
const { packages, days, items } = await res.json();
```

| Field of the answer | Meaning |
|---|---|
| `packages` | how many distinct names the server received |
| `days` | one entry per day of the period, oldest first: `{ "day": "2026-11-23", "alerts": 1 }` |
| `items` | the alerts of the period, newest first, at most 500; each is an [`Event`](../reference/endpoints.md#schemas) |

Limits: 1 to 10 000 names, each up to 214 characters; `days` from 1 to 90 (default 14); a body
up to 512 KB. Outside these limits the server answers 400 or 413 with a message that names
the problem.

## Step 3. Show what needs a look

An alert that an analyst has already judged a false positive needs no second look:

```js
const open = items.filter((e) => e.finding?.verdict !== 'false_positive');

for (const e of open) {
  const why = e.stage2.features.map((f) => f.id).join(', ');
  console.log(`${e.observed_at}  ${e.package}@${e.stage2.versions.join(',')}  score ${e.stage2.final_score}  [${why}]`);
  console.log(`  ${BASE}/event/${e.seq}`);
}
const total = days.reduce((sum, d) => sum + d.alerts, 0);
console.log(`${total} alerts in ${days.length} days on ${packages} packages; ${open.length} to review`);
```

Example output for a project with 1 523 dependencies:

```
2026-11-13T08:07:21.000Z  @openai/codex@0.171.0-alpha.2  score 5  [size_jump, files_jump, deps_added]
  http://127.0.0.1:8090/npm/event/144294547
1 alerts in 14 days on 1523 packages; 1 to review
```

The link opens the event card, where the evidence is.

## Step 4. Fail the job on a new alert

Keep the highest `seq` you have seen and compare on the next run. `seq` only grows, so it is a
safe bookmark:

```js
import { existsSync, writeFileSync } from 'node:fs';

const STATE = '.monitor-last-seq';
const last = existsSync(STATE) ? Number(readFileSync(STATE, 'utf8')) : 0;
const fresh = open.filter((e) => e.seq > last);
if (items.length > 0) writeFileSync(STATE, String(Math.max(last, ...items.map((e) => e.seq))));

if (fresh.length > 0) {
  console.error(`${fresh.length} new alert(s) on your dependencies`);
  process.exit(1);
}
```

Run it:

```sh
MONITOR_URL=http://127.0.0.1:8090/npm node alerts-on-my-deps.mjs package-lock.json
```

## What you built

- a request that sends package names only and reads only;
- a review list that honours analyst verdicts;
- a check that fails once per new alert, not once per run.

The dashboard page **My dependencies** does the same in the browser. An alert is a signal for
review with its evidence, not a statement that a package is malicious: in a random sample of
120 alerts an analyst confirmed 5 %.
