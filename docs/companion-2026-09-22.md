# Kaj ima? — companion brief (research, interviews and the implementation plan, 21–22 September 2026)

Status: **approved by the owner on 22 September 2026 (evening) for execution.** The owner read the whole brief and made no further amendments; the coding session starts from §15. §15 is the master implementation plan; its execution files live in `docs/history/companion-2026-09-plan/` (moved there from `docs/companion-2026-09-22-plan/` once executed, WP7). Evidence folder: `review.local/companion/` (ledger, code-reality maps, walkthrough captures, path-monitor logs, wrong-turn dossier, replay baselines, planner notes, references, the mock). File name to be dated by the owner at completion; brief and plan folder are committed together on their own branch, not pushed [O-57].

## 0. How to read this brief

Every statement carries a tag. **[O-n]** a verbatim owner statement (round, chair). **[B-n]** an observation on production with capture id, slot and build hash. **[C-n]** a code fact with a file path. **[D-n]** a data fact with module status and time. **[A-n]** a prior audit or an agent's concept. A statement with only an [A] tag is a proposal, never a finding. The owner speaks from three chairs: **rider** (what you reach for on the street), **author** (what you built and why), **producer** (what the opening shot must say). Recommendations appear only in §10–§15 and each cites an [O] or a [B].

The interview is not a survey. Rounds R0–R3 happen before any screen is shown; the current design is judged only from R4 on, against the owner's own words.

## 1. Fixed decisions and non-goals

| Decision | Source |
|---|---|
| Deliverable: this Markdown brief in `docs/` plus the execution files `docs/history/companion-2026-09-plan/WP0…WP6.md`, committed together on their own branch when final, not pushed. §15–16 and the plan files are an execution-grade plan: the coding session starts by executing, not planning. | [O] planning, 21 Sep; [O-55], [O-57] |
| The presence gate stays exactly: ten minutes via a screen's code or a friend's phone; five minutes one hop; `/hitno` the only always-open layer. "Daily driver" means: whenever I am near a screen or with people, this is the thing I reach for. | [O] planning, 21 Sep |
| No accounts, no tracking, no push, no route planning, no invented arrival estimates beyond the labelled ZET estimate; the submitted application text stays byte-identical (WP7 may add an optional, default-off notes layer beside it). | `PRODUCT.md`, `docs/prijava/`; [O-75] |
| Observation on production: at most one temporary screen per day; never another's screen; scans under six per minute. | ground rules |
| Wrong turn: diagnosed read-only to a named cause with evidence; other trust-breakers catalogued. | [O] planning, 21 Sep |
| Brief in English, product strings in Croatian. | [O-4] |
| Copy: standard, natural Croatian (književni), gender-neutral for things, never "zid" on the frontend ("zaslon" is the word); every new or changed Croatian string is read by the owner before it ships. | [O-66] |

*Reopened items: none. The non-goals hold; every open point is a row in §17 with the default the plan takes.*

## 2. The owner in their own words

*Planning message, 21 Sep (author chair):*
- "every pass we did on kajima in the last 10-15 days or so has brought incremental improvements, but i'm still not satisfied with the overall impression."
- "trams sometimes (often actually, noticed 2 times in a single 10 minute session) take a wrong turn at intersections and then soon they recover and move back and on the proper path - looks horrible and instantly destroys any feeling of reliability."
- "i feel its nowhere close to intuitive and however many times i said 'ux centric', is anything but. my impression is that somehow we managed to tuck away most of the amazing nature of this app, the core vision, first of all in regard to data sources, but then also the practical usability."
- "right now, its simply not an app that i'd want to use as a daily driver"
- "slop is visible when you start using the app practically and realize that the data flowing from sources is simply not comprehensive enough for the code that we built. that is not a justification for our app bc even if sources are much richer it can legit happen that they simply have nothing to show - and its the core of our apps job to mitigate that"
- "if we call it a companion app, companion never lets you down right, its always useful and it serves you with what you need as soon as you need it."

*CP0 (author chair):*
- [O-1] Wrong-turn sightings were on phone Karta only; "my sightings are highly anecdotal".
- [O-2] "i saw 14 continuing straight south on draskoviceva instead of turning to jurisiceva and i saw 17 from main square turning to praska instead of continuing forward to jurisiceva. from what i've seen i'm fairly certain its not about tram numbers or specific intersections, it looked like a bug with gps data to me or something like that, if the position drifted a bit the animation took it that way and then corrected itself."
- [O-3] Recovery: "dont remember, i dont think it slided back."

*The planned rounds R0–R12 were replaced by the thematic rounds of 21–22 September logged in the ledger ([O-1]…[O-61]); the quotes above are verbatim.*

## 3. The city as the owner describes it (in place of the diary)

The owner declined the moment diary as a format [O-9] and gave the context that replaces it [O-5]–[O-11]:

- Zagreb is "a city but a small one": ~800,000 residents, at most 1–1.1 million people on a busy day; Dubrava to Stenjevec on foot in two hours; the inner city (above the railway, below the Sljeme foothills, between Kvatrić and Črnomerec) is a 60-minute walkable circle where one is never more than about five minutes from a tram stop. A city at "the edge between a town and a city"; comparisons with Vienna, Prague or Sofia mislead. This scale explains the low content volume and must shape the product: volume **and** frequency are low; one weather station is enough [O-5], [O-6].
- The pace is slow and unalarmed: "not as fast, urgent or accustomed to big shocking news". The failure modes are therefore kitsch (intending sophistication) and information crowding that causes anxiety (intending currency) [O-7].
- "You do want to give people everything … but they can't want it if they don't use it and they can't use it if it's not clear and intuitive. UX to reach information is as important as the information itself" [O-8].
- Working hypothesis for the prototype: kiosk screens around town, placed by the city and by businesses that already have a TV on the wall showing whatever during the day; the screen is "a reason to walk inside, a sign of modern life" [O-10].
- The owner's ask of the session: "it's all there and just needs an expert designer hand and brain to execute" [O-11]. Consequence for method: fewer questions, concrete proposals and mocks to react to.

**Answer units** that the surfaces must deliver (derived from the rounds, not from a diary): the next departures at the nearest stop with line, destination and a tracked-vehicle countdown or a timetable clock time; one written sentence about the city here and now; what is within a 2 km / ~15 min circle in the coming hours; the last tram tonight and the first tomorrow; the 24/7 pharmacy; where am I and what is this place. Audiences the quiet wall must serve: riders, cyclists and drivers, visitors who do not know where they are; deliberately **not** everyone at once [O-18], [O-28].

## 4. Companion definition: fallback ladder and the empty evening

Decided with the owner through mocks v1–v5:

1. A departure row always exists (timetable when no vehicle is tracked), never more than three [O-27], [O-32].
2. Blue "za N min" means a tracked vehicle; a grey clock time means timetable. No word "procjena", no fetch times, no disclaimers on the wall [O-27].
3. The last departures of the evening enter the feed four hours ahead as one row listing the lines; the first morning tram stays in the feed from 22:00 until it leaves [O-38].
4. Only the next solar event is shown, never sunset and sunrise together [O-48].
5. When the evening empties, the feed is not padded: rows grow (to about a third taller, type with them) and the horizon extends by itself into the next morning (first tram, sunrise, tomorrow's market and museum opening hours from the catalogue) [O-40]–[O-42].
6. Timeless rows ("uvijek") carry the place: the square's naming story and a protected building nearby, alternating; the owner accepts these as good, in contrast to the current register fillers with disclaimer captions [O-49], [O-37].
7. At night: the 24/7 pharmacy as the green cross symbol with address [O-39]; the night bus every 40 minutes; the dark solar palette with the real night basemap [O-36].
8. In a ZET outage: the map remains a map (network, stops, BAJS, closures, places) without vehicles, one quiet note on the map, every departure a grey timetable time, and the header sentence says what is known. Nothing shouts "nedostupno" [O-37], [O-45].

## 5. Presence gate × daily driver

Fixed by the owner before the session: the gate stays exactly [O planning]. The daily-driver claim is therefore "whenever I am near a screen or with people, this is what I reach for". The session's design consequence is that the ten-minute visit must answer before it explains: the phone opens on one sentence about the city and the departures, with no heading, instruction or count above them [O-12]; the wall must be worth a glance from three metres without a phone at any hour (§4, §11).

## 6. Observation report

### 6.1 Slot 1720-mon (Monday 21 Sep, 17:20–17:55 Zagreb, evening peak, build b300af3)

Full report: `review.local/companion/walkthroughs/1720-mon/report.md`; captures in `captures/`. All modules live; no DHMZ warnings; 135 event rows; 456–473 vehicles city-wide.

**First viewports** (share of viewport height per class; ANSWER = actionable fact with place or time):

| Surface | ANSWER | CONTEXT | INSTRUCTION | COUNT | CHROME | INVITE | EMPTY/DISCLAIMER |
|---|---|---|---|---|---|---|---|
| Kiosk 1920×1080 | 79 % (map 76 %) | 10 % | 0 | 0 | 17 % | 21 % | 6 % |
| Phone Sada after redemption | 19 % | 16 % | **8 %** (one sentence, the tallest text unit) | 5 % | 23 % | 0 | 6 % |
| Phone Sada with a saved stop | 34 % | 12 % | 0 | 3 % | 21 % | 0 | 13 % |
| Phone Karta cold open | **0** | 89 % (canvas, no vehicles) | 0 | 2 % | 41 % | 0 | 5 % |
| Phone stop detail after search | **0** (arrivals below the fold) | 89 % | 0 | 0 | 73 % | 0 | 5 % |
| Phone Događanja | 28 % | 36 % | 0 | 2 % | 22 % | 0 | 11 % |
| Desktop Sada 1440×900 | 24 % | 35 % | 5 % | 4 % | 20 % | 0 | 12 % |
| Desktop Karta cold open | 10 % | 90 % (canvas, no vehicles) | 5 % | 12 % | 39 % | 0 | 3 % |

**Scenario results** [B-11]–[B-16]:
- "Tram 6 towards Črnomerec from Trg bana Jelačića", nothing saved: the answer never entered the viewport within 20 s (Karta → search, stop ranks second below a street, detail opens at half height with arrivals below the fold, visible rows show 6 only towards Sopot). With the stop saved: Sada answers in 0.09 s but shows three rows only; 6 → Črnomerec absent.
- "What's on tonight": no tonight filter; today = two all-day items, zero timed evening rows, five ongoing exhibitions, twelve undated notices.
- Karta cold open to a drawn vehicle: 3–4 taps, plus one more to see them because "Kretanje" opens the sheet over the map.
- "Podijeli grad": 2 taps via the countdown pill; "Zaslon": 1 tap.
- Desktop: no vehicles anywhere without configuration.

**Kiosk, ten minutes of rotation** [B-17]–[B-19]: 16 distinct highlights over 30 turns; closures 15 turns, culture 7 (four items from one museum), **"Upoznaj ovo mjesto" register fillers 28 % of wall-clock** with disclaimer captions, although 135 event rows exist (only four located in the camera window). Context chip empty throughout. Map inert to touch. From three metres (DPR 0.25 proxy): brand, clock, temperature, the closure and its street, the QR lead, code, verdict and pharmacy read; every freshness and credit line, the kicker, "Zaustavi", the benefit sentence, the legend and attribution do not.

**Empties classed**: Sada instruction — design; Karta without vehicles — design; empty kiosk chip — design; register fillers — data-thin met by a design fallback; "tonight" empty — data-thin plus no filter; "mirno" — a true empty.

### 6.2 Slot 2130-mon (Monday 21 Sep, 21:30–21:52 Zagreb, late evening; kiosk in the dark solar theme)

Full report: `review.local/companion/walkthroughs/2130-mon/report.md`. All modules live; no warnings; 363 vehicles; 135 event rows.

The first viewports are structurally the same as at 17:45 [B-26]: the phone opens on the same instruction sentence, the same two counts and no departure; Karta opens with no vehicles; the stop detail keeps its arrivals below the fold; the kiosk aside gives 21 % of its height to the invitation and the context chip stays empty. What changes with the hour is the content of the one rotating highlight [B-27]: over ten minutes, 16 distinct highlights in 30 turns, of which **31 % of wall-clock time were register fillers** captioned with disclaimers, the rest eight closed streets ("Do 22. 9. hh:mm") and four ongoing museum items. Events for the coming week: 11, of which 5 ongoing; today 3; no tonight filter [B-28]. Taps to a vehicle on Karta: 4 [B-29]. Zero console errors and failed requests.

### 6.3 Slot 0430-tue (Tuesday 22 Sep, 04:30–04:52 Zagreb, quiet-hour control; kiosk dark)

Full report: `review.local/companion/walkthroughs/0430-tue/report.md`. All modules live; no warnings; 325 vehicles reported by the twin at 04:32 (to be checked against what actually runs at that hour); 135 event rows; today's events 3–4.

The first viewports are again identical in structure [B-30]. The rotation shows **the same sixteen highlights as at 21:30** [B-31]: eight closures whose end times have simply moved to the next day, four ongoing museum items, four register places, fillers 27 % of the time. At the hour when a wall could say "first tram at 04:16, night bus every 40 minutes, pharmacy open", it says the same as the evening before. The composition has no notion of the hour.

### 6.4 Slot 0745-tue (Tuesday 22 Sep, 07:45–08:07 Zagreb, morning peak; kiosk light)

Full report: `review.local/companion/walkthroughs/0745-tue/report.md`. All modules live; no warnings; 530 vehicles; 135 event rows; today's events 3–4.

Same first viewports for the fourth slot [B-34]; the same sixteen highlights on the wall [B-35], fillers 30 % of the time. At the morning peak, with 530 vehicles moving, the wall's mobility content is eight closed streets and the phone's first screen has no departure. The pattern across 17:45, 21:30, 04:30 and 07:45 is therefore established: the current composition is the same at every hour, and what varies is only the freshness stamp.

### 6.5 Slot 1230-tue (Tuesday 22 Sep, 12:30–12:52 Zagreb, midday)

Full report: `review.local/companion/walkthroughs/1230-tue/report.md`. All modules live; 463 vehicles; 138 event rows; today's events 3, timed tonight 1.

The fifth slot closes the matrix of hours [B-38]: the first viewports and the kiosk's sixteen highlights are the same at 04:30, 07:45, 12:30, 17:45 and 21:30; fillers 26–31 % of the wall's time in every slot; the phone's first screen never showed a departure without a saved stop; Karta never opened with a vehicle; the stop detail never showed an arrival above the fold; a vehicle on the map costs four taps at every hour.

### 6.6 Across the five slots

| Measure (current build) | 17:45 Mon | 21:30 Mon | 04:30 Tue | 07:45 Tue | 12:30 Tue |
|---|---|---|---|---|---|
| Phone Sada first screen: instruction / counts / departures | 1 / 2 / 0 | 1 / 2 / 0 | 1 / 2 / 0 | 1 / 2 / 0 | 1 / 2 / 0 |
| Phone Karta cold open: answers / vehicles drawn | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Taps to a vehicle on Karta | 4 | 4 | 4 | 4 | 4 |
| Kiosk: distinct highlights in 10 min / register fillers | 16 / 28 % | 16 / 31 % | 16 / 27 % | 16 / 30 % | 16 / 26 % |
| Kiosk context chip | empty | empty | empty | empty | empty |
| Vehicles city-wide | 456–473 | 363 | 325 | 530 | 463 |
| DHMZ warnings | 0 | 0 | 0 | 0 | 0 |
| Events today / timed tonight | 2 / 0 | 3 / 0 | 3–4 / 0–1 | 3–4 / 0–1 | 3 / 1 |


## 7. Trust-breaker catalogue

| # | Glitch | Evidence | Severity and package |
|---|---|---|---|
| T1 | Trams change planned path mid-trip: variant swaps, direction flips, other-line adoption; the phone snaps the mark | [B-E1] 41 events / 28 min in the centre box; [O-2] | — |
| T2 | Share-dialog QR announced to screen readers as the raw key `kiosk.qrLabel` | [C-C1] `app/src/dashboard.ts:846` | — |
| T3 | Fetch time printed as the publisher's "posljednja izmjena" for closures | [C] `worker/feed/modules/prometnice.ts:108-110`, `app/src/attribution.ts:50-51` | — |
| T4 | Kiosk QR drawn at 216 px inside the 240 px plate | [B-17] | — |
| T5 | Reload drops the screen label; pill degrades to "zaslon" | [C] `app/src/entries/dashboard.ts:112-116` | — |
| T6 | Anyone at the wall can end a stranger's presentation with one click, no confirmation | [C] `app/src/kiosk.ts:397-405` | — |
| T8 | A vehicle that goes silent in ZET's feed is animated along its prior path for up to 300 s at a confidence the viewer never sees, then vanishes; a short-turned tram is off the map for the whole detour | [B-E4] replay of 22 Sep 11:53–12:07, vehicle 10472; `shared/motion/plan.ts` silenceDecay (hold 30 s, half-life 60 s), `worker/twin/tick.ts` TRACK_STALE_S 300 | rule: hold after ~30–60 s, fade, drop at ~120 s; never extrapolate a silent tram past its next stop (plan: hold at 30 s, linear fade, drop at 180 s because of the measured terminus silences, §17 Q2) |
| T7 | Merged vehicle pills abbreviate to one number plus "+N" ("6 +3", "2 +11"), hiding which lines are there | [O-35]; [B-2] wall capture 17:38; [C] `app/src/motion/pills.ts` label budget | owner: "terrible… useless information"; rule: list every line, let the pill grow |

T1, T2, T3, T6, T7 and T8 are WP0 (deploy D1); T4 (the QR floor) is WP1; T5 (reload drops the screen label) has no package yet — §17 Q23.

## 8. Wrong-turn dossier — diagnosed by replay (21 Sep)

Evidence: `review.local/companion/wrong-turn-dossier.md` and `review.local/companion/replay/README.md` (two recorded days replayed through the production tick with a read-only grader that reproduces the live monitor's 28-minute window one for one).

**Scale.** Sunday 20 Sep: 3,800 same-trip path changes over 1,595 tram vehicle-hours (2.4 per vehicle-hour); Monday 21 Sep to 19:30: 4,446 over 2,233 (2.0). Only 58–64 % of tram time was spent on the trip's own path; 85–116 vehicle-hours a day were spent riding **another line's path**, for 10–14 minutes at a time (max 8.4 km). Every server path change reaches the phone as a re-seed; about half move the mark more than 50 m, p95 630–680 m.

**Cause.** One mechanism with two faces, both in the matcher. (1) When the tram leaves its path, the matcher re-derives onto whichever path runs the nearest edge with no preference for the trip's own path or route (`adoptPath` `pool[0]`, `restrictToRoute=false`), and the adopted path then outranks the prior until the trip ends, even when the own path is within 60 m at 72–80 % of the following fixes [C]. (2) The pool of candidate paths includes paths of patterns whose **service is not running that day**: the `17_15` / `9_5` hot spot at Trg žrtava fašizma is a running (service 0_25 on Sunday, 0_23 on Monday) shapeless trip of route 17 re-derived onto the shape path `17_15`, whose only pattern runs on service 0_20 and ends at Trg žrtava fašizma; the tram then runs off the end of that path and flips back (176 and 200 events on the two days, prior path `path:17:0:…` in every one). The earlier reading that "shapes end early" was wrong: re-running the coverage check shows every tram pattern within 60 m of its resolved path except seven terminus cases (Zapruđe 130 m past the end of route 8; line 1's Zapadni kolodvor trims) [C] (`review.local/companion/plan/WP0/notes.md`, `scratch/coverage.mjs`; services seen per day in `replay/branches-0920.json` `servicesSeen`). What remains in the artefact: the latent Glavni kolodvor connector (the 3,242 m `longLegs` detour for 511 m of ground; its patterns did not run on these days) and the terminus loops, which no own-route path draws (all 441 adoptions onto another route's path on Sunday had an **empty own-route pool**, 351 of them within 150 m of a terminal). The tolerated first off-path fix shapes every event (p50 11 s from the first off-path reading to the change, visible correction p50 130 m); the turnaround rule is not a cause but a geometrically correct repair; the client re-seed is the last link.

**Owner sightings explained [O-2].** Route 14 "straight down Draškovićeva" = 53 + 34 rides of route 14 on route 15's path (p50 3.35 km, 18 min). Route 17 "into Praška" = the route 17 shape/synthetic variant swaps at Jelačić–Trg žrtava fašizma (82 events on Sunday alone).

**Acceptance metric for the coding session** (baselines Sunday/Monday): A same-trip path changes excluding terminus flips per 100 vehicle-hours ≤ 5, then ≤ 1 (165.6 / 136.5); B adoptions onto another route's path 0 (441 / 483); C vehicle-hours on a foreign path 0 (85.4 / 116.4); D variant chosen while the own path ran the edge 0 (469 / 620); E direction flips > 300 m from a terminal 0 (179 / 196); F backward arc runs ≥ 500 m 0 (275 / 191); G client re-seeds > 50 m 0, p95 < 50 m (1,990, 683 m / 1,922, 629 m); H visible correction p95 < 60 m (324 / 387). Run `node review.local/companion/replay/grade-branches.mjs <day>` on a recorded day.

**What to change** (ordered; the file-level plan is §15 WP0): re-evaluate the trip's own path at every fix and return to it when its residual ≤ 60 m; `adoptPath` ranks prior → current path → edge-sequence continuity → direction → most trips, never `pool[0]`, over the route's own paths only, excluding paths whose pattern service is not running today; a tram off its route's rails is drawn at its reported positions (unplaced) instead of on another line's path; add the Glavni kolodvor connector and terminus loop paths to the artefact with a build-time coverage assertion; keep `reseedArc` (metric G decides whether a holding-mark guard is needed).

## 9. Data reality calendar (48 samples, Mon 21 Sep 17:15 → Tue 22 Sep 16:48 Zagreb; the sampler runs to Wed 23 Sep 17:15)

Matrix: `review.local/companion/data-calendar/matrix.md` (per half-hour: module statuses and counts, events today/tonight/ongoing, BAJS stations with bikes, departures at seven stops). What it says [D-1]:

- **Constant at every hour**: 39 closure rows (the feed is a today-window of construction closures; the count does not move), 0 DHMZ warnings in every sample, 10–12 imperceptible quakes, 37 gazette acts, one temperature, and **a departure board of 15–30 timetable rows at every sampled stop, with 9–13 rows in the next 30 minutes whenever trams run** (2–4 at night).
- **Varies with the hour**: vehicles in the centre box 11 at night, 83 in the morning and day, 67 in the evening, 49 late; BAJS stations with bikes 153–168 of 200 (so about 35–45 stations empty at any time); events with a date today 0–1, timed tonight 0–1, ongoing exhibitions 8–11.
- **Reading**: departures are the one always-present, always-changing content, and the phone and the wall do not lead with them. The phone's instruction sentence and the kiosk's register fillers are design choices; the data for the alternative existed in every sample. "Tonight" is genuinely thin (0–1 timed events) and also un-designed (no filter, no venue-with-programme fallback). Warnings are a true empty and belong in the footer. Air: 10–12 stations with an index at every hour, usable for the map.

Source asks recorded on 22 September: the ZET GTFS carries only trams (type 0, 19 routes) and buses (type 3, 135 routes); the uspinjača and the Sljeme žičara are absent and have no machine-readable source we know of (bus 140 Mihaljevac–Sljeme is in the feed) [O-69]; Guru za kulturu (`kultura.zagreb.hr/api`, a City domain behind a robots rule) is to be read after D4 with disclosure on `/izvori` [O-70] (§17 Q26).

Known from fixtures [D]: nine modules, two of which yield one and two items; 142 event rows of which 47 carry an event date and 6 a machine-readable one; closures today-only with one subtype; ZET TripUpdates carry one stop each. Catalogue: 3,805 stops, 3,795 street stories, 763 heritage records (165 geo-joined), 204 venues, 199 fountains, 170 sports grounds, 115 Wi-Fi, 108 dog areas, 29 toilets.

## 10. Principles (each with its violation today and its test)

1. **Answer before inventory.** A first viewport states a fact with a place and a time, never an instruction or a count. Violation: "Odaberi i spremi stajalište…", "39 zatvaranja", "Radovi u gradu 4" [B-4], [B-26]. Test: first-viewport inventory has 0 INSTRUCTION and 0 COUNT units on every surface at every slot.
2. **One time axis, one place.** Everything the wall says is placed in time relative to now, around a named place. Violation: three unrelated cards and an empty context chip [B-2], [B-17]. Test: the wall's title is a stop or street name; every row has a time or the label "uvijek".
3. **Bounded departures.** Departures are present but never more than three rows; they never form a board [O-13], [O-27]. Test: count of departure rows ≤ 3 at every sample.
4. **Say it once, in one sentence, within 80 characters.** The header line is written by the model from rich context with a word budget; it changes every 20 s in step with the wall; it is never cut with an ellipsis [O-17], [O-47]. Test: rendered header text never overflows at 1920 px.
5. **Honesty by selection, not by caption.** Freshness, source and caveat lines leave the wall; colour carries the tracked/timetable distinction; provenance lives on the phone and `/izvori` [O-27], [B-19]. Test: 0 EMPTY/DISCLAIMER units in the wall's aside.
6. **The map curates.** Framed at 6–7 stops around the place; no cluster bubbles, no unlabelled dots; every BAJS station shows its count; pills carry every line number and grow [O-35], [O-37], [O-44]. Test: no "+N" labels of any kind on the wall map.
7. **Calm motion.** Rows enter at the bottom and leave at the top; a row keeps its node; nothing re-animates without a change [O-24], [O-33]. Test: DOM mutation count per minute ≈ number of content changes.
8. **No operator chrome for the passer-by.** Pause, copy, theme and gear leave the visible wall; settings are click-toggles behind a long press [O-43], [B-2]. Test: the invitation has no interactive control except the QR.
9. **Never below the timetable.** With live data gone, the wall keeps network, stops, places and timetable times; it never says "unavailable" as a headline [O-45].
10. **Public service credibility.** No "clever" abbreviation of useful information ("6 +3" pills) [O-35]; no fabricated ETAs; the marker rules of §8; information is not sacrificed for looks (buses stay on the frame at peak) [O-71].
11. **Standard, natural Croatian, checked by a human.** Every string is književni hrvatski that reads naturally; gender-neutral wording for non-persons (no pronoun that carries a noun's grammatical gender); the screen is "zaslon", never "zid"; every new or changed string is read by the owner before it ships [O-66]. Violation: the planners' "Zid pokazuje … oko njega". Test: the copy-guards vocabulary rules and the read-through row of §16.8.

## 11. First-viewport contracts (from mocks v5–v6 and the rounds of 22 September)

**Wall, passive, 1920×1080 (and portrait by stacking).** Header: "Kaj ima?" · place (stop or street from the venue's address) · one written sentence with a coloured kicker (Promet, Kultura, Vrijeme, Bicikli, Noćas, Radovi) · date · clock. Left: the map framed to 6–7 stops around the place (settings: Kadar 4 / 6 / 8 "stajališta odavde"; the radius is measured per place, §12), curated per principle 6, legend of three items without "?"; a settings toggle Prikaz switches the frame to the schematic network without zoom [O-72]. Right: **"U blizini · 2 km · ~15 min"** as one time-ordered list: up to three departures (blue countdown or grey clock), then timed items (closure end, event with venue and the tram to it, sunset or sunrise, last departures tonight as one row, first morning tram, tomorrow's openings), then one "uvijek" row (place story or protected building, alternating; pharmacy 24/7 at night); whole rows only; rows grow when fewer. Bottom right: QR card, lead "Skeniraj za 10 minuta grada.", code, the typed address. Footer: Sigurnost · verdict · DHMZ · EMSC · green cross 24/7 address. Night: dark solar palette and the night basemap. Outage: §4.8.

**Phone, ten-minute visit (Sada).** Header with pill. Title: the place. One sentence card with kicker. Map band around the stop (opens Karta). Three departures with badges. "U blizini · 2 km · ~15 min" continuing the same list. Tabs. No "Sada u gradu.", no date line, no instruction, no counts [O-12], [O-31].

**Setup / settings (wall).** Address or any stop, optional; automatic choice: nearest tram stop if near, else nearest bus stop, else the address alone [O-26]; nothing typed → Trg bana Jelačića is the place [O-65]. Settings as single-button click-toggles: Mjesto, Kadar, Prikaz (karta / shema), Tema, Ritam; more only as needed [O-43], [O-49], [O-72].

**Phone, Karta.** The timeline's map [O-50]: the same frame as the wall (6–7 stops around the place, settings 4/6/8), trams drawn at once with full-number pills, BAJS discs with counts, closures, tonight's venues named; tapping a stop opens its departures (the same three-row board as Sada, then the timetable); one search field over routes, stops, places and streets; no group taxonomy or chips; categories (toilets, water, markets…) appear only as search results and as map pins once searched. The "Alati karte" and "Što tražiš?" disclosures go; one small map / schema toggle stays [O-72].

**Tabs.** Sada · Karta · Još [O-51]. Događanja is no longer a destination: timed events live in "U blizini", venues with a programme tonight on the map, and the week's agenda is one row in Još ("Događanja ovaj tjedan").

**Setup (wall).** One screen: a single field "Adresa ili stajalište" that suggests streets with house numbers and tram/bus stops while typing; picking one derives the place (nearest tram stop if near, else bus stop, else the address) and a line under the field says what the screen will show ("Na zaslonu: Kvaternikov trg i 6 stajališta uokolo" — no verb, no pronoun, no "zid" [O-66]); then **Pokreni**. Leaving the field empty gives the whole-city map window with Trg bana Jelačića as the place for the list and the departures ("Na zaslonu: cijeli grad.") [O-52], [O-65]. Everything else is in the click-toggle settings behind a long press.

**Desktop.** The same as the phone, wider [O-56]: the Sada feed (sentence, departures, U blizini) and the Karta map side by side; no six-domain bar; weather, civic and safety content appear as rows of the feed or as search results; the header keeps Zaslon and the session pill.

**Kiosk, touch (where the screen has it).** Read-only [O-58]: touching a stop ring opens that stop's departures for 60 s; touching a row shows its detail (venue, address, the tram to it); touching the pharmacy shows address and phone; nothing else, and the wall returns by itself. Scanning remains the only way to take content along.

**Phone, end of the ten minutes.** The content clears; what remains is the invitation to scan again and the `/hitno` link [O-59]. This supersedes the earlier "frozen attributed snapshot with exports" contract in PRODUCT.md, DESIGN.md and the proposal's §1.5; the coding session updates those paragraphs and the tests that assert the frozen exports.

**Još.** Spremljeno (stops, lines, places) · Događanja ovaj tjedan (the full agenda with its count line) · Vrijeme, Grad and Sigurnost as full pages · Postavke (language, theme, in-app highlights) · Sigurnost /hitno, Izvori, Privatnost, Pristupačnost [O-60].

**Share.** "Podijeli grad" is a labelled button in the header beside the session timer on every screen of a direct session; it opens the code and QR [O-61].

## 12. Content-selection layer and fallback ladder (spec; built as the seams S5–S6 of §15.2)

- **Candidates** = departures at the place (bounded 3) ∪ timed items within the circle (closures by end time, events by start time with venue and tram, solar event, last departures row, first tram, tomorrow's openings from catalogue hours) ∪ timeless items (place story, heritage, pharmacy). Each carries a time (or "uvijek"), a kind, a source.
- **Circle** = the measured air distance from the place to its N-th tram stop (Kadar 4 / 6 / 8, default 6; distinct stop names; bus stops when no tram stop lies within 3 km), clamped to 0.5–3 km [O-68]; shown with a decimal comma and walking minutes at 7.5 min/km ("2,2 km · ~16 min"; a 2.0 km radius prints "2 km · ~15 min" [O-30]); the map frame uses the same number. Typical values from the artefact: 1.5 / 2.2 / 2.8 km for 4 / 6 / 8 [D-3]. Wherever this brief writes "2 km · ~15 min" it means the pill at 2.0 km.
- **Order** = by time; departures sort naturally first. **Bounds**: ≤ 3 departures; last departures as one row from T−4 h; first tram from 22:00; only the next solar event; rows = floor(available height / row height), row height 64–92 px chosen from the item count.
- **Sentence** = one of a rotating set written from the same candidates plus weather, closures, bikes; ≤ 80 characters; time-aware (the last-tram line disappears after it leaves) [O-41]; 20 s cadence; never repeated verbatim within ten minutes.
- **Never**: fetch times, disclaimers, counts without a name, register fillers with caveats, "+N" pills.

## 13. Slop register (owner judgements from the mock rounds and the round of 22 September [O-53])

Renderer file:line and i18n key for every item: `review.local/companion/code-reality/copy-audit.md` §6. Judgement column: **out** = owner has ruled it slop; **replaced** = the mock's alternative was approved (v1–v5); no row is pending after the round of 22 September [O-53].

| # | Item as rendered today | Judgement | Rule / replacement |
|---|---|---|---|
| 1 | "Gradska referentna točka: Trg bana Jelačića" | replaced | the place is the title; nearest stop chosen automatically (tram if near, else bus, else address) [O-26] |
| 2 | "Odaberi i spremi stajalište na karti za sljedeće polaske ovdje." | replaced | departures shown at once for the nearest stop; save is a refinement [O-12] |
| 3 | "39 zatvaranja" count tile | replaced | a closure is a timed row with its street and end time; no count [O-27], mock v1–v5 |
| 4 | "Radovi u gradu · 4" | replaced | same: named, timed, or absent |
| 5 | "Sada u gradu." heading + date line | replaced | no heading; the place is the title [O-31] |
| 6 | Temperature as the largest type | replaced | weather is one written sentence or one line [O-12] |
| 7 | "SIGURNOST · Nema hitnih upozorenja · potvrđeno HH:MM" in the first viewport | replaced | calm lives in the footer; urgent is loud |
| 8 | "Zatim" segment | out | time segments are peers; no 'show all' word [O-53] |
| 9 | "Što tražiš?" disclosure and groups | out | Karta has one search field; categories only as results [O-50], [O-53] |
| 10 | "Živi grad" default group with zero vehicles | replaced | Karta opens as the timeline's map with vehicles [O-50] |
| 11 | Karta / Promet / Kretanje / Prijevoz i raspored | replaced | one word: **Karta** is the destination [O-51]; "Promet" survives only as the subject word (kicker); WP4 renames the tab, WP5 sweeps the synonyms |
| 12 | "Upoznaj ovo mjesto" + "Obuhvat zaštite, ne ulaz…" | out | heritage rows are welcome without caveats, as "uvijek" rows [O-49], [O-37] |
| 13 | "Podatak iz registra, nije provjera uživo." repeated | out (wall) | once on `/izvori`; never on the wall [O-27] |
| 14 | Legend "BAJS: broj bicikala, ? nepotvrđeno" | out | three plain legend items; no "?" [O-37] |
| 15 | "Dohvaćeno HH:MM" credit lines | out (wall) | no fetch times on the wall [O-27] |
| 16 | "Zaustavi" button on the wall | out | no operator control in the passer-by's field [O-43] |
| 17 | Gear + theme icon in the kiosk header | out | settings behind a long press; click-toggles [O-43] |
| 18 | Header clock as the loudest glyph | replaced | clock small, place and sentence carry the header (mock v2+) |
| 19 | Three-line QR invitation copy | replaced | lead + code + typed address; the benefit line goes (mock v2+) |
| 20 | Phone header cast glyph + "9:48 ›" | replaced | header = Zaslon · Podijeli grad · timer; both labelled [O-61] |
| 21 | "Promet ↗" link on Sada opening a POI map | out | Sada has no section links; Karta is a tab [O-50] |
| 22 | "cijeli dan" for a multi-day item | out | "do 25. 9." [O-53] |
| 23 | "7 događanja · 4 u tijeku" count line | keep | stays on the week agenda in Još [O-53] |
| 24 | Four different departure empties | replaced | one rule: a timetable row always exists [O-32] |
| 25 | "Linija 6 · nema podataka" tiles | out | no tile without an action; line state words leave the first viewport [principle 1] |
| 26 | Merged vehicle pills "6 +3", "2 +11" | out | every line number, pill grows [O-35] |
| 27 | Grey "+2 / +3" place-cluster bubbles on the map | out | the map curates; no bubbles [O-44] |
| 28 | Unlabelled tiny BAJS dots | out | every station with its count, larger [O-37], [O-44] |
| 29 | "Dežurna ljekarna:" text | replaced | green cross symbol + 24/7 + address [O-39] |
| 30 | Sunset and sunrise both listed | out | only the next solar event [O-48] |
| 31 | "Zadnji tramvaj…" sentence after the last tram left | out | time-aware sentences [O-41] |

## 14. Ideas considered and rejected

| Idea | Origin | Why rejected |
|---|---|---|
| Wall right column = three fixed places (OVDJE / SADA / ZATIM) + one rotating slot | [A] concept B | owner chose the timeline [O-16] |
| Wall right column = pages that loop every 20 s | [A] concept C | owner chose the timeline [O-16]; the audit's "glance depends on when you arrive" |
| The stop's departures board as the wall's permanent top block | [A] mock 1 proposal | "we had to de-tram the kiosk several times" [O-13] |
| BAJS as a pinned "sada" row in the timeline | [A] mock v1 | jumps around, "isn't that what the map is for" [O-21] |
| Venue's name on the wall | [A] | "street only" [O-19] |
| Whole-city default framing for a venue screen | current | no place identity; 6–7 stops around the place instead [O-37] |
| One row per line for the evening's last departures | [A] mock v4 | turned the evening into a board; one summary row instead [B] |
| Greyed map during a ZET outage | [A] mock v3 | "unusable map, nothing new"; the map stays a map without vehicles [O-45] |
| Register fillers with disclaimer captions as quiet-day content | current | [O-37]; heritage rows without caveats accepted instead [O-49] |
| Frozen, attributed snapshot at the end of the ten minutes | PRODUCT.md, DESIGN.md, prijedlog §1.5 | "looked and worked pretty terrible… defeats the core purpose" [O-62]; the content clears. **Deferred, not rejected**: a later layer lets a person keep what they need without fuss (static export; real-time tracking pinned until the tram comes) [O-62], §17 Q25 |
| One constant frame radius per Kadar (1.3 / 2 / 2.7 km) | [A] planners, critic | owner: measured per place [O-68] |
| Trams-only hairlines on the framed wall at peak | [A] WP2 planner | "public service… some things cannot be sacrificed for design" [O-71] |
| Removing the schematic map from the phone | [A] WP4 planner | kept as a toggle on every surface, plus a wall settings toggle [O-72] |
| "Zid pokazuje {place} i 6 stajališta oko njega" | [A] WP3 planner | "zid" is not a frontend word; gendered pronoun for a thing; replaced by "Na zaslonu: … uokolo" [O-66] |

## 15. Implementation plan (execution-grade)

This section is the master plan the coding session executes without re-planning [O-55]. The file-level steps, the tests each step breaks, the executable acceptance and the agent briefs live in one file per work package under `docs/history/companion-2026-09-plan/` (`WP0.md` … `WP6.md`, index in `README.md`). Each file was written by a planner against the tree at build `b300af3`, refuted and corrected by an adversarial verifier, then reconciled across packages by a consistency critic; the reconciliation (§0 of each file) is binding and wins over the planner text, the verdict over the planner text. Line numbers are as of `b300af3`: re-anchor with `grep` before editing.

### 15.1 Canonical ids and the owner's order

| Id | Package | Owner's priority | Lane | Deploy |
|---|---|---|---|---|
| **WP0** | Trust: tram path stability (§8), silent vehicles (T8), whole-line pills (T7), share-QR label (T2), closures attribution date (T3), wall "Vrati pregled grada" (T6) | P0 [O-54] | T | **D1** |
| **WP3** | Setup and settings: one field "Adresa ili stajalište", derived place, click-toggles behind a long press; the screen protocol v2 (place, frame) | P1 wall | W-A (step 0 in lane S) | **D2** |
| **WP2** | Wall map: frame N stops around the place, curated markers, full-number pill rendering, three-item legend; read-only touch (D3) | P1 wall | W-B | **D2** (touch D3) |
| **WP1** | Wall composition: header sentence, "U blizini" timeline, QR card, footer, night, outage | P1 wall | W-C | **D2** |
| **WP4** | Phone and desktop: Sada feed, Karta as the timeline's map, tabs Sada · Karta · Još, folded Događanja, "Podijeli grad" in the header, end of the ten minutes | P1 phone | P | **D3** |
| **WP5** | Copy catalogue, vocabulary, dead paths, the §11 rewrite of the product documents | P2 | C | **D4** |
| **WP6** | Verification harness: research instruments as acceptance tests, committed frame sample, production observer, manual checklist | P0–P3 (measures all) | V (probes and guard in lane S) | D4 (red by design until then) |
| **WP7** | Closing pass after the final push and deployment: README to the new reality; an optional development-notes layer on `/prijava/` with the submitted text byte-identical; repository hygiene (working plans moved to history, nothing left over) | closing [O-75], [O-76] | after D4 | **D5** |

P3 (identity at the 3-metre table, `references.md` T1–T6) has no package of its own: the type tiers are fixed in WP1's CSS and asserted by WP6's legibility rule; the owner's remaining P3 decisions (symbol sizes) are read from WP6's reports.

The planners numbered each other's packages differently; a coding agent reads every "WP*n*" in a planner's `dependsOn` through this table (each file's §0 names the mapping).

### 15.2 Shared seams, built once and first (lane S, one coordinating session, sequential, about half a day)

Two or more packages planned each of these under different names. The coordinating session creates them with their exported signatures and a unit test, no behaviour, before the lanes fork. Owner = the lane that later fills the behaviour.

| # | Path | Exact exports | Owner → consumers |
|---|---|---|---|
| S1 | `worker/protocol.ts` (edit) | `ScreenMetadata.place?: ScreenPlace \| null`, `ScreenMetadata.frame?: FrameStops`; `screen-set` **version 2** `{ t: 'screen-set'; version: 2; place: ScreenPlaceInput \| null; frame: FrameStops }` beside v1 (kept indefinitely); `SCREEN_SET_MIN_MS` moved here and re-exported from `worker/do/beacon-do.ts`; error words `bad-place`, `bad-frame`; capability `place-v2` | WP3 → WP1, WP2, WP4 (room `joined` frame), WP6 |
| S2 | `shared/city/frame.ts` | `FRAME_STOPS = [4, 6, 8]`, `FrameStops`, `DEFAULT_FRAME_STOPS = 6`, `isFrameStops(x)`; **`frameRadiusM(place, stops, frame)`** = air distance to the N-th nearest distinct-name tram stop (bus stops when no tram stop within 3 km), clamped [500, 3000] m — measured per place [O-68]; `frameSpanM(radiusM)`; `FRAME_RADIUS_M = { 4: 1300, 6: 2000, 8: 2700 }` only as the fallback when no stops are loaded and for the calibration test; `pillText(radiusM)` → "2,2 km · ~16 min" (7.5 min/km) | WP2 → WP1 (circle and pill), WP3 (camera span), WP4 (Karta), worker |
| S3 | `shared/city/place.ts` | `ScreenPlace { kind: 'tram' \| 'bus' \| 'address'; name; lon; lat; stopId?; address? }`, `ScreenPlaceInput`, `TRAM_NEAR_M = 400`, `BUS_NEAR_M = 300`, `derivePlace(anchor, stops, isTram)` [O-26], `placeFromStop`, `nearestStops`, `inZagreb`, `isValidPlaceInput`; the default place for an empty setup is `placeFromStop(screenStop('106_1'))` (Trg bana Jelačića) [O-65] | WP3 → `worker/pairing/place.ts` (WP3), `app/src/city/place.ts` (WP4's `resolvePlace` wraps it), `kiosk.ts` (WP3), WP6 fixtures |
| S4 | `shared/kiosk/sentence.ts` | `SentenceKicker`, `SentenceFact`, `WrittenSentence`, `SentenceRequest`, `SentenceResponse`, `acceptSentence(...)` | WP1 → `worker/routes/kiosk.ts`, `app/src/city/sentence.ts`, WP4, WP6 |
| S5 | `app/src/city/nearby.ts` (pure) | `NearbyKind = 'departure' \| 'closure' \| 'event' \| 'solar' \| 'last' \| 'first' \| 'opening' \| 'always' \| 'pharmacy'`; `NearbyRow { id; kind; atMs; always; title; sub; live; source; selection?; map? }`; `NearbyInput { place; frame; now; boards; fixes; snapshots; city; lastRun; locale; i18n }`; `selectNearby(input): NearbyRow[]` (bounds of §12); `nearbyHead(i18n, frame)` = "U blizini · 2 km · ~15 min" for 6; `rowBudget(availablePx, count)` | WP1 → `app/src/kiosk/timeline.ts` (WP1), Sada and the Karta sheet (WP4), WP6 fixtures |
| S6 | `app/src/city/sentence.ts` (pure) | `sentenceFacts(...)`, `templateSentences(...)`, `createSentenceSequence({ rhythmMs, noRepeatMs: 600_000 })`; `fetchSentences` in `app/src/api.ts` | WP1 → WP4 (`ctx.sentence`), WP6 |
| S7 | `test/accept/probes.test.ts` | the DOM probe contract of §15.6 as one exported array; the test scans `app/src` and prints the red list, one row per probe with the owning package in the title | WP6 → WP1–WP4 |
| S8 | `test/app/i18n-scan.ts` | one scanner for literal `i18n.t('k')`, the `presentation.` wrapper, `kiosk/strings.ts` `group()`/`forms()`, `tr(`/`trPlural(`/`ct(` argument lists incl. ternaries, `data-i18n`, a dynamic-prefix allowlist (`notify.`, `timeband.`, `events.sources.`, …) | WP0 (`i18n-keys.test.ts`, missing keys) → WP5 (`i18n-orphans.test.ts`, unreferenced keys) |
| S9 | key-group ownership (a rule) | WP1 adds `kiosk.nearby.*`, `kiosk.sentence.*`, `kiosk.handheld.*`; WP2 `kiosk.legend.{tram,bikes,culture}` ("Kultura večeras", Q6); WP3 `kiosk.setup.*`, `kiosk.settings.*`; WP4 `sada.*`, `directory.*`, `arrivals.timetable` ("Vozni red") and `layers.u-pokretu` → "Karta"; deletions only by WP5; no top-level `nearby.*`, no `sentence.kicker.*`, no `time.untilDate` (use `events.untilDate`) | all |

Also fixed in lane S: `LONG_PRESS_MS = 800` (WP3; WP6 holds 900 ms); the legibility tiers (row title and time at `--k-main-size` 40 px; `.nearby-sub`, date, legend, kicker, `.k-lead`, card hint, typed address at ≥ 28 px); a screen without an address has Trg bana Jelačića as its place, so the list and the departures always exist (Q4 [O-65]); the pill prints the measured radius, so no per-Kadar copy is needed (Q10, Q16 [O-68]); the wall settings gain a Prikaz toggle karta / shema and the phone keeps its map / schema toggle (Q14 [O-72]).

### 15.3 Sequence: lanes, deploys, gates

```
t0 ─────────────────────────────────────────────────────────────────────────►
G0  lane S (one session, sequential): S7 probes + screen-creation guard (WP6 step 10)
    → S1 protocol → S2 frame → S3 place → S4/S5/S6 signatures + unit tests
    → S8 scanner → S9 key map                                     (≈ ½ day)
    ║
    ╠═ lane T   WP0 steps 1–12, six agents (T1 engine/matcher/tick · T2 planner+client
    ║           · T3 builder+artefact · T4 grader ext. · T5 pills · T6 four defects+docs);
    ║           step 13 integration run                              ──► D1 (trust)
    ║
    ╠═ lane V   WP6: steps 1, 4, 5, 9, 11 skeleton at once; step 2 after WP0 step 7;
    ║           step 3 sample at once (baseline on b300af3); steps 6–7 written red;
    ║           step 8 after D1
    ║
    ╠═ lane W   (after G0; app/src/kiosk.ts parts after D1)
    ║     W-A  WP3 modules: worker/pairing/place.ts, routes/screens.ts, beacon-do.ts,
    ║          streets-geo, kiosk/{start,place-field,settings,prefs}.ts, app/src/beacon.ts
    ║     W-B  WP2 modules: shared/city/frame.ts fill, app/src/map/frame.ts,
    ║          app/src/city/curated.ts, city-layers.ts, city-map.ts (census, cityLabels),
    ║          pill rendering, discovery.ts, legend keys
    ║     W-C  WP1 modules: city/nearby.ts + city/sentence.ts fill, kiosk/timeline.ts,
    ║          worker/routes/kiosk.ts + feed/sentences.ts, api.ts, invitation.ts,
    ║          frame.ts (footer), lastrun `first`, kiosk dead paths
    ║     then ONE INTEGRATOR, serial, rebasing WP3 → WP2 → WP1 on app/src/kiosk.ts,
    ║          kiosk/mapview.ts, test/app/kiosk.test.ts, kiosk.css
    ║                                                              ──► D2 (wall, one deploy)
    ║
    ╠═ lane P   WP4 chunk A beside lane W (place resolution over S3, departures block,
    ║           chrome/tabs/Još/share, kultura "do d. m.", desktop CSS, columnsFor move);
    ║           chunks B/C after D2 (Sada feed, Karta, phone sentence, end of session)
    ║           + WP2 step 9 read-only touch                       ──► D3 (phone)
    ║
    ╠═ lane C   WP5: five isolated files during lane W; everything else after D3
                (A2/A3 dead paths → A1 orphans by the scanner → step 9 retirements
                → step 10 the §11 rewrite of the documents, last)
                + WP6 green-up: the accept tier folds into npm test / npm run e2e ──► D4
    ║
    ╚═ closing  WP7 after the final push to main and its deployment: README rewritten to the
                new reality; /prijava/ gains an optional development-notes layer (submitted
                text untouched); the plan folder moves to docs/history/; no session leftovers ──► D5
```

Gates (every merge also passes `npm run typecheck && npm run typecheck:tests && npm test`):

- **D1** both recorded days through the grader: A ≤ 5 per 100 vh (stretch ≤ 1), B = C = D = E = F = 0, G = 0 with p95 < 50 m, H p95 < 60 m, unplaced ≤ 3 %, silence counters 0; round-F gate rows (backward 0, reversals 0, overtakes 0, crossings ≤ half the baseline, per-tick p50 < 60 ms); `node scripts/zet-schema.mjs --check`; no pill label matches `/\+\d/`; the artefact regenerated once.
- **D2** `e2e/accept/wall.spec.ts` scenes green for header, timeline, QR, footer, night, outage (touch `fixme`); legibility tiers green; ≥ 3 distinct sentences and no consecutive repeat over the ten-minute scene; the day's one production screen: `kiosk-context` non-empty in 100 % of 30 samples after setting Mjesto, `data-unlabelled = 0`, no `/\+\d/` pill.
- **D3** `e2e/accept/phone.spec.ts` green (Sada 0 INSTRUCTION / 0 COUNT / 3 departure rows in the first viewport, Karta cold open ≥ 1 pill within 2 s and 0 disclosures, tabs Sada · Karta · Još, `share-city` at rest, `session-ended` after expiry); `run-slot.mjs` post-deploy timing.
- **D4** orphan scanner reports `[]`; docs guards green; `npm test` = unit + workers + accept; every command named in the docs exists in `package.json`.
- **D5** (closing) README describes the deployed product (no frozen snapshot, no rotating highlights, the three tabs, the timeline); `/prijava/` shows the submitted text byte-identical with the notes layer off by default and readable when on; `git ls-files docs/` lists only intentional, indexed documents; `docs/companion-2026-09-22-plan/` has moved to `docs/history/`.

Deploys are `git push` to `main`; each Dn is one merge of green lanes. Q15: one temporary production screen per verification day, through `/kiosk/`, recorded in `review.local/companion/screen-<date>.json`; `scripts/audit-production.mjs` and `scripts/capture-landing.mjs` refuse to create screens from the first commit.

### 15.4 Critical path and agents

**G0 → W-C (WP1: timeline, sentence client, Worker route, recomposition) → integrator WP3 → WP2 → WP1 → D2 → WP4 chunks B/C + end of session → D3 → WP5 A1 / step 9 / step 10 → D4 → WP6 green-up.** WP0 is off the critical path but D1 precedes the integrator pass. Three items lengthen the path if left open: the probe names (S7), the legibility tiers, the `NearbyKind` union (S5) — all fixed in G0.

Agents by lane (each brief is self-contained in the package file): lane S one coordinating session; lane T six; lane V four (A grader, B instruments, C topology and guards, D observer) then E specs and F docs; lane W five (WP3 A–D minus the integrator hunks, plus E docs/e2e), four (WP2 A–D, then E census/e2e), six (WP1 A–F, F draft in parallel) and one serial integrator; lane P seven chunks (A first, D and F at once, B/C after D2, E after B/C, G last); lane C six (A2, A3, A4 drafts, A5, then A1, A6, B1). A smaller model suffices for every lane whose brief names exact files and tests; the integrator pass, the WP0 matcher (T1) and the WP1 sentence acceptance rules deserve the strongest model available [O-55].

### 15.5 Overlaps resolved (single owner each)

| File / function | Owner | The others |
|---|---|---|
| `app/src/motion/pills.ts` label semantics (no fold, cap 40) | WP0 | WP2 does rendering only (stretchable images, `step` nose table); never deletes `PILL_MAX_CHARS_CLUSTER` |
| `worker/protocol.ts`, `beacon-do.ts` screen-set, `app/src/beacon.ts` | WP3 (S1) | WP2 step 5 deleted |
| `app/src/kiosk.ts` header: brand button, long press, settings | WP3 | WP1 owns `.k-head-mid` (sentence) only; WP0 removes the stop-presentation button first |
| `app/src/kiosk/mapview.ts` `requestKioskMap` | WP2 (adds `vehiclesVisible`, `place`, `frame`) | WP1/WP3 only pass inputs |
| `app/src/kiosk.ts` `paintMap` | integrator order WP3 (`wallSpanM()`) → WP2 (`frameView`, `setFrame`) → WP1 (`vehiclesVisible`, `setHighlight`) | `paintTicker` deleted by WP1; WP3 skips its :313 edit |
| `app/src/kiosk/invitation.ts` | WP1 | WP2 defines legend keys; WP3's "Pokreni" word via `kiosk.handheld.info`; WP5 never edits it |
| kiosk dead paths (`highlights.ts`, `ticker.ts`, corner-qr, join-code, their keys) | WP1 | WP5 A2 shrinks to teaser exports, `.k-lines--overlay`, orphan strings |
| `dashboard.ts:846` `kiosk.qrLabel` | WP0 | WP4/WP5 drop it |
| `test/city/readable.test.ts` | WP0 moves :79-82 to `pills.test.ts`; WP1 deletes :6, :42-83 | — |
| `app/src/transport/workspace.ts` | WP4 (all cluster call sites) | WP2 touches `discovery.ts`, `presentation.ts`, `city-layers.ts`, `city-map.ts` only |
| `app/src/city/strings.ts` | WP4 deletes `quiet` + browse keys; WP5 step 1 adapter after WP4 | WP1 does not touch it |
| `app/src/kiosk/frame.ts` (footer; `SAFETY_ICON` move to `experience/safety-state.ts`) | WP1 | WP5 later deletes `producers/*` |
| `experience/timeband.ts` `columnsFor`/`zagrebInstant` → `app/src/kiosk/columns.ts` | WP4 | WP5 deletes `timeband.ts` |
| `e2e/experience-fixtures.ts` `installKioskFeedFixture { now }`, the ten-minute rotation instrument | WP6 (`e2e/wall.ts`, `e2e/accept/wall.spec.ts`) | WP1's `scripts/kiosk-rotation.mjs` dropped |
| walkthrough classifier | WP6 ports to `e2e/inventory.ts` | WP4 edits only `run-slot.mjs:58-59` |
| `review.local/companion/replay/grade-branches-core.mjs` | WP0 extends (loops, unplaced, silence); WP6 ports after | — |
| PRODUCT.md, DESIGN.md, docs/kiosk.md, INTEGRATION.md | each package edits only the sentences its acceptance invalidates and the `docs.test.ts` pins it breaks | WP5 step 10 is the one full §11 rewrite, last |
| `layers.u-pokretu` "Promet" → "Karta" | WP4 (+ `kiosk-local.test.ts:95`, `kiosk.test.ts:1416`) | WP5 sweeps the remaining synonyms; "Promet" stays the kicker |

### 15.6 DOM probe contract (emitted by WP1–WP4, read by WP6 and every e2e spec)

| Surface | Element | Name / attributes | Emitted by |
|---|---|---|---|
| Wall header | place | `[data-testid=kiosk-context]` (existing; stop or street, "Zagreb" for the whole city) | WP3 |
| Wall header | sentence | `[data-testid=kiosk-sentence][data-kicker=promet\|kultura\|vrijeme\|bicikli\|nocas\|radovi][data-valid-until]` > `kiosk-sentence-kicker`, `kiosk-sentence-text` | WP1 |
| Wall header | brand | `button[data-testid=kiosk-brand]` (long press 800 ms opens settings); no `kiosk-settings` gear, no `kiosk-theme` | WP3 |
| Timeline (wall and phone) | list | `[data-testid=nearby]` > `[data-testid=nearby-head]` ("U blizini · {measured} km · ~{min} min") + `ol[data-testid=nearby-rows]` > `li.nearby-row[data-id][data-kind][data-when=<ISO> \| data-always="1"][data-live="1"?][data-source]` with `.nearby-title`, `.nearby-when` (`<time>`), `.nearby-sub` | WP1 (component), WP4 (same markup) |
| Wall map | container | keeps `data-map-status`, `data-zoom`, `data-pills`, `data-bodies`, `data-feed`; adds `data-markers`, `data-unlabelled` (must be 0); `[data-symbol=bajs\|pill\|pharmacy]` on DOM markers | WP2 |
| Wall map | host | `[data-testid=kiosk-map-host][data-frame=4\|6\|8][data-major-labels]` via `setFrame` | WP2 |
| Wall map | outage note | `[data-testid=map-note]` | WP1 |
| Wall legend | `.k-map-legend` three items from `kiosk.legend.*`, no "?" | WP1 mounts, WP2 keys |
| QR card | `kiosk-qr` (SVG ≥ 240 px), `kiosk-code`; removed `pair-copy`, `pair-copy-status`, `corner-qr`, `join-code` | WP1 |
| Footer | `[data-testid=safety-strip]` > `strip-verdict`, `[data-testid=strip-pharmacy] [data-symbol=pharmacy]` (green cross · 24/7 · address), `strip-sources` (no HH:MM) | WP1 |
| Setup | `[data-testid=kiosk-setup]` > `setup-place`, `setup-suggestions` > `setup-suggestion`, `setup-preview` ("Na zaslonu: {place} i {count} stajališta uokolo" / "Na zaslonu: cijeli grad."), `setup-create` ("Pokreni") | WP3 |
| Settings | `[data-testid=kiosk-settings-panel]` > `toggle-place`, `toggle-frame[data-value=4\|6\|8]`, `toggle-view[data-value=map\|schema]`, `toggle-theme`, `toggle-rhythm[data-value=20\|30\|60]` | WP3 |
| Touch (D3) | `[data-testid=stop-board]` | WP2 / WP1 |
| Phone Sada | `sada-place`, `sada-sentence[data-kicker]`, `sada-map-band`, `day-departures` (existing) > `li.sada-departure[data-live]`, then the shared `nearby` list | WP4 |
| Phone header | `[data-testid=share-city][data-action=share-city]` ("Podijeli grad"), `share-code` | WP4 |
| Phone end | `[data-testid=session-ended]` with `a[href^="/s/"]` and `a[href="/hitno"]` | WP4 |
| Tabs / Još | `tab-more`, `dir-kultura` ("Događanja ovaj tjedan" + count line) | WP4 |
| Retired (asserted absent) | `kiosk-highlight`, `kiosk-panel-weather`, `kiosk-ticker`, `kiosk-theme`, `kiosk-settings`, `pair-copy`, `corner-qr`, `join-code`, `pause-highlights`, `k-highlight-credit`, `day-stop-prompt`, `city-filter-disclosure`, `t-map-menu`, `frozen-line`, `ki-domains`, `kiosk-stop-presentation` | — |

### 15.7 Test-file ownership (the hotspots)

| File | WP0 | WP1 | WP2 | WP3 | WP4 | WP5 |
|---|---|---|---|---|---|---|
| `test/app/kiosk.test.ts` | :100, :261-263, :398 | grep-driven sweep of the invitation/highlight/weather/ticker/theme assertions (:708-888, :1127-1483, :1544-1580, :1710-1717, :1846, :1862, :2008-2193) | :754, :1329, :1501-1523, :1603-1620 | :415-473, :476-706 (probe word → `auth-required`), :1723-1760, :1893-1930, new header-button test | :1416 | none until D3 |
| `test/app/kiosk-css.test.ts` | :125 | :75-76 (264 px), :103 | — | :43-61, :126 | — | :107 |
| `test/city/readable.test.ts` | :79-82 → `pills.test.ts` | delete :6, :42-83 | — | — | — | — |
| `test/app/dashboard.test.ts` | — | — | — | — | all listed ranges + :1321-1367 + the frozen assertions | FAB/cast rows after D3 |
| `test/app/kiosk-local.test.ts` | — | :283-284 | :20, :687-866 | — | :95 | :974-975 |
| `test/app/i18n.test.ts` | — | :57 → `kiosk.sentence.kicker.promet` | — | parity untouched | — | DEAD_KEYS, :78-84 |
| `test/app/copy-guards.test.ts` | — | scoped kiosk.* rule | invitation literals `it` | :71-73 | :203-233 | :83-118, :231 |
| `test/docs/docs.test.ts` | — | — | — | :48-58 unchanged + WP3 pins | — | whitespace-tolerant guards |
| `hr.json` / `en.json` | none | own groups | own group | own groups | own groups + `layers.u-pokretu` | deletions only |

A package that must touch another's range writes one line in `review.local/companion/plan/<wp>/handoff.md`; the owner applies it.

### 15.8 Rules for agents running in parallel

1. `hr.json`/`en.json`/`app/src/kiosk/strings.ts`: add only inside your own group (S9); never reorder; deletions only in lane C; `test/app/i18n.test.ts` parity on every merge.
2. `app/src/kiosk.ts`, `app/src/kiosk/mapview.ts`, `app/src/dashboard.ts`, `app/src/transport/workspace.ts`, `app/src/experience/chrome.ts`: one integrator at a time in the fixed order; module work happens in the new files first.
3. Test ownership per §15.7; cross-range edits via `handoff.md`.
4. Docs: sentence-level edits plus the `docs.test.ts` pins you break; the §11 rewrite is WP5 step 10 alone; no em dashes.
5. `app/public/data/zet-network.json` is regenerated once (WP0 step 6) and never again; `scripts/audit-production.mjs` and `scripts/capture-landing.mjs` are never run; production screens per Q15 only; `wrangler deploy` never.
6. Merge gate for every lane: `npm run typecheck && npm run typecheck:tests && npm test`; the `accept` tier is advisory until D4 and is never `test.skip`ped.
7. Fixed constraints untouched by every lane: presence gate; no accounts, tracking, push or route planning; no invented arrival estimates beyond the labelled ZET estimate (the Sada block keeps `provenanceBlock` crediting ZET and `arrivals.note` once in the stop detail); `docs/prijava` and `app/prijava` untouched; deploy only via `git push` to `main`.
8. Public repository hygiene [O-76]: every committed document is intentional, indexed from the README or a parent document, and written for a reader; working plans are marked as such and moved to `docs/history/` once executed; nothing from a session is committed as a leftover (scratch, captures with live codes, answer files, artifact exports); `review.local/` stays ignored.
9. Owner strings byte-exact: "U blizini", "{km} km · ~{min} min", "uvijek", "Skeniraj za 10 minuta grada.", "24/7", "sutra", the six kickers, "Adresa ili stajalište", "Pokreni", "Na zaslonu: {place} i {count} stajališta uokolo", "Na zaslonu: cijeli grad.", "Mjesto", "Kadar", "Prikaz: karta" / "Prikaz: shema", "Tema", "Ritam", "Sada · Karta · Još", "Podijeli grad", "Događanja ovaj tjedan", "Vozni red". Everything else the planners wrote in Croatian is a proposal confined to its key group (Q9).
10. Croatian copy is standard and natural, gender-neutral for things, never "zid" on the frontend or in a Croatian document; each package lists its new or changed Croatian strings (the i18n scanner diff) for the owner's read-through before its deploy [O-66].

### 15.9 The packages in one paragraph each

**WP0 (trust, D1).** The matcher prefers the trip's own path at every fix and returns to it when its residual is within 60 m on a moving fix; adoption ranks prior → current path → edge-sequence continuity → direction → most trips over the route's own paths only, filtered by the services running today (the engine learns each path's services from the trip index; the tick passes the running set); a tram off its route's rails is drawn at its reported positions (unplaced) instead of on another line's path. The planner holds a silent tram at its next stop from 30 s, fades linearly and drops it at 180 s (Q2). The builder adds the Glavni kolodvor connector and terminus loop paths, asserts pattern coverage at build time, and regenerates the artefact once. Pills list every line at a 40-character cap. Four small defects: the share-QR label key, the closures attribution date (three templates), the wall's presentation-ending button, and a guard test that every literal i18n key exists. Acceptance: the grader on both recorded days (metrics A–H plus unplaced and silence rows), the round-F gate, the schema check. 13 steps, six agents.

**WP3 (setup and settings, D2).** Protocol v2 with `place` and `frame` (v1 kept; records enriched on read); one field "Adresa ili stajalište" suggesting tram/bus stops and streets from an offline OpenStreetMap-derived index (ODbL, Q3), the derived place under it ("Na zaslonu: …"), "Pokreni"; nothing typed → Trg bana Jelačića; the header names the place; settings behind an 800 ms press on the brand as click-toggles Mjesto · Kadar (4/6/8 "stajališta odavde") · Prikaz (karta / shema) · Tema · Ritam (20/30/60 s) with a send queue that respects one frame per five seconds. 6 steps, five agents.

**WP2 (wall map, D2; touch D3).** The frame radius measured per place (S2) and the `frameView` camera; the schematic network as the wall's Prikaz alternative; curated points: every BAJS station a counted disc (grey zero, blank when unknown, never "?"), venues named only with a programme tonight, no cluster bubbles anywhere; buses and their hairlines on the framed wall at every hour [O-71]; ranked stop names, interchanges and street names on the frame; the unframed whole-city window keeps today's thinning rule; three-item legend; stretchable pill images; render census `data-markers` / `data-unlabelled`; the wall-map e2e spec; read-only touch (stop ring → 60 s board) in D3. 9 steps, four agents then one.

**WP1 (wall composition, D2).** The aside becomes the "U blizini" timeline (S5 selection: ≤ 3 departures blue/grey, timed rows, one last-departures row from T−4 h, first tram from 22:00, one solar event, tomorrow's openings, one "uvijek" row alternating story/heritage every 20 min, pharmacy at night; whole rows only, 64–92 px, nodes kept) over a QR card of lead · code · address (SVG ≥ 240 px); the header middle carries one model-written sentence (Workers AI route `POST /api/kiosk/sentences` with KV cache and a deterministic template fallback; ≤ 80 characters, never an ellipsis, time-aware, no verbatim repeat within ten minutes, cadence from the rhythm preference); footer with the green cross · 24/7 · address and sources without a time; outage keeps the map without vehicles plus one note; `lastrun` files gain `first`. Deletes `highlights.ts`, `ticker.ts` and the kiosk dead paths. 13 steps, six agents then the integrator.

**WP4 (phone and desktop, D3).** Sada = the place as title · one sentence card · a 112 px map band · three departures at the automatically chosen stop (screen → saved → nearest tram within 400 m → bus within 300 m → the address; departures within 800 m) · the same "U blizini" rows; Karta = vehicles on at once, curated markers, one search field, a small map / schema toggle kept [O-72], the nearby rows as the default sheet, stop detail with three large rows then "Vozni red"; tabs Sada · Karta · Još with Događanja folded into a Još row with its count line; desktop = the phone, wider; "Podijeli grad" as a labelled header button; the phone asks the sentence route at most once a minute; at the end of ten minutes the content clears to the scan invitation and `/hitno` (Q1). 12 steps, seven chunks.

**WP5 (copy, vocabulary, dead paths, docs, D4).** One catalogue (`city/strings.ts` becomes a thin adapter), 35 inline bilingual ternaries folded, orphans deleted by the shared scanner after their last consumer, one word per concept (Karta / stajalište / uvijek / vozni red; "Promet" only as a subject word), no disclaimer, caveat or fetch time in any wall markup, the composition retirements WP4 leaves dead (producers, tiles, timeband, FAB, cast, lightweight face), and the one full rewrite of PRODUCT.md, DESIGN.md, docs/kiosk.md and INTEGRATION.md to §11 with whitespace-tolerant guards. 10 steps, six agents in two phases.

**WP7 (closing pass, after the final push and deployment, D5).** A strong pass at README.md so it describes the deployed product rather than the September prototype (today it still says the last view stays as a snapshot with exports, describes rotating highlights and an events agenda); an optional development-notes layer on `/prijava/`: the submitted proposal stays byte-identical and a default-off toggle reveals dated notes on what the prototype has done since submission, with a test that the original text is unchanged [O-75]; the repository hygiene sweep of rule 8: the plan folder to `docs/history/`, the answers file gone, every remaining document indexed [O-76]. Detail in `WP7.md`.

**WP6 (verification harness, lane V, folds at D4).** The wrong-branch grader ported to `scripts/` with rows A–H, S (silent-vehicle advance), I (service filter) and `unknownTripShare`, a 162-frame tram-only sample of the dossier's window committed under `test/fixtures/frames/` (6.2 MB, feed 000395), the first-viewport classifier and wall sampler as `e2e/inventory.ts` / `e2e/wall.ts` with recorded-inventory fixtures, eight fake-clock wall scenes and a phone/desktop spec in an `accept` tier, the 3-metre legibility rule from `references.md` T1–T6 with a font-metrics guard, a read-only production observer, refusal guards on the two scripts that create screens, and the manual device checklist. 12 steps, six briefs.

## 16. Verification plan for the coding session

Every number below is a command and a threshold; the instruments are WP6's ports of this session's research scripts, so a production observation after deploy and a local acceptance run share one source. Full detail in `docs/history/companion-2026-09-plan/WP6.md`.

**16.1 Merge gate for every lane.** `npm run typecheck && npm run typecheck:tests && npm test` (unit + workers). The `accept` tier (`npm run accept`, `npm run accept:e2e`) is red by design until its package lands and is never skipped; at D4 it folds into `npm test` and `npm run e2e`.

**16.2 Trust (WP0, D1).** Local recordings: `node review.local/companion/replay/grade-branches.mjs review.local/companion/recordings/2026/09/20 --out …` and `…/21`, then the `node -e` checks listed in `WP0.md` acceptance: A ≤ 5 per 100 tram vehicle-hours (baselines 165.6 / 136.5; stretch ≤ 1), A′ (teaser box 17:15–17:44) ≤ 5, B = 0 (441 / 483), C = 0 (85.4 / 116.4 vh), D = 0 (469 / 620), E = 0 (179 / 196), F = 0 (275 / 191), G = 0 and p95 < 50 m (1,990 / 1,922; 683 / 629 m), H p95 < 60 m (324 / 387), unplaced ≤ 3 % of tram vehicle-hours (baseline to be measured), published-older-than-180 s = 0, extrapolated-past-next-stop = 0, unknown trips ≤ 1 %. Round-F gate (`node scripts/replay-twin.mjs …`): backward frames 0, reversals 0, overtakes 0, visible crossings ≤ 2,478, per-tick p50 < 60 ms. `node scripts/zet-schema.mjs --check`. In the repo afterwards: `npm run accept -- test/accept/wrong-turn.test.ts` on the committed 162-frame sample (`test/fixtures/frames/2026-09-21-1715-1744/`, `expect.json` with the b300af3 baseline 130.9 per 100 vh and `targets: 'stage1'`), precondition `unknownTripShare < 0.02`; `npm run replay:grade -- <day> --targets stage1` exits 0 on a whole recorded day.

**16.3 Wall (WP1, WP2, WP3, D2).** `npm run accept:e2e -- e2e/accept/wall.spec.ts` at 1920×1080 (peak scene also 1080×1920) under fake clocks for eight scenes: `peak1745`, `late2130`, `lastTrams2240`, `afterLast0045`, `night0430`, `morning0745`, `midday1230`, `outage0800` (ZET down). Per scene: first-viewport inventory INSTRUCTION 0, COUNT 0, UNCLASSIFIED 0, EMPTY/DISCLAIMER 0 in the aside; `nearby-head` matches `/^U blizini · \d+(,\d)? km · ~\d+ min$/` and equals "U blizini · 2 km · ~15 min" when the fixture place measures 2.0 km; lead exactly "Skeniraj za 10 minuta grada."; `kiosk-context` non-empty; sentence 1–80 characters, no overflow, no ellipsis; departures 1–3 in every one of 300 rotation samples over ten minutes; caveat rows 0; closure re-entries 0; `+N` pills 0; ≥ 3 distinct sentences and no consecutive repeat (template floor; the production observer applies "no verbatim repeat within ten minutes"); ≤ 1 solar row per sample; every row has `data-when` or `data-always`; controls inside the invitation 0; settings only by a 900 ms hold on the brand; ≤ 2 DOM mutations per idle minute and rows keep their nodes; QR SVG ≥ 240 px; footer without HH:MM; `data-unlabelled = 0`; legibility violations `[]` (read tier x-height ≥ 10.5 mm at 43″ 1080p, i.e. font-size ≥ 38.9 px, ×1.1 in the dark theme; walk-up tier ≥ 28 px). Scene specifics: `lastTrams2240` has a `last` and a `first` row; `afterLast0045` has no `last` row whose time has passed and no /zadnji/ once every last tram has left; `night0430` dark theme with `first` and `pharmacy` rows; `morning0745` ≥ 1 live countdown; `outage0800` `data-feed` ≠ live, no vehicle pills, 0 live rows, every departure a clock time, `map-note` once, `data-markers` > 0, no heading matching /nedostup/. A DPR 0.25 screenshot per scene goes to `test-results/accept/wall-<scene>-3m.png` for the eye. Recorders (console errors, page errors, failed requests, HTTP ≥ 400) empty. Also: `e2e/wall-map.spec.ts` (frame zoom within ±0.05 of `frameView`, buses on the frame, counted BAJS discs incl. a grey zero and a blank), `e2e/screen-creation.spec.ts` (field → "Na zaslonu: Kvaternikov trg i 6 stajališta uokolo" → Pokreni → chip → long press → Kadar 8 → `data-frame="8"`), `e2e/readable-city.spec.ts` (night wall screenshot under `?tema=tamna` at 21:30), `e2e/a11y.spec.ts` (no visible button inside the invitation; the named hidden settings path).

**16.4 Phone and desktop (WP4, D3).** `npm run accept:e2e -- e2e/accept/phone.spec.ts`: Pixel 7 Sada INSTRUCTION 0, COUNT 0, exactly 3 departure rows inside 390×844, `sada-place` and `sada-sentence` present, no /Sada u gradu|Odaberi i spremi|Gradska referentna/; tabs `['Sada','Karta','Još']`; `share-city` visible at rest, one tap → `share-code`; Karta cold open ≥ 1 pill within 2,000 ms and 0 disclosures, `data-unlabelled = 0`; canvas tap → `stop-board` with 3 rows in the viewport; search path ≤ 3 taps; Još → "Događanja ovaj tjedan" with its count line; expiry → `session-ended` with `/s/` and `/hitno` links, 0 rows, 0 export controls, no further `/api/data` requests; desktop 1440×900 Sada and Karta both in the viewport, `.ki-domains` 0; axe serious + critical 0 on Sada and Karta. Unit: `test/app/sada.test.ts`, `test/app/place.test.ts`, `test/app/next-departures.test.ts`.

**16.5 Trust and slop guards (unit, from WP6 step 8 and WP0 step 9).** Every literal i18n key resolves in both catalogues; the closures attribution prints no clock time; `clusterLabel` of 13 and of 27 labels contains no "+"; the wall renders no control that ends a presentation and no gear/theme/pause/copy; the SLOP_OUT table (the §13 "out" strings) is absent outside its allowed files; the pharmacy and fetch-time keys are gone from `kiosk.*`; `TRANSPORT_TAB_WORD = 'Karta'`.

**16.6 Copy and documents (WP5, D4).** Orphan scanner `[]`; hr/en parity; `city/strings.ts` without Croatian literals; no bilingual ternary outside `app/src/i18n`; vocabulary checks (`layers.u-pokretu === 'Karta'`, `arrivals.scheduled === 'vozni red'`, "Procjena" only in `arrivals.note`, no "stanica" outside the BAJS allowlist); the wall's aside, strip and paired asides match none of the disclaimer/fetch-time patterns; docs guards whitespace-tolerant (docs/kiosk.md contains "U blizini" and "Adresa ili stajalište" and none of the retired phrases; PRODUCT.md contains "22 September 2026"; DESIGN.md contains "U blizini" and no "geographic clusters use a distinct plus-count mark", "frozen attributed exports", "Touch exploration has search"); `git diff --stat -- docs/prijava app/prijava` empty.

**16.7 Production observation after each deploy (read-only).** `E2E_KIOSK_URL=<the day's screen> npm run observe:production -- --minutes 10` for kiosk 1920×1080 (+ portrait, + DPR 0.25 proxy), phone and desktop, at the five weekday slots this session used (07:45, 12:30, 17:45, 21:30, 04:30) and, once, a Saturday 10:30 and 17:45 (Q11); ≤ 1 code redemption per surface spaced ≥ 12 s; never presents, never opens settings; writes `review.local/observe-<stamp>/{inventory.json, rotation.jsonl, legibility.json, report.md}` and exits 1 on any threshold of 16.3/16.4. One temporary screen per verification day through `/kiosk/` (Q15). After WP4: `node review.local/companion/walkthroughs/1720-mon/run-slot.mjs --skip-portrait --skip-desktop --log-minutes=1` for the post-deploy first-viewport timing (its selectors updated by WP4).

**16.8 Manual checks that browsers cannot prove** (`docs/kaj-verification.md`, "Ručne provjere na uređaju", columns uređaj · preglednik · datum · rezultat; empty until done): a 43″ 1080p panel at 3 m in the venue's light (read place, sentence, three departures, code, verdict, pharmacy); the same after sunset in the dark palette; QR scan from 2 m and 3 m with an iPhone and an Android camera; the touch wall (stop ring → board → returns within 60 s; long press opens settings, nothing else reacts); Safari + VoiceOver on Sada (place, sentence, three departures in order; "Podijeli grad" labelled); Android Chrome + TalkBack; reduced motion on the wall; 200 % text on the phone (three departures still in the first viewport); one production observation per day with the owner's screen only; the owner's read-through of every new or changed Croatian string (the i18n scanner diff per deploy) [O-66].

**16.9 What never enters git.** `.dev.vars`; everything under `review.local/`; `screen.json` and any `screen-<date>.json` (beacon id and secret); `recordings/` at any depth (the 162-frame sample under `test/fixtures/frames/` is the only committed frames); `test-results/`, `.wrangler/`, `.cache/`; provisioning URLs (`E2E_KIOSK_URL`, `AUDIT_KIOSK_URL` carry the secret in the fragment: environment only); Cloudflare Access tokens; production captures showing live codes. Guard: `git ls-files | grep -E '(^|/)\.dev\.vars$|screen(-[0-9-]+)?\.json$|(^|/)recordings/|^review\.local/|test-results/' | wc -l` = 0; `du -sb test/fixtures/frames` ≤ 6,500,000.

**16.10 Still owed after the coding session.** WP7, the closing pass after the final push and deployment (README to the new reality; the `/prijava/` notes layer; repository hygiene) [O-75], [O-76]; the physical checks of 16.8; a weekend observation (Q11); the follow-on events-breadth package (Q26); the funicular and cable-car source ask (Q24).

## 17. Open questions, answered 22 September (evening)

The owner answered every row in writing (verbatim in the ledger, [O-62]–[O-74]). The question stays for the record; the ruling is binding and is already applied to §1, §9–§16 and to §0 of every plan file. Three items the answers raised are new rows (Q24–Q26).

| # | Question | Ruling | Applied in |
|---|---|---|---|
| Q1 | End of the ten minutes: keep the frozen snapshot or clear? | **Clear.** The freeze "looked and worked pretty terrible… defeats the core purpose". A later layer should let a person keep what they need without fuss (static export; real-time tracking pinned until the tram comes) — deferred, a development effort of its own [O-62]. | WP4 step 11; WP5 step 10 records the deferred vision; §14 |
| Q2 | Silent tram drop at 120 or 180 s? | **180 s.** "why ask me? … make it 180 or 190 then" — operational numbers are the plan's to set from the vision [O-63]. | WP0 step 4 |
| Q3 | ODbL street index for address suggestions? | **Yes.** Link the register's street descriptions to the streets by name; near-duplicates are few and tolerable; not every street has a description [O-64]. | WP3 step 2 |
| Q4 | Whole-city wall departure-less, or borrow Trg bana Jelačića? | **Trg bana Jelačića is the default place**, "something anyone would expect" [O-65]; the map keeps the whole-city window [O-52]. | S3; WP1, WP2, WP3; §11 |
| Q5 | Grammar of "Zid pokazuje {place} i 6 stajališta oko njega"? | **"zid" is out of the frontend; gender-neutral wording for things.** New line: "Na zaslonu: {place} i {count} stajališta uokolo" / "Na zaslonu: cijeli grad." Standard, natural Croatian, rechecked by the owner for the life of the app [O-66]. | §1, §10 principle 11, §15.8; WP3; every plan file |
| Q6 | Legend "Kultura večeras" | good | WP2 |
| Q7 | Stale closures stay on the wall | yes | WP1 |
| Q8 | ZET notices and the delay table leave the phone | yes | WP4 |
| Q9 | Wall copy the owner had not ruled on | ship; read-through before deploy | WP1, WP3 |
| Q10 | Frame radius: constant per Kadar or measured per place? | **Measured per place** [O-68]. The pill prints the measured distance. | S2; WP1, WP2, WP3, WP4, WP6; §12 |
| Q11 | Weekend not observed | fine; low-volume hours are defined and the difference is not radical [O-69] | §16.7 keeps one Saturday observation |
| Q12 | Events breadth blocked by robots.txt | **Read it.** For a City domain "its automatically public property… we can be honest about ignoring robots.txt" [O-70]. See Q26. | follow-on package after D4 |
| Q13 | Bus hairlines at peak on the framed wall | **Buses stay.** "public service and therefore some things cannot be sacrificed for design or ux" [O-71]. | WP2 (lever dropped); §10 principle 10 |
| Q14 | Schematic map on the phone | **Kept everywhere.** Wall: a settings toggle Prikaz karta / shema (schema = the whole network, no zoom); phone, tablet, desktop keep their toggle [O-72]. ("Device store" was the plan's name for the browser's saved preference.) | WP3 (toggle), WP2 (wall rendering), WP4 (phone toggle kept), WP6 probes |
| Q15 | One production screen per verification day | ok | §16.7 |
| Q16 | Head copy for Kadar 4 and 8 | superseded by Q10: the pill prints the measured distance | S2 |
| Q17 | 3-metre type tiers | ok | WP1 CSS, WP6 legibility |
| Q18 | End-of-session copy; "deset minuta" → digits | ok: the two new sentences; "deset minuta" elsewhere unchanged | WP4, WP5 |
| Q19 | Paired presentations lose fetch times | ok | WP5 step 8 |
| Q20 | Long press 800 ms | ok | WP3 |
| Q21 | A 6.2 MB frame sample in git | ok. (They are test fixtures in the repository only, never deployed to the Worker or downloaded by any client; they let the tram-path acceptance test run on any machine without the 700 MB/day recordings.) [O-73] | WP6 step 3 |
| Q22 | Read-only touch in D3 | ok | WP2 step 9 |
| Q23 | T5 (reload drops the screen label) has no package | "whatever" → WP4 chunk D [O-67] | WP4 |
| Q24 | **Uspinjača and Sljeme žičara** (the owner asked whether they ride in the ZET feed) | Not in the feed: ZET's GTFS carries route types 0 (19 trams) and 3 (135 buses) only; the funicular (type 7) and the cable car (type 6) are absent, though bus 140 Mihaljevac–Sljeme is. No machine-readable source is known to us. The funicular's fixed timetable could become a catalogue entry (an "uvijek"/opening row at Tomićeva); the cable car's operating status would need its operator's site [O-69]. | source ask in §9; not this round |
| Q25 | **What comes after the ten minutes, later** | Deferred vision, verbatim from the owner: content a person needs should be keepable "without too much fuss" — static things exportable, real-time ZET tracking "offered to remain pinned so that a person can easily walk with it without pressure until they catch the tram or bus" [O-62]. Recorded so the coding session does not treat the cleared screen as the end of the story. | §14 (deferred, not rejected); PRODUCT.md paragraph in WP5 step 10 |
| Q26 | **Follow-on package: events breadth** | Read `kultura.zagreb.hr/api` (Guru za kulturu, a City domain) at a polite rate with an identifiable User-Agent, disclosed on `/izvori`; rewrite the robots guard `test/feed/robots.test.ts` (R-P5) and `docs/izvori.md:129-132` in the same commit; the YouTube feed stays excluded (not a City domain). Interviewer's note: the repository is public and cited in the funding application, and both currently promise the opposite; the owner's ruling is to make the change openly [O-70]. Adds a feed, so it is outside this round's scope: a package of its own after D4, with the CKAN `package_show` change dates (T3) as its second item. | after D4 |

## Appendices
- A. Question bank (82) — plan file, Appendix B; the answers are the [O] rows of the ledger, folded into §2–§14.
- B. Capture index — `review.local/companion/walkthroughs/*/captures/`.
- C. Replay tables — `review.local/companion/replay/branches-0920.{md,json}`, `branches-0921.{md,json}`, `README.md` (method, metrics A–H, baselines), `tram4/result.md`.
- D. Evidence ledger — `review.local/companion/ledger.md`.
- E. Outside references — `review.local/companion/references.md` (20 patterns, six 3-metre typographic rules).
- F. Execution files — `docs/history/companion-2026-09-plan/README.md`, `WP0.md` … `WP6.md` (planner text, verifier verdict, binding reconciliation); planner notes and scratch measurements in `review.local/companion/plan/WP*/`.
- G. The approved mock — `review.local/companion/mock/` (`index.html`, production map captures, screenshots of the four scenes, README).
- H. Thin-spot matrix — `review.local/companion/data-calendar/matrix.md`; path-monitor logs `review.local/companion/path-monitor/`.
