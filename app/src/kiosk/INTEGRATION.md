# Kiosk hand-off: what the kiosk needs from the other workstreams

The kiosk (`app/src/kiosk.ts`, `app/src/kiosk/*`, `app/src/ui/kiosk.css`) is
complete on its own contracts. These are the additive hooks it already calls
or reads, so the map and UI workstreams can light them up without touching
kiosk files.

## Map workstream (`map/city-map.ts`, `map/map-slots.ts`)

The kiosk asks for one map through `createMapSlots(...).slot()` with the slot
id `kiosk-map` and never a second one. `kiosk/mapview.ts` wraps the page's
factory (`createKioskMapAdapter`) so every created map receives, on top of
`CityMapOptions`, the fields of `KioskMapView`:

- `center` / `zoom` -- the camera the screen's own configuration asks for, in
  this order: a place somebody chose (`placeSet` true) frames N stops around
  it on a wall, the square of side 2R on the field's shorter side
  (`map/frame.ts` `frameView`, R measured per place along the tram lines by
  `shared/city/frame.ts` `frameRadiusM`, Kadar 4 / 6 / 8); a phone's band, and
  a stop from a caller before place-v2, keep the centred street-level camera;
  the read-path default place (`placeSet` false) keeps `CITY_WINDOW`, the whole city fitted
  to the field with 24 px of clearance and floored at `FIELD_MIN_ZOOM` (12.7).
  The controller passes `district: null`; `ScreenMetadata.area` is derived
  metadata, not a selectable camera.
- `selectedStop` -- the screen's stop, or the stop the driver's phone selected.
  There is no default stop any more: a screen may have none for its whole life.
- `selectedRoute` and `follow` -- the route the phone selected; `follow` asks the
  camera to keep that route's vehicles in frame.
- `cityLabels` -- false on the city window, so the city's own places draw as
  dots and badges with no names; `'venues'` on the framed wall, where tonight's
  venues are named and the BAJS discs carry their counts without names; true
  on every paired presentation, whose one subject has to be named on the wall.
  Changed live through the handle's `setCityLabels`.
- `hitTolerancePx` -- 28 on the kiosk (`KIOSK_HIT_TOLERANCE_PX`), against the
  map's 8 px default: a finger on a wall is not a mouse on a desk, and on the
  city window the stop rings it aims at are three pixels across. The wall's
  read-only touch measures its rings against the same tolerance itself
  (`touchAt`, below), because the map stays `interactive: false`.
- The names, all on one line: `THIN_NAMES_ZOOM` (13.5). Below it the window
  reads differently in three ways, and above it nothing changes at all.
  `majorStreetNames` false drops the basemap's promoted `roads_labels_major`
  (its flat 22 px is derived for a field 2.8 km across, and the whole city is
  four times that ground). `placeTitles` false draws the square place marks --
  works, events, the seat, the civil protection's assembly points -- with no
  `text-field` at all; the marks stay, because in an urgent state the square is
  the information and the name is not, and the quake's own label and the Sava's
  are kept at every zoom. `stopLabelTramInterchanges` true names only the tram
  interchanges, from the `tramInterchange` flag `stopsToGeoJson` computes per
  NAME: a tram calls there and some trip starts or ends there (the artefact's
  own `terminal` bit), 29 names city-wide. `stopLabelMinRank` stays 4 and is
  simply not consulted below the line -- rank is route count, which named Elka
  and Savski gaj-rotor and left Trg bana Jelacica, Glavni kolodvor and Savski
  most off the picture; nor is a count of tram routes a filter, since 111 of
  the 114 tram-served names see two or more. The measured result on a
  1920 x 1080 wall is twelve stop names.

The invitation is the transit picture, so the old `transit` gate is gone from
it: the network, the stops and the vehicles are always on the window. Only a
paired presentation of something that is not transport still clears them. What
does vary with the camera is the buses: below `CITY_DETAIL_ZOOM` (14) the
handle is told `setModes(new Set([tram]))` and the network kinds follow, at 14
and above both modes draw. The framed wall is a neighbourhood and carries its
buses at every zoom [O-71]. Three hundred bus capsules over the whole city would
bury the trams the picture is about.

The integrated `createCityMap` (the same-origin vector map) reads these, plus
the other options the kiosk passes on creation: `stop` (the screen's stop,
marked and named), `interactive: false` (no pointer or keyboard handling, no
controls on a public screen), `symbolScale` 2 and `locale`. On the handle
the kiosk drives:

- `setView(view)` whenever the view changes (a new selection, a new centre);
- `resize()` right after the container is re-appended -- the kiosk parks the
  one container in a hidden holder while a layer without a map is shown;
- `setFeedState(state)` from the ZET snapshot's own status on every paint, and
  again right after every `resume()` (a reparent, the basics panel closing). A
  `down` feed holds every vehicle where it is, so nothing animates through an
  outage; a `stale` snapshot is the twin's last-good copy (R-TE5), whose
  vehicles carry their own history and confidence, so the motion keeps going
  and fades on its own. A map created during an outage is told before its
  first frame. On the wall a `down` feed also draws no vehicle at all:
  `paintMap` passes `vehiclesVisible: false` into `requestKioskMap`, which
  empties only the vehicle points, so the network, the stops, BAJS, closures
  and places stay on the picture.

The field (`field.ts`) is the front page's left column (`invitation.ts`):
the map takes the whole of it, with nothing drawn over it but, while ZET's
feed is down, one quiet note (`map-note`), so the camera needs none of the
old board-height offset (`boardCentre`) a lines-board-over-map arrangement
needed; `padding` on `setView` stays unused.
Lagano is the one place the lines board still lies in the map's cell, as
`kiosk-lines`'s own contract below says. The kiosk never calls the factory
twice for one screen and never reaches into MapLibre itself.

Contract testids across this hand-off (global constraints, contract 8; the
whole probe list is `docs/companion-2026-09-22.md` §15.6): `kiosk-live` names
the field's section; `kiosk-map-host` and `kiosk-map` name the map container
inside it, and `kiosk-map-host` carries `data-frame="4|6|8"` and, once the
style idles, `data-major-labels="<count>"`; `map-note` is the outage
note over the map, and `.k-map-legend` holds the three legend items of
`kiosk.legend.*`. The front page carries no panel: beside the field it has the
"U blizini" list (`nearby` > `nearby-head` + `nearby-rows` > `li.nearby-row`
with `data-id`, `data-kind`, `data-when` or `data-always`, `data-live` and
`data-source`, drawn by `kiosk/timeline.ts` from `city/nearby.ts`
`selectNearby`) over the pairing card (`kiosk-invite`, `kiosk-qr`,
`kiosk-code`). The list's fitter measures candidate rows in a hidden, inert
sibling of the same width inside `.k-nearby-host`, outside the `nearby`
section, and reconciles only the final selection into the live list, where
an entering row is inserted once at its time position. The footer is
`safety-strip` with `strip-verdict`, `strip-sources` (no clock time) and
`strip-pharmacy`; on the wall (`passive`, every size but handheld) the
verdict, the `/hitno` word and the map's attribution are plain text, and
only a handheld keeps `kiosk-essentials-open` and the `/hitno` link.
`kiosk-sentence` (with `kiosk-sentence-kicker` and `kiosk-sentence-text`)
names the header's one sentence and `kiosk-brand` the brand button. The touch
panel is `[data-testid=stop-board]` (a stop's board), mounted in
`.k-nearby-host` only while open, which then carries `data-touch`.
`kiosk-panel-<id>` names each panel of the paired compositions, which keep
weather, promet, tonight, `city` and `around` with their producers;
`kiosk-lines` names the lines panel's list (also the lagano board's,
unchanged). The evening's last departures are one row of the list.

The kiosk points are the same shapes as the dashboard's: dated vehicle points
(evidence for the motion model), undated places (the screen's stop, drawn
where given) and closure lines.

## ZET schema renderer

`?prikaz=shema|karta` overrides `kajima:map-mode:v1` (`schema|map`, default
`map`) for this boot only. The entry preserves a valid `prikaz` when clearing
the provisioning fragment and one-time `tema`. It does not overwrite the
device preference. Prozor has no chapter pin or rotation.
The invitation additionally reads `vidikovac-kiosk-view` from the Prikaz
toggle. Either an explicit schema boot or that local schema choice shows the
whole network on a wall, without a stop crop; handheld and presented
transport retain their existing renderer contract.

`KioskDeps.mapMode` reaches `requestKioskMap()` as `renderer`, and
`KioskMapExtras` carries it to the factory alongside the stop and the
noninteractive contract. The existing `kiosk-map` slot, Prozor field,
statements, pairing, pause/resume and feed handling stay unchanged.

The shared `createMapRenderer` factory returns a synchronous handle and
dynamically imports `createSchemaMap` only for a schema request. Pending
updates are buffered; destroying the handle before import prevents a late
mount. Lightweight mode creates neither renderer and loads no schema code.

The schema ignores geographic cameras, emphasis and outlines, and it names by
surface. On the wall's city overview (Prikaz: shema) it shows the whole
network without zoom and always names it: `requestKioskMap` hands it no stop
to crop round and passes the screen's own stop as `priorityStopId`, so the
collision pass places the screen's place first and then as many names as fit
at `WALL_LABEL_MIN_PX` (28 px), terminals first. A wall presentation that
carries a stop keeps the legible crop around that stop, still named at 28 px.
A handheld (`presentationProfile: 'handheld'`) keeps its own contract: a crop
around its stop named at `KIOSK_LABEL_MIN_PX` (24 px), and without a stop the
whole network without names. Prozor's statements do not overlay the field, so
no rail padding is needed and `setView` is a no-op. No district outline is fetched
for a schema field. The schema renderer itself does not load MapLibre.

## UI workstream (tokens, i18n)

- The kiosk owns its `--k-*` colour tokens in `kiosk.css` (approved mineral
  light / deep-neutral dark, peacock action). When the shared `--tone-*` set
  lands, alias `--k-canvas`, `--k-surface`, `--k-ink`, `--k-action` to it in
  one place at the top of `kiosk.css`; nothing else has to change.
- Kiosk copy lives in the one catalogue, `i18n/hr.json` / `en.json`, under
  `kiosk.*`, and is read through `kiosk/strings.ts`: a thin typed adapter
  that builds the `KioskStrings` tree once per locale and checks every key it
  names against the Croatian catalogue at compile time (hr/en parity is
  `test/app/i18n.test.ts`'s). Shared vocabulary is read where it lives, so
  the two surfaces agree: the app name (`common.appName`), the domain names
  (`layers.*`), the compass words and the canonical sentences; severity
  words, delay words, closure types and plurals, `panels.temperature` and
  `status.loading` go through `i18n.t` at the call site.
- The header of `kiosk/strings.ts` names who owns which key group (the
  wall's `kiosk.nearby.*`, `kiosk.sentence.*`, `kiosk.handheld.*`,
  `kiosk.legend.*`, `kiosk.setup.*` and `kiosk.settings.*`); a package adds
  keys only inside its own group, and a key nothing reads any more is
  deleted with its last reader. `test/app/i18n-orphans.test.ts` (over the
  shared scanner `test/app/i18n-scan.ts`) fails on any leaf nothing reads.

## Header

The header's middle cell (`.k-head-mid`) carries one sentence
(`kiosk-sentence[data-kicker][data-valid-until]`): a coloured kicker (Promet /
Kultura / Vrijeme / Bicikli / Noćas / Radovi) and at most 80 characters (64 on
the compact, portrait and handheld compositions), swapped at the screen's
rhythm (`kiosk/prefs.ts` `readRhythm()`, 20 s by default) with a short
crossfade, instant under reduced motion and in lagano. The pure
`city/sentence.ts` turns the list's own rows plus weather, closures and bikes
into facts (`sentenceFacts`), writes the template sentences from them
(`templateSentences`, the fallback that always exists) and sequences the pool
(`createSentenceSequence`: a sentence past its `validUntil` is skipped; a
sentence stays at least one rhythm unless its fact expires; the same fact in
the same approved wording (`isSameSentence`) is refreshed in place, without a
fade, and never swaps "za N min" for a clock time; `setRhythm` re-times the
same rotation; while at least `SENTENCE_MIN_FACTS` (3) facts are at hand one
fact is on screen at most once in ten minutes, in one wording, and below that
no sentence repeats verbatim within ten minutes). `fetchSentences` (`api.ts`) asks
`POST /api/kiosk/sentences` for model sentences when the facts change and at
the latest every `SENTENCE_REFRESH_MS`, never in lagano. The Worker offers
Workers AI only validated template choices (`{ factId, family, slots }`,
`shared/kiosk/sentence.ts` `sentenceTemplateChoices`); the model may only
select among them, the chosen ones are filled from the approved templates and
checked with `acceptSentence`, kept in KV for 20 minutes, and under
`APP_ENV=test` the answer is an empty list. The client stages the answer
(`stagedModelSentences`) and decodes it against the facts of the paint that
adopts it: at once when no model sentence is on screen, otherwise at the end
of that sentence's rhythm, or as soon as the model sentence on screen no
longer holds. Third-party text in
a fact or a row passes `shared/kiosk/external-text.ts` first (the header on the
strict rule, the list's rows on the row rule); a value that fails is skipped,
never repaired. A sentence that would overflow the cell
is measured on a permanently laid-out, visually hidden probe and skipped,
never cut. The session pill and the pairing notice still take that cell when
they are present, and the notice's `role="status"` is cleared when it
expires, so the sentence is never silenced for the screen's life; a
presentation suspends it. The map highlights what the current sentence names
(`setHighlight`), never moving the camera.

The brand at the header's left end ("Kaj ima?") is a button,
`[data-testid=kiosk-brand]` named "Kaj ima? · Postavke zaslona", and the one
way into **Postavke**: a press held on it for `LONG_PRESS_MS` (800 ms,
`kiosk/constants.ts`) opens the panel, a shorter press or a finger that moves
more than 12 px opens nothing, and Enter or Space on the focused brand opens it
at once (`bindLongPress` in `kiosk/settings.ts`, timed through the kiosk's own
timer seam so a test's `tick()` drives it; the press is never stopped, so the
first-tap fullscreen and wake-lock listener still hears it). The header
carries no gear and no theme glyph. Postavke is the only setup surface after
the start screen; there is no wizard and no provisioning aside, on a wall or
on a phone. Its rows are click-toggles that name their current state: Mjesto
(`toggle-place` opens the shared `kiosk/place-field.ts` field,
`settings-place-city` sets the whole city), Kadar
(`toggle-frame[data-value=4|6|8]`), Prikaz
(`toggle-view[data-value=map|schema]`), Tema (`toggle-theme`), Ritam
(`toggle-rhythm[data-value=20|30|60]`) and Zaslon (expiry and "Zaboravi
zaslon"). Prikaz and Ritam belong to this browser (`kiosk/prefs.ts`,
`vidikovac-kiosk-view`, `vidikovac-kiosk-rhythm`) and Tema to the theme
controller; none of the three reaches the server. The shell paints the screen
the DO last applied as `.kiosk[data-frame]` and `[data-place-kind]`
(`tram`, `bus` or `address`; `city` without a chosen place) and this
browser's choices as `[data-rhythm]` and `[data-view]`.

## Read-only touch (wall)

Touch on the wall never makes the map interactive. `kiosk/mapview.ts`
`touchAt` projects the drawn stop rings (`drawnStops`, the same filter as the
overlays) and the pharmacy's ring with `fieldPixel` from the camera the map
reports, and returns the nearest within `KIOSK_HIT_TOLERANCE_PX`; a delegated
`click` on the kiosk root reaches it, and nothing moves the camera. A stop
opens `kiosk/timeline.ts` `mountTouchPanel` with `stopBoardVariants`: the
next `STOP_BOARD_ROWS` (3) departures in the phone's `departureRow` (loaded
as its own chunk on the first touch, `loadStopBoardRows`), then one "Vozni
red" line of `TIMETABLE_LINE_TRIPS` (4) later trips; a row of the list opens
`rowDetailVariants`, the pharmacy `pharmacyDetailVariants` (the vetted
caption, the name and the curated phone). The panel shows the first variant
its box holds whole and closes after `TOUCH_MS` (60 s, by its timer and by
the deadline checked on every tick and poll), when an outage starts under an
open board, on a phase change, on a presentation and on destroy; a second
touch replaces it. Touch does nothing on a handheld, in a paired composition
or presentation, in Postavke, in Osnovno and on the schema.

## Backend (already in place)

`POST /api/screens` (`core/screens.ts`) takes one of three bodies. An empty
body is the field left empty and stays byte-identical to the one-button
start: `area` `zagreb`, no stop, no place stored. `{ place, frame? }` is a
picked place (place-v2): `{ kind: 'stop', stopId, address? }` or
`{ kind: 'address', name, lon, lat, address? }` inside Zagreb; the Worker
takes a stop's name and point from its own table and answers 400 with
`field: 'place'` or `field: 'frame'` otherwise. The legacy `{ area?, stopId? }`
body is still accepted. `/data/stops.json` and `/data/streets-geo.json` feed
the field (loaded on its first focus or keystroke); `onContext` on the beacon
socket, `ScreenMetadata` on `joined`, 10-minute screens and 5-minute one-hop
grants are unchanged.

`ScreenMetadata` carries `place` (`ScreenPlace`, `shared/city/place.ts`),
`placeSet` and `frame` (`FrameStops`, 4 | 6 | 8, `shared/city/frame.ts`),
always present on the create response, the scan grant and the room `joined`
frame. Records made before place-v2 are enriched on read (`screenMetadata()`
and `worker/pairing/place.ts`), never migrated: a stored stop is the chosen
place (`placeSet: true`); no place and no stop reads as Trg bana J. Jelačića
with `placeSet: false`, so the list and the departures always have a place
while the map keeps the whole-city window; a missing frame reads as 6. The
kiosk reads the same answer through `wallPlaceOf()` (`kiosk/settings.ts`),
which also covers a credential copy stored before the deploy, and frames the
invitation with `wallSpanM()`: the whole measured circle
(`frameSpanM(frameRadiusM(place, stops, frame))`) around a chosen place,
`FIELD_SPAN_M` otherwise, `HANDHELD_SPAN_M` on a phone. `ScreenMetadata.area`
is now derived from the place (`districtOf`, else `zagreb`) and kept for
stats, `ScanOk.area` and the index; the camera no longer reads it.

The panel changes Mjesto and Kadar over the same socket:
`{ t: 'screen-set', version: 2, place, frame }` (`worker/protocol.ts`;
`place: null` for the whole city), sent by `beacon.setScreen(input)` from the
panel's `SendQueue`: 800 ms after the last click (`SETTINGS_SEND_DELAY_MS`),
one frame in flight, the next only `SCREEN_SET_MIN_MS` (5 s, defined in
`worker/protocol.ts` and re-exported from `worker/do/beacon-do.ts`) after the
DO's last answer, and never a state equal to the DO's current screen. The
kiosk announces the capability `place-v2` beside `city-v1`. The DO validates
both fields, writes its meta and answers through the existing `codes` frame
carrying `screen`, sent to every authenticated socket of the beacon, so
`applyScreen()` re-frames the wall exactly as a DO-side change does; the panel
stays open. A refusal is one `{ t: 'error', error: ... }` frame and nothing
else: `'bad-place'` or `'bad-frame'` (version 2 only), or `'screen-set-rate'`
inside the beacon-wide window. It reaches the panel through the beacon
client's `onError`; the panel states it and repaints the toggles from the
DO's truth, no answer within eight seconds does the same, and nothing is
re-sent by the clock. `'bad-frame'` is also the DO's word for any unreadable
socket message, so the panel counts it as a refusal only while one of its own
frames is in flight. Version 1, `{ t: 'screen-set', version: 1, stopId, area }`
(refused with `'bad-area'` or `'bad-stop'`), stays accepted indefinitely for
kiosk bundles opened before the deploy; it keeps the stored frame and derives
the place from the stop.

The kiosk never recreates a screen on its own: an expired or revoked screen
shows a notice with one button that forgets the credentials and returns to the
start screen.
