// The acceptance specs' own helpers (e2e/accept/support.ts) without a browser:
// the scene clock and the re-stamped teaser the Node-side fixtures follow, the
// reads that never wait, the calm-motion observer run in happy-dom from its own
// text (what Playwright ships to the page), and the per-scene and phone verdicts
// e2e/accept/wall.spec.ts and e2e/accept/phone.spec.ts assert empty.
// @vitest-environment happy-dom
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Page, Route } from '@playwright/test';
import {
  ACCEPT_ARTEFACTS, ALWAYS_WORD, attrOf, AXE_BLOCKING, AXE_TAGS, CALM_MOTION_READ_IN_PAGE, CALM_MOTION_SPEC, CALM_MOTION_START_IN_PAGE,
  calmMotionFailures, DESK_VIEWPORT, HEADINGS, HEADINGS_IN_PAGE, IDLE_MINUTE_MS, IDLE_MUTATIONS_MAX, intersects, KICKER_WORDS, nearbyHeadFailures,
  pageNow, PHARMACY_HOURS, PHONE_DEPARTURE_ROWS, PHONE_VIEWPORT, phoneDepartureFailures, phoneDepartures, phoneSentenceFailures, phoneSentenceText,
  PLACE_MIN_CHARS, publicTiles, restampSnapshots, rotationSceneFailures, routeSceneTeaser, routeTiles, sceneClock, sceneReadingFailures,
  sceneTeaser, textOf, TOUCH_BOARD_MS, VISIBLE_IN_PAGE, visibleOf, writeArtefact, type CalmMotionReading,
} from '../../e2e/accept/support';
import { SCENES } from '../../e2e/scenes';
import { NEARBY_HEAD_2KM, pharmacyFailures, pillFailures, summariseRotation, WALL_PROBES, type WallRow, type WallSample } from '../../e2e/wall';
import { EXPIRY_READ_IN_PAGE, EXPIRY_SPEC, expiryFailures, PHONE_CONTENT_ROWS, PHONE_PROBES } from '../../e2e/inventory';
import { experienceSnapshots, FIXTURE_PHARMACY_ADDRESSES } from '../../e2e/experience-fixtures';
import { SENTENCE_KICKERS } from '../../shared/kiosk/sentence';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';

const MIN = 60_000;
const PEAK = SCENES.peak1745;

// --- helpers ---------------------------------------------------------------------------------
function row(over: Partial<WallRow>): WallRow {
  return { id: null, kind: 'departure', when: null, always: false, live: false, source: 'zet', title: '', whenText: '', sub: '', hasTime: true, text: '', caveat: false, ...over };
}
/** A reading that holds for peak1745 (17:45, light, trams on the frame, a solar row). */
function sample(over: Partial<WallSample> = {}): WallSample {
  const at = over.at ?? PEAK.now;
  const rows = over.rows ?? [
    row({ id: 'trip-1', when: new Date(at + 2 * MIN).toISOString(), title: '6 Sopot', whenText: '2 min', text: '6 Sopot 2 min', live: true }),
    row({ id: 'sun', kind: 'solar', when: new Date(at + 72 * MIN).toISOString(), whenText: '18:57', text: 'Zalazak sunca 18:57', source: 'solar' }),
    row({ id: 'story', kind: 'always', always: true, hasTime: false, whenText: ALWAYS_WORD, text: `Trg ${ALWAYS_WORD}`, source: 'city' }),
  ];
  return {
    at, place: 'Trg bana J. Jelačića', sentence: 'Sunce zalazi u 18:57.', kicker: 'vrijeme', kickerText: 'Vrijeme',
    validUntil: new Date(at + 20_000).toISOString(), sentenceChars: 21, sentenceOverflow: false, sentenceEllipsis: false, head: NEARBY_HEAD_2KM,
    hiddenRows: 0, departures: rows.filter((r) => r.kind === 'departure').length, solarRows: rows.filter((r) => r.kind === 'solar').length, liveRows: rows.filter((r) => r.live).length,
    pills: '6|12|17', bodies: 0, zoom: '14.07', feed: 'live', mapStatus: 'ready', unlabelled: 0, markers: 12, frame: '6', mapNotes: 0,
    theme: 'light', code: 'ABCD·EFGH', codeState: 'live', qr: { w: 240, h: 240 }, lead: 'x', strip: 'Mirno · DHMZ · EMSC', stripHasClock: false,
    pharmacy: `${PHARMACY_HOURS} Trg bana J. Jelačića 3`, pharmacySymbols: 1, controls: 0, controlNames: [], retiredChrome: 0, settingsOpen: false, stopBoardOpen: false, headings: [],
    ...over,
    rows,
  };
}
/** A fake page whose evaluate runs the shipped function text in this happy-dom document, as Playwright does in the page. */
function domPage(): Pick<Page, 'evaluate'> {
  return {
    evaluate: (async (fn: unknown, arg?: unknown) => {
      const shipped = new Function(`return (${String(fn)});`)() as (a: unknown) => unknown;
      return shipped(arg);
    }) as Pick<Page, 'evaluate'>['evaluate'],
  };
}
const rect = (top: number, h = 40, w = 100): DOMRect => ({ x: 0, y: top, left: 0, top, right: w, bottom: top + h, width: w, height: h, toJSON: () => ({}) }) as DOMRect;

// --- the numbers -----------------------------------------------------------------------------
describe('the numbers the specs hold', () => {
  it('names the plan\'s targets: a place of ≥ 3 characters, ≤ 2 structural mutations per idle minute, a 60 s board, 390×844 and 1440×900, axe A/AA serious+critical', () => {
    expect(PLACE_MIN_CHARS).toBe(3);
    expect(IDLE_MINUTE_MS).toBe(60_000);
    expect(IDLE_MUTATIONS_MAX).toBe(2);
    expect(TOUCH_BOARD_MS).toBe(60_000);
    expect(PHONE_VIEWPORT).toEqual({ width: 390, height: 844 });
    expect(DESK_VIEWPORT).toEqual({ width: 1440, height: 900 });
    expect(AXE_TAGS).toEqual(['wcag2a', 'wcag2aa', 'wcag21aa']);
    expect(AXE_BLOCKING).toEqual(['serious', 'critical']);
    expect(ACCEPT_ARTEFACTS.replace(/\\/g, '/')).toMatch(/\/test-results\/accept$/);
  });

  it('prints the six kickers as the owner wrote them, one per data-kicker value', () => {
    expect(Object.keys(KICKER_WORDS).sort()).toEqual([...SENTENCE_KICKERS].sort());
    expect(Object.values(KICKER_WORDS)).toEqual(['Promet', 'Kultura', 'Vrijeme', 'Bicikli', 'Noćas', 'Radovi']);
  });

  it('counts the Sada block and the shared timeline as departure rows, from PHONE_PROBES only', () => {
    expect(PHONE_DEPARTURE_ROWS).toBe(`${PHONE_PROBES.sadaDepartures}, ${PHONE_PROBES.departureRows}`);
    expect(CALM_MOTION_SPEC).toMatchObject({ root: WALL_PROBES.nearby, row: WALL_PROBES.row });
    expect(HEADINGS).toBe('h1, h2');
  });
});

// --- the scene clock and the teaser ---------------------------------------------------------
describe('the scene clock and the re-stamped teaser', () => {
  it('runs from the scene\'s instant in real time and jumps with every sync to the page\'s clock', () => {
    let real = 1_000;
    const clock = sceneClock(PEAK.now, () => real);
    expect(clock.now()).toBe(PEAK.now);
    real += 1_500;
    expect(clock.now()).toBe(PEAK.now + 1_500);
    clock.sync(PEAK.now + 600_000);
    expect(clock.now()).toBe(PEAK.now + 600_000);
    real += 250;
    expect(clock.now()).toBe(PEAK.now + 600_250);
  });

  it('refreshes live vehicle observations without moving closure or event facts and leaves the input untouched', () => {
    const snap: ModuleSnapshot = {
      module: 'zet-rt', tier: 'open', status: 'live', fetchedAt: '2026-09-21T15:45:00.000Z', sourceUpdatedAt: '2026-09-21T15:44:50.000Z',
      attribution: { text: 't', url: 'https://example.test', licence: 'l' } as ModuleSnapshot['attribution'],
      items: [
        { id: 'vehicle:1', module: 'zet-rt', kind: 'vehicle', tier: 'open', title: '6', at: '2026-09-21T15:44:55.000Z' },
        { id: 'closure', module: 'zet-rt', kind: 'closure', tier: 'open', title: 'x', until: '2026-09-21T18:00:00.000Z' },
        { id: 'event', module: 'zet-rt', kind: 'event', tier: 'open', title: 'x', at: '2026-09-21T16:00:00.000Z', until: '2026-09-21T18:00:00.000Z' },
      ],
    } as ModuleSnapshot;
    const input = { 'zet-rt': snap } as Record<ModuleId, ModuleSnapshot>;
    const copy = JSON.parse(JSON.stringify(input));
    const out = restampSnapshots(input, PEAK.now, PEAK.now + 10 * MIN)['zet-rt'];
    expect(out.fetchedAt).toBe('2026-09-21T15:55:00.000Z');
    expect(out.sourceUpdatedAt).toBe('2026-09-21T15:54:50.000Z');
    expect(out.validUntil).toBeUndefined();
    expect(out.staleSince).toBeUndefined();
    expect(out.items.map((i) => [i.at, i.until])).toEqual([
      ['2026-09-21T15:54:55.000Z', undefined],
      [undefined, '2026-09-21T18:00:00.000Z'],
      ['2026-09-21T16:00:00.000Z', '2026-09-21T18:00:00.000Z'],
    ]);
    expect(input).toEqual(copy);
  });

  it('does not rejuvenate stale data or extend published validity on subsequent polls', async () => {
    const input = await experienceSnapshots('stale');
    const before = structuredClone(input);
    const out = restampSnapshots(input, PEAK.now, PEAK.now + 10 * MIN);
    for (const id of Object.keys(input) as ModuleId[]) {
      expect(out[id].fetchedAt).toBe(new Date(Date.parse(input[id].fetchedAt) + 10 * MIN).toISOString());
      expect(out[id].sourceUpdatedAt).toBe(input[id].sourceUpdatedAt);
      expect(out[id].staleSince).toBe(input[id].staleSince);
      expect(out[id].validUntil).toBe(input[id].validUntil);
      expect(out[id].items).toEqual(input[id].items);
    }
    expect(input).toEqual(before);
  });

  it('serves the teaser stamped for the scene clock: generatedAt and the vehicles move with it', async () => {
    const snapshots = await experienceSnapshots('ready');
    const vehiclesAt = (modules: ModuleSnapshot[]): string[] => (modules.find((m) => m.module === 'zet-rt')?.items ?? []).filter((i) => i.id.startsWith('vehicle:')).map((i) => i.at!);
    const at0 = sceneTeaser(snapshots, PEAK.now, PEAK.now);
    const at10 = sceneTeaser(snapshots, PEAK.now, PEAK.now + 10 * MIN);
    expect(at0.generatedAt).toBe(new Date(PEAK.now).toISOString());
    expect(at10.generatedAt).toBe(new Date(PEAK.now + 10 * MIN).toISOString());
    expect(at10.modules.map((m) => m.module)).toEqual(at0.modules.map((m) => m.module));
    expect(vehiclesAt(at0.modules).length).toBeGreaterThan(0);
    expect(vehiclesAt(at10.modules)).toEqual(vehiclesAt(at0.modules).map((t) => new Date(Date.parse(t) + 10 * MIN).toISOString()));

    let handler: ((route: Route) => unknown) | null = null;
    const page = { route: async (_url: string, h: (route: Route) => unknown) => { handler = h; } } as unknown as Pick<Page, 'route'>;
    let real = 0;
    const clock = sceneClock(PEAK.now, () => real);
    await routeSceneTeaser(page, snapshots, PEAK.now, clock);
    real += 90_000;
    let body = '';
    await handler!({ fulfill: async (r: { body: string }) => { body = r.body; } } as unknown as Route);
    expect(JSON.parse(body).generatedAt).toBe(new Date(PEAK.now + 90_000).toISOString());
  });
});

// --- tiles and reads that never wait ---------------------------------------------------------
describe('tiles and reads', () => {
  it('answers tiles 404 unless ACCEPT_TILES=public', async () => {
    expect(publicTiles({})).toBe(false);
    expect(publicTiles({ ACCEPT_TILES: 'public' })).toBe(true);
    expect(publicTiles({ ACCEPT_TILES: '1' })).toBe(false);
    let pattern = '';
    let handler: ((route: Route) => unknown) | null = null;
    const page = { route: async (url: string, h: (route: Route) => unknown) => { pattern = url; handler = h; } } as unknown as Pick<Page, 'route'>;
    await routeTiles(page);
    expect(pattern).toBe('**/maps/zagreb-v1/**');
    let status = 0;
    await handler!({ request: () => ({ method: () => 'GET' }), fulfill: async (r: { status: number }) => { status = r.status; } } as unknown as Route);
    expect(status).toBe(404);
  });

  it('reads an attribute, a text and the page clock without waiting; a missing probe reads null or empty', async () => {
    document.body.innerHTML = '<div data-testid="kiosk-map" data-map-status="ready"></div><h2 data-testid="nearby-head">  U blizini ·\n 2 km · ~15 min </h2>';
    const page = domPage();
    expect(await attrOf(page, WALL_PROBES.map, 'data-map-status')).toBe('ready');
    expect(await attrOf(page, WALL_PROBES.map, 'data-pills')).toBeNull();
    expect(await attrOf(page, WALL_PROBES.mapNote, 'data-x')).toBeNull();
    expect(await textOf(page, WALL_PROBES.nearbyHead)).toBe(NEARBY_HEAD_2KM);
    expect(await textOf(page, WALL_PROBES.sentence)).toBe('');
    expect(Math.abs((await pageNow(page)) - Date.now())).toBeLessThan(1_000);
  });

  it('skips a transparent match and one inside a transparent or invisible ancestor', () => {
    document.body.innerHTML = '<ul><li class="a" style="opacity: 0">6</li><li class="a">11</li></ul><ul style="opacity: 0"><li class="a">12</li></ul><ul style="visibility: hidden"><li class="a">13</li></ul>';
    document.querySelectorAll<HTMLElement>('li').forEach((el, i) => { el.getBoundingClientRect = () => rect(100 + i * 50); });
    const shipped = new Function(`return (${String(VISIBLE_IN_PAGE)});`)() as typeof VISIBLE_IN_PAGE;
    expect(shipped({ selector: 'li.a' }).map((b) => b.text)).toEqual(['11']);
  });

  it('lists visible matches once each, in document order, skipping hidden and boxless ones', async () => {
    document.body.innerHTML = '<ul><li class="a" data-kind="departure">6 Sopot</li><li class="a" data-kind="departure" hidden>11</li><li class="a" data-kind="departure">12 Dubrava</li><li class="b" data-kind="departure">13</li></ul>';
    const items = [...document.querySelectorAll<HTMLElement>('li')];
    items.forEach((el, i) => { el.getBoundingClientRect = () => rect(100 + i * 50); });
    items[3]!.getBoundingClientRect = () => rect(0, 0, 0);
    const shipped = new Function(`return (${String(VISIBLE_IN_PAGE)});`)() as typeof VISIBLE_IN_PAGE;
    expect(shipped({ selector: 'li.a, [data-kind=departure]' }).map((b) => [b.text, b.top])).toEqual([['6 Sopot', 100], ['12 Dubrava', 200]]);
    expect((await visibleOf(domPage(), 'li.a')).length).toBe(2);
  });

  it('writes a JSON artefact where the owner reads it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'accept-'));
    try {
      const path = writeArtefact('x.json', { a: 1 }, join(dir, 'nested'));
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ a: 1 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- the wall's verdicts ---------------------------------------------------------------------
describe('the "U blizini" head', () => {
  it('holds the measured radius and the owner\'s line at 2.0 km', () => {
    expect(nearbyHeadFailures(NEARBY_HEAD_2KM)).toEqual([]);
    expect(nearbyHeadFailures('U blizini · 2,2 km · ~16 min')).toEqual([]);
    expect(nearbyHeadFailures('U blizini · 2 km · ~16 min')).toEqual(['the "U blizini" head reads "U blizini · 2 km · ~16 min" at 2 km (target exactly "U blizini · 2 km · ~15 min")']);
    expect(nearbyHeadFailures('')[0]).toMatch(/^the "U blizini" head \(\[data-testid=nearby-head\]\) reads ""/);
    expect(nearbyHeadFailures('U blizini · 2.2 km · ~16 min')).toHaveLength(1);
  });
});

describe('one reading against its scene', () => {
  it('a reading that holds for peak1745 has no failures', () => {
    expect(sceneReadingFailures(PEAK, sample())).toEqual([]);
  });

  it('names the place, the theme, the kicker and its deadline', () => {
    const f = sceneReadingFailures(PEAK, sample({ place: 'Tr', theme: 'dark', kicker: 'transit', validUntil: null }));
    expect(f).toEqual([
      'the place ([data-testid=kiosk-context]) reads "Tr" (target a stop or street name of ≥ 3 characters, "Zagreb" for the whole city)',
      'data-theme-resolved is "dark" at 2026-09-21 17:45 (target "light" under the solar preference)',
      'the sentence\'s data-kicker is "transit" (target one of promet, kultura, vrijeme, bicikli, nocas, radovi)',
      'the sentence ([data-testid=kiosk-sentence]) carries no data-valid-until',
    ]);
  });

  it('lastTrams2240 needs its last-trams and first-tram rows', () => {
    const scene = SCENES.lastTrams2240;
    const f = sceneReadingFailures(scene, sample({ at: scene.now, theme: 'dark', rows: [row({ id: 't', when: new Date(scene.now + 2 * MIN).toISOString(), text: '6 Sopot' })] }));
    expect(f).toEqual([
      'no "last" row on the list at 2026-09-21 22:40 (target ≥ 1; kinds shown: departure)',
      'no "first" row on the list at 2026-09-21 22:40 (target ≥ 1; kinds shown: departure)',
    ]);
  });

  it('afterLast0045 refuses a last-trams row that has left and a "zadnji" sentence', () => {
    const scene = SCENES.afterLast0045;
    const rows = [
      row({ id: 't', when: new Date(scene.now + 2 * MIN).toISOString(), text: '6 Sopot' }),
      row({ id: 'first', kind: 'first', when: new Date(scene.now + 211 * MIN).toISOString(), text: 'Prvi tramvaj 04:16' }),
      row({ id: 'last', kind: 'last', when: new Date(scene.now - 14 * MIN).toISOString(), text: 'Zadnji tramvaji 24:31' }),
    ];
    const f = sceneReadingFailures(scene, sample({ at: scene.now, theme: 'dark', rows, sentence: 'Zadnji tramvaj 14 polazi u 00:31.' }));
    expect(f).toEqual([
      `1 "last" row(s) whose time has passed: "Zadnji tramvaji 24:31" (${new Date(scene.now - 14 * MIN).toISOString()}) (target 0)`,
      'the sentence "Zadnji tramvaj 14 polazi u 00:31." matches /zadnji/i at 2026-09-22 00:45 (target no match)',
    ]);
  });

  it('night0430 needs the first tram and the pharmacy with its 24/7; timeless rows print "uvijek"', () => {
    const scene = SCENES.night0430;
    const rows = [
      row({ id: 't', when: new Date(scene.now + 3 * MIN).toISOString(), text: '6 Sopot' }),
      row({ id: 'first', kind: 'first', when: new Date(scene.now + 20 * MIN).toISOString(), text: 'Prvi tramvaj' }),
      row({ id: 'sun', kind: 'solar', when: new Date(scene.now + 132 * MIN).toISOString(), text: 'Izlazak sunca' }),
      row({ id: 'ph', kind: 'pharmacy', always: true, hasTime: false, whenText: '', text: 'Ljekarna Ilica 1' }),
      row({ id: 'story', kind: 'always', always: true, hasTime: false, whenText: 'zauvijek', text: 'Trg' }),
    ];
    expect(sceneReadingFailures(scene, sample({ at: scene.now, theme: 'dark', rows }))).toEqual([
      '1 timeless row(s) not labelled "uvijek": "zauvijek"',
      '1 pharmacy row(s) without "24/7": "Ljekarna Ilica 1"',
    ]);
  });

  it('morning0745 needs a live countdown', () => {
    const scene = SCENES.morning0745;
    const rows = [row({ id: 't', when: new Date(scene.now + 2 * MIN).toISOString(), text: '6 Sopot', live: false })];
    expect(sceneReadingFailures(scene, sample({ at: scene.now, rows }))).toEqual(['0 live countdown row(s) (target ≥ 1: the fixture tracks two trips on the stop\'s lines)']);
  });

  it('outage0800: no live feed, no pills, timetable times, one note, markers kept, no "nedostup" headline', () => {
    const scene = SCENES.outage0800;
    const good = sample({
      at: scene.now, feed: 'down', pills: '', mapNotes: 1, markers: 9,
      rows: [row({ id: 't', when: new Date(scene.now + 4 * MIN).toISOString(), whenText: '08:04', text: '6 Sopot 08:04' })],
    });
    expect(sceneReadingFailures(scene, good, ['U blizini'])).toEqual([]);
    const bad = sample({
      at: scene.now, feed: 'live', pills: '6', mapNotes: 0, markers: 0, sentence: 'Podaci nedostupni.',
      rows: [row({ id: 't', when: new Date(scene.now + 2 * MIN).toISOString(), whenText: 'za 2 min', text: '6 Sopot za 2 min', live: true })],
    });
    expect(sceneReadingFailures(scene, bad, ['Promet nedostupan'])).toEqual([
      '1 live countdown row(s) (target ≤ 0)',
      'the map\'s data-feed reads "live" while ZET\'s feed is down (target stale or down)',
      '0 map note(s) ([data-testid=map-note]) (target 1)',
      'vehicle pills "6" drawn while ZET\'s feed is down (target none)',
      'data-markers is 0 (target > 0: BAJS, closures and places stay on the map without the live feed)',
      '1 departure row(s) without a clock time in a <time>: "za 2 min" (target every departure a timetable time)',
      'a headline matches /nedostup/i: "Promet nedostupan", "Podaci nedostupni." (target none, principle 9)',
    ]);
  });

  it('holds the frame to drawn vehicles', () => {
    expect(sceneReadingFailures(PEAK, sample({ pills: null, bodies: null }))).toEqual([
      'no vehicle drawn on the frame (data-pills null, data-bodies null; target trams and buses on the frame at every hour, [O-71])',
    ]);
    // Bodies alone count as drawn vehicles (the kiosk map's pill census can read empty headless).
    expect(sceneReadingFailures(PEAK, sample({ pills: '', bodies: 4 }))).toEqual([]);
  });

  // The corrected V-C rule (test/accept/trust.test.ts runs the same pharmacyFailures of e2e/wall.ts): one
  // cross, "24/7" and the fixture's address; "Dežurna ljekarna 24/7: {address}" is allowed, the bare label not.
  it('holds the footer pharmacy to one cross, "24/7" and the address: an empty cross and the bare label fail, the full caption passes', () => {
    const target = '(target one [data-testid=strip-pharmacy] [data-symbol=pharmacy], "24/7" and the address; "Dežurna ljekarna 24/7: {address}" is allowed, the bare label "Dežurna ljekarna:" is not)';
    const fails = (pharmacy: string, pharmacySymbols = 1): string[] => sceneReadingFailures(PEAK, sample({ pharmacy, pharmacySymbols }));
    expect(fails('24/7 Trg bana J. Jelačića 3')).toEqual([]);
    expect(fails('Dežurna ljekarna 24/7: Trg bana Josipa Jelačića 3')).toEqual([]);
    expect(fails('')).toEqual([`the footer's pharmacy ([data-testid=strip-pharmacy]) reads "": no "24/7", no address ${target}`]);
    expect(fails('Dežurna ljekarna: Trg bana J. Jelačića 3', 0)).toEqual([
      `the footer's pharmacy ([data-testid=strip-pharmacy]) reads "Dežurna ljekarna: Trg bana J. Jelačića 3": 0 [data-symbol=pharmacy], not 1, no "24/7", the label "Dežurna ljekarna:" ${target}`,
    ]);
    expect(fails('24/7 Trg bana J. Jelačića 3', 2)).toHaveLength(1);
    expect(fails('24/7 Ilica 291')).toEqual([`the footer's pharmacy ([data-testid=strip-pharmacy]) reads "24/7 Ilica 291": no address ${target}`]);
    // One helper for both tiers, and the fixture's address as worker/hitno/ljekarne.ts writes it (label and address).
    expect(FIXTURE_PHARMACY_ADDRESSES).toEqual(['Trg bana J. Jelačića 3', 'Trg bana Josipa Jelačića 3']);
    expect(pharmacyFailures({ symbols: 1, text: '' }, FIXTURE_PHARMACY_ADDRESSES)).toEqual(['no "24/7"', 'no address']);
  });
});

describe('the ten minutes against the scene', () => {
  const readings = (scene: typeof PEAK, n: number, over: (i: number) => Partial<WallSample> = () => ({})): WallSample[] =>
    Array.from({ length: n }, (_, i) => sample({ at: scene.now + i * 2000, validUntil: new Date(scene.now + Math.floor(i / 10) * 20_000).toISOString(), sentence: `S${Math.floor(i / 10)}.`, ...over(i) }));

  it('a steady rotation has no failures', () => {
    const rows = readings(PEAK, 30);
    expect(rotationSceneFailures(PEAK, rows, summariseRotation(rows))).toEqual([]);
  });

  it('counts the readings that break the scene\'s "never" rules', () => {
    const scene = SCENES.outage0800;
    const base: Partial<WallSample> = { theme: 'light', feed: 'down', pills: '', mapNotes: 1, rows: [row({ id: 't', when: new Date(scene.now + 4 * MIN).toISOString(), whenText: '08:04', text: '6 Sopot' })] };
    const rows = readings(scene, 30, (i) => (i === 7
      ? { ...base, feed: 'live', pills: '6', sentence: 'Sve nedostupno.', place: '', theme: 'dark', rows: [row({ id: 't', when: new Date(scene.now + 4 * MIN).toISOString(), whenText: 'za 4 min', text: '6', live: true }), row({ id: 'x', when: null, text: 'bez vremena' })] }
      : base));
    expect(rotationSceneFailures(scene, rows, summariseRotation(rows))).toEqual([
      '1 of 30 readings with an empty place (target 0)',
      'the theme left "light" during the ten minutes: dark × 1',
      '1 of 30 readings with a sentence matching /nedostup/i (target 0, principle 9)',
      'up to 1 live countdown row(s) in a reading (target ≤ 0)',
      '1 of 30 readings draw vehicle pills while ZET\'s feed is down (target 0)',
      '1 of 30 readings read data-feed "live" while ZET\'s feed is down (target 0)',
      '1 of 30 readings show a departure without a clock time (target 0)',
    ]);
  });

  it('afterLast0045 names every "zadnji" sentence; night0430 counts an event that has ended', () => {
    const after = SCENES.afterLast0045;
    const rows = readings(after, 20, (i) => ({ theme: 'dark', sentence: i === 3 ? 'Zadnji tramvaj je otišao.' : `S${Math.floor(i / 10)}.` }));
    expect(rotationSceneFailures(after, rows, summariseRotation(rows))).toEqual(['1 of 20 readings with a sentence matching /zadnji/i: "Zadnji tramvaj je otišao."']);
    const night = SCENES.night0430;
    const nightRows = readings(night, 10, (i) => ({ theme: 'dark', rows: [row({ id: 't', when: new Date(night.now + 3 * MIN).toISOString(), text: '6' }), ...(i === 2 ? [row({ id: 'ev', kind: 'event', when: new Date(night.now - MIN).toISOString(), text: 'Koncert' })] : [])] }));
    expect(rotationSceneFailures(night, nightRows, summariseRotation(nightRows))).toEqual(['1 of 10 readings with a "event" row whose time has passed (target 0)']);
  });
});

// --- calm motion --------------------------------------------------------------------------------
describe('calm motion, run from the shipped text', () => {
  const start = new Function(`return (${String(CALM_MOTION_START_IN_PAGE)});`)() as typeof CALM_MOTION_START_IN_PAGE;
  const read = new Function(`return (${String(CALM_MOTION_READ_IN_PAGE)});`)() as typeof CALM_MOTION_READ_IN_PAGE;
  const list = (ids: string[]): string => `<section data-testid="nearby"><ol data-testid="nearby-rows">${ids.map((id) => `<li class="nearby-row" data-id="${id}" data-kind="departure"><span class="nearby-title">${id}</span><time>2 min</time></li>`).join('')}</ol></section>`;
  const li = (id: string): HTMLElement => {
    const el = document.createElement('li');
    el.className = 'nearby-row';
    el.dataset.id = id;
    el.dataset.kind = 'departure';
    return el;
  };

  it('ships no module identifier', () => {
    for (const fn of [CALM_MOTION_START_IN_PAGE, CALM_MOTION_READ_IN_PAGE, HEADINGS_IN_PAGE, VISIBLE_IN_PAGE]) {
      expect(String(fn)).not.toMatch(/\b(WALL_PROBES|PHONE_PROBES|CALM_MOTION_SPEC|IDLE_MUTATIONS_MAX|SENTENCE_KICKERS)\b/);
    }
  });

  it('a departure leaving at the top and one row entering is two mutations, and the rows that stay keep their nodes', async () => {
    document.body.innerHTML = list(['a', 'b', 'c']);
    expect(start(CALM_MOTION_SPEC)).toBe(3);
    const ol = document.querySelector('ol')!;
    ol.firstElementChild!.remove();
    ol.appendChild(li('d'));
    document.querySelector('time')!.textContent = '1 min';
    await Promise.resolve();
    const r = read(CALM_MOTION_SPEC);
    expect(r).toMatchObject({ rootFound: true, before: 3, after: 3, mutations: 2, kept: 2, rebuilt: [], left: ['departure|a'], entered: ['departure|d'], untracked: 0 });
    expect(r.textSwaps).toBeGreaterThanOrEqual(1);
    expect(calmMotionFailures(r)).toEqual([]);
  });

  it('a list re-rendered in place is caught: every row re-created, many mutations', async () => {
    document.body.innerHTML = list(['a', 'b', 'c']);
    start(CALM_MOTION_SPEC);
    const ol = document.querySelector('ol')!;
    ol.innerHTML = list(['a', 'b', 'c']).replace(/^.*<ol data-testid="nearby-rows">|<\/ol>.*$/g, '');
    await Promise.resolve();
    const r = read(CALM_MOTION_SPEC);
    expect(r.rebuilt).toEqual(['departure|a', 'departure|b', 'departure|c']);
    expect(calmMotionFailures(r)).toEqual([
      `${r.mutations} structural mutations under the timeline in an idle minute (target ≤ 2: a departure leaving and one row entering; left 0, entered 0)`,
      '3 row(s) stayed on the list but were re-created: departure|a, departure|b, departure|c (target 0, a row keeps its node)',
    ]);
    expect(r.mutations).toBeGreaterThan(IDLE_MUTATIONS_MAX);
  });

  it('a wall without the timeline, or without rows, is a named failure, not a pass', () => {
    document.body.innerHTML = '<main></main>';
    start(CALM_MOTION_SPEC);
    const none = read(CALM_MOTION_SPEC);
    expect(none.rootFound).toBe(false);
    expect(calmMotionFailures(none)).toEqual(['the timeline ([data-testid=nearby]) is missing, so calm motion cannot be measured']);
    const empty: CalmMotionReading = { ...none, rootFound: true };
    expect(calmMotionFailures(empty)).toEqual(['the timeline had no rows ([data-testid=nearby] .nearby-row) to follow through the idle minute']);
    expect(read(CALM_MOTION_SPEC)).toMatchObject({ rootFound: false, before: 0 });
  });
});

describe('headings', () => {
  it('reads the visible h1 and h2 texts', () => {
    document.body.innerHTML = '<h1>Kaj ima?</h1><h2 hidden>Skriveno</h2><h2> U blizini </h2><h3>ne</h3>';
    for (const el of document.querySelectorAll<HTMLElement>('h1, h2')) el.getBoundingClientRect = () => rect(0);
    const shipped = new Function(`return (${String(HEADINGS_IN_PAGE)});`)() as typeof HEADINGS_IN_PAGE;
    expect(shipped(HEADINGS)).toEqual(['Kaj ima?', 'U blizini']);
  });
});

// --- the phone -----------------------------------------------------------------------------------
describe('the phone\'s verdicts', () => {
  it('three departures fully inside 390×844, never more', () => {
    const at = (text: string, top: number, left = 16, width = 358) => ({ text, top, bottom: top + 60, left, right: left + width });
    const rows = [at('a', 400), at('b', 470), at('c', 540)];
    expect(phoneDepartureFailures(phoneDepartures(rows, PHONE_VIEWPORT))).toEqual([]);
    const low = phoneDepartures([...rows.slice(0, 2), at('c', 820)], PHONE_VIEWPORT);
    expect(low).toMatchObject({ total: 3, inFold: 2 });
    expect(phoneDepartureFailures(low)).toEqual(['Sada: 2 departure row(s) fully inside the first viewport (target exactly 3): "a", "b", "c"']);
    const board = phoneDepartures([...rows, at('d', 610)], PHONE_VIEWPORT);
    expect(phoneDepartureFailures(board, 'the stop board')).toEqual([
      'the stop board: 4 departure row(s) fully inside the first viewport (target exactly 3): "a", "b", "c", "d"',
      'the stop board: 4 departure rows in all (target ≤ 3, never a board)',
    ]);
    expect(phoneDepartureFailures(phoneDepartures([], PHONE_VIEWPORT))).toEqual(['Sada: 0 departure row(s) fully inside the first viewport (target exactly 3): none']);
  });

  it('a departure pushed sideways out of the viewport (a carousel, a scrolled strip) is not inside it', () => {
    const at = (text: string, top: number, left: number) => ({ text, top, bottom: top + 60, left, right: left + 358 });
    const sideways = phoneDepartures([at('a', 400, 16), at('b', 470, 16), at('c', 400, 16 + PHONE_VIEWPORT.width)], PHONE_VIEWPORT);
    expect(sideways).toMatchObject({ total: 3, inFold: 2 });
    expect(phoneDepartureFailures(sideways)).toEqual(['Sada: 2 departure row(s) fully inside the first viewport (target exactly 3): "a", "b", "c"']);
    expect(phoneDepartures([at('a', 400, -380)], PHONE_VIEWPORT).inFold).toBe(0);
    expect(phoneDepartures([at('a', 400, 200)], PHONE_VIEWPORT).inFold).toBe(0);
  });

  it('pills: at least one drawn, and "+N" on no label (6+2 fails, as "6|2 +11" does)', () => {
    expect(pillFailures('6|11|12')).toEqual([]);
    expect(pillFailures('6+2')).toEqual(['1 vehicle pill(s) folded into "+N": "6+2" (target none: /\\+\\d/ on every label)']);
    expect(pillFailures('6|2 +11|14')).toEqual(['1 vehicle pill(s) folded into "+N": "2 +11" (target none: /\\+\\d/ on every label)']);
    expect(pillFailures('')).toEqual(['no vehicle pill drawn (data-pills "")']);
    expect(pillFailures(null)).toEqual(['no vehicle pill drawn (data-pills null)']);
  });

  it('after expiry no content row is kept: .nearby-row, li.sada-departure and [data-kind=departure] alike, and no request follows', () => {
    const shipped = new Function(`return (${String(EXPIRY_READ_IN_PAGE)});`)() as typeof EXPIRY_READ_IN_PAGE;
    expect(PHONE_CONTENT_ROWS).toBe(`${PHONE_PROBES.nearbyRow}, ${PHONE_PROBES.sadaDepartures}, ${PHONE_PROBES.departureRows}`);
    const ended = '<section data-testid="session-ended"><a href="/s/">Skeniraj ponovno</a><a href="/hitno">Hitno</a></section>';
    // happy-dom lays nothing out: every element gets a box, so only the styles decide what is shown.
    const realRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = () => rect(100);
    document.body.innerHTML = `${ended}<ul data-testid="day-departures">${['6 Sopot 2 min', '11 Dubec 5 min', '12 Dubrava 8 min'].map((t) => `<li class="sada-departure">${t}</li>`).join('')}</ul>`;
    const kept = shipped(EXPIRY_SPEC);
    expect(kept).toMatchObject({ ended: true, scanLinks: 1, hitnoLinks: 1, rows: 3, exportControls: 0 });
    expect(expiryFailures(kept)).toEqual([`3 content row(s) kept after the session ended (${PHONE_CONTENT_ROWS}; target 0): "6 Sopot 2 min", "11 Dubec 5 min", "12 Dubrava 8 min"`]);
    document.body.innerHTML = `${ended}<ol><li class="nearby-row">Zalazak sunca 18:57</li></ol><button data-action="copy">Kopiraj</button>`;
    expect(expiryFailures(shipped(EXPIRY_SPEC))).toEqual([
      `1 content row(s) kept after the session ended (${PHONE_CONTENT_ROWS}; target 0): "Zalazak sunca 18:57"`,
      `1 export, copy, print or calendar control(s) after the session ended (${PHONE_PROBES.exportControls}; target 0)`,
    ]);
    // The stricter reading of §16.4: a row hidden by display:none is still retained content (the content must go).
    document.body.innerHTML = `${ended}<ul data-testid="day-departures"><li class="sada-departure" style="display: none">6 Sopot 2 min</li></ul>`;
    expect(expiryFailures(shipped(EXPIRY_SPEC))).toEqual([`1 content row(s) kept after the session ended (${PHONE_CONTENT_ROWS}; target 0): "6 Sopot 2 min"`]);
    // A session-ended block that is display:none, transparent or boxless is no ended session, and its links are not shown.
    document.body.innerHTML = ended.replace('<section data-testid="session-ended"', '<section data-testid="session-ended" style="display: none"');
    expect(shipped(EXPIRY_SPEC)).toMatchObject({ ended: false, scanLinks: 0, hitnoLinks: 0 });
    document.body.innerHTML = ended;
    const clear = shipped(EXPIRY_SPEC);
    expect(expiryFailures(clear)).toEqual([]);
    expect(expiryFailures(clear, ['/api/data/zet-rt'])).toEqual(['1 /api/data request(s) after the session ended: /api/data/zet-rt (target none)']);
    document.body.innerHTML = '<main></main>';
    expect(expiryFailures(shipped(EXPIRY_SPEC))).toEqual([
      `no ${PHONE_PROBES.sessionEnded} once the session ended ([O-59])`,
      `the ended session has no link to scan again (${PHONE_PROBES.sessionEndedScan})`,
      `the ended session has no /hitno link (${PHONE_PROBES.sessionEndedHitno})`,
    ]);
    HTMLElement.prototype.getBoundingClientRect = realRect;
    document.body.innerHTML = '';
  });

  it('reads the sentence without the card\'s own kicker, and keeps a sentence that merely starts with the word', () => {
    expect(phoneSentenceText('Promet · Tramvaj 6 polazi za 2 min.', 'promet')).toBe('Tramvaj 6 polazi za 2 min.');
    expect(phoneSentenceText('PrometTramvaj 6 polazi za 2 min.', 'promet')).toBe('Tramvaj 6 polazi za 2 min.');
    expect(phoneSentenceText('Noćas: Koncert u 21:00.', 'nocas')).toBe('Koncert u 21:00.');
    expect(phoneSentenceText('Promet je gust do 18:00.', 'promet')).toBe('Promet je gust do 18:00.');
    expect(phoneSentenceText('Promet · Tramvaj.', 'kultura')).toBe('Promet · Tramvaj.');
    expect(phoneSentenceText('Promet', 'promet')).toBe('');
    expect(phoneSentenceText('  Sunce\n zalazi u 18:57. ', null)).toBe('Sunce zalazi u 18:57.');
  });

  it('one sentence of 1–80 characters, never cut, with one of the six kickers', () => {
    expect(phoneSentenceFailures('Sunce zalazi u 18:57.', 'vrijeme')).toEqual([]);
    expect(phoneSentenceFailures('', null)).toEqual([
      'the sentence ([data-testid=sada-sentence]) has 0 characters (target 1–80): ""',
      'the sentence\'s data-kicker is null (target one of promet, kultura, vrijeme, bicikli, nocas, radovi)',
    ]);
    expect(phoneSentenceFailures(`${'a'.repeat(78)}…`, 'promet')).toEqual([`the sentence is cut with an ellipsis: "${'a'.repeat(78)}…"`]);
    expect(phoneSentenceFailures('b'.repeat(81), 'promet')).toHaveLength(1);
  });

  it('a box intersects the viewport when it shares area with it', () => {
    expect(intersects({ top: 0, bottom: 100, left: 0, right: 700 }, DESK_VIEWPORT)).toBe(true);
    expect(intersects({ top: 900, bottom: 1000, left: 0, right: 700 }, DESK_VIEWPORT)).toBe(false);
    expect(intersects({ top: 0, bottom: 100, left: 1440, right: 2000 }, DESK_VIEWPORT)).toBe(false);
    expect(intersects(undefined, DESK_VIEWPORT)).toBe(false);
  });
});
