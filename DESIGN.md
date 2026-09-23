---
name: "Kaj ima?"
description: "Useful city information, a public overview and deliberate presentation."
---

# Kaj ima? Design system

Approved direction: 17 September 2026, extended on 18, 19 and 20 September
2026 and revised by the companion round of 22 September 2026
(`docs/companion-2026-09-22.md`). Product intent is in `PRODUCT.md`; current
implementation and verification are tracked in
`docs/upgrade-city-2026-09-18.md` and `docs/kaj-verification.md`.
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

**22 September 2026 contract** (the companion round,
`docs/companion-2026-09-22.md` §11 and §12), superseding the 20 September
passive view and every earlier public-screen composition: one steady
geographic map beside a reserved 520–760px information column at 1×, scaled
for 4K. The header carries "Kaj ima?", the place (a stop or a street;
Trg bana J. Jelačića for a screen without a chosen place), one sentence, the
date and a small clock. The information column holds the "U blizini" list over
the QR card, in independent grid regions, and the footer carries safety.
Nothing on the wall is an operator control for the passer-by: no pause, copy,
theme or gear button, no kiosk discovery, search or filter list and no idle
map-navigation controls; settings open only by a long press on the brand.

The map has a legend of three plain items (tram route, BAJS bike count,
culture tonight), never a caveat, and no legend stands where no map is drawn
(lagano). A screen with a place (a stop or an address) opens on a frame of N
stops around it (Kadar: 4, 6 or 8 "stajališta odavde", default 6), its radius
measured per place and the same number the "U blizini" circle and its pill
use. The frame is a neighbourhood: buses at every hour, every BAJS station a
disc carrying its count (grey at zero, grey and blank when the count is
unknown, never "?"), venues only with a programme tonight and named, ranked
stop names with every tram interchange, and the major street names. There is
no "+N" mark on the wall map: no geographic clusters, and a merged vehicle
pill lists every line number. The map highlights what the header sentence
names without fitting or moving the camera.

The list is one time axis around the place, its head naming the measured
circle and its walking time ("U blizini · 2,2 km · ~16 min";
"U blizini · 2 km · ~15 min" at 2 km). First come at most three departures, a
blue "za N min" for a tracked vehicle within ten minutes and a grey clock time
for the timetable; then the timed rows (a closure's end, an event with its
venue and the tram to it, the next sunset or sunrise, never both, the
evening's last departures as one row from four hours ahead, the first morning
tram from 22:00 until it leaves, tomorrow's openings when the evening
empties); then one "uvijek" row, the place's naming story or a protected
building nearby, alternating every 20 minutes, and from 22:00 to 06:00 the
24/7 pharmacy. The list never renders empty: a departure row always exists,
timetable when no vehicle is tracked, and when the evening empties the rows
grow and the horizon reaches into the next morning instead of padding. No row
carries a source, freshness or caveat caption. Rows are whole and at least
64–92px tall from the item count, so fewer items make larger rows; a row whose
words need two lines is taller. Nothing is cut with an ellipsis: a long row
prints the source's own shorter label or wraps whole; when the rows do not
fit, whole rows leave the list, the latest first, and the first row after the
departures only after the later departures. Each row keeps its node: a new row
enters at the bottom, fades in once and takes its place in time on the next
update, a past one leaves at the top, and nothing moves without a change.
Weather, transit exceptions and events are not cards on the wall: weather
speaks through the header sentence, closures and events are timed rows, and
the paired compositions keep their own panels. Presentation suspends the
sentence and the list; safety and QR remain available.

The header's middle carries one sentence at a time: a coloured kicker (Promet,
Kultura, Vrijeme, Bicikli, Noćas, Radovi) and at most 80 characters (64 on the
compact, portrait and handheld compositions), replaced at the screen's rhythm
(20 seconds by default, 30 or 60 by setting) with a short crossfade, instant
under reduced motion. No marquee, no scrolling text and never an ellipsis: a
sentence that does not fit its line is skipped, not cut. Session and pairing
notices outrank it. Every sentence is an approved template filled with one of
the wall's own facts (the list's rows plus weather, closures and bikes);
Workers AI may only choose among these templates and never writes words of its
own, and a sentence is shown only while its fact holds (a last-tram line
leaves when the tram has left). The templates are always in the pool, so the
header never waits for the model and still speaks when it is unavailable. A
fact is on screen at most once in ten minutes, whatever its wording, while at
least three facts are at hand; with fewer, no sentence repeats word for word
within ten minutes.

Keep the place, date and time in the header and safety in the footer, where
the on-duty pharmacy is a green cross, "24/7" and its short address and the
sources are named without a time. The QR card holds the lead, the code and the
address to type it at, with no benefit line and no copy button, beside a QR
code of at least 240 CSS pixels on a 264px plate at the design sizes, with the
code under the text at a fixed size, never stretched across a column. No fetch
time, freshness mark or count without a name stands on the city overview.

At night the solar theme turns the wall to its separately tuned dark palette.
In a ZET outage the map stays a map: the network, stops, BAJS, closures and
places without vehicles, with one quiet note on the map; every departure is a
grey timetable time and the header sentence says what is known. No headline
says "unavailable".

Touch, where the screen has it, is read-only: a stop ring opens that stop's
next departures for 60 seconds, a row shows its detail (venue, address, the
tram to it), the pharmacy its address and phone, and the wall returns by
itself. Otherwise touch opens only Osnovno, from the verdict word on the
footer; the camera never moves, and scanning is the only way to take content
along.

Starting a screen is one optional field, "Adresa ili stajalište", a line under
it saying what the screen will show, and "Pokreni"; place, frame, view, theme,
rhythm and expiry belong to an on-screen settings panel opened by a long press
on the brand, not a setup wizard, not a gear or theme glyph in the header and
not a screen full of large district pills. The settings panel is a column of
click-toggles (Mjesto, Kadar, Prikaz, Tema, Ritam and the screen's expiry),
each naming its current state and changing it at once; there is no draft and
no save action. A refused or rate-dropped change is stated in the panel, never
swallowed, and the toggles return to what the server holds.

Portrait puts the map above the "U blizini" list and the invitation,
allocating space to legible content and a QR code of at least 240px before the
map. Handheld `/kiosk/` puts setup/code information first and uses handheld
symbols in its compact preview. Short opacity transitions only; reduced motion
and lagano drop the transitions, never the rows, and preserve useful
information.

The public-screen descriptions of 17 to 20 September (touch discovery with a
90-second return, the header ticker, the conditions card, the rotating
highlight and the separate weather, exceptions and events cards) are history;
`docs/companion-2026-09-22.md` §13 lists what was retired and why.

The normal `/kiosk/` surface is a live city window, not a locked dashboard and
not an ambient decoration. Pairing acknowledges access without replacing it.
The map takes the whole left column. A screen set to the whole city opens on
the whole city, with the live transit picture on it: the tram network as a
thin neutral ground, tram plates, bike-share stations as small dots without a
number, closures, the on-duty pharmacy and tonight's venues. On this surface
transport is the default cartography; the earlier rule that it must not
dominate applies to the phone and the desk. On the whole-city window place
names are a reader's, not a passer-by's: no neighbourhood names, no station or
venue names. Buses join the whole-city window only once the camera is in a
neighbourhood. Compact landscape and portrait keep the same grammar in their
own arrangements.

The map is a meaningful geographic view, not a background beneath a route
board. The screen's place and frame (Kadar: 4, 6 or 8 stops around it,
measured per place), and public selections, determine framing; without a
chosen place the whole-city window stays. Do not force every vehicle number to
overlap at terminals: retain dots and collision-aware labels. Stop rings keep
a hit tolerance sized for a finger on a wall. A window onto the whole city is
four times the ground the wall's field was sized for, so below the thinning
zoom it names less, not smaller: the basemap's promoted street names go, the
assembly points keep their squares and lose their titles, and of the stops
only the tram interchanges are named -- a tram calls there and some trip
begins or ends there. Route count is not a measure of importance and is not
used for this. From the thinning zoom up every name is back, exactly as
derived. A framed screen names by being framed, not by zoom: whatever its
Kadar, it draws the ranked stop names with every tram interchange and the
major street names, so Kadar 4, 6 or 8 never changes the naming grammar; the
thinning rule belongs to the whole-city window alone. Preserve the map
instance across polling and composition changes.

Overview content has deliberate budgets. A fitting routine may not hide every
row of a populated panel to make a screenshot test pass. A genuine empty,
loading or unavailable source is stated explicitly.

On the wall, quiet-day discovery is the "uvijek" row: a real street-register
or heritage record, shown without a caption; its attribution is on the phone
and `/izvori`. Refreshes preserve focus and scroll. Remote presentation makes
the map inert.

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

**22 September 2026 companion contract (WP4), superseding the earlier
destinations, the two Sada regions, the map groups and the Događanja tab:**
the ten-minute visit answers before it explains. The phone's destinations are
the three tabs Sada · Karta · Još; the current destination retains a readable
label at text zoom. The desktop is the phone, wider: the Sada feed and the
Karta map stand side by side, and there is no six-domain bar; weather, civic
and safety content arrive as rows of the feed, as search results or through
Još. Do not reintroduce the permanent competing neighborhood-map sidebar or a
Kvart workspace.

The header carries the wordmark, the single Zaslon control, "Podijeli grad",
the session pill and the safety shortcut; the desk adds Još. "Podijeli grad"
is a labelled button beside the session pill on every screen of a direct
session, absent for a one-hop peer and once the session has ended; one tap
opens the rotating code and its QR. Under a narrow header it keeps its icon
and its accessible name. A reload keeps the screen's name in the session pill.

Sada reads, in this order: the place as the title; one sentence with its
coloured kicker (Promet, Kultura, Vrijeme, Bicikli, Noćas or Radovi); on the
phone a 112px still map band around the place that opens Karta; three
departures at the automatically chosen stop; then the "U blizini" list, the
wall's own time-ordered rows continuing after those departures under the
circle measured for the place ("U blizini · 2 km · ~15 min"); below the fold
the sources, crediting ZET. There is no generic heading sentence, no date
line, no instruction, no count and no time filter. The place follows one
order: the wall's place or the screen's stop, then a saved stop, then the
nearest tram stop within 400 m, then the nearest bus stop within 300 m, then
the address alone; with none of these the place is Trg bana J. Jelačića. The
departures come from the place's stop, else from the nearest platform within
800 m, so an address near a stop still has departures; with no platform that
near, Sada shows no departures block at all.

Whenever Sada has a stop to board, a departure row exists. A blue countdown
with its dot is a vehicle ZET tracks, a grey clock time is the timetable, and
no row carries a word for its kind. While a board is on its way one row-sized
placeholder holds the place; only a source that cannot answer says so, in one
line. Sada reads the same departure cache and arrival logic as the stop
detail.

Karta is the timeline's map. It opens on the wall's frame around the place,
with every vehicle drawn at once as a full-number pill and the wall's curated
marks (every BAJS station counted, venues with a programme tonight named,
closures); there is no group taxonomy, no chip row and no map menu, and there
are no geographic clusters on any surface. One small control in the sheet
head switches between the map and the schematic network ("Shema" / "Karta")
and is remembered on the device. A selected place stays drawn whatever the
search.

Karta has one map, one search field over routes, stops, places and streets,
a peek/detail/open sheet on a phone and a board column on the desk. The peek
names the place and its circle; the open sheet lists the same "U blizini"
rows. Categories (toilets, water, markets and the like) appear only as
search results and, once searched, as pins. A stop's detail leads with three
departures in Sada's row, then "Vozni red" with the rest of the list, then
the one note that says the blue times are ZET's estimate. ZET's notices
and the per-line delay table are not on the phone.

Search focus opens the full available sheet immediately. Its geometry uses
the visual viewport, visible navigation and keyboard occlusion. Short
landscape is list-first. The peek state keeps search visible; focus must not
wait for an animation to clear the navigation bar. Routes, stops, places and
streets share one keyboard result system and one scoped count. Detail/back
preserves the query and the list position. Map symbols use explicit
handheld, desktop and public-display profiles; visual size is independent of
hit tolerance and device pixel ratio. Venue programs open the in-app event
detail before its original source. Street stories have map-label and search
paths. Heritage selections draw the protection outline, never an assumed
entrance. Every search result has a map-free list path.

Događanja is no longer a destination: timed events live in "U blizini",
venues with a programme tonight on the map, and the week's agenda is one row
in Još, "Događanja ovaj tjedan" with its count line. That page keeps a dated
agenda, the day choices and a compact category selection; a multi-day item
says until when ("do 25. 9.") rather than "cijeli dan". Ongoing exhibitions
and undated notices are separate. Još separates Spremljeno (saved lines,
stops and places), the destinations (the week's agenda, then Vrijeme, Grad
and Sigurnost as full pages), preferences and the help pages (`/hitno`,
sources, privacy, accessibility). “In-app highlights” describes local
emphasis, never push delivery. Weather uses actual observations and daily
ranges; civic content remains attributable metadata and original documents,
never invented legal summaries.

The single Zaslon control is consistently placed in the shared header.
Its panel explains the target, current presentation, pending/confirmed
state, stopping and takeover. No floating cast button covers content,
and no duplicate detail/aside buttons compete with it.

When the ten minutes end, the content clears: what remains is the invitation
to scan again and the `/hitno` link.

## Data, access and acceptance

Preserve ten-minute direct sessions, five-minute one-hop peer sessions,
resume behavior and no-JavaScript `/hitno`. At the end of the ten minutes the
content clears to the invitation to scan again and the `/hitno` link: no
frozen view and no exports. Successful redemption opens the personal view
directly; there is no redundant second unlock button.

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
preliminary station observation. A ZET countdown exists only where a tracked
vehicle carries that trip, built from the scheduled departure and ZET's own
reported delay for that vehicle; every other departure keeps its scheduled
clock time. Colour and form carry the difference, never a caption on the row:
a blue countdown for a tracked vehicle, a grey clock time for the timetable,
and no row says "procjena". On the phone a tracked row's marker is announced
as "uživo", and the one sentence on where the estimate comes from stands once,
in a stop's detail. No tracked vehicle, no countdown; HŽ boards stay scheduled
times only. The header sentence is a derived reading of the wall's own facts
and is never republished as a source. Text from a register or feed that no
one here edits (names, titles, addresses, descriptions) is checked before the
wall shows it, and a value that fails is left out with its row or sentence,
never repaired or shortened. Inventory capacity is never live availability.
No push delivery or unverified open-now claims are implied.

Verify both themes, Croatian/English, reduced motion, 200% text,
keyboard navigation, small phones, tablet, landscape/portrait displays
and 4K. Check content usefulness and acknowledged delivery in addition
to geometry. Keep the submitted application artifacts unchanged.
