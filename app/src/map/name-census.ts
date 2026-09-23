// The wall's name census and its hysteresis (WP2-A2, decisions 17 and 19),
// pure and without MapLibre, in the MapLibre chunk (maplibre-entry.ts): only a
// drawn map ever runs them, so a lightweight screen never loads them.
// city-map.ts reaches them through the loaded module, as it does the layers.
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
