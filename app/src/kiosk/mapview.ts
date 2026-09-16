// The kiosk's one map. Every composition that shows a map asks map-slots for
// the same slot id, so the invitation, the paired overview and the paired
// transit view share one live MapLibre context and one motion-model history
// for the screen's whole life (R-54: no poll and no phase change re-creates
// a map). Vehicle reports go in as dated points -- evidence for the model,
// never a drawn position (R-P2); closures as lines; the screen's own stop as
// an undated place, which the map draws where given.
//
// The request carries the map workstream's additive options: the camera the
// showing chapter asks for (chapterView), the sides of the box the
// composition covers, the screen's stop to mark, the phone's selected route
// or stop, route follow, no pointer handling, the sign basemap profile and
// symbols at twice size for a screen read from three metres. The handle's
// additive methods are driven from here too: `setView` when the view changes,
// `resize` after the container is re-parented, `setOutline` when the chapter
// wants the quarter drawn, and `setFeedState` from the ZET snapshot's own
// status on every paint, so a stale or down feed holds every vehicle where it
// is and neither a reparent nor `resume()` can animate through an outage.
//
// The map is not only the network any more. cityPoints() puts what the city
// itself publishes on it -- placed happenings, the communal works under way,
// the recent quake, the on-duty pharmacy, the seat of the quarter, and the
// assembly points while the state is urgent -- each with the rule that keeps
// it honest stated beside it, and most of them enforced in a layer filter
// rather than in a comment (map/overlays.ts).
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { isOpenLicenceEvent } from '../../../worker/feed/modules/dogadanja/licence';
import type { FeedSnapshots, PublicSelection, ScreenStop } from '../core/contracts';
import { routeName } from '../data/routes';
import { safetyState } from '../experience/safety-state';
import type { BasemapProfile } from '../map/basemap';
import type { CityMapHandle, CityMapOptions, FitPadding, MapFactory, MapLine, MapOutline, MapPoint, PlaceKind } from '../map/city-map';
import type { MapSlotOptions, MapSlots } from '../map/map-slots';
import { vehicleFixes } from '../motion/fixes';
import { dataNumber, dataText } from '../panels/panel';
import { districtBySlug } from './districts';
import { fmtNumber, sameZagrebDay } from './format';
import { isLive, nearestPharmacy, PHARMACY_POINTS, recentQuakes, windowOf } from './local';
import type { SceneId } from './scenes';
import { stopDistanceM } from './stops';

export const KIOSK_MAP_SLOT_ID = 'kiosk-map';
/** Street level around one stop: named streets, the stop, the vehicles near it. */
export const KIOSK_MAP_ZOOM = 15;
/** The archive stops at z14 and the worker refuses z>14, so every zoom from
 *  there up is overzoomed; no chapter camera goes past here. */
export const KIOSK_MAX_ZOOM = 15.5;
/** The bounded archive's own floor. Repeated from map/basemap.ts's
 *  MAP_MIN_ZOOM rather than imported: this module is on the lightweight graph,
 *  and a value import from basemap.ts would pull the 38 kB style builder onto
 *  it (test/app/budget.test.ts would catch it, which is the point). */
export const KIOSK_MIN_ZOOM = 10;
/** The permanent map box on a 1920 x 1080 screen, CSS px. The box is elastic;
 *  this is the width the kvart framing is derived from, and being out by a
 *  hundred pixels moves the derived zoom by a tenth. */
export const KIOSK_MAP_WIDTH_PX = 1250;
/** About this much of Zagreb across that box in the kvart chapters. Fitting a
 *  raw district bounding box instead would put Sesvete and Brezovica below the
 *  archive's own minimum zoom and show a regional blob with no names on it. */
export const KVART_SPAN_M = 6000;
/** Metres of equator per tile row, as MapLibre counts (512 px tiles). */
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

/** The zoom at which KVART_SPAN_M of ground fills KIOSK_MAP_WIDTH_PX of box,
 *  clamped to what the archive actually carries. */
export function kvartZoom(lat: number): number {
  const across = EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180) * KIOSK_MAP_WIDTH_PX;
  return Math.min(KIOSK_MAX_ZOOM, Math.max(KIOSK_MIN_ZOOM, Math.log2(across / (512 * KVART_SPAN_M))));
}

/** The kvart framing at Zagreb's own latitude: about 13.5, which is still
 *  inside the archive's native zooms, so the tiles are not overzoomed. */
export const KIOSK_KVART_ZOOM = Math.round(kvartZoom(45.815) * 100) / 100;
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
  /** Which kinds of city point this chapter lights. */
  emphasis?: readonly PlaceKind[];
  /** The screen's own stop, marked and named by the map. */
  stop?: ScreenStop | null;
  /** A public screen: no pointer or keyboard handling and no controls. */
  interactive?: boolean;
  /** The stop's own gradska cetvrt, dashed; null draws none. */
  outline?: MapOutline | null;
  symbolScale?: number;
  locale?: string;
  /** The screen reads its basemap from three metres: the sign profile. */
  basemapProfile?: BasemapProfile;
}

export type KioskMapView = Pick<KioskMapRequest, 'center' | 'zoom' | 'selectedRoute' | 'selectedStop' | 'follow' | 'padding' | 'emphasis'>;
/** Creation-time options of a public screen, merged by the adapter itself so
 *  they reach the factory whatever the slot layer passes through. */
export type KioskMapExtras = Pick<KioskMapRequest, 'stop' | 'interactive' | 'symbolScale' | 'locale' | 'basemapProfile' | 'outline'>;

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
  if (request.emphasis) view.emphasis = request.emphasis;
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

// --- The kvart outline ------------------------------------------------------
//
// One district's boundary, fetched at runtime from
// app/public/data/kvart/<slug>.json (scripts/districts.mjs writes it beside
// the stop catalogue and the per-stop last-run tables that already live
// there). Between 234 B and 2.7 kB gzipped, median about 700 B.
//
// This does not reopen the decision that keeps the district table
// worker-side (worker/feed/geo/districts.ts): that decision is about shipping
// all 17 districts to a phone so it can answer "which cetvrt is this point
// in", on a graph budgeted at 200 kB for one lookup per session. This is one
// district, fetched once, for DRAWING, on a surface that has already loaded
// the whole map library. Under lagano there is no map at all, and the fetch
// below never happens, because it is reached only once map-slots has handed
// back a container -- which it does only when the page gave it a map factory.

/** Where a district's drawable outline lives. */
export const KVART_OUTLINE_PATH = '/data/kvart';

const outlinePending = new Map<string, Promise<MapOutline | null>>();
const outlineReady = new Map<string, MapOutline | null>();

function parseOutline(slug: string, body: unknown): MapOutline | null {
  if (typeof body !== 'object' || body === null) return null;
  const polygons = (body as { polygons?: unknown }).polygons;
  if (!Array.isArray(polygons)) return null;
  const rings: [number, number][][][] = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon)) return null;
    const out: [number, number][][] = [];
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) return null;
      const points: [number, number][] = [];
      for (const point of ring) {
        if (!Array.isArray(point) || typeof point[0] !== 'number' || typeof point[1] !== 'number') return null;
        points.push([point[0], point[1]]);
      }
      out.push(points);
    }
    rings.push(out);
  }
  return rings.length === 0 ? null : { id: slug, polygons: rings };
}

/** The district's outline, fetched once per screen life and remembered --
 *  including a failure, which is remembered as "no outline" rather than
 *  retried on every 30-second poll. A screen is a long-lived thing: a flood of
 *  retries for a decoration would cost more than the decoration is worth. */
export function loadKvartOutline(slug: string, fetchImpl: typeof fetch = fetch): Promise<MapOutline | null> {
  const cached = outlinePending.get(slug);
  if (cached) return cached;
  const pending = (async () => {
    try {
      const response = await fetchImpl(`${KVART_OUTLINE_PATH}/${encodeURIComponent(slug)}.json`);
      if (!response.ok) return null;
      return parseOutline(slug, await response.json());
    } catch {
      return null;
    }
  })().then((outline) => {
    outlineReady.set(slug, outline);
    return outline;
  });
  outlinePending.set(slug, pending);
  return pending;
}

/** The outline already in hand for `slug`, so a map created on a later render
 *  starts with it instead of waiting for another fetch. */
export function kvartOutline(slug: string | null | undefined): MapOutline | null {
  return slug ? outlineReady.get(slug) ?? null : null;
}

// --- Chapters ---------------------------------------------------------------
//
// Two framings, not three. Promet holds the stop at street zoom, because the
// chapter is about the vehicles arriving at THIS stop. Vecerasa and Grad share
// one kvart framing, because both are about the quarter the screen stands in,
// and a quarter is the same quarter whichever of the two is showing.
//
// Chapters differ by which layers they light, not by what the screen is: the
// same map, the same camera per framing, a different subset of the city's own
// points. Nothing here decides which points EXIST -- cityPoints does that, and
// its honesty rules do not bend for a chapter.
//
// The camera move is one ease of about 600 ms (map/city-map.ts's CAMERA_MS).
// Under prefers-reduced-motion there is nothing to add: createCityMap already
// passes duration 0 on every move, and kiosk.ts's rotationAllowed() is false,
// so a reduced-motion screen never changes chapter and the camera never moves
// at all.

/** Which kinds of city point each chapter lights. Promet is the network, so
 *  it lights only what safety puts on any screen at any hour: the assembly
 *  points (which draw only while the state is urgent) and the one on-duty
 *  pharmacy. The two kvart chapters are the city: what is happening where a
 *  source published a coordinate, the recent quake, and -- in Grad, which is
 *  the chapter about the city as an institution -- the seat of the quarter. */
export const CHAPTER_EMPHASIS: Readonly<Record<SceneId, readonly PlaceKind[]>> = Object.freeze({
  promet: Object.freeze(['assembly', 'pharmacy'] as PlaceKind[]),
  veceras: Object.freeze(['event', 'quake', 'assembly', 'pharmacy'] as PlaceKind[]),
  grad: Object.freeze(['event', 'quake', 'seat', 'assembly'] as PlaceKind[]),
});

export interface ChapterInput {
  stop: ScreenStop | null;
  selection: PublicSelection | null;
  padding?: FitPadding;
}

export interface ChapterView extends KioskMapView {
  zoom: number;
  emphasis: readonly PlaceKind[];
  /** Whether this chapter draws the quarter's dashed outline. */
  outline: boolean;
}

/** The whole chapter contract, pure: no map, no DOM, no clock.
 *
 *  `follow` is refused outside Promet on purpose. Following a route's vehicles
 *  while framing a quarter is incoherent -- the reader is being shown the
 *  quarter and the camera is chasing a tram out of it -- and the two eases
 *  would fight each other besides. */
export function chapterView(chapter: SceneId, input: ChapterInput): ChapterView {
  const kvart = chapter !== 'promet';
  const view: ChapterView = {
    zoom: Math.min(KIOSK_MAX_ZOOM, kvart ? KIOSK_KVART_ZOOM : KIOSK_MAP_ZOOM),
    emphasis: CHAPTER_EMPHASIS[chapter],
    outline: kvart,
  };
  if (input.padding) view.padding = input.padding;
  if (input.stop) {
    view.center = [input.stop.lon, input.stop.lat];
    view.selectedStop = input.stop.id;
  }
  if (kvart) return view;
  if (input.selection?.kind === 'route') {
    view.selectedRoute = input.selection.id;
    view.follow = true;
  } else if (input.selection?.kind === 'stop') {
    view.selectedStop = input.selection.id;
  }
  return view;
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
  /** Which chapter is showing; 'promet' (the stop at street zoom) by default. */
  chapter?: SceneId;
  ariaLabel: string;
  reducedMotion?: boolean;
  /** Injected in tests; the page's own fetch otherwise. */
  fetchImpl?: typeof fetch;
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
  const chapter = chapterView(input.chapter ?? 'promet', input);
  const request: KioskMapRequest = {
    id: KIOSK_MAP_SLOT_ID,
    className: 'k-map-canvas',
    testid: 'kiosk-map',
    ariaLabel: input.ariaLabel,
    points,
    lines: closureLines(input.snapshots.prometnice),
    reducedMotion: input.reducedMotion,
    zoom: chapter.zoom,
    emphasis: chapter.emphasis,
    stop: input.stop,
    interactive: false,
    symbolScale: KIOSK_SYMBOL_SCALE,
    basemapProfile: KIOSK_BASEMAP_PROFILE,
    locale: input.locale,
    outline: chapter.outline ? kvartOutline(input.stop?.district) : null,
  };
  if (chapter.padding) request.padding = chapter.padding;
  if (chapter.center) request.center = chapter.center;
  if (chapter.selectedStop) request.selectedStop = chapter.selectedStop;
  if (chapter.selectedRoute) request.selectedRoute = chapter.selectedRoute;
  if (chapter.follow) request.follow = true;
  // The view is set before the slot call so a map created by it starts there.
  adapter?.setExtras({ stop: input.stop, interactive: false, symbolScale: KIOSK_SYMBOL_SCALE, basemapProfile: KIOSK_BASEMAP_PROFILE, locale: input.locale, outline: request.outline });
  adapter?.setView(viewOf(request));
  const container = maps.slot(request);
  // An outage is no evidence of motion: the map holds until the feed is live again.
  adapter?.setFeedState(feedStateOf(input.snapshots['zet-rt']));
  // The chapter decides whether the quarter's outline is drawn at all; the
  // handle is told either way, and ignores an unchanged one.
  adapter?.handle()?.setOutline?.(request.outline ?? null);
  // A container means the page gave map-slots a factory, which lagano never
  // does: the outline is fetched only where there is a map to draw it on.
  const district = input.stop?.district;
  if (container && chapter.outline && district && !request.outline) {
    void loadKvartOutline(district, input.fetchImpl).then((outline) => {
      if (outline) adapter?.handle()?.setOutline?.(outline);
    });
  }
  return container;
}
