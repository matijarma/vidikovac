# Kaj ima? upgrade brief, October 2026: from a ZET tracker to the city's view

Written 29 September 2026 by the planning session, on the record of two sessions: the source-and-vision conversation of Sunday 27 September and the strike-monitoring session of 27 to 30 September. This document is the master of the October round; the execution files live in `docs/history/upgrade-2026-10-plan/` (one file per package, moved there once executed), and every measurement they cite is on disk under the working evidence folder of the repository owner (`review.local/upgrade/`, not published).

## 0. How to read this brief

Sections 1 to 3 are the record: where the round comes from, what the days showed, what was decided. Section 4 is the pass itself: five packages in three deploys. Section 5 is the master plan the execution session follows without re-planning: lanes, seams, ownership, rules, gates. Section 6 is the verification plan, section 7 the Croatian strings proposed for the owner's read-through, section 8 what is deferred and why, section 9 the sources probed, section 10 what shipped and what did not, which wins where a sentence above was superseded while the packages were written. Line numbers inside the package files are as of commit `869ccf86` unless a file says otherwise; re-anchor with `grep` before editing.

## 1. Where this round comes from

Three threads in three days pointed at one gap.

**Sunday 27 September, evening.** Asked to tabulate every source the product uses and how each reaches a person, the owner stated the hunch the table confirmed: people who see the prototype for the first time read it as a ZET tracker. The vision that started the project ("use all the open data of the city, a god's view") had produced a product whose non-transit sources yield almost no facts worth knowing at a given place in a given hour. The owner is "more or less ok with the current design and UX"; what bothers them is that "there's actually not that much useful information as I'd like there to be". The answer that evening measured it: over a whole day only vehicles, bike counts, departures and temperature change; events dated the same day are zero or one citywide; the sources were picked by licence colour, not by the question they answer; the product juxtaposes sources instead of reasoning across them; defensible trust rules stack into silence; and the daily-life layer (power, water, roads, pollen) was deferred to a later milestone. The unit of value the product lacks is a fact that is local, timely, new and actionable.

**Sunday 27 September, 22:18.** Six hours before the first general strike of ZET in the owner's memory, the owner ruled out building anything for the strike and named the real issue: an app of this kind should "advertise its own reliability and competence by being able to sort of self-respond to such unexpected events", not through a language model rewriting the app at runtime but through something "much more subtle" that would also hold "next year when it's not a strike but a Love Parade with two million people". The development note `unexpected-city-2026-09-27.md` wrote that missing layer down: an expectation of normal, a measure of surprise, a response policy by kind of deviation and never by cause.

**Monday 28 to Tuesday 29 September.** The strike was recorded and the product observed every few hours. The operator encoded the strike as silence: one to three vehicles, zero alerts, zero cancellations, nothing on its notice feeds. The product passed every check of its own harness while stating "Tramvaj 12, smjer Dubrava, polazi u 07:53." from the timetable all day. Six defects were identified precisely along the way, most of them unrelated to the strike: two vehicles stamped by ZET a day in the future stood on the map for twenty-four hours; the published vehicle count was not the feed's; closures whose end the City rolls forward every night were printed as ending today; the one deviation the architecture does detect (a frozen feed) never reached the screen; a nine-line event title made the wall's list fitter drop the second and third departure for six hours; and the harness cannot see a false fact. On 28 September at 15:02 the owner asked that these findings be combined with the Sunday conversation into the next development round; on 29 September at 16:07 they asked for the planning to start.

## 2. What the days showed

The findings register is kept in full, with evidence paths and code anchors, in the planning record; this section gives the substance. A number in brackets is a finding id used by the package files.

**Trust defects seen precisely.**
- [F1] A vehicle report stamped later than the feed header is accepted, pins the vehicle (later real reports are rejected as older) and never expires on the server or the phone. ZET does this at midnight: on three of six recorded midnights, and on the night of 26 to 27 September about twenty ghost vehicles stood on the public map all Sunday; on 28 September two of seven stood all day and were counted as moving.
- [F2] ZET publishes parked vehicles as in service. On a normal Wednesday 36 vehicles stood in one place for over thirty minutes with a trip assigned, 12 for over two hours, two for over six (depots, beyond terminus layovers). The twin has no expectation of how a vehicle with a trip should move.
- [F3] "N vozila u pokretu" counts every tracked entry, including held ghosts and entries that have a trip update but no position; on an empty feed it said five.
- [F4] Nineteen of thirty-nine closures in the City's dataset move their expected end forward by exactly one day every night; the wall prints the placeholder as a fact and chooses it as the header sentence.
- [F5] When the feed froze for eighty-eight minutes on 29 September, the twin reported its source as stale within thirty seconds, as designed, and no surface reads that field; the header kept promising departures.
- [F6] The wall's list fitter drops rows in a fixed order and never re-adds them; an event title without a short form wraps to nine lines and the fitter sacrificed two departures and two closures to keep it.
- [F7] The observer accepts one to three departure rows and asserts nothing about plausibility; every strike-day observation passed.
- [F8] Silence, not cancellation, is how the operator encoded a general strike; only a fleet expectation would have caught it.
- [F9] The twin's learned tables store totals without a date and never decay; they cannot say what normal is, and they cannot record that no tram came.
- [F10] The feed carries cancelled trips and no-service alerts on every normal day and the product reads none of it. Measured on 21 September: 114 of 143 trips marked cancelled were driven on schedule by the vehicle carrying them, so the marker is not a cancellation; ZET's real cancellations are the no-service alerts (83 bus trips, of which one ran). A vehicle on a marked trip currently makes a board row live, which is right by accident.
- [F11] ZET's own traffic notices reach only the paired "Promet" card, headline only; the diversion of lines 5 and 13 for the CRO Race on 27 September was in the feed for three days and shown nowhere.

**The missing layer.**
- [F12] The product knows the health of its sources, not the state of the city: no computed expectation, no comparison, no voice change. Every expectation in the code is a constant typed from one day.
- [F13] On the day that mattered, the declared fleet expectation (trips active per the timetable against vehicles seen) was the only mechanism that would have worked.
- [F14] The alternative was in the product's own feeds and it said nothing: bikes drained from 1,705 to 909 while the header printed a bare count; rail ran normally and appeared nowhere on the phone's first screen.

**Sparse facts.**
- [F15] The thin-spot matrix of 21 to 22 September: only vehicles, bikes, departures and temperature change over a day. Measured again on 29 September over 183 samples with the round's own instrument: the number of non-transit facts that are local, timely, new and actionable is zero at all six measured places in every hour band, and zero citywide per day; what looked like facts were closures whose end rolls forward every night.
- [F16] Of 147 events fetched, seven fall in the next seven days; thirty-nine of forty Kulturpunkt announcements carry a venue hint the resolver cannot place; the City's own culture calendar was excluded under robots.txt, though the owner ruled on 22 September to read it openly.
- [F17] Sources were picked by licence, not by the question they answer.
- [F18] Fetched but never shown: tomorrow's forecast on the wall, the gazette, assembly sessions, neighbourhood news, ZET notices on the unpaired surfaces, cycle paths.
- [F19] Trust rules guard against stale data, not misleading meaning; together they leave trams.
- [F20] The only joins are event with venue and line, departure with vehicle, pharmacy with night; the conditional joins that make a companion (rain, an event ending after the last tram, an empty bike station, a closure and its lines, heat and water) do not exist.
- [F21] The daily-life layer (power, water and heating cuts, road state, pollen) was scheduled for milestone M5.
- [F22] The last-and-first-tram files expire on 11 to 13 October and the rows would vanish silently; nothing watches the freshness of the catalogue.
- [F23] Small correctness items: map closure lines are not filtered by time while rows are; search results and map markers disagree for "wc" and "voda"; the `/open` lede names a card that no longer exists; the public statistics still list a removed news module; credits and the source page omit the pharmacies, the emergency numbers, the derived timetable files and the fonts.

**Found by the planning survey of 29 September.**
- [F24] ZET published a new static timetable (feed 000396) on the morning of 28 September; the committed artefacts are still 000395, and Tuesday's boards already carry the new service prefix.
- [F25] The raw feed archive in R2 expires after seven days; 25, 26 and part of 28 September were not yet on disk, 29 September not at all.
- [F26] The thin-spot matrix was stale: 180 sample folders exist up to 29 September, 48 had been analysed.
- [F27] The basemap's point-of-interest layer carries no opening hours; "open now" needs an own OpenStreetMap extract.
- [F28] The source register still lists live sources as planned and a live flag as off.
- [F29] The release smoke is a manual procedure without a committed script.
- [F30] The fitter replay that proved F6 reads files outside the repository and must be rebased onto committed fixtures.
- [F31] Twenty-four worktrees, all but one merged, occupied 31 GB of a 61 GB disk.

## 3. Decisions

**In force from the owner.** Not a strike mode: build the scale (expectation, surprise, response policy), never event modes; the product never names a cause it has not been told; a language model never decides what is true (27 September). The strike days are the first deviation fixture, never a normal replay, tuning or fixture day. kultura.zagreb.hr is read openly despite its robots.txt, disclosed on the source page, with the robots guard rewritten in the same commit (ruling O-70 of 22 September). News feeds stay out ("Ovo nije aplikacija za vijesti", 16 September). Order of value stays trust, then wall, then phone; mobile first for the screens. The design and interaction stay; the round adds information, honesty and reasoning. The daily-life layer is pulled forward from milestone M5 as yellow sources shown with the label "neslužbeni prikaz", after a feasibility probe (29 September). Execution happens in a fresh session that may run a smaller model, from an execution package that leaves no design decision open (29 September).

**Taken by the planning session, with the reason.** One pass, three deploys, read-throughs as information between them. The pass opens with the regeneration of the timetable artefacts from feed 000396, because every fixture cut from 28 September and the declared expectation depend on it. Strike-day frames are committed only as small labelled cuts; whole days stay outside git. The operational numbers below are set by the analyses of the preparation phase and recorded here once measured:

| Number | Value | Reason (the measurement it rests on) |
|---|---|---|
| Future-stamp tolerance | 30 s | on 21 September 948 of 5,313 vehicle stamps ran ahead of the header, none by more than 4 s; the bike feed already refuses 30 s |
| Parked vehicle | a tram standing 30 min or a bus 46 min with a trip, or a tram inside one of the two depot polygons | the 24 September census (194 vehicles stood over ten minutes, 36 over thirty, 12 over two hours) and the longest scheduled layover per block, measured per mode on five weekdays; the depots at Dubrava and Ljubljanica measured from the standing clusters, no bus garage found |
| Rolling closure end | a closure older than 7 days whose end is within 24 h has an unknown end | of 39 closures, 19 rolled a day overnight and all were at least 13 days old; the one real end was 186 hours away; no closure between 1 and 13 days old existed |
| Stale reaches the screen | when the source is older than 3 min, held 60 s; the source's own 30-second stale flag is not used | at 180 s every fix is evicted, so the note is true when shown; normal weekdays have one ZET-side gap over 180 s around 07:15 (296, 193 and 185 s on three recorded days), which the note may honestly show; the 30-second flag would fire four to nine times a weekday |
| Event title on the wall | at most 2 lines | the source offers no short form; a nine-line title cost four rows |
| Service state thresholds | reduced below ratio 0.5 for 5 min, or one mode below 0.4; silent at or below 10 % (or two vehicles) for 10 min; clears at 0.25 after 3 min and 0.7 after 5 min; no verdict below 20 expected; judged against the smallest expected of the next 10 minutes | the fleet curves of six recorded days (three weekdays, a Saturday, two Sundays): zero false minutes, the lowest five-minute ratio 0.75, once the builder ends a vehicle run at a gap over 30 min (tram) or 46 min (bus) so depot breaks do not count as service |

## 4. The pass

Five packages, three deploys. Each package has an execution file in `docs/history/upgrade-2026-10-plan/` with its steps, tests, acceptance commands and agent briefs.

**U0. Trust fixes (deploy DU1).** A report stamped in the future is refused, on the server and the phone, and a header that goes backwards or lies in the future is not a new frame. The vehicle count is the number of vehicles with a fresh position, nothing else; parked and depot vehicles are held in state and not published; trip updates age out during a freeze. A closure with a rolling end prints "u tijeku" and never becomes the header sentence. The frozen feed reaches the wall and the phone as an unconfirmed state through one shared helper, with copy that stops promising the timetable; in that state the header carries no departure sentence at all. The fitter caps an event title at two lines, refits after a drop, and never keeps a distant event at the cost of a departure or a closure; the wall's list uses the same fix-age rule as the phone. The artefacts are rebuilt from feed 000396 once, and a check fails loudly when the server's feed is newer than the committed one or the last-tram files are within a week of expiry. Acceptance: replays of the strike frames (the ghosts gone by 00:04, the count zero on an empty feed, the parked census), the closure pair, a stale wall scene, the Tuesday fitter scene on committed fixtures. *Superseded in part, see §10:* the stale wall scene became one DOM case in the unit tests.

**U1. The operator's voice (deploy DU2).** Cancelled trips, skipped stops and alerts are decoded and carried in the snapshot. A trip ZET cancels leaves the boards on every surface, and a vehicle on a cancelled trip never upgrades a row to a countdown; the rule's exact form follows the cancellation census of normal days, so that no real departure is removed. ZET's traffic notices keep their description and appear, at most one at a time, as a "ZET javlja" row on the unpaired wall and on the phone's first screen, and as a sentence while fresh. Acceptance: a normal-day cut with alerts kept, the CRO Race notice fixture, the strike-week feed yielding no row. *Superseded in part, see §10:* a departure leaves the board on ZET's no-service alert unless a positioned vehicle carries the trip, and a cancelled marker alone removes nothing.

**U2. The expectation layer, first cut (deploy DU2).** A build-time artefact says, for every five minutes of every service day, how many vehicle runs and trips per route the timetable has active, with the calendar resolved. The twin compares that with the vehicles it sees, judges the deviation with hysteresis and holds, and publishes a service state beside the source's freshness: normal, reduced, silent or unknown, with the two numbers, the ratio, the duration and a confidence. The voice changes by state and never by cause: in a reduced state only confirmed lines keep their timetable sentence, the deviation is said once with its numbers, bikes and rail are promoted; in a silent state no timetable departure is said, the map keeps the network with the real vehicles there are, and one quiet note explains. The learned side starts writing: fleet and service counters, bike totals, dates and a slow decay on the learned tables, a per-route day table that marks deviant days so they can never train a normal, and a public holiday list. Acceptance: no false deviation on five recorded normal days, the strike cuts entering the silent state within twenty minutes of 03:30 and clearing when vehicles return, synthetic halved and restored days, a silent wall scene, three observer rows on production. *Superseded in part, see §10:* the learned writers, the holiday list and the fleet rows of the statistics page were not built, and two observer rows shipped, not three.

**U3. Facts breadth (deploy DU3).** Sources that answer a question people ask: the City's culture calendar with coordinates for every event; the libraries' programme as a yellow source; the hourly rain forecast of DHMZ and tomorrow's range on the wall; road state from HAK and planned power and water cuts from HEP and VIO, matched to streets, as yellow sources; an OpenStreetMap extract of opening hours for the places people look for, evaluated at build time and published under ODbL; rail departures on the phone's first screen and the wall when a station is inside the frame. Venue placement for Kulturpunkt through two gazetteers. Five cheap joins: rain within two hours, an event ending after the last tram, an empty bike station and the nearest with bikes, a closure and the lines it diverts, heat and the nearest drinking water. A freshness watch over every catalogue source and data file, visible on the operator page. The thin-spot matrix becomes the round's instrument: non-transit local, timely, new, actionable facts per place per hour, measured before and after. Acceptance: fixture-pinned parsers, one row per new kind with trams keeping their three, the families in their three copies, the joins from fixtures, and the KPI moving from a measured zero to at least three in the day and evening bands at the six measured places and at least thirty distinct facts a day citywide. *Superseded in part, see §10:* three of the five joins and no freshness watch shipped.

**U4. Harness, hygiene and closing (deploy DU3).** The observer's departures row expects the fitted count; a fit-dropped row; the release smoke as a committed script; the small correctness items of F23; the stale register rows and flags; the backlog of the September round folded into the lanes that own the files; the documents; the README; a dated development note on the proposal page; the plan folder moved to history; the hygiene guard. *Superseded in part, see §10:* the release smoke was not built (F29 closes) and the September backlog was carried, not folded in.

Order and gates: the nine briefs run in parallel from one base commit; one integration, one gate, one review; then the pushes in sequence, U0 alone first (DU1) so the trust fixes are observed on the live screen by themselves, then U1 with U2 (DU2), then U3 with U4 (DU3). Each push produces its read-through file.

## 5. Master plan

### 5.1 Lanes and the single owner per file

- Twin and shared motion (`worker/twin/*`, `worker/do/twin-do.ts`, `shared/motion/*`, `worker/protocol.ts`): U0-A, then U1-G, then U2-A2, then U2-D; strictly sequential, each brief forking from the previous merge.
- Client trust and sentence (`app/src/city/{feed,sentence,nearby,nearby-markup}.ts`, `shared/city/*`, `shared/kiosk/sentence.ts`, the string catalogues): U0-B, then U1-H and U1-I, then U2-B1, then U2-B2, then U3-G; sequential, with the i18n groups owned per brief.
- Wall list and map (`app/src/kiosk/timeline.ts`, hunks of `app/src/kiosk.ts`, `kiosk/invitation.ts`, `kiosk/mapview.ts`, the kiosk CSS): U0-C, then the U1 notice row, then U2-B2's note states, then U4's fitter backlog; one owner at a time.
- Scripts, artefacts, fixtures, harness (`scripts/*`, `app/public/data/*`, `test/fixtures/*`, `e2e/*`): U0-D and U0-E, U2-A1, U2-C, U3's builders, U4's rows; parallel where files differ.
- Feed modules and the catalogue (`worker/feed/modules/*`, `worker/city/*`): U3's modules, independent of each other and of the twin lane; the most parallel part of the pass.
- Documents and closing: last in each deploy, one agent.

The full ownership tables (file by file, test file by test file) are in the package files; a brief that must touch another brief's range writes one handoff line and the owner applies it.

### 5.2 Seams built once

- `shared/city/service-state.ts`: `serviceStateOf(snapshot, now)` returning one of loading, down, unconfirmed, silent, reduced, normal, unknown with its start; `departureVoice(snapshot, now)` returning all, live-only or none; `routeConfirmed(snapshot, routeId)`. U0 creates it with down and unconfirmed; U2 adds the rest from the published service state. Consumers switch once, in U0.
- `fleetSeen(tracks, nowSec)` in the twin's publisher (U0) feeds both the count and the service state's observation.
- `sources.zet.service` on the wire (U2), additive; the module stays live (rule R-TE5 unchanged); down remains the far end.
- `NearbyInput.policy` (U3) lets U2 promote rail and bikes without touching the row producers.
- `service.operator` (U1) carries the operator's own statements for U2's response policy.

### 5.3 Rules for agents running in parallel

The ten rules of the September brief (`companion-2026-09-22.md` §15.8) carry over unchanged: strings only inside the owning group, no reorders, deletions only in the closing lane, parity on every merge; the integrator files (`kiosk.ts`, `mapview.ts`, `dashboard.ts`, `workspace.ts`, `chrome.ts`) one integrator at a time; test ownership per package file; sentence-level document edits plus the pins they break; artefacts regenerated once; production screens one per verification day, never by an agent; the merge gate `npm run typecheck && npm run typecheck:tests && npm test` with the acceptance tier never skipped; the fixed constraints (presence gate, no accounts, tracking, push or route planning, no invented estimates beyond the labelled ZET estimate, `docs/prijava` and `app/prijava` untouched, deploy only by pushing `main`); public-repository hygiene (every committed document intentional and indexed, working plans to history once executed, nothing from a session left over); owner strings byte-exact; Croatian standard and natural, gender-neutral for things, never "zid", every new or changed string listed for the read-through. Two rules are added for this round: honesty about an unconfirmed departure lives in the header sentence, the map note and the status line, never in a caveat word inside a list row (the harness forbids it); and no cause word ("štrajk", "strike") appears in any string, because the product does not know the cause.

### 5.4 The execution package

The execution session receives: this brief; the package files with a binding reconciliation section each; one prompt file per brief with the read set, the owned files, the exceptions, the gate and the report headings; the fixtures on disk with their READMEs; the analysis numbers; a run ledger with the wave table; and a runbook with roles, the git model, the waves, the merge order, the deploy and observation procedures, the decision rules for red gates, the concurrency rule (derived from the machine's CPU count), the quota rule and the close. The orchestrator of that session launches briefs by pointing at files, reads short reports and gate tails, merges fast-forwards and follows the runbook's rules; it composes no brief and designs nothing. Briefs marked "strongest model" (the twin's state machine, the sentence rules, the OpenStreetMap extract, the surface integrators) go to the strongest model the session has; every other brief names every file, line range and command it needs and can run on a smaller model.

### 5.5 Efficiency rules

Quality is not traded, sequencing is. The nine briefs of the pass fork from one base commit and run in parallel, against seams frozen in writing beforehand; one integrator resolves the merges in a fixed order; the merge gate, the acceptance tier, the replays and the browser acceptance specs run once on the integrated tree; one read-only review of the whole diff gets one fix pass; then the deploys are pushed in sequence, the trust fixes first and alone so they can be watched on the live screen for ten minutes. Tests are written where a rule is subtle (the state machine, the closure rule, every parser on its saved fixture, the fitter scene) and nowhere else. The whole pass is planned as one working day of running on a sixteen-core machine.

## 6. Verification

- Merge gate for every lane: `npm run typecheck && npm run typecheck:tests && npm test`; the acceptance tier `npm run accept` never skipped; browser tests only in the main checkout by the integrator.
- Replays as acceptance: every trust fix and the service state are held by a replay of recorded frames committed as small fixtures with a README; the strike cuts are labelled deviation fixtures. The tram-path grader keeps its thresholds on a whole recorded day.
- Harness rows added: the departures row expects the fitted count; fleet ratio; no timetable departure sentence while silent; the stale note; a fit-dropped row; the acceptance wall scenes gain a stale morning and a silent morning.
- Production observation after each deploy on the day's temporary screen at a quiet hour with the read-only observer; while the strike lasts, its mornings are the live acceptance of the service state.
- The KPI: the thin-spot instrument before the pass and after each deploy, at six places and five hour bands.
- Read-throughs: every new or changed Croatian string per deploy in a checkpoint file, as information.
- Hygiene at the close: only intentional, indexed documents under `docs/`; the plan folder in history; a dated note on the proposal page; nothing from the working folders in git; the frames fixture size within its stated bound.

Per-package acceptance tables with commands and thresholds are in the package files.

## 7. Croatian strings proposed for the owner's read-through

Standard, natural Croatian; gender-neutral for things; never "zid"; never a cause word. Grouped by deploy. English forms sit beside each key in the catalogue.

**DU1 (U0).** `kiosk.sentence.outage` changed to "ZET ne šalje položaje vozila; polasci iz voznog reda, bez potvrde." (the current text promises the timetable). `kiosk.nearby.outageNote` changed to "ZET trenutačno ne šalje položaje vozila; polasci su iz voznog reda, bez potvrde." New `kiosk.nearby.ongoing` and `panels.ongoing`: "u tijeku" (a closure whose end is unknown). Documents: "Jedina iznimka je naslov događanja bez kraćeg naziva, koji se reže na dva retka."

**DU2 (U1).** New `kiosk.nearby.zetSays`: "ZET javlja". New sentence family `notice`: "ZET javlja: {title}". New `arrivals.cancelledRoute` (phone stop sheet only): "Linija {route}: ZET javlja otkazane polaske."

**DU2 (U2).** `kiosk.sentence.service`: "ZET: u pokretu {seen}, po voznom redu oko {expected}." (the expectation is the timetable's, which runs about a fifth above a normal day's positioned vehicles; alternative once a learned normal exists: "ZET: u pokretu {seen}, uobičajeno oko {expected} u ovo doba."). `kiosk.sentence.serviceNone`: "ZET: nijedno vozilo u pokretu, po voznom redu oko {expected}." Plurals `kiosk.sentence.vehicles`: "{count} vozilo" / "{count} vozila" / "{count} vozila". `kiosk.nearby.silentNote`: "ZET: u pokretu {seen}, po voznom redu oko {expected}. Polasci su iz voznog reda, bez potvrde vozila." `arrivals.noteReduced`: "ZET: u pokretu {seen}, po voznom redu oko {expected}. Vremena su iz voznog reda, bez potvrde vozila." `kiosk.paired.serviceLine`: "ZET: u pokretu {seen}, po voznom redu oko {expected}". `landing.live.usually` and `kiosk.lines.usually`: "po voznom redu oko {count}". `statistika.fleetCaption`: "Vozila u prometu po satu (viđeno / po voznom redu)".

**DU3 (U3).** Sentence families: `trainAt` "{station}: vlak, smjer {to}, polazi u {time}."; `rainAt` "Oko {time} {condition}; vjerojatnost {p}."; `forecastTomorrow` "Sutra {condition}, od {min} do {max} °C."; `supplyCutToday` "{street}: danas bez {what} od {from} do {until}."; `supplyCutTomorrow` "{street}: sutra bez {what} od {from} do {until}."; `roadUntil` "{street}: {what} do {until}."; `openUntil` "{name}: otvoreno do {time}."; `eventLastTram` "Nakon „{title}” zadnji tramvaj {route} polazi {time}."; `bikesEmpty` "BAJS {station}: 0 bicikala; BAJS {other}: {bikes}."; `heatWater` "Vrućina: pitka voda {address}."; `closureLines` "{street}: zatvoreno. Preusmjereno: {routes}.". Rows: `kiosk.nearby.rainChance` "vjerojatnost {p} %"; `kiosk.nearby.cut.struja` "bez struje {from}–{until}"; `kiosk.nearby.cut.voda` "bez vode {from}–{until}"; `kiosk.nearby.openUntil` "otvoreno do {time}"; `kiosk.nearby.openKind.*`: ljekarna, pošta, knjižnica, tržnica, trgovina, pekara, kafić, bar, restoran, kino, banka, benzinska, ordinacija; `kiosk.nearby.water` "Pitka voda"; `kiosk.nearby.road.*`: radovi, privremena regulacija, zatvoreno za promet, zastoj; `arrivals.train` "Vlak". Attributions: "Izvor: Guru za kulturu, Grad Zagreb (kultura.zagreb.hr), uz poveznicu na svako događanje"; "Izvor: Knjižnice grada Zagreba, Arena Zagreb, GNK Dinamo; neslužbeni prikaz"; "Izvor: DHMZ, Otvorena dozvola, {vrijeme}"; "Izvor: HAK, stanje na cestama, {vrijeme}; neslužbeni prikaz"; "Izvor: HEP ODS Elektra Zagreb i Vodoopskrba i odvodnja; neslužbeni prikaz"; "© OpenStreetMap contributors, ODbL 1.0; izvedena baza podataka (radno vrijeme mjesta)".

## 8. Deferred, with reasons

- Waste collection schedules: no open dataset; the City site answers per address behind a finder without terms; the feature flag stays off and the fixture's licence label is corrected.
- News feeds and the City's news RSS: the owner's ruling of 16 September; the City feed is neither local nor actionable.
- HEP Toplinarstvo: notices name neighbourhoods, not streets, and fail the local test; revisit when streets appear.
- Pollen: the season ends in October; planned for March with a fixture cut in February.
- Crowd events (Arena Zagreb, GNK Dinamo, the City's sports-facility calendar): the arena's listing carries no time of day, the club's site blocks scripted access, the facility calendar is mostly recurring training; revisit with an official calendar feed or a crowd dimension of the expectation layer.
- Learned normals replacing the declared expectation: writers and reader deferred to the next round; the reader waits for four non-deviant days per day type and is validated then.
- Per-station bike history: only citywide totals are recorded in this round.
- A per-route service state: the citywide state ships; the per-route pairs already take the voice from a missing line's rows; a per-route state is the next dimension.
- F29, the release smoke as a committed script: closed. The manual procedure stays; the accept tier and the production observer cover it.
- The September backlog outside the harness, carried to the next round because each item sits in a file this round's packages edited: the reconnect pill's one-paint closure re-entry, pill piles, the opening row re-created once a minute, the sentence turning 13.4 s before its fact expires, the solar-first sentence, `/s/` blank before its module, round-1 items F9 and F10, fonts revalidation, mobile schematic parking, onLoad's layer batch, desk basemap labels.

## 9. Sources probed on 29 September

| Source | Endpoint | Density | Terms | Verdict |
|---|---|---|---|---|
| OpenStreetMap opening hours | own extract at build time from the Geofabrik Croatia file, never a live query | 4,383 elements with hours in the city box; 40 % of useful amenities, 49 % of shops | ODbL, derived database | ready |
| Guru za kulturu (kultura.zagreb.hr) | JSON events list with coordinates for every event | 29 to 53 occurrences a day, 10 to 15 timed | reuse with attribution and link; robots.txt overridden by ruling O-70 | ready; internal route, fixture-pinned |
| Knjižnice grada Zagreba | HTML programme pages | 6 to 9 starts per weekday, each at a named branch | unstated; yellow | ready |
| HŽ Putnički prijevoz | static GTFS, in the catalogue already | 163 stop-events a day at Glavni kolodvor | no licence stated | promote on the first screen |
| DHMZ hourly forecast | XML per model run, hourly steps for three days, ten Zagreb-area points, rain amount and probability | rain within two hours from DHMZ's own curve | Otvorena dozvola | ready |
| HAK road state | HTML sections with their own update time | 3 to 10 Zagreb items a day | article 8 of the site's terms allows an automated relay of a limited selection with source, update time and link; article 10 forbids scripted collection without written approval; the relay form is used and a letter is written | ready as a limited relay |
| HEP ODS Elektra Zagreb, VIO | HTML per day (power), HTML notices (water); streets and hours | 0 to 6 and about 1 a day | none found; yellow, letters in parallel | ready |
| Arena Zagreb, GNK Dinamo | HTML programme and fixtures | about 8 and 3 a month | unstated; the arena lists no time of day, the club blocks scripted access | deferred |
| Čistoća | per-address JSON behind a finder | one fact per address per day | none | out |
| News feeds | RSS | up to 48 Zagreb-tagged items a day | owner ruling | out |

## 10. What shipped

Base commit `170b43a3`, 29 September 2026. Where a sentence above was superseded while the packages were written, this section and `docs/history/upgrade-2026-10-plan/` win.

- **DU1**, tag DU1 (`72e498c3`), pushed 29 September 2026 at 22:40 (Zagreb) and observed live without a red row over 300 readings. Future stamps are refused, the vehicle count comes from fresh positions, a rolling closure end says "u tijeku", and a frozen feed shows as an unconfirmed state.
- **DU2**, tag DU2 (`44e8ac14`), pushed the same evening at 22:53. ZET's no-service alerts take departures off the boards, its notices appear as "ZET javlja", and a service state (normal, reduced, silent) is judged against the timetable; the voice follows it and names no cause.
- **DU3**, the tag DU3, pushed 29 September 2026. Five feed modules (culture calendar, libraries, hourly rain, road state, planned cuts), OpenStreetMap opening hours, rail on the first screen, three joins, the documents and the note on `/prijava/`.

Not built (the §5.4 cuts): the release smoke, observer rows beyond `departures` and `silent-departures`, the scenes `stale0745`, `silence0745` and `notice1230`, the freshness watch, the learned-normal writers and reader, the closure-to-lines and heat-to-water joins.

Carried: the September backlog of §8. Follow-ups: depot blinks at pull-in and pull-out (81 tram and 78 bus cases on 24 September), the unconfirmed age read by the device clock, `forecastTomorrow` rarely firing, the phone's 30 s refetch of hourly modules.

Pending: the KPI after-measurement; the 96-hour sampler starts at the DU3 push and the KPI reads the second and third Zagreb day after it.
