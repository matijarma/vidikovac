// The BAJS stations on the stage map (snimka v3, decision V3-9). One
// GeoJSON source of the stations keyed by id, one circle layer whose paint
// reads MapLibre feature state, never setData or a symbol layer: the owner's
// "dots flashing in and out with their counts" was a setData and a symbol
// relayout per five-minute sample. Per frame the fill level `f` is
// bikes/capacity interpolated linearly between the two surrounding samples
// of the bytes file (shared/snimka-codec.ts decodeBajs), on the five-step
// teal ramp BAJS_RAMP (pale = few, bikeDisc deep = full; validated in both
// themes with the dataviz validator: light end 2.14:1 on the day canvas,
// deep end 2.76:1 on the night canvas, every step at least 0.06 apart in
// OKLCH L); `e` is an empty station (the canvas fill with a thin grey ring),
// `a` the anomaly rim (urgency ink, 2 px) where the station is at least
// ANOMALY_PP of its capacity emptier than at the same minute of Thursday
// 1 October, the reference day (none on Thursday and Friday, none where
// either byte is 254 or 255), `m` a missing byte (255: nothing drawn), `s`
// a station not renting (254: the spent grey). Only a changed value is a
// setFeatureState call; `f` is quantised to F_QUANTUM so a station drifting
// by a bike every twenty minutes does not write every frame. Pure functions
// first (unit-tested in node), then the layer spec; map-layer.ts owns the
// cadence (BAJS_HZ desktop, BAJS_HZ_PHONE phone, once per sample under
// reduced motion) and the probe data-sn-bajs="<drawn>/<anomalies>".
import { BAJS_STEP_S, ZAGREB_OFFSET_S, type BajsFile, type StationsFile } from '../../../shared/snimka';
import { BAJS_MISSING, BAJS_NOT_RENTING } from '../../../shared/snimka-codec';
import type { OverlayPalette, StyleLayerLike } from '../map/basemap';
import type { StageLayerSpec } from '../map/city-map';
import { fill } from './strings';

export const BAJS_SOURCE = 'snimka-bajs';
export const BAJS_LAYER = 'snimka-bajs';
/** Pale to deep: the fill at f = 0, 0.25, 0.5, 0.75 and 1 (the last is OverlayPalette.bikeDisc). */
export const BAJS_RAMP = ['#77b4a8', '#5fa194', '#478f82', '#2e7d70', '#0b6b5e'] as const;
/** Pushes per second while the layer animates: a desk, a phone (matchMedia pointer: coarse). */
export const BAJS_HZ = 10;
export const BAJS_HZ_PHONE = 4;
/** The fill level's step: a change under it is not a feature-state call. */
export const F_QUANTUM = 1 / 32;
/** The anomaly rim: this share of the capacity emptier than the reference day at the same minute. */
export const ANOMALY_PP = 0.3;
/** Under half a bike the station is empty. */
export const EMPTY_BELOW = 0.5;
/** Thursday 1 October 2026 00:00 Zagreb, the reference day's first second. */
export const REFERENCE_DAY_START_S = 1790805600;
/** The reference day and the day after it (Thu 1, Fri 2 Oct) carry no rim: they are the reference. */
export const REFERENCE_WEEKDAYS: readonly number[] = [4, 5];
/** Numbers appear only paused and from this zoom (the tap tooltip, map-layer.ts). */
export const BAJS_TIP_ZOOM = 14;
/** The tap tooltip's text (new for the read-through; layers.bikesTip once W0 carries it): bikes of capacity, the reference day's count. */
export const BAJS_TIP = '{bikes} od {capacity} mjesta · u četvrtak 1. 10. u isto doba {ref}';
export const BAJS_TIP_NO_REF = '{bikes} od {capacity} mjesta';

export interface StationState { f: number; e: boolean; a: boolean; m: boolean; s: boolean }
export const MISSING_STATE: Readonly<StationState> = Object.freeze({ f: 0, e: false, a: false, m: true, s: false });

/** The Zagreb weekday (0 = Sunday) of an instant; CEST throughout the window. */
export const zagrebWeekday = (atSec: number): number => new Date((atSec + ZAGREB_OFFSET_S) * 1000).getUTCDay();

/** The two samples around an instant and the way from the first to the second, clamped to the file; null for an empty file. */
export function samplePosition(file: Pick<BajsFile, 't0' | 'n'>, atSec: number): { i: number; j: number; frac: number } | null {
  if (file.n <= 0) return null;
  const raw = (atSec - file.t0) / BAJS_STEP_S;
  const i = Math.max(0, Math.min(file.n - 1, Math.floor(raw)));
  const frac = raw < 0 ? 0 : raw >= file.n - 1 ? 0 : raw - i;
  return { i, j: Math.min(file.n - 1, i + 1), frac };
}

/** The sample of the reference day at the same Zagreb minute of day, or -1 when the file lacks it. */
export function referenceIndex(file: Pick<BajsFile, 't0' | 'n'>, atSec: number): number {
  const tod = (((Math.floor(atSec) + ZAGREB_OFFSET_S) % 86_400) + 86_400) % 86_400;
  const idx = Math.floor((REFERENCE_DAY_START_S + tod - file.t0) / BAJS_STEP_S);
  return idx >= 0 && idx < file.n ? idx : -1;
}

const numeric = (byte: number): boolean => byte <= 250;

/** The most bikes a station ever held in the window: the capacity stand-in where the stations file has none; null when never counted. */
export function windowMax(row: Uint8Array): number | null {
  let max = -1;
  for (let k = 0; k < row.length; k++) { const b = row[k]!; if (numeric(b) && b > max) max = b; }
  return max >= 0 ? max : null;
}

export const quantise = (f: number): number => Math.round(Math.max(0, Math.min(1, f)) / F_QUANTUM) * F_QUANTUM;

/** One station's state at a sample position: the interpolated count against its capacity, the empty, rim, missing
 *  and spent flags. `capacity` null takes the window's maximum; `ref` is the reference sample index or -1; `rimOff`
 *  is true on the reference weekdays; `reduced` steps once per sample instead of gliding. */
export function stationStateAt(row: Uint8Array, capacity: number | null, at: { i: number; j: number; frac: number }, ref: number, rimOff: boolean, reduced: boolean): StationState {
  const b0 = row[at.i] ?? BAJS_MISSING;
  if (b0 === BAJS_MISSING) return { ...MISSING_STATE };
  if (b0 === BAJS_NOT_RENTING) return { f: 0, e: false, a: false, m: false, s: true };
  const b1 = row[at.j] ?? BAJS_MISSING;
  const bikes = !reduced && numeric(b1) ? b0 + (b1 - b0) * at.frac : b0;
  const cap = capacity !== null && capacity > 0 ? capacity : windowMax(row) ?? 0;
  const f = cap > 0 ? quantise(bikes / cap) : 0;
  const e = bikes < EMPTY_BELOW;
  const refByte = ref >= 0 ? row[ref] ?? BAJS_MISSING : BAJS_MISSING;
  const a = !rimOff && cap > 0 && numeric(refByte) && (refByte - bikes) / cap >= ANOMALY_PP;
  return { f, e, a, m: false, s: false };
}

export interface BajsStates { states: Map<string, StationState>; drawn: number; anomalies: number; missing: boolean }

/** Every station's state at an instant (the stations file's order); `drawn` counts the stations with a byte, `missing`
 *  says none has one (the foot line layers.bikesMissing). A station the bytes file lacks is missing. */
export function bajsStatesAt(stations: StationsFile, file: BajsFile, rows: readonly Uint8Array[], atSec: number, o: { reduced?: boolean } = {}): BajsStates {
  const states = new Map<string, StationState>();
  const at = samplePosition(file, atSec);
  const ref = referenceIndex(file, atSec);
  const rimOff = REFERENCE_WEEKDAYS.includes(zagrebWeekday(atSec));
  const byId = new Map<string, number>();
  file.stations.forEach((id, i) => byId.set(id, i));
  let drawn = 0;
  let anomalies = 0;
  for (const station of stations.stations) {
    const rowIndex = byId.get(station.id);
    const row = rowIndex === undefined ? undefined : rows[rowIndex];
    const state = row && at ? stationStateAt(row, station.capacity, at, ref, rimOff, o.reduced === true) : { ...MISSING_STATE };
    if (!state.m) drawn += 1;
    if (state.a) anomalies += 1;
    states.set(station.id, state);
  }
  return { states, drawn, anomalies, missing: drawn === 0 };
}

/** Every layer switched off: nothing drawn, no rim (what the bikes chip off pushes). */
export function hiddenStates(stations: StationsFile): Map<string, StationState> {
  return new Map(stations.stations.map((s) => [s.id, { ...MISSING_STATE }]));
}

const sameState = (a: StationState | undefined, b: StationState): boolean => a !== undefined && a.f === b.f && a.e === b.e && a.a === b.a && a.m === b.m && a.s === b.s;

/** The stations whose state changed: what becomes a setFeatureState call each. */
export function changedStates(applied: ReadonlyMap<string, StationState>, next: ReadonlyMap<string, StationState>): [id: string, state: StationState][] {
  const out: [string, StationState][] = [];
  for (const [id, state] of next) if (!sameState(applied.get(id), state)) out.push([id, state]);
  return out;
}

/** The tap tooltip (paused, zoom BAJS_TIP_ZOOM and up): the count of the capacity and the reference day's count; a byte
 *  without a number says nothing (null). */
export function bikesTip(byte: number, capacity: number | null, refByte: number): string | null {
  if (!numeric(byte)) return null;
  const cap = capacity === null ? '?' : String(capacity);
  return numeric(refByte) ? fill(BAJS_TIP, { bikes: byte, capacity: cap, ref: refByte }) : fill(BAJS_TIP_NO_REF, { bikes: byte, capacity: cap });
}

// ---- the layer spec --------------------------------------------------------------------------------------

type Expr = unknown[];
/** A boolean of the feature state: the station's flags, and `sel` (the selected station, set by map-layer.ts). */
const flag = (name: keyof StationState | 'sel'): Expr => ['boolean', ['feature-state', name], false];

/** The one circle layer: fill by `f` on the ramp, the canvas when empty, the spent grey when not renting; the rim in
 *  the urgency ink (2 px) for an anomaly, the stop stroke (1 px) for an empty station, the selection ink (3 px) for
 *  the selected station; constant radius by zoom (4 px to z13, 7 px at z15); nothing drawn when missing. */
export function bajsLayerSpec(p: OverlayPalette, scale = 1): StyleLayerLike {
  const ramp: Expr = ['interpolate', ['linear'], ['feature-state', 'f'], 0, BAJS_RAMP[0], 0.25, BAJS_RAMP[1], 0.5, BAJS_RAMP[2], 0.75, BAJS_RAMP[3], 1, BAJS_RAMP[4]];
  return {
    id: BAJS_LAYER,
    type: 'circle',
    source: BAJS_SOURCE,
    paint: {
      'circle-color': ['case', flag('s'), p.bikeSpent, flag('e'), p.stopFill, ramp],
      'circle-stroke-color': ['case', flag('sel'), p.selection, flag('a'), p.closure, flag('e'), p.stopStroke, p.stopFill],
      'circle-stroke-width': ['case', flag('sel'), 3, flag('a'), 2, flag('e'), 1, 0],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4 * scale, 13, 4.5 * scale, 15, 7 * scale],
      'circle-opacity': ['case', flag('m'), 0, 1],
      'circle-stroke-opacity': ['case', flag('m'), 0, 1],
    },
  };
}

/** The stage layer for the city map (CityMapHandle.addStageLayer): the stations as points with `id` "bajs:<id>" (the
 *  wall's place id, so a tap is the same `place` selection subject.ts already reads), keyed for feature state. */
export function bajsStageLayer(stations: StationsFile): StageLayerSpec {
  return {
    source: BAJS_SOURCE,
    promoteId: 'id',
    data: {
      type: 'FeatureCollection',
      features: stations.stations.map((s) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: { id: `bajs:${s.id}`, name: s.name } })),
    },
    layer: bajsLayerSpec,
    pick: 'place',
  };
}

/** The feature id the source keys a station by (promoteId `id`). */
export const bajsFeatureId = (stationId: string): string => `bajs:${stationId}`;
