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
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import { isOpenLicenceEvent } from '../../../worker/feed/modules/dogadanja/licence';
import type { FeedSnapshots, PublicSelection, ScreenStop } from '../core/contracts';
import { routeName } from '../data/routes';
import { safetyState } from '../experience/safety-state';
import type { BasemapProfile } from '../map/basemap';
import type { CityMapHandle, CityMapOptions, FitPadding, MapFactory, MapLine, MapPoint } from '../map/city-map';
import type { MapSlotOptions, MapSlots } from '../map/map-slots';
import { vehicleFixes } from '../motion/fixes';
import { dataNumber, dataText } from '../panels/panel';
import { districtBySlug } from './districts';
import { fmtNumber, sameZagrebDay } from './format';
import { isLive, nearestPharmacy, PHARMACY_POINTS, recentQuakes, windowOf } from './local';
import { stopDistanceM } from './stops';

export const KIOSK_MAP_SLOT_ID = 'kiosk-map';
/** Street level around one stop: named streets, the stop, the vehicles near it. */
export const KIOSK_MAP_ZOOM = 15;
/** Symbols on a screen read from three metres, not from steps away. At 1.5
 *  the number on a vehicle pill was 18 CSS px, which on a 55-inch 1080p panel
 *  subtends 9.2 arcminutes -- under the ten-arcminute floor the basemap's sign
 *  profile derives (map/basemap.ts), so the one mark the whole transport
 *  chapter is about was the one mark that could not be read. At 2 it is 24 px
 *  (12.2'), and 2 is also exactly the SDF images' own pixel ratio, so the
 *  overlay rasters draw pixel for pixel on a 1x television instead of being
 *  resampled. */
export const KIOSK_SYMBOL_SCALE = 2;

/** The screen is the one surface read from three metres, so it is the one
 *  surface on the sign basemap: promoted neighbourhood, street and water
 *  names, a ranked civic POI list, and nothing that cannot reach the
 *  readability floor (map/basemap.ts). */
export const KIOSK_BASEMAP_PROFILE: BasemapProfile = 'sign';

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
  /** Sides of the map something is drawn over; the camera centres in the rest. */
  padding?: FitPadding;
  /** The screen's own stop, marked and named by the map. */
  stop?: ScreenStop | null;
  /** A public screen: no pointer or keyboard handling and no controls. */
  interactive?: boolean;
  symbolScale?: number;
  locale?: string;
  /** The screen reads its basemap from three metres: the sign profile. */
  basemapProfile?: BasemapProfile;
}

export type KioskMapView = Pick<KioskMapRequest, 'center' | 'zoom' | 'selectedRoute' | 'selectedStop' | 'follow' | 'padding'>;
/** Creation-time options of a public screen, merged by the adapter itself so
 *  they reach the factory whatever the slot layer passes through. */
export type KioskMapExtras = Pick<KioskMapRequest, 'stop' | 'interactive' | 'symbolScale' | 'locale' | 'basemapProfile'>;

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
  let extras: KioskMapExtras = { interactive: false, symbolScale: KIOSK_SYMBOL_SCALE, basemapProfile: KIOSK_BASEMAP_PROFILE };
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
  if (request.padding) view.padding = request.padding;
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

// --- The city, not only the network ---------------------------------------
//
// Five kinds of point the city itself publishes, each with the rule that
// keeps it honest stated beside it. Four of the five are already on every
// 30-second teaser this screen fetches and nothing has ever read them.
//
// What is NOT here, and why: of the six dogadanja sources, Kulturpunkt and
// the Etnografski are barred from the open tier by licence, and of the five
// that are not, komunalne is the only one that publishes coordinates at all.
// The rest carry a venue as free text, and geocoding a venue name on the
// client would be inventing a position -- the one thing this codebase refuses
// everywhere else ("a reported vehicle position is evidence, never output").

/** Every dogadanja row whose own source published a coordinate.
 *
 *  Keyed on geometry, never on which source the row came from: today
 *  komunalne is the only open-licence source with points, so what this
 *  actually draws today is the communal works, but the day another source
 *  starts publishing coordinates it appears here with no code change. That
 *  forward compatibility is the point of selecting this way. The licence gate
 *  still decides which rows exist at all, so a paired session that carries
 *  Kulturpunkt places its rows through this same function, and the open tier
 *  a public screen reads never sees them.
 *
 *  Two things would widen this, and neither is design: more of the City's
 *  sources publishing coordinates, and the planned static gazetteer of known
 *  venues with fuzzy name matching, which could say how it matched a venue
 *  string. Until that exists a point is drawn only where a source put one --
 *  never derived from a venue name, a district, or a polygon centroid. */
export function placedEvents(dogadanja: ModuleSnapshot | undefined, now: number): MapPoint[] {
  const out: MapPoint[] = [];
  for (const item of isLive(dogadanja) ? dogadanja.items : []) {
    if (!isOpenLicenceEvent(item) || item.geo?.type !== 'Point') continue;
    const [lon, lat] = item.geo.coordinates as number[];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (windowOf(item, now) === 'expired') continue;
    // A row dated by the happening itself is placed only while it runs or
    // starts today -- the evening's own band, not a pin for something months
    // out. A row dated by a register change (a communal work) has no such
    // band: its phase decides, in the layer's own filter.
    if (item.dateBasis === 'event' && item.at && !sameZagrebDay(item.at, now) && windowOf(item, now) !== 'active') continue;
    out.push({
      id: `event:${item.id}`,
      lon: lon!,
      lat: lat!,
      title: item.title,
      place: 'event',
      props: { source: dataText(item, 'source'), phase: dataText(item, 'phase'), category: dataText(item, 'category') },
    });
  }
  return out;
}

/** The quakes recentQuakes() already selects: 72 hours, 150 km of Zagreb. The
 *  circle carries the magnitude and nothing else; a quake the source gave no
 *  magnitude carries its region as its name and draws no circle, because a
 *  circle with no magnitude would be the claim "M 0". */
export function quakePoints(emsc: ModuleSnapshot | undefined, now: number, locale: string): MapPoint[] {
  const out: MapPoint[] = [];
  for (const quake of recentQuakes(emsc, now)) {
    if (quake.geo?.type !== 'Point') continue;
    const [lon, lat] = quake.geo.coordinates as number[];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const mag = dataNumber(quake, 'mag');
    const region = dataText(quake, 'region') || quake.title;
    out.push({
      id: `quake:${quake.id}`,
      lon: lon!,
      lat: lat!,
      title: mag === null ? region : `M ${fmtNumber(locale, mag, 1)}`,
      place: 'quake',
      ...(mag === null ? {} : { props: { mag } }),
    });
  }
  return out;
}

/** Up to eight assembly points, nearest the stop. */
export const ASSEMBLY_CAP = 8;

/** The civil-protection assembly points, drawn ONLY while the safety state is
 *  urgent. Up to 500 of them ride every teaser and nothing reads them, which
 *  is a waste; but a screen permanently covered in emergency marks is
 *  fearmongering, and it teaches people to stop seeing them on the day it
 *  matters. Nothing here implies the point is open or staffed: the City
 *  publishes a register of places, not a state, which is why the mark is a
 *  hollow square in ink and never an alarm colour. */
export function assemblyPoints(geo: ModuleSnapshot | undefined, stop: ScreenStop | null, urgent: boolean): MapPoint[] {
  if (!urgent) return [];
  const rows: { point: MapPoint; distanceM: number }[] = [];
  for (const item of isLive(geo) ? geo.items : []) {
    if (item.kind !== 'poi' || dataText(item, 'layer') !== 'zborna-mjesta' || item.geo?.type !== 'Point') continue;
    const [lon, lat] = item.geo.coordinates as number[];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    rows.push({
      point: { id: `assembly:${item.id}`, lon: lon!, lat: lat!, title: item.title, place: 'assembly' },
      distanceM: stop ? stopDistanceM({ lon: lon!, lat: lat! }, stop) : Number.POSITIVE_INFINITY,
    });
  }
  rows.sort((a, b) => a.distanceM - b.distanceM);
  return rows.slice(0, ASSEMBLY_CAP).map((r) => r.point);
}

/** The one on-duty pharmacy the safety strip also names, so the map and the
 *  strip can never name two different ones. Its coordinate is hand-entered and
 *  approximate (local.ts's PHARMACY_POINTS) and its ADDRESS is exact, so the
 *  address is the label and the mark is a hollow ring, never a filled pin. */
export function pharmacyPoint(stop: ScreenStop | null): MapPoint[] {
  const pharmacy = nearestPharmacy(stop);
  const at = PHARMACY_POINTS[pharmacy.label];
  if (!at) return [];
  return [{ id: `pharmacy:${pharmacy.label}`, lon: at.lon, lat: at.lat, title: pharmacy.address, place: 'pharmacy', props: { address: pharmacy.address } }];
}

/** The seat of the stop's own gradska cetvrt, from the real seat coordinates
 *  the district table carries (kiosk/districts.ts) -- never from the ckan-geo
 *  polygon centroid the open feed serves, which is a label anchor and not a
 *  venue, and which for a concave district need not even lie inside it. */
export function seatPoint(stop: ScreenStop | null): MapPoint[] {
  const district = districtBySlug(stop?.district);
  if (!district) return [];
  return [{ id: `seat:${district.slug}`, lon: district.seat.lon, lat: district.seat.lat, title: district.name, place: 'seat', props: { address: district.seat.address } }];
}

/** Every city point, in one call: what the screen's own corner of Zagreb
 *  publishes about itself. The chapter decides which of them are lit
 *  (chapterView), never which of them exist. */
export function cityPoints(snapshots: FeedSnapshots, stop: ScreenStop | null, now: number, locale: string): MapPoint[] {
  return [
    ...placedEvents(snapshots.dogadanja, now),
    ...quakePoints(snapshots.emsc, now, locale),
    ...assemblyPoints(snapshots['ckan-geo'], stop, safetyState(snapshots, now).level === 'urgent'),
    ...pharmacyPoint(stop),
    ...seatPoint(stop),
  ];
}

/** Metres per CSS pixel at a zoom and latitude (512 px tiles, as MapLibre counts). */
export function metresPerPixel(zoom: number, lat: number): number {
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

export interface KioskMapInput {
  stop: ScreenStop | null;
  /** The whole teaser, not only the two transport modules: the map draws the
   *  city's own points too (cityPoints). */
  snapshots: FeedSnapshots;
  now: number;
  selection: PublicSelection | null;
  ariaLabel: string;
  reducedMotion?: boolean;
  /** Sides of the map the composition draws its own cards over, CSS px: the
   *  kiosk measures its rail, the map centres inside what is left. Replaces
   *  the latitude shift boardCentre used to fake. */
  padding?: FitPadding;
  locale?: string;
}

/** Builds the request for this render and asks the slots for the one map.
 *  Null when the page has no map factory (lightweight, or a browser with
 *  no WebGL), in which case the composition shows its list instead. */
export function requestKioskMap(maps: MapSlots, input: KioskMapInput, adapter?: KioskMapAdapter): HTMLElement | null {
  const points = vehiclePoints(input.snapshots['zet-rt'], input.now);
  if (input.stop) points.push(stopPlace(input.stop));
  points.push(...cityPoints(input.snapshots, input.stop, input.now, input.locale ?? 'hr'));
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
    basemapProfile: KIOSK_BASEMAP_PROFILE,
    locale: input.locale,
  };
  if (input.padding) request.padding = input.padding;
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
  adapter?.setExtras({ stop: input.stop, interactive: false, symbolScale: KIOSK_SYMBOL_SCALE, basemapProfile: KIOSK_BASEMAP_PROFILE, locale: input.locale });
  adapter?.setView(viewOf(request));
  const container = maps.slot(request);
  // An outage is no evidence of motion: the map holds until the feed is live again.
  adapter?.setFeedState(feedStateOf(input.snapshots['zet-rt']));
  return container;
}
