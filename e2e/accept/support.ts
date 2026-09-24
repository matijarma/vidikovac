// What the two acceptance specs (e2e/accept/wall.spec.ts, e2e/accept/phone.spec.ts)
// share beyond the instruments of e2e/wall.ts, e2e/inventory.ts, e2e/legibility.ts
// and e2e/recorders.ts: the scene clock the Node-side fixtures follow, the teaser
// re-stamped to that clock, the tile route, small page reads that never wait, the
// calm-motion observer, and the verdicts brief §16.3/§16.4 name per scene and per
// surface that the instruments do not already hold.
//
// The verdict functions are pure and return sentences ("[]" means the row holds),
// so a red row reads like a finding and the unit tier (test/e2e/accept-support.test.ts)
// pins them without a browser. The page-side functions (*_IN_PAGE) reference
// nothing but their argument and the DOM, the rule of e2e/geometry.ts.
//
// No selector for a new surface lives here: every probe name comes from
// WALL_PROBES or PHONE_PROBES, the one place each is spelled.
import type { Page, Route } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { teaserSubset } from '../../worker/feed/registry';
import { SENTENCE_KICKERS } from '../../shared/kiosk/sentence';
import { FIXTURE_PHARMACY_ADDRESSES, FIXTURE_STOP } from '../experience-fixtures';
import { PHONE_PROBES } from '../inventory';
import type { Scene } from '../scenes';
import {
  CLOCK_RE, ELLIPSIS_RE, NEARBY_HEAD_2KM, NEARBY_HEAD_RE, PHARMACY_HOURS, pharmacyFailures, SENTENCE_MAX_CHARS, WALL_PROBES, type RotationSummary, type WallSample,
} from '../wall';

// The phone's shared verdicts live beside its probes (e2e/inventory.ts), where the production observer reads them too.
export { PHONE_DEPARTURE_ROWS, phoneDepartureFailures, phoneDepartures, type PhoneDepartures } from '../inventory';
export { PHARMACY_HOURS } from '../wall';
export {
  CALM_MOTION_MARK_IN_PAGE, CALM_MOTION_READ_IN_PAGE, CALM_MOTION_SPEC, CALM_MOTION_START_IN_PAGE, calmMotionFailures, IDLE_MINUTE_MS, IDLE_MUTATIONS_MAX,
  type CalmMotionReading, type CalmMotionSpec,
} from '../wall';

// --- numbers the specs hold that the instruments do not name ------------------------------------
/** The place in the wall's header: a stop or street name, "Zagreb" for the whole city (acceptance A5). */
export const PLACE_MIN_CHARS = 3;
/** The time word of a timeless row (owner string, §11). */
export const ALWAYS_WORD = 'uvijek';
/** Read-only touch: the stop's board stays this long, then the wall returns by itself ([O-58]). */
export const TOUCH_BOARD_MS = 60_000;
/** The phone's first viewport (the Pixel 7 emulation keeps its touch and scale, the viewport is the plan's 390×844). */
export const PHONE_VIEWPORT = Object.freeze({ width: 390, height: 844 });
/** The desktop the phone's layout widens to ([O-56]). */
export const DESK_VIEWPORT = Object.freeze({ width: 1440, height: 900 });
/** axe rule tags of the phone spec (WP6 step 7). */
export const AXE_TAGS: readonly string[] = Object.freeze(['wcag2a', 'wcag2aa', 'wcag21aa']);
/** axe impacts that fail the spec; moderate and minor are printed only. */
export const AXE_BLOCKING: readonly string[] = Object.freeze(['serious', 'critical']);
/** Where the specs write what a person reads after the run (never committed: test-results/ is ignored). */
export const ACCEPT_ARTEFACTS = resolve(dirname(fileURLToPath(import.meta.url)), '../../test-results/accept');

// --- the scene clock ---------------------------------------------------------------------------
/**
 * The page's fake time as the Node side knows it. `page.clock.install` starts the page at the
 * scene's instant and lets it run; `runFor` jumps it. The routes that stamp fixtures run in Node
 * and cannot see that clock, so the spec syncs this one to the page's own `Date.now()` after
 * every jump (the rotation's readings carry it as `at`) and it runs on in real time between syncs.
 */
export interface SceneClock {
  now(): number;
  sync(pageNow: number): void;
}
export function sceneClock(start: number, real: () => number = Date.now): SceneClock {
  let pageAt = start;
  let realAt = real();
  return {
    now: () => pageAt + (real() - realAt),
    sync(pageNow: number) {
      pageAt = pageNow;
      realAt = real();
    },
  };
}

/** The page's own clock (the fake one under test). */
export function pageNow(page: Pick<Page, 'evaluate'>): Promise<number> {
  return page.evaluate(() => Date.now());
}

// --- the teaser, stamped for the page's time ---------------------------------------------------
const shiftIso = (value: string | undefined, delta: number): string | undefined =>
  value === undefined ? undefined : new Date(Date.parse(value) + delta).toISOString();

/**
 * A subsequent poll, not another relocation of the fixture into the scene.
 * Fetch times advance and live ZET vehicles get fresh observations. Published
 * facts (closure ends, event dates, validity and stale-since) stay put.
 */
export function restampSnapshots(snapshots: Readonly<Record<ModuleId, ModuleSnapshot>>, from: number, to: number): Record<ModuleId, ModuleSnapshot> {
  const delta = to - from;
  const out = {} as Record<ModuleId, ModuleSnapshot>;
  for (const [id, s] of Object.entries(snapshots) as [ModuleId, ModuleSnapshot][]) {
    const liveVehicles = id === 'zet-rt' && s.status === 'live';
    out[id] = {
      ...s,
      fetchedAt: shiftIso(s.fetchedAt, delta)!,
      sourceUpdatedAt: liveVehicles ? shiftIso(s.sourceUpdatedAt, delta) : s.sourceUpdatedAt,
      items: s.items.map((item) => ({
        ...item,
        ...(liveVehicles && item.kind === 'vehicle' ? { at: shiftIso(item.at, delta) } : {}),
      })),
    };
  }
  return out;
}

export interface SceneTeaser { generatedAt: string; modules: ModuleSnapshot[] }
/** /api/teaser as the wall reads it at `at`, from snapshots stamped for `stampedAt`. */
export function sceneTeaser(snapshots: Readonly<Record<ModuleId, ModuleSnapshot>>, stampedAt: number, at: number): SceneTeaser {
  const shifted = restampSnapshots(snapshots, stampedAt, at);
  return { generatedAt: new Date(at).toISOString(), modules: Object.values(shifted).map((s) => teaserSubset(s, FIXTURE_STOP)) };
}

/**
 * Serve /api/teaser stamped for the scene clock, so the feed stays as fresh through the ten
 * minutes as ZET's real one is (without this every vehicle ages with the rotation and the
 * wall slides into its outage path). Registered after installKioskFeedFixture, so it wins.
 */
export async function routeSceneTeaser(page: Pick<Page, 'route'>, snapshots: Readonly<Record<ModuleId, ModuleSnapshot>>, stampedAt: number, clock: SceneClock): Promise<void> {
  await page.route('**/api/teaser*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(sceneTeaser(snapshots, stampedAt, clock.now())),
  }));
}

// --- map tiles -----------------------------------------------------------------------------------
/** The bridge to the public basemap (scripts/review-maps.mjs fulfillPublicMap, GET only). */
const REVIEW_MAPS = '../../scripts/review-maps.mjs';
/** True when the run opted into the public basemap (GET only, through scripts/review-maps.mjs). */
export const publicTiles = (env: NodeJS.ProcessEnv = process.env): boolean => env.ACCEPT_TILES === 'public';

/**
 * The basemap's vector tiles answer 404 (the R2 bucket is empty under wrangler dev and its 503s
 * starve the page, e2e/round-f.spec.ts); `ACCEPT_TILES=public` bridges GETs to the public tiles
 * instead. Glyphs and the sprite are static assets and stay untouched.
 */
export async function routeTiles(page: Pick<Page, 'route'>): Promise<void> {
  await page.route('**/maps/zagreb-v1/**', async (route: Route) => {
    if (publicTiles() && route.request().method() === 'GET') {
      // Loaded only on opt-in, and through a specifier variable so no test program needs the script's types.
      const { fulfillPublicMap } = (await import(REVIEW_MAPS)) as { fulfillPublicMap: (route: Route) => Promise<void> };
      return fulfillPublicMap(route);
    }
    return route.fulfill({ status: 404, body: '' });
  });
}

// --- reads that never wait -----------------------------------------------------------------------
// A locator's getAttribute or textContent waits for its element until the test times out; these
// read what is there now, so a probe that does not exist yet fails on the assertion that names it.

/** An attribute of the first match, or null when there is no match. */
export function attrOf(page: Pick<Page, 'evaluate'>, selector: string, name: string): Promise<string | null> {
  return page.evaluate(([s, n]) => document.querySelector(s)?.getAttribute(n) ?? null, [selector, name] as const);
}
/** The first match's text with whitespace folded, '' when there is none. */
export function textOf(page: Pick<Page, 'evaluate'>, selector: string): Promise<string> {
  return page.evaluate((s) => (document.querySelector(s)?.textContent ?? '').replace(/\s+/g, ' ').trim(), selector);
}

export interface VisibleSpec { selector: string }
export interface VisibleBox { text: string; top: number; bottom: number; left: number; right: number }
/** Visible matches (a box, not display:none, not hidden, not transparent on itself or any ancestor), each once: their text and box. */
export const VISIBLE_IN_PAGE = (spec: VisibleSpec): VisibleBox[] => {
  const shown = (el: Element): boolean => {
    if ((el as HTMLElement).hidden || el.closest('[hidden]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    for (let a: Element | null = el; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'none' || cs.visibility === 'hidden' || (cs.opacity !== '' && Number(cs.opacity) === 0)) return false;
    }
    return true;
  };
  const out: VisibleBox[] = [];
  for (const el of Array.from(new Set(document.querySelectorAll(spec.selector)))) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    out.push({ text: ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim(), top: r.top, bottom: r.bottom, left: r.left, right: r.right });
  }
  return out;
};
export function visibleOf(page: Pick<Page, 'evaluate'>, selector: string): Promise<VisibleBox[]> {
  return page.evaluate(VISIBLE_IN_PAGE, { selector });
}

// --- the wall's own verdicts ---------------------------------------------------------------------
/** The "U blizini" head: the measured radius and walking time, and exactly the owner's line at 2.0 km ([O-68]). */
export function nearbyHeadFailures(head: string): string[] {
  if (!NEARBY_HEAD_RE.test(head)) {
    return [`the "U blizini" head (${WALL_PROBES.nearbyHead}) reads "${head}" (target ${String(NEARBY_HEAD_RE)}: the radius measured per place and its walking time)`];
  }
  if (/ · 2 km · /.test(head) && head !== NEARBY_HEAD_2KM) {
    return [`the "U blizini" head reads "${head}" at 2 km (target exactly "${NEARBY_HEAD_2KM}")`];
  }
  return [];
}

/** Heading texts a person reads as a headline (outage: never "unavailable" as a headline, principle 9). */
export const HEADINGS_IN_PAGE = (selector: string): string[] =>
  Array.from(document.querySelectorAll(selector))
    .filter((el) => !(el as HTMLElement).hidden && !el.closest('[hidden]') && el.getBoundingClientRect().height > 1)
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
export const HEADINGS = WALL_PROBES.headings;

const kindsOf = (s: WallSample): string => [...new Set(s.rows.map((r) => r.kind ?? 'none'))].join(', ') || 'none';
const isPast = (when: string | null, at: number): boolean => when !== null && Number.isFinite(Date.parse(when)) && Date.parse(when) < at;
const clockTime = (r: WallSample['rows'][number]): boolean => r.hasTime && CLOCK_RE.test(r.whenText);
const drawsVehicles = (s: WallSample): boolean => Boolean((s.pills ?? '').trim()) || (s.bodies ?? 0) > 0;

/**
 * One reading against what its scene says (e2e/scenes.ts) plus the §15.6 contract rows
 * wall.ts's sampleFailures does not hold: the place's length, the kicker, the theme, the
 * "uvijek" and 24/7 time words, the footer's pharmacy cross. `headings` are HEADINGS_IN_PAGE.
 */
export function sceneReadingFailures(scene: Scene, s: WallSample, headings: readonly string[] = []): string[] {
  const x = scene.expect;
  const out: string[] = [];
  if (s.place && [...s.place].length < PLACE_MIN_CHARS) out.push(`the place (${WALL_PROBES.place}) reads "${s.place}" (target a stop or street name of ≥ ${PLACE_MIN_CHARS} characters, "Zagreb" for the whole city)`);
  if (s.theme !== scene.theme) out.push(`data-theme-resolved is "${s.theme}" at ${scene.zagreb} (target "${scene.theme}" under the solar preference)`);
  if (!s.kicker || !(SENTENCE_KICKERS as readonly string[]).includes(s.kicker)) out.push(`the sentence's data-kicker is ${JSON.stringify(s.kicker)} (target one of ${SENTENCE_KICKERS.join(', ')})`);
  if (!s.validUntil) out.push(`the sentence (${WALL_PROBES.sentence}) carries no data-valid-until`);
  for (const kind of x.requiredKinds) {
    if (!s.rows.some((r) => r.kind === kind)) out.push(`no "${kind}" row on the list at ${scene.zagreb} (target ≥ 1; kinds shown: ${kindsOf(s)})`);
  }
  for (const kind of x.noPastKinds) {
    const past = s.rows.filter((r) => r.kind === kind && isPast(r.when, s.at));
    if (past.length) out.push(`${past.length} "${kind}" row(s) whose time has passed: ${past.map((r) => `"${r.text}" (${r.when})`).join(', ')} (target 0)`);
  }
  if (s.liveRows < x.liveMin) out.push(`${s.liveRows} live countdown row(s) (target ≥ ${x.liveMin}: the fixture tracks two trips on the stop's lines)`);
  if (x.liveMax !== null && s.liveRows > x.liveMax) out.push(`${s.liveRows} live countdown row(s) (target ≤ ${x.liveMax})`);
  if (x.feedLive && s.feed !== 'live') out.push(`the map's data-feed is ${JSON.stringify(s.feed)} (target "live")`);
  if (!x.feedLive && s.feed === 'live') out.push(`the map's data-feed reads "live" while ZET's feed is down (target stale or down)`);
  if (s.mapNotes !== x.mapNotes) out.push(`${s.mapNotes} map note(s) (${WALL_PROBES.mapNote}) (target ${x.mapNotes})`);
  if (x.pills === 'any' && !drawsVehicles(s)) out.push(`no vehicle drawn on the frame (data-pills ${JSON.stringify(s.pills)}, data-bodies ${s.bodies}; target trams and buses on the frame at every hour, [O-71])`);
  if (x.pills === 'none' && (s.pills ?? '').trim()) out.push(`vehicle pills "${s.pills}" drawn while ZET's feed is down (target none)`);
  if (!x.feedLive && !((s.markers ?? 0) > 0)) out.push(`data-markers is ${s.markers} (target > 0: BAJS, closures and places stay on the map without the live feed)`);
  if (x.departuresAsClockTimes) {
    const bad = s.rows.filter((r) => r.kind === 'departure' && !clockTime(r));
    if (bad.length) out.push(`${bad.length} departure row(s) without a clock time in a <time>: ${bad.map((r) => `"${r.whenText || r.text}"`).join(', ')} (target every departure a timetable time)`);
  }
  if (x.sentenceNot && x.sentenceNot.test(s.sentence)) out.push(`the sentence "${s.sentence}" matches ${String(x.sentenceNot)} at ${scene.zagreb} (target no match)`);
  if (x.headingNot) {
    const hits = [...headings, s.sentence].filter((t) => x.headingNot!.test(t));
    if (hits.length) out.push(`a headline matches ${String(x.headingNot)}: ${hits.map((t) => `"${t}"`).join(', ')} (target none, principle 9)`);
  }
  const untimedWord = s.rows.filter((r) => r.always && r.kind !== 'pharmacy' && r.whenText !== ALWAYS_WORD);
  if (untimedWord.length) out.push(`${untimedWord.length} timeless row(s) not labelled "${ALWAYS_WORD}": ${untimedWord.map((r) => `"${r.whenText || r.text}"`).join(', ')}`);
  const pharmacyRows = s.rows.filter((r) => r.kind === 'pharmacy' && !r.text.includes(PHARMACY_HOURS));
  if (pharmacyRows.length) out.push(`${pharmacyRows.length} pharmacy row(s) without "${PHARMACY_HOURS}": ${pharmacyRows.map((r) => `"${r.text}"`).join(', ')}`);
  // The corrected V-C rule, the one test/accept/trust.test.ts runs on the rendered strip (e2e/wall.ts pharmacyFailures).
  const pharmacy = pharmacyFailures({ symbols: s.pharmacySymbols, text: s.pharmacy }, FIXTURE_PHARMACY_ADDRESSES);
  if (pharmacy.length) out.push(`the footer's pharmacy (${WALL_PROBES.stripPharmacy}) reads "${s.pharmacy}": ${pharmacy.join(', ')} (target one ${WALL_PROBES.pharmacySymbol}, "${PHARMACY_HOURS}" and the address; "Dežurna ljekarna 24/7: {address}" is allowed, the bare label "Dežurna ljekarna:" is not)`);
  return out;
}

/** The ten minutes against the scene: the "never" rules of each reading, counted over the rotation. */
export function rotationSceneFailures(scene: Scene, samples: readonly WallSample[], summary: RotationSummary): string[] {
  const x = scene.expect;
  const out: string[] = [];
  const count = (pred: (s: WallSample) => boolean): number => samples.filter(pred).length;
  const of = `of ${samples.length} readings`;
  if (summary.emptyPlaceSamples > 0) out.push(`${summary.emptyPlaceSamples} ${of} with an empty place (target 0)`);
  const themes = Object.keys(summary.themes).filter((t) => t !== scene.theme);
  if (themes.length) out.push(`the theme left "${scene.theme}" during the ten minutes: ${themes.map((t) => `${t} × ${summary.themes[t]}`).join(', ')}`);
  // Rows without a time and a `last` row that has left are counted by rotationFailures (rowsWithoutTime, pastLastRows) in every scene.
  for (const kind of x.noPastKinds.filter((k) => k !== 'last')) {
    const n = count((s) => s.rows.some((r) => r.kind === kind && isPast(r.when, s.at)));
    if (n) out.push(`${n} ${of} with a "${kind}" row whose time has passed (target 0)`);
  }
  if (x.sentenceNot) {
    const hits = [...new Set(samples.filter((s) => x.sentenceNot!.test(s.sentence)).map((s) => s.sentence))];
    if (hits.length) out.push(`${count((s) => x.sentenceNot!.test(s.sentence))} ${of} with a sentence matching ${String(x.sentenceNot)}: ${hits.map((t) => `"${t}"`).join(', ')}`);
  }
  if (x.headingNot) {
    const n = count((s) => x.headingNot!.test(s.sentence));
    if (n) out.push(`${n} ${of} with a sentence matching ${String(x.headingNot)} (target 0, principle 9)`);
  }
  if (x.liveMax !== null && summary.liveRowsMax > x.liveMax) out.push(`up to ${summary.liveRowsMax} live countdown row(s) in a reading (target ≤ ${x.liveMax})`);
  if (x.pills === 'none') {
    const n = count((s) => Boolean((s.pills ?? '').trim()));
    if (n) out.push(`${n} ${of} draw vehicle pills while ZET's feed is down (target 0)`);
  }
  if (!x.feedLive) {
    const n = count((s) => s.feed === 'live');
    if (n) out.push(`${n} ${of} read data-feed "live" while ZET's feed is down (target 0)`);
  }
  if (x.departuresAsClockTimes) {
    const n = count((s) => s.rows.some((r) => r.kind === 'departure' && !clockTime(r)));
    if (n) out.push(`${n} ${of} show a departure without a clock time (target 0)`);
  }
  const unworded = count((s) => s.rows.some((r) => r.always && r.kind !== 'pharmacy' && r.whenText !== ALWAYS_WORD));
  if (unworded) out.push(`${unworded} ${of} with a timeless row not labelled "${ALWAYS_WORD}" (target 0)`);
  return out;
}

// --- calm motion (principle 7): e2e/wall.ts, where the production observer reads it too (re-exported above) ---

// --- the phone ---------------------------------------------------------------------------------
// PHONE_DEPARTURE_ROWS, phoneDepartures and phoneDepartureFailures: e2e/inventory.ts (re-exported above).

/** The six kickers as printed (owner strings, brief §15.8 rule 9), by their data-kicker value. */
export const KICKER_WORDS: Readonly<Record<(typeof SENTENCE_KICKERS)[number], string>> = Object.freeze({
  promet: 'Promet', kultura: 'Kultura', vrijeme: 'Vrijeme', bicikli: 'Bicikli', nocas: 'Noćas', radovi: 'Radovi',
});
/**
 * The sentence of a sentence card: its text without the card's own printed kicker, when the card
 * prints it inside itself ("Promet · …", "Promet: …", or a kicker element before a capitalised
 * sentence). A sentence that merely starts with the word ("Promet je …") keeps it.
 */
export function phoneSentenceText(cardText: string, kicker: string | null): string {
  const text = cardText.replace(/\s+/g, ' ').trim();
  const word = kicker ? KICKER_WORDS[kicker as keyof typeof KICKER_WORDS] : undefined;
  if (!word || !text.startsWith(word)) return text;
  const rest = text.slice(word.length);
  if (rest === '') return '';
  const lead = /^(\s*[·:–-]\s*|\s+(?=\p{Lu})|(?=\p{Lu}))/u.exec(rest);
  return lead ? rest.slice(lead[0].length).trim() : text;
}

/** The phone's sentence card: one sentence of 1–80 characters, never cut, with one of the six kickers. */
export function phoneSentenceFailures(text: string, kicker: string | null): string[] {
  const out: string[] = [];
  const n = [...text].length;
  if (n < 1 || n > SENTENCE_MAX_CHARS) out.push(`the sentence (${PHONE_PROBES.sadaSentence}) has ${n} characters (target 1–${SENTENCE_MAX_CHARS}): "${text}"`);
  if (ELLIPSIS_RE.test(text)) out.push(`the sentence is cut with an ellipsis: "${text}"`);
  if (!kicker || !(SENTENCE_KICKERS as readonly string[]).includes(kicker)) out.push(`the sentence's data-kicker is ${JSON.stringify(kicker)} (target one of ${SENTENCE_KICKERS.join(', ')})`);
  return out;
}

export interface Box { top: number; bottom: number; left: number; right: number }
/** A box that shares area with the viewport. */
export const intersects = (b: Box | undefined, vp: { width: number; height: number }): boolean =>
  Boolean(b) && b!.bottom > 0 && b!.right > 0 && b!.top < vp.height && b!.left < vp.width;

// --- artefacts -----------------------------------------------------------------------------------
/** Write a JSON artefact for the owner (legibility warnings, symbol sizes, rotation, recorders); returns its path. */
export function writeArtefact(name: string, data: unknown, dir: string = ACCEPT_ARTEFACTS): string {
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, name);
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  return path;
}
