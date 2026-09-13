// What the screen knows about its own corner of the city, derived from the
// open-tier teaser (stop-scoped: the vehicle pins near the stop, every
// route's delay row, the observation, the open city rows, the headlines)
// and the screen's stop. Pure functions over ModuleSnapshot[]: no fetch, no
// DOM, no clock of their own. Every function distinguishes "no snapshot
// yet" (loading), "the source is down" (unknown) and "the source answered
// and there is nothing" (a true empty), because a public screen that prints
// zero for an outage is lying (PRODUCT.md, principle 4).
import type { FeedItem, ModuleId, ModuleSnapshot } from '../../../worker/feed/schema';
import { LJEKARNE } from '../../../worker/hitno/ljekarne';
import { fillAttribution } from '../attribution';
import type { ScreenStop } from '../core/contracts';
import type { I18n } from '../i18n/i18n';
import { summariseRoutes, type RouteSummaryRow, type RouteVehicle } from '../layers/route-summary';
import { dist, toPlane } from '../motion/geo';
import { dataNumber, dataText } from '../panels/panel';
import { sunTimes } from '../ui/solar';
import { clock, dayTime, fmtNumber, fmtTemp, weekdayDayMonth } from './format';
import { routeLongName, routeType, sortRouteIds, stopDistanceM } from './stops';
import { fill, plural, type KioskStrings } from './strings';

export type SourceState = 'loading' | 'live' | 'stale' | 'down';

export function byModule(modules: readonly ModuleSnapshot[]): Partial<Record<ModuleId, ModuleSnapshot>> {
  const out: Partial<Record<ModuleId, ModuleSnapshot>> = {};
  for (const snapshot of modules) out[snapshot.module] = snapshot;
  return out;
}

export function sourceState(snapshot: ModuleSnapshot | undefined): SourceState {
  if (!snapshot) return 'loading';
  return snapshot.status;
}

/** Answering means a snapshot exists and its source is not down. */
export function isLive(snapshot: ModuleSnapshot | undefined): snapshot is ModuleSnapshot {
  return snapshot !== undefined && snapshot.status !== 'down';
}

// --- Weather ----------------------------------------------------------------

export interface WeatherNow {
  state: SourceState;
  /** '12,8 °C' or null when the observation has no reading. */
  temperature: string | null;
  condition: string;
  station: string;
  details: string[];
  observedAt: string;
  /** The observation's own time, for a freshness check by the caller. */
  observedMs: number | null;
  attribution: string;
}

export function weatherNow(modules: readonly ModuleSnapshot[], strings: KioskStrings, locale: string): WeatherNow {
  const snapshot = byModule(modules)['dhmz-now'];
  const observation = snapshot?.items.find((item) => item.kind === 'observation') ?? snapshot?.items[0];
  const state = sourceState(snapshot);
  if (!snapshot || !observation) {
    return { state, temperature: null, condition: '', station: '', details: [], observedAt: '', observedMs: null, attribution: snapshot?.attribution.text ?? '' };
  }
  const temp = dataNumber(observation, 'temp');
  const humidity = dataNumber(observation, 'humidity');
  const pressure = dataNumber(observation, 'pressure');
  const windSpeed = dataNumber(observation, 'windSpeed');
  const windDir = dataText(observation, 'windDir');
  const details: string[] = [];
  if (humidity !== null) details.push(fill(strings.weather.humidity, { value: fmtNumber(locale, humidity, 0) }));
  if (windSpeed !== null) {
    details.push(windSpeed < 0.3 || !windDir ? strings.weather.windCalm : fill(strings.weather.wind, { dir: windDir, speed: fmtNumber(locale, windSpeed, 1) }));
  }
  if (pressure !== null) details.push(fill(strings.weather.pressure, { value: fmtNumber(locale, pressure, 0) }));
  const observedMs = observation.at ? Date.parse(observation.at) : NaN;
  return {
    state,
    temperature: temp === null ? null : fmtTemp(locale, temp),
    // DHMZ prints "-" for "no phenomenon"; that is nothing to say, not a word.
    condition: dataText(observation, 'weather').replace(/^[-–—]+$/, ''),
    station: observation.title,
    details,
    observedAt: Number.isFinite(observedMs) ? fill(strings.weather.observed, { time: clock(observedMs) }) : '',
    observedMs: Number.isFinite(observedMs) ? observedMs : null,
    attribution: fillAttribution(snapshot.attribution, snapshot, observation),
  };
}

export interface SunToday {
  sunrise: string;
  sunset: string;
  /** Whole minutes of daylight. */
  daylightMinutes: number;
  /** 0 before sunrise, 1 after sunset, the sun's fraction of the day between. */
  progress: number;
  isDay: boolean;
}

/** Computed, never fetched: the standard sunrise equation for Zagreb. */
export function sunToday(now: number, at: { lat: number; lon: number } = { lat: 45.815, lon: 15.98 }): SunToday {
  const times = sunTimes(new Date(now), at.lat, at.lon);
  const rise = times.sunrise.getTime();
  const set = times.sunset.getTime();
  const span = Math.max(1, set - rise);
  return {
    sunrise: clock(rise),
    sunset: clock(set),
    daylightMinutes: Math.round(span / 60_000),
    progress: Math.min(1, Math.max(0, (now - rise) / span)),
    isDay: now >= rise && now < set,
  };
}

export function sunLine(sun: SunToday, strings: KioskStrings): string {
  const hours = Math.floor(sun.daylightMinutes / 60);
  const minutes = sun.daylightMinutes % 60;
  return `${fill(strings.weather.sunrise, { time: sun.sunrise })} · ${fill(strings.weather.sunset, { time: sun.sunset })} · ${fill(strings.weather.daylight, { hours, minutes })}`;
}

// --- Lines ------------------------------------------------------------------

/** A route median beyond this is a stale trip update, not a delay a rider can
 *  use (night-time feeds carry six-hour figures); it reads as unknown. */
export const PLAUSIBLE_DELAY_S = 90 * 60;

export function plausibleDelay(seconds: number | null | undefined): seconds is number {
  return typeof seconds === 'number' && Number.isFinite(seconds) && Math.abs(seconds) <= PLAUSIBLE_DELAY_S;
}

/** routeId -> median delay seconds from the 'route:' rows; absent means unknown. */
export function routeDelays(zet: ModuleSnapshot | undefined): Map<string, number> {
  const out = new Map<string, number>();
  for (const item of zet?.items ?? []) {
    if (!item.id.startsWith('route:')) continue;
    const routeId = dataText(item, 'routeId');
    const delay = dataNumber(item, 'medianDelaySeconds');
    if (routeId && plausibleDelay(delay)) out.set(routeId, delay);
  }
  return out;
}

/** The vehicle pins the teaser carries (those inside the screen's box). */
export function nearbyVehicles(zet: ModuleSnapshot | undefined): RouteVehicle[] {
  const out: RouteVehicle[] = [];
  for (const item of zet?.items ?? []) {
    if (!item.id.startsWith('vehicle:')) continue;
    const routeId = dataText(item, 'routeId');
    if (!routeId) continue;
    out.push({ routeId, label: dataText(item, 'routeShortName') || routeId, type: dataNumber(item, 'routeType') ?? routeType(routeId) ?? -1 });
  }
  return out;
}

/** One row per route among the pins near the stop, trams first, in words. */
export function linesNearby(modules: readonly ModuleSnapshot[], i18n: I18n): RouteSummaryRow[] {
  const zet = byModule(modules)['zet-rt'];
  return summariseRoutes(nearbyVehicles(zet), routeDelays(zet), i18n);
}

export interface LineRow {
  routeId: string;
  label: string;
  longName: string;
  kind: 'tram' | 'bus' | 'other';
  /** delayWord() output, or '' when the feed has no delay row for the route. */
  word: string;
  nearby: number;
}

export interface LinesBoard {
  state: SourceState;
  rows: LineRow[];
  /** Routes at the stop beyond `cap`, named in a "još N linija" line. */
  more: number;
  /** Whole-fleet count the teaser states, null before the first poll. */
  moving: number | null;
  attribution: string;
}

function kindOf(type: number | null): LineRow['kind'] {
  return type === 0 ? 'tram' : type === 3 ? 'bus' : 'other';
}

/**
 * The routes serving the screen's stop, each with its live delay in words
 * and how many of its vehicles are near the stop right now. Without a stop
 * the board falls back to the routes seen nearby.
 */
export function linesAtStop(modules: readonly ModuleSnapshot[], stop: ScreenStop | null, i18n: I18n, cap = 6): LinesBoard {
  const zet = byModule(modules)['zet-rt'];
  const state = sourceState(zet);
  const delays = routeDelays(zet);
  const vehicles = nearbyVehicles(zet);
  const counts = new Map<string, number>();
  for (const v of vehicles) counts.set(v.routeId, (counts.get(v.routeId) ?? 0) + 1);
  const ids = stop ? sortRouteIds(stop.routes) : summariseRoutes(vehicles, delays, i18n).map((r) => r.routeId);
  const rows: LineRow[] = ids.map((routeId) => {
    const delay = delays.get(routeId);
    return {
      routeId,
      label: routeId,
      longName: routeLongName(routeId),
      kind: kindOf(routeType(routeId)),
      word: delay === undefined ? '' : summariseRoutes([{ routeId, label: routeId, type: 0 }], delays, i18n)[0]!.word,
      nearby: counts.get(routeId) ?? 0,
    };
  });
  const moving = zet?.items.find((item) => item.id === 'vozila');
  return {
    state,
    rows: rows.slice(0, cap),
    more: Math.max(0, rows.length - cap),
    moving: moving ? dataNumber(moving, 'vehicles') : null,
    attribution: zet?.attribution.text ?? '',
  };
}

// --- Closures and pharmacies ----------------------------------------------

export interface NearestClosure { title: string; distanceM: number | null; item: FeedItem }
export interface ClosuresNear {
  state: SourceState;
  count: number;
  /** Closures within 1.5 km of the stop; equals `count` without a stop. */
  nearbyCount: number;
  nearest: NearestClosure | null;
}

export const NEARBY_CLOSURE_M = 1500;

function closureDistance(item: FeedItem, stop: ScreenStop): number | null {
  if (!item.geo) return null;
  const origin = toPlane(stop.lon, stop.lat);
  const coords = item.geo.type === 'Point' ? [item.geo.coordinates as number[]] : (item.geo.coordinates as number[][]);
  let best: number | null = null;
  for (const [lon, lat] of coords) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const d = dist(toPlane(lon!, lat!), origin);
    if (best === null || d < best) best = d;
  }
  return best;
}

export function closuresNear(modules: readonly ModuleSnapshot[], stop: ScreenStop | null): ClosuresNear {
  return summariseClosures(closuresByDistance(byModule(modules).prometnice, stop), sourceState(byModule(modules).prometnice), stop);
}

export interface ClosureAtDistance { item: FeedItem; distanceM: number | null }

/** Every closure with its distance from the stop, nearest first (unknown
 *  distances last, in feed order). */
export function closuresByDistance(snap: ModuleSnapshot | undefined, stop: ScreenStop | null): ClosureAtDistance[] {
  const items = isLive(snap) ? snap.items.filter((item) => item.kind === 'closure') : [];
  const out = items.map((item) => ({ item, distanceM: stop ? closureDistance(item, stop) : null }));
  if (stop) out.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
  return out;
}

function summariseClosures(sorted: ClosureAtDistance[], state: SourceState, stop: ScreenStop | null): ClosuresNear {
  const first = sorted[0];
  return {
    state,
    count: sorted.length,
    nearbyCount: stop ? sorted.filter((c) => c.distanceM !== null && c.distanceM <= NEARBY_CLOSURE_M).length : sorted.length,
    nearest: first ? { title: first.item.title, distanceM: first.distanceM, item: first.item } : null,
  };
}

/** Approximate geocodes of the curated on-duty addresses (worker/hitno/ljekarne.ts),
 *  used only to order the list by distance from the screen's stop; the
 *  distance itself is never printed. */
const PHARMACY_POINTS: Readonly<Record<string, { lon: number; lat: number }>> = {
  'Trg bana J. Jelačića 3': { lon: 15.9776, lat: 45.8131 },
  'Ilica 291': { lon: 15.934, lat: 45.811 },
  'Ozaljska 1': { lon: 15.956, lat: 45.8025 },
  'Grižanska 4': { lon: 16.058, lat: 45.8235 },
  'Av. V. Holjevca 22': { lon: 15.977, lat: 45.783 },
  'Ljekarna ZEUS': { lon: 16.0275, lat: 45.8145 },
};

export interface OnDutyPharmacy { label: string; address: string; hours: string; phoneDisplay: string | null; distanceM: number | null }

export function pharmaciesByDistance(stop: ScreenStop | null): OnDutyPharmacy[] {
  return LJEKARNE.map((p) => {
    const point = PHARMACY_POINTS[p.label];
    return { label: p.label, address: p.address, hours: p.hours, phoneDisplay: p.phoneDisplay, distanceM: stop && point ? stopDistanceM(point, stop) : null };
  }).sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
}

export function nearestPharmacy(stop: ScreenStop | null): OnDutyPharmacy {
  return pharmaciesByDistance(stop)[0]!;
}

// --- Safety strip ---------------------------------------------------------

export interface SafetyStrip {
  /** 'stale': the source is not answering and the last good copy is shown, marked as such. */
  warning: { state: 'loading' | 'unknown' | 'none' | 'stale' | 'active'; text: string; severity: string | null };
  closures: { state: SourceState; text: string; nearestText: string };
  pharmacy: OnDutyPharmacy;
}

export function safetyStrip(modules: readonly ModuleSnapshot[], stop: ScreenStop | null, i18n: I18n, strings: KioskStrings): SafetyStrip {
  const cap = byModule(modules)['dhmz-cap'];
  const first = cap?.items[0];
  const stale = (text: string, snapshot: ModuleSnapshot | undefined): string => (snapshot?.status === 'stale' ? `${text} · ${strings.paired.stale}` : text);
  let warning: SafetyStrip['warning'];
  if (!cap) warning = { state: 'loading', text: strings.safety.warningsLoading, severity: null };
  else if (cap.status === 'down') warning = { state: 'unknown', text: strings.safety.warningsUnknown, severity: null };
  else if (first) warning = { state: 'active', text: stale(`${i18n.t(`panels.severity.${first.severity ?? 'info'}`)} · ${first.title}`, cap), severity: first.severity ?? 'info' };
  // Only a live, successful, empty answer establishes "no warnings"; a stale empty copy is unconfirmed.
  else if (cap.status === 'stale') warning = { state: 'stale', text: strings.safety.warningsStale, severity: null };
  else warning = { state: 'none', text: strings.safety.warningsNone, severity: null };
  const near = closuresNear(modules, stop);
  const text = near.state === 'loading' ? i18n.t('status.loading')
    : near.state === 'down' ? strings.safety.closuresUnknown
      : near.state === 'stale' && near.count === 0 ? strings.safety.closuresStale
        : stale(i18n.t('panels.closuresCount', { count: near.count }), byModule(modules).prometnice);
  const nearestText = near.nearest && near.state !== 'down' ? fill(strings.safety.closuresNearest, { street: near.nearest.title }) : '';
  return { warning, closures: { state: near.state, text, nearestText }, pharmacy: nearestPharmacy(stop) };
}

// --- The bounded secondary story ------------------------------------------

export interface Story {
  id: string;
  kicker: string;
  title: string;
  /** The item's own date in words, '' when the source states none. */
  meta: string;
  /** Short source name for the card; `attribution` is the full filled line. */
  source: string;
  attribution: string;
  tone: 'city' | 'news' | 'quake';
}

const CITY_KICKER: Record<string, keyof KioskStrings['story']> = { skupstina: 'assembly', 'zet-promet': 'zet', 'zet-rss': 'zet', kvartovske: 'neighbourhood', komunalne: 'works' };
const CITY_SOURCE: Record<string, string> = {
  skupstina: 'Skupština Grada Zagreba',
  'zet-promet': 'ZET',
  'zet-rss': 'ZET',
  kvartovske: 'Grad Zagreb, kvartovske novosti',
  komunalne: 'Grad Zagreb, plan komunalnih aktivnosti',
};

/** The kicker word for a city row's source: "Gradska skupština", "ZET obavijest"... */
export function cityKicker(source: string, strings: KioskStrings): string {
  return strings.story[CITY_KICKER[source] ?? 'city'];
}

/** An item's date in words, by what the date means (FeedItem.dateBasis).
 *  Kvartovske rows without a stated basis are undated notices, never today. */
export function cityDateLine(item: FeedItem, strings: KioskStrings, locale: string): string {
  const source = dataText(item, 'source');
  const basis = item.dateBasis;
  if (!item.at || basis === 'unknown' || (basis === undefined && source === 'kvartovske')) return '';
  const ms = Date.parse(item.at);
  if (!Number.isFinite(ms)) return '';
  if (basis === 'updated' || source === 'komunalne') return fill(strings.story.changed, { date: weekdayDayMonth(locale, ms) });
  if (basis === 'published' || source === 'zet-promet' || source === 'zet-rss') return fill(strings.story.published, { time: dayTime(ms) });
  return dataText(item, 'precision') === 'day' ? weekdayDayMonth(locale, ms) : `${weekdayDayMonth(locale, ms)} ${clock(ms)}`;
}

export const STORY_CAP = 8;

/** City notices, headlines and the latest quake, interleaved so the
 *  rotation never shows three of one kind in a row; at most STORY_CAP. */
export function stories(modules: readonly ModuleSnapshot[], strings: KioskStrings, locale: string, now: number): Story[] {
  const map = byModule(modules);
  const dogadanja = map.dogadanja;
  const city: Story[] = (isLive(dogadanja) ? dogadanja.items : []).slice(0, 4).map((item) => {
    const source = dataText(item, 'source');
    return {
      id: `city:${item.id}`,
      kicker: cityKicker(source, strings),
      title: item.title,
      meta: cityDateLine(item, strings, locale),
      source: CITY_SOURCE[source] ?? 'Grad Zagreb',
      attribution: fillAttribution(dogadanja!.attribution, dogadanja!, item),
      tone: 'city' as const,
    };
  });
  const hrt = map['hrt-news'];
  const news: Story[] = (isLive(hrt) ? hrt.items : []).slice(0, 3).map((item) => ({
    id: `news:${item.id}`,
    kicker: strings.story.news,
    title: item.title,
    meta: item.at ? fill(strings.story.published, { time: dayTime(item.at) }) : '',
    source: 'HRT',
    attribution: fillAttribution(hrt!.attribution, hrt!, item),
    tone: 'news' as const,
  }));
  const emsc = map.emsc;
  const quake = isLive(emsc) ? emsc.items.find((q) => q.at !== undefined && now - Date.parse(q.at) <= 7 * 86_400_000) : undefined;
  const quakes: Story[] = quake
    ? [{
        id: `quake:${quake.id}`,
        kicker: strings.story.quake,
        title: fill(strings.story.quakeBody, { mag: fmtNumber(locale, dataNumber(quake, 'mag') ?? 0, 1), region: dataText(quake, 'region') || quake.title, depth: fmtNumber(locale, dataNumber(quake, 'depth') ?? 0, 1) }),
        meta: dayTime(quake.at),
        source: 'EMSC',
        attribution: fillAttribution(emsc!.attribution, emsc!, quake),
        tone: 'quake' as const,
      }]
    : [];
  const out: Story[] = [];
  const queues = [city, news, quakes];
  let added = true;
  while (added && out.length < STORY_CAP) {
    added = false;
    for (const queue of queues) {
      const story = queue.shift();
      if (story && out.length < STORY_CAP) { out.push(story); added = true; }
    }
  }
  return out;
}

/** Nearby-lines count in words for a board caption; null before data. */
export function nearbyCountLine(board: LinesBoard, strings: KioskStrings, locale: string): string {
  return board.moving === null ? '' : plural(locale, strings.lines.vehiclesMoving, board.moving);
}
