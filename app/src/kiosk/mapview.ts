// The kiosk's one map. Every composition that shows a map asks map-slots for
// the same slot id, so the invitation and the paired compositions share one
// live MapLibre context and one motion-model history for the screen's whole
// life (R-54: no poll and no phase change re-creates a map). Vehicle reports
// go in as dated points -- evidence for the model, never a drawn position
// (R-P2); closures as lines; the screen's own stop as an undated place, which
// the map draws where given.
//
// Two cameras, one map (plan "Camera and data plumbing"). The invitation is a
// window onto the kvart (R-KP1): the stop at the centre, north-up, the zoom
// DERIVED from the field's measured width so that FIELD_SPAN_M of ground
// spans it (R-KP2), no padding and no selection (R-KP11: the enlarged
// screen-stop ring is the anchor, a `selectedStop` would draw a second ring
// over it). A paired screen keeps today's Promet contract (R-KP8): street
// zoom, the stop selected, the phone's route followed or its stop selected.
// Both phases ride the `prozor` profile and the `prozor` overlay set
// (contract 2), because one map lives for the screen's life.
//
// The request carries the map workstream's additive options: the camera, the
// screen's stop to mark, the phone's selection, route follow, no pointer
// handling, the basemap profile, the prozor overlay options and symbols at
// twice size for a screen read from three metres. The handle's additive
// methods are driven from here too: `setView` when the view changes,
// `resize` after the container is re-parented, `setOutline` with the
// quarter's boundary, and `setFeedState` from the ZET snapshot's own status
// on every paint, so a stale or down feed holds every vehicle where it is and
// neither a reparent nor `resume()` can animate through an outage.
//
// The map is not only the network. cityPoints() puts what the city itself
// publishes on it -- placed happenings, the communal works under way, the
// recent quake (by the kiosk's own rule, R-KP9), the on-duty pharmacy and the
// assembly points while the state is urgent -- each with the rule that keeps
// it honest stated beside it, and most of them enforced in a layer filter
// rather than in a comment (map/overlays.ts).
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import type { CityState } from '../../../shared/city/types';
import { discover,dynamicPlaces,type CityGroup } from '../city/discovery';
import { bikeAvailability } from '../../../shared/city/bikes';
import { activeVenues, locatedEvents } from '../../../shared/city/events';
import { located, matchStreet } from '../../../shared/city/geo';
import type { MapSelection } from '../map/city-map';
import { publicItemKey, type FeedSnapshots, type PublicSelection, type ScreenStop } from '../core/contracts';
import type { PresentationTarget } from '../../../worker/presentation';
import { routeName } from '../data/routes';
import { safetyState } from '../experience/safety-state';
import type { BasemapProfile } from '../map/basemap';
import type { CityMapHandle, CityMapOptions, MapFactory, MapLine, MapOutline, MapPoint, PlaceKind } from '../map/city-map';
import type { MapSlotOptions, MapSlots } from '../map/map-slots';
import type { ProzorOptions } from '../map/overlays';
import { EARTH_CIRCUMFERENCE_M, metresPerPixel } from '../map/scale';
import { vehicleFixes } from '../motion/fixes';
import { ROUTE_TYPE_TRAM } from '../motion/schematic';
import { dataNumber, dataText } from '../panels/panel';
import { districtBySlug } from './districts';
import { fmtNumber, sameZagrebDay } from './format';
import { FIELD_DESIGN_HEIGHT, FIELD_DESIGN_WIDTH } from './layout';
import { isLive, kioskQuakes, nearestPharmacy, PHARMACY_POINTS, recentQuakes, windowOf } from './local';
import { stopDistanceM } from './stops';

export const KIOSK_MAP_SLOT_ID = 'kiosk-map';
/** The paired compositions' street level around one stop: named streets, the stop, the vehicles near it (R-KP8). */
export const PAIRED_ZOOM = 15;
/** The archive stops at z14 and the worker refuses z>14, so every zoom from
 *  there up is overzoomed; no kiosk camera goes past here. */
export const KIOSK_MAX_ZOOM = 15.5;
/** The ground the front page's map panel spans across its width (R-KP2): the
 *  stop's own surroundings, about three stops each way, which is what a panel
 *  of some 550 px can show at street level -- the vehicles on this stop's
 *  lines and the closures around it. The worker's teaser box (TEASER_BOX_HALF_M
 *  1900) reaches well past it. */
export const FIELD_SPAN_M = 1500;
/** A phone's 280 px map band spans about the panel's ground: the band is a
 *  glance at the stop, not a stage. */
export const HANDHELD_SPAN_M = 1400;
/** The ground a configured gradska cetvrt's own camera spans before its
 *  outline lands: a district is a few kilometres across, so the seat at this
 *  span is the honest frame until loadKvartOutline answers with the real one. */
export const DISTRICT_SPAN_M = 3500;
/** The derived zoom never goes below the zoom at which the marks themselves
 *  stop drawing: map/overlays.ts's PILL_ZOOM and STOP_ZOOM (12.5) plus a
 *  fifth, so even the whole-city window still carries numbered plates and
 *  stop rings rather than an empty basemap. A hand-copy of that literal, like
 *  LABEL_PADDING_TILE_PX below (this module stays off the map layer's own
 *  graph); test/app/map.test.ts pins the two equal. */
export const FIELD_MIN_ZOOM = 12.7;
/** ...nor past the overzoom ceiling KIOSK_MAX_ZOOM explains. */
export const FIELD_MAX_ZOOM = KIOSK_MAX_ZOOM;
/** The ground a pixel covers is map/scale.ts's, shared with the overlay
 *  layers that state a width in metres; re-exported under the name this
 *  module has always offered. */
export { metresPerPixel };

/** The zoom at which `spanM` of ground fills `widthPx` of box at `lat`, the
 *  inverse of metresPerPixel, clamped to the archive's readable range (R-KP2).
 *  At Zagreb's latitude the four design widths give about 14.30 (555 px),
 *  13.71 (367), 13.68 (360) and 13.77 (358 px at the handheld span); a box
 *  not yet laid out (0 px) is the floor, never NaN. */
export function fieldZoom(widthPx: number, lat: number, spanM: number): number {
  const across = EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180) * widthPx;
  const zoom = Math.log2(across / (512 * spanM));
  return Math.min(FIELD_MAX_ZOOM, Math.max(FIELD_MIN_ZOOM, Number.isFinite(zoom) ? zoom : FIELD_MIN_ZOOM));
}

/** Symbols on a screen read from three metres, not from steps away. At 1.5
 *  the number on a vehicle pill was 18 CSS px, which on a 55-inch 1080p panel
 *  subtends 9.2 arcminutes -- under the ten-arcminute floor the basemap's
 *  profile derives (map/basemap.ts), so the one mark the whole picture is
 *  about was the one mark that could not be read. At 2 it is 24 px (12.2'),
 *  and 2 is also exactly the SDF images' own pixel ratio, so the overlay
 *  rasters draw pixel for pixel on a 1x television instead of being
 *  resampled. */
export const KIOSK_SYMBOL_SCALE = 2;

/** How far from a mark a tap may land on a public screen and still pick it,
 *  CSS px (CityMapOptions.hitTolerancePx, whose default 8 is a mouse on a
 *  desk). A finger on a wall is not a mouse, and on the whole-city window the
 *  stop rings it aims at are three pixels across. */
export const KIOSK_HIT_TOLERANCE_PX = 28;

/** The zoom at which the kiosk's picture stops being the whole city and
 *  becomes a neighbourhood. From here the bus network and its capsules join
 *  the trams -- three hundred capsules over the city window would bury the
 *  trams the picture is about -- and the on-duty pharmacy's address is worth
 *  the room it takes beside the ring. */
export const CITY_DETAIL_ZOOM = 14;

/** Whether the buses are on the picture at this camera (an assumption of the
 *  round, easy to move: one zoom, stated once). */
export function busesVisible(zoom: number): boolean {
  return zoom >= CITY_DETAIL_ZOOM;
}

/** The screen is the one surface read from three metres, so it is the one
 *  surface on the prozor basemap: two landuse tones, hairline streets, no
 *  POIs, no minor labels and no neighbourhood names (map/basemap.ts). */
export const KIOSK_BASEMAP_PROFILE: BasemapProfile = 'prozor';

/** Which kinds of city point the kiosk lights, both phases (R-KP9): placed
 *  happenings and the works under way, the quake by the kiosk's own rule, the
 *  assembly points (which draw only while the state is urgent) and the one
 *  on-duty pharmacy. Never the seat of the quarter: a civic address is not a
 *  fact a passer-by needs on the picture. */
export const KIOSK_EMPHASIS: readonly PlaceKind[] = Object.freeze(['event', 'quake', 'assembly', 'pharmacy'] as PlaceKind[]);

/** The prozor overlay set the kiosk asks for (contract 2, R-KP4): the tram
 *  network as the figure and the bus network off, stops drawn only on the
 *  screen's own routes (every stop without a stop), hubs labelled from this
 *  rank, and the thresholds that used to sit at a fixed 14.5 (vehicle noses,
 *  unconditional pill placement) a tenth under the field's derived zoom, so
 *  the compact and the portrait drawings keep their noses too (R-KP2). */
export const STOP_LABEL_MIN_RANK = 4;
export const OVERLAP_ZOOM_MARGIN = 0.1;

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
  /** Which kinds of city point are lit. */
  emphasis?: readonly PlaceKind[];
  /** The screen's own stop, marked and named by the map. */
  stop?: ScreenStop | null;
  /** A public screen: no pointer or keyboard handling and no controls. */
  interactive?: boolean;
  /** The stop's own gradska cetvrt, dashed; null draws none. */
  outline?: MapOutline | null;
  symbolScale?: number;
  locale?: string;
  /** The screen reads its basemap from three metres: the prozor profile. */
  basemapProfile?: BasemapProfile;
  /** The public screen's overlay set (contract 2). */
  prozor?: ProzorOptions;
}

export type KioskMapView = Pick<KioskMapRequest, 'center' | 'zoom' | 'selectedRoute' | 'selectedStop' | 'selection' | 'follow' | 'emphasis'>;
/** Creation-time options of a public screen, merged by the adapter itself so
 *  they reach the factory whatever the slot layer passes through. */
export type KioskMapExtras = Pick<KioskMapRequest, 'renderer' | 'stop' | 'interactive' | 'symbolScale' | 'locale' | 'basemapProfile' | 'outline' | 'prozor' | 'cityLabels' | 'hitTolerancePx'>;

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
  let view: KioskMapView = { zoom: PAIRED_ZOOM };
  let pushed = '';
  let feed: FeedState = 'down';
  let extras: KioskMapExtras = { interactive: false, symbolScale: KIOSK_SYMBOL_SCALE, basemapProfile: KIOSK_BASEMAP_PROFILE, hitTolerancePx: KIOSK_HIT_TOLERANCE_PX };
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
  if (request.selection) view.selection = request.selection;
  if (request.follow) view.follow = true;
  return view;
}

/** zet-rt pins as dated map points: evidence for the motion model. */
export function vehiclePoints(zet: ModuleSnapshot | undefined, now: number): MapPoint[] {
  return vehicleFixes(zet, now).map((fix) => ({ ...fix, title: routeName(fix.routeId ?? '') }));
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
// teaser this screen fetches.
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
 *  komunalne is the only event source that publishes points, so what this
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
    if (item.geo?.type !== 'Point') continue;
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

/** One quake as a place: the circle carries the magnitude and nothing else; a
 *  quake the source gave no magnitude carries its region as its name and
 *  draws no circle, because a circle with no magnitude would be the claim
 *  "M 0". */
function quakePoint(quake: FeedItem, locale: string): MapPoint | null {
  if (quake.geo?.type !== 'Point') return null;
  const [lon, lat] = quake.geo.coordinates as number[];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const mag = dataNumber(quake, 'mag');
  const region = dataText(quake, 'region') || quake.title;
  return { id: `quake:${quake.id}`, lon: lon!, lat: lat!, title: mag === null ? region : `M ${fmtNumber(locale, mag, 1)}`, place: 'quake', ...(mag === null ? {} : { props: { mag } }) };
}

/** The quakes recentQuakes() selects (72 hours, 150 km of Zagreb), as places: the generic reader the overlay tests and the paired stories share. */
export function quakePoints(emsc: ModuleSnapshot | undefined, now: number, locale: string): MapPoint[] {
  return recentQuakes(emsc, now).map((quake) => quakePoint(quake, locale)).filter((point): point is MapPoint => point !== null);
}

/** The quakes the kiosk's own rule selects (R-KP9: kiosk/local.ts
 *  kioskQuakes -- magnitude 3.0 or more within the last 24 hours, on top of
 *  recentQuakes()'s 150 km), as places; cityPoints lights them on both
 *  phases. One rule for the map and the panels (front.ts reads the same
 *  reader), so the picture can never show a tremor the column would not
 *  name: a magnitude-1.4 tremor in Slovenia two days ago is not a fact a
 *  café reads from three metres, while the paired stories and the teaser
 *  keep recentQuakes()'s own 72 hours. */
export function kioskQuakePoints(emsc: ModuleSnapshot | undefined, now: number, locale: string): MapPoint[] {
  return kioskQuakes(emsc, now).map((quake) => quakePoint(quake, locale)).filter((point): point is MapPoint => point !== null);
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

/** Within this distance of the screen's stop the pharmacy's address label is
 *  dropped (R-KP18): at Trg bana Jelačića the address "Trg bana Josipa
 *  Jelačića 3" sat on the stop's own name, the biggest label on the picture.
 *  The ring stays, and the strip names the pharmacy in full, so nothing is
 *  lost; 150 m is about one stop's own frontage, inside which the two labels
 *  collide at every field zoom. */
export const PHARMACY_LABEL_MIN_M = 150;

/** The one on-duty pharmacy the safety strip also names, so the map and the
 *  strip can never name two different ones. Its coordinate is hand-entered and
 *  approximate (local.ts's PHARMACY_POINTS) and its ADDRESS is exact, so the
 *  address is the label and the mark is a hollow ring, never a filled pin.
 *  On the screen's own stop the label is blank and the ring alone remains
 *  (PHARMACY_LABEL_MIN_M), and so it is on a picture of the whole city, where
 *  a street address is a detail nobody can act on from three metres
 *  (`labelled` false, CITY_DETAIL_ZOOM); `props.address` stays, because the
 *  ring's layer filter draws a pharmacy only with its published address
 *  (map/overlays.ts). */
export function pharmacyPoint(stop: ScreenStop | null, labelled = true): MapPoint[] {
  const pharmacy = nearestPharmacy(stop);
  const at = PHARMACY_POINTS[pharmacy.label];
  if (!at) return [];
  const onTheStop = stop !== null && stopDistanceM(at, stop) < PHARMACY_LABEL_MIN_M;
  return [{ id: `pharmacy:${pharmacy.label}`, lon: at.lon, lat: at.lat, title: labelled && !onTheStop ? pharmacy.address : '', place: 'pharmacy', props: { address: pharmacy.address } }];
}

/** The seat of the stop's own gradska cetvrt, from the real seat coordinates
 *  the district table carries (kiosk/districts.ts) -- never from the ckan-geo
 *  polygon centroid the open feed serves, which is a label anchor and not a
 *  venue, and which for a concave district need not even lie inside it. The
 *  kiosk never lights it (KIOSK_EMPHASIS, R-KP9); it exists for the layer
 *  filter to keep hidden rather than for a comment to promise so. */
export function seatPoint(stop: ScreenStop | null): MapPoint[] {
  const district = districtBySlug(stop?.district);
  if (!district) return [];
  return [{ id: `seat:${district.slug}`, lon: district.seat.lon, lat: district.seat.lat, title: district.name, place: 'seat', props: { address: district.seat.address } }];
}

/** Every city point, in one call: what the screen's own corner of Zagreb
 *  publishes about itself. The camera decides which of them are lit
 *  (KIOSK_EMPHASIS), never which of them exist. */
export function cityPoints(snapshots: FeedSnapshots, stop: ScreenStop | null, now: number, locale: string, pharmacyLabelled = true): MapPoint[] {
  return [
    ...placedEvents(snapshots.dogadanja, now),
    ...kioskQuakePoints(snapshots.emsc, now, locale),
    ...assemblyPoints(snapshots['ckan-geo'], stop, safetyState(snapshots, now).level === 'urgent'),
    ...pharmacyPoint(stop, pharmacyLabelled),
    ...seatPoint(stop),
  ];
}

/** What the city itself publishes, on the window a screen nobody configured
 *  opens with: every BAJS station with the count of bikes standing in it, and
 *  every venue with something on this week with the count of its programme.
 *  Both as a mark and a badge alone -- the names are off (CityMapOptions
 *  cityLabels), because a hundred station names over the tram network is a
 *  list and not a map, and a count is the one thing a passer-by can act on
 *  from across a room. The names come back the moment somebody explores,
 *  where discover() picks the few places a query or a group is about.
 *
 *  The shapes are discover()'s own (app/src/city/discovery.ts), so one tap
 *  reaches the same place through the same properties whichever built it. */
export function cityWindowPoints(city: CityState, dogadanja: readonly FeedItem[], now: number): MapPoint[] {
  const out: MapPoint[] = [];
  for (const place of dynamicPlaces(city, now)) {
    if (place.sourceId !== 'bajs' || !located(place)) continue;
    out.push({ id: place.id, title: '', lon: place.lon, lat: place.lat, place: 'city', props: { category: 'bikes', badge: bikeAvailability(place, 'rent'), eventCount: 0, priority: 2 } });
  }
  for (const venue of activeVenues(locatedEvents(dogadanja, city.places, now, 'week'), city.places)) {
    if (!located(venue.place)) continue;
    out.push({ id: venue.place.id, title: '', lon: venue.place.lon, lat: venue.place.lat, place: 'city', props: { category: venue.place.category, badge: String(venue.count), eventCount: venue.count, priority: 0 } });
  }
  return out;
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
const mapDistrict = new WeakMap<MapSlots, string>();

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
 *  retried on every poll. A screen is a long-lived thing: a flood of retries
 *  for a decoration would cost more than the decoration is worth. */
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

// --- The two cameras ----------------------------------------------------------
//
// The invitation's field and the paired compositions share one map and one
// set of lit points; they differ in the camera and in what the phone may
// steer. Pure: no map, no DOM, no clock. Under prefers-reduced-motion there
// is nothing to add: createCityMap already passes duration 0 on every move.

export interface KioskView extends KioskMapView {
  zoom: number;
  emphasis: readonly PlaceKind[];
  /** The kiosk's camera never suppresses the quarter's dashed outline: what
   *  decides whether one is drawn is whether the screen was configured for a
   *  gradska cetvrt at all (requestKioskMap). */
  outline: true;
}

export interface FieldInput {
  stop: ScreenStop | null;
  /** The configured gradska cetvrt's slug, or null for the whole city. An
   *  area that names no gradska cetvrt ('zagreb') is the whole city too. */
  district: string | null;
  /** The map host's laid-out width in CSS px (kiosk/field.ts measureWidth), or the composition's design width before layout (kiosk/layout.ts FIELD_DESIGN_WIDTH). */
  widthPx: number;
  /** The host's laid-out height, the other axis of the window's own fit. */
  heightPx: number;
  /** FIELD_SPAN_M on a wall, HANDHELD_SPAN_M on a phone's band. */
  spanM: number;
}

/** The whole-city window a screen opens on when nobody has configured it:
 *  Crnomerec to Maksimir across, the Sava to Mirogoj up, which is the city a
 *  passer-by means by "Zagreb". One constant, so moving the frame is one
 *  edit. */
export const CITY_WINDOW = Object.freeze({ west: 15.925, south: 45.775, east: 16.035, north: 45.838 });

/** Clearance between the window's own edge and the field's, on every side:
 *  the marks that sit on the window's rim (a terminus plate, a BAJS count)
 *  need room to draw beside their point. */
export const CITY_WINDOW_PADDING_PX = 24;

/** The camera that fits a lon/lat box in a widthPx x heightPx field with
 *  `paddingPx` of clearance on every side: the box's centre, and the zoom at
 *  which its ground fits -- one axis at a time, the tighter of the two
 *  winning, because a fit that honoured only the width would crop the top and
 *  the bottom off. Each axis is the inverse of metresPerPixel (map/scale.ts),
 *  the same arithmetic fieldZoom states for a span; in Web Mercator a ground
 *  metre costs the same pixels north to south as east to west at a given
 *  latitude, so one metres-per-pixel serves both. Never past the overzoom
 *  ceiling and never below `minZoom`; a field not yet laid out (0 px) is
 *  minZoom, never NaN. */
function boundsView(bounds: { west: number; south: number; east: number; north: number }, widthPx: number, heightPx: number, paddingPx: number, minZoom: number): { center: [number, number]; zoom: number } {
  const lat = (bounds.south + bounds.north) / 2;
  const across = EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180);
  const groundW = (across * (bounds.east - bounds.west)) / 360;
  const groundH = (EARTH_CIRCUMFERENCE_M * (bounds.north - bounds.south)) / 360;
  const axis = (px: number, groundM: number): number => Math.log2((across * Math.max(1, px - 2 * paddingPx)) / (512 * groundM));
  const fit = Math.min(axis(widthPx, groundW), axis(heightPx, groundH));
  return { center: [(bounds.west + bounds.east) / 2, lat], zoom: Math.min(FIELD_MAX_ZOOM, Math.max(minZoom, Number.isFinite(fit) ? fit : minZoom)) };
}

/** CITY_WINDOW fitted to this field. Every box the kiosk lays out today is
 *  smaller than the window's 8.5 x 7.0 km asks for, so every one of them
 *  sits on FIELD_MIN_ZOOM and shows a little less than the whole frame north
 *  to south: the floor is the marks' own, and a window with no plates and no
 *  stop rings on it would not be the city, live. */
export function cityWindowView(widthPx: number, heightPx: number): { center: [number, number]; zoom: number } {
  return boundsView(CITY_WINDOW, widthPx, heightPx, CITY_WINDOW_PADDING_PX, FIELD_MIN_ZOOM);
}

/** A district's outline fitted to this field, for the screen whose area is
 *  one gradska cetvrt: the same fit as the window's, so the two frames are
 *  one arithmetic. */
export function outlineView(outline: MapOutline, widthPx: number, heightPx: number): { center: [number, number]; zoom: number } {
  const coordinates = outline.polygons.flat(2);
  const lons = coordinates.map((p) => p[0]), lats = coordinates.map((p) => p[1]);
  return boundsView({ west: Math.min(...lons), south: Math.min(...lats), east: Math.max(...lons), north: Math.max(...lats) }, widthPx, heightPx, CITY_WINDOW_PADDING_PX, FIELD_MIN_ZOOM);
}

/** The invitation's window (R-KP1, R-KP2, R-KP11): the kiosk's points lit,
 *  the quarter drawn, no selection, no follow, no padding -- on the frame the
 *  screen's own configuration asks for. A configured stop keeps its centred
 *  camera at the derived zoom; a configured gradska cetvrt sits on its seat
 *  until its outline lands (requestKioskMap re-frames on the real rings); a
 *  screen with neither -- which is every screen the one-button setup makes --
 *  opens on the whole city. */
export function fieldView(input: FieldInput): KioskView {
  const view: KioskView = { zoom: FIELD_MIN_ZOOM, emphasis: KIOSK_EMPHASIS, outline: true };
  const district = districtBySlug(input.district);
  if (input.stop) {
    view.zoom = fieldZoom(input.widthPx, input.stop.lat, input.spanM);
    view.center = [input.stop.lon, input.stop.lat];
  } else if (district) {
    view.zoom = fieldZoom(input.widthPx, district.seat.lat, DISTRICT_SPAN_M);
    view.center = [district.seat.lon, district.seat.lat];
  } else {
    const window = cityWindowView(input.widthPx, input.heightPx);
    view.zoom = window.zoom;
    view.center = window.center;
  }
  return view;
}

export interface PairedInput {
  stop: ScreenStop | null;
  selection: PublicSelection | null;
}

/** The paired compositions' camera, today's Promet contract (R-KP8): street
 *  zoom on the stop, the stop selected, the phone's route selected and
 *  followed, or the phone's stop selected instead of the screen's. */
export function pairedView(input: PairedInput): KioskView {
  const view: KioskView = { zoom: PAIRED_ZOOM, emphasis: KIOSK_EMPHASIS, outline: true };
  if (input.stop) {
    view.center = [input.stop.lon, input.stop.lat];
    view.selectedStop = input.stop.id;
  }
  if (input.selection?.kind === 'route') {
    view.selectedRoute = input.selection.id;
    delete view.selectedStop;
    delete view.center;
  } else if (input.selection?.kind === 'stop') {
    view.selectedStop = input.selection.id;
    delete view.center;
  }
  return view;
}

/** R-KP17's collision padding around a major street name on the wall's
 *  field, in tile pixels: a hand-copy of map/basemap.ts
 *  PROZOR_LABEL_PADDING_PX (this module stays off the basemap's graph;
 *  test/app/basemap.test.ts pins the two equal). */
export const LABEL_PADDING_TILE_PX = 24;
/** The ground the 1920 x 1080 wall's field shows, in square metres:
 *  FIELD_SPAN_M across and, north to south, that times the design field's
 *  height over its width (2.8 x 1.8 km) -- where R-KP17's padding was
 *  measured. */
const WALL_FIELD_GROUND_M2 = FIELD_SPAN_M * FIELD_SPAN_M * (FIELD_DESIGN_HEIGHT.wide / FIELD_DESIGN_WIDTH.wide);

/** The street names' collision padding for a field of widthPx x heightPx
 *  showing spanM across (ProzorOptions.labelPadding, contract 3): R-KP17's
 *  24 on the wall's field and, on a field that shows more ground than the
 *  wall's, 24 times that ratio -- doubled on the totem, whose field holds
 *  twice the wall's ground north to south -- in whole tile pixels, never
 *  below 24. The count of names a field places is the padding's to hold, not
 *  the spacing's: MapLibre anchors every road once per tile whatever
 *  symbol-spacing says (360, 473, 745 and 1100 all placed 7 to 8 names on the
 *  totem before the plates took their anchors, 16 Sept 2026), while 48
 *  placed 3 against the wall's 6 to 8 at 24 -- under the e2e's cap of eight
 *  with room, where 24 had left none on the totem (9 placed once). A box not
 *  yet laid out (0) and a phone's half-span band keep the ruling's own. */
export function labelPadding(widthPx: number, heightPx: number, spanM: number): number {
  const groundM2 = spanM * spanM * (heightPx / widthPx);
  const overWall = Number.isFinite(groundM2) ? groundM2 / WALL_FIELD_GROUND_M2 : 1;
  return Math.round(LABEL_PADDING_TILE_PX * Math.max(1, overWall));
}

/** The prozor overlay set for this screen (contract 2). The overlap zoom is
 *  the FIELD's derived zoom less a tenth in both phases: the paired camera
 *  (z15) is always above it, so the noses and the unconditional pills the
 *  invitation gets, the paired views keep; the street names' padding is the
 *  field's too (labelPadding). Which networks are drawn is the CAMERA's
 *  question, not the stop's: on the whole-city window the trams alone, from
 *  CITY_DETAIL_ZOOM the buses with them. The map is created once with the
 *  first request's set and hears every later one through setProzor (R-KP19),
 *  so the stop's routes, the measured field's threshold, its padding and the
 *  camera's own band reach the picture without a second map. */
export function prozorOptions(stop: ScreenStop | null, fieldZoomNow: number, labelPaddingPx: number, buses: boolean): ProzorOptions {
  return { networkKinds: buses ? ['tram', 'bus'] : ['tram'], stopRoutes: stop?.routes ?? null, stopLabelMinRank: STOP_LABEL_MIN_RANK, stopRadius: true, overlapZoom: fieldZoomNow - OVERLAP_ZOOM_MARGIN, labelPadding: labelPaddingPx };
}

export interface KioskMapInput {
  city?:CityState;
  localSelection?:MapSelection|null;
  localGroup?:CityGroup;
  localCategory?:string;
  localQuery?:string;
  onSelect?:(selection:MapSelection|null)=>void;
  exploring?:boolean;
  resolveStreet?:(name:string,point:{lon:number;lat:number})=>string|null;
  stop: ScreenStop | null;
  /** The configured area: a gradska cetvrt's slug, or null for the whole city. */
  district?: string | null;
  /** The whole teaser, not only the two transport modules: the map draws the
   *  city's own points too (cityPoints). */
  snapshots: FeedSnapshots;
  now: number;
  /** The phone's relayed selection; read in the paired phase only. */
  selection: PublicSelection | null;
  /** Which composition shows the map: the invitation's fixed window or a paired composition (R-KP8). */
  phase: 'invitation' | 'paired';
  /** The field's box and ground span: the derived zoom (fieldView), the overlap threshold and the street names' padding (prozorOptions, labelPadding). */
  widthPx: number;
  heightPx: number;
  spanM: number;
  ariaLabel: string;
  reducedMotion?: boolean;
  /** The live map's own zoom, as its camera last reported it (kiosk.ts
   *  subscribes through CityMapOptions.onCamera); absent before it has
   *  reported one, when the camera this render asks for is the answer. */
  cameraZoom?: number;
  /** Told every settled zoom, so the screen can re-ask for its map when the
   *  camera crosses CITY_DETAIL_ZOOM. Read once, at creation. */
  onCamera?: CityMapOptions['onCamera'];
  /** Injected in tests; the page's own fetch otherwise. */
  fetchImpl?: typeof fetch;
  locale?: string;
  /** Fixed for the screen's boot, including paired sessions. */
  renderer?: CityMapOptions['renderer'];
  target?: PresentationTarget;
  stops?: readonly ScreenStop[];
}

/** Builds the request for this render and asks the slots for the one map.
 *  Null when the page has no map factory (lightweight, or a browser with
 *  no WebGL), in which case the composition shows its list instead. */
export function requestKioskMap(maps: MapSlots, input: KioskMapInput, adapter?: KioskMapAdapter): HTMLElement | null {
  // A city place cannot be located on the transit diagram. Preserve an
  // explicitly configured diagram for transport, use geography for city subjects.
  if(input.renderer==='schema'&&(
    input.selection?.kind==='place'||input.selection?.kind==='street'||
    input.localSelection?.kind==='place'||input.localSelection?.kind==='street'||
    (input.exploring&&input.localGroup!=='transport')
  ))input={...input,renderer:'map'};
  let points = vehiclePoints(input.snapshots['zet-rt'], input.now);
  const route = input.selection?.kind === 'route' ? input.selection.id : null;
  // A relayed route is the one line the phone asked about, and the picture
  // narrows to it. Nothing else narrows: the invitation is the city live, and
  // a window that carried only the screen's own lines was a window onto four
  // trams in a city of two hundred.
  if (route) points = points.filter(point => point.routeId === route);
  if (input.stop) points.push({...stopPlace(input.stop),...(input.city?{title:''}:{})});
  const field = fieldView({ stop: input.stop, district: input.district ?? null, widthPx: input.widthPx, heightPx: input.heightPx, spanM: input.spanM });
  /** The whole-city window's own rules -- no names on the city's places, every
   *  BAJS station and every active venue as a badge, the pharmacy's street
   *  address dropped -- belong to the INVITATION nobody has touched. A person
   *  exploring has asked a question and gets discover()'s named answer, and a
   *  paired presentation is a phone putting ONE subject on the wall, which
   *  must be named there: both keep the names and the points they always had. */
  const cityWindow = input.phase === 'invitation' && !input.exploring;
  /** The frame is a neighbourhood, not the whole city: the details that only
   *  make sense close up (the pharmacy's street address) are worth their room. */
  const closeUp = !cityWindow || field.zoom >= CITY_DETAIL_ZOOM;
  points.push(...cityPoints(input.snapshots, input.stop, input.now, input.locale ?? 'hr', closeUp));
  if(input.city){
    if(cityWindow)points.push(...cityWindowPoints(input.city,input.snapshots.dogadanja?.items??[],input.now));
    else{
      const result=discover(input.city,input.snapshots.dogadanja?.items??[],{group:input.localGroup??'living',category:input.localCategory??'',window:'week',query:input.localQuery??'',
        center:input.stop??{lon:15.97726,lat:45.81286},radius:5000,now:input.now});
      points.push(...result.points);
    }
    const pick=input.selection?.kind==='place'?input.selection:input.localSelection?.kind==='place'?input.localSelection:null;
    const p=pick?[...input.city.places,...dynamicPlaces(input.city,input.now)].find(p=>p.id===pick.id):null;
    if(p&&p.lon!==undefined&&p.lat!==undefined&&!points.some(x=>x.id===p.id))points.push({id:p.id,title:p.name,lon:p.lon,lat:p.lat,place:'city',props:{category:p.category,badge:'',eventCount:0,priority:0}});
  }
  const view = input.phase === 'paired' ? pairedView({ stop: input.stop, selection: input.selection }) : field;
  if(input.selection?.kind==='place'||input.localSelection?.kind==='place'){
    const pick=input.selection?.kind==='place'?input.selection:input.localSelection!;
    const p=points.find(p=>p.id===pick.id);
    if(p){view.center=[p.lon,p.lat];view.zoom=15;view.selection={kind:'place',id:p.id};delete view.selectedStop;}
  }
  const selectedStop = input.selection?.kind === 'stop' ? input.stops?.find(stop => stop.id === input.selection!.id) : null;
  if (selectedStop) {
    view.center = [selectedStop.lon, selectedStop.lat];
    view.zoom = fieldZoom(input.widthPx, selectedStop.lat, 1200);
  }
  if (input.selection?.kind === 'item') {
    const pick = input.selection;
    const item = input.snapshots[pick.module]?.items.find(item => publicItemKey(pick.module, item.id) === pick.id);
    if (item?.geo) {
      const coordinates = item.geo.type === 'Point' ? [item.geo.coordinates as number[]] : item.geo.coordinates as number[][];
      const lons = coordinates.map(p => p[0]!), lats = coordinates.map(p => p[1]!);
      const lon = (Math.min(...lons) + Math.max(...lons)) / 2, lat = (Math.min(...lats) + Math.max(...lats)) / 2;
      view.center = [lon, lat];
      const span = Math.max(800, (Math.max(...lons) - Math.min(...lons)) * 78000, (Math.max(...lats) - Math.min(...lats)) * 111000 * input.widthPx / Math.max(1, input.heightPx));
      view.zoom = fieldZoom(input.widthPx, lat, span * 1.3);
      view.selection = item.kind === 'vehicle' ? { kind: 'vehicle', id: item.id } : item.kind === 'closure' ? { kind: 'closure', id: item.id } : null;
    }
  }
  // The quarter is what the screen was CONFIGURED for, never where its stop
  // happens to fall: a screen on a stop draws no outline, and no camera is
  // ever framed by a district nobody chose.
  const district = districtBySlug(input.district)?.slug ?? null;
  const selection=input.selection?.kind==='place'?input.selection:input.localSelection;
  const selectedPlace=selection?.kind==='place'?input.city?.places.find(p=>p.id===selection.id):null;
  mapDistrict.set(maps,selectedPlace?.polygons?selectedPlace.id:district??'');
  const outline = selectedPlace?.polygons?{id:selectedPlace.id,polygons:selectedPlace.polygons}:kvartOutline(district);
  // A configured quarter frames its own rings once they land; until then
  // fieldView's seat camera holds the frame.
  if (input.phase !== 'paired' && !input.stop && district && outline?.id === district) {
    const fit = outlineView(outline, input.widthPx, input.heightPx);
    view.center = fit.center;
    view.zoom = fit.zoom;
  }
  const buses = busesVisible(input.cameraZoom ?? view.zoom);
  const extras: KioskMapExtras = {
    renderer: input.renderer ?? 'map',
    stop: input.stop,
    interactive: Boolean(input.onSelect),
    symbolScale: KIOSK_SYMBOL_SCALE,
    basemapProfile: KIOSK_BASEMAP_PROFILE,
    locale: input.locale,
    outline: input.renderer !== 'schema' ? outline : null,
    // The names of the city's own places are a reader's, not a passer-by's:
    // off on the window, on the moment somebody explores and on every paired
    // presentation, whose one subject has to be named on the wall.
    cityLabels: !cityWindow,
    prozor: prozorOptions(route ? { ...input.stop, routes: [route] } as ScreenStop : selectedStop ?? input.stop, field.zoom, labelPadding(input.widthPx, input.heightPx, input.spanM), buses),
  };
  // The invitation IS the transit picture: the network, the stops and the
  // vehicles are always on it. Only a paired presentation of something that
  // is not transport -- a place or a street a phone put on the screen --
  // still clears them, so the one subject it is about stands alone.
  const transit=input.phase==='invitation'||input.renderer==='schema'||!input.city||(input.target?.layer==='u-pokretu'&&input.selection?.kind!=='place'&&input.selection?.kind!=='street');
  if(!transit)extras.prozor={...extras.prozor!,networkKinds:[],stopRoutes:[]};
  const request: KioskMapRequest = {
    id: KIOSK_MAP_SLOT_ID,
    className: 'k-map-canvas',
    testid: 'kiosk-map',
    ariaLabel: input.ariaLabel,
    points,
    lines: closureLines(input.snapshots.prometnice),
    reducedMotion: input.reducedMotion,
    onSelect:input.onSelect,
    onCamera:input.onCamera,
    resolveStreet:input.resolveStreet,
    ...extras,
    zoom: view.zoom,
    emphasis: route ? [] : view.emphasis,
  };
  if (view.center) request.center = view.center;
  if (view.selectedStop) request.selectedStop = view.selectedStop;
  if (view.selection) request.selection = view.selection;
  if (view.selectedRoute) request.selectedRoute = view.selectedRoute;
  if (view.follow) request.follow = true;
  // The view is set before the slot call so a map created by it starts there.
  adapter?.setExtras(extras);
  if(!input.exploring)adapter?.setView(viewOf(request));
  const container = maps.slot(request);
  // An outage is no evidence of motion: the map holds until the feed is live again.
  adapter?.setFeedState(feedStateOf(input.snapshots['zet-rt']));
  // The geographic field draws the quarter (R-KP9); the schema has no outline.
  adapter?.handle()?.setOutline?.(request.outline ?? null);
  // The overlay set follows the request on the one live map (R-KP19): a stop
  // change (the DO's applyScreen) moves the drawn stops to the new stop's
  // routes and a re-measured field moves the overlap threshold, where the
  // creation-time options alone would leave stale dots for the screen's life.
  adapter?.handle()?.setProzor?.(extras.prozor ?? null);
  // Trams alone on the whole city, both modes once the camera is in a
  // neighbourhood; nothing at all where the picture is not about transit.
  adapter?.handle()?.setModes?.(transit?(buses?null:new Set([ROUTE_TYPE_TRAM])):new Set());
  adapter?.handle()?.setCityLabels?.(extras.cityLabels ?? true);
  // A container means the page gave map-slots a factory, which lagano never
  // does: the outline is fetched only where there is a map to draw it on.
  if (container && input.renderer !== 'schema' && district && !request.outline) {
    void loadKvartOutline(district, input.fetchImpl).then((outline) => {
      if (outline && mapDistrict.get(maps) === district) adapter?.handle()?.setOutline?.(outline);
    });
  }
  return container;
}
