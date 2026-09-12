# Controller rulings, Vidikovac iteration 2 (12 September 2026)

Binding on every implementer and reviewer. They override the task text they name. The approved plan is `C:\Users\MatijaRadeljak\.claude\plans\lets-work-on-this-ethereal-beacon.md`; the design spec is `design.md`; the layout reference is `Vidikovac.dc.html`.

## Lightweight mode (from Matija's own commit 9e0702e, section 1.10 of the proposal)

The filed proposal commits the project to a measurable lightweight mode: `?lagano=1` plus automatic weak-device detection, with **no map, no WebGL, no canvas animation, no container queries and nothing newer than 2017**, the layout breakpoint computed in JavaScript rather than in CSS, a separate ES2017 build beside the modern one, `/hitno` working without JavaScript and without styles, and published measurements of under 200 kB transferred per screen load, under 300 MB of memory, running on a 1 GB device. Everything below follows from that document, which is the authority.

R-L1 Two paths for every new visual capability, decided once at each entry and passed down as a dependency exactly as `reducedMotion` already is. `lightweight` is true when the URL carries `?lagano=1`, or when `navigator.deviceMemory <= 1`, or when a WebGL context cannot be created, or when `matchMedia('(prefers-reduced-data: reduce)')` matches. The flag is written to `document.documentElement.dataset.lagano` so CSS can answer too, and it is remembered in `localStorage` under `vidikovac-lagano` once auto-detected, so the detection runs once per device.

R-L2 What each capability degrades to, with no apology in the copy:
- Panorama: no canvas. The legend text stands alone in mono under the header (it already carries the vehicle count and the time), and the band becomes a 2 px ink rule. The page still says what the panorama would have said.
- Meander: no canvas. A `div` with a background width in percent, stepped in ten quantised steps, inside the same figure with the same legend. No transition.
- Schematic map: no canvas. The same data as a list: the nearest stops with the lines calling at them, tram rows first, each with the route label and the route's median delay in words. It is the honest lightweight face of seeing the trams around you.
- Full MapLibre map: hidden entirely; its button is not rendered.

R-L3 No container queries on a path lightweight mode uses. The kiosk sizes itself from a JavaScript-computed scale written once to a CSS custom property on the kiosk root (`--kiosk-scale`, from the element's own width), and every size is `calc(var(--kiosk-scale) * N)`. Modern browsers get the identical result; 2016 browsers get a working layout. `cqh` and `cqw` units are not used anywhere in kiosk.css.

R-L4 Budget: a lightweight screen load transfers under 200 kB, fonts included. `app/public/data/zet-network.json` is never fetched in lightweight mode, and in modern mode it is fetched after first paint, never as part of the entry chunk. A test sums the built lightweight entry chunk, its CSS and the fonts it references and fails over 200 kB.

R-L5 The separate ES2017 build target and the tested-device matrix in `docs/kiosk.md` are project commitments with their own tasks later in the grant period, not iteration-2 deliverables. What iteration 2 must guarantee is that no new code makes them impossible: no syntax newer than ES2017 in the app source, no CSS feature newer than 2017 on a lightweight path, and every new capability already has its lightweight twin. Implementers state in their report which of the two paths they exercised.

## Area ownership (three parallel loops, wave 1)

M (restyle): `app/src/ui/**`, `app/src/kiosk.ts`, `app/src/dashboard.ts`, `app/src/panels/**`, `app/src/scan.ts`, `app/index.html`, `app/s/index.html`, `app/src/entries/**`, `app/src/format.ts`, `worker/hitno/render.ts`, `worker/open/index-page.ts`, `worker/stats/page.ts`, `test/app/*` for the files it owns, `e2e/a11y.spec.ts`.

T (motion): `scripts/**`, `app/public/data/**`, `app/src/motion/**`, `app/src/map/**`, `app/src/layers/u-pokretu.ts`, `worker/feed/modules/zet-rt.ts`, `worker/feed/schema.ts` (the `vehicle` key list only), `test/motion/**`, `test/scripts/**`, `e2e/motion.spec.ts`.

E (events): `worker/feed/modules/dogadanja/**`, `worker/feed/html.ts`, `worker/feed/hr-date.ts`, `worker/feed/schema.ts` (the `ModuleId`, `ItemKind` and `event` additions only), `worker/feed/registry.ts`, `app/src/layers/kultura.ts`, `app/src/layers/uprava-i-pravo.ts`, `app/src/layers/index.ts`, `docs/izvori.md`, `app/src/data/izvori.json`, `test/feed/**`, `test/docs/**`.

R-O1 `app/src/map/city-map.ts` belongs to T alone. T applies the Modrotisak colours there (closures `#ff9d9d`, vehicles `#f2ead8`, stroke `#16226b`) as part of its own work; M does not touch the file.

R-O2 `app/src/format.ts` belongs to M alone. M adds **both** `zagrebWeekdayDate` (its own need) and `zagrebDayKey` (E's need) in the same task, and E imports them.

R-O3 `worker/feed/schema.ts` is edited by T and E on different lines (T removes two keys from `DATA_KEYS.vehicle`; E adds a `ModuleId`, an `ItemKind` and the `event` key list). Both keep their edits minimal so the merge is mechanical.

R-O4 `app/src/kiosk.ts` is the choke point: M restructures it (wave 1), then T adds the locked schematic and E adds the teaser card (wave 2, after M merges to main).

R-O5 Wave 1 runs M1 to M9, T1 to T6 and E1 to E6 in parallel worktrees. Wave 2 runs T7 to T11 and E7 to E9 after M is merged, on branches rebased onto that main.

R-O6 Line endings are LF (`.gitattributes`); after a merge, re-checkout with `git rm --cached -r . && git reset --hard` before running the suite, exactly as stage 1 did.

## Product rulings carried from the plan

R-P1 The locked kiosk is a public service. Its stage shows the live cropped tram map (trams only by default, about five to six stops around the screen's configured centre, default Trg bana Jelačića), the panorama shrinks to roughly a third of its drawn height directly under the header, and the invitation headline moves under the map above the catalogue row. `teaserSubset('zet-rt')` keeps the vehicles inside that box with their route type and the per-route delay rows instead of stripping them to a count. T9's sentence about the locked kiosk keeping only the panorama is overridden. The centre, radius and mode are beacon properties with a default, and the proposal offers per-screen configuration in the full version.

R-P2 Never display a reported position. Every vehicle is drawn where the motion model computes it: fixes snapped to the route geometry, speed from that vehicle's own fix times, animation at the screen's refresh rate, and gentle convergence onto a new fix instead of a jump. The panel says so in one sentence.

R-P3 The Worker stops publishing `bearing` and `speed`: ZET never sends them and the module was emitting a fabricated zero for every vehicle.

R-P4 Light `--tone-text-subtle` is `#575f7d`, not the spec's `#5d6890`, which fails the contrast gate on the light `surface-2`.

R-P5 Two sources named in the events brief are dropped for robots.txt reasons and the documents must say so: Guru za kulturu (its events come only from a disallowed `/api/` path) and the Skupstina YouTube Atom feed (`Disallow: /feeds/videos.xml`); the channel's live page is linked from plenary sessions, because linking is not crawling.

R-P6 Every source keeps headline-level metadata only: title, time, venue, organiser, link, category. Descriptions are never copied, with the single exception of the communal-works activity field, which is Otvorena dozvola data rather than a borrowed description.

## Core message and the kiosk's own usefulness (Matija, 12 September, two corrections)

R-P7 The gate unlocks the city **on your own device**, and never withholds it from the screen in front of you. A kiosk with a touchscreen therefore carries its own essentials view, reachable with one touch and no phone: the safety layer, the next departures at that screen's stop, the weather, the closures. It needs no session and runs no timer; after ninety seconds without a touch it returns to the invitation. This is not a concession to the mechanic, it is the same principle `/hitno` already follows, and the proposal can say so plainly. Implementation lives with area M (it edits kiosk.ts, which M owns in wave 1) as task M3b.

R-P8 The proposition is not "you pay with attention". It is: a premium view of the city, whose limits exist to push you back into it. You accept a short window and a scan that needs another screen or another person, and in exchange you get everything; the limits are the point, not the price. They raise real encounters between people, businesses, culture and institutions, and they cut screen time rather than farm it. The app is deliberately good enough to stand in for the infinite feed, and deliberately short enough to hand you back to the street. Every surface and the filed proposal must carry that reading; the phrase "Placas paznjom, ne novcem" is retired wherever it appears (kiosk invitation, landing page, `docs/prijava/prijedlog-projekta.md`, design.md).

## Rulings on wave-1 implementer decisions (controller, after area E merged)

R-E1 ZET notices carry `at` from `<pubDate>`, precision `time`. E5 read "headline and link only" as excluding the timestamp; that phrase meant no borrowed prose (R-P6), and a publish time is a machine fact, not prose. Without it E6 sorts every ZET notice to the very end with `-Infinity`, so a traffic disruption posted five minutes ago ranks below a communal-works row last touched in July. Task E6b (wave 2, before E7) fixes this in E's own files and removes the `-Infinity` special case, since after it no item is dateless.

R-E2 E6's `sourceCounts` riding on the snapshot as an extra property is accepted. The cache layer spreads the snapshot and the field survives; the panel (E7) and `/stats` may read it, and the honest "which source went quiet" line depends on it.

R-E3 E6 touched `test/app/izvori.test.ts` (M's directory) to count ten modules. Accepted: M never edits that file, so the merge was mechanical, and the alternative was a red test on main.

## Rulings on T1's flagged decisions (controller, while T5 runs)

R-T1 `ON_MAX_PER_STOP = 12` is removed. The stop gate (T4 `nextStop`, T5 dead reckoning) inverts each stop's `on` list into per-shape stop fractions; a cap means the busiest interchanges, Trg bana Jelačića first among them, are missing from some shapes' stop lists, so a tram can be dead-reckoned straight through the main square. That is a correctness defect at the one place every screen looks. Every association within 40 m is kept. Task T6b (wave 2, before T7) removes the cap, regenerates the artefact, and adjusts the tests.

R-T2 The byte budget that the filed proposal cares about is what is transferred, so the gzip gate (130 KiB) is the primary one and stays. The raw gate moves to 600 KiB to make room for R-T1; the KiB reading is the one enforced, stated in the test's constant names. `zet-network.json` is never fetched in lightweight mode and never part of an entry chunk, so neither number touches the 200 kB screen-load promise.

R-T3 The struct-of-arrays wire format is accepted: T4 already decodes it and was approved, and the arithmetic the implementer showed is sound. T6b updates the "artefact's shape" block in area-T.md and T11 documents the real format in `docs/arhitektura.md`, so the sketch in the brief stops misleading anyone.

## Ruling from the cross-area review of merged main (controller)

R-X1 `fetchDogadanja` must throw when **every** source fails. Today it never throws, so `worker/feed/cache.ts` stamps `status: 'live'` on a zero-item snapshot, writes it over the KV last-good copy, and serves it for the full 900 s. A total upstream outage therefore renders as "Živo · nema događanja", which on a public screen reads as *nothing is on in Zagreb tonight* rather than *we could not reach the sources*. That is exactly the dishonesty the live/stale/down pills exist to prevent, and honest source status is a claim the filed proposal makes. `worker/feed/schema.ts:98` states the contract ("Must throw on any upstream failure") and `hrt-news.ts:71` is the precedent, throwing when both its feeds fail. One source dying must still never empty the panel; six dying must degrade to the KV copy as `stale`, and past `maxStale` to `down`. Fixed in E6b.

The other four seams came back sound after adversarial verification: the vehicle data contract has no consumer left reading `bearing` or `speed`; the Kulturpunkt licence boundary holds in code, since the session tier gates `/open`, the catalogue and the kiosk teaser; the artefact's columnar format decodes to real Zagreb coordinates through T4's decoder and is served as a static asset, never inside an entry chunk; and the motion model's honesty rule survives every probed branch, with the drawn position converging rather than jumping. Two motion findings were refuted on reachability, because nothing mounts the model until T9, which is a reason to re-run this review after wave 2, not to discount it.

R-X2 `docs/izvori.md` says everything derived from the listed sources is published at `/open` under the Otvorena dozvola. That sentence predates this merge and already sat above non-open rows, so it is not a new defect, but it is now above a CC BY-SA row and it is a licence statement in a filed application. E9 makes it precise: name which tiers reach `/open` and say plainly that session-tier sources do not.

## Ruling from a heading sweep of the restyled surfaces (controller, while M runs)

R-M1 `/d` is the only surface with no top-level heading. The landing page, the scan page, the kiosk (M3 made the invitation its `h1`), `/hitno` and `/open` all have one; the dashboard's header holds a paragraph, a countdown and two figures. A screen reader landing in a session therefore finds no document heading, and the first heading it meets is a panel's. The fix belongs to M9, which owns the accessibility pass, not to a rewrite of M4's header: add one visually hidden `h1` naming the app and the active layer, update it whenever the layer changes, and make it the focus target on unlock. Hidden is right here rather than a cop-out, because the visible equivalent genuinely exists already as the selected tab, and a second visible copy of the layer name directly above that tab row would be noise.

## Model assignment (Matija, 12 September: "use fable for agents that have hardest tasks")

R-Q1 The loop driver takes a per-task `model` and `reviewModel`. Default stays Sonnet. Fable implements T7 (the schematic painter, pure geometry that every screen will stare at), T9 (mounting the motion onto both surfaces with the tap card and the honesty note), T10 (the MapLibre map with SDF icons, 12 Hz source updates and the ring-preserving full-screen mode) and E8 (the licence boundary proven end to end on the kiosk). Fable reviews T7, T9 and T11 (the end-to-end proof). Escalation after BLOCKED, the review retry, and fix rounds four and five all go to Fable instead of Opus. Loops already running keep the models they started with, because changing an agent's options would invalidate its cache and re-run finished work.


## Rulings from the production screenshot after T9 (controller, 12 September 15:58)

R-V1 The kiosk stage at 1920 by 1080 has budgets, not a flow. Header 120, panorama strip 88, safety strip 120; the stage takes what is left and never grows past it. In the left column the schematic is the `1fr` row and the dominant element (about 380 px), with the headline row at 96 (title 52, one line), the meander at 72 plus legend, and the catalogue at 96 pinned last. The production screenshot showed the catalogue rows printed over the Osnovno button and the warnings text while the map sat in a 300 px square. Task T12.

R-V2 Vehicles must contrast with the lines they travel on. Route lines are `--tone-label` at alpha 0.55; vehicles are `--tone-text-primary` at alpha `0.55 + 0.45 * confidence` with a one-pixel canvas-coloured halo; minimum on-screen sizes bus 10 px square and tram 14 by 5 px. The production screenshot had fifteen trams in frame and none visible, because ink-coloured trams lay on ink-coloured lines. Matija asked for blue squares against the cloth, tram visibly thinner. Task T12, with pixel readback in the e2e proof so "the legend says 15" and "a person can see 15" stop being different things.

## Rulings from the whole-iteration review (controller, 12 September, 20 findings confirmed; area F)

R-F1 An along-track gap on the same shape is the model being behind, never wrong, so it never snaps. The 150 m snap keeps its place only where the model is wrong about which line or where across it (cross-track residual, shape change). Behind, the catch-up cap rises to `max(2 × speed, 8 m/s)` when the gap exceeds 50 m so a poll-interval lag closes in one poll interval. The stop gate holds for a dwell of 25 s, then continues at half speed and lowered confidence bounded by the following stop, so it stops manufacturing the very lag the snap was resolving. Verified in code by the controller: `convergeScalar` snapped on `|target − cur| > 150` regardless of cause, and the gate at model.ts:481 created exactly that gap once a minute in the reviewer's reproduction.

R-F2 Vehicles absent longer than `STALE_S` are evicted, not flagged; `size()` shrinks. The legend denominator counts fresh vehicles matching the crop's type filter, so "praćenih vozila u kadru" is exactly true and per-frame cost stops growing with uptime.

R-F3 Lightweight mode loads no webfonts. Croatian text pulls latin and latin-ext of every face, 207 to 248 kB of woff2 on their own, against a filed promise of under 200 kB per screen load. The system stack is the honest degradation, as the canvas-free panorama is. The budget test R-L4 mandated is written and sums the real lightweight graph.

R-F4 A 2017 engine must lay the kiosk out: `100vh` before `100dvh`, explicit height beside `inset-block`, the `data-mode` attribute instead of `:has()`, margin fallbacks beside flex `gap` on lightweight-rendered lists. R-L5 stands for the ES2017 build and the device matrix.

R-F5 The moving map has a text path: a visually hidden list of drawn vehicles as buttons that open the same card, the card a real dialog that takes and returns focus, and the map container a region so MapLibre's controls and the OSM attribution link are exposed by name.

R-F6 Nothing animates off screen: freeze pauses both maps, the essentials view pauses the stage schematic, and the lightweight and reduced-motion loops use the 1 s timer only and park.

R-F7 `/izvori` renders the per-source rows the application says are there, and the `/open` lede claims republication only for open-tier modules.

Model assignment (R-Q1): F1, F2 and F4 implement and review on Fable; F3 on Sonnet. F2 waits for T12 to merge because both edit kiosk.css. F1 then F4 run sequentially in one worktree because both edit schematic-view.ts.

R-V3 The vehicle alpha floor is 0.7, not 0.55. On the light face a 0.55 ink mark over the cream halo composites to a desaturated grey and reads as a grey dash beside a blue line; Matija asked for blue squares. T12's implementer flagged it and named the knob. The ceiling stays 1.0, so confidence still shows.

R-F8 The lightweight list shows the lines in frame, not the stops. R-L2 asked for nearest stops, but stops live in the network artefact that R-L4 forbids the lightweight path to fetch, so on production the list under "18 od 45 praćenih vozila u kadru" read "Trenutačno nema stavki" and the stage stood empty. Everything the honest list needs is already on the wire: one row per route among the fresh, type-matching vehicles in the crop, trams first, with the count in frame and the route's median delay in words. Task F5, after F4 merges (same file).

R-F9 The lag comes from two constants the controller set and now changes. After the 25 s dwell the gate releases at full speed, not half, because after 25 s at a platform the likelier truth is that the tram left; the half-speed release built 87 to 375 m of lag per stop in the reviewer's measurement. Under 50 m of gap the settle cap is `max(1.5 × speed, 6 m/s)` so the mark can gain on a target moving at `speed`. Release confidence is `min(confidence − 0.2, STOP_GATE_CONFIDENCE_CAP)` so release never reads more certain than the hold. Thresholds are set from measurement and both the aimed and the reached values are written in the test; the two absolute invariants (no frame beyond the cap, no snap after the first fix) stay. F1's implementer was right to pin the envelope rather than relax it silently. Task F6, with F1's leftovers.

## Pending decisions at the pause (12 September, late evening)

P-1 The essentials board's row geometry (56 px values, about 215 px of header) fits two full rows above the strip at 1080p; with warnings, closures, lines, weather and pharmacy all populated it still scrolls inside its own panel, which R-P7 promised it never would. F5 fixed the pair that production showed and flagged this. Decision for after the pause: smaller value size (40 px) and a two-column row grid so five rows fit, or accept the scroll and drop the promise from the ruling. The controller leans to the first.

P-2 F6 measured p95 lag of 92 to 254 m with the R-F9 constants against the 120 m target. The implementer's hypothesis: speed is the median of 30 s fix intervals that include dwell time, so a tram cruising at 10 m/s is estimated near 7 and reckoning falls behind on every cruise. Decision for after the pause: estimate speed from intervals judged to be moving (exclude intervals whose vehicle was held or repeated coordinates), or take a higher quantile than the median. The controller leans to excluding held intervals.

P-3 `docs/arhitektura.md`'s constants table is stale after F1, F6 and R-F9 (names, values, the eviction rule) and the map's timer pair is bound only under test, not in production wiring. Both are small follow-ups on files outside T's list.

## Rulings on the pending decisions (Matija: "proceed", 12 September late evening)

R-F10 (was P-2) Speed is estimated from the moving part of each interval. Byte-identical repeats set speed to 0 now and never enter the history; an interval that crosses a known stop has an assumed dwell of 20 s subtracted from its duration, never below a third of it; the history keeps the last three moving intervals and the estimate stays their median, clamped to 22 m/s. F6 measured the lag and named this lever; the controller accepts it. Task F7, which re-measures the eight runs and pins the envelope again, with all three constant sets recorded side by side.

R-F11 (was P-1) The essentials board fits every combination on one 1080p screen without scrolling: header at most 140 px, five rows as a two-column grid with 40 px values and two-line details, `overflow: hidden` as the last defence and a test that it never engages. R-P7 promised no scrolling and a kiosk has no scroll wheel. Task F8, after F5 merges (same files).

R-F12 (was P-3) `docs/arhitektura.md` gathers every model constant with its reason, as it claims to; the loop comment stops mentioning stale vehicles; the map's timer pair is bound in production through a `withTimers` binder beside `withNetwork`. Folded into F7.
