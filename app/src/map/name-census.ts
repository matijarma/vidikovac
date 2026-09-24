// The wall's name census and its hysteresis (WP2-A2, decisions 17 and 19),
// the marker census, and the render census that reads them all back off a
// drawn map: without MapLibre, in the MapLibre chunk (maplibre-entry.ts).
// Only a drawn map ever runs them, so a lightweight screen never loads them;
// city-map.ts reaches them through the loaded module, as it does the layers.
// Everything but createRenderCensus is pure.
import { capsuleHalfPx } from '../motion/pills';
import type { StyleLayerLike } from './basemap';

// --- Names the collision pass held back (data-hidden-names) ----------------
//
// queryRenderedFeatures answers the names MapLibre placed; which names the
// style WOULD draw is the name layers' own filter, text and zoom range over
// the features their sources were handed. The census asks the second through
// a small evaluator of the expression operators those layers use (overlays.ts,
// city-layers.ts) rather than a copy of their rules, so a filter changed there
// is the filter counted here; an operator outside the set leaves that layer
// out of the count instead of guessing.

/** What evaluateExpression answers for an operator it does not know. */
export const UNKNOWN_EXPRESSION: unique symbol = Symbol('unknown expression');
class UnknownOperator extends Error {}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || (a === null && b === undefined) || (a === undefined && b === null);
}

/**
 * A MapLibre expression over one feature's `properties` at `zoom`, for the
 * operators the name layers' filters and text fields use: literal, get, has,
 * zoom, !, all, any, ==, !=, <, <=, >, >=, in, case, match, step, coalesce
 * and the four arithmetic ones. Anything else is UNKNOWN_EXPRESSION.
 */
export function evaluateExpression(expr: unknown, properties: Readonly<Record<string, unknown>>, zoom: number): unknown {
  const ev = (e: unknown): unknown => {
    if (!Array.isArray(e)) return e ?? null;
    const [op, ...args] = e as [unknown, ...unknown[]];
    const num = (x: unknown): number => Number(ev(x));
    switch (op) {
      case 'literal': return args[0];
      case 'get': return typeof args[0] === 'string' && args.length === 1 ? (properties[args[0]] ?? null) : (() => { throw new UnknownOperator('get'); })();
      case 'has': return typeof args[0] === 'string' && properties[args[0]] !== undefined && properties[args[0]] !== null;
      case 'zoom': return zoom;
      case '!': return ev(args[0]) !== true;
      case 'all': return args.every((a) => ev(a) === true);
      case 'any': return args.some((a) => ev(a) === true);
      case '==': return sameValue(ev(args[0]), ev(args[1]));
      case '!=': return !sameValue(ev(args[0]), ev(args[1]));
      case '<': return num(args[0]) < num(args[1]);
      case '<=': return num(args[0]) <= num(args[1]);
      case '>': return num(args[0]) > num(args[1]);
      case '>=': return num(args[0]) >= num(args[1]);
      case '+': return args.reduce<number>((sum, a) => sum + num(a), 0);
      case '*': return args.reduce<number>((product, a) => product * num(a), 1);
      case '-': return args.length === 1 ? -num(args[0]) : num(args[0]) - num(args[1]);
      case '/': return num(args[0]) / num(args[1]);
      case 'in': {
        const needle = ev(args[0]);
        const haystack = ev(args[1]);
        if (Array.isArray(haystack)) return haystack.some((x) => sameValue(x, needle));
        return typeof haystack === 'string' && needle !== null && haystack.includes(String(needle));
      }
      case 'case':
        for (let i = 0; i + 1 < args.length; i += 2) if (ev(args[i]) === true) return ev(args[i + 1]);
        return ev(args[args.length - 1]);
      case 'match': {
        const value = ev(args[0]);
        for (let i = 1; i + 1 < args.length; i += 2) {
          const label = args[i];
          if (Array.isArray(label) ? label.some((x) => sameValue(x, value)) : sameValue(label, value)) return ev(args[i + 1]);
        }
        return ev(args[args.length - 1]);
      }
      case 'step': {
        const input = num(args[0]);
        let out = args[1];
        for (let i = 2; i + 1 < args.length; i += 2) {
          if (input >= Number(args[i])) out = args[i + 1];
          else break;
        }
        return ev(out);
      }
      case 'coalesce':
        for (const a of args) {
          const v = ev(a);
          if (v !== null) return v;
        }
        return null;
      default: throw new UnknownOperator(String(op));
    }
  };
  try {
    return ev(expr);
  } catch (error) {
    if (error instanceof UnknownOperator) return UNKNOWN_EXPRESSION;
    throw error;
  }
}

/** One point feature as a source was handed it. */
export interface SourcePoint {
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
}

/** The census key of one name: its layer and its feature, as data-overlaps counts them. */
export function nameKey(layerId: string, properties: Readonly<Record<string, unknown>>): string {
  return `${layerId}:${String(properties.id ?? properties.name ?? '')}`;
}

/**
 * The names the style would draw on the screen with no collision in the
 * way: for each of `layers` (a StyleLayerLike from overlays.ts or
 * city-layers.ts) that is visible at `zoom` and whose filter and text the
 * evaluator can read, every feature of its source that passes the filter,
 * has a text and stands with its anchor inside `view`. By nameKey.
 */
export function nameCandidates(
  layers: readonly StyleLayerLike[],
  featuresOf: (sourceId: string) => readonly SourcePoint[],
  zoom: number,
  project: (lonLat: [number, number]) => { x: number; y: number } | null,
  view: { width: number; height: number },
): Map<string, { layer: string; id: string }> {
  const out = new Map<string, { layer: string; id: string }>();
  // A zoom step inside a filter is read at the tile's whole zoom
  // (overlays.ts stopLabelFilter); the layer's own range at the camera's.
  const tileZoom = Math.floor(zoom);
  const laidOut = view.width > 0 && view.height > 0;
  for (const layer of layers) {
    const layout = (layer.layout ?? {}) as Record<string, unknown>;
    const field = layout['text-field'];
    if (field === undefined || layout.visibility === 'none' || !layer.source) continue;
    if (zoom < (layer.minzoom ?? 0) || zoom >= (layer.maxzoom ?? Infinity)) continue;
    const found = new Map<string, { layer: string; id: string }>();
    let readable = true;
    for (const feature of featuresOf(layer.source)) {
      const props = feature.properties;
      if (layer.filter !== undefined) {
        const pass = evaluateExpression(layer.filter, props, tileZoom);
        if (pass === UNKNOWN_EXPRESSION) { readable = false; break; }
        if (pass !== true) continue;
      }
      const text = evaluateExpression(field, props, zoom);
      if (text === UNKNOWN_EXPRESSION) { readable = false; break; }
      if (typeof text !== 'string' || text.trim() === '') continue;
      const [lon, lat] = (feature.geometry.type === 'Point' && Array.isArray(feature.geometry.coordinates) ? feature.geometry.coordinates : []) as number[];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const at = project([lon!, lat!]);
      if (at && laidOut && (at.x < 0 || at.y < 0 || at.x > view.width || at.y > view.height)) continue;
      found.set(nameKey(layer.id, props), { layer: layer.id, id: String(props.id ?? '') });
    }
    if (readable) for (const [key, value] of found) out.set(key, value);
  }
  return out;
}

// --- Decision 19: the stop names' hysteresis on the public screen ------------
//
// Decision 17 hands a name to MapLibre's collision pass, which hides it the
// moment a pill's box meets it and shows it again one placement cycle after
// the box has gone. A 3-minute live capture at Trg counted 9 blinks under a
// second: clusters merging and splitting beside a name, one name coming back
// and knocking out its neighbour. So on the public screen a stop name that
// comes back is HELD (overlays.ts stop-labels-held, cooperative: drawn over
// a pill's box, never over another name) for NAME_HOLD_MS unless a pill's
// drawn capsule covers it, and a name the pass hid less than
// NAME_MIN_HIDDEN_MS ago comes back unseen (the `o` feature state at 0) until
// that second is up, then fades in over NAME_FADE_MS. Pure: city-map.ts asks
// MapLibre what it placed and what a pill covers, and applies the answer.

/** How long a stop name that came back is held against a pill that only touches it. */
export const NAME_HOLD_MS = 2000;
/** The shortest a hidden stop name stays out of sight. */
export const NAME_MIN_HIDDEN_MS = 1000;
/** Our own fade of a stop name, out and in, on top of MapLibre's collision fade. */
export const NAME_FADE_MS = 300;
/** How often the public screen looks at its names. */
export const NAME_TICK_MS = 100;

/** A stop name's own ink: full, out of sight, or fading between the two. */
type NameInk = 'full' | 'out' | 'in' | 'fading-out';
interface NameState { placed: boolean; hiddenAt: number | null; ink: NameInk; fadeFrom: number; o: number }

export interface NameTick {
  /** The held stop ids, sorted, when they changed on this tick; null otherwise. */
  held: readonly string[] | null;
  /** The `o` feature state to write per stop id, 0 to 1 (overlays.ts reads a name without one as out of sight). */
  opacity: ReadonlyMap<string, number>;
}

export interface NameHysteresis {
  /** One look at the stop names at `t`: `placed` the ids MapLibre placed in
   *  either layer, `covered` the held ones a pill's drawn capsule covers. */
  tick(t: number, placed: ReadonlySet<string>, covered: ReadonlySet<string>): NameTick;
  held(): readonly string[];
}

/**
 * The hysteresis. A name the collision pass hides, or a held name a pill
 * covers, fades out (its own `o`, beside MapLibre's) and stays out of sight
 * for NAME_MIN_HIDDEN_MS from then, whatever the pass does meanwhile; once
 * that second is up and MapLibre places it, it fades in and is held for
 * NAME_HOLD_MS, a pill covering it ending the hold early. A name first seen
 * as the picture opens (within its first second) is simply drawn; one first
 * seen later was out of sight all along and comes back like any other.
 */
export function createNameHysteresis(): NameHysteresis {
  const states = new Map<string, NameState>();
  const held = new Map<string, number>();
  const heldList = (): string[] => [...held.keys()].sort();
  let startedAt: number | null = null;
  return {
    held: heldList,
    tick(t, placed, covered) {
      const opacity = new Map<string, number>();
      let changed = false;
      startedAt ??= t;
      /** The ink a name has at `t`: a fade in counts on from where it started. */
      const inkAt = (st: NameState): number => st.ink === 'in' ? Math.min(1, (t - st.fadeFrom) / NAME_FADE_MS) : st.ink === 'full' ? 1 : st.o;
      // A fade out starts from the ink the name has, so a name caught fading in never flashes back to full first.
      const goOut = (st: NameState): void => {
        if (st.ink === 'out' || st.ink === 'fading-out') return;
        st.hiddenAt = t;
        const from = inkAt(st);
        st.ink = 'fading-out';
        st.fadeFrom = t - (1 - from) * NAME_FADE_MS;
      };
      // A hold ends when its time is up, or at once when a pill covers the name, which then goes out of sight.
      for (const [id, until] of held) {
        const cover = covered.has(id);
        if (t < until && !cover) continue;
        held.delete(id);
        changed = true;
        const st = states.get(id);
        if (st && cover) goOut(st);
      }
      // Hidden by the collision pass.
      for (const [id, st] of states) {
        if (!st.placed || placed.has(id)) continue;
        st.placed = false;
        if (held.delete(id)) changed = true;
        goOut(st);
      }
      for (const id of placed) {
        let st = states.get(id);
        // Placed again while it fades out: straight out of sight, never a second fade in over the first one's tail.
        if (st && !st.placed && st.ink === 'fading-out') {
          st.ink = 'out';
          st.o = 0;
          opacity.set(id, 0);
        }
        if (!st) {
          const late = t - startedAt >= NAME_MIN_HIDDEN_MS;
          st = { placed: true, hiddenAt: late ? startedAt : null, ink: late ? 'out' : 'full', fadeFrom: t, o: late ? 0 : 1 };
          states.set(id, st);
          opacity.set(id, st.o);
          continue;
        }
        st.placed = true;
      }
      for (const [id, st] of states) {
        // The fades step on.
        if (st.ink === 'in' || st.ink === 'fading-out') {
          const k = Math.min(1, (t - st.fadeFrom) / NAME_FADE_MS);
          if (st.ink === 'in') {
            if (k >= 1) st.ink = 'full';
            st.o = k;
            opacity.set(id, k);
          } else {
            if (k >= 1) st.ink = 'out';
            st.o = 1 - k;
            opacity.set(id, 1 - k);
          }
        }
        // Back: placed, out of sight, its second up -- fade in and hold.
        if (st.placed && st.ink === 'out' && st.hiddenAt !== null && t - st.hiddenAt >= NAME_MIN_HIDDEN_MS) {
          st.ink = 'in';
          st.fadeFrom = t;
          st.o = 0;
          opacity.set(id, 0);
          held.set(id, t + NAME_HOLD_MS);
          changed = true;
        }
      }
      return { held: changed ? heldList() : null, opacity };
    },
  };
}

// --- The marker census (WP2, the probe contract of the companion plan §15.6)
//
// What the wall promises about its city marks is a claim about the screen:
// every BAJS station a disc with its count in it (a grey "0" when it has no
// bike, a grey disc without a number when the count is unknown or the
// station is not renting, never "?"), every venue on it named, nothing a
// mark without a word. So the census reads back what MapLibre drew -- the
// dots, the counts and the names it placed -- rather than the points it was
// handed, like data-pills does for the vehicles. Pure, so the rules are
// tested without a map; city-map.ts writeRenderProbe feeds it.

/** The city-place layers the census reads. map/city-layers.ts owns them; the
 *  ids are written out here so the census stays a pure module without the
 *  layer builders, and test/motion/city-map.test.ts holds the two together. */
export const CENSUS_LAYERS = Object.freeze({ dots: 'city-place-dots', badges: 'city-place-badges', labels: 'city-place-labels' });
/** Half the side of the square a disc's number takes, in CSS px before the
 *  symbol scale: half of city-layers.ts BIKE_COUNT_PX (12). A pill lying over
 *  that square hides the number, whatever the disc's own radius. */
export const CENSUS_COUNT_HALF_PX = 6;

/** A feature as queryRenderedFeatures answers it; the geometry is there on a
 *  real map and may be missing on a stand-in. */
export interface RenderedFeature {
  layer: { id: string };
  properties: Record<string, unknown>;
  geometry?: { type: string; coordinates: unknown };
}

/** A box on the screen in CSS px, as a pill's is reckoned (motion/pills.ts). */
export interface ScreenBox { left: number; top: number; right: number; bottom: number }

export interface MarkerCensus {
  /** data-markers: the curated city marks drawn with their centre on the screen, once each. */
  markers: number;
  /** data-unlabelled: marks drawn with nothing that says what they are, the
   *  deliberate exceptions below aside. Must be 0. A BAJS disc says it with
   *  its count; a venue (any mark but a station's or an air station's) with
   *  its NAME, never with its programme count alone -- the framed wall at
   *  Kadar 8 lost Gavella's name below zoom 13 and still read 0 while its
   *  disc said "1" (review-w, P2). */
  unlabelled: number;
  /** data-bajs, by what a station's disc says: `counted` a number above
   *  zero, `zero` the grey "0", `blank` the grey disc without a number (the
   *  count unknown, the station not renting: city/curated.ts bikeDisc), `far`
   *  the whole-city window's small dot without its number (points carrying
   *  `far`). The last two are deliberate and never unlabelled. */
  bajs: { counted: number; zero: number; blank: number; far: number };
  /** data-overlaps `discs`: marks whose number (or, for a disc without one,
   *  its centre) lies under a pill, so the reader sees the pill, not the mark.
   *  Transient on a live map: a tram passing a station covers it for as long
   *  as it takes to pass. */
  covered: number;
  /** data-disc-pills: the pills over those numbers, counted per mark (a
   *  pill over two discs counts twice), so `covered` never exceeds it: a
   *  covered disc is a pill passing, never a mark drawn under something else. */
  discPills: number;
}

/** What the city places' name layer did, as markerCensus needs it: whether
 *  the surface draws their names at all (city-layers.ts 'none', the
 *  whole-city window, draws none, and there a venue's count is its label),
 *  and the ids whose name the style would draw but the collision pass held
 *  back -- a name yielding to a passing pill (decision 17) is a hidden name
 *  (data-hidden-names), not a mark without one. */
export interface CensusNames {
  shown: boolean;
  suppressed: ReadonlySet<string>;
}
const NAMES_SHOWN: CensusNames = Object.freeze({ shown: true, suppressed: new Set<string>() });

function boxesMeet(a: ScreenBox, b: ScreenBox): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * The census of the city marks from what the three census layers rendered.
 * `anchorOf` places a feature on the screen (null when it cannot: the mark
 * then counts, since MapLibre drew it); `view` is the map's box, 0 x 0 before
 * layout (every mark counts), so a disc whose edge alone reaches in from off
 * the screen, number outside, is not a mark somebody sees; `pills` are the
 * rendered pills' boxes at the map's `scale`.
 */
export function markerCensus(
  rendered: readonly RenderedFeature[],
  anchorOf: (feature: RenderedFeature) => { x: number; y: number } | null,
  view: { width: number; height: number },
  pills: readonly ScreenBox[],
  scale: number,
  names: CensusNames = NAMES_SHOWN,
): MarkerCensus {
  // By feature id: a point on a tile seam comes back once from each tile.
  const dots = new Map<string, RenderedFeature>();
  const counts = new Map<string, string>();
  const named = new Set<string>();
  for (const feature of rendered) {
    const id = String(feature.properties.id ?? '');
    if (!id) continue;
    if (feature.layer.id === CENSUS_LAYERS.dots) {
      if (!dots.has(id)) dots.set(id, feature);
    } else if (feature.layer.id === CENSUS_LAYERS.badges) {
      // The badge layer draws nothing for '' (and for a `far` point), so a
      // rendered badge is a rendered word.
      const text = String(feature.properties.badge ?? '');
      if (text) counts.set(id, text);
    } else if (feature.layer.id === CENSUS_LAYERS.labels && String(feature.properties.title ?? '')) {
      named.add(id);
    }
  }
  const census: MarkerCensus = { markers: 0, unlabelled: 0, bajs: { counted: 0, zero: 0, blank: 0, far: 0 }, covered: 0, discPills: 0 };
  const laidOut = view.width > 0 && view.height > 0;
  const half = CENSUS_COUNT_HALF_PX * scale;
  for (const [id, feature] of dots) {
    const at = anchorOf(feature);
    if (at && laidOut && (at.x < 0 || at.y < 0 || at.x > view.width || at.y > view.height)) continue;
    census.markers++;
    const p = feature.properties;
    const bike = p.category === 'bikes';
    const count = counts.get(id);
    // A count is a whole number: "?", "—" or a "+3" is a mark without one.
    const counted = count !== undefined && /^\d+$/.test(count);
    const far = bike && p.far === true;
    // Decision 60: an empty station is a small teal dot whose "0" is not drawn; it still says its zero.
    const empty = bike && !far && String(p.badge ?? '') === '0' && count === undefined;
    const blank = bike && !far && count === undefined && p.spent === true && String(p.badge ?? '') === '';
    if (far) census.bajs.far++;
    else if (empty || (bike && counted && count === '0')) census.bajs.zero++;
    else if (bike && counted) census.bajs.counted++;
    else if (blank) census.bajs.blank++;
    // A venue is named or it is a number on a disc: its count says how many
    // happenings, not where. Only a surface that names no city place at all
    // lets the count stand for it.
    const venue = !bike && p.category !== 'air';
    const saysIt = named.has(id) || names.suppressed.has(id) || (counted && (!venue || !names.shown));
    if (!saysIt && !far && !blank && !empty) census.unlabelled++;
    if (at) {
      const number: ScreenBox = { left: at.x - half, top: at.y - half, right: at.x + half, bottom: at.y + half };
      const over = pills.filter((box) => boxesMeet(box, number)).length;
      if (over > 0) census.covered++;
      census.discPills += over;
    }
  }
  return census;
}


/** A rendered pill's box as MapLibre draws it: the capsule icon-text-fit
 *  lays on its number (motion/pills.ts capsuleHalfPx, from the glyph
 *  advances), at the map's symbol scale, centred on the mark. Inside the
 *  pill's own collision box (that plus icon-padding), so a name MapLibre
 *  placed clear of a pill is never counted as crossed by it -- where the
 *  clustering's table width, a few pixels wider for a merged label's narrow
 *  "·", would have counted names that sit beside the capsule. */
/** How many pairs of drawn pills lie over each other (data-pill-overlaps; 0 on a strip, where they yield). */
export function pillOverlaps(boxes: readonly ScreenBox[]): number {
  let n = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (boxesMeet(boxes[i]!, boxes[j]!)) n++;
  return n;
}

/** How many drawn pills run past the map's edge (data-pill-clipped); 0 before layout. */
export function pillsClipped(boxes: readonly ScreenBox[], view: { width: number; height: number }): number {
  if (!(view.width > 0 && view.height > 0)) return 0;
  return boxes.filter((b) => b.left < 0 || b.top < 0 || b.right > view.width || b.bottom > view.height).length;
}

export function pillBox(at: { x: number; y: number }, label: string, scale: number): ScreenBox {
  const { halfWidth, halfHeight } = capsuleHalfPx(label);
  const halfW = halfWidth * scale;
  const halfH = halfHeight * scale;
  return { left: at.x - halfW, top: at.y - halfH, right: at.x + halfW, bottom: at.y + halfH };
}

// --- The render census on a drawn map (city-map.ts binds it on `idle` and
// `render`; what each attribute says, and what the passes cost, is the probe
// comment there). Here, in the MapLibre chunk, because only a drawn map is
// ever read back: the lightweight graph carries the key it is taken for and
// nothing of the passes (test/app/budget.test.ts).

/** How long a new census key must have waited, on a still camera, before a
 *  plain `render` takes the census that no `idle` came to take (the live
 *  wall's fallback; city-map.ts's probe comment). Long enough for the push
 *  after an update() to be placed, short enough that every poll beat is read. */
export const PROBE_SETTLE_MS = 1000;

/** The slice of a MapLibre map the census reads: city-map.ts's MapApi, structurally. */
export interface CensusMap {
  getLayer?(id: string): unknown;
  getZoom(): number;
  isMoving?(): boolean;
  isSourceLoaded?(id: string): boolean;
  project?(lonLat: [number, number]): { x: number; y: number };
  queryRenderedFeatures(geometry: unknown, options?: { layers?: string[] }): RenderedFeature[];
  setFeatureState?(feature: { source: string; id: string }, state: Record<string, unknown>): void;
}

/** The layer and source ids the census reads, as the loaded module carries them. */
export type CensusIds = Pick<typeof import('./overlays'), 'LAYERS' | 'SOURCES'>;

/** What the census reads off the map wrapper that owns it (city-map.ts). */
export interface RenderCensusHost {
  /** The map's container: its box, and the probe attributes the census writes on it. */
  readonly container: HTMLElement;
  now(): number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(timer: unknown): void;
  /** Whether the overlays sit on the style of this map: nothing is read before, or after destroy. */
  styled(): boolean;
  /** The key a census is taken once for: zoom, selection, "has any marks", evidence version. */
  key(): string;
  /** Whether the vehicles source was last handed any mark: only then is there a first pill to look for. */
  hasMarks?(): boolean;
  /** The map's symbol scale (CityMapOptions.symbolScale). */
  scale(): number;
  /** The overlay and city-place layer lists as the live style carries them. */
  overlays(): readonly StyleLayerLike[];
  cityOverlays(): readonly StyleLayerLike[];
  /** The point features a name layer's source was last handed (nameCandidates). */
  sourcePoints(sourceId: string): readonly SourcePoint[];
  /** The screen's own stop, whose name decision 19 always draws; null without one. */
  stop(): { lon: number; lat: number } | null;
  /** Whether this is the public screen's map (prozor), where the name hysteresis runs. */
  prozor(): boolean;
  /** The names the hysteresis holds changed: the overlays are re-derived with them. */
  hold(names: readonly string[]): void;
}

export interface RenderCensus {
  /** MapLibre's `idle`: the census, once per key. */
  idle(): void;
  /** A `render` on a still camera: the first pills as soon as they are drawn, and the census once its key has settled (PROBE_SETTLE_MS). */
  settled(): void;
  /** A `render`: one look at the public screen's names, at most every NAME_TICK_MS. */
  nameTick(): void;
  destroy(): void;
}

/** The render census of one drawn map `m` (city-map.ts's probe comment): the
 *  vehicle attributes (data-pills, data-noses, data-bodies, data-twoway), the
 *  marker census and the overlaps, and decision 19's name hysteresis. */
export function createRenderCensus(m: CensusMap, l: CensusIds, host: RenderCensusHost): RenderCensus {
  /** The key the census was last taken for. */
  let renderProbeKey = '';
  /** The key a still frame first saw untaken, and when: settled()'s clock. */
  let settlingKey = '';
  let settlingSince = 0;
  let settleTimer: unknown = null;
  const schedule = host.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel = host.clearTimer ?? ((timer: unknown) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const cancelSettle = (): void => {
    if (settleTimer !== null) cancel(settleTimer);
    settleTimer = null;
  };
  // Source data handed to the worker is not rendered data. In particular,
  // an empty cold-start city layer must not certify data-markers="0".
  const cityReady = (): boolean => !m.isSourceLoaded || host.cityOverlays().every(layer =>
    typeof layer.source !== 'string' || m.isSourceLoaded!(layer.source));

  /** When a render last looked for the first pills (firstPills). */
  let pillLookAt = -Infinity;
  /** The first pills (lane p-map, karta-pills 4,442 ms on production): a
   *  pill depends on the vehicle data alone, so while the map has marks,
   *  data-pills is still empty and the census has not read this key, a
   *  render looks at the vehicle layers at most every NAME_TICK_MS and
   *  writes the vehicle attributes the moment MapLibre draws a pill -- not
   *  after every city source has loaded and the key has stood a second,
   *  which is the marker census's wait, not the pills'. Once the census has
   *  read the key (idle, or the settled frame below) the looks end, so a map
   *  that draws no pill at all (a zoom of vehicle dots) asks nothing more. */
  function firstPills(): void {
    if (!host.styled() || m.isMoving?.() || host.hasMarks?.() === false) return;
    if ((host.container.dataset.pills ?? '') !== '') return;
    const at = host.now();
    if (at - pillLookAt < NAME_TICK_MS || host.key() === renderProbeKey) return;
    pillLookAt = at;
    vehicleCensus(true);
  }

  /** The fallback for a map that never idles (city-map.ts's probe comment):
   *  on a `render` with the camera still, a key not yet taken is timed, and
   *  taken once it has stood for PROBE_SETTLE_MS. A key already taken costs
   *  one string per frame and nothing else. */
  function settled(): void {
    firstPills();
    if (!host.styled() || m.isMoving?.() || !cityReady()) {
      settlingKey = '';
      cancelSettle();
      return;
    }
    const key = host.key();
    if (key === renderProbeKey) return;
    if (key !== settlingKey) {
      settlingKey = key;
      settlingSince = host.now();
      cancelSettle();
      // A held outage map may draw no further frame once its sources land.
      // Read that still frame after the same settling window, not a later poll.
      settleTimer = schedule(() => { cancelSettle(); settled(); }, PROBE_SETTLE_MS);
      return;
    }
    if (host.now() - settlingSince >= PROBE_SETTLE_MS) idle();
  }

  /** The census on MapLibre's `idle`: the vehicle attributes, then the marker census. */
  function idle(): void {
    if (!host.styled() || m.isMoving?.() || !cityReady()) return;
    const key = host.key();
    if (key === renderProbeKey) return;
    cancelSettle();
    renderProbeKey = key;
    host.container.dataset.zoom = m.getZoom().toFixed(2);
    writeMarkerCensus(vehicleCensus(false));
  }

  /** The vehicle attributes off what MapLibre renders now, and the pills'
   *  features for the marker census. `onlyDrawn` (firstPills) writes nothing
   *  unless a pill is drawn, so a look never publishes a provisional ''. */
  function vehicleCensus(onlyDrawn: boolean): RenderedFeature[] {
    // Asking MapLibre about a layer the style does not carry fires an error
    // event, which city-map.ts onMapError logs as a bug; its placedNames()
    // guards the same way.
    const ids = [l.LAYERS.vehicles, l.LAYERS.vehicleSelected, l.LAYERS.vehicleNoses, l.LAYERS.vehicleBodies, l.LAYERS.vehicleTwoWayFore]
      .filter((id) => !m.getLayer || m.getLayer(id));
    // By feature id, so a mark queried twice (a point on a tile seam, a line
    // across one) is one pill, one body, one arrow; the pills in id order, so
    // the attribute is stable frame to frame.
    const pills = new Map<string, string>();
    const pillFeatures = new Map<string, RenderedFeature>();
    const bodies = new Set<string>();
    const twoWay = new Set<string>();
    let noses = 0;
    for (const feature of ids.length === 0 ? [] : m.queryRenderedFeatures(undefined, { layers: ids })) {
      if (feature.layer.id === l.LAYERS.vehicleNoses) noses++;
      else if (feature.layer.id === l.LAYERS.vehicleBodies) bodies.add(String(feature.properties.id));
      else if (feature.layer.id === l.LAYERS.vehicleTwoWayFore) twoWay.add(String(feature.properties.id));
      else {
        pills.set(String(feature.properties.id), String(feature.properties.short ?? ''));
        pillFeatures.set(String(feature.properties.id), feature);
      }
    }
    const features = [...pillFeatures.values()];
    if (onlyDrawn && pills.size === 0) return features;
    host.container.dataset.pills = [...pills.keys()].sort().map((id) => pills.get(id)!).join('|');
    host.container.dataset.noses = String(noses);
    host.container.dataset.bodies = String(bodies.size);
    host.container.dataset.twoway = String(twoWay.size);
    return features;
  }

  /** The marker census and the overlaps (city-map.ts's probe comment), from
   *  the pills the vehicle census just read. */
  function writeMarkerCensus(pillFeatures: readonly RenderedFeature[]): void {
    const has = (id: string): boolean => !m.getLayer || Boolean(m.getLayer(id));
    const anchorOf = (feature: RenderedFeature): { x: number; y: number } | null => {
      const g = feature.geometry;
      if (!m.project || g?.type !== 'Point' || !Array.isArray(g.coordinates)) return null;
      const [lon, lat] = g.coordinates as number[];
      return Number.isFinite(lon) && Number.isFinite(lat) ? m.project([lon!, lat!]) : null;
    };
    const pillBoxes: ScreenBox[] = [];
    for (const feature of pillFeatures) {
      const at = anchorOf(feature);
      if (at) pillBoxes.push(pillBox(at, String(feature.properties.short ?? ''), host.scale()));
    }
    const view = { width: host.container.clientWidth, height: host.container.clientHeight };
    const nameIds: string[] = [l.LAYERS.stopLabels, l.LAYERS.stopLabelsHeld, l.LAYERS.screenStopLabel, l.LAYERS.placeQuakeLabels, l.LAYERS.placeWorks, l.LAYERS.placeEvents,
      l.LAYERS.placeSeat, l.LAYERS.placeAssembly, l.LAYERS.placePharmacy, CENSUS_LAYERS.labels].filter(has);
    /** Decision 19: the screen's own name is drawn whatever crosses it; data-overlaps counts every other name. */
    const crossable = nameIds.filter((id) => id !== l.LAYERS.screenStopLabel);
    // The names placed, and the names the style would place with nothing in
    // the way: what the second has and the first lacks, the collision pass
    // held back (data-hidden-names).
    const placed = new Set<string>();
    let ownName = '';
    for (const feature of nameIds.length === 0 ? [] : m.queryRenderedFeatures(undefined, { layers: nameIds })) {
      placed.add(nameKey(feature.layer.id, feature.properties));
      if (feature.layer.id === l.LAYERS.screenStopLabel) ownName = String(feature.properties.name ?? '');
    }
    const project = m.project ? (lonLat: [number, number]) => m.project!(lonLat) : () => null;
    const specs = [...host.overlays(), ...host.cityOverlays()].filter((layer) => nameIds.includes(layer.id));
    const hidden = [...nameCandidates(specs, host.sourcePoints, m.getZoom(), project, view)].filter(([key]) => !placed.has(key));
    const cityLabels = host.cityOverlays().find((layer) => layer.id === CENSUS_LAYERS.labels);
    const names: CensusNames = {
      shown: cityLabels !== undefined && (cityLabels.layout as Record<string, unknown> | undefined)?.visibility !== 'none',
      suppressed: new Set(hidden.filter(([, name]) => name.layer === CENSUS_LAYERS.labels).map(([, name]) => name.id)),
    };
    const cityIds = [CENSUS_LAYERS.dots, CENSUS_LAYERS.badges, CENSUS_LAYERS.labels].filter(has);
    const census = markerCensus(
      cityIds.length === 0 ? [] : m.queryRenderedFeatures(undefined, { layers: cityIds }),
      anchorOf, view, pillBoxes, host.scale(), names,
    );
    const crossed = new Set<string>();
    if (crossable.length > 0) {
      for (const box of pillBoxes) {
        for (const feature of m.queryRenderedFeatures([[box.left, box.top], [box.right, box.bottom]], { layers: crossable })) {
          crossed.add(nameKey(feature.layer.id, feature.properties));
        }
      }
    }
    host.container.dataset.markers = String(census.markers);
    host.container.dataset.unlabelled = String(census.unlabelled);
    host.container.dataset.bajs = `counted:${census.bajs.counted};zero:${census.bajs.zero};blank:${census.bajs.blank};far:${census.bajs.far}`;
    host.container.dataset.overlaps = `discs:${census.covered};names:${crossed.size}`;
    host.container.dataset.discPills = String(census.discPills);
    host.container.dataset.pillOverlaps = String(pillOverlaps(pillBoxes));
    host.container.dataset.pillClipped = String(pillsClipped(pillBoxes, view));
    host.container.dataset.hiddenNames = String(hidden.length);
    host.container.dataset.ownName = ownName;
  }

  /** Decision 19 on the public screen (createNameHysteresis above). */
  let nameHold: NameHysteresis | null = null;
  let nameTickAt = -Infinity;
  /** How long a pill has crossed the screen's own name, in ms, and when that was last looked at (data-own-name-crossed). */
  let ownCrossedMs = 0;
  let ownLookedAt: number | null = null;

  /** One look at the public screen's stop names (decision 19), at most every
   *  NAME_TICK_MS on a still camera: what MapLibre placed, which held name a
   *  pill's drawn capsule covers (the capsule less the names' 3 px padding,
   *  so a touch is not a cover), and whether a pill crosses the screen's own
   *  name. A handful of small queries, each around a held name or the own
   *  name only. */
  function nameTick(): void {
    if (!host.styled() || !host.prozor() || !m.setFeatureState || m.isMoving?.()) return;
    if (m.getLayer && !m.getLayer(l.LAYERS.stopLabelsHeld)) return;
    const t = host.now();
    if (t - nameTickAt < NAME_TICK_MS) return;
    nameTickAt = t;
    nameHold ??= createNameHysteresis();
    const has = (id: string): boolean => !m.getLayer || Boolean(m.getLayer(id));
    const at = (f: RenderedFeature): { x: number; y: number } | null => {
      const c = f.geometry?.type === 'Point' ? f.geometry.coordinates as number[] : null;
      return c && m.project ? m.project([c[0]!, c[1]!]) : null;
    };
    const placed = new Set<string>();
    const heldAt = new Map<string, { x: number; y: number }>();
    for (const f of m.queryRenderedFeatures(undefined, { layers: [l.LAYERS.stopLabels, l.LAYERS.stopLabelsHeld] })) {
      const id = String(f.properties.id ?? '');
      if (!id) continue;
      placed.add(id);
      const p = f.layer.id === l.LAYERS.stopLabelsHeld ? at(f) : null;
      if (p) heldAt.set(id, p);
    }
    const stop = host.stop();
    const ownAt = stop && m.project && Number.isFinite(stop.lon) && Number.isFinite(stop.lat) ? m.project([stop.lon, stop.lat]) : null;
    const pills: ScreenBox[] = [];
    if (heldAt.size > 0 || ownAt) {
      for (const f of m.queryRenderedFeatures(undefined, { layers: [l.LAYERS.vehicles, l.LAYERS.vehicleSelected].filter(has) })) {
        const p = at(f);
        if (p) pills.push(pillBox(p, String(f.properties.short ?? ''), host.scale()));
      }
    }
    const near = (box: ScreenBox, p: { x: number; y: number }): boolean => box.right > p.x - 400 && box.left < p.x + 400 && box.bottom > p.y - 160 && box.top < p.y + 160;
    const covered = new Set<string>();
    const pad = 3;
    for (const [id, p] of heldAt) {
      for (const box of pills) {
        if (!near(box, p) || box.right - box.left <= 2 * pad) continue;
        const hits = m.queryRenderedFeatures([[box.left + pad, box.top + pad], [box.right - pad, box.bottom - pad]], { layers: [l.LAYERS.stopLabelsHeld] });
        if (hits.some((f) => String(f.properties.id ?? '') === id)) { covered.add(id); break; }
      }
    }
    if (ownAt && has(l.LAYERS.screenStopLabel)) {
      const crossed = pills.some((box) => near(box, ownAt) && m.queryRenderedFeatures([[box.left, box.top], [box.right, box.bottom]], { layers: [l.LAYERS.screenStopLabel] }).length > 0);
      if (crossed && ownLookedAt !== null) ownCrossedMs += Math.min(t - ownLookedAt, 1000);
      ownLookedAt = t;
      host.container.dataset.ownNameCrossed = (ownCrossedMs / 1000).toFixed(1);
    }
    const result = nameHold!.tick(t, placed, covered);
    for (const [id, o] of result.opacity) m.setFeatureState({ source: l.SOURCES.stops, id }, { o });
    if (result.held) host.hold(result.held);
  }

  return { idle, settled, nameTick, destroy: cancelSettle };
}
