// The wall's eight fake-clock scenes (brief §16.3): the hours the research
// observed on 21–22 September, pinned as instants so every run of the wall
// spec sees the same evening peak, the same last trams, the same night.
// Zagreb is UTC+2 on both days (CEST), so 17:45 Zagreb is Date.UTC(…, 15, 45).
//
// Each scene says what a correct wall shows at that hour with the fixtures of
// e2e/departures-fixture.ts (ZET's last-departure table for Trg bana
// Jelačića: 12 at 23:45 … 14 at 24:31, first tram 04:16) and the solar theme
// (sunset 18:57 on 21 September, sunrise 06:42 on 22 September at Zagreb,
// app/src/ui/solar.ts). The wall spec (e2e/accept/wall.spec.ts) reads the
// expectations from here and asserts nothing about an hour this file does not
// state.
import type { NearbyKind } from '../app/src/city/nearby';
import type { FixtureState } from './experience-fixtures';

export type SceneId = 'peak1745' | 'late2130' | 'lastTrams2240' | 'afterLast0045' | 'night0430' | 'morning0745' | 'midday1230' | 'outage0800';

export interface SceneExpect {
  /** Kinds that must be on the list (departures in every scene, [O-65]). */
  requiredKinds: readonly NearbyKind[];
  /** Kinds whose `data-when` must not lie before the scene's now (a last tram that has left, an event that is over). */
  noPastKinds: readonly NearbyKind[];
  /** Solar rows per reading: at most 1 always (only the next event); at least 1 where the next sunset or sunrise lies inside the shown horizon. */
  solarMin: 0 | 1;
  /** Rows with `data-live="1"`: at least this many (morning0745: the fixture tracks two trips). */
  liveMin: number;
  /** At most this many live rows; null when unbounded. The outage allows none. */
  liveMax: number | null;
  /** The map's `data-feed` reads 'live'. */
  feedLive: boolean;
  /** `[data-testid=map-note]` count: the one quiet outage note. */
  mapNotes: 0 | 1;
  /** Vehicle pills drawn: 'any' (buses and trams on the frame at every hour, [O-71]) or 'none' (no live vehicles in the outage). */
  pills: 'any' | 'none';
  /** Every departure row prints a clock time (`<time>`): the outage has no countdowns. */
  departuresAsClockTimes: boolean;
  /** A pattern the header sentence must never match in this scene. */
  sentenceNot: RegExp | null;
  /** A pattern no heading (`h1, h2`) nor the sentence may match. */
  headingNot: RegExp | null;
}

export interface Scene {
  id: SceneId;
  /** The instant `page.clock.install({ time })` starts at. */
  now: number;
  /** The same instant as Zagreb wall time, for titles and file names. */
  zagreb: string;
  /** The kiosk feed fixture's state (e2e/experience-fixtures.ts installKioskFeedFixture). */
  feedState: FixtureState;
  /** `data-theme-resolved` under the solar preference. */
  theme: 'light' | 'dark';
  expect: SceneExpect;
}

const base: SceneExpect = {
  requiredKinds: ['departure'],
  noPastKinds: [],
  solarMin: 0,
  liveMin: 0,
  liveMax: null,
  feedLive: true,
  mapNotes: 0,
  pills: 'any',
  departuresAsClockTimes: false,
  sentenceNot: null,
  headingNot: null,
};

const scene = (id: SceneId, now: number, zagreb: string, theme: 'light' | 'dark', expect: Partial<SceneExpect> = {}, feedState: FixtureState = 'ready'): Scene =>
  Object.freeze({ id, now, zagreb, feedState, theme, expect: Object.freeze({ ...base, ...expect }) });

export const SCENES: Readonly<Record<SceneId, Scene>> = Object.freeze({
  /** Monday evening peak; sunset at 18:57 is the next solar event. */
  peak1745: scene('peak1745', Date.UTC(2026, 8, 21, 15, 45), '2026-09-21 17:45', 'light', { solarMin: 1 }),
  /** Late evening, after sunset. */
  late2130: scene('late2130', Date.UTC(2026, 8, 21, 19, 30), '2026-09-21 21:30', 'dark'),
  /** Last trams tonight (one row listing the lines, from T−4 h) and the first tram (from 22:00). */
  lastTrams2240: scene('lastTrams2240', Date.UTC(2026, 8, 21, 20, 40), '2026-09-21 22:40', 'dark', { requiredKinds: ['departure', 'last', 'first'] }),
  /** 00:45, after the last departure at 24:31: no last-tram row whose time has passed, no "zadnji" in the sentence [O-41]; the first tram stays. */
  afterLast0045: scene('afterLast0045', Date.UTC(2026, 8, 21, 22, 45), '2026-09-22 00:45', 'dark', { requiredKinds: ['departure', 'first'], noPastKinds: ['last'], sentenceNot: /zadnji/i }),
  /** Quiet hour: dark palette, the first tram, the pharmacy on duty; sunrise at 06:42 is the next solar event. */
  night0430: scene('night0430', Date.UTC(2026, 8, 22, 2, 30), '2026-09-22 04:30', 'dark', { requiredKinds: ['departure', 'first', 'pharmacy'], noPastKinds: ['event'], solarMin: 1 }),
  /** Morning peak: at least one tracked countdown (the departures fixture joins two vehicles by trip id). */
  morning0745: scene('morning0745', Date.UTC(2026, 8, 22, 5, 45), '2026-09-22 07:45', 'light', { liveMin: 1 }),
  /** Midday. */
  midday1230: scene('midday1230', Date.UTC(2026, 8, 22, 10, 30), '2026-09-22 12:30', 'light'),
  /** ZET's real-time feed down: timetable times only, no vehicles, one note on the map, never "unavailable" as a headline (principle 9). */
  outage0800: scene('outage0800', Date.UTC(2026, 8, 22, 6, 0), '2026-09-22 08:00', 'light', {
    liveMax: 0, feedLive: false, mapNotes: 1, pills: 'none', departuresAsClockTimes: true, headingNot: /nedostup/i,
  }, 'down'),
});

export const SCENE_IDS: readonly SceneId[] = Object.freeze(Object.keys(SCENES) as SceneId[]);
/** Scenes also run in portrait (1080×1920). */
export const PORTRAIT_SCENES: readonly SceneId[] = Object.freeze(['peak1745']);
export const WALL_LANDSCAPE = Object.freeze({ width: 1920, height: 1080 });
export const WALL_PORTRAIT = Object.freeze({ width: 1080, height: 1920 });
/** The 3-metre proxy: a second context at this device scale factor, screenshot only (walkthroughs KIOSK_3M). */
export const PROXY_DEVICE_SCALE_FACTOR = 0.25;
