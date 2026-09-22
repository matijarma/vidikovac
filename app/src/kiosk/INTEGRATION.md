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
  this order: a configured stop keeps its centred street-level camera; a
  configured gradska cetvrt sits on its seat until its outline lands and is
  then fitted to the outline; a screen with neither -- which is every screen
  the one-button start makes -- opens on `CITY_WINDOW`, the whole city fitted
  to the field with 24 px of clearance and floored at `FIELD_MIN_ZOOM` (12.7).
  The district reaches the client as `ScreenMetadata.area`; `'zagreb'` is the
  whole city and names no district.
- `selectedStop` -- the screen's stop, or the stop the driver's phone selected.
  There is no default stop any more: a screen may have none for its whole life.
- `selectedRoute` and `follow` -- the route the phone selected; `follow` asks the
  camera to keep that route's vehicles in frame.
- `cityLabels` -- false on the city window, so the city's own places draw as
  dots and badges with no names; true the moment somebody explores and on every
  paired presentation, whose one subject has to be named on the wall. Changed
  live through the handle's `setCityLabels`.
- `hitTolerancePx` -- 28 on the kiosk (`KIOSK_HIT_TOLERANCE_PX`), against the
  map's 8 px default: a finger on a wall is not a mouse on a desk, and on the
  city window the stop rings it aims at are three pixels across.
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
and above both modes draw. Three hundred bus capsules over the whole city would
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
inside it, and `kiosk-map-host` carries `data-major-labels="<count>"` once the
style idles; `map-note` is the outage note over the map. The front page carries
no panel: beside the field it has the "U blizini" list (`nearby` >
`nearby-head` + `nearby-rows` > `li.nearby-row`, drawn by `kiosk/timeline.ts`
from `city/nearby.ts` `selectNearby`) over the pairing card (`kiosk-invite`,
`kiosk-qr`). `kiosk-panel-<id>` names each panel of the paired compositions,
which keep weather, promet, tonight, `city` and `around` with their producers.
`kiosk-sentence` (with `kiosk-sentence-kicker` and `kiosk-sentence-text`) names
the header's one sentence; `kiosk-lines` the lines panel's list (also the
lagano board's, unchanged); `kiosk-lastrun` the paired promet panel's
last-departures line from 20:00, while that panel is a configured stop's board.
On the front page the evening's last departures are one row of the list.

The kiosk points are the same shapes as the dashboard's: dated vehicle points
(evidence for the motion model), undated places (the screen's stop, drawn
where given) and closure lines.

## ZET schema renderer

`?prikaz=shema|karta` overrides `kajima:map-mode:v1` (`schema|map`, default
`map`) for this boot only. The entry preserves a valid `prikaz` when clearing
the provisioning fragment and one-time `tema`. It does not overwrite the
device preference. Prozor has no chapter pin or rotation.

`KioskDeps.mapMode` reaches `requestKioskMap()` as `renderer`, and
`KioskMapExtras` carries it to the factory alongside the stop and the
noninteractive contract. The existing `kiosk-map` slot, Prozor field,
statements, pairing, pause/resume and feed handling stay unchanged.

The shared `createMapRenderer` factory returns a synchronous handle and
dynamically imports `createSchemaMap` only for a schema request. Pending
updates are buffered; destroying the handle before import prevents a late
mount. Lightweight mode creates neither renderer and loads no schema code.

The schema ignores geographic cameras, emphasis and outlines. It keeps the
legible crop around the screen's stop; without a stop it fits the network
without labels. Prozor's statements do not overlay the field, so no rail
padding is needed and `setView` is a no-op. No district outline is fetched
for a schema field. The schema renderer itself does not load MapLibre.

## UI workstream (tokens, i18n)

- The kiosk owns its `--k-*` colour tokens in `kiosk.css` (approved mineral
  light / deep-neutral dark, peacock action). When the shared `--tone-*` set
  lands, alias `--k-canvas`, `--k-surface`, `--k-ink`, `--k-action` to it in
  one place at the top of `kiosk.css`; nothing else has to change.
- Kiosk copy lives in `kiosk/strings-hr.ts` / `strings-en.ts` typed by
  `KioskStrings`. Shared vocabulary (severity words, delay words, closure
  types and plurals, `panels.temperature`, `status.loading`) is read through
  `i18n.t` so the two surfaces agree. `common.appName` becoming "Kaj ima?"
  needs no kiosk change (`strings.appName` already says it).
- The old `kiosk.*` keys in `i18n/hr.json` / `en.json` (panorama, meander,
  catalogue legends) are no longer read by any kiosk file and can be retired.

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
(`createSentenceSequence`: a sentence past its `validUntil` is skipped, none
repeats verbatim within ten minutes). `fetchSentences` (`api.ts`) asks
`POST /api/kiosk/sentences` for model sentences when the facts change and at
the latest every `SENTENCE_REFRESH_MS`, never in lagano; the Worker writes them
with Workers AI, checks each against the facts with `shared/kiosk/sentence.ts`
`acceptSentence`, keeps them in KV for 20 minutes and answers an empty list
under `APP_ENV=test`, and the client checks them again against the current
facts before they join the templates. A sentence that would overflow the cell
is measured on a permanently laid-out, visually hidden probe and skipped,
never cut. The session pill and the pairing notice still take that cell when
they are present, and the notice's `role="status"` is cleared when it
expires, so the sentence is never silenced for the screen's life; a
presentation suspends it. The map highlights what the current sentence names
(`setHighlight`), never moving the camera.

The header's right end carries the gear that opens **Postavke** (area, stop,
theme, screen expiry and "Zaboravi zaslon"). It is the only setup surface on
the screen; there is no wizard and no provisioning aside, on a wall or on a
phone.

## Backend (already in place)

`POST /api/screens` (`core/screens.ts`) with an empty body -- `area` defaults to
`zagreb` and `stopId` to null, so the one-button start needs no input at all;
`/data/stops.json`, `onContext` on the beacon socket, `ScreenMetadata` on
`joined`, 10-minute screens and 5-minute one-hop grants. `ScreenMetadata.area`
carries what the screen is set to (`'zagreb'` for the whole city, else a
gradska cetvrt's slug) and is what the camera reads as its district.

The settings panel saves over the same socket: `{ t: 'screen-set', version: 1,
stopId, area }` (`worker/protocol.ts`). The DO validates both, writes its meta
and answers through the existing `codes` frame carrying `screen`, so
`applyScreen()` re-frames the wall exactly as a DO-side stop change does. A
refused frame comes back as `{ t: 'error', error: ... }` (`'screen-set-rate'`
for more than one save in the DO's window) and reaches the panel through the
beacon client's `onError`; the panel stays open and says so. The panel waits
for the DO's answer before closing, and gives the button back after eight
seconds; an answer that arrives later still re-frames the screen.

The kiosk never recreates a screen on its own: an expired or revoked screen
shows a notice with one button that forgets the credentials and returns to the
start screen.
