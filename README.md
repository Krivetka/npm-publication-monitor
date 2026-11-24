# npm Publication Monitor — adaptive UI

This branch holds the material of the Adaptive UI criterion only. The code of the project is on
the branch [main](https://github.com/Krivetka/npm-publication-monitor/tree/main); the paths that start with src/ and scripts/ on this page are paths of that branch.

The dashboard of the npm Publication Monitor on a phone, a tablet and a desktop: what is
attached, how the layout adapts, and how each requirement of the criterion was checked.

## What is attached

| Item | Where |
|---|---|
| Layouts for three devices and the component library, as one PDF | [mockups.pdf](mockups.pdf) |
| Component library with states, live (uses the stylesheet of the application) | `/npm/static/kit.html` on a running instance; source `src/web/static/kit.html` |
| Screenshots of the main screens on a phone, a tablet and a desktop | [screens/](screens/), index below |
| Source of the interface | `src/web/static/` — `styles.css` (design tokens, layout), `views/`, `layout.js`, `prefs.js` |
| The checks behind this page | `scripts/ui-audit.mjs`, `scripts/ui-contrast.mjs`; results in [audit.json](audit.json) |
| How to run the project | [README of the main branch](https://github.com/Krivetka/npm-publication-monitor/tree/main#running); short form below |

The layouts in the PDF are rendered from the implemented design system, not drawn in Figma:
the design tokens and components live in one stylesheet, and the component library page shows
them with that stylesheet, so the mock-up and the product cannot differ. An early interactive
mock-up of the dashboard preceded the implementation; it is shown at the defence.

To see the interface yourself:

```sh
git clone https://github.com/Krivetka/npm-publication-monitor.git && cd npm-publication-monitor
docker compose -f compose.dev.yml up -d && cp .env.example .env
npm ci && npm run migrate && npm run db:seed
node --env-file=.env src/web/main.ts          # http://127.0.0.1:8090/npm/
```

## Three devices, both orientations

One responsive layout, no separate mobile build and no device detection by user agent. The
layout is rebuilt by media queries on the width, the height, the orientation and the kind of
pointer.

| Device | Viewport tested | What the layout does |
|---|---|---|
| Phone, portrait | 390 × 844, 320 × 568 | one column; **the main navigation moves to a bar at the bottom edge**, in reach of the thumb; the search field takes the full width; feed rows have two lines; tables scroll inside their panels |
| Phone, landscape | 844 × 390 | the header and the hero shrink, so the content starts higher; the feed is then part of the page and scrolls with it |
| Tablet, portrait and landscape | 768 × 1024, 1024 × 768 | navigation in the header, search on its own row; two-column grids for tiles and charts; the feed keeps its one-line rows with narrower fixed columns |
| Desktop | 1440 × 900 | navigation and search in one header row; content up to 1240 px wide; charts and tables side by side |
| Large screen | 2560 × 1440 | the content width grows to 1600 px (from 1800 px) and 1888 px (from 2400 px); text lines keep a readable length. Only 2560 × 1440 was tested; 3840 × 2160 and ultrawide ratios were not |

Breakpoints (`src/web/static/styles.css`):

| Condition | Meaning |
|---|---|
| `max-width: 360px` | very small phones and split view: tighter gutters, one funnel step per row |
| `max-width: 760px` | phone: one column, bottom navigation, two-line feed rows |
| `min-width: 761px and max-width: 1100px` | tablet |
| `min-width: 1800px`, `min-width: 2400px` | large and ultrawide screens |
| `orientation: landscape and max-height: 480px` | a phone held sideways |
| `pointer: coarse` | a touch screen of any size: every link in a table or a feed row becomes a 44 px target |
| `prefers-color-scheme: dark`, `prefers-reduced-motion: reduce` | system settings of the viewer |

The feed is a virtualised list with a fixed row height. The height is set in rem in the
stylesheet, and the script reads the same value in pixels from the root font size, and reads it again
when a breakpoint is crossed (a rotation, a resized window), so the list stays exact.

## Relative units, zoom, text size

- The lengths of the stylesheet are in `rem`: font sizes, paddings, gaps, widths, heights,
  radii, and the side of every icon. In `px` stay hairlines (1 px and 2 px borders and gaps, the
  focus ring) and the breakpoints of the media queries; a few sizes use `vh`, `vw` and `ch`
  where they follow the window or the text. The root font size is `100%`, the size the browser
  or the viewer chose.
- **Browser zoom.** At 200 % a 1440 px window has 720 CSS pixels: the phone layout applies and
  nothing is cut. Checked as its own viewport.
- **Text size.** The viewer can choose 100 %, 112.5 % or 125 % in the footer of the dashboard.
  Because the lengths are relative, the whole layout scales with the text. Checked at 125 % on
  the desktop size.
- **No horizontal scroll of the page** at any tested size: wide content (tables, the version
  timeline) scrolls inside its own panel.

## Visual consistency

**Design system.** Sixty colour tokens in each of two palettes and about twenty components,
all in `styles.css`. Font sizes and spacing use a small set of rem values; they are not
tokens. The component library page shows the components with their states: default, focus,
selected or pressed, disabled; hover is shown for pills and links.

**Colour.** Blue marks data, red marks alerts only. A state never relies on colour alone: an
alert has an icon and the word "alert", a selected pill has a filled background and
`aria-current`. The palette is the same on every device.

**Light and dark theme.** A screen is light as a whole or dark as a whole. The page follows
the system setting; the viewer can force light or
dark in the footer. The dark palette is chosen separately, it is not an inversion. The choice
is applied by a small script in `<head>` before the first paint, so a stored theme never flashes.

**Typography.** IBM Plex Sans for text, IBM Plex Mono for numbers and identifiers, on every
device. Sizes scale with the root font size.

**Images.** Every icon and every chart is inline SVG, so they stay sharp at any pixel density
(checked at device pixel ratios 1, 2 and 3). The interface has no bitmap images.

### Text contrast (WCAG 2.1, level AA: at least 4.5:1)

Computed by `scripts/ui-contrast.mjs` from the design tokens, for the pairs of text colour and
background listed below, the placeholder text of the fields included. In the token names
"band" is the top area of a page: the header and the block with the page title.

<!-- contrast -->
| Text | Background | Used for | Light | Dark |
|---|---|---|---|---|
| `ink` | `bg` | body text on the page | 16.4:1 | 16.0:1 |
| `ink` | `panel` | text in panels and tables | 17.7:1 | 14.8:1 |
| `ink-2` | `panel` | secondary text, table headers | 8.4:1 | 9.5:1 |
| `ink-3` | `panel` | muted text, notes | 5.3:1 | 5.9:1 |
| `ink-3` | `bg` | muted text on the page, footer | 4.9:1 | 6.4:1 |
| `ink` | `chip` | feature chips | 15.4:1 | 12.5:1 |
| `ink-2` | `chip` | values inside chips, code | 7.3:1 | 8.0:1 |
| `link` | `panel` | links in panels | 5.9:1 | 7.6:1 |
| `link` | `bg` | links on the page | 5.5:1 | 8.2:1 |
| `good` | `panel` | state "ok", verdict "not an alert" | 6.6:1 | 9.1:1 |
| `good` | `good-bg` | banner of new events | 6.0:1 | 7.2:1 |
| `warn` | `panel` | state "warning" | 5.9:1 | 9.3:1 |
| `bad` | `panel` | state "bad", verdict "alert" | 7.2:1 | 8.5:1 |
| `bad` | `bad-bg` | error box, alert row of the feed | 6.3:1 | 7.6:1 |
| `ink` | `bad-bg` | text of an alert row | 15.6:1 | 13.3:1 |
| `band-ink` | `band` | text in the band (header and hero) | 17.7:1 | 17.7:1 |
| `band-ink-2` | `band` | lead text in the band | 8.4:1 | 9.6:1 |
| `band-ink-3` | `band` | muted text in the band | 5.3:1 | 5.4:1 |
| `band-link` | `band` | links in the band | 5.9:1 | 10.7:1 |
| `band-tab` | `band` | navigation, inactive tab | 8.4:1 | 11.3:1 |
| `band-strong` | `band` | navigation, active tab; headings | 17.7:1 | 19.2:1 |
| `band-soft` | `band` | filter pills | 12.6:1 | 15.1:1 |
| `on-accent` | `band-accent` | selected filter pill | 5.9:1 | 7.1:1 |
| `band-ink` | `band-2` | pulse panel | 16.4:1 | 16.3:1 |
| `band-ink-2` | `band-2` | pulse panel, secondary | 7.8:1 | 8.8:1 |
| `band-ink` | `band-input` | search field | 16.4:1 | 14.2:1 |
| `band-placeholder` | `band-input` | placeholder of the search field | 4.9:1 | 5.9:1 |
| `ink-3` | `bg` | placeholder of a field on the page | 4.9:1 | 6.4:1 |
| `band-ink-3` | `band-2` | pulse panel, axis labels | 4.9:1 | 4.9:1 |
| `band-err` | `band` | error under the search field | 7.2:1 | 11.3:1 |
| `pill-ok` | `pill-ok-bg` | state pill "ok" | 6.0:1 | 8.4:1 |
| `pill-warn` | `pill-warn-bg` | state pill "warning" | 6.5:1 | 8.4:1 |
| `pill-bad` | `pill-bad-bg` | state pill "problem" | 6.3:1 | 8.2:1 |
| `pill-neutral` | `pill-neutral-bg` | state pill, neutral | 7.3:1 | 8.4:1 |
| `on-s` | `band-s1` | score segment of stage 1 | 4.9:1 | 4.9:1 |
| `on-s` | `band-s2` | score segment of stage 2 | 4.6:1 | 4.6:1 |
<!-- /contrast -->

The check found one defect, which was fixed: white text on the blue stage-1 segment of the
score bar had 3.6:1; the text is now dark (4.9:1 on the stage-1 segment, 4.6:1 on stage 2).

### Touch targets

Every interactive element is at least 44 × 44 CSS pixels on a touch screen: buttons, pills,
fields, navigation items, the choices of the verdict, and every link inside a table or a feed
row. On a phone a feed row is 100 px high so that its two links have 44 px each. The audit
measures every visible `a`, `button`, `input`, `textarea` and `summary` on every page.

## Structure

- **Responsive grid.** Flexbox with wrapping for tiles, charts and funnel steps; CSS grid for
  the feed rows and the key–value lists. Blocks get a minimum width in rem and share the row;
  when the row is too narrow they wrap. No block has a fixed pixel width.
- **Main navigation on every device.** In the header on a desktop and a tablet; fixed to the
  bottom edge on a phone. Seven sections do not fit a phone, so the bar scrolls sideways and
  the first four are visible at once.
- **Keyboard.** Every control is a real `button`, `a` or `input` with a visible focus ring.
  Fields are at the top of their pages, the fixed bar is at the bottom, so the on-screen
  keyboard of a phone does not cover the field being typed in.

## Results of the audit

`scripts/ui-audit.mjs` opens ten pages (the nine pages of the dashboard and the component
library) in a headless browser at nine sizes and measures the page, not the stylesheet.

<!-- audit -->
| Viewport | Size, CSS px | Pages | Pages with horizontal scroll | Pages without the navigation in view | Touch targets under 44 px |
|---|---|---|---|---|---|
| Phone, portrait | 390 × 844 | 10 | 0 | 0 | 0 of 608 |
| Phone, landscape | 844 × 390 | 10 | 0 | 0 | 0 of 984 |
| Small phone | 320 × 568 | 10 | 0 | 0 | 0 of 608 |
| Tablet, portrait | 768 × 1024 | 10 | 0 | 0 | 0 of 624 |
| Tablet, landscape | 1024 × 768 | 10 | 0 | 0 | 0 of 614 |
| Desktop | 1440 × 900 | 10 | 0 | 0 | not a touch screen |
| Desktop at 200 % browser zoom | 720 × 450 | 10 | 0 | 0 | not a touch screen |
| Desktop, text size 125 % | 1440 × 900 | 10 | 0 | 0 | not a touch screen |
| Large screen | 2560 × 1440 | 10 | 0 | 0 | not a touch screen |

Run of 2026-11-24; 90 page–size pairs. The component library page is one of the ten pages; it has no navigation and is not counted in the navigation column. The last column counts the visible targets under 44 px against all targets of the pages.
<!-- /audit -->

Run it against any running instance:

```sh
node scripts/ui-audit.mjs http://127.0.0.1:8090/npm ./ui-audit     # screenshots and audit.json
node scripts/ui-contrast.mjs                                        # contrast of every text colour
```

## Requirements of the criterion

Minimum:

| Requirement | Status | Evidence |
|---|---|---|
| Three device types | done | table "Three devices"; [screens/](screens/) |
| Correct display when resolution and orientation change, no overlapping elements | done | audit: no horizontal overflow on 90 page–size pairs; landscape and small-phone screenshots |
| Relative units | done | every length in `rem`; only hairlines (borders, the focus ring) in `px` |
| Works when the browser zoom or system settings change | done | viewports "200 % zoom" and "text size 125 %"; `prefers-color-scheme`, `prefers-reduced-motion` |
| Fonts, icons and images scale without distortion | done | rem type scale; inline SVG only |
| Interactive elements at least 44 px on touch screens | done | audit: 0 smaller targets on five touch viewports |
| Contrast at least 4.5:1 (WCAG 2.1 AA) | done | contrast table: lowest 4.6:1 |
| Consistent palette and typography on all devices | done | one stylesheet with tokens; component library |
| Responsive grid; blocks scale with the width | done | section "Structure" |
| Main navigation always available | done | audit: navigation in view on every page of the application at every size |
| Mock-ups for three devices, library of reusable components, states of interactive elements | done as a PDF and a live page; five of the nine pages have the three variants | [mockups.pdf](mockups.pdf), `/npm/static/kit.html` |

Maximum:

| Requirement | Status | Evidence |
|---|---|---|
| Any screen type, including 4K and ultrawide | in part: 320 px to 2560 px | viewports "small phone" and "large screen"; 3840 px and ultrawide not tested |
| Foldable, smartwatch | not done | a 320 px wide screen is the smallest supported; a watch has no use for a table of events |
| Automatic detection of pixel density, orientation, aspect ratio | in part | media queries on orientation, height and pointer type; no query on density or aspect ratio: SVG and rem make them unnecessary here |
| Design system | done | colour tokens, components; the component library page |
| Light and dark theme | done | system setting and a choice of the viewer |
| SVG icons | done | `src/web/static/icons.js` |
| The viewer can change scale and colour scheme | done | "Theme" and "Text" in the footer, kept in the browser |
| Layout rebuilt when the screen size changes | done | navigation changes place, rows change shape, grids change column count |
| One-hand use, platform patterns (bottom navigation) | in part | bottom bar on a phone, with the safe-area inset of the device; it holds seven items and scrolls sideways (see the limits) |
| Elements not covered by the keyboard | in part | the search and filter fields are at the top of the page; the verdict form and the dependency list are lower and rely on the browser to scroll the field into view |

## Known limits

- The mock-ups are a PDF made from the running design system, not a Figma project.
- The bottom bar holds seven sections and scrolls sideways: on a 390 px phone four are in view.
  A five-item bar with a "more" item would follow the platform guidelines more closely.
- The three-device layouts cover five pages: overview, live feed, alerts, event card, my
  dependencies. Stage 1, statistics, the package page and the privacy notice were audited for
  overflow and targets but have no layout in the PDF.
- A wide table scrolls inside its panel and shows a shade at the edge; on a phone a table is
  not turned into cards.
- Text inside the column charts is part of the drawing and scales with the chart. A chart
  narrower than 26rem gets a larger font (a container query), so its labels stay near 10 px on
  a phone; on a large screen they are larger than the body text.
- The dashboard has no public address: it runs in a private network, and the privacy notice of
  the project limits it to the analysts of the deployment. The repository and the commands
  above are the way to see it.
- Tested in a Chromium engine (Edge, headless and on a desktop). Safari and Firefox were not
  tested; the stylesheet uses no engine-specific feature except the `env()` safe-area inset.
- The audit measures sizes and overflow. It cannot see that two elements overlap inside the
  page; that was checked by eye on the screenshots.

## Screenshots

Each file shows the first screen of the device. The lists and the overview show the data of the running
monitor; the audit script replaces npm account names in them with pseudonyms (`account-3fc6`).
The event card comes from the test data set of the repository (`npm run db:seed`), whose account
names are invented.

<!-- screens -->
| Screen | Phone | Tablet | Desktop |
|---|---|---|---|
| Overview | [phone](screens/phone-portrait--overview.png) | [tablet](screens/tablet-portrait--overview.png) | [desktop](screens/desktop--overview.png) |
| Live feed | [phone](screens/phone-portrait--feed.png) | [tablet](screens/tablet-portrait--feed.png) | [desktop](screens/desktop--feed.png) |
| Alerts | [phone](screens/phone-portrait--alerts.png) | [tablet](screens/tablet-portrait--alerts.png) | [desktop](screens/desktop--alerts.png) |
| Event card | [phone](screens/phone-portrait--event.png) | [tablet](screens/tablet-portrait--event.png) | [desktop](screens/desktop--event.png) |
| My dependencies | [phone](screens/phone-portrait--dependencies.png) | [tablet](screens/tablet-portrait--dependencies.png) | [desktop](screens/desktop--dependencies.png) |

| Variant | File |
|---|---|
| Phone held sideways (844 × 390): the header and the hero shrink | [phone-landscape--feed.png](screens/phone-landscape--feed.png) |
| Small phone (320 × 568): one funnel step per row | [phone-small--overview.png](screens/phone-small--overview.png) |
| Tablet, landscape (1024 × 768): event card | [tablet-landscape--event.png](screens/tablet-landscape--event.png) |
| Desktop at 200 % browser zoom: the phone layout applies | [desktop-zoom-200--alerts.png](screens/desktop-zoom-200--alerts.png) |
| Desktop, text size 125 %: the whole layout scales with the text | [desktop-text-125--overview.png](screens/desktop-text-125--overview.png) |
| Large screen (2560 × 1440): wider content, readable line length | [wide--overview.png](screens/wide--overview.png) |
| Dark theme. Phone 390 × 844: overview | [phone-portrait--overview--dark.png](screens/phone-portrait--overview--dark.png) |
| Dark theme. Tablet 768 × 1024: event card | [tablet-portrait--event--dark.png](screens/tablet-portrait--event--dark.png) |
| Dark theme. Desktop 1440 × 900: alerts | [desktop--alerts--dark.png](screens/desktop--alerts--dark.png) |
| Component library, desktop and phone | [desktop](screens/desktop--kit.png), [phone](screens/phone-portrait--kit.png) |
<!-- /screens -->
