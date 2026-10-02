// Stage `events` (lane S1): the chapters and markers of the committed
// scripts/snimka/events.json, every derived one resolved against the replayed
// window series, every source link checked against the recordings; and ZET's
// strike notices (ids 10164 to 10168) from its recorded news RSS: the title as
// first recorded, the link and the time. The notice text is not republished:
// ZET's RSS terms are unpublished (docs/izvori.md), so the page links to it.
// v2 (lane V1): every event and notice carries focus, facts and mentions (and
// an event spot and dwellS), from its entry or the defaults of
// focus-defaults.ts, each id validated against the routes file, the stations
// file, places.json and stops.json.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventsFile, HashedRef, NoticesFile, PlacesFile, RoutesFile, SeriesFile, SnimkaEvent, SnimkaState, StationsFile } from '../../shared/snimka';
import { eventDefaults, noticeDefaults, resolvePointers, withDefaults, type Known, type Pointers } from './focus-defaults';
import type { BajsRefs } from './stage-bajs';
import { parseRss, publishNews, type NewsWorkItem } from './stage-news';
import { readWork, writeJsonObject, writeWork, type Paths } from './paths';

export const NOTICE_IDS = [10164, 10165, 10166, 10167, 10168] as const;
const REPO_COMMIT = /^https:\/\/github\.com\/matijarma\/vidikovac\/commit\/[0-9a-f]{7,40}$/;
/** Sources the recordings hold outside the RSS: ZET's timetable download, whose Last-Modified strike/gtfs-head.log recorded. */
export const KNOWN_SOURCES = new Set(['https://www.zet.hr/gtfs-scheduled/latest']);

export interface EventsRefs { events: HashedRef; notices: HashedRef; count: number; chapters: number }

type Rule =
  | { kind: 'fleet-below'; value: number; after: string; holdMin?: number }
  | { kind: 'entities-zero'; after: string; holdMin?: number }
  | { kind: 'header-age-over'; value: number; after: string }
  | { kind: 'seen-rising-past'; value: number; after: string; holdMin?: number }
  | { kind: 'first-state'; value: SnimkaState; after: string };

interface EventEntry extends Partial<Pointers> { id: string; at?: string; rule?: Rule; kind: SnimkaEvent['kind']; title: string; text: string | null; sources: SnimkaEvent['sources']; chapter: boolean }
interface NoticeFocusEntry extends Partial<Pointers> { id: number }

/** The ids an item may point at: the window's routes, the BAJS stations, places.json and the network's stops. */
export function loadKnown(paths: Paths): Known {
  const routes = readWork<RoutesFile>(paths, 'routes-window.json');
  const places = readWork<PlacesFile>(paths, 'places.json');
  const bajs = readWork<BajsRefs>(paths, 'bajs-refs.json');
  const stations = JSON.parse(readFileSync(join(paths.objects, bajs.stations.path), 'utf8')) as StationsFile;
  const stops = JSON.parse(readFileSync(join(paths.repo, 'app/public/data/stops.json'), 'utf8')) as { id: string }[];
  return {
    routes: new Set(routes.routes.map((r) => r.id)),
    stations: new Set(stations.stations.map((s) => s.id)),
    places: new Map(places.places.map((p) => [p.id, { name: p.name, lonLat: p.lonLat, zoom: p.zoom }] as const)),
    stops: new Set(stops.map((s) => s.id)),
  };
}

const isoSec = (iso: string): number => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error(`events: ${iso} is not a time`);
  return Math.floor(ms / 1000);
};

/** The instant a derived event's rule names in the window series, or null when nothing in the series meets it. */
export function resolveRule(series: SeriesFile, rule: Rule): number | null {
  const after = isoSec(rule.after);
  const start = Math.max(0, Math.ceil((after - series.t0) / 60));
  const holds = (m: number, test: (i: number) => boolean | null, minutes: number): boolean => {
    let seen = 0;
    for (let i = m; i < series.n && seen < minutes; i++) {
      const ok = test(i);
      if (ok === null) continue; // a minute without data neither confirms nor breaks
      if (!ok) return false;
      seen++;
    }
    return seen >= minutes;
  };
  const at = (m: number): number => series.t0 + m * 60;
  for (let m = start; m < series.n; m++) {
    switch (rule.kind) {
      case 'fleet-below':
      case 'seen-rising-past': {
        const test = (i: number): boolean | null => {
          const v = series.seen.all[i];
          if (v === null) return null;
          return rule.kind === 'fleet-below' ? v < rule.value : v >= rule.value;
        };
        if (test(m) === true && holds(m, test, rule.holdMin ?? 1)) return at(m);
        break;
      }
      case 'entities-zero': {
        const test = (i: number): boolean | null => (series.feed.entities[i] === null ? null : series.feed.entities[i] === 0);
        if (test(m) === true && holds(m, test, rule.holdMin ?? 1)) return at(m);
        break;
      }
      case 'header-age-over': {
        const age = series.feed.headerAgeS[m];
        // The event is the frozen header itself, not the minute the age crossed the threshold.
        if (age !== null && age > rule.value) return at(m) + 60 - age;
        break;
      }
      case 'first-state': {
        if (series.service.state[m] !== rule.value || series.service.hold[m] === 'gap') break;
        const since = series.service.since[m];
        return since !== null && since >= after ? since : at(m);
      }
    }
  }
  return null;
}

/** ZET's notices of the strike from the recorded news feed: the first recorded title, the link and the time. */
export function readNotices(dir: string, pointers: (id: number) => Pointers = noticeDefaults): NoticesFile {
  const byId = new Map<number, NoticesFile['items'][number]>();
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.xml')).sort()) {
    for (const item of parseRss(readFileSync(join(dir, name), 'utf8'))) {
      const id = Number(/[?&]id=(\d+)/.exec(item.link)?.[1]);
      if (!(NOTICE_IDS as readonly number[]).includes(id) || byId.has(id) || item.pubSec === null) continue;
      const p = pointers(id);
      byId.set(id, { id, title: item.title, text: null, link: item.link, pubSec: item.pubSec, focus: p.focus, facts: p.facts, mentions: p.mentions });
    }
  }
  const missing = NOTICE_IDS.filter((id) => !byId.has(id));
  if (missing.length > 0) throw new Error(`events: ZET notices ${missing.join(', ')} are not in the recorded RSS`);
  return { v: 2, items: [...byId.values()].sort((a, b) => a.pubSec - b.pubSec) };
}

export async function stageEvents(paths: Paths, log: (line: string) => void): Promise<boolean> {
  const series = readWork<SeriesFile>(paths, 'series-window.json');
  const doc = JSON.parse(readFileSync(join(paths.repo, 'scripts/snimka/events.json'), 'utf8')) as { events: EventEntry[] };
  const known = loadKnown(paths);
  // The curated headlines are published here, where the routes and places they point at exist.
  publishNews(paths, known, log);
  const noticeEntries = new Map((JSON.parse(readFileSync(join(paths.repo, 'scripts/snimka/notices-focus.json'), 'utf8')) as { items: NoticeFocusEntry[] }).items.map((e) => [e.id, e] as const));
  for (const id of noticeEntries.keys()) if (!(NOTICE_IDS as readonly number[]).includes(id)) throw new Error(`events: notices-focus.json names notice ${id}, which is not one of ${NOTICE_IDS.join(', ')}`);
  const notices = readNotices(join(paths.inputs, 'strike', 'rss', 'novosti'), (id) => {
    const { spot: _s, dwellS: _d, ...p } = resolvePointers(`notice ${id}`, withDefaults(noticeEntries.get(id) ?? {}, noticeDefaults(id)), known);
    return p;
  });
  const press = new Set(readWork<NewsWorkItem[]>(paths, 'news-items.json').map((i) => i.link));
  const zetLinks = new Set<string>();
  for (const feed of ['novosti', 'promet']) {
    const dir = join(paths.inputs, 'strike', 'rss', feed);
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.xml'))) for (const item of parseRss(readFileSync(join(dir, name), 'utf8'))) zetLinks.add(item.link);
  }
  const ids = new Set<string>();
  const events: SnimkaEvent[] = [];
  for (const e of doc.events) {
    if (ids.has(e.id)) throw new Error(`events: id ${e.id} twice`);
    ids.add(e.id);
    if ((e.at === undefined) === (e.rule === undefined)) throw new Error(`events: ${e.id} needs exactly one of at and rule`);
    for (const s of e.sources) {
      const held = zetLinks.has(s.url) || press.has(s.url) || KNOWN_SOURCES.has(s.url) || (e.kind === 'recording' && REPO_COMMIT.test(s.url));
      if (!held) throw new Error(`events: ${e.id} cites ${s.url}, which the recordings do not hold`);
    }
    if (e.kind !== 'recording' && e.rule === undefined && e.sources.length === 0) throw new Error(`events: ${e.id} is human-sourced and has no source`);
    const atSec = e.rule ? resolveRule(series, e.rule) : isoSec(e.at!);
    if (atSec === null) throw new Error(`events: the rule of ${e.id} (${JSON.stringify(e.rule)}) finds nothing in the window series`);
    const p = resolvePointers(`event ${e.id}`, withDefaults(e, eventDefaults(e.id)), known);
    if (e.chapter && p.spot === undefined) throw new Error(`events: chapter ${e.id} has no spot`);
    events.push({ id: e.id, atSec, kind: e.kind, title: e.title, text: e.text, sources: e.sources, derived: e.rule !== undefined, chapter: e.chapter, focus: p.focus, facts: p.facts, mentions: p.mentions,
      ...(p.spot !== undefined ? { spot: p.spot } : {}), ...(p.dwellS !== undefined ? { dwellS: p.dwellS } : {}) });
  }
  events.sort((a, b) => a.atSec - b.atSec || a.id.localeCompare(b.id));
  const eventsRef = writeJsonObject(paths, 'events/window', { v: 1, events } satisfies EventsFile);
  const noticesRef = writeJsonObject(paths, 'notices/window', notices);
  writeWork(paths, 'events-refs.json', { events: eventsRef, notices: noticesRef, count: events.length, chapters: events.filter((e) => e.chapter).length } satisfies EventsRefs);
  const zagreb = (sec: number): string => new Date((sec + 7200) * 1000).toISOString().slice(5, 16).replace('T', ' ');
  for (const e of events.filter((x) => x.derived)) log(`events: ${e.id} resolved to ${zagreb(e.atSec)} Zagreb`);
  log(`events: ${events.length} events (${events.filter((e) => e.chapter).length} chapters, ${events.filter((e) => e.derived).length} derived), ${notices.items.length} ZET notices`);
  return true;
}
