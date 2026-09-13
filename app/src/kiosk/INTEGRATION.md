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

Today's `createCityMap` ignores the extra fields (the map centres on the city
at zoom 12); reading them is all that is needed. Two optional additions would
improve the paired screen:

- `CityMapHandle.setView?(view: KioskMapView)` -- the adapter calls it whenever
  the view changes (a new selection), only when the method exists.
- A `resize()` on reparent -- the kiosk keeps the map column the same size in
  every composition and parks the container in a hidden holder while a layer
  without a map is shown, then re-appends it; MapLibre needs a resize if the
  container's box changed in between.
- Camera padding for the lines board -- the board lies over the lower part of
  the map column (under half of its height, `[data-testid=kiosk-lines]`). A
  `padding: { bottom }` equal to that board's height, or a `center` that
  places the stop in the upper part of the visible area, keeps the screen's
  stop and its vehicles in view. The kiosk can pass the board height once the
  option exists; until then it centres on the stop and accepts the overlap.
- The kiosk never calls the factory twice for one screen. `setView` (or the
  creation options) is the only channel for camera state; the kiosk never
  reaches into MapLibre itself.

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
