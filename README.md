# Kaj ima?

**Less screen. More city.**

Zagreb publishes the movements of its trams, the streets being repaired, the weather, cultural events and the decisions shaping the city. Kaj ima? brings those separate sources into one place: a public window onto Zagreb that you can take with you on your phone.

Find your tram. Discover an exhibition. Check what is happening around you. Then get back to the city.

[Try the prototype](https://zagreb.aningfilm.hr) · [Run locally](#run-locally) · [Under the hood](#under-the-hood) · [Project proposal](docs/prijava/prijedlog-projekta.md)

![The public city screen at Trg bana J. Jelačića: the place and one written sentence in the header, a map framed around the place with every tram and bike station, the Nearby list (U blizini) with the next departure, tonight's last trams and tomorrow's first tram, the scanning card and the safety footer.](docs/readme/wall-en-light-1280.webp)

*Actual application, English interface, September 23, 2026. Source data is real; pairing credentials are masked. This is an example capture, not current information.*

## A reason to look up

City information should help people inhabit their city, not keep them inside an app.

A screen in a café, library or neighbourhood office can be useful to anyone walking past, including someone without a phone. Scanning its rotating code gives you **ten minutes** of the city on your own device. You can give someone nearby **five minutes** through a code on your phone, once, without shortening your own session. They cannot pass it on again.

No account, installation, advertising or personal tracking. No push notifications calling you back. Access starts with a screen or another person. The code is an invitation, not proof of physical location.

When time runs out, updates stop—and the content clears, leaving the invitation to scan again. Keeping what you found, without fuss, is planned as a later layer. Safety information at [`/hitno`](https://zagreb.aningfilm.hr/hitno) stays open without a code, time limit or JavaScript.

## One city, three experiences

- **On the wall:** the screen's place and one written sentence in the header, a map framed around the place with every tram and bike station, and **U blizini**, one time-ordered list: the next departures, then what happens nearby, such as a closure ending, an event or the last trams tonight. The scanning invitation has its own card; safety and the on-duty pharmacy stay in the footer.
- **In your hand:** the place as the title, one sentence, the next three departures and the same **U blizini** rows, under three tabs: **Sada · Karta · Još**. Karta is the map of that list, with vehicles at once and one search field; the week's events are one row in Još. Saved stops and places stay on your device.
- **At your desk:** the phone, wider: Sada and the Karta map side by side, with room to explore the map and its details.

These share data and a visual language, not an identical layout stretched to three sizes.

**Access is not control.** Scanning never interrupts the public overview or someone else's presentation. Showing a selected item on the wall is a separate action through **Screen**. Taking over another person's presentation requires confirmation; delivery is acknowledged by the screen after rendering. A five-minute shared session cannot control the wall.

## What is in the city window?

Nine feed modules, a reference catalogue and live city services bring together:

| Explore | What you can find | Sources |
|---|---|---|
| Transport | Moving trams and buses, routes, stops, departures, closures, rail timetables | ZET, City, HŽPP |
| Places | BAJS bikes, drinking water, toilets, markets, Wi-Fi, sports grounds, cycling | BAJS / nextbike, City |
| Conditions | Weather, forecasts, warnings, air quality, Sava bulletin, sunrise/sunset | DHMZ, national air-quality service |
| Culture | Events, exhibitions, venues, street histories, protected heritage | Kulturpunkt, Ethnographic Museum, City, Ministry of Culture |
| Civic life | Assembly meetings, works, gazette acts and originals, consultations | City, eSavjetovanja |
| Safety | Warnings, earthquakes, assembly points, emergency contacts, pharmacies | DHMZ, EMSC, city and maintained references |

These are different kinds of knowledge. ZET countdowns are **derived estimates** for tracked vehicles, using timetable and delay information with next-stop refinement from the motion model. Other departures retain clock times; HŽ Passenger Transport boards are schedule-only. A mapped garage does not imply available spaces. Heritage boundaries are not entrances. An undated notice is not a calendar event.

<details>
<summary>See the desktop and the phone</summary>

![Desktop session at Trg bana J. Jelačića: Sada with the sentence, three departures and the Nearby rows beside the Karta map with trams, bike stations, the search field and the same list.](docs/readme/desktop-en-light-1280.webp)

<img src="docs/readme/phone-en-light-390.webp" width="260" alt="Phone Sada at Trg bana J. Jelačića: the place as title, one sentence about tram 11, a map band, three departures with blue countdowns and a grey clock time, the Nearby rows, and the Now, Map and More tabs.">

*September 23, 2026 captures from real local sessions. Interface controls are in English; original place names and event titles retain their source language.*

</details>

## Try it

1. Open the [city screen](https://zagreb.aningfilm.hr/kiosk/) on a computer or display. Type an address or a stop into its one field, **Adresa ili stajalište** (Address or stop), or leave it empty for Trg bana Jelačića, and press **Pokreni** (Start). Place, frame, view, theme and rhythm change later with a long press on “Kaj ima?”.
2. Keep it open. Scan the current QR code with your phone, or type the displayed code at [code entry](https://zagreb.aningfilm.hr/s/). The same Wi-Fi network works.
3. Explore privately. Use **Screen** only when you want to show something publicly.
4. Press **Share the city** in the header to give a second person their own five-minute session.

One device is enough: keep the screen in one tab and redeem its code in another. Opening a screen does not grant a personal session. This is the real data and pairing system, not a separate demo.

## Under the hood

### Movement reconstructed, not dots connected

The server-side transit engine combines each vehicle's sparse, delayed observations with the timetable, a directed rail graph and the stops its trip actually serves. It learns travel and dwell times and publishes motion plans; the browser draws along those plans instead of independently guessing where every tram went.

Trams share track and ordering constraints; buses follow their own route geometry. The bias is conservative: prefer lagging behind to racing ahead and correcting backwards. Recorded ZET frames make real days replayable; hindsight metrics compare plans with later evidence. A tram keeps to its own trip's path and returns to it once it is moving within 60 m of it again; a tram off its route's rails is drawn at its reported positions, never on another line's track. A tram that falls silent holds at its next stop after 30 seconds, fades, and is gone after 180. The grader (`npm run replay:grade`) replays recorded days and counts path changes within a trip, foreign-path adoptions, direction flips and client jumps per 100 tram vehicle-hours; on the two recorded September days, path changes fell from 165.6 and 136.5 to 17.97 and 3.20, most of what remains a Sunday diversion of line 11.

### Data that keeps its meaning

Each source carries attribution, availability and timestamps. Observation, publication, event and retrieval times are distinct. A failed source can retain its last good data within a bounded age; another source's successful refresh must not make those old records look fresh.

Missing is not zero. An unavailable warning feed is not an all-clear.

The city catalogue publishes versioned chunks before its manifest and ships a bundled starting copy. The one written sentence on the wall and the phone comes from approved templates filled with facts already on screen; optional Workers AI may only choose among those checked offers, and without it the template is shown. It writes no free text, generates no vehicle movement and fills no missing observations.

### Shared infrastructure, private exploration

A TypeScript client built with Vite talks to one Cloudflare Worker. Six SQLite-backed Durable Object classes handle the state that must outlive a request:

```text
Screen · phone · desktop
           │
Worker + static application
├─ Pairing and presentation
│  BeaconDO · RoomDO · IndexDO
├─ Transit model: TwinDO
├─ City ingestion: CatalogueDO
├─ Counters: MetricsDO
├─ Feeds: Cache API + KV
└─ R2
   Maps, catalogue, recordings
```

Signed data tokens avoid waking session objects for ordinary feed polling. Search text and private coordinates are not broadcast to the wall; saved choices stay in the browser. Temporary-screen evaluation metrics are separated from venue-pilot usage.

### Designed to remain accessible

The application includes Croatian and English interfaces, keyboard access, visible focus, reduced motion and light/dark themes. MapLibre renders a regional Protomaps/PMTiles basemap, with tiles, glyphs and sprites served from the application's own origin.

`?lagano=1` selects a lightweight experience without map libraries, downloaded fonts or canvas animation. Safety is server-rendered and printable. Automated checks do not replace physical-display, distance-scanning and Safari/VoiceOver checks, which remain necessary before a venue pilot.

## Run locally

Use **Node.js 22 or newer** and npm, from the repository root:

```sh
npm ci
cp .dev.vars.example .dev.vars
```

Set local-only `SESSION_SECRET` and `E2E_ADMIN_BYPASS` values in `.dev.vars`, replacing the example placeholders; the bypass must be at least 32 characters. Keep `APP_ENV=test`. Never copy these development values into production.

```sh
npm run dev -- --local --port 8787
```

Wrangler runs the configured application build before serving on `http://localhost:8787`. `--local` keeps bindings local, including disabling the remote AI binding; live upstream data still requires internet access. Rebuild with `npm run build` after frontend changes if needed.

Reference and transit artifacts are already checked in. The regional basemap archive is separate: follow the [map asset instructions](app/public/maps/README.md), then load the resulting file into local R2:

```sh
npx wrangler r2 object put vidikovac-maps/zagreb-v1.pmtiles \
  --file ./zagreb-v1.pmtiles --local
```

Without the archive, map tiles are unavailable; the lightweight and alternative list views remain useful.

<details>
<summary>Refreshing data artifacts</summary>

These are maintenance steps, not first-run prerequisites. They can change tracked files.

```sh
npm run gtfs:routes
npm run build:network
npm run build:trips
node scripts/gtfs-stops.mjs
npm run build:schema
npm run build:city
```

Keep the network, trip index and schematic on the same GTFS feed version; tests guard compatibility. City catalogue generation reuses cached downloads; `npm run build:city -- --fresh` fetches them again. The ordinary application build does not refresh upstream datasets.

Manual dwell settings live in [`stop-dwell-overrides.json`](app/public/data/stop-dwell-overrides.json), read directly by the engine without a data-generation step. See [verification and maintenance notes](docs/kaj-verification.md) for their format and network exceptions.

</details>

## Verification and deployment

```sh
npm run typecheck
npm run typecheck:tests        # Tests, e2e/ and scripts/ type-checked as four programs
npm run build
npm test                       # Unit tests and local Worker integration tests
npx playwright install chromium
npm run e2e                    # Browser flows, including real pairing and expiry
npm run e2e:a11y               # Accessibility checks
npm run a11y:lighthouse        # Requires a running local server
npm run review:visual          # Screenshot matrix of every surface, with overflow and axe checks
npm run check:izvori           # Source coverage and external-link checks
npm run accept                 # Acceptance tier: red until the package it measures lands
npm run accept:e2e             # Acceptance tier in the browser: wall and phone scenes
npm run replay:grade -- test/fixtures/frames/2026-09-21-1715-1744 --out <prefix> --targets stage1
npm run frames:sample -- <recordings>/2026/09/21 --from 151500 --to 154459 --out <dir>
E2E_KIOSK_URL=<screen setup URL> npm run observe:production -- --minutes 10
```

Run build and browser work sequentially: browser tests manage local servers sharing the built app. Coverage includes single-use codes, presentation acknowledgement and takeover, expiry that clears the session, source recovery and lightweight mode. See the [verification record](docs/kaj-verification.md).

The acceptance tier, the tram-path grader (`replay:grade`, exit code 1 while a row misses its target) and the frame sampler (`frames:sample`, never into `recordings/`) are described with their thresholds and measured values in [docs/kaj-verification.md](docs/kaj-verification.md), section "Prihvaćanje, companion 2026-09". The production observer only reads: it needs an existing screen's setup URL in the environment and never creates a screen, presents or opens settings.

Deployment uses **`git push` to `main` → Cloudflare Workers Builds**, not `wrangler deploy`. A production `SESSION_SECRET` is required. Unset `APP_ENV` means production; `E2E_ADMIN_BYPASS` works only with `APP_ENV=test`. The retired `NETWORK_CHECK` cannot enable test mode. Operator routes `/api/admin/*` and `/stats` require Cloudflare Access; unauthorised requests receive 404. Workers.dev and preview URLs are disabled.

The repository, Worker and existing storage names retain the original technical name **`vidikovac`**. The product is **Kaj ima?**

## Where this could go

The public prototype opened on September 14, 2026; the funding application has been submitted to the City of Zagreb. A venue pilot and continued development depend on City funding and partnership.

The broader proposal would reuse screens venues already own, bring local publishers' announcements into public view, and eventually support face-to-face civic connections. These are future ambitions, not shipped publisher tools or a social network. The starting point is already here: public data made useful in public space.

## Explore the project

`app/` holds the interfaces, `worker/` the services, and `shared/` their common city and motion logic. `test/` and `e2e/` hold checks; `scripts/` contains builders, replay and review tools. `video/` holds the Remotion title and end cards of the demo video, cut to its [shot list](docs/video/shot-list.md).

- [Product](PRODUCT.md) and [design](DESIGN.md): governing decisions.
- [Architecture](docs/arhitektura.md), [public screens](docs/kiosk.md), and [sources and licences](docs/izvori.md): technical and operational detail.
- [Companion brief](docs/companion-2026-09-22.md): the research, interviews and plan of the September 22 round.
- [Development history](docs/history/README.md): executed plans and dated implementation records, from the [city-data upgrade](docs/history/upgrade-city-2026-09-18.md) and the [readable-city refinement](docs/history/readable-city-2026-09-20.md) to the companion round's execution files.
- [Submitted proposal](docs/prijava/prijedlog-projekta.md): the public-service vision and funded deliverables. It is a submission record, not a current UI specification; its hosted page, [/prijava/](https://zagreb.aningfilm.hr/prijava/), can show dated [development notes since submission](docs/prijava/razvojne-biljeske.md) as an optional layer.

Several supporting documents are in Croatian. Dated implementation records describe their own revisions. The [September 17 redesign](docs/history/redesign-2026-09-17.md) establishes the replacement of the historical [previous design system](newdesignsystem.md); earlier material under `docs/superpowers/` is history, not current visual guidance.

## Licence and authorship

Built by **Matija Radeljak / Aning Film d.o.o., Zagreb**.

Code: **AGPL-3.0-or-later**; see [LICENSE](LICENSE). The same code is also offered to the City of Zagreb under EUPL-1.2.

Selected derivatives are available through [`/open/`](https://zagreb.aningfilm.hr/open/). Eligible datasets use Croatia's Open Licence; EMSC retains its own terms. The city catalogue and session-tier feeds are not new `/open` exports. Upstream data is not blanket-relicensed. Basemap data credits OpenStreetMap contributors; see the [source register](docs/izvori.md) and [map attribution](app/public/maps/README.md).

ZET attribution: “Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669”.

Copyright (C) 2026 Aning Film d.o.o. / Matija Radeljak.
