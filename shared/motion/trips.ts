// Decodes app/public/data/zet-trips.json -- built by scripts/gtfs-trips.mjs
// -- into the compact, DOM-free TripIndex the twin (worker/do/twin-do.ts,
// task A3) bulk-inserts into its own SQLite tables once per GTFS
// feedVersion, so a realtime trip_id resolves in one lookup to its
// direction, headsign, shape (or a `path:` id, task B1), block and pattern.
// The client never loads this file (app/public/data/ artefacts are build
// artefacts of the application, never published under /open); this loader
// exists so the twin and its tests can decode it without duplicating the
// wire shape. DOM-free, imports nothing (R-TE15): the worker's tsc (lib
// ES2022, no DOM) is the guard.
//
// Wire shape (TripIndexWire, what scripts/gtfs-trips.mjs writes) --
// struct-of-arrays throughout (see gtfs-shapes.mjs's toColumnar for the same
// choice and why: repeating field names as literal JSON text on every row
// costs real raw bytes that gzip only partly erases):
//
//   version / feedVersion / builtAt / source: plain metadata.
//   headsigns: string[] -- a dictionary. A pattern's `headsign` is an index
//     into it, holding the *most common* trip_headsign among the pattern's
//     own trips (ties broken alphabetically), because a pattern's trips
//     occasionally carry a handful of one-off headsign variants (a
//     mid-season announcement wording change) that must not each force
//     their own pattern.
//   patterns: one entry per distinct (route_id, direction_id, shape_id-or-
//     '', ordered stop sequence). A shared shape_id says nothing about which
//     stops a trip actually served, so two trips on the same shape but a
//     different stop sequence (a short-turn, an express skip) are different
//     patterns -- the twin's planner (task B4) walks a pattern's own `stops`
//     in order.
//       - shape: '' when the pattern's trips carry no shape_id at all (every
//         trip of tram route 1, in the real feed); task B1 assigns a
//         synthetic `path:` id for these later.
//       - sched[hourBand][pairIdx]: the median scheduled seconds from stop
//         pairIdx's *departure* to stop pairIdx+1's *arrival* (not
//         departure to departure), across every trip of the pattern whose
//         *departure* from stop pairIdx falls in that hour band (0-23,
//         Zagreb wall clock exactly as GTFS records it -- no timezone
//         maths; a time past 24:00 wraps with `% 24`). This excludes the
//         dwell at stop pairIdx (see `dwell` below), which the planner
//         looks up on its own. A cell with zero observations copies the
//         *nearest* hour band (circular distance over the 24-hour cycle, a
//         tie broken toward the lower band index) that has at least one --
//         computed independently per stop pair, because a long pattern's
//         trips can drift across hour boundaries at different pairs, so one
//         pair's populated bands need not match another's.
//       - dwell[stopIdx]: median scheduled departure - arrival at that stop
//         (usually 0; ZET's own stop_times almost never differ).
//       - median, in both of the above: the raw samples are sorted
//         ascending; for an even count this takes the *lower* of the two
//         middle values (index Math.floor((n-1)/2)) rather than averaging
//         them, so every published number is a real observed scheduled
//         interval, never a synthetic average of two. For an odd count this
//         is the ordinary middle.
//   trips: logically id[] (sorted ascending), pattern[]/block[]/service[]
//     (indices into patterns[] / blocks.id[] / services.id[]) and start[]
//     (the first scheduled departure, seconds past service midnight -- GTFS's
//     own clock, so a night trip's start can read past 86400). On the wire
//     two of these are NOT stored literally that way (see "Byte-budget
//     encodings" below): the illustrative shape above is what decodeTripIndex
//     reconstructs, not what scripts/gtfs-trips.mjs writes.
//   blocks.id: every distinct block_id trips.txt references. There is no
//     `blocks.trips` on the wire (contrast an earlier, more literal encoding
//     of this same information): a block's trip ids in departure order are
//     wholly recoverable from trips.block + trips.start, so decodeTripIndex
//     derives `blocks` itself (see below) rather than the artefact repeating
//     it. A block spans more than one route when a vehicle's schedule
//     changes route mid-day (486 blocks in the real feed, 97 of them
//     multi-route).
//   services.id: every distinct service_id trips.txt references.
//
// Byte-budget encodings (measured against the real feed, 77,905 trips): the
// brief's illustrative per-field shape came to 622 KB gzip, 2.5x the 250 KB
// target, almost entirely in three columns -- gzip's 32 KiB back-reference
// window cannot see repetition across a ~78k-entry array, so real,
// measured redundancy was going uncompressed. `blocks.trips` (above) was
// the first fix (~183 KB); the other two are encodings, undone here:
//   - trips.idCommon[i] / trips.idSuffix[i]: front-coding (incremental
//     coding) of the sorted trip id array. ZET's own trip ids are
//     `{service_id}_{block_id}_{route_id}_{sequential}`, so once sorted,
//     neighbouring ids share a long run of that prefix (measured: ~17 of
//     ~19 characters on average) -- idCommon[i] is how many characters id[i]
//     draws from the *previous* id (0 for the first), idSuffix[i] the remainder.
//     chainDecodeIds below reconstructs id[i] as
//     id[i-1].slice(0, idCommon[i]) + idSuffix[i]. Halved this column's real
//     gzip size (measured: 222 KB -> 114 KB).
//   - trips.start[i]: chain-delta encoded (the one-dimensional analogue of
//     gtfs-shapes.mjs's chainEncodeXY): start[0] is the absolute value,
//     start[i>0] is its difference from start[i-1]. A run of trips sharing
//     an id prefix (see above) is that block's own consecutive scheduled
//     trips, whose start times cluster far more tightly than their absolute
//     values (measured median |delta| 2,655 s against absolute values
//     spanning a whole service day). chainDecodeDeltas below reverses this
//     with a running sum. Roughly halved this column's real gzip size too
//     (measured: 150 KB -> 72 KB).
// Both encodings are named identically in scripts/gtfs-trips.mjs
// (chainEncodeIds/chainEncodeDeltas write them; that file also exports its
// own chainDecodeIds/chainDecodeDeltas, used only by its own tests) -- this
// file's decode functions are private and independent, the same relationship
// app/src/motion/network.ts has with gtfs-shapes.mjs's chainEncodeXY/
// chainDecodeXY (a decoder never imports a Node build script; see R-TE15).
//
// Decoded form (TripIndex, what this file hands the twin): every dictionary
// index and every encoding above resolved back to its plain value, so the
// twin's SQLite bulk-insert (A3) writes plain columns and the decoded object
// is discarded once that copy is made -- nothing here is meant to be the
// twin's long-lived state, so plain arrays and one Map are the right shape,
// not a richer index.

/** Struct-of-arrays wire encoding of one pattern's medians: one row per hour
 *  band (24), each row one seconds value per stop pair. */
export type SchedWire = readonly (readonly number[])[];

export interface TripIndexPatternsWire {
  route: string[];
  direction: number[];
  shape: string[];
  /** Index into the top-level `headsigns` dictionary. */
  headsign: number[];
  stops: string[][];
  sched: SchedWire[];
  dwell: number[][];
  trips: number[];
}

export interface TripIndexTripsWire {
  /** Front-coded id[] (sorted ascending): chars shared with the previous id. */
  idCommon: number[];
  /** Front-coded id[]: the remainder after the shared prefix. */
  idSuffix: string[];
  /** Chain-delta encoded index into `patterns.*` (see `start` below for what
   *  that means; the same encoding, reused here because a run of trips
   *  sharing an id prefix usually shares a pattern too). */
  pattern: number[];
  /** Chain-delta encoded index into `blocks.id`. */
  block: number[];
  /** Chain-delta encoded: start[0] absolute, start[i>0] = value - previous value. */
  start: number[];
  /** Index into `services.id`. NOT chain-delta encoded (measured very
   *  slightly larger after gzip that way -- service ids don't cluster with
   *  the trip id's own prefix the way block/route/pattern do). */
  service: number[];
}

export interface TripIndexWire {
  version: number;
  feedVersion: string;
  builtAt: string;
  source: string;
  headsigns: string[];
  patterns: TripIndexPatternsWire;
  trips: TripIndexTripsWire;
  /** No `trips` field here (contrast an earlier, more literal encoding of
   *  this same information) -- see the "Byte-budget encodings" comment above. */
  blocks: { id: string[] };
  services: { id: string[] };
}

/** One decoded pattern: a stop sequence a realtime trip can be pinned to,
 *  with its scheduled inter-stop seconds by hour band and per-stop dwell. */
export interface TripPattern {
  route: string;
  direction: number;
  /** GTFS shape_id, or '' when the pattern's trips carry none (task B1
   *  assigns a `path:` id for these later). */
  shape: string;
  /** Resolved from the wire's headsigns dictionary -- a plain string here,
   *  not an index, since the decoded form exposes no dictionary of its own. */
  headsign: string;
  stops: string[];
  /** sched[hourBand][pairIdx]; see the file header for exactly what this is. */
  sched: number[][];
  dwell: number[];
  /** Trip count backing this pattern (diagnostics only). */
  trips: number;
}

/** One decoded trip: everything a realtime trip_id resolves to in one
 *  lookup, block and service already resolved to their string ids. */
export interface TripRecord {
  /** Index into the TripIndex's own `patterns` array. */
  pattern: number;
  block: string;
  /** First scheduled departure, seconds past service midnight (GTFS's own
   *  clock -- may exceed 86400 for a night trip). */
  start: number;
  service: string;
}

export interface TripIndex {
  feedVersion: string;
  patterns: TripPattern[];
  tripsById: Map<string, TripRecord>;
  /** Block id -> trip ids, in departure order. */
  blocks: Map<string, string[]>;
  /** The median scheduled seconds from stop `fromStopIdx` to the next stop
   *  of pattern `patternIdx`, in hour band `hourBand` (0-23). Every band is
   *  populated (nearest-band fill happened at build time), so this never
   *  needs a fallback of its own. */
  schedSeconds(patternIdx: number, fromStopIdx: number, hourBand: number): number;
}

/** The only version this decoder understands. A cached artefact from a
 *  different build (a different dictionary or column layout) must never be
 *  decoded as if it were this one -- see TripIndexVersionError, the same
 *  pattern app/src/motion/network.ts uses for NetworkVersionError. */
export const SUPPORTED_VERSION = 1;

/** Thrown by decodeTripIndex when `raw.version` is missing or does not
 *  match SUPPORTED_VERSION. */
export class TripIndexVersionError extends Error {
  readonly found: unknown;
  constructor(found: unknown) {
    super(`zet-trips.json: unsupported artefact version ${JSON.stringify(found)}, expected ${SUPPORTED_VERSION}`);
    this.name = 'TripIndexVersionError';
    this.found = found;
  }
}

function isTripIndexWire(raw: unknown): raw is TripIndexWire {
  return typeof raw === 'object' && raw !== null && 'version' in raw;
}

/** Inverse of scripts/gtfs-trips.mjs's chainEncodeIds -- see this file's
 *  "Byte-budget encodings" comment. Independent of that script's own
 *  chainDecodeIds (used only by its tests): a decoder never imports a Node
 *  build script (R-TE15), the same relationship app/src/motion/network.ts
 *  has with gtfs-shapes.mjs's chain encoding. */
function chainDecodeIds(common: readonly number[], suffix: readonly string[]): string[] {
  const ids: string[] = [];
  let prev = '';
  for (let i = 0; i < suffix.length; i++) {
    const id = prev.slice(0, common[i]) + suffix[i];
    ids.push(id);
    prev = id;
  }
  return ids;
}

/** Inverse of scripts/gtfs-trips.mjs's chainEncodeDeltas: a running sum. */
function chainDecodeDeltas(deltas: readonly number[]): number[] {
  const out: number[] = [];
  let sum = 0;
  for (const d of deltas) {
    sum += d;
    out.push(sum);
  }
  return out;
}

export function decodeTripIndex(raw: unknown): TripIndex {
  if (!isTripIndexWire(raw) || raw.version !== SUPPORTED_VERSION) {
    throw new TripIndexVersionError(isTripIndexWire(raw) ? raw.version : undefined);
  }
  const wire = raw;

  const patterns: TripPattern[] = wire.patterns.route.map((route, i) => ({
    route,
    direction: wire.patterns.direction[i],
    shape: wire.patterns.shape[i],
    headsign: wire.headsigns[wire.patterns.headsign[i]] ?? '',
    stops: wire.patterns.stops[i],
    sched: wire.patterns.sched[i].map((row) => [...row]),
    dwell: wire.patterns.dwell[i],
    trips: wire.patterns.trips[i],
  }));

  const tripIds = chainDecodeIds(wire.trips.idCommon, wire.trips.idSuffix);
  const tripStarts = chainDecodeDeltas(wire.trips.start);
  const tripPatterns = chainDecodeDeltas(wire.trips.pattern);
  const tripBlocks = chainDecodeDeltas(wire.trips.block);

  const tripsById = new Map<string, TripRecord>();
  for (let i = 0; i < tripIds.length; i++) {
    tripsById.set(tripIds[i], {
      pattern: tripPatterns[i],
      block: wire.blocks.id[tripBlocks[i]],
      start: tripStarts[i],
      service: wire.services.id[wire.trips.service[i]],
    });
  }

  // `blocks` is not on the wire (see the file header comment): every trip
  // already names its own block (now a resolved string, above), so one pass
  // over the trips -- grouping by block, then sorting each group by the
  // same trip's start -- reconstructs exactly what a literal
  // `blocks.trips` array would have said, at no extra wire cost.
  const blocks = new Map<string, string[]>();
  for (const tripId of tripIds) {
    const block = tripsById.get(tripId)!.block;
    const list = blocks.get(block);
    if (list) list.push(tripId);
    else blocks.set(block, [tripId]);
  }
  for (const list of blocks.values()) {
    list.sort((a, b) => tripsById.get(a)!.start - tripsById.get(b)!.start || (a < b ? -1 : a > b ? 1 : 0));
  }

  return {
    feedVersion: wire.feedVersion,
    patterns,
    tripsById,
    blocks,
    schedSeconds(patternIdx, fromStopIdx, hourBand) {
      return patterns[patternIdx].sched[hourBand][fromStopIdx];
    },
  };
}
