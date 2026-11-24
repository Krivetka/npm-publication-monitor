# Criterion 3 — Adaptive UI (web / mobile)

## Context

An analyst who receives an alert often opens it on a phone, and the two pages that matter there are the densest: a feed row carries time, package, chips, a score meter and a verdict; a card a score bar, a timeline and three tables.

## Decision

One responsive layout driven by design tokens and media queries, no separate mobile build. Every length is in `rem`; only hairlines stay in `px`. On a phone (≤ 760 px) the main navigation moves to a bar at the bottom edge, feed rows take two lines and every table scrolls inside its own panel; a tablet (761–1100 px) keeps the header navigation and two-column grids; large screens (≥ 1800 px) get a wider content column. On a touch screen every link, button and field is at least 44 px. The viewer can choose a light or dark palette and a text size up to 125 %; the layout scales with it. Alert states never rely on colour alone.

## Alternatives

| Alternative | Why rejected |
|---|---|
| A CSS framework | the design system is forty tokens and twenty components in one stylesheet |
| Hiding columns on mobile | the chips and the score are the information; rows wrap instead |

## Consequences

The layout is checked by a script, not by eye alone: ten pages at nine sizes (phone, tablet and desktop, both orientations, 200 % zoom, 4K) show no horizontal page scroll, the navigation in view and no touch target under 44 px. The contrast of every text colour on its background is at least 4.6:1 in both palettes.

## Key decisions

- One layout; breakpoints on width, height, orientation and pointer type, no device detection.
- Relative units everywhere; the fixed row height of the virtualised feed follows the root font size.

## Structure

![Overview and event card at 390 px](../../assets/images/phone.png)

## Requirements compliance checklist

Table: Adaptive UI criterion checklist

| Requirement | Status | Where |
|---|---|---|
| Phone, tablet, desktop; orientation; zoom | done | `documentation/adaptive-ui/`, `scripts/ui-audit.mjs` |
| Relative units, responsive grid, no overlap | done | `styles.css` |
| Navigation on every device | done | header; bottom bar on a phone |
| Touch targets ≥ 44 px | done | audit: none smaller |
| Contrast ≥ 4.5:1 | done | `scripts/ui-contrast.mjs` |
| Mock-ups, component library | done as PDF and live page | `mockups.pdf`, `/npm/static/kit.html` |
