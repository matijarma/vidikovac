---
name: "Kaj ima?"
description: "Useful city information, a public overview and deliberate presentation."
---

# Kaj ima? Design system

Approved direction: 17 September 2026, extended on 18 September 2026.
Product intent is in `PRODUCT.md`; current implementation and verification
are tracked in `docs/upgrade-city-2026-09-18.md`.
The authoritative values are `app/src/ui/tokens.css`, not a second palette
invented by a component or this document.

## Character and physical context

A visitor reads a public screen across a daylight cafe or library, while a
person outside uses the phone to answer a practical question and move on.
Light is the primary design scene. Solar mode changes a public display to a
separately tuned dark palette at night; users can select either theme.

Use low-chroma mineral surfaces, dark readable ink, confident Zagreb blue and
purposeful semantic colours. This is a product, not an ornamental brand
exercise. References are public-transport wayfinding and departure-board
legibility, without imitating a municipal document portal.

Do not restore paper/ultramarine surfaces, decorative glass, the old panorama,
meander, mandatory fixed map zoom, giant map overlays or equal-card dashboards.

## Tokens, type and components

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | `#f1f4f7` | `#111922` |
| Primary surface | `#fbfcfe` | `#192430` |
| Secondary surface | `#eaf0f6` | `#23313f` |
| Primary text | `#142334` | `#eef3fa` |
| Secondary text | `#47586d` | `#b8c5d5` |
| Brand/action | `#0751bf` | `#84b5ff` |
| Text on action | `#f7faff` | `#102236` |
| Transit secondary | `#34465c` | `#b8c9dc` |
| Warning | `#89521a` | `#efbc76` |
| Danger | `#b72d39` | `#ff9aa5` |
| Success | `#176b56` | `#79d5b4` |
| Events | `#7040a2` | `#c9aff0` |
| Bike-share | `#178f7f` | `#178f7f` |

Components consume `--tone-*` semantic roles. The token file contains both
sRGB fallbacks and equivalent OKLCH values. `node scripts/sync-token-colors.mjs`
regenerates the OKLCH equivalents; `--check` verifies no drift. Rendered
contrast tests include tinted fills, not just isolated primitive pairs.

Manrope 400/500/700 is self-hosted. Use 400 for prose, 500 for labels and
700 for hierarchy. The system stack replaces it in lightweight mode.
Body is 16px, controls 14px, secondary information 13px and credits 12px.
Use larger composition-scoped kiosk roles for reading at a distance.
No display font in controls. Use tabular numerals for times and values;
monospace belongs to pairing codes.

Use the four-point spacing scale. Related objects sit closer than separate
sections; shared baselines and consistent edges establish grouping. Cards
are for distinct actionable content, not wrappers around every paragraph.
Radii: 4px badges, 6px small controls, 10px controls, 14px panels, 18px
larger objects. Pill shapes distinguish buses and compact state marks,
not every label on the page.

Touch targets remain at least 44px, with 48px primary actions. A small
visual glyph does not justify a small hit area. Static badges and credits
are not buttons. Inline map attribution is readable text, with a separate
44px disclosure control where compact attribution is used.

All controls need keyboard focus, pressed/selected, disabled and loading
states. Confirm public-screen takeover inline. Motion reports a state
change, not a polling cycle; use 140/180/220ms ease-out transitions and
honour reduced motion. Do not animate layout width for countdown bars.

## Screen compositions

### Public screen

The normal `/kiosk/` surface is an ambient city overview, not a locked
dashboard. Pairing acknowledges access without replacing it. Landscape
uses local geography with compact local facts below; weather,
active cultural venues and a QR share the other column. Transport stays
available in discovery but does not dominate default city cartography.
Compact landscape and portrait have their own arrangements.

Keep location/date/time in the header and safety/on-duty pharmacy in the
footer. The QR stays at least 240 CSS pixels at the design display sizes.
Show whole pairing codes and readable instructions. Setup is one form,
not a screen full of large district pills.

The map is a meaningful geographic view, not a background beneath a route
board. Public selections determine framing. Do not force every vehicle
number to overlap at terminals: retain dots and collision-aware labels.
Preserve the map instance across polling and composition changes.

Overview content has deliberate budgets. A fitting routine may not hide
every row of a populated panel to make a screenshot test pass. A genuine
empty, loading or unavailable source is stated explicitly.

Compact displays carry one complete cultural venue row, wide two, portrait
three. Quiet-day discovery uses a real cultural or heritage record with its
own attribution. Touch exploration has search, categories, list/details and
an explicit return action; 90-second inactivity restores the overview.
Refreshes preserve focus and scroll. Remote presentation makes the map inert.

### Presented content

A deliberate presentation gives the public subject a distance-readable
layout, not a cropped phone screen. Route/stop selections have geography
and a separate subject board. Events and civic selections lead with their
title and source-supported details. A legacy phone that still sends the
retired `kvart` layer renders as the plain Sada overview, never a district.

Safety, the invitation and return-to-overview action remain available.
Private browsing never automatically changes the presentation. The
controller distinguishes a pending request from a kiosk-confirmed render.

### Phone and desktop

Phone destinations are Sada, Karta, Događanja and Još. The current
destination retains a readable label at text zoom. Desktop exposes all
six domains directly. Do not reintroduce the permanent competing
neighborhood-map sidebar or a Kvart workspace.

Sada has two reading regions: local facts now, and what comes next. Names
and destinations are readable; weather is useful in the first view.
Time filters change the agenda without removing the local context.

Karta has one map, one search entry, a peek/detail/open sheet on a phone,
and a contextual board on desktop. Secondary map actions live in one
disclosure. The peek state keeps search visible; focus must not wait for
an animation to clear the navigation bar.

Living city, culture, transport, useful places and heritage are progressive
map groups. Active venue pins have bounded size and explicit event counts;
geographic clusters use a distinct plus-count mark. Selected places stay
outside clustering and filters. Venue programs open the in-app event detail
before its original source. Street stories have map-label and search paths.
Heritage selections draw the protection outline, never an assumed entrance.
Every category has a map-free list path.

The single Zaslon control is consistently placed in the shared header.
Its panel explains the target, current presentation, pending/confirmed
state, stopping and takeover. No floating cast button covers content,
and no duplicate detail/aside buttons compete with it.

Događanja uses a dated agenda and compact category selection. Ongoing
exhibitions and undated notices are separate. Weather uses actual
observations and daily ranges; civic content remains attributable
metadata and original documents, never invented legal summaries.

## Data, access and acceptance

Preserve ten-minute direct sessions, five-minute one-hop peer sessions,
resume behavior, frozen attributed exports and no-JavaScript `/hitno`.
Successful redemption opens the personal view directly; there is no
redundant second unlock button.

Missing is not zero. A request time is not an observation or event time.
An unavailable safety source is not an all-clear. Vehicle positions are
estimates; route delay is not an arrival forecast. BAJS counts require a
recent observation; air is a preliminary station observation; ZET and HŽ
departures are scheduled times, not ETA. Inventory capacity is never live
availability. No push delivery or unverified open-now claims are implied.

Verify both themes, Croatian/English, reduced motion, 200% text,
keyboard navigation, small phones, tablet, landscape/portrait displays
and 4K. Check content usefulness and acknowledged delivery in addition
to geometry. Keep the submitted application artifacts unchanged.
