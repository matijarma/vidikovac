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

**20 September passive-view contract, superseding the historical composition
below, as amended on 22 September:** one steady geographic map beside a
reserved 520–760px information column at 1×, scaled for 4K; the conditions
card and the rotating highlight are gone. The "U blizini" list and the QR card
occupy independent grid regions. No kiosk discovery/search/filter list or
idle map-navigation controls. The map has a legend of three plain items (tram
route, BAJS bike count, culture tonight), never a caveat, and no legend
stands where no map is drawn (lagano).
The list is one time axis around the place: at most three departures, blue
"za N min" for a tracked vehicle and a grey clock time for the timetable; then
the timed rows (a closure's end, an event with its venue and the tram to it,
the next sunset or sunrise, never both, the evening's last departures as one
row from four hours ahead, the first morning tram from 22:00 until it leaves,
tomorrow's openings when the evening empties); then one "uvijek" row, the
place's naming story or a protected building nearby, alternating, and the
24/7 pharmacy at night. No row carries a source, freshness or caveat caption.
Rows are whole and at least 64–92px tall from the item count, so fewer items
make larger rows; a row whose words need two lines is taller. Nothing is cut
with an ellipsis: a long row prints the source's own shorter label or wraps
whole; when the rows do not fit, whole rows leave the list, the latest first,
and the first row after the departures only after the later departures.
Each row keeps its node: a new row enters at the bottom, fades in once and
takes its place in time on the next update, a past one leaves at the top, and
nothing moves without a change. The map highlights what the header
sentence names without fitting or moving the camera. Presentation suspends
the sentence and the list; safety and QR remain available.

Portrait puts the map above the "U blizini" list and the invitation,
allocating space to legible content and a QR code of at least 240px before
the map. Handheld `/kiosk/` puts setup/code information first and uses
handheld symbols in its compact preview. Short opacity transitions only;
reduced motion and lagano drop the transitions, never the rows, and
preserve useful information. The settings panel is a column of
click-toggles, each naming its current state and changing it at once; there
is no draft and no save action (22 September 2026).

The earlier public-screen description is retained as implementation history;
its references to touch discovery, the header ticker and separate events and
exceptions cards no longer define the current product.

The normal `/kiosk/` surface is a live city window, not a locked dashboard
and not an ambient decoration. Pairing acknowledges access without replacing
it. The map takes the whole left column. A screen with a place (a stop or an
address) opens on a frame of N stops around it (Kadar: 4, 6 or 8
"stajališta odavde", default 6), its radius measured per place and the same
number the "U blizini" circle and its pill use. The frame is a neighbourhood:
buses at every hour, every BAJS station a disc carrying its count (grey at
zero, grey and blank when the count is unknown, never "?"), venues only with a
programme tonight and named, ranked stop names with every tram interchange,
and the major street names. A screen set to the whole city opens on the whole
city, with the live transit picture on it: the tram network as a thin neutral
ground, tram plates, bike-share stations as small dots without a number,
closures, the on-duty pharmacy and tonight's venues. On this surface transport
is the default cartography; the earlier rule that it must not dominate applies
to the phone and the desk. On the whole-city window place names are a
reader's, not a passer-by's: no neighbourhood names, no station or venue
names. Buses join the whole-city window only once the camera is in a
neighbourhood. Compact landscape and portrait keep the same grammar in their
own arrangements.

The other column carries the "U blizini" list over the pairing card. The
list's head names the circle it covers, measured per place, and its walking
time ("U blizini · 2,2 km · ~16 min"). The list never renders empty: a
departure row always exists, timetable when no vehicle is tracked, and when
the evening empties the rows grow and the horizon reaches into the next
morning instead of padding. Weather, transit exceptions and events are no
longer cards on the wall: weather speaks through the header sentence,
closures and events are timed rows, and the paired compositions keep their
own panels.

The header's middle carries one sentence at a time: a coloured kicker (Promet,
Kultura, Vrijeme, Bicikli, Noćas, Radovi) and at most 80 characters, replaced
at the screen's rhythm (20 seconds by default) with a short crossfade, instant
under reduced motion. No marquee, no scrolling text and never an ellipsis: a
sentence that does not fit its line is skipped, not cut. Session and pairing
notices outrank it. Workers AI writes the sentences from the wall's own facts,
the list's rows plus weather, closures and bikes, and a sentence is shown only
when its claims are those facts and only while they hold (a last-tram line
leaves when the tram has left). Fixed templates over the same facts are always
in the pool, so the header never waits for the model and still speaks when it
is unavailable. No sentence repeats verbatim within ten minutes.

Keep location/date/time in the header and safety in the footer, where the
on-duty pharmacy is a green cross, "24/7" and its short address and the
sources are named without a time. The QR card holds the lead, the code and
the address to type it at, with no benefit line and no copy button, beside a
QR code of at least 240 CSS pixels on a 264px plate at the design sizes, with
the code under the text at a fixed size, never stretched across a column.
Starting a screen is one optional field, "Adresa ili stajalište", a line
under it saying what the screen will show, and "Pokreni"; place, frame, view,
theme, rhythm and expiry belong to an on-screen settings panel opened by a long
press on the brand, not a setup wizard, not a gear or theme glyph in the header
and not a screen full of large district pills. A refused or rate-dropped change
is stated in the panel, never swallowed, and the toggles return to what the
server holds.

The map is a meaningful geographic view, not a background beneath a route
board. The screen's place and frame (Kadar: 4, 6 or 8 stops around it,
measured per place), and public selections, determine framing; without a
chosen place the whole-city window stays. Do
not force every vehicle number to overlap at terminals: retain dots and
collision-aware labels. Stops stay tap-able at city zoom, with a hit tolerance
sized for a finger on a wall, and a tapped stop leads with its arrivals. A
window onto the whole city is four times the ground the wall's field was sized
for, so below the thinning zoom it names less, not smaller: the basemap's
promoted street names go, the assembly points keep their squares and lose their
titles, and of the stops only the tram interchanges are named -- a tram calls
there and some trip begins or ends there. Route count is not a measure of
importance and is not used for this. From the thinning zoom up every name is
back, exactly as derived. A framed screen names by being framed, not by zoom:
whatever its Kadar, it draws the ranked stop names with every tram interchange
and the major street names, so Kadar 4, 6 or 8 never changes the naming
grammar; the thinning rule belongs to the whole-city window alone.
Preserve the map instance across polling and composition changes.

Overview content has deliberate budgets. A fitting routine may not hide
every row of a populated panel to make a screenshot test pass. A genuine
empty, loading or unavailable source is stated explicitly.

On the wall, quiet-day discovery is the "uvijek" row: a real street-register
or heritage record, shown without a caption; its attribution is on the phone
and `/izvori`. Touch exploration has search, categories, list/details and
an explicit return action; 90-second inactivity restores the overview.
Refreshes preserve focus and scroll. Remote presentation makes the map inert.

### Presented content

A deliberate presentation gives the public subject a distance-readable
layout, not a cropped phone screen. Route/stop selections have geography
and a separate subject board. Events and civic selections lead with their
title and source-supported details. A legacy phone that still sends the
retired `kvart` layer renders as the plain Sada overview, never a district.

Safety and the invitation remain available; the return-to-overview action
is the presenter's, on the phone. The screen shows no control that ends a
presentation. Private browsing never automatically changes the presentation. The
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

Search focus now opens the full available sheet immediately. Its geometry
uses the visual viewport, visible navigation and keyboard occlusion. Short
landscape is list-first. Filters use one labelled disclosure rather than an
unmarked horizontal strip. Routes, stops, places and streets share one
keyboard result system and one scoped count. Detail/back preserves the
query, filters and list position; private tab filters survive refresh.
Map symbols use explicit handheld, desktop and public-display profiles;
visual size is independent of hit tolerance and device pixel ratio.

Sada reads the same departure cache and arrival logic as the stop detail.
Its agenda flows vertically without empty time quadrants or duplicated
preview events. Još separates Saved, preferences, additional destinations
and help. “In-app highlights” describes local emphasis, never push delivery.

Living city, culture, transport, useful places and heritage are progressive
map groups. Active venue pins have bounded size and explicit event counts;
there are no geographic clusters on any surface: the map curates (every BAJS
station counted, venues only with a programme tonight). Selected places stay
outside filters. Venue programs open the in-app event detail
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
one rider's vehicle. A vehicle silent in ZET's feed for more than 30 s is held
at its next stop and fades; after 180 s it leaves the map. A tram is drawn only
on its own line's rails; off them it is drawn at its reported positions. On the
schematic, a tram on a terminus loop is drawn at the circle of the loop's first
stop, or of its other end where ZET's artwork does not print the first
(Mandlova); where its line's artwork prints neither end (the Mandlova to
Ravnice loop of a line that does not serve Ravnice), the schematic does not
draw the tram, which stays on the geographic map.
BAJS counts require a recent observation; air is a
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
