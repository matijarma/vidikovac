# Kaj ima?

## Register

product

## Users

The immediate audience is the project's funding evaluators, the owner, and people exploring the public prototype. The financing application has been submitted. This iteration makes the working product communicate its value immediately, not merely demonstrate that integrations exist. The intended citizen pilot remains conditional on City funding and partnership.

The product serves people using a phone on a Zagreb street or at a tram stop, people reading a public screen in a cafe or library, and people exploring city information on a desktop. It works without an account, installation or personal tracking. The evaluation prototype is public; Cloudflare Access protects operator routes only.

## Product Purpose

Make the city's existing open data genuinely useful and accessible through premium design and interaction. A working screen grants ten minutes on a viewer's device through a rotating single-use code; a viewer may share five minutes once. Same-Wi-Fi pairing works. Safety information is sessionless and also works without JavaScript.

Self-service temporary screens use the same real pairing and data paths as venue screens. There is no separate preview, fake dashboard, or unlimited demo session.

The kiosk is useful without a phone. Scanning opens a personal session directly and does not interrupt the public overview or an existing presentation. Showing something on the public screen is a separate, deliberate action. Another direct scanner can take over only after confirmation; peer sessions cannot control the screen.

## Brand Personality

Local, capable, alive. The user chose **Kaj ima?**, knowingly sharing the City newsletter's name, as a proposition for a contemporary City-backed service. Do not reopen that naming decision, criticise the newsletter in the pitch, or add independent-project/endorsement disclaimers.

## Anti-references

The previous Modrotisak treatment, panorama, meander, gallery numbering and captions are rejected. Do not substitute another decorative banner or mandatory graphic motif. Avoid municipal document portals, tables disguised as dashboards, endless equal cards, washed-out surfaces, generic SaaS, ornamental glass, and visual complexity without a useful interaction.

## Design Principles

1. Design and UX deliver the capability. Transport, weather, events, civic activity and safety need distinct, useful experiences, not feeds of text disguised as a dashboard.
2. The first viewport belongs to the city, not the clock, session mechanic or brand ornament.
3. Identity is the coordinated system of typography, cartography, colour, composition, language and interaction.
4. Show only what the data supports. Missing data is not zero; fetch time is not observation, publication or event time.
5. Preserve the valuable data, motion, pairing and accessibility engineering. Replace presentation and interaction where needed.
6. Screens are useful without scanning. The phone and kiosk share visual language but have deliberately different compositions.
7. Access is not control. Private navigation stays private; the public screen acknowledges the content it has actually rendered. A new scan cannot silently replace another visitor's presentation.
8. Useful content is an acceptance criterion. An empty panel cannot pass simply because its content was hidden until nothing overflowed.

## Accessibility & Inclusion

WCAG AA rendered contrast, visible keyboard focus, 44px minimum targets, 48px primary touch actions, 16px body text, 14px controls and 12px metadata. Croatian and English; reduced motion; 200% zoom; keyboard and screen-reader access. Preserve `?lagano=1` without map libraries, fonts or canvas animations. Safety remains readable without JavaScript.

## Approval

On 22 September 2026 the owner approved the companion round
(`docs/companion-2026-09-22.md` §10 to §13). It supersedes, in the approvals
below: the one map-linked highlight held for 20 seconds and its pause control;
the whole-city window as every screen's default; the one-button start and the
header gear; tap-to-explore and the 90-second reset; the frozen attributed
snapshot with exports at the end of the ten minutes; the phone's Sada, Karta,
Događanja and Još; and "tracked estimates are labelled on every row".

The wall now names its place in the header (a stop or a street;
Trg bana J. Jelačića for a screen whose setup field was left empty) and frames
six stops around it by default (Kadar: 4, 6 or 8 "stajališta odavde"), the
radius measured per place; a screen set to the whole city keeps the whole-city
window. One written sentence with a coloured kicker (Promet, Kultura, Vrijeme,
Bicikli, Noćas, Radovi) changes with the screen's rhythm, every 20 seconds by
default: at most 80 characters, never cut with an ellipsis, and shown only
while the fact it states holds. The right column is "U blizini" with the
measured circle and its walking time ("U blizini · 2 km · ~15 min" at 2 km):
one time-ordered list of at most three departures (a blue countdown for a
tracked vehicle, a grey clock time for the timetable, never the word
"procjena"), then the timed rows, then one "uvijek" row, above the QR card
with the lead "Skeniraj za 10 minuta grada.", the code and the address to type
it at. No fetch time, disclaimer, count without a name or operator control
stands on the wall; the footer carries safety, its sources without a time and
the on-duty pharmacy as a green cross, "24/7" and its address. In a ZET outage
the map stays a map without vehicles, with one quiet note, and every departure
is a timetable time. Where the screen has touch, touch is read-only and the
wall returns by itself: a stop ring shows that stop's departures for 60
seconds, and scanning stays the only way to take content along.

Setup is one optional field, "Adresa ili stajalište", a line under it saying
what the screen will show, and "Pokreni". Settings are click-toggles behind a
long press on the brand: Mjesto, Kadar, Prikaz (karta or shema), Tema and
Ritam. The phone opens on the place as its title, one sentence, a map band and
three departures, then the same "U blizini" rows; its tabs are
Sada · Karta · Još, the week's agenda is the Još row "Događanja ovaj tjedan",
and "Podijeli grad" is a labelled header button beside Zaslon and the session
timer. Karta is the timeline's map: vehicles at once, curated markers, one
search field and a small map/schema toggle. Desktop is the phone, wider: the
Sada feed and the Karta map side by side, without the six-domain bar. After
ten minutes the content clears to the invitation to scan again and the
`/hitno` link. Vocabulary: Karta is the destination, Promet the subject word,
"stajalište" the stop, "uvijek" the timeless row and "vozni red" the
timetable.

Recorded for later, not built in this round: the owner's vision for what
follows the cleared screen is that people keep whatever data they need
"without too much fuss". Static things can eventually be exported, while
real-time ZET tracking "can perhaps be offered to remain pinned so that a
person can easily walk with it without pressure until they catch the tram or
bus". The owner calls it a whole layer and a development effort of its own
(`docs/companion-2026-09-22.md` §14 and §17, Q25).

The approvals below are kept as the product's history. Where the 22 September
round replaced a rule, the sentence that states it begins
"Superseded 22 September 2026:".

On 20 September 2026 the owner approved the passive-view refinement. This
superseded the kiosk touch-discovery, 90-second exploration reset, separate
header ticker and competing rotating-card rules below. The wall is useful
without interaction and safety remains persistent.
Superseded 22 September 2026: compact current conditions and one rotating
highlight beside the map, with a pause control. Inside the invitation nothing
is a control but the QR; nothing on the wall sends a presentation command,
changes a personal selection or moves the camera.

Search, filters, saved choices and general discovery belong on personal
devices. A handheld opening `/kiosk/` sees the code/setup information before a
compact map preview. Scanning grants access only; deliberate presentation,
confirmed takeover and acknowledged delivery retain their existing protocol.
The QR is at least 240 CSS pixels at documented display sizes. Settings are
click-toggles that apply at once, with no draft and no save action; at most
one change reaches the server every five seconds (22 September 2026).

On personal devices, search opens usable results immediately, ranks names and
transport matches ahead of incidental addresses, and groups only co-located
Wi-Fi entries. Sada leads with local departures rather than line-wide fleet
statistics. Još retrieves saved routes, stops and places. Location context is
named explicitly. Timetable-only rows show clock times.
Superseded 22 September 2026: tracked estimates are labelled on every row. No
feeds, accounts, tracking or route planning are added. Release remains gated
on visual review; physical display, distance scan and Safari/VoiceOver checks
are required before a pilot.

On 19 September 2026 (evening) the owner approved the city-window round for
the public screen. Superseded 22 September 2026: one button,
**Pokreni zaslon**, a whole-city screen without a stop, and area, stop, theme
and expiry behind a gear in the header. Since 22 September 2026 opening
`/kiosk/` gives one optional field, **Adresa ili stajalište**, a line under it
saying what the screen will show, and **Pokreni**. A picked stop is the
screen's place; a picked street becomes the nearest tram stop within 400 m,
else the nearest bus stop within 300 m, else the address itself; an empty
field keeps the whole-city window, with Trg bana Jelačića as the place for the
list and the departures. Place, frame (Kadar: 4, 6 or 8 stops), view, theme,
rhythm and expiry sit in an on-screen settings panel opened by a long press on
the brand; the header names the place and carries no operator control. The map
takes the whole left column. A screen set to the whole city opens on the city
a passer-by means by Zagreb, Črnomerec to Maksimir and the Sava to Mirogoj,
with trams, the tram network in neutral grey, BAJS stations as small teal dots
without a number, closures, the on-duty pharmacy and tonight's venues,
unnamed; neighbourhood names leave the basemap and buses join the picture only
once the camera is in a neighbourhood. A screen with a place opens on N stops
around it (Kadar: 4, 6 or 8 "stajališta odavde", default 6), its radius
measured per place along the tram lines that serve it, the same number the
"U blizini" pill prints ("2 km · ~15 min" at 2 km). On the frame buses stay at
every hour, every BAJS station is a disc with its count (grey at zero, grey
and blank when the count is unknown, never "?"), venues appear only with a
programme tonight and are named, and a merged vehicle pill lists every line
number. A stop's departures say first which vehicles come next and in how many
minutes: trips with a tracked vehicle show a countdown derived from the
schedule and ZET's own reported delay, the rest keep their timetable clock
time. Superseded 22 September 2026: the header's one line of city news,
condensed server-side from long source texts. Since then the header carries
one sentence from the wall's own facts: an approved template filled with one
fact's checked values, which Workers AI may choose among and never rewrites,
shown only while that fact holds. It is a derived reading and never a
republished source. Kvart is removed from every surface.

This supersedes two earlier rules. "Transport stays available in discovery but
does not dominate default city cartography" no longer holds for the public
screen: the live transit picture IS the screen's invitation. The "no inferred
ETA" rule is reversed for ZET; arrival estimates are labelled as estimates,
never invented, and HŽ boards stay schedule-only.

On 18 September 2026 the owner approved the city-data upgrade in
`docs/upgrade-city-2026-09-18.md`, superseding the navigation and
transport-led map composition below. Superseded 22 September 2026: Phone:
Sada, Karta, Događanja, Još. Time-led Sada and place-led Karta complement the
chronological agenda. Existing transport URLs and selections remain
compatible. Superseded 22 September 2026: culture pins show known activity
during seven calendar days including today, plus ongoing exhibitions. Quiet
venues remain searchable; practical places belong in map/list discovery, not
more dashboard widgets.

Superseded 22 September 2026: the public display is a whole-city window, and
idle touchscreen discovery returns after 90 seconds without input. Explicit
remote presentation takes priority. Search, geolocation and saved choices
remain private. Street stories use the actual register, disambiguated by
settlement. Heritage geometry describes protection boundaries, not entrances.
New sources retain their attribution, timestamps and uncertainty; missing
licence metadata is recorded without inventing a licence or a new `/open`
export.

On 17 September 2026 the owner approved the whole-product redesign in `docs/redesign-2026-09-17.md`: a light-led high-contrast system; public overview plus explicit presentation; confirmed takeover. Superseded 22 September 2026: all six domains directly accessible on desktop; Sada, Promet, Događanja and Još on the phone. Kvart, once a workspace reached through location and Još, is removed everywhere; the wire literal `'kvart'` is still accepted from an older phone and renders as the plain Sada overview.

This approval supersedes earlier pixel layouts, fixed map spans, header-only weather, compulsory time-band columns and automatic paired layouts. It does not authorize changing the submitted documents in `docs/prijava` or `app/prijava`. Review real rendered interfaces, not only tests. Keep heavy verification work sequential to conserve the owner's quota.
