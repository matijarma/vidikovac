// The fact chips of an item at its minute (plan section 3.4): the series'
// values at the minute, a route's five-minute sample, a BAJS station's bikes.
// Missing is never zero: a null reads "bez podatka" (and is marked missing),
// a zero that was observed reads as the word for none ("nijedno vozilo",
// "prazna"). State chips before serviceLiveFromSec are `retro`: the state was
// computed afterwards with the same rules, and the chip says so.
//
// Station chips need the stations and the BAJS file, which are not on the
// first-paint set: stationData() starts their load on first use and answers
// null meanwhile; such a chip is marked `pending` so its renderer can ask once
// more after the load settles (onStationData).
import { BAJS_STEP_S, isBajsFile, isStationsFile, type FactKey, type SeriesFile, type StationsFile } from '../../../shared/snimka';
import { BAJS_MISSING, BAJS_NOT_RENTING, SnimkaError, decodeBajs } from '../../../shared/snimka-codec';
import type { SnimkaContext } from './context';
import { num } from './format';
import { routeSample } from './route-series';
import { SN, fill } from './strings';

export interface FactChip {
  key: FactKey;
  text: string;
  /** A state judged afterwards (before the app published its own). */
  retro: boolean;
  /** The value is not in the recording: the text says "bez podatka", never 0. */
  missing: boolean;
  /** A station chip whose data was still loading: ask again after onStationData. */
  pending?: boolean;
}

export type FactsContext = Pick<SnimkaContext, 'series' | 'routes' | 'manifest' | 'data'>;

// ---- stations (lazy) -----------------------------------------------------------------

export interface StationData { stations: Map<string, StationsFile['stations'][number]>; ids: string[]; rows: Uint8Array[]; t0: number; n: number }

const stationStores = new WeakMap<object, { data: StationData | null; state: 'idle' | 'loading' | 'ready' | 'failed'; listeners: Set<() => void> }>();

function stationStore(ctx: Pick<SnimkaContext, 'manifest' | 'data'>) {
  let s = stationStores.get(ctx);
  if (!s) {
    s = { data: null, state: 'idle', listeners: new Set() };
    stationStores.set(ctx, s);
  }
  return s;
}

/** The stations and their bikes per five minutes, or null while loading (the load starts here) or after a failure. */
export function stationData(ctx: Pick<SnimkaContext, 'manifest' | 'data'>): StationData | null {
  const s = stationStore(ctx);
  if (s.state === 'idle') {
    s.state = 'loading';
    const stations = ctx.data.get(ctx.manifest.files.stations, (raw) => {
      if (!isStationsFile(raw)) throw new SnimkaError('stations: not a stations file');
      return raw;
    });
    const bajs = ctx.data.get(ctx.manifest.files.bajs, (raw) => {
      if (!isBajsFile(raw)) throw new SnimkaError('bajs: not a bajs file');
      return raw;
    });
    Promise.all([stations, bajs]).then(
      ([st, bj]) => {
        s.data = { stations: new Map(st.stations.map((x) => [x.id, x])), ids: bj.stations, rows: decodeBajs(bj), t0: bj.t0, n: bj.n };
        s.state = 'ready';
        for (const fn of [...s.listeners]) fn();
      },
      () => {
        s.state = 'failed';
        for (const fn of [...s.listeners]) fn();
      },
    );
  }
  return s.data;
}

/** Called once the station data settles (loaded or failed). */
export function onStationData(ctx: Pick<SnimkaContext, 'manifest' | 'data'>, fn: () => void): () => void {
  const s = stationStore(ctx);
  s.listeners.add(fn);
  return () => { s.listeners.delete(fn); };
}

/** A station's bikes in the five-minute sample holding the instant: a count, 'not-renting', or null where missing. */
export function stationBikes(data: StationData, id: string, atSec: number): number | 'not-renting' | null {
  const i = data.ids.indexOf(id);
  const j = Math.floor((atSec - data.t0) / BAJS_STEP_S);
  if (i < 0 || j < 0 || j >= data.n) return null;
  const b = data.rows[i]![j]!;
  if (b === BAJS_MISSING) return null;
  if (b === BAJS_NOT_RENTING) return 'not-renting';
  return b;
}

// ---- the chips -------------------------------------------------------------------------

/** The minute of the series holding the instant, or -1 outside it (never clamped: a notice before the window has no values). */
export function seriesMinute(series: Pick<SeriesFile, 't0' | 'n'>, atSec: number): number {
  const m = Math.floor((atSec - series.t0) / 60);
  return m >= 0 && m < series.n ? m : -1;
}

const at = <T,>(col: readonly (T | null)[] | null | undefined, m: number): T | null => (col && m >= 0 ? (col[m] ?? null) : null);

/** "u pokretu {n}" with nothing to fill: "u pokretu: bez podatka" (the placeholder and a leading "oko" dropped). */
function missingText(template: string): string {
  const head = template.replace(/\s*(?:oko\s*)?\{[a-z]+\}.*$/u, '').replace(/:$/, '').trim();
  return head ? `${head}: ${SN.facts.none}` : SN.facts.none;
}

const STATE_WORD = { normal: SN.badge.normal, reduced: SN.badge.reduced, silent: SN.badge.silent, unknown: SN.badge.unknown } as const;
const lowerFirst = (s: string): string => s.charAt(0).toLocaleLowerCase('hr') + s.slice(1);

/** The label over an item's chips: "U minuti objave" for a headline, "U toj minuti" for everything else. */
export function chipsLabel(opts: { atPublish?: boolean } = {}): string {
  return opts.atPublish ? SN.voices.atPublish : SN.voices.atThatMinute;
}

/** The chips of `keys` at `atSec` (seconds), in the order given; an unknown key or a feed with nothing to say gives none. */
export function factChips(keys: readonly FactKey[], ctx: FactsContext, atSec: number, _opts: { atPublish?: boolean } = {}): FactChip[] {
  const s = ctx.series;
  const m = seriesMinute(s, atSec);
  const out: FactChip[] = [];
  const push = (key: FactKey, text: string, missing: boolean, retro = false, pending = false): void => {
    out.push(pending ? { key, text, retro, missing, pending } : { key, text, retro, missing });
  };
  const count = (key: FactKey, template: string, v: number | null): void => {
    if (v === null) push(key, missingText(template), true);
    else push(key, fill(template, { n: num(v) }), false);
  };
  for (const key of keys) {
    if (key === 'seen') count(key, SN.facts.seen, at(s.seen.all, m));
    else if (key === 'expected') count(key, SN.facts.expected, at(s.expected.all, m));
    else if (key === 'bikes') count(key, SN.facts.bikes, at(s.bikes?.total, m));
    else if (key === 'bikesEmpty') count(key, SN.facts.bikesEmpty, at(s.bikes?.empty, m));
    else if (key === 'closures') count(key, SN.facts.closures, at(s.closures?.active, m));
    else if (key === 'state') {
      const state = at(s.service.state, m);
      const held = at(s.service.hold, m) !== null;
      const retro = atSec < ctx.manifest.serviceLiveFromSec;
      if (state === null) push(key, missingText(SN.facts.state), true, retro);
      else if (held) push(key, fill(SN.facts.state, { state: SN.strip.stateNone }), true, retro);
      else push(key, fill(SN.facts.state, { state: lowerFirst(STATE_WORD[state]) }), false, retro);
    } else if (key === 'temp') {
      const h = Math.floor((atSec - s.hourly.t0) / 3600);
      const t = h >= 0 && h < s.hourly.n ? at(s.hourly.tempC, h) : null;
      if (t === null) push(key, SN.readout.weatherNone, true);
      else push(key, fill(SN.facts.temp, { n: num(Math.round(t)) }), false);
    } else if (key === 'feed') {
      const frozen = at(s.feed.frozen, m);
      const entities = at(s.feed.entities, m);
      if (frozen === 1) push(key, SN.facts.feedFrozen, false);
      else if (entities === 0) push(key, SN.facts.feedEmpty, false);
      else if (frozen === null && entities === null) push(key, `${SN.strip.feed}: ${SN.facts.none}`, true);
    } else if (key.startsWith('route:')) {
      const id = key.slice('route:'.length);
      const route = ctx.routes.routes.find((r) => r.id === id) ?? ctx.routes.routes.find((r) => r.shortName === id);
      const short = route?.shortName ?? id;
      const sample = route ? routeSample(ctx.routes, route.id, atSec) : { seen: null, expected: null };
      // "linija 228" from the catalogue's own wording, so the three readings share one head.
      const head = fill(SN.facts.routeNone, { route: short }).replace(/:.*$/u, '');
      if (sample.seen === null) push(key, `${head}: ${SN.facts.none}`, true);
      else if (sample.seen === 0) push(key, fill(SN.facts.routeNone, { route: short }), false);
      else if (sample.expected === null) push(key, `${head}: ${num(sample.seen)}`, false);
      else push(key, fill(SN.facts.route, { route: short, seen: num(sample.seen), expected: num(sample.expected) }), false);
    } else if (key.startsWith('station:')) {
      const id = key.slice('station:'.length);
      const data = stationData(ctx);
      const name = data?.stations.get(id)?.name ?? id;
      const bikes = data ? stationBikes(data, id, atSec) : null;
      if (bikes === null || bikes === 'not-renting') push(key, fill(SN.facts.station, { name, bikes: SN.facts.none }), true, false, !data);
      else if (bikes === 0) push(key, fill(SN.facts.stationEmpty, { name }), false);
      else push(key, fill(SN.facts.station, { name, bikes: num(bikes) }), false);
    }
  }
  return out;
}
