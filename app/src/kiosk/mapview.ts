// The kiosk's one map. Every composition that shows a map asks map-slots for
// the same slot id, so the invitation, the paired overview and the paired
// transit view share one live MapLibre context and one motion-model history
// for the screen's whole life (R-54: no poll and no phase change re-creates
// a map). Vehicle reports go in as dated points -- evidence for the model,
// never a drawn position (R-P2); closures as lines; the screen's own stop as
// an undated place, which the map draws where given.
//
// The request carries additive fields (`center`, `zoom`, `selectedRoute`,
// `selectedStop`, `follow`) for the map workstream's enhanced map-slots and
// createCityMap. Today's factory reads none of them and centres on the city
// at zoom 12; see INTEGRATION.md in this directory for the hand-off.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import type { PublicSelection, ScreenStop } from '../core/contracts';
import { routeName } from '../data/routes';
import type { CityMapHandle, CityMapOptions, MapFactory, MapLine, MapPoint } from '../map/city-map';
import type { MapSlotOptions, MapSlots } from '../map/map-slots';
import { vehicleFixes } from '../motion/fixes';

export const KIOSK_MAP_SLOT_ID = 'kiosk-map';
/** Street level around one stop: named streets, the stop, the vehicles near it. */
export const KIOSK_MAP_ZOOM = 15;

export interface KioskMapRequest extends MapSlotOptions {
  /** [lon, lat] of the screen's stop; the map's initial and idle centre. */
  center?: [number, number];
  zoom?: number;
  /** The public selection the driver's phone relayed, when it names a route or a stop. */
  selectedRoute?: string;
  selectedStop?: string;
  /** Keep the camera on the selected route's vehicles (map workstream option). */
  follow?: boolean;
}

export type KioskMapView = Pick<KioskMapRequest, 'center' | 'zoom' | 'selectedRoute' | 'selectedStop' | 'follow'>;

/** The map workstream's enhanced handle may take a view after creation;
 *  today's CityMapHandle has no such method and the call is simply skipped. */
export interface KioskMapHandle extends CityMapHandle { setView?(view: KioskMapView): void }

export interface KioskMapAdapter {
  /** The factory to hand map-slots: a map it creates receives the current view additively. */
  factory: MapFactory | undefined;
  /** The one live handle: pause/resume when the container is parked, setView when supported. */
  handle(): KioskMapHandle | null;
  /** Remembers the view for the next creation and pushes it to a handle that understands it. */
  setView(view: KioskMapView): void;
}

/** Wraps the page's factory so the kiosk's centre, zoom and selection ride on
 *  the options (extra fields today's createCityMap ignores) and keeps the one
 *  handle map-slots otherwise hides. `undefined` in stays `undefined` out. */
export function createKioskMapAdapter(factory: MapFactory | undefined): KioskMapAdapter {
  let view: KioskMapView = { zoom: KIOSK_MAP_ZOOM };
  let pushed = '';
  let current: KioskMapHandle | null = null;
  const wrapped: MapFactory | undefined = factory && ((options) => {
    const merged: CityMapOptions & KioskMapView = { ...options, ...view };
    current = factory(merged) as KioskMapHandle;
    pushed = JSON.stringify(view);
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

export interface KioskMapInput {
  stop: ScreenStop | null;
  snapshots: Partial<Record<'zet-rt' | 'prometnice', ModuleSnapshot>>;
  now: number;
  selection: PublicSelection | null;
  ariaLabel: string;
  reducedMotion?: boolean;
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
  };
  if (input.stop) {
    request.center = [input.stop.lon, input.stop.lat];
    request.selectedStop = input.stop.id;
  }
  if (input.selection?.kind === 'route') {
    request.selectedRoute = input.selection.id;
    request.follow = true;
  } else if (input.selection?.kind === 'stop') {
    request.selectedStop = input.selection.id;
  }
  // The view is set before the slot call so a map created by it starts there.
  adapter?.setView(viewOf(request));
  return maps.slot(request);
}
