# Kaj ima: city through time and place

Owner-confirmed brief, 18 September 2026. Implementation starts at `7919846`.

## Visual and product contract

A time-led Sada and a place-led Karta complement the dated Događanja agenda.
Phone: Sada, Karta, Događanja, Još. The public display is a local city window,
not a ZET waiting room. Culture and everyday possibilities remain useful on a
quiet day. Keep the existing Manrope, semantic colours, light/day and dark/night
scenes, meaningful cartography, readable route names and private/public boundary.

Active venue pins group known activity over seven calendar days plus ongoing
exhibitions; their explicit counts are not geographic cluster counts. Quiet
venues remain searchable. Practical places belong to map/list discovery, not
new dashboard widgets. Street descriptions use the City's actual register,
with settlement disambiguation. Heritage uses registry identities and geometry,
not guessed geocoding. All functionality has a keyboard/list/lightweight path.

Idle touchscreen exploration returns after 90 seconds. Scanning grants access
without interrupting the wall. Confirmed remote presentation takes priority.
Ten/five-minute sessions, no-JS safety and frozen attributed exports remain.

Native image generation is unavailable. The confirmed composition, existing
historical captures and actual rendered browser review are the visual contract.
No new raster artwork is required.

## Delivery ledger

- [x] Source adapters, canonical places, source status and versioned catalogue.
- [x] BAJS, air, river conditions, civic consultations and scheduled departures.
- [x] Event/venue enrichment, deduplication, street and heritage matching.
- [x] Shared geographic discovery, accessible list/details and grouped layers.
- [x] Time-led home and venue-linked agenda.
- [x] Multi-domain kiosk, idle exploration and compatible presentation.
- [x] Local tests, browser critique/fix pass, responsive/lightweight verification.
- [x] Source/design documentation and current product captures.

Missing licence metadata is recorded, not silently replaced by an invented
licence or treated as a permanent engineering stop. No new bulk republication
under `/open` for uncertain sources. Expired community-room bookings, unverified
waste/pollen/live parking feeds remain gated. No accounts, social network,
venue-management platform, inferred ETA or unsupported open-now claims.

## Release

Application changes are for local review. No push/deployment without separate
owner approval. Publication follows GitHub → Cloudflare Builds only.
Submitted application text remains unchanged.

## Included data and honest limits

The bootstrap contains 204 cultural places; 199 fountains and 10 separate
drinking-water records (overlaps are deduplicated in the client); 29 toilets;
170 sports grounds; 108 dog areas; 20 recycling yards; 31 markets; 115 Wi-Fi
locations; 318 bicycle-parking records; 36 garages; 40 chargers; and 2,889
cycle-path segments. Generic category names preserve otherwise unnamed dog
areas and bicycle parking without inventing a location name.

Street stories contain 3,795 published descriptions with settlement identities.
Heritage contains 763 registry records, 165 joined to available official
geometry. The other 598 remain searchable without a guessed map pin. The
partially unavailable heritage geography is explicitly marked stale/limited.
Culture uses exact reviewed venue evidence; uncertain locations remain in the
agenda. Seven-day counts describe known programs, not comprehensive listings.

ZET timetables cover 3,805 stop records in the regional bounding box; HŽPP
44. Platform records are not a count of distinct station names. Departures
honour service days, exceptions, pickup restrictions and overnight times,
and expire at the actual available horizon. BAJS, station air observations,
the Sava bulletin and open national consultations use separate short-lived
caches. Missing, expired or stale measurements never become zero or an ETA.

The catalogue API and bootstrap are public UI delivery, not an additional
`/open` dataset with a blanket licence. Source URLs and licence caveats are
listed in `worker/city/sources.ts`, `docs/izvori.md` and the no-JS `/izvori`
page. Rebuilding from a saved download preserves its upstream fetch time.

## Verification artifacts and release qualification

Browser artifacts are in `review.local/city-review/` and
`test-results/redesign/`. Published preview imagery is in
`app/public/landing/`; `captures.json` records 28 real local-session captures,
18 September 2026, 22:04–22:15 UTC (19 September in Zagreb). The pairing
credentials are masked. Frozen captures followed the real ten-minute expiry,
without replacing the clock or feed data.

The Impeccable browser pass corrected compact kiosk clipping, transit-heavy
default cartography, unstable search focus, lost selected markers, truncated
reference dates and navigation from venue programs. It checked light/dark,
Croatian/English, 320px phones, tablet, landscape, 200% text, portrait display
and 4K, plus the map-free path. These are automated browser/emulation checks,
not a claim of physical-device or outdoor-display testing.

The full recorded ZET import completed in a separate Node process with an
80 MiB JavaScript heap cap: 14.2 seconds, 68.3 MiB final heap, 247.3 MiB peak
process RSS. This is **not** Cloudflare memory/CPU qualification. Deflated
GTFS parsing and catalogue promotion/failure/retention are exercised inside
the local Worker runtime. Production alarm resource use, cache behaviour
and changing upstream availability must still be monitored when the owner
separately authorizes release. Failed imports keep the last good catalogue;
the built-in bootstrap covers initial startup.

## Completion and handoff

The approved local upgrade is complete. Changes remain uncommitted in the
working tree; nothing was pushed or deployed. Model/provider settings and
submitted application artifacts were not changed. Do not restart this work.

Final verification on the delivered code:

- 2,412 unit tests passed, including the lightweight entry-graph budget.
- 159 Worker tests passed sequentially, including deflated GTFS parsing,
  source-failure retention, manifest promotion and old-chunk cleanup.
- Worker and client type checks, production build and `git diff --check` passed.
- 22 browser tests passed: city discovery, BAJS rent/return counts, venue-to-event
  navigation, accessibility, lightweight mode, phone/tablet/desktop, 200% text,
  portrait/4K displays, tram-diagram compatibility on desktop/mobile, and real
  two-scanner presentation, takeover, reload and city-place acknowledgement.
- 28 refreshed, credential-masked product captures include real ten-minute
  expiry. Provenance remains in `app/public/landing/captures.json`.

Final test results: `review.local/city-final-unit.json`,
`review.local/city-final-workers.json`, and `test-results/.last-run.json`.
The built local preview runs on port 5180 as
`kajima-upgrade-preview.service`; it can be stopped with
`systemctl --user stop kajima-upgrade-preview.service`.

`kajima-codex-resume.timer` was stopped before handoff and verified inactive.
It is a static unit, not an enabled boot-time timer. There is no unfinished
local implementation requiring automatic continuation. Production resource
qualification and release still require the owner's separate approval.
