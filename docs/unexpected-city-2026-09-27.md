# When the city stops matching the model

Development note, Sunday 27 September 2026, written the night before the first general strike of ZET in the owner's memory. It records a gap in the architecture of Kaj ima?, not a bug and not a plan for the strike. The strike is only the occasion: it is the first day on which every source of the product will answer, every module will report `live`, and the product will still describe a city that does not exist.

## 1. What will happen on Monday, and why it is not the point

From 03:30 on 28 September trams and buses stop. The realtime feed of ZET stays reachable. What the code does with that is traced, not guessed:

- Departure rows are timetable rows that a tracked vehicle can upgrade to a countdown (`shared/city/arrivals.ts`, `arrivalsAt`). With no vehicle they stay, as grey clock times. The public screen prints no word next to them (`app/src/kiosk/timeline.ts`); the paired boards print "vozni red".
- The header sentence keeps choosing departure facts and says "Tramvaj 6, smjer …, polazi u 08:03." (`app/src/city/sentence.ts`). It is a true sentence about the timetable and a false sentence about the morning.
- The outage state, with its map note "ZET trenutačno ne šalje položaje vozila; polasci su po voznom redu", exists only for a module status of `down` (`app/src/kiosk.ts`, `outage()`), and the design says explicitly that a quiet ZET is told by `sources.zet` and never by degrading the snapshot (`worker/feed/registry.ts`, rule R-TE5). A feed that answers with zero vehicles is `live`. Even if the note showed, its copy would be wrong: the departures do not follow the timetable that day.
- ZET's feed carries `scheduleRelationship: CANCELED` on trip updates and vehicles, and `Alert` entities with `NO_SERVICE`; both are in the raw frames the Worker records to R2 every ten seconds, and neither is read (`worker/twin/feed-decode.ts` reads `vehicle` and `tripUpdate` fields only). ZET's own traffic notices (`rss_promet.aspx`) reach one card of the paired screen, headline only; their text is dropped at ingestion.

None of this needs a strike to be wrong. It is wrong whenever the world departs from the timetable further than one vehicle at a time. The owner's framing, which this note adopts: a general strike is rare enough not to count even as an edge case, and a "catastrophe switch" coded for it would cover one point of a scale and need a person to flip it. What should exist is the scale.

## 2. The gap, stated precisely

Kaj ima? knows the health of its sources. It does not know the state of the city.

Every module answers one question well: did the fetch work, and how old is what I have (`live`, `stale`, `down`, with TTL and maxStale per source in `docs/izvori.md`). The vehicle twin answers a second question well, for one vehicle at a time: is this tram where its own trip says it should be, and for how long may I believe a silent one (the 180-second eviction, the return to the path within 60 metres, the wrong-turn grader). What no layer answers is the third question: does what my sources say, taken together, look like this city at this hour on this kind of day?

Expectations do exist in the code, but every one of them is a constant that a developer measured on one day and typed in:

- the BAJS guard treats a feed in which no station of at least ten has a bike as the feed's fault, "not the city's", because "even at 03:00 … three in four stations have one (24 Sep: 158 of 200)" (`worker/city/live.ts`, `bikesDegenerate`). That is an expectation of the city, hard-coded from one night. On a morning when the centre is emptied of bikes by people who have no tram, the guard would be the first to call the truth broken;
- the twin's 180 s eviction was chosen because 120 s "would blink about 3,200 standing terminus trams a day" (companion brief, decision on EVICT_S), a measured normal frozen into a number;
- the night rule for the list (two departure rows at night, three by day), the "Noćas" sentence family rejected after 05:00, the first-tram row shown 22:00 to 06:00: time-of-day expectations, fixed;
- the observer's thresholds, the release smoke's allowances: expectations of the product, fixed.

Each constant is right on the day it was measured and silent on any other. There is no place where an expectation is *computed*, no place where observation is *compared* to it, and so no place where the product's voice can *change* because the comparison failed. The trust work of September made the product honest about its sources. It did not make it honest about the world.

## 3. What "self-response" means here, and what it does not

It does not mean a language model in the kernel redesigning the app at runtime. The model already used (Workers AI choosing among approved sentence templates) has one job, phrasing, and should keep it; a model may later summarise an operator's notice, but it must never decide what is true.

It does not mean event modes: a strike mode, a marathon mode, a New Year mode. Events are unbounded; dimensions of deviation are few.

It means three capacities, each general, each buildable from what the product already has:

1. **Expectation.** For each live signal, a model of *normal for now*: this weekday, this hour, this season. Two kinds exist and both are cheap. The *declared* expectation comes from the timetable: the same GTFS the boards are built from says how many trips should be in motion in any minute, on which routes; nothing computes that number today. The *learned* expectation comes from the product's own history: the R2 frames (a rolling week of the whole fleet), MetricsDO's hourly counters (kept 730 days), the dwell and junction tables, BAJS levels, board join rates, session counts. The data-calendar matrix built by hand in September (`vehicles in the centre box per half hour, closures, departures per stop`) is exactly such a table; it should be a living one.
2. **Surprise.** Observation compared with expectation, per dimension, published as a first-class fact in the snapshot next to `sources.zet`: which dimension, how far (a ratio, not a label), for how long, with what confidence. Not "strike detected" but "vehicles in motion: 4, normal for a Monday at 08:00: about 300, for 47 minutes". The same mechanism says, on a different day, "fleet normal; dwell at Trg bana Jelačića four times normal; every BAJS station within a kilometre empty".
3. **Response policy.** What the product's voice does when surprised, defined per *kind* of deviation and never per cause. The rules are few and they are about honesty and priority, not about content: stop asserting what is no longer confirmed (a timetable row loses its "polazi u" voice and says what it is); promote what is still confirmed (rail, bikes, walking distance, openings, the pharmacy); say the deviation once, plainly, with its number; surface the operator's own words when they exist (ZET's cancellations and alerts in the feed, ZET's notices in RSS); never name a cause the product has not been told. The product does not know there is a strike. It knows the fleet is gone and that ZET has said something. That restraint is what makes the mechanism general.

A catastrophe is the far end of this scale, and the scale handles it without anyone flipping anything.

## 4. The scale, by dimension rather than by event

| Dimension of deviation | Observed today | Expected from | Days that move it |
|---|---|---|---|
| Fleet in motion, per route | the twin's vehicle count (`sources.zet.itemCount`) | timetable trips active now; learned by hour | strike, snow, a depot fire, an operator IT failure |
| Cancelled trips, no-service alerts | in the raw frames, unread | zero, or the learned daily share | partial strike, works, a derailment |
| Speed and dwell along the path | the twin's plan and hindsight, the dwell tables | learned per stop and hour | a parade, a match, a demonstration, snow, a marathon |
| Bikes available, per station | BAJS every minute | learned per station and hour | any day without trams, a festival, a heat wave |
| Closures, their density and where | `prometnice` | learned; the works calendar | a marathon, a state visit, a demonstration |
| Feed cadence and freshness | header timestamps, `twin_tick` | ten seconds | the operator's IT, a network event (the one case handled today) |
| Timetable against the world | `static_watch` (a newer GTFS on the server) | the built version | a new timetable not yet built in, a long detour |
| Demand on the product | sessions, screens, board requests (MetricsDO) | learned per hour | the first day of school, a strike, a crisis |
| Environment | DHMZ warnings, the Sava bulletin, air quality (all fetched today, none judged) | seasonal normal | heat, flood, a smog day |

Most rows already have a source in the product. What they lack is the second and third column and a voice.

## 5. What exists to build on

- The raw feed archive in R2 (`vidikovac-feed/zet-rt/…`, every frame, seven days) and the local recorded days; the strike day itself, recorded on 28 September, as the first anomaly fixture.
- `MetricsDO` (`worker/metrics-do.ts`): hourly counters for 730 days, the live dwell and junction tables, `twin_tick`, `source_fetch`, `static_watch`, exposed on `/api/statistika`.
- The timetable shards built by `CatalogueDO` (`worker/city/schedules.ts`) and the twin's trip index (`app/public/data/zet-trips.json`, with services and blocks): the declared expectation of the fleet is a sum over them.
- `sources.zet` in the published snapshot (`worker/twin/publish.ts`): the slot where a service state belongs, already read for freshness.
- The sentence chooser's closed fact families (`shared/kiosk/sentence.ts`): a deviation family slots in beside departures, closures, weather and bikes, with the same 80-character rule and the same 20-second hold.
- The ZET RSS module (`worker/feed/modules/dogadanja/zet-rss.ts`) and the "ZET javlja" row: the operator's voice, currently confined to one card.
- `arrivals.scheduled` ("vozni red") and `arrivals.note`: the words for an unconfirmed row already exist; the rule for when to show them does not.
- The observer (`scripts/observe-production.mjs`): its `fleet` series and the `live` flag on every row are the measurement of the product's side of this.
- The negative example: `bikesDegenerate`, an expectation typed in as a constant, to be replaced by the learned one.

## 6. A first cut that is small and honest

Not for the strike, and not before the recorded day has been replayed. In order of value:

1. **Read what ZET already says.** Decode `scheduleRelationship` and `Alert` entities; a cancelled trip leaves the board; a route under `NO_SERVICE` says so. This is the operator's own statement and it is discarded today.
2. **The declared fleet expectation and the ratio.** Trips active this minute from the timetable, vehicles seen from the twin, the ratio smoothed over a few minutes, published on `sources.zet` as a service state with its two numbers and its duration.
3. **The voice rules.** On the public screen and the phone, below a ratio held for some minutes: timetable rows carry "vozni red" and an unconfirmed mark on every surface, the header takes the deviation family instead of a departure fact, Sada promotes rail and bikes, and any ZET notice from the feed or RSS is shown as ZET's. The Croatian strings are proposed in one place for the owner's read-through; two examples, unreviewed: "ZET: u pokretu 4 vozila, uobičajeno oko 300 u ovo doba." and "Polasci po voznom redu, bez potvrde vozila."
4. **Learned normals.** Per hour and weekday, from the product's own counters and frames, for the fleet first, then bikes, dwell, closures and demand; each replaces a constant.
5. **The same three capacities for every row of the table in section 4**, one dimension at a time, each with its replay.

Acceptance is replay, not opinion: the 28 September frames (no departure countdown for a cancelled or silent trip, no "polazi u" sentence, the deviation sentence within N minutes of 03:30, the state clearing when vehicles return), synthetic variants of a normal day (the fleet halved, dwell doubled, bikes emptied in the centre), and the observer's `fleet` and `live` rows on production.

## 7. The strike day as data

The recorded day must not be lost and must not be mistaken for normal. It is the first fixture of a deviation and belongs in the fixture set with that label, never in the inputs of a learned normal or of any parameter derived from recordings. Section 8 records what in the running system learns from live data and what, if anything, the day distorts.

## 8. What learns from live data today, and whether the strike day must be deleted

Traced on 27 September so that the question "will the strike day wrongly train the movement model" has an answer from the code rather than from caution.

**One part of the running system learns and keeps what it learns:** the twin's own SQLite tables `edge_time` (travel time per piece of track, by hour and day type), `stop_dwell` (standing time per platform), `node_wait` (waits before junctions) and `stop_dwell_recent` (individual samples of the last 90 minutes) (`worker/twin/persist.ts`). Samples come from `extractEvidence` (`shared/motion/learn.ts`), which needs at least two consecutive reports of the same vehicle on its own tram path, and runs only for vehicles that reported that tick (`worker/twin/tick.ts`). The tables are read back by the planner, the dwell estimate and the junction rule, so they do change map motion and the next-stop ETA (`shared/motion/plan.ts`, `dwell.ts`, `junction.ts`); they do not touch wrong-turn decisions, the matcher or the ordering register, whose inputs are the network and the timetable index only.

**What this means for a day with no vehicles:** the learner learns only from presence. A missing tram is not recorded as anything; an empty feed writes nothing; a vehicle without a route gets no path and no samples. The few vehicles that do run are real trams whose samples are genuine, and next to the roughly 53,000 dwell samples of one normal weekday they are noise. A cell is not used below ten samples. The recent window empties itself within 90 minutes of service returning. Nothing has to be deleted, and nothing could be: samples are stored as totals without a date, there is no reset route, and the main tables have no decay (the history already notes "a poisoned cell never recovers", `docs/history/plan-promet-krug-f.md`, item D10). The only automatic reset is the wipe of `edge_time` and `node_wait` when the rail network is rebuilt.

**Nothing else feeds back.** MetricsDO's counters (`twin_tick`, `twin_hindsight`, `twin_order`, `twin_plan`, kept 730 days) are display only, on `/stats` and `/statistika`; the strike day will show there as a dip in volume, which is the truth and can carry a note. KV holds caches that expire in minutes. The R2 frame archive is written and never read by the Worker, and expires in seven days. No script turns recordings into a file the product loads: the data files are built from ZET's static timetable and the line map, the dwell overrides are hand-edited, the tuned constants were typed in after reading replays, and the committed fixtures are all cut from 21 September. The browser keeps preferences and credentials only.

**The rule that follows:** the 28 September frames are pulled from R2 before they expire and kept as the first deviation fixture, labelled as such; they are never used as a replay, tuning or fixture day for normal behaviour, and never enter a learned normal. Two facts of this trace belong in section 6: the learned tables are the natural seed of the learned expectation, and they will need what they lack today, a date on every sample and a decay, before they can say what normal is; and the learner's blindness to absence is the gap of this note in its smallest form. The twin knows how long a tram stands at Trg bana Jelačića. It has no way to know that no tram came.
