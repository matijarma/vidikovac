// The fleet the timetable declares, decoded from app/public/data/zet-expect.json
// (scripts/gtfs-expect.mjs): for every service of the feed, per five-minute
// slot of its service day, how many vehicle runs (GTFS blocks) are in service,
// all together and by mode, and how many trips per route; and for every date
// the calendar names, which services run. The twin compares what it sees with
// this (upgrade plan U2, decision D1); the grader and the replay load the same
// file, so a replay judges what production would have judged.
//
// A service day starts at GTFS noon minus twelve hours (serviceDayStartSec in
// bands.ts) and its slots run past 24:00, so at 00:30 two service days are in
// service at once: yesterday's night trips and today's first. expectedAt sums
// both. Whenever a service day that could be running at the instant is not in
// the calendar, the answer is marked unknown ('no-calendar') rather than
// guessed: the counts it still carries are the part the calendar does know.

import { serviceDayStartSec } from './bands';

export const EXPECT_VERSION = 1;
/** GTFS route_type values the artefact splits by. */
export const TRAM_ROUTE_TYPE = 0;
export const BUS_ROUTE_TYPE = 3;

export interface ModeSlots {
  all: number[];
  tram: number[];
  bus: number[];
}

export interface ExpectIndexWire {
  version: number;
  feedVersion: string;
  builtAt: string;
  source?: string;
  slotSec: number;
  slots: number;
  services: string[];
  /** YYYY-MM-DD -> indexes into `services`, for every date the calendar names. */
  calendar: Record<string, number[]>;
  routes: { id: string[]; type: number[] };
  /** Service id -> blocks in service per slot. */
  blocks: Record<string, ModeSlots>;
  /** Service id -> route id -> trips in service per slot. */
  trips: Record<string, Record<string, number[]>>;
}

export interface ExpectIndex {
  feedVersion: string;
  builtAt: string;
  slotSec: number;
  slots: number;
  services: string[];
  /** YYYY-MM-DD -> the service ids that run that day. */
  calendar: Map<string, string[]>;
  /** The first and last date the calendar names; null for an empty calendar. */
  firstDate: string | null;
  lastDate: string | null;
  routeType: Map<string, number>;
  blocks: Map<string, ModeSlots>;
  trips: Map<string, Map<string, number[]>>;
}

export interface Expectation {
  /** False when a service day that may be running at the instant is absent from the calendar. */
  known: boolean;
  reason?: 'no-calendar';
  /** Vehicle runs in service in the slot: all, trams, buses. */
  blocks: { all: number; tram: number; bus: number };
  /** Trips in service in the slot, for each route asked for (0 for a route with none). */
  routes: Record<string, number>;
}

export class ExpectIndexError extends Error {
  constructor(message: string) {
    super(`zet-expect.json: ${message}`);
    this.name = 'ExpectIndexError';
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isCounts = (value: unknown, length: number): value is number[] =>
  Array.isArray(value) && value.length === length && value.every((n) => Number.isInteger(n) && n >= 0);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Decodes and checks the wire; throws ExpectIndexError naming the first thing that is wrong. */
export function decodeExpectIndex(raw: unknown): ExpectIndex {
  if (!isObject(raw)) throw new ExpectIndexError('not an object');
  if (raw.version !== EXPECT_VERSION) throw new ExpectIndexError(`version ${String(raw.version)}, this decoder reads ${EXPECT_VERSION}`);
  const wire = raw as unknown as ExpectIndexWire;
  if (typeof wire.feedVersion !== 'string' || wire.feedVersion === '') throw new ExpectIndexError('no feedVersion');
  if (typeof wire.builtAt !== 'string') throw new ExpectIndexError('no builtAt');
  if (!Number.isInteger(wire.slotSec) || wire.slotSec <= 0) throw new ExpectIndexError(`slotSec ${String(wire.slotSec)}`);
  if (!Number.isInteger(wire.slots) || wire.slots <= 0) throw new ExpectIndexError(`slots ${String(wire.slots)}`);
  if (!Array.isArray(wire.services) || !wire.services.every((s) => typeof s === 'string')) throw new ExpectIndexError('services is not a list of ids');
  if (!isObject(wire.calendar)) throw new ExpectIndexError('no calendar');
  if (!isObject(wire.routes) || !Array.isArray(wire.routes.id) || !Array.isArray(wire.routes.type) || wire.routes.id.length !== wire.routes.type.length) {
    throw new ExpectIndexError('routes is not { id[], type[] } of one length');
  }
  if (!isObject(wire.blocks) || !isObject(wire.trips)) throw new ExpectIndexError('no blocks or trips');

  const calendar = new Map<string, string[]>();
  for (const date of Object.keys(wire.calendar).sort()) {
    const list = wire.calendar[date];
    if (!DATE.test(date) || !Array.isArray(list)) throw new ExpectIndexError(`calendar entry ${date}`);
    calendar.set(
      date,
      list.map((i) => {
        const id = wire.services[i];
        if (id === undefined) throw new ExpectIndexError(`calendar ${date} names service index ${String(i)}`);
        return id;
      }),
    );
  }
  const blocks = new Map<string, ModeSlots>();
  for (const [service, modes] of Object.entries(wire.blocks)) {
    if (!isObject(modes) || !isCounts(modes.all, wire.slots) || !isCounts(modes.tram, wire.slots) || !isCounts(modes.bus, wire.slots)) {
      throw new ExpectIndexError(`blocks of service ${service} are not three lists of ${wire.slots} counts`);
    }
    blocks.set(service, { all: modes.all, tram: modes.tram, bus: modes.bus });
  }
  const trips = new Map<string, Map<string, number[]>>();
  for (const [service, byRoute] of Object.entries(wire.trips)) {
    if (!isObject(byRoute)) throw new ExpectIndexError(`trips of service ${service}`);
    const routes = new Map<string, number[]>();
    for (const [route, slots] of Object.entries(byRoute)) {
      if (!isCounts(slots, wire.slots)) throw new ExpectIndexError(`trips of route ${route} in service ${service} are not ${wire.slots} counts`);
      routes.set(route, slots);
    }
    trips.set(service, routes);
  }
  const dates = [...calendar.keys()];
  return {
    feedVersion: wire.feedVersion,
    builtAt: wire.builtAt,
    slotSec: wire.slotSec,
    slots: wire.slots,
    services: [...wire.services],
    calendar,
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
    routeType: new Map(wire.routes.id.map((id, i) => [id, wire.routes.type[i]])),
    blocks,
    trips,
  };
}

const ZAGREB_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zagreb', year: 'numeric', month: '2-digit', day: '2-digit' });

/** YYYY-MM-DD of an instant on Zagreb's calendar. */
export function zagrebDate(epochSec: number): string {
  return ZAGREB_DATE.format(new Date(epochSec * 1000));
}

function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * What the timetable declares at `nowSec`: the runs in service in the slot of
 * today's service day and of yesterday's (whose night trips run past 24:00),
 * summed, and the trips in service on each route of `routes`.
 */
export function expectedAt(index: ExpectIndex, nowSec: number, routes: Iterable<string> = []): Expectation {
  const wanted = [...routes];
  const out: Expectation = { known: true, blocks: { all: 0, tram: 0, bus: 0 }, routes: Object.fromEntries(wanted.map((route) => [route, 0])) };
  const today = zagrebDate(nowSec);
  for (const date of [shiftDate(today, -1), today]) {
    const start = serviceDayStartSec(date.replaceAll('-', ''));
    if (start === null) continue;
    const slot = Math.floor((nowSec - start) / index.slotSec);
    if (slot < 0 || slot >= index.slots) continue;
    const services = index.calendar.get(date);
    if (services === undefined) {
      out.known = false;
      out.reason = 'no-calendar';
      continue;
    }
    for (const service of services) {
      const modes = index.blocks.get(service);
      if (modes) {
        out.blocks.all += modes.all[slot];
        out.blocks.tram += modes.tram[slot];
        out.blocks.bus += modes.bus[slot];
      }
      const byRoute = index.trips.get(service);
      if (!byRoute) continue;
      for (const route of wanted) out.routes[route] += byRoute.get(route)?.[slot] ?? 0;
    }
  }
  return out;
}
