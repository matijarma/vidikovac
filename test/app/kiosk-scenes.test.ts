// @vitest-environment happy-dom
// The kiosk's scene field (kiosk/scenes.ts): the order and its skip rule, the
// pure readers (tonight's events, the works in the kvart, the next session,
// the Grad rows), each scene's markup with its diffable regions, and the
// mounted field's swap mechanics with the controller's own clock injected.
import { describe, expect, it, vi } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { NEARBY_CLOSURE_M } from '../../app/src/kiosk/local';
import {
  closuresNear, currentScene, eventsTonight, GRAD_ROW_FLOOR, gradRows, mountScenes, nextSession, parsePinnedScene, SCENE_ENTER_MS,
  SCENE_LEAVE_MS, SCENE_ORDER, sceneHeadMarkup, sceneMarkup, sceneOrder, TONIGHT_ROW_FLOOR, WORKS_RADIUS_M, worksInKvart,
  type SceneContext, type SceneModel,
} from '../../app/src/kiosk/scenes';
import { routeLongName } from '../../app/src/kiosk/stops';
import { routeEnds } from '../../app/src/transport/catalogue';
import { kioskStrings } from '../../app/src/kiosk/strings';

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb
const STOP = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '11', '12', '13', '14', '17', '31', '32', '34'] };
/** The same stop once area D stamps its district (R-DG19: Jelačić square lies in Gornji grad - Medveščak). */
const KVART_STOP = { ...STOP, district: 'gornji-grad-medvescak' };
const attr = { text: 'Izvor: test', url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' };
const i18n = createDefaultI18n('hr');
const s = kioskStrings('hr');

type Item = ModuleSnapshot['items'][number];
function snap(module: ModuleId, items: Item[], status: ModuleSnapshot['status'] = 'live'): ModuleSnapshot {
  return { module, tier: 'open', status, fetchedAt: new Date(NOW - 30_000).toISOString(), sourceUpdatedAt: new Date(NOW - 60_000).toISOString(), attribution: attr, items };
}
function item(module: ModuleId, id: string, kind: Item['kind'], title: string, extra: Partial<Item> = {}): Item {
  return { id, module, kind, tier: 'open', title, ...extra };
}
/** A point `metres` due south of the stop (a pure latitude offset), so a distance is deterministic. */
const south = (metres: number): [number, number] => [STOP.lon, STOP.lat - metres / ((Math.PI / 180) * 6_378_137)];

const ZET = snap('zet-rt', [
  item('zet-rt', 'vozila', 'vehicle', '156 vozila u pokretu', { data: { vehicles: 156 } }),
  item('zet-rt', 'vehicle:1', 'vehicle', '6', { at: '2026-09-11T12:31:40Z', geo: { type: 'Point', coordinates: [15.977, 45.813] }, data: { routeId: '6', routeType: 0 } }),
  item('zet-rt', 'route:6', 'vehicle', '6', { data: { routeId: '6', routeShortName: '6', medianDelaySeconds: 130, vehicles: 12 } }),
  item('zet-rt', 'route:11', 'vehicle', '11', { data: { routeId: '11', medianDelaySeconds: -5, vehicles: 8 } }),
  item('zet-rt', 'route:12', 'vehicle', '12', { data: { routeId: '12', medianDelaySeconds: -100, vehicles: 8 } }),
]);
const SESSION_DATA = { source: 'skupstina', organiser: 'Gradske skupštine Grada Zagreba', category: 'sjednica-skupstine', precision: 'time', venue: 'Trg Stjepana Radića 1', live: 'youtube' };
const SESSION_NEXT_WEEK = item('dogadanja', 'skupstina:13', 'event', '13. sjednica Gradske skupštine', { at: '2026-09-17T07:00:00Z', dateBasis: 'event', data: SESSION_DATA });
const SESSION_TONIGHT = item('dogadanja', 'skupstina:14', 'event', '14. sjednica Gradske skupštine', { at: '2026-09-11T15:00:00Z', dateBasis: 'event', data: SESSION_DATA });
const SESSION_ENDED = item('dogadanja', 'skupstina:12', 'event', '12. sjednica Gradske skupštine', { at: '2026-09-11T07:00:00Z', until: '2026-09-11T10:00:00Z', dateBasis: 'event', data: SESSION_DATA });
const KVARTOVSKE = item('dogadanja', 'kvartovske:1', 'event', 'Novi park u Trnju', { at: '2026-09-11T00:00:00Z', dateBasis: 'unknown', data: { source: 'kvartovske' } });
const ZET_NOTICE = item('dogadanja', 'zet-promet:1', 'event', 'Obilazak linija 6 i 11', { at: '2026-09-11T09:10:00Z', dateBasis: 'published', data: { source: 'zet-promet' } });
const KULTURPUNKT = item('dogadanja', 'kulturpunkt:1', 'event', 'Koncert u parku', { at: '2026-09-11T18:00:00Z', dateBasis: 'event', data: { source: 'kulturpunkt', category: 'koncert', precision: 'time', venue: 'Pogon' } });
const work = (id: string, title: string, coordinates: [number, number], district: string, phase = 'Radovi u tijeku'): Item =>
  item('dogadanja', `komunalne:${id}`, 'event', title, { at: '2026-07-02T00:00:00Z', dateBasis: 'updated', geo: { type: 'Point', coordinates }, data: { source: 'komunalne', phase, status: 'U tijeku', amount: 1000, precision: 'day', district } });
const WORKS = [
  work('1', 'Ilica 120', south(350), 'gornji-grad-medvescak'),
  work('2', 'Avenija Dubrava 40', [16.07, 45.83], 'gornja-dubrava'),
  work('3', 'Savska cesta 1', south(200), 'gornji-grad-medvescak', 'U pripremi'),
];
const CITY_ROWS = [SESSION_NEXT_WEEK, KVARTOVSKE, ZET_NOTICE, ...WORKS];
const MODULES: ModuleSnapshot[] = [
  snap('dhmz-now', [item('dhmz-now', 'o1', 'observation', 'Zagreb-Maksimir', { at: '2026-09-11T12:00:00Z', data: { temp: 21, weather: 'vedro' } })]),
  snap('dhmz-cap', []),
  snap('prometnice', [item('prometnice', 'c1', 'closure', 'Ilica', { geo: { type: 'Point', coordinates: south(500) }, data: { subtype: 'ROAD_CLOSED' } })]),
  ZET,
  snap('emsc', [item('emsc', 'q1', 'quake', 'Potres', { at: '2026-09-11T10:11:00Z', data: { mag: 1.6, depth: 10, region: 'CROATIA' } })]),
  snap('dogadanja', CITY_ROWS),
  snap('ckan-geo', []),
];
function withModule(modules: readonly ModuleSnapshot[], id: ModuleId, patch: Partial<ModuleSnapshot>): ModuleSnapshot[] {
  return modules.map((m) => (m.module === id ? { ...m, ...patch } : m));
}
const without = (modules: readonly ModuleSnapshot[], id: ModuleId): ModuleSnapshot[] => modules.filter((m) => m.module !== id);
const TONIGHT_MODULES = withModule(MODULES, 'dogadanja', { items: [SESSION_TONIGHT, SESSION_ENDED, KULTURPUNKT, ...CITY_ROWS] });

function ctx(over: Partial<SceneContext> = {}): SceneContext {
  return { modules: MODULES, stop: KVART_STOP, now: NOW, strings: s, i18n, locale: 'hr', lightweight: false, size: 'compact', columns: 4, ...over };
}
/** The wide drawing's rail: six members across where the compact one holds four. */
function wide(over: Partial<SceneContext> = {}): SceneContext {
  return ctx({ size: 'wide', columns: 6, ...over });
}
function model(over: Partial<SceneModel> = {}): SceneModel {
  return { ...ctx(), index: 0, pinned: null, rotate: true, ...over };
}
const dom = (markup: string): HTMLElement => { const el = document.createElement('div'); el.innerHTML = markup; return el; };
const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const q = (root: ParentNode, sel: string): HTMLElement | null => root.querySelector<HTMLElement>(sel);
const qa = (root: ParentNode, sel: string): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(sel)];

describe('the constants the CSS and the controller pin', () => {
  it('names the three scenes in order, the two fade durations and the floors', () => {
    expect(SCENE_ORDER).toEqual(['promet', 'veceras', 'grad']);
    expect(SCENE_LEAVE_MS).toBe(180);
    expect(SCENE_ENTER_MS).toBe(220);
    expect(TONIGHT_ROW_FLOOR).toBe(3);
    expect(GRAD_ROW_FLOOR).toBe(3);
    expect(WORKS_RADIUS_M).toBe(1500);
    expect(WORKS_RADIUS_M).toBe(NEARBY_CLOSURE_M);
  });
});

describe('sceneOrder and currentScene', () => {
  it('is Promet and Grad when nothing dated happens today, Večeras between them when something does', () => {
    expect(sceneOrder(ctx())).toEqual(['promet', 'grad']);
    expect(sceneOrder(ctx({ modules: TONIGHT_MODULES }))).toEqual(['promet', 'veceras', 'grad']);
  });
  it('lets a pin win, holds the first scene when not rotating, and wraps the index otherwise', () => {
    expect(currentScene(model({ pinned: 'grad' }))).toBe('grad');
    expect(currentScene(model({ pinned: 'veceras', index: 0 }))).toBe('veceras');
    expect(currentScene(model({ rotate: false, index: 1 }))).toBe('promet');
    expect(currentScene(model({ index: 0 }))).toBe('promet');
    expect(currentScene(model({ index: 1 }))).toBe('grad');
    expect(currentScene(model({ index: 2 }))).toBe('promet');
    expect(currentScene(model({ modules: TONIGHT_MODULES, index: 4 }))).toBe('veceras');
  });
});

describe('eventsTonight', () => {
  it('keeps today\'s dated open-licence rows whose end has not passed, in start order', () => {
    const rows = eventsTonight(TONIGHT_MODULES, NOW);
    expect(rows.map((r) => r.id)).toEqual(['skupstina:14']);
  });
  it('never sees an undated notice, a register change, a publication time, an ended session or a Kulturpunkt row', () => {
    const ids = eventsTonight(TONIGHT_MODULES, NOW).map((r) => r.id);
    expect(ids).not.toContain('kvartovske:1');
    expect(ids).not.toContain('komunalne:1');
    expect(ids).not.toContain('zet-promet:1');
    expect(ids).not.toContain('skupstina:12');
    expect(ids).not.toContain('kulturpunkt:1');
  });
  it('is empty before the source answers and while it is down: missing is not "nothing on"', () => {
    expect(eventsTonight(without(TONIGHT_MODULES, 'dogadanja'), NOW)).toEqual([]);
    expect(eventsTonight(withModule(TONIGHT_MODULES, 'dogadanja', { status: 'down' }), NOW)).toEqual([]);
  });
});

describe('worksInKvart (D18)', () => {
  it('counts the ongoing works of the stop\'s district when the rows carry one, nearest first by geometry', () => {
    const works = worksInKvart(MODULES, KVART_STOP, NOW);
    expect(works.state).toBe('live');
    expect(works.scope).toBe('kvart');
    expect(works.count).toBe(1);
    expect(works.nearest!.title).toBe('Ilica 120');
    expect(works.nearest!.distanceM).toBeGreaterThan(340);
    expect(works.nearest!.distanceM).toBeLessThan(360);
  });
  it('counts the whole city when the stop has no district, and when the worker has not stamped the rows yet', () => {
    const city = worksInKvart(MODULES, STOP, NOW);
    expect(city.scope).toBe('city');
    expect(city.count).toBe(2);
    expect(city.nearest!.title).toBe('Ilica 120');
    const unstamped = withModule(MODULES, 'dogadanja', { items: WORKS.map((w) => ({ ...w, data: Object.fromEntries(Object.entries(w.data!).filter(([k]) => k !== 'district')) })) });
    expect(worksInKvart(unstamped, KVART_STOP, NOW).scope).toBe('city');
    expect(worksInKvart(unstamped, KVART_STOP, NOW).count).toBe(2);
  });
  it('a district stop keeps its kvart scope while there is no row to judge by, so the label never flips on an outage', () => {
    expect(worksInKvart(withModule(MODULES, 'dogadanja', { status: 'down', items: [] }), KVART_STOP, NOW).scope).toBe('kvart');
    expect(worksInKvart(without(MODULES, 'dogadanja'), KVART_STOP, NOW).scope).toBe('kvart');
    expect(worksInKvart(withModule(MODULES, 'dogadanja', { items: [KVARTOVSKE] }), KVART_STOP, NOW)).toMatchObject({ state: 'live', scope: 'kvart', count: 0 });
    expect(worksInKvart(withModule(MODULES, 'dogadanja', { status: 'down', items: [] }), STOP, NOW).scope).toBe('city');
  });
  it('has no distance without a stop, and keeps the source state honest', () => {
    const none = worksInKvart(MODULES, null, NOW);
    expect(none.scope).toBe('city');
    expect(none.nearest).toEqual({ title: 'Ilica 120', distanceM: null });
    expect(worksInKvart(without(MODULES, 'dogadanja'), KVART_STOP, NOW)).toMatchObject({ state: 'loading', count: 0, nearest: null });
    expect(worksInKvart(withModule(MODULES, 'dogadanja', { status: 'down' }), KVART_STOP, NOW)).toMatchObject({ state: 'down', count: 0, nearest: null });
  });
});

describe('closuresNear, nextSession, gradRows', () => {
  it('counts closures within the nearby radius with the nearest street and its distance, none beyond it', () => {
    const near = closuresNear(MODULES, KVART_STOP, NOW);
    expect(near).toMatchObject({ state: 'live', count: 1 });
    expect(near.nearest!.title).toBe('Ilica');
    expect(Math.round(near.nearest!.distanceM! / 10) * 10).toBe(500);
    const far = withModule(MODULES, 'prometnice', { items: [item('prometnice', 'c2', 'closure', 'Dubrava', { geo: { type: 'Point', coordinates: [16.07, 45.83] } })] });
    expect(closuresNear(far, KVART_STOP, NOW)).toEqual({ state: 'live', count: 0, nearest: null });
  });
  it('finds the next session that has not ended, or none', () => {
    expect(nextSession(MODULES, NOW)!.id).toBe('skupstina:13');
    expect(nextSession(TONIGHT_MODULES, NOW)!.id).toBe('skupstina:14');
    expect(nextSession(withModule(MODULES, 'dogadanja', { items: [KVARTOVSKE, ...WORKS] }), NOW)).toBeNull();
  });
  it('takes the stories minus the Assembly, as many as the rail holds beside the ink tile, never a gazette issue', () => {
    const rows = gradRows(ctx());
    expect(rows).toHaveLength(GRAD_ROW_FLOOR);
    // A wider rail carries more of them beside the ink tile; the floor is what a narrow one still asks for.
    expect(gradRows(wide()).length).toBeGreaterThan(rows.length);
    expect(rows.map((r) => r.id)).toEqual(['quake:q1', 'city:kvartovske:1', 'city:zet-promet:1']);
    for (const row of rows) {
      expect(row.id).not.toMatch(/^city:skupstina:/);
      expect(`${row.kicker} ${row.title}`.toLowerCase()).not.toContain('glasnik');
    }
  });
});

describe('sceneHeadMarkup', () => {
  it('names the scene, says the lines beyond the cap once, and shows the dots with the position only when asked', () => {
    const head = dom(sceneHeadMarkup('promet', ctx(), { index: 0, count: 3 }, true));
    expect(text(q(head, 'h2.k-scene-title#k-scene-title'))).toBe('Promet');
    expect(text(q(head, '[data-testid=kiosk-scene-meta]'))).toBe('još 7 linija');
    expect(qa(head, '.k-scene-dots .k-dot')).toHaveLength(3);
    expect(qa(head, '.k-dot[data-on="1"]')).toHaveLength(1);
    expect(q(head, '.k-dot')!.dataset.on).toBe('1');
    expect(text(q(head, '[data-testid=kiosk-scene-position]'))).toBe('prizor 1 od 3');
    expect(q(head, '.k-scene-dots')!.getAttribute('aria-hidden')).toBe('true');
    const still = dom(sceneHeadMarkup('grad', ctx(), { index: 1, count: 2 }, false));
    expect(text(q(still, '.k-scene-title'))).toBe('Grad');
    expect(q(still, '.k-scene-dots')).toBeNull();
    expect(q(still, '[data-testid=kiosk-scene-position]')).toBeNull();
    expect(text(q(dom(sceneHeadMarkup('veceras', ctx(), { index: 1, count: 3 }, true)), '.k-scene-title'))).toBe('Večeras');
  });
});

describe('sceneMarkup: Promet', () => {
  it('fills the rail with the works band and the lines the room has left, in stop order with k badges and the state word in its tone', () => {
    const markup = sceneMarkup('promet', ctx());
    const body = dom(markup.body);
    // No map in the scene any more: the map is the field mountScenes builds once.
    expect(q(body, '.k-map')).toBeNull();
    const rail = q(body, 'ul.k-rail[data-chapter=promet][data-testid=kiosk-lines]')!;
    expect(rail).not.toBeNull();
    expect(rail.hasAttribute('data-rows')).toBe(false);
    // The works band leads the rail and takes two of the compact rail's four
    // tracks, because it names a street where a line tile names a number.
    expect(rail.firstElementChild!.getAttribute('data-testid')).toBe('kiosk-works');
    expect(rail.firstElementChild!.getAttribute('data-span')).toBe('2');
    const tiles = qa(body, '[data-testid=kiosk-lines] .tl[data-route]');
    expect(tiles.map((t) => t.dataset.route)).toEqual(['6', '11']);
    expect(tiles.map((t) => t.dataset.tone)).toEqual(['late', 'ontime']);
    expect(tiles.map((t) => text(q(t, '.tl-value')))).toEqual(['kasni 2 min', 'na vrijeme']);
    for (const tile of tiles) {
      expect(tile.classList.contains('k-tl-line')).toBe(true);
      expect(q(tile, '.tl-label .k-line-badge.line[data-size=k]')).not.toBeNull();
      expect(q(tile, '.tl-context .k-glyph use')!.getAttribute('href')).toBe('#icon-tram-front');
      expect(text(q(tile, '.tl-context'))).not.toContain('vozila');
    }
    const six = tiles[0]!;
    expect(six.dataset.kind).toBe('tram');
    expect(q(six, '.k-line-badge')!.getAttribute('aria-label')).toBe('tramvaj 6');
    // The line's two ends on their own line under the badge, one spelling whatever GTFS wrote (kajimafix 03.3).
    expect(text(q(six, '.k-tl-name'))).toBe(routeEnds(routeLongName('6')));
    expect(q(six, '.tl-label .k-tl-name')).toBeNull();
    expect(text(q(six, '.tl-context > span[aria-hidden=true]'))).toBe('1');
    expect(text(q(six, '.tl-context .k-visually-hidden'))).toBe('1 vozilo u blizini');
    expect(text(q(tiles[1]!, '.tl-context .k-visually-hidden'))).toBe('nijedno vozilo u blizini');
    expect(markup.regions['kiosk-scene-meta']).toBe('još 7 linija');
    // The rail is one region: the works band and the lines are rewritten together, and the map is never among them.
    expect(Object.keys(markup.regions).sort()).toEqual(['kiosk-lines', 'kiosk-scene-meta']);
    expect(dom(markup.regions['kiosk-lines']!).querySelectorAll('.tl[data-route]')).toHaveLength(2);
  });
  it('gives a wider rail more lines and a narrower one fewer, saying the rest once in the meta', () => {
    expect(qa(dom(sceneMarkup('promet', wide()).body), '.tl[data-route]')).toHaveLength(4);
    expect(sceneMarkup('promet', wide()).regions['kiosk-scene-meta']).toBe('još 5 linija');
    const narrow = sceneMarkup('promet', ctx({ columns: 3 }));
    expect(qa(dom(narrow.body), '.tl[data-route]')).toHaveLength(2);
    expect(narrow.regions['kiosk-scene-meta']).toBe('još 7 linija');
  });
  it('stands the rail up as rows at one column, in the lagano board\'s own grammar', () => {
    const markup = sceneMarkup('promet', ctx({ columns: 1 }));
    const body = dom(markup.body);
    const rail = q(body, 'ul.k-rail[data-chapter=promet][data-rows="1"]')!;
    expect(rail).not.toBeNull();
    expect(qa(rail, 'li.k-line')).toHaveLength(2);
    expect(qa(rail, '.tl[data-route]')).toHaveLength(0);
    expect(q(rail, 'li.k-line .k-line-badge.line[data-size=k]')).not.toBeNull();
  });
  it('draws the works band for the kvart with the nearest work and its distance, and the count as the trail', () => {
    const body = dom(sceneMarkup('promet', ctx()).body);
    const band = q(body, 'li.tl[data-variant=band][data-tone=komunalno][data-testid=kiosk-works]')!;
    expect(band).not.toBeNull();
    expect(q(band, '.k-glyph use')!.getAttribute('href')).toBe('#icon-hard-hat');
    expect(text(q(band, '.tl-main .tl-label'))).toBe('Radovi u kvartu');
    expect(text(q(band, '.tl-main .tl-title'))).toBe('Ilica 120 · 350 m');
    expect(text(q(band, '.tl-trail'))).toBe('1');
  });
  it('says "Radovi u gradu" with the city count when the stop has no district, and collapses the row when nothing is ongoing', () => {
    const city = dom(sceneMarkup('promet', ctx({ stop: STOP })).body);
    expect(text(q(city, '[data-testid=kiosk-works] .tl-label'))).toBe('Radovi u gradu');
    expect(text(q(city, '[data-testid=kiosk-works] .tl-trail'))).toBe('2');
    // Nothing ongoing leaves the rail entirely, and the lines take the member it would have had.
    const quiet = sceneMarkup('promet', ctx({ modules: withModule(MODULES, 'dogadanja', { items: [SESSION_NEXT_WEEK, KVARTOVSKE] }) }));
    expect(q(dom(quiet.body), '[data-testid=kiosk-works]')).toBeNull();
    expect(qa(dom(quiet.body), '.tl[data-route]')).toHaveLength(4);
    // A stale zero goes too (kajimafix 03.3): "0 · zastarjelo" is a hole dressed as a fact.
    const staleQuiet = sceneMarkup('promet', ctx({ modules: withModule(MODULES, 'dogadanja', { status: 'stale', items: [SESSION_NEXT_WEEK, KVARTOVSKE] }) }));
    expect(q(dom(staleQuiet.body), '[data-testid=kiosk-works]')).toBeNull();
  });
  it('keeps the works band in place with the honest word when the source is down, and as bars while it loads', () => {
    const down = dom(sceneMarkup('promet', ctx({ modules: withModule(MODULES, 'dogadanja', { status: 'down', items: [] }) })).body);
    const band = q(down, 'li.tl[data-variant=band][data-state=down][data-testid=kiosk-works]')!;
    expect(text(band)).toContain('Izvor trenutačno ne odgovara');
    expect(text(band)).toContain('Radovi u kvartu');
    const downCity = dom(sceneMarkup('promet', ctx({ stop: STOP, modules: withModule(MODULES, 'dogadanja', { status: 'down', items: [] }) })).body);
    expect(text(q(downCity, '[data-testid=kiosk-works] .tl-label'))).toBe('Radovi u gradu');
    const loading = dom(sceneMarkup('promet', ctx({ modules: without(MODULES, 'dogadanja') })).body);
    expect(qa(loading, '[data-testid=kiosk-works][data-skeleton] .sk').length).toBeGreaterThanOrEqual(2);
    expect(q(loading, '[data-testid=kiosk-works]')!.getAttribute('aria-hidden')).toBe('true');
  });
  it('is three bars per tile while ZET loads, one down note when it does not answer, and the stale badge on each last-good tile', () => {
    const loading = sceneMarkup('promet', ctx({ modules: without(MODULES, 'zet-rt') }));
    const lines = dom(loading.body).querySelector('[data-testid=kiosk-lines]')!;
    expect(lines.querySelectorAll('.tl[data-skeleton]:not([data-testid])')).toHaveLength(2);
    expect(lines.querySelectorAll('.tl[data-skeleton]:not([data-testid]) .sk')).toHaveLength(6);
    expect(lines.querySelectorAll('.tl[data-route]')).toHaveLength(0);
    expect(loading.regions['kiosk-scene-meta']).toBe('');
    const down = dom(sceneMarkup('promet', ctx({ modules: withModule(MODULES, 'zet-rt', { status: 'down', items: [] }) })).body);
    const note = q(down, '[data-testid=kiosk-lines] .k-board-note[data-state=down]')!;
    expect(text(note)).toBe('ZET trenutačno ne odgovara.');
    expect(qa(down, '.tl[data-route]')).toHaveLength(0);
    expect(qa(down, '[data-testid=kiosk-lines] .k-board-note')).toHaveLength(1);
    const stale = dom(sceneMarkup('promet', ctx({ modules: withModule(MODULES, 'zet-rt', { status: 'stale' }) })).body);
    expect(qa(stale, '.tl[data-route] .badge[data-tone=stale]')).toHaveLength(2);
    expect(text(q(stale, '.tl[data-route="6"] .tl-value'))).toBe('kasni 2 min');
  });
  it('under lagano the lines board is the whole scene: ten rows, the rest said once, the map host hidden', () => {
    const stop = { ...STOP, routes: [...STOP.routes, '106', '109'] };
    const markup = sceneMarkup('promet', ctx({ lightweight: true, columns: 10, stop }));
    const body = dom(markup.body);
    expect(q(body, '.k-scene-grid')!.dataset.board).toBe('1');
    expect(q(body, '.k-map[data-testid=kiosk-live] > [data-testid=kiosk-map-host][hidden]')).not.toBeNull();
    const board = q(body, '.k-map > .k-lines.k-lines--board[data-testid=kiosk-lines]')!;
    expect(board.querySelectorAll('li.k-line')).toHaveLength(10);
    expect(text(q(board, '.k-line-more'))).toBe('još 1 linija');
    expect(qa(body, '.tl')).toHaveLength(0);
    expect(q(body, '[data-testid=kiosk-works]')).toBeNull();
    expect(markup.regions['kiosk-scene-meta']).toBe('');
    expect(Object.keys(markup.regions).sort()).toEqual(['kiosk-lines', 'kiosk-scene-meta']);
  });
});

describe('sceneMarkup: Večeras', () => {
  it('lists one time tile for today\'s session with its label, title and the venue line, the next one tinted', () => {
    const markup = sceneMarkup('veceras', ctx({ modules: TONIGHT_MODULES }));
    const rows = dom(markup.body).querySelector('.k-rail[data-chapter=veceras][data-testid=kiosk-tonight]')!;
    const tiles = rows.querySelectorAll<HTMLElement>('.tl[data-variant=time]');
    expect(tiles).toHaveLength(1);
    const tile = tiles[0]!;
    expect(tile.dataset.source).toBe('skupstina');
    expect(tile.dataset.tint).toBe('events');
    expect(text(q(tile, 'time.tl-time'))).toBe('17:00');
    expect(q(tile, 'time.tl-time')!.getAttribute('datetime')).toBe('2026-09-11T15:00:00Z');
    expect(text(q(tile, '.tl-main .tl-label'))).toBe('Gradska skupština');
    expect(text(q(tile, '.tl-main .tl-title'))).toBe('14. sjednica Gradske skupštine');
    expect(text(q(tile, '.tl-main .tl-context'))).toBe('Skupština Grada Zagreba · Trg Stjepana Radića 1 · prijenos uživo');
    expect(markup.regions['kiosk-tonight']).toBe(rows.innerHTML);
    expect(markup.regions['kiosk-scene-meta']).toBe('');
  });
  it('caps the rows at three and counts the rest in the meta; a day-precision row says "cijeli dan"', () => {
    const more = ['15', '16', '17', '18'].map((n) => item('dogadanja', `skupstina:${n}`, 'event', `${n}. sjednica`, { at: `2026-09-11T${n}:00:00Z`, dateBasis: 'event', data: { ...SESSION_DATA } }));
    const allDay = item('dogadanja', 'skupstina:19', 'event', 'Dan otvorenih vrata', { at: '2026-09-10T22:00:00Z', dateBasis: 'event', data: { source: 'skupstina', category: 'sjednica-odbora', precision: 'day' } });
    const narrow = ctx({ columns: 3, modules: withModule(MODULES, 'dogadanja', { items: [allDay, ...more] }) });
    const markup = sceneMarkup('veceras', narrow);
    const body = dom(markup.body);
    expect(qa(body, '.tl[data-variant=time]')).toHaveLength(TONIGHT_ROW_FLOOR);
    expect(markup.regions['kiosk-scene-meta']).toBe('još 2 događanja');
    // A wider rail shows one more of the same five and says one fewer is left.
    const wider = sceneMarkup('veceras', wide({ modules: narrow.modules }));
    expect(qa(dom(wider.body), '.tl[data-variant=time]')).toHaveLength(5);
    expect(wider.regions['kiosk-scene-meta']).toBe('');
    const first = q(body, '.tl[data-variant=time]')!;
    expect(text(q(first, '.tl-time'))).toBe('cijeli dan');
    expect(q(first, '.tl-time')!.hasAttribute('data-allday')).toBe(true);
    expect(qa(body, '.tl[data-tint=events]')).toHaveLength(1);
  });
  it('says the honest empty sentence in a calm band when pinned with nothing on, bars while loading, the unknown band when down', () => {
    const empty = dom(sceneMarkup('veceras', ctx()).body);
    const band = q(empty, '[data-testid=kiosk-tonight] .tl[data-variant=band][data-level=calm]')!;
    expect(text(band)).toBe('Večeras nema najavljenih događanja u kvartu.');
    expect(qa(empty, '.tl[data-variant=time]')).toHaveLength(0);
    const loading = dom(sceneMarkup('veceras', ctx({ modules: without(MODULES, 'dogadanja') })).body);
    expect(qa(loading, '[data-testid=kiosk-tonight] .sk-row')).toHaveLength(4);
    expect(qa(loading, '.tl')).toHaveLength(0);
    const down = dom(sceneMarkup('veceras', ctx({ modules: withModule(MODULES, 'dogadanja', { status: 'down', items: [] }) })).body);
    const unknown = q(down, '[data-testid=kiosk-tonight] .tl[data-variant=band][data-level=unknown]')!;
    expect(text(unknown)).toContain('Izvor trenutačno ne odgovara');
  });
  it('a stale copy is unconfirmed, never a calm empty: the badge replaces a row\'s context, and a stale zero says so', () => {
    const staleRow = dom(sceneMarkup('veceras', ctx({ modules: withModule(TONIGHT_MODULES, 'dogadanja', { status: 'stale' }) })).body);
    const tile = q(staleRow, '.tl[data-variant=time]')!;
    expect(q(tile, '.tl-main .badge[data-tone=stale]')).not.toBeNull();
    expect(q(tile, '.tl-context')).toBeNull();
    expect(text(q(tile, '.tl-title'))).toBe('14. sjednica Gradske skupštine');
    const staleZero = dom(sceneMarkup('veceras', ctx({ modules: withModule(MODULES, 'dogadanja', { status: 'stale' }) })).body);
    expect(q(staleZero, '.tl[data-level=calm]')).toBeNull();
    const band = q(staleZero, '[data-testid=kiosk-tonight] .tl[data-variant=band][data-level=unknown][data-state=stale]')!;
    expect(text(band)).toContain('Zastarjelo');
  });
});

describe('sceneMarkup: Grad', () => {
  it('puts exactly one ink tile on the screen: the next session with its time, the dated label, the title and the venue line', () => {
    const markup = sceneMarkup('grad', ctx());
    const city = dom(markup.body).querySelector('.k-rail[data-chapter=grad][data-testid=kiosk-city]')!;
    const inks = city.querySelectorAll<HTMLElement>('.tl[data-variant=ink]');
    expect(inks).toHaveLength(1);
    const ink = inks[0]!;
    expect(ink.dataset.testid).toBe('k-city-ink');
    expect(text(q(ink, 'time.tl-time'))).toBe('09:00');
    expect(text(q(ink, '.tl-label'))).toBe('Gradska skupština · čet 17. 9.');
    expect(text(q(ink, '.tl-title'))).toBe('13. sjednica Gradske skupštine');
    expect(text(q(ink, '.tl-context'))).toBe('Trg Stjepana Radića 1 · sjednica Skupštine');
    expect(markup.regions['kiosk-city']).toBe(city.innerHTML);
  });
  it('without a session the ink tile keeps its place, its time empty and the honest sentence as the title', () => {
    const body = dom(sceneMarkup('grad', ctx({ modules: withModule(MODULES, 'dogadanja', { items: [KVARTOVSKE, ZET_NOTICE, ...WORKS] }) })).body);
    const ink = q(body, '.tl[data-variant=ink][data-testid=k-city-ink]')!;
    expect(text(q(ink, '.tl-time'))).toBe('');
    expect(text(q(ink, '.tl-title'))).toBe('Nema najavljenih sjednica.');
    expect(q(ink, '.badge')).toBeNull();
    expect(qa(body, '.tl[data-variant=ink]')).toHaveLength(1);
    // A stale "none announced" is unconfirmed: the badge rides the tile.
    const stale = dom(sceneMarkup('grad', ctx({ modules: withModule(MODULES, 'dogadanja', { status: 'stale', items: [KVARTOVSKE] }) })).body);
    expect(q(stale, '.tl[data-variant=ink][data-state=stale] .badge[data-tone=stale]')).not.toBeNull();
    expect(text(q(stale, '.tl[data-variant=ink] .tl-title'))).toBe('Nema najavljenih sjednica.');
  });
  it('lists up to three rows with their glyphs and credits: never a session, never the gazette', () => {
    const body = dom(sceneMarkup('grad', ctx()).body);
    const rows = qa(body, '.tl[data-variant=row]');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.dataset.kind)).toEqual(['quake', 'city', 'city']);
    // The wide drawing's rail holds every story the city has beside the same one ink tile.
    expect(qa(dom(sceneMarkup('grad', wide()).body), '.tl[data-variant=row]')).toHaveLength(4);
    expect(qa(dom(sceneMarkup('grad', wide()).body), '.tl[data-variant=ink]')).toHaveLength(1);
    expect(rows.map((r) => q(r, '.k-glyph use')!.getAttribute('href'))).toEqual(['#icon-activity', '#icon-landmark', '#icon-tram-front']);
    expect(text(q(rows[0]!, '.tl-trail'))).toBe('EMSC · 12:11');
    expect(text(q(rows[1]!, '.tl-title'))).toBe('Novi park u Trnju');
    expect(text(q(rows[1]!, '.tl-trail'))).toBe('Grad Zagreb');
    expect(text(q(rows[2]!, '.tl-trail'))).toBe('ZET · 11:10');
    const stories = gradRows(ctx());
    rows.forEach((row, i) => {
      expect(text(row).toLowerCase()).not.toContain('sjednica');
      expect(text(row).toLowerCase()).not.toContain('glasnik');
      // The full credit rides the row as its title: the source's own attribution line, filled.
      expect(row.getAttribute('title')).toBe(stories[i]!.attribution);
      expect(row.getAttribute('title')).toMatch(/^Izvor/);
    });
  });
  it('keeps yesterday\'s date on a row that is not today\'s, and the register day for a works change', () => {
    const modules = withModule(MODULES, 'dogadanja', { items: [WORKS[0]!] });
    const rows = qa(dom(sceneMarkup('grad', ctx({ modules })).body), '.tl[data-variant=row]');
    // stories() interleaves city and quake: the works change leads, the quake follows.
    expect(rows.map((r) => r.dataset.kind)).toEqual(['city', 'quake']);
    expect(text(q(rows[0]!, '.tl-trail'))).toBe('Grad Zagreb · čet 2. 7.');
    expect(q(rows[0]!, '.k-glyph use')!.getAttribute('href')).toBe('#icon-hard-hat');
  });
  it('marks a stale source on its own tiles: the badge after a row\'s title, in place of the ink tile\'s context', () => {
    const modules = withModule(MODULES, 'dogadanja', { status: 'stale' });
    const body = dom(sceneMarkup('grad', ctx({ modules })).body);
    const rows = qa(body, '.tl[data-variant=row]');
    expect(q(rows[0]!, '.badge')).toBeNull();
    expect(text(q(rows[0]!, '.tl-trail'))).toBe('EMSC · 12:11');
    expect(q(rows[1]!, '.tl-main .badge[data-tone=stale]')).not.toBeNull();
    const ink = q(body, '.tl[data-variant=ink]')!;
    expect(ink.dataset.state).toBe('stale');
    expect(q(ink, '.badge[data-tone=stale]')).not.toBeNull();
    expect(q(ink, '.tl-context')).toBeNull();
    expect(text(q(ink, '.tl-title'))).toBe('13. sjednica Gradske skupštine');
  });
  it('with nothing to list, a stale city says unconfirmed and only an answering city says "nothing new"', () => {
    const quiet = MODULES.map((m) => (['dogadanja', 'emsc'].includes(m.module) ? { ...m, items: [] } : m));
    const calm = dom(sceneMarkup('grad', ctx({ modules: quiet })).body);
    expect(text(q(calm, '.tl[data-variant=band][data-level=calm] .tl-title'))).toBe('Trenutačno nema novih obavijesti.');
    const stale = dom(sceneMarkup('grad', ctx({ modules: quiet.map((m) => (m.module === 'dogadanja' ? { ...m, status: 'stale' as const } : m)) })).body);
    expect(q(stale, '.tl[data-level=calm]')).toBeNull();
    expect(text(q(stale, '.tl[data-variant=band][data-level=unknown][data-state=stale] .tl-title'))).toContain('Zastarjelo');
  });
  it('shows the ink and the rows as bars while every city source loads, and one unknown band when all are down', () => {
    const loading = dom(sceneMarkup('grad', ctx({ modules: MODULES.filter((m) => !['dogadanja', 'emsc'].includes(m.module)) })).body);
    expect(qa(loading, '.tl[data-variant=ink][data-skeleton]')).toHaveLength(1);
    expect(qa(loading, '.tl[data-variant=row][data-skeleton]')).toHaveLength(3);
    expect(qa(dom(sceneMarkup('grad', wide({ modules: MODULES.filter((m) => !['dogadanja', 'emsc'].includes(m.module)) })).body), '.tl[data-variant=row][data-skeleton]')).toHaveLength(5);
    expect(qa(loading, '.tl[data-variant=ink]')).toHaveLength(1);
    const down = MODULES.map((m) => (['dogadanja', 'emsc'].includes(m.module) ? { ...m, status: 'down' as const, items: [] } : m));
    const body = dom(sceneMarkup('grad', ctx({ modules: down })).body);
    expect(text(q(body, '.tl[data-variant=ink][data-state=down] .tl-title'))).toBe('Izvor trenutačno ne odgovara');
    expect(qa(body, '.tl[data-variant=band][data-level=unknown]')).toHaveLength(1);
    expect(qa(body, '.tl[data-variant=row]')).toHaveLength(0);
  });
});

describe('parsePinnedScene', () => {
  it('reads ?prizor= as a scene id and nothing else', () => {
    expect(parsePinnedScene('?prizor=promet')).toBe('promet');
    expect(parsePinnedScene('?prizor=veceras')).toBe('veceras');
    expect(parsePinnedScene('?lagano=1&prizor=grad')).toBe('grad');
    expect(parsePinnedScene('prizor=grad')).toBe('grad');
    expect(parsePinnedScene('?prizor=nesto')).toBeNull();
    expect(parsePinnedScene('?prizor=')).toBeNull();
    expect(parsePinnedScene('')).toBeNull();
    expect(parsePinnedScene('?lagano=1')).toBeNull();
  });
});

describe('mountScenes', () => {
  interface Timer { fn: () => void; ms: number; cancelled: boolean }
  function mountField() {
    const host = document.createElement('div');
    document.body.replaceChildren(host);
    const timers: Timer[] = [];
    const defer = (fn: () => void, ms: number): (() => void) => { const t: Timer = { fn, ms, cancelled: false }; timers.push(t); return () => { t.cancelled = true; }; };
    const handle = mountScenes(host, { defer });
    return { host, handle, timers, run: () => { for (const t of timers.splice(0)) if (!t.cancelled) t.fn(); } };
  }
  const items = (root: ParentNode): HTMLElement[] => qa(root, '.k-scene-item');

  it('builds the map into the field once and reports its host, before any chapter has been drawn', () => {
    const f = mountField();
    const section = q(f.host, 'section.k-scene[data-map="1"][data-testid=kiosk-scene]')!;
    expect(section.getAttribute('aria-labelledby')).toBe('k-scene-title');
    // The chip and the rail are the map's own children, so nothing the rail draws can be said to paint over the picture by accident.
    expect(q(section, '.k-map[data-testid=kiosk-live] > [data-testid=kiosk-map-host]')).not.toBeNull();
    expect(q(section, '.k-map > .k-scene-head')).not.toBeNull();
    expect(q(section, '.k-map > .k-scene-body')).not.toBeNull();
    expect(f.handle.mapHost).toBe(q(section, '[data-testid=kiosk-map-host]'));
    f.handle.update(model());
    expect(section.dataset.scene).toBe('promet');
    expect(f.handle.current()).toBe('promet');
    expect(f.handle.order()).toEqual(['promet', 'grad']);
    expect(items(section)).toHaveLength(1);
    expect(items(section)[0]!.dataset.scene).toBe('promet');
    expect(text(q(section, '.k-scene-head .k-scene-title'))).toBe('Promet');
    expect(f.handle.mapHost).toBe(q(section, '[data-testid=kiosk-map-host]'));
    expect(f.handle.element).toBe(section);
  });
  it('leaves the previous item under data-leaving for SCENE_LEAVE_MS while the map stands still under both', () => {
    const f = mountField();
    f.handle.update(model());
    const picture = f.handle.mapHost;
    f.handle.update(model({ index: 1 }));
    expect(f.handle.current()).toBe('grad');
    const all = items(f.host);
    expect(all).toHaveLength(2);
    expect(all[0]!.dataset.leaving).toBe('1');
    expect(all[0]!.dataset.scene).toBe('promet');
    expect(all[1]!.dataset.scene).toBe('grad');
    expect(all[1]!.hasAttribute('data-leaving')).toBe(false);
    // The map is the field, not a panel one chapter owns: it is the same element through the swap and after it.
    expect(f.handle.mapHost).toBe(picture);
    expect(f.handle.element.dataset.scene).toBe('grad');
    expect(f.timers.map((t) => t.ms)).toEqual([SCENE_LEAVE_MS]);
    f.run();
    expect(items(f.host)).toHaveLength(1);
    expect(items(f.host)[0]!.dataset.scene).toBe('grad');
  });
  it('a change faster than the fade removes the copy already leaving at once, its timer cancelled', () => {
    const f = mountField();
    f.handle.update(model());
    f.handle.update(model({ index: 1 }));
    f.handle.update(model({ index: 2 }));
    const all = items(f.host);
    expect(all.map((el) => el.dataset.scene)).toEqual(['grad', 'promet']);
    expect(all[0]!.dataset.leaving).toBe('1');
    expect(f.timers[0]!.cancelled).toBe(true);
    f.run();
    expect(items(f.host).map((el) => el.dataset.scene)).toEqual(['promet']);
  });
  it('holds the first scene when not rotating, and shows neither dots nor the position sentence', () => {
    const f = mountField();
    f.handle.update(model({ rotate: false, index: 1 }));
    expect(f.handle.current()).toBe('promet');
    f.handle.update(model({ rotate: false, index: 2 }));
    expect(f.handle.current()).toBe('promet');
    expect(items(f.host)).toHaveLength(1);
    expect(qa(f.host, '.k-dot')).toHaveLength(0);
    expect(q(f.host, '[data-testid=kiosk-scene-position]')).toBeNull();
  });
  it('a pin boots straight onto its scene, with no dots, and the empty Večeras is reachable only that way', () => {
    const f = mountField();
    f.handle.update(model({ pinned: 'grad', rotate: false }));
    expect(f.handle.current()).toBe('grad');
    expect(items(f.host)[0]!.dataset.scene).toBe('grad');
    expect(qa(f.host, '.k-dot')).toHaveLength(0);
    f.handle.update(model({ pinned: 'veceras', rotate: false }));
    expect(f.handle.current()).toBe('veceras');
    expect(text(q(f.host, '[data-testid=kiosk-tonight] .tl[data-level=calm]'))).toBe('Večeras nema najavljenih događanja u kvartu.');
  });
  it('the dots count the order and mark the scene on show; the position sentence says the same', () => {
    const f = mountField();
    f.handle.update(model());
    expect(qa(f.host, '.k-dot')).toHaveLength(2);
    expect(qa(f.host, '.k-dot').map((d) => d.dataset.on ?? '')).toEqual(['1', '']);
    expect(text(q(f.host, '[data-testid=kiosk-scene-position]'))).toBe('prizor 1 od 2');
    f.handle.update(model({ index: 1 }));
    expect(qa(f.host, '.k-dot').map((d) => d.dataset.on ?? '')).toEqual(['', '1']);
    expect(text(q(f.host, '[data-testid=kiosk-scene-position]'))).toBe('prizor 2 od 2');
    f.handle.update(model({ modules: TONIGHT_MODULES, index: 1 }));
    expect(f.handle.order()).toEqual(['promet', 'veceras', 'grad']);
    expect(f.handle.current()).toBe('veceras');
    expect(qa(f.host, '.k-dot')).toHaveLength(3);
    expect(text(q(f.host, '[data-testid=kiosk-scene-position]'))).toBe('prizor 2 od 3');
  });
  it('a same-scene poll rewrites only the regions that changed and never touches the map element', () => {
    const f = mountField();
    f.handle.update(model());
    const map = q(f.host, '.k-map')!;
    const host = q(f.host, '[data-testid=kiosk-map-host]')!;
    const lines = q(f.host, '[data-testid=kiosk-lines]')!;
    const worksHtml = q(f.host, '[data-testid=kiosk-works]')!.outerHTML;
    const slower = withModule(MODULES, 'zet-rt', { items: ZET.items.map((it) => (it.id === 'route:6' ? { ...it, data: { ...it.data, medianDelaySeconds: 400 } } : it)) });
    f.handle.update(model({ modules: slower }));
    expect(items(f.host)).toHaveLength(1);
    expect(q(f.host, '.k-map')).toBe(map);
    expect(q(f.host, '[data-testid=kiosk-map-host]')).toBe(host);
    expect(q(f.host, '[data-testid=kiosk-lines]')).toBe(lines);
    expect(text(q(lines, '.tl[data-route="6"] .tl-value'))).toBe('kasni 7 min');
    expect(q(f.host, '[data-testid=kiosk-works]')!.outerHTML).toBe(worksHtml);
    const quiet = withModule(slower, 'dogadanja', { items: [SESSION_NEXT_WEEK, KVARTOVSKE] });
    f.handle.update(model({ modules: quiet }));
    expect(q(f.host, '.k-map')).toBe(map);
    expect(q(f.host, '[data-testid=kiosk-works]')).toBeNull();
    f.handle.update(model({ modules: slower }));
    expect(q(f.host, '[data-testid=kiosk-works]')!.outerHTML).toBe(worksHtml);
    expect(q(f.host, '.k-map')).toBe(map);
  });
  it('the meta follows the poll without a swap', () => {
    const f = mountField();
    f.handle.update(model());
    expect(text(q(f.host, '[data-testid=kiosk-scene-meta]'))).toBe('još 7 linija');
    f.handle.update(model({ stop: { ...KVART_STOP, routes: ['6', '11'] } }));
    expect(text(q(f.host, '[data-testid=kiosk-scene-meta]'))).toBe('');
    expect(items(f.host)).toHaveLength(1);
  });
  it('fit gives a title one line only when its tile overflows; a DOM without layout is left alone', () => {
    const f = mountField();
    f.handle.update(model({ pinned: 'grad', rotate: false }));
    const tile = q(f.host, '.tl[data-variant=row]')!;
    f.handle.fit();
    expect(tile.dataset.lines).toBeUndefined();
    Object.defineProperty(tile, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(tile, 'scrollHeight', { configurable: true, value: 140 });
    f.handle.fit();
    expect(tile.dataset.lines).toBe('1');
    Object.defineProperty(tile, 'scrollHeight', { configurable: true, value: 100 });
    f.handle.fit();
    expect(tile.dataset.lines).toBeUndefined();
  });
  it('destroy cancels the leave timers and removes the field', () => {
    const f = mountField();
    f.handle.update(model());
    f.handle.update(model({ index: 1 }));
    f.handle.destroy();
    expect(f.timers.every((t) => t.cancelled)).toBe(true);
    expect(f.host.children).toHaveLength(0);
  });
  it('falls back to the platform timer when none is injected', () => {
    vi.useFakeTimers();
    try {
      const host = document.createElement('div');
      const handle = mountScenes(host, {});
      handle.update(model());
      handle.update(model({ index: 1 }));
      expect(items(host)).toHaveLength(2);
      vi.advanceTimersByTime(SCENE_LEAVE_MS);
      expect(items(host)).toHaveLength(1);
      handle.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
