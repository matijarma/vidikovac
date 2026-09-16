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
controls on a public screen), `symbolScale` 1.5 and `locale`. On the handle
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

The lines board lies over the lower part of the map column (under half of its
height). The map API has no camera padding, so the kiosk moves the camera
centre south by half the board's height (`boardCentre`), which puts the stop in
the middle of the uncovered part. A `padding` option on `setView` would let the
kiosk keep the true centre instead; nothing else is pending on the map side.
The kiosk never calls the factory twice for one screen and never reaches into
MapLibre itself.

The kiosk points are the same shapes as the dashboard's: dated vehicle points
(evidence for the motion model), undated places (the screen's stop, drawn
where given) and closure lines.

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
