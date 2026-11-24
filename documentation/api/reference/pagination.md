# Pagination

Lists of events are paged with a cursor on `seq`, the sequence number of the registry's change
feed. `seq` only grows, so a cursor stays valid while new events arrive: a page never shifts
under the reader, which happens with page numbers on a list that grows every second.

## Parameters

| Parameter | Meaning |
|---|---|
| `limit` | events per page, 1–500. Default 100 for `GET /events`, 200 for `GET /packages/{name}/events` |
| `before` | return events with `seq` **below** this value, newest first |
| `after` | return events with `seq` **above** this value, oldest first |

`before` and `after` cannot be combined (400). Without either, the newest events come first.

## Reading backwards (history)

The answer carries the cursor of the next page:

```json
{ "items": [ … ], "next_before": 147201118 }
```

Pass it as `before`. `next_before` is `null` on the last page.

```js
async function* allAlerts(base) {
  let before;
  do {
    const url = new URL(`${base}/api/v1/events`);
    url.searchParams.set('alert', 'true');
    url.searchParams.set('limit', '500');
    if (before !== undefined) url.searchParams.set('before', before);
    const page = await (await fetch(url)).json();
    yield* page.items;
    before = page.next_before;
  } while (before !== null);
}
```

Filters apply before paging: `alert=true&limit=500` gives 500 alerts, not the alerts among
500 events.

## Reading forwards (catching up)

To process everything since a known position, use `after`. The order is oldest first, and
`next_before` is `null`: ask again with the highest `seq` you received, until a page is empty.

```sh
curl -s "$BASE/api/v1/events?after=147217305&limit=500"
```

This is how a WebSocket client fills the gap after a reconnect; see the
[live feed tutorial](../guides/tutorial-live-feed.md).

## Endpoints without a cursor

| Endpoint | Bound |
|---|---|
| `POST /alerts/query` | at most 500 alerts of the period; narrow `days` or the list for more detail |
| `GET /findings` | all verdicts; the list is small by nature |
| `GET /stats/*` | bounded by `hours` (1–720) |
| `GET /packages/{name}/events` | the newest `limit` events, no cursor |
