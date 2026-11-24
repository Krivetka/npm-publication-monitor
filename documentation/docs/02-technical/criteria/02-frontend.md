# Criterion 2 — Front-end

## Context

An analyst wants the stream now — a live feed and a card that explains a score; a researcher wants statistics over days. A page may stay open for a day, so the live list must stay smooth with tens of thousands of rows.

## Decision

A single-page application built with Preact 11 and htm. In development the modules run unbundled through an import map; for production esbuild bundles them with one chunk per route. Pages ask two services (`api.js`, `ws.js`) for data and pass it to presentational components; shared state lives in four small stores, not in a state library. On connect the WebSocket sends `hello` with the newest `seq`; the client backfills with `GET /events?after=` and applies stage messages in place, so the stream has no gaps. The live feed is virtualised: fixed row height, only visible rows rendered, a banner buffering arrivals while the reader is paused. Forms validate before they send; an error boundary, one observer of failed requests and toasts handle errors; every asynchronous block has a skeleton.

## Alternatives

| Alternative | Why rejected |
|---|---|
| Server-rendered pages (the first version) | no live or in-place updates; a 50 000-row feed cannot be a static table |
| React, Redux | the same model at ten times the runtime weight; one writer per store needs no library |

## Consequences

The first load is 84 KB (30 KB gzipped) in a bundle built in under a second. Virtualisation makes the feed O(visible rows) at the price of a fixed row height.

## Key decisions

- SPA over REST + WebSocket with a gap-free resume protocol.
- Virtualised live feed; pause and buffering instead of jumping rows.
- Preact + htm; esbuild bundle with lazy routes; strict CSP.

## Structure

![Live feed with virtualised list](../../assets/images/feed.png)

## Requirements compliance checklist

Table: Front-end criterion checklist

| Requirement | Status | Where |
|---|---|---|
| SPA, bundler, lazy routes | done | `app.js`, `scripts/build-web.mjs` |
| Components, pages, services | done | `documentation/frontend/` |
| Real-time feed, list virtualisation | done | `ws.js`, `virtual-list.js` |
| Forms with validation | done | `forms.js`, `verdict-form.js` |
| Error handling, loading states | done | `errors.js`, skeletons |
| Component and end-to-end tests | done | `test/client-*.test.ts`, `test/e2e/` |
