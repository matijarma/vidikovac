---
name: "Kaj ima?"
description: "Useful city information, a public overview and deliberate presentation."
---

# Kaj ima? Design system

Approved direction: 17 September 2026, extended on 18 and 19 September 2026.
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

The normal `/kiosk/` surface is a live city window, not a locked dashboard
and not an ambient decoration. Pairing acknowledges access without replacing
it. The map takes the whole left column and opens on the whole city, with the
live transit picture on it: the tram network as a thin neutral ground, tram
plates, bike-share stations as dots carrying their count, closures, the
on-duty pharmacy and active venues. On this surface transport is the default
cartography; the earlier rule that it must not dominate applies to the phone
and the desk. Place names are a reader's, not a passer-by's: no neighbourhood
names, no station or venue names on the window. Buses join the picture only
once the camera is in a neighbourhood. Compact landscape and portrait keep the
same grammar in their own arrangements.

The other column carries weather, a transit-exceptions card, an events card
that fills the room it is given, and the pairing card. Weather is an
observation with today's and tomorrow's ranges. The transit card names only
what a rider would change a plan over and says so plainly when there is
nothing to name. The events card never renders empty: it holds at least one
whole row, and the card above it yields lines before that floor is broken.

The header carries one line of city news at a time: a coloured kicker and one
sentence, replaced on a fixed period with a short crossfade, instant under
reduced motion. No marquee and no scrolling text. Session and pairing
notices outrank it. Long source texts are condensed once, server-side, into a
single sentence; the original title is the fallback and stays on the phone.

Keep location/date/time in the header and safety/on-duty pharmacy in the
footer. The QR stays at least 240 CSS pixels at the design display sizes, with
the code under the text at a fixed size, never stretched across a column.
Starting a screen is one button and no configuration; area, stop, theme and
expiry belong to an on-screen settings panel, not a setup wizard and not a
screen full of large district pills. A refused or rate-dropped save is stated
in the panel, never swallowed.

The map is a meaningful geographic view, not a background beneath a route
board. Configured area or stop, and public selections, determine framing. Do
not force every vehicle number to overlap at terminals: retain dots and
collision-aware labels. Stops stay tap-able at city zoom, with a hit tolerance
sized for a finger on a wall, and a tapped stop leads with its arrivals. A
window onto the whole city is four times the ground the wall's field was sized
for, so below the thinning zoom it names less, not smaller: the basemap's
promoted street names go, the assembly points keep their squares and lose their
titles, and of the stops only the tram interchanges are named -- a tram calls
there and some trip begins or ends there. Route count is not a measure of
importance and is not used for this. From the thinning zoom up every name is
back, exactly as derived.
Preserve the map instance across polling and composition changes.

Overview content has deliberate budgets. A fitting routine may not hide
every row of a populated panel to make a screenshot test pass. A genuine
empty, loading or unavailable source is stated explicitly.

Quiet-day discovery uses a real cultural or heritage record with its own
attribution. Touch exploration has search, categories, list/details and
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
estimates; a route's median delay is a reading of the line, not a forecast for
one rider's vehicle. BAJS counts require a recent observation; air is a
preliminary station observation. A ZET arrival is an estimate and is labelled
one: a countdown only where a tracked vehicle carries that trip, built from
the scheduled departure and ZET's own reported delay for that vehicle, with
every other row keeping its scheduled clock time. No tracked vehicle, no
countdown; HŽ boards stay scheduled times only. Text the Worker condensed for
the public screen is a derived reading, carries its source, and is never
republished as the source. Inventory capacity is never live availability. No
push delivery or unverified open-now claims are implied.

Verify both themes, Croatian/English, reduced motion, 200% text,
keyboard navigation, small phones, tablet, landscape/portrait displays
and 4K. Check content usefulness and acknowledged delivery in addition
to geometry. Keep the submitted application artifacts unchanged.
