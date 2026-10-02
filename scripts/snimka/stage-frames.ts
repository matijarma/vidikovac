// Stage `frames` (lane S1): the recorded ZET frames of one segment replayed
// through the product's own twin (replayPublished), turned into the minute
// series of what the twin saw and judged, and into ten-minute motion chunks
// of the vehicles it published. Raw frames never leave this stage: a chunk
// holds only the positions the twin's plans put each published vehicle at,
// every ten seconds, as metres along the engine's own paths and shapes.
//
// Resampling: for each tick T (every 10 s from the segment start) the latest
// payload whose header is at most 30 s before T; each of its pins is placed
// where its published plan puts it at T minus the header. No payload in the
// 30 s before T: no sample (a gap, never a zero). Depot and parked vehicles
// are not on the wire, so they are counted (feed.hidden*) and never placed.
//
// v2 (lane V1) adds, from the same pass: per 5-minute slot the distinct
// published vehicles of each route with a position at any tick of the slot
// (work/routes-seen-<segment>.json, the routes stage's input); per minute the
// minute's last zet-rt payload trimmed to what the wall at Jelačić reads (the
// vehicles within 3 km, every non-vehicle item, the sources and the header)
// as one gzip JSON line (work/wall-window.jsonl.gz, window only, the voice
// stage's input); and the feed columns frozen, alerts and cancelledTrips.

import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { createGzip, gzipSync } from 'node:zlib';
import { loadRealEngine, loadZetRoutesFile, replayPublished, type PublishedTick } from '../replay-core';
import { evalFreePlan, evalPathPlan } from '../../shared/motion/plan';
import type { FreeKnot, PathKnot } from '../../shared/motion/track';
import { encodeMotionChunk, type MotionSample } from '../../shared/snimka-codec';
import { FROZEN_AFTER_S, MOTION_CHUNK_S, MOTION_STEP_S, MOTION_TICKS, ROUTES_STEP_S, ZAGREB_OFFSET_S, type Col, type SnimkaState } from '../../shared/snimka';
import type { ItemInput } from '../../worker/feed/payload';
import { writeObject, writeWork, type Paths } from './paths';
import { loadSegmentExpect, ROUTES_FILE, segmentOf, type SegmentKey } from './segments';

/** A payload is used for a tick at most this long after its header. */
export const SAMPLE_HOLD_S = 30;
/** Budget of one chunk, gzip bytes (brief section 5). */
export const CHUNK_GZIP_MAX = 150_000;

export type Hold = 'below-min' | 'no-calendar' | 'gap';

/** The wall's place (Trg bana J. Jelačića, stop 106_1) and the radius of the trimmed voice snapshot. */
export const WALL_LONLAT: [number, number] = [15.97726, 45.81286];
export const WALL_RADIUS_M = 3000;

/** Distinct published vehicles per route and 5-minute slot; `covered[j]` false = no sampled tick in the slot. */
export interface RoutesSeenWork { segment: SegmentKey; t0: number; step: 300; n: number; covered: boolean[]; routes: Record<string, number[]> }

/** One line of work/wall-window.jsonl.gz: the minute's last zet-rt payload, trimmed. */
export interface WallLine { m: number; h: number; sourceUpdatedAt: string | null; validUntil: string | null; sources: unknown; items: ItemInput[] }

/** Metres between two lon/lat points (equirectangular; ample at 3 km). */
export function metresBetween(a: readonly [number, number], b: readonly [number, number]): number {
  const k = Math.PI / 180;
  const x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k);
  const y = (b[1] - a[1]) * k;
  return Math.hypot(x, y) * 6_371_000;
}

/** The operator's own counts of a tick: the twin's summary where it computed one, else the frame's Alert entities and CANCELED trip updates. */
export function operatorCounts(tick: PublishedTick): { alerts: number; cancelledTrips: number } {
  const op = (tick.payload.sources?.['zet'] as { service?: { operator?: { cancelledTrips?: unknown; noServiceAlerts?: unknown } } } | undefined)?.service?.operator;
  if (op && Number.isInteger(op.cancelledTrips) && Number.isInteger(op.noServiceAlerts)) return { alerts: op.noServiceAlerts as number, cancelledTrips: op.cancelledTrips as number };
  return { alerts: tick.raw.alerts, cancelledTrips: tick.raw.canceled };
}

/** The wall's trimmed copy of a payload: every non-vehicle item, the vehicles within WALL_RADIUS_M of Jelačić. */
export function trimForWall(items: readonly ItemInput[]): ItemInput[] {
  return items.filter((item) => {
    if (!item.id.startsWith('vehicle:')) return true;
    if (!item.geo || item.geo.type !== 'Point') return false;
    return metresBetween(WALL_LONLAT, item.geo.coordinates as [number, number]) <= WALL_RADIUS_M;
  });
}

export interface MinutesWork {
  segment: SegmentKey;
  t0: number;
  n: number;
  frames: number;
  dropped: number;
  seen: { all: Col<number>; tram: Col<number>; bus: Col<number> };
  service: { state: Col<SnimkaState>; since: Col<number>; ratio: Col<number>; hold: Col<Hold> };
  feed: { headerAgeS: Col<number>; entities: Col<number>; rejectedFuture: Col<number>; hiddenDepot: Col<number>; hiddenParked: Col<number>;
          frozen: Col<0 | 1>; alerts: Col<number>; cancelledTrips: Col<number> };
}

export interface ChunkWork { path: string; sha256: string; bytes: number; gzip: number; net: '395' | '396'; t0: number; vehicles: number }
export interface MotionWork { segment: SegmentKey; net: '395' | '396'; chunks: ChunkWork[] }

/** `YYYYMMDD-HHMM` of an instant on Zagreb's clock (CEST all through the dataset). */
export function zagrebStamp(sec: number): string {
  const iso = new Date((sec + ZAGREB_OFFSET_S) * 1000).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}`;
}

interface Pin {
  id: string;
  route: string | null;
  label: string | null;
  kind: 0 | 3 | null;
  at(tRel: number): MotionSample;
}

const blank = (n: number): null[] => new Array<null>(n).fill(null);

export async function stageFrames(paths: Paths, key: SegmentKey, log: (line: string) => void): Promise<{ minutes: MinutesWork; motion: MotionWork }> {
  const seg = segmentOf(paths, key);
  const engine = await loadRealEngine(seg.network, seg.trips, seg.overrides);
  const expect = await loadSegmentExpect(paths, key);
  const routes = await loadZetRoutesFile(ROUTES_FILE(paths));
  const net = engine.net;
  const pathIndex = new Map(net.paths.map((p, i) => [p.id, i] as const));
  const shapeIndex = new Map(net.shapes.map((s, i) => [s.id, i] as const));
  const n = seg.minutes;
  const t0 = seg.fromSec;
  const end = t0 + n * 60;

  const minutes: MinutesWork = {
    segment: key, t0, n, frames: 0, dropped: 0,
    seen: { all: blank(n), tram: blank(n), bus: blank(n) },
    service: { state: blank(n), since: blank(n), ratio: blank(n), hold: blank(n) },
    feed: { headerAgeS: blank(n), entities: blank(n), rejectedFuture: blank(n), hiddenDepot: blank(n), hiddenParked: blank(n), frozen: blank(n), alerts: blank(n), cancelledTrips: blank(n) },
  };
  // ---- routes seen per 5-minute slot ----------------------------------------------
  const slots = Math.ceil((n * 60) / ROUTES_STEP_S);
  const covered = new Array<boolean>(slots).fill(false);
  const seenIds = new Map<string, Set<string>[]>();
  const markSeen = (T: number, route: string, id: string): void => {
    const j = Math.floor((T - t0) / ROUTES_STEP_S);
    let perSlot = seenIds.get(route);
    if (!perSlot) {
      perSlot = Array.from({ length: slots }, () => new Set<string>());
      seenIds.set(route, perSlot);
    }
    perSlot[j].add(id);
  };
  // ---- the wall's trimmed payload per minute (window only) -------------------------
  const wallOut = key === 'window' ? createGzip({ level: 6 }) : null;
  const wallDone = wallOut ? new Promise<void>((resolve, reject) => {
    const file = createWriteStream(join(paths.work, 'wall-window.jsonl.gz'));
    file.on('finish', () => resolve());
    file.on('error', reject);
    wallOut.on('error', reject);
    wallOut.pipe(file);
  }) : Promise.resolve();
  let wallPending: WallLine | null = null;
  let wallLines = 0;
  const flushWall = (): void => {
    if (!wallOut || !wallPending) return;
    wallOut.write(`${JSON.stringify(wallPending)}\n`);
    wallLines++;
    wallPending = null;
  };
  const lastHeaderOf: (number | null)[] = blank(n);
  const hadFrame: boolean[] = new Array<boolean>(n).fill(false);

  // ---- the pins of a payload, as motion samples --------------------------------
  const clampS = (s: number, len: number): number => Math.min(Math.max(s, 0), len);
  function pinOf(item: ItemInput): Pin {
    const data = (item.data ?? {}) as Record<string, unknown>;
    const routeType = data['routeType'];
    const head = {
      id: String(data['vehicleId'] ?? item.id.slice('vehicle:'.length)),
      route: typeof data['routeId'] === 'string' ? (data['routeId'] as string) : null,
      label: typeof data['routeShortName'] === 'string' ? (data['routeShortName'] as string) : null,
      kind: routeType === 0 ? 0 : routeType === 3 ? 3 : null,
    } as const;
    const motion = item.motion as { path?: string; plan?: unknown[] } | undefined;
    const [lon0, lat0] = item.geo && item.geo.type === 'Point' ? (item.geo.coordinates as [number, number]) : [NaN, NaN];
    const still: MotionSample = { on: 2, idx: -1, lon: lon0, lat: lat0 };
    if (motion?.plan && typeof motion.path === 'string') {
      const knots = motion.plan as PathKnot[];
      // As the client resolves a plan's geometry (app/src/motion/integrator.ts): a graph path first, else a bus shape.
      const p = pathIndex.get(motion.path);
      if (p !== undefined) return { ...head, at: (t) => ({ on: 0, idx: p, s: clampS(evalPathPlan(knots, t), net.paths[p].len) }) };
      const s = shapeIndex.get(motion.path);
      if (s !== undefined) return { ...head, at: (t) => ({ on: 1, idx: s, s: clampS(evalPathPlan(knots, t), net.shapes[s].len) }) };
      return { ...head, at: () => still };
    }
    if (motion?.plan) {
      const knots = motion.plan as FreeKnot[];
      return { ...head, at: (t) => { const [lon, lat] = evalFreePlan(knots, t); return { on: 2, idx: -1, lon, lat }; } };
    }
    return { ...head, at: () => still };
  }

  // ---- ten-minute chunks --------------------------------------------------------
  interface Builder { c: number; covered: number; vehicles: Map<string, { id: string; route: string | null; label: string | null; kind: 0 | 3 | null; samples: (MotionSample | null)[] }> }
  const motion: MotionWork = { segment: key, net: seg.net, chunks: [] };
  let builder: Builder | null = null;
  const finalize = (b: Builder | null): void => {
    if (!b || b.covered === 0) return;
    const chunkT0 = t0 + b.c * MOTION_CHUNK_S;
    const chunk = encodeMotionChunk({ net: seg.net, t0: chunkT0, vehicles: [...b.vehicles.values()] });
    const json = JSON.stringify(chunk);
    const gzip = gzipSync(json).length;
    if (gzip > CHUNK_GZIP_MAX) throw new Error(`frames: chunk ${zagrebStamp(chunkT0)} is ${gzip} bytes gzip, over ${CHUNK_GZIP_MAX}`);
    const ref = writeObject(paths, `motion/${seg.net}/${zagrebStamp(chunkT0)}`, 'json', json);
    motion.chunks.push({ ...ref, gzip, net: seg.net, t0: chunkT0, vehicles: new Set(chunk.vehicles.map((v) => v.id)).size });
  };
  let current: { headerSec: number; pins: Pin[] } | null = null;
  let nextTick = t0;
  const sample = (T: number): void => {
    const c = Math.floor((T - t0) / MOTION_CHUNK_S);
    if (!builder || builder.c !== c) {
      finalize(builder);
      builder = { c, covered: 0, vehicles: new Map() };
    }
    if (!current || T - current.headerSec > SAMPLE_HOLD_S) return;
    builder.covered++;
    if (T >= t0) covered[Math.floor((T - t0) / ROUTES_STEP_S)] = true;
    const k = (T - t0 - c * MOTION_CHUNK_S) / MOTION_STEP_S;
    for (const pin of current.pins) {
      // A vehicle that changes route inside a chunk is a new entry under the same id.
      const id = `${pin.id}\t${pin.route ?? ''}`;
      let v = builder.vehicles.get(id);
      if (!v) {
        v = { id: pin.id, route: pin.route, label: pin.label, kind: pin.kind, samples: new Array<MotionSample | null>(MOTION_TICKS).fill(null) };
        builder.vehicles.set(id, v);
      }
      const s = pin.at(T - current.headerSec);
      v.samples[k] = s.on === 2 && !(Number.isFinite(s.lon) && Number.isFinite(s.lat)) ? null : s;
      if (v.samples[k] !== null && pin.route !== null && T >= t0) markSeen(T, pin.route, pin.id);
    }
  };
  const flushBefore = (limitSec: number): void => {
    while (nextTick < limitSec && nextTick < end) {
      sample(nextTick);
      nextTick += MOTION_STEP_S;
    }
  };

  // ---- the replay -----------------------------------------------------------------
  let lastLogHour = -1;
  const onTick = (tick: PublishedTick): void => {
    const h = tick.headerSec;
    flushBefore(h);
    current = { headerSec: h, pins: tick.payload.items.filter((item) => item.id.startsWith('vehicle:')).map(pinOf) };
    const m = Math.floor((h - t0) / 60);
    if (m < 0 || m >= n) return;
    if (wallOut) {
      if (wallPending && wallPending.m !== m) flushWall();
      const p = tick.payload;
      wallPending = { m, h, sourceUpdatedAt: p.sourceUpdatedAt ?? null, validUntil: p.validUntil ?? null, sources: p.sources ?? null, items: trimForWall(p.items) };
    }
    const op = operatorCounts(tick);
    minutes.feed.alerts[m] = op.alerts;
    minutes.feed.cancelledTrips[m] = op.cancelledTrips;
    const pins = tick.payload.items.filter((item) => item.id.startsWith('vehicle:'));
    let tram = 0;
    for (const item of pins) if ((item.data as Record<string, unknown> | undefined)?.['routeType'] === 0) tram++;
    minutes.seen.all[m] = tick.payload.sources?.zet?.itemCount ?? pins.length;
    minutes.seen.tram[m] = tram;
    minutes.seen.bus[m] = pins.length - tram;
    const svc = tick.service;
    minutes.service.state[m] = svc.state;
    minutes.service.since[m] = svc.sinceSec;
    minutes.service.ratio[m] = svc.last?.ratio ?? null;
    minutes.service.hold[m] = svc.reason === 'below-min' ? 'below-min' : svc.reason === 'no-calendar' ? 'no-calendar' : null;
    minutes.feed.entities[m] = tick.entities;
    minutes.feed.rejectedFuture[m] = Math.max(minutes.feed.rejectedFuture[m] ?? 0, tick.rejectedFuture);
    minutes.feed.hiddenDepot[m] = tick.hidden.depot;
    minutes.feed.hiddenParked[m] = tick.hidden.parked;
    lastHeaderOf[m] = h;
    hadFrame[m] = true;
    const hour = Math.floor(m / 60);
    if (hour !== lastLogHour && hour % 6 === 0) {
      lastLogHour = hour;
      log(`frames ${key}: ${zagrebStamp(h)} seen ${minutes.seen.all[m]} state ${svc.state}`);
    }
  };
  const result = await replayPublished(seg.dirs, engine, { expect, routes, fromSec: t0 - seg.warmupSec, toSec: end, onTick });
  flushBefore(end);
  finalize(builder);
  flushWall();
  wallOut?.end();
  await wallDone;
  minutes.frames = result.frames;
  minutes.dropped = result.dropped;

  // Minutes without a frame: the state carried, the hold `gap`, every count null;
  // the header age runs on from the newest header seen.
  let lastHeader: number | null = null;
  for (let m = 0; m < n; m++) {
    if (lastHeaderOf[m] !== null) lastHeader = lastHeaderOf[m];
    const minuteEnd = t0 + (m + 1) * 60;
    minutes.feed.headerAgeS[m] = lastHeader === null ? null : minuteEnd - lastHeader;
    minutes.feed.frozen[m] = lastHeader === null ? null : minuteEnd - lastHeader > FROZEN_AFTER_S ? 1 : 0;
    if (!hadFrame[m]) {
      minutes.service.state[m] = m > 0 ? minutes.service.state[m - 1] : null;
      minutes.service.since[m] = m > 0 ? minutes.service.since[m - 1] : null;
      minutes.service.hold[m] = 'gap';
    }
  }
  const routesSeen: RoutesSeenWork = { segment: key, t0, step: ROUTES_STEP_S, n: slots, covered, routes: {} };
  for (const [route, perSlot] of [...seenIds].sort((a, b) => a[0].localeCompare(b[0]))) routesSeen.routes[route] = perSlot.map((ids) => ids.size);
  writeWork(paths, `routes-seen-${key}.json`, routesSeen);
  writeWork(paths, `minutes-${key}.json`, minutes);
  writeWork(paths, `motion-${key}.json`, motion);
  log(`frames ${key}: ${result.frames} frames (${result.dropped} dropped), ${motion.chunks.length} chunks, largest ${Math.max(0, ...motion.chunks.map((c) => c.gzip))} B gzip, ${seenIds.size} routes seen, ${covered.filter(Boolean).length} of ${slots} slots covered${wallOut ? `, ${wallLines} wall minutes` : ''}`);
  return { minutes, motion };
}
