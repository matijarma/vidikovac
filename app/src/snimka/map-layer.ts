// The map of /snimka/: the city map (app/src/map/city-map.ts) with the
// replay model in place of the integrator, fed by the chunk store and the
// one replay clock. The map keeps its own loop on real time and parks when
// nothing moves; a clock mutation, a landed chunk or a layer switch wakes
// it through handle.update(), the map's own "news" entry. BAJS stations and
// closures ride the map's city points and lines with the wall's props,
// pushed only when their five-minute sample or the closure version changes;
// the comparison day's ghosts go through setGhosts at most twelve times a
// second while the layer is on. Loaded by stage.ts with one dynamic import,
// so the page's entry graph never carries the map library.
import { decodeNetwork, type GraphNetwork, type Network } from '../../../shared/motion/network';
import {
  BAJS_STEP_S, isBajsFile, isClosuresFile, isMotionIndex, isStationsFile,
  type BajsFile, type ClosuresFile, type MotionIndex, type StationsFile,
} from '../../../shared/snimka';
import { BAJS_MISSING, BAJS_NOT_RENTING, decodeBajs, decodeMotionChunk, SnimkaError } from '../../../shared/snimka-codec';
import { createCityMap, ZAGREB_CENTER, type CityMapHandle, type MapLine, type MapPoint } from '../map/city-map';
import type { Model } from '../motion/integrator';
import { PLACE_NAMES_ZOOM } from '../map/city-layers';
import { PILL_ZOOM } from '../map/overlays';
import { createChunkStore, type ChunkState, type ChunkStore } from './chunks';
import type { SnimkaContext } from './context';
import { compareInstant, createReplayModel, ghostsAt } from './positions';
import { SN } from './strings';

/** The whole tram network in one view on a stage about 900 px wide, just inside the zoom from which the marks are pills with their line numbers. */
export const STAGE_ZOOM = PILL_ZOOM + 0.1;
/** Ghost pushes per second at most (the map pushes its own vehicles at the same rate). */
export const GHOST_HZ = 12;
const GHOST_INTERVAL_MS = 1000 / GHOST_HZ;

export interface MapLayerHooks {
  /** The current chunk's state, whenever it changes: 'idle' while nothing is asked for (one hour per second, playing). */
  onMotion(state: ChunkState): void;
}

export interface BikeDiscProps { badge: string; spent: boolean }

/** What a station's disc says for one BAJS byte, as the wall says it (city/curated.ts bikeDisc): a count, a grey
 *  "0" for an empty station, a grey disc without a number when the count is unknown or the station is not renting. */
export function bikeDiscOf(byte: number): BikeDiscProps {
  if (byte === BAJS_MISSING || byte === BAJS_NOT_RENTING) return { badge: '', spent: true };
  return byte > 0 ? { badge: String(byte), spent: false } : { badge: '0', spent: true };
}

/** The five-minute sample index for an instant, clamped to the file (the bytes say 255 where nothing was recorded). */
export function bajsSampleAt(file: Pick<BajsFile, 't0' | 'n'>, atSec: number): number {
  if (file.n <= 0) return -1;
  return Math.max(0, Math.min(file.n - 1, Math.floor((atSec - file.t0) / BAJS_STEP_S)));
}

/** Every station as a city point with the wall's props at the sample; `far` keeps them small dots without a number. */
export function bajsPoints(stations: StationsFile, file: BajsFile, rows: readonly Uint8Array[], sample: number, far: boolean): MapPoint[] {
  if (sample < 0) return [];
  const byId = new Map<string, number>();
  file.stations.forEach((id, i) => byId.set(id, i));
  const out: MapPoint[] = [];
  for (const station of stations.stations) {
    const row = byId.get(station.id);
    const byte = row === undefined ? BAJS_MISSING : rows[row]?.[sample] ?? BAJS_MISSING;
    const disc = bikeDiscOf(byte);
    out.push({
      id: `bajs:${station.id}`, title: station.name, lon: station.lon, lat: station.lat, place: 'city',
      props: { category: 'bikes', badge: disc.badge, spent: disc.spent, eventCount: 0, priority: 2, ...(far ? { far: true } : {}) },
    });
  }
  return out;
}

/** The index of the closures version in force at the instant, or -1 before the first. */
export function closureVersionAt(file: Pick<ClosuresFile, 'versions'>, atSec: number): number {
  let found = -1;
  file.versions.forEach((v, i) => { if (v.fromSec <= atSec) found = i; });
  return found;
}

/** The closures the City published in the version in force whose start has passed; the ends stay as published. */
export function closureLinesAt(file: ClosuresFile, version: number, atSec: number): MapLine[] {
  const list = file.byVersion[version];
  if (!list) return [];
  const out: MapLine[] = [];
  for (const [idx] of list) {
    const c = file.closures[idx];
    if (!c || (c.startSec !== null && c.startSec > atSec) || c.line.length < 2) continue;
    out.push({ id: `closure:${c.id}`, title: c.street, coordinates: c.line });
  }
  return out;
}

const decodeIndex = (raw: unknown): MotionIndex => { if (!isMotionIndex(raw)) throw new SnimkaError('motion index: not a motion index'); return raw; };
const decodeStations = (raw: unknown): StationsFile => { if (!isStationsFile(raw)) throw new SnimkaError('stations: not a stations file'); return raw; };
const decodeBajsFile = (raw: unknown): { file: BajsFile; rows: Uint8Array[] } => { if (!isBajsFile(raw)) throw new SnimkaError('bajs: not a bajs file'); return { file: raw, rows: decodeBajs(raw) }; };
const decodeClosures = (raw: unknown): ClosuresFile => { if (!isClosuresFile(raw)) throw new SnimkaError('closures: not a closures file'); return raw; };

/** Mounts the map into `container` and returns its teardown. Everything async inside degrades to "no vehicles", never to a throw. */
export function mountMapLayer(ctx: SnimkaContext, container: HTMLElement, hooks: MapLayerHooks): () => void {
  const { clock, frames, layers, data, manifest } = ctx;
  let disposed = false;
  let store: ChunkStore | null = null;
  let net395: GraphNetwork | null = null;
  let stations: StationsFile | null = null;
  let bajs: { file: BajsFile; rows: Uint8Array[] } | null = null;
  let closures: ClosuresFile | null = null;
  let far = STAGE_ZOOM < PLACE_NAMES_ZOOM;
  let lastBajsSample = -2;
  let lastClosureVersion = -2;
  let lastFar: boolean | null = null;
  let lastBikesOn: boolean | null = null;
  let nudgeDue = true;
  let lastMotion: ChunkState | null = null;
  /** The motion index could not be read: no chunk is ever asked for, the badge keeps the series' word, no vehicle is drawn. */
  let indexFailed = false;
  let lastGhostAt = -Infinity;
  let ghostsShown = false;

  const network396 = data.get(manifest.networks['396'], decodeNetwork);
  const network395 = data.get(manifest.networks['395'], decodeNetwork);
  network395.then((n) => { net395 = n; }, () => { net395 = null; });

  const handle: CityMapHandle = createCityMap(
    {
      container,
      ariaLabel: SN.stage.mapLabel,
      points: [],
      lines: [],
      reducedMotion: ctx.reducedMotion,
      loadNetwork: () => network396.catch(() => null) as Promise<Network | null>,
      theme: ctx.theme.resolved(),
      cooperative: true,
      attributionCompact: true,
      closures: layers.get().closures,
      cityLabels: 'venues',
      center: ZAGREB_CENTER,
      zoom: STAGE_ZOOM,
      onCamera: (camera) => {
        const next = camera.zoom < PLACE_NAMES_ZOOM;
        if (next !== far) { far = next; frames.kick(); }
      },
    },
    {
      createModel: (net) => {
        const graph = net && 'paths' in net ? (net as GraphNetwork) : null;
        const m = createReplayModel({
          now: () => clock.now(),
          speed: () => clock.speed(),
          vehiclesOn: () => layers.get().vehicles,
          chunksAt: (ms) => store?.at('396', ms / 1000) ?? null,
          net: graph,
        });
        // data-sn-drawn: how many vehicles the last step placed, written where the map steps the model (a browser proof).
        const probed: Model = {
          ...m,
          step(now) {
            const drawn = m.step(now);
            const count = String(drawn.length);
            if (container.dataset.snDrawn !== count) container.dataset.snDrawn = count;
            return drawn;
          },
        };
        return probed;
      },
    },
  );

  void data.get(manifest.files.motionIndex, decodeIndex).then((index) => {
    if (disposed) return;
    store = createChunkStore({ index, load: (ref) => data.get(ref, decodeMotionChunk), onChange: () => { nudgeDue = true; frames.kick(); } });
    frames.kick();
  }, () => { indexFailed = true; frames.kick(); });
  void Promise.all([data.get(manifest.files.stations, decodeStations), data.get(manifest.files.bajs, decodeBajsFile)]).then(([s, b]) => {
    if (disposed) return;
    stations = s;
    bajs = b;
    frames.kick();
  }, () => { /* no stations: the map keeps the network, the vehicles and the closures */ });
  void data.get(manifest.files.closures, decodeClosures).then((c) => {
    if (disposed) return;
    closures = c;
    frames.kick();
  }, () => { /* no closures file: nothing drawn for them */ });

  /** The BAJS points and closure lines for the instant, or null when neither sample moved since the last push. */
  function staticAt(atSec: number): { points: MapPoint[]; lines: MapLine[] } | null {
    const bikesOn = layers.get().bikes;
    const sample = bajs && bikesOn ? bajsSampleAt(bajs.file, atSec) : -1;
    const version = closures ? closureVersionAt(closures, atSec) : -1;
    if (sample === lastBajsSample && version === lastClosureVersion && far === lastFar && bikesOn === lastBikesOn) return null;
    lastBajsSample = sample;
    lastClosureVersion = version;
    lastFar = far;
    lastBikesOn = bikesOn;
    const points = bajs && stations && bikesOn ? bajsPoints(stations, bajs.file, bajs.rows, sample, far) : [];
    const lines = closures && version >= 0 ? closureLinesAt(closures, version, atSec) : [];
    return { points, lines };
  }
  let lastStatic: { points: MapPoint[]; lines: MapLine[] } = { points: [], lines: [] };

  const offFrames = frames.subscribe((t) => {
    if (disposed) return;
    const atSec = t / 1000;
    const speed = clock.speed();
    const playing = clock.playing();
    const compare = layers.get().compare;
    store?.want('396', atSec, speed, playing);
    if (compare) store?.want('395', compareInstant(t) / 1000, speed, playing);

    const motion: ChunkState = indexFailed ? 'idle' : !store ? 'loading' : speed === 3600 && playing ? 'idle' : store.state('396', atSec);
    if (motion !== lastMotion) { lastMotion = motion; hooks.onMotion(motion); }

    const next = staticAt(atSec);
    if (next) lastStatic = next;
    if (next || nudgeDue) {
      nudgeDue = false;
      handle.update(lastStatic.points, lastStatic.lines);
    }

    if (compare && net395 && store && handle.setGhosts) {
      const real = Date.now();
      if (real - lastGhostAt >= GHOST_INTERVAL_MS - 1) {
        lastGhostAt = real;
        const pair = store.at('395', compareInstant(t) / 1000);
        handle.setGhosts(pair ? ghostsAt(pair.current, pair.next, t, net395) : []);
        ghostsShown = true;
      }
    } else if (ghostsShown && handle.setGhosts) {
      handle.setGhosts([]);
      ghostsShown = false;
    }
  });

  const offTick = clock.onTick(() => { nudgeDue = true; });
  const offLayers = layers.onChange((next, previous) => {
    if (next.closures !== previous.closures) handle.setClosuresVisible?.(next.closures);
    nudgeDue = true;
    frames.kick();
  });
  const offTheme = ctx.theme.onChange((theme) => handle.setTheme?.(theme));

  return () => {
    disposed = true;
    offTheme();
    offLayers();
    offTick();
    offFrames();
    store?.destroy();
    handle.destroy();
  };
}
