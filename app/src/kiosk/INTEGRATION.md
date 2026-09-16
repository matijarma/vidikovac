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

- `center: [lon, lat]` -- the screen's stop; the map should open and idle here
  instead of the city centre.
- `zoom` -- 15 (street level around one stop).
- `selectedStop` -- the screen's stop, or the stop the driver's phone selected.
- `selectedRoute` and `follow` -- the route the phone selected; `follow` asks the
  camera to keep that route's vehicles in frame.

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
  first frame.

The field (`field.ts`) is one panel of the front page (`invitation.ts`,
`front.ts`): the map sits in the bottom row's middle cell beside the lines
panel and the surroundings, with nothing drawn over it, so the camera needs
none of the old board-height offset (`boardCentre`) a lines-board-over-map
arrangement needed; `padding` on `setView` stays unused. Lagano is the one
place the lines board still lies in the map's cell, as `kiosk-lines`'s own
contract below says. The kiosk never calls the factory twice for one screen
and never reaches into MapLibre itself.

Contract testids across this hand-off (global constraints, contract 8):
`kiosk-live` names the field's section; `kiosk-map-host` and `kiosk-map` name
the map container inside it, and `kiosk-map-host` carries
`data-major-labels="<count>"` once the style idles. `kiosk-panel-<id>`
names each of the five panels (tonight, weather, city, promet, around),
`kiosk-lines` the lines panel's list (also the lagano board's, unchanged),
`kiosk-lastrun` the panel's last-departures line from 20:00.

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
for a schema field. The schema renderer itself does not load MapLibre. This
does not change the dashboard's separate geographic Kvart thumbnail.

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

## Backend (already in place)

`POST /api/screens` (`core/screens.ts`), `/data/stops.json`, `onContext` on the
beacon socket, `ScreenMetadata` on `joined`, 10-minute screens and 5-minute
one-hop grants. The kiosk never recreates a screen on its own: an expired or
revoked screen shows a notice with one button that forgets the credentials and
opens the setup wizard.
