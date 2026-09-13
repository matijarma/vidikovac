// The kiosk's one map. Every composition that shows a map asks map-slots for
// the same slot id, so the invitation, the paired overview and the paired
// transit view share one live MapLibre context and one motion-model history
// for the screen's whole life (R-54: no poll and no phase change re-creates
// a map). Vehicle reports go in as dated points -- evidence for the model,
// never a drawn position (R-P2); closures as lines; the screen's own stop as
// an undated place, which the map draws where given.
//
// The request carries the map workstream's additive options: the stop as
// centre at street zoom (shifted so the lines board over the map's foot does
// not cover it), the screen's stop to mark, the phone's selected route or
// stop, route follow, no pointer handling and larger symbols for a screen
// read across a room. The handle's additive methods are driven from here
// too: `setView` when the view changes, `resize` after the container is
// re-parented, and `setFeedState` from the ZET snapshot's own status on every
// paint, so a stale or down feed holds every vehicle where it is and neither
// a reparent nor `resume()` can animate through an outage.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import type { PublicSelection, ScreenStop } from '../core/contracts';
import { routeName } from '../data/routes';
import type { CityMapHandle, CityMapOptions, MapFactory, MapLine, MapPoint } from '../map/city-map';
import type { MapSlotOptions, MapSlots } from '../map/map-slots';
import { vehicleFixes } from '../motion/fixes';

export const KIOSK_MAP_SLOT_ID = 'kiosk-map';
/** Street level around one stop: named streets, the stop, the vehicles near it. */
export const KIOSK_MAP_ZOOM = 15;
/** Symbols on a screen read from steps away: larger than on a phone or a desk. */
export const KIOSK_SYMBOL_SCALE = 1.5;

export type FeedState = 'live' | 'stale' | 'down';

/** The feed's own state; no snapshot yet is no evidence of motion either. */
export function feedStateOf(zet: ModuleSnapshot | undefined): FeedState {
  return zet?.status ?? 'down';
}

export interface KioskMapRequest extends MapSlotOptions {
  /** [lon, lat] of the screen's stop; the map's initial and idle centre. */
  center?: [number, number];
  zoom?: number;
  /** The public selection the driver's phone relayed, when it names a route or a stop. */
  selectedRoute?: string;
  selectedStop?: string;
  /** Keep the camera on the selected route's vehicles (map workstream option). */
  follow?: boolean;
  /** The screen's own stop, marked and named by the map. */
  stop?: ScreenStop | null;
  /** A public screen: no pointer or keyboard handling and no controls. */
  interactive?: boolean;
  symbolScale?: number;
  locale?: string;
}

export type KioskMapView = Pick<KioskMapRequest, 'center' | 'zoom' | 'selectedRoute' | 'selectedStop' | 'follow'>;
/** Creation-time options of a public screen, merged by the adapter itself so
 *  they reach the factory whatever the slot layer passes through. */
export type KioskMapExtras = Pick<KioskMapRequest, 'stop' | 'interactive' | 'symbolScale' | 'locale'>;

/** The handle's additive methods the kiosk drives; each optional on the type
 *  so a page's stub factory still satisfies it, every one implemented by the
 *  map workstream's createCityMap. */
export interface KioskMapHandle extends CityMapHandle {
  setView?(view: KioskMapView): void;
  resize?(): void;
  setFeedState?(state: FeedState): void;
}

export interface KioskMapAdapter {
  /** The factory to hand map-slots: a map it creates receives the current view additively. */
  factory: MapFactory | undefined;
  /** The one live handle: pause/resume when the container is parked, setView when supported. */
  handle(): KioskMapHandle | null;
  /** Remembers the view for the next creation and pushes it to a handle that understands it. */
  setView(view: KioskMapView): void;
  /** Forwards the feed's state every time (idempotent on the map); a map created later starts in it. */
  setFeedState(state: FeedState): void;
  feedState(): FeedState;
  /** Remembers the public-screen options for the next creation. */
  setExtras(extras: KioskMapExtras): void;
}

/** Wraps the page's factory so the kiosk's centre, zoom and selection ride on
 *  the options (extra fields today's createCityMap ignores) and keeps the one
 *  handle map-slots otherwise hides. `undefined` in stays `undefined` out. */
export function createKioskMapAdapter(factory: MapFactory | undefined): KioskMapAdapter {
  let view: KioskMapView = { zoom: KIOSK_MAP_ZOOM };
  let pushed = '';
  let feed: FeedState = 'down';
  let extras: KioskMapExtras = { interactive: false, symbolScale: KIOSK_SYMBOL_SCALE };
  let current: KioskMapHandle | null = null;
  const wrapped: MapFactory | undefined = factory && ((options) => {
    const merged: CityMapOptions = { ...options, ...extras, ...view };
    current = factory(merged) as KioskMapHandle;
    pushed = JSON.stringify(view);
    // A map created during an outage starts held; a live feed lets it run.
    current.setFeedState?.(feed);
    return current;
  });
  return {
    factory: wrapped,
    handle: () => current,
    setView(next) {
      view = next;
      const key = JSON.stringify(next);
      if (key === pushed) return;
      pushed = key;
      current?.setView?.(next);
    },
    setFeedState(state) {
      feed = state;
      current?.setFeedState?.(state);
    },
    feedState: () => feed,
    setExtras(next) {
      extras = { ...extras, ...next };
    },
  };
}

export function viewOf(request: KioskMapRequest): KioskMapView {
  const view: KioskMapView = { zoom: request.zoom };
  if (request.center) view.center = request.center;
  if (request.selectedRoute) view.selectedRoute = request.selectedRoute;
  if (request.selectedStop) view.selectedStop = request.selectedStop;
  if (request.follow) view.follow = true;
  return view;
}

/** zet-rt pins as dated map points: evidence for the motion model. */
export function vehiclePoints(zet: ModuleSnapshot | undefined, now: number): MapPoint[] {
  return vehicleFixes(zet, now).map((fix) => ({
    id: fix.id,
    lon: fix.lon,
    lat: fix.lat,
    at: fix.at,
    routeId: fix.routeId,
    tripId: fix.tripId,
    type: fix.type,
    title: routeName(fix.routeId ?? ''),
  }));
}

/** Closures with a line geometry, as map lines. */
export function closureLines(prometnice: ModuleSnapshot | undefined): MapLine[] {
  const out: MapLine[] = [];
  for (const item of prometnice?.items ?? []) {
    if (item.kind !== 'closure' || item.geo?.type !== 'LineString') continue;
    out.push({ id: item.id, title: item.title, coordinates: item.geo.coordinates as [number, number][] });
  }
  return out;
}

/** The screen's stop as an undated place: drawn where it is. */
export function stopPlace(stop: ScreenStop): MapPoint {
  return { id: `stop:${stop.id}`, lon: stop.lon, lat: stop.lat, title: stop.name };
}

/** Metres per CSS pixel at a zoom and latitude (512 px tiles, as MapLibre counts). */
export function metresPerPixel(zoom: number, lat: number): number {
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/** The camera centre that puts the stop in the middle of the part of the map
 *  the lines board does not cover: the true centre moved south by half the
 *  board's height. No board (lightweight, no layout yet) means no shift. */
export function boardCentre(stop: { lon: number; lat: number }, zoom: number, boardPx: number): [number, number] {
  if (!(boardPx > 0)) return [stop.lon, stop.lat];
  const metres = (boardPx / 2) * metresPerPixel(zoom, stop.lat);
  return [stop.lon, stop.lat - metres / 111_320];
}

export interface KioskMapInput {
  stop: ScreenStop | null;
  snapshots: Partial<Record<'zet-rt' | 'prometnice', ModuleSnapshot>>;
  now: number;
  selection: PublicSelection | null;
  ariaLabel: string;
  reducedMotion?: boolean;
  /** Height of the lines board over the map's foot, in CSS px. */
  boardPx?: number;
  locale?: string;
}

/** Builds the request for this render and asks the slots for the one map.
 *  Null when the page has no map factory (lightweight, or a browser with
 *  no WebGL), in which case the composition shows its list instead. */
export function requestKioskMap(maps: MapSlots, input: KioskMapInput, adapter?: KioskMapAdapter): HTMLElement | null {
  const points = vehiclePoints(input.snapshots['zet-rt'], input.now);
  if (input.stop) points.push(stopPlace(input.stop));
  const request: KioskMapRequest = {
    id: KIOSK_MAP_SLOT_ID,
    className: 'k-map-canvas',
    testid: 'kiosk-map',
    ariaLabel: input.ariaLabel,
    points,
    lines: closureLines(input.snapshots.prometnice),
    reducedMotion: input.reducedMotion,
    zoom: KIOSK_MAP_ZOOM,
    stop: input.stop,
    interactive: false,
    symbolScale: KIOSK_SYMBOL_SCALE,
    locale: input.locale,
  };
  if (input.stop) {
    request.center = boardCentre(input.stop, KIOSK_MAP_ZOOM, input.boardPx ?? 0);
    request.selectedStop = input.stop.id;
  }
  if (input.selection?.kind === 'route') {
    request.selectedRoute = input.selection.id;
    request.follow = true;
  } else if (input.selection?.kind === 'stop') {
    request.selectedStop = input.selection.id;
  }
  // The view is set before the slot call so a map created by it starts there.
  adapter?.setExtras({ stop: input.stop, interactive: false, symbolScale: KIOSK_SYMBOL_SCALE, locale: input.locale });
  adapter?.setView(viewOf(request));
  const container = maps.slot(request);
  // An outage is no evidence of motion: the map holds until the feed is live again.
  adapter?.setFeedState(feedStateOf(input.snapshots['zet-rt']));
  return container;
}
