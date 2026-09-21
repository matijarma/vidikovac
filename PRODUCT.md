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

On 20 September 2026 the owner approved the passive-view refinement. This
supersedes the kiosk touch-discovery, 90-second exploration reset, separate
header ticker and competing rotating-card rules below. The wall is useful
without interaction: one anchored geographic map, compact current conditions,
one map-linked highlight held for 20 seconds, and a permanently reserved QR
invitation. Mobility and city-life subjects alternate when both are available.
Safety remains persistent. Highlighting can be paused and does not send a
presentation command, change a personal selection or move the camera.

Search, filters, saved choices and general discovery belong on personal
devices. A handheld opening `/kiosk/` sees the code/setup information before a
compact map preview. Scanning grants access only; deliberate presentation,
confirmed takeover and acknowledged delivery retain their existing protocol.
The QR is at least 240 CSS pixels at documented display sizes. Settings retain
unsaved input and have a bounded scroll area with visible actions.

On personal devices, search opens usable results immediately, ranks names
and transport matches ahead of incidental addresses, and groups only
co-located Wi-Fi entries. Sada leads with local departures rather than
line-wide fleet statistics. Još retrieves saved routes, stops and places.
Location context is named explicitly. Timetable-only rows show clock times;
tracked estimates are labelled on every row. No feeds, accounts, tracking or
route planning are added. Release remains gated on visual review; physical
display, distance scan and Safari/VoiceOver checks are required before a pilot.

On 19 September 2026 (evening) the owner approved the city-window round for
the public screen. Opening `/kiosk/` gives one button, **Pokreni zaslon**, and
nothing else to decide: the screen it creates covers the whole city and carries
no stop. Area, stop, theme and expiry move to an on-screen settings panel
behind a gear in the header. The map takes the whole left column and opens on
the city a passer-by means by Zagreb, Črnomerec to Maksimir and the Sava to
Mirogoj, with trams, the tram network in neutral grey, BAJS stations as teal
discs carrying their bike count, closures, the on-duty pharmacy and active
cultural venues; neighbourhood names leave the basemap and buses join the
picture only once the camera is in a neighbourhood. A tapped stop says first
which vehicles come next and in how many minutes: trips with a tracked vehicle
show a countdown derived from the schedule and ZET's own reported delay, the
rest keep their timetable clock time, and the list says which is which. The
header carries one line of city news at a time, whose long source texts are
condensed once, server-side, into a single machine-written sentence that is a
derived reading and never a republished source. Kvart is removed from every
surface.

This supersedes two earlier rules. "Transport stays available in discovery but
does not dominate default city cartography" no longer holds for the public
screen: the live transit picture IS the screen's invitation. The "no inferred
ETA" rule is reversed for ZET; arrival estimates are labelled as estimates,
never invented, and HŽ boards stay schedule-only.

On 18 September 2026 the owner approved the city-data upgrade in
`docs/upgrade-city-2026-09-18.md`, superseding the navigation and
transport-led map composition below. Phone: Sada, Karta, Događanja, Još.
Time-led Sada and place-led Karta complement the chronological agenda.
Existing transport URLs and selections remain compatible. Culture pins show
known activity during seven calendar days including today, plus ongoing
exhibitions. Quiet venues remain searchable; practical places belong in
map/list discovery, not more dashboard widgets.

The public display is a whole-city window. Idle touchscreen discovery returns
after 90 seconds without input; explicit remote presentation takes priority.
Search, geolocation and saved choices remain private. Street stories use the
actual register, disambiguated by settlement. Heritage geometry describes
protection boundaries, not entrances. New sources retain their attribution,
timestamps and uncertainty; missing licence metadata is recorded without
inventing a licence or a new `/open` export.

On 17 September 2026 the owner approved the whole-product redesign in `docs/redesign-2026-09-17.md`: a light-led high-contrast system; public overview plus explicit presentation; confirmed takeover; all six domains directly accessible on desktop; Sada, Promet, Događanja and Još on the phone. Kvart, once a workspace reached through location and Još, is removed everywhere; the wire literal `'kvart'` is still accepted from an older phone and renders as the plain Sada overview.

This approval supersedes earlier pixel layouts, fixed map spans, header-only weather, compulsory time-band columns and automatic paired layouts. It does not authorize changing the submitted documents in `docs/prijava` or `app/prijava`. Review real rendered interfaces, not only tests. Keep heavy verification work sequential to conserve the owner's quota.
