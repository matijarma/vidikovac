// @vitest-environment happy-dom
// The kiosk's pure modules: copy, layout, credentials, districts and stops,
// the local content derived from the stop-scoped teaser, and the map adapter.
import { describe, expect, it, vi } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { AREAS } from '../../worker/pairing/areas';
import { ScreenError } from '../../app/src/core/screens';
import { publicItemKey } from '../../app/src/core/contracts';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { BEACON_STORAGE_KEY } from '../../app/src/beacon';
import { createMapSlots } from '../../app/src/map/map-slots';
import { forgetBeacon, msUntilExpiry, screenExpired, withScreen } from '../../app/src/kiosk/credentials';
import { DISTRICTS, districtBySlug, districtLabel } from '../../app/src/kiosk/districts';
import { essentialsRows, fitEssentials } from '../../app/src/kiosk/essentials';
import { fmtDistance, fmtNumber, fmtTemp, mmss, weekdayDayMonth } from '../../app/src/kiosk/format';
import { KIOSK_HANDHELD_MAX_PX } from '../../app/src/core/breakpoints';
import { decideLayout, FIELD_DESIGN_HEIGHT, FIELD_DESIGN_WIDTH, HANDHELD_MAX_WIDTH, MIN_ZOOM, PORTRAIT } from '../../app/src/kiosk/layout';
import { cityDateLine, closuresNear, closuresNearby, compassLabel, downPlaceholder, eventsTonight, KIOSK_TEASER_MODULES, kioskQuakes, lastDeparturesAhead, linesAtStop, nearbyVehicleCount, nearestPharmacy, nextSession, pharmaciesByDistance, quakeLine, recentQuakes, safetyStrip, staleCopy, stories, sunToday, weatherNow, windowOf, worksInKvart } from '../../app/src/kiosk/local';
import type { LastRunSnapshot } from '../../app/src/core/lastrun';
import { busesVisible, CITY_DETAIL_ZOOM, cityWindowView, createKioskMapAdapter, FIELD_MIN_ZOOM, FIELD_SPAN_M, fieldZoom, HANDHELD_SPAN_M, KIOSK_BASEMAP_PROFILE, KIOSK_EMPHASIS, KIOSK_HIT_TOLERANCE_PX, KIOSK_MAP_SLOT_ID, KIOSK_SYMBOL_SCALE, kioskQuakePoints, labelPadding, metresPerPixel, PAIRED_ZOOM, pharmacyPoint, requestKioskMap, majorStreetNames, placeTitles, STOP_LABEL_MIN_RANK, THIN_NAMES_ZOOM, stopLabelTramInterchanges } from '../../app/src/kiosk/mapview';
import { emptyCity, type CityState } from '../../shared/city/types';
import { CURATED_WALL, curatedCityPoints } from '../../app/src/city/curated';
import { cityLabelsOf } from '../../app/src/map/city-map';
import { weatherMarkup } from '../../app/src/kiosk/markup';
import { creditText, eventGroups, fitRows, fitSentences, joinWithFit, pairedMarkup, row, sentencesOf, statusLine } from '../../app/src/kiosk/paired';
import { classifySetupError } from '../../app/src/kiosk/start';
import { DEFAULT_STOP_ID, rankStops, sortRouteIds } from '../../app/src/kiosk/stops';
import { fill, kioskStrings, plural } from '../../app/src/kiosk/strings';
// WP2 step 4: the framed wall (mapview.ts kioskCityLabels, map/frame.ts frameView).
import { CITY_WINDOW as CITY_WINDOW_BOX, kioskCityLabels, WALL_FIT_MIN_ZOOM } from '../../app/src/kiosk/mapview';
import { frameView } from '../../app/src/map/frame';

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb
const STOP = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '11', '12', '13', '14', '17', '31', '32', '34'] };
const attr = { text: 'Izvor: test', url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' };
const i18n = createDefaultI18n('hr');
const hr = kioskStrings('hr');

type Item = ModuleSnapshot['items'][number];
function snap(module: ModuleId, items: Item[], status: ModuleSnapshot['status'] = 'live'): ModuleSnapshot {
  return { module, tier: 'open', status, fetchedAt: new Date(NOW - 30_000).toISOString(), sourceUpdatedAt: new Date(NOW - 40_000).toISOString(), attribution: attr, items };
}
function item(module: ModuleId, id: string, kind: Item['kind'], title: string, extra: Partial<Item> = {}): Item {
  return { id, module, kind, tier: 'open', title, ...extra };
}
const MODULES: ModuleSnapshot[] = [
  snap('dhmz-now', [item('dhmz-now', 'o1', 'observation', 'Zagreb-Maksimir', { at: '2026-09-11T12:00:00Z', data: { temp: 21.4, humidity: 55, pressure: 1016, windDir: 'NW', windSpeed: 2.3, weather: 'vedro' } })]),
  snap('dhmz-cap', []),
  snap('prometnice', [
    item('prometnice', 'c1', 'closure', 'Ilica', { geo: { type: 'LineString', coordinates: [[15.9705, 45.813], [15.972, 45.8131]] }, until: '2026-09-12T06:00:00Z', data: { subtype: 'ROAD_CLOSED' } }),
    item('prometnice', 'c2', 'closure', 'Dubrava', { geo: { type: 'Point', coordinates: [16.07, 45.83] } }),
  ]),
  snap('zet-rt', [
    item('zet-rt', 'vozila', 'vehicle', '156 vozila u pokretu', { data: { vehicles: 156 } }),
    item('zet-rt', 'vehicle:1', 'vehicle', '6', { at: '2026-09-11T12:31:40Z', geo: { type: 'Point', coordinates: [15.977, 45.813] }, data: { routeId: '6', routeType: 0 } }),
    item('zet-rt', 'vehicle:2', 'vehicle', '6', { geo: { type: 'Point', coordinates: [15.978, 45.8125] }, data: { routeId: '6', routeType: 0 } }),
    item('zet-rt', 'route:6', 'vehicle', '6', { data: { routeId: '6', routeShortName: '6', medianDelaySeconds: 130, vehicles: 12 } }),
    item('zet-rt', 'route:11', 'vehicle', '11', { data: { routeId: '11', medianDelaySeconds: -5, vehicles: 8 } }),
  ]),
  snap('emsc', [item('emsc', 'q1', 'quake', 'Potres', { at: '2026-09-11T10:11:00Z', data: { mag: 1.6, depth: 10, region: 'CROATIA' } })]),
  snap('dogadanja', [
    item('dogadanja', 'skupstina:13', 'event', '13. sjednica Gradske skupštine', { at: '2026-09-17T07:00:00Z', dateBasis: 'event', data: { source: 'skupstina', precision: 'time' } }),
    item('dogadanja', 'kvartovske:1', 'event', 'Novi park u Trnju', { at: '2026-09-11T00:00:00Z', data: { source: 'kvartovske' } }),
    item('dogadanja', 'zet-promet:1', 'event', 'Obilazak linija 6 i 11', { at: '2026-09-11T09:10:00Z', dateBasis: 'published', data: { source: 'zet-promet' } }),
    item('dogadanja', 'komunalne:1', 'event', 'Ilica 1', { at: '2026-07-02T00:00:00Z', dateBasis: 'updated', data: { source: 'komunalne', phase: 'u tijeku', amount: 1000 } }),
    item('dogadanja', 'kp:1', 'event', 'Koncert u Močvari', { at: '2026-09-11T18:00:00Z', dateBasis: 'event', data: { source: 'kulturpunkt', venue: 'Močvara' } }),
    item('dogadanja', 'kp:2', 'event', 'Sutra izložba', { at: '2026-09-12T10:00:00Z', dateBasis: 'event', data: { source: 'kulturpunkt', precision: 'day' } }),
  ]),
  snap('ckan-geo', [item('ckan-geo', 'z1', 'poi', 'Zborno mjesto Ribnjak', { geo: { type: 'Point', coordinates: [15.98, 45.816] }, data: { layer: 'zborna-mjesta' } })]),
];

describe('kiosk copy', () => {
  function paths(node: unknown, prefix = ''): string[] {
    if (typeof node !== 'object' || node === null) return [prefix];
    const keys = Object.keys(node as object);
    if (keys.includes('one') && keys.includes('other')) return [prefix]; // a plural form: hr has 'few', en does not
    return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => paths(value, prefix ? `${prefix}.${key}` : key)).sort();
  }
  it('hr and en carry exactly the same keys, and plurals go through Intl', () => {
    expect(paths(kioskStrings('en'))).toEqual(paths(hr));
    expect(plural('hr', hr.lines.nearby, 1)).toBe('1 vozilo u blizini');
    expect(plural('hr', hr.lines.nearby, 3)).toBe('3 vozila u blizini');
    expect(plural('hr', hr.lines.more, 5)).toBe('još 5 linija');
    expect(plural('en', kioskStrings('en').lines.nearby, 1)).toBe('1 vehicle nearby');
    expect(kioskStrings('en').lines.nearby.few).toBeUndefined();
    expect(fill('{a} · {b}', { a: 'x', b: 2 })).toBe('x · 2');
    expect(kioskStrings('en-GB').surface).toBe('public screen');
    expect(kioskStrings('de').surface).toBe('javni zaslon');
    expect(kioskStrings('hr')).toBe(hr);
  });
  it('is a thin adapter over the one catalogue: shared concepts come from shared.*, layers.* and motion.compass.*', () => {
    expect(hr.appName).toBe(i18n.t('common.appName'));
    expect(hr.paired.closuresNone).toBe(i18n.t('shared.closuresNone'));
    expect(hr.paired.warningsNone).toBe(i18n.t('shared.warningsNone'));
    expect(hr.safety.warningsNone).toBe('Nema upozorenja DHMZ-a za Zagreb');
    expect(hr.header.unlockedUntil).toBe(i18n.t('shared.unlockedUntil'));
    expect(hr.safety.hitno).toBe(i18n.t('shared.safetyPage'));
    expect(hr.safety.label).toBe(i18n.t('shared.safetyPage'));
    expect(hr.layers).toEqual({ 'grad-sada': 'Sada', 'u-pokretu': 'Karta', 'zrak-i-nebo': 'Vrijeme', sigurnost: 'Sigurnost', 'uprava-i-pravo': 'Grad', kultura: 'Događanja' });
    expect(hr.weather.compass.NW).toBe(i18n.t('motion.compass.NW'));
    expect(kioskStrings('en').status.offline).toBe('Screen offline; no code can be issued');
    expect(hr.setup.errorAccess).toBe('Poslužitelj je odbio postavljanje s ove veze. Pokušaj ponovno s druge mreže.');
  });
  it('speaks to one person, never promises "Uskoro", and never a login', () => {
    const forbidden = /(?<!\p{L})Vi(?!\p{L})|(?<!\p{L})Vaš|Skenirajte|Uskoro|Cloudflare Access|Prijavi se|ocjenjivaču/u;
    expect('Vi ste ovdje.').toMatch(forbidden);
    expect('Više ulica ima to ime.').not.toMatch(forbidden);
    expect(JSON.stringify(hr)).not.toMatch(forbidden);
  });
});

describe('layout: two compositions, never a proportional shrink, and a handheld below 900 px', () => {
  it('draws wide at 1920 x 1080 and compact at 1366 x 768, both at zoom 1', () => {
    expect(decideLayout({ width: 1920, height: 1080 })).toEqual({ size: 'wide', zoom: 1, portrait: false, totem: false });
    expect(decideLayout({ width: 1366, height: 768 })).toEqual({ size: 'compact', zoom: 1, portrait: false, totem: false });
  });
  it('gives a screen between the two the compact drawing with the room, scales wide up for 4K, and compact down no further than 0.8', () => {
    expect(decideLayout({ width: 1600, height: 900 })).toEqual({ size: 'compact', zoom: 1, portrait: false, totem: false });
    expect(decideLayout({ width: 3840, height: 2160 })).toEqual({ size: 'wide', zoom: 2, portrait: false, totem: false });
    expect(decideLayout({ width: 1280, height: 720 }).zoom).toBe(0.937);
    expect(decideLayout({ width: 1000, height: 560 }).zoom).toBe(MIN_ZOOM);
  });
  // T5.4: a portrait screen is one drawing on the compact tokens, designed for
  // 1080 x 1920 (kiosk.css [data-portrait='1']) and scaled from that size the
  // way the landscape ones scale from theirs: never the compact landscape
  // shrunk to 0.8, which would put the credit line under the 13 px floor and
  // the QR under 240 px on a wall that has the room.
  it('draws a portrait screen on the compact tiers at zoom 1 at 1080 x 1920, and scales it from that size, never below 0.8', () => {
    expect(decideLayout({ width: 1080, height: 1920 })).toEqual({ size: 'compact', zoom: 1, portrait: true, totem: true });
    expect(PORTRAIT).toEqual({ width: 1080, height: 1920 });
    // A 4K totem: the same drawing twice the size, compact tiers, never the wide composition on its side.
    expect(decideLayout({ width: 2160, height: 3840 })).toEqual({ size: 'compact', zoom: 2, portrait: true, totem: true });
    expect(decideLayout({ width: 1440, height: 2560 })).toEqual({ size: 'compact', zoom: 1.333, portrait: true, totem: true });
    // A rotated 1600 x 900 screen: scaled down by its narrower ratio; a squat portrait stops at the floor.
    expect(decideLayout({ width: 900, height: 1600 })).toEqual({ size: 'compact', zoom: 0.833, portrait: true, totem: true });
    expect(decideLayout({ width: 1080, height: 1200 })).toEqual({ size: 'compact', zoom: MIN_ZOOM, portrait: true, totem: true });
  });
  // T4.4: a kiosk opened on a phone is a handheld, never a compact screen
  // shrunk to 0.8 and cropped: zoom stays 1 and the page scrolls (kiosk.css).
  it('calls anything narrower than KIOSK_HANDHELD_MAX_PX a handheld at zoom 1, portrait as measured', () => {
    expect(HANDHELD_MAX_WIDTH).toBe(KIOSK_HANDHELD_MAX_PX);
    expect(decideLayout({ width: 390, height: 844 })).toEqual({ size: 'handheld', zoom: 1, portrait: true, totem: false });
    expect(decideLayout({ width: 844, height: 390 })).toEqual({ size: 'handheld', zoom: 1, portrait: false, totem: false });
    expect(decideLayout({ width: KIOSK_HANDHELD_MAX_PX - 1, height: 600 }).size).toBe('handheld');
    expect(decideLayout({ width: KIOSK_HANDHELD_MAX_PX, height: 600 }).size).toBe('compact');
  });
});

describe('credentials and phases', () => {
  const screen = { kind: 'temporary' as const, expiresAt: NOW + 3_600_000, stop: STOP };
  it('knows an expired temporary screen and how long a live one has left', () => {
    expect(screenExpired(screen, NOW)).toBe(false);
    expect(screenExpired({ ...screen, expiresAt: NOW - 1 }, NOW)).toBe(true);
    expect(screenExpired({ ...screen, expiresAt: null }, NOW)).toBe(false);
    expect(screenExpired(undefined, NOW)).toBe(false);
    expect(msUntilExpiry(screen, NOW)).toBe(3_600_000);
    expect(msUntilExpiry({ ...screen, expiresAt: null }, NOW)).toBeNull();
  });
  it('refreshes the screen metadata without touching the secret, and forgets only on request', () => {
    expect(withScreen({ beaconId: 'B1', secret: 's' }, screen)).toEqual({ beaconId: 'B1', secret: 's', screen });
    const raw: Record<string, string> = { [BEACON_STORAGE_KEY]: '{}' };
    forgetBeacon({ getItem: (k) => raw[k] ?? null, setItem: () => {}, removeItem: (k) => { delete raw[k]; } });
    expect(raw[BEACON_STORAGE_KEY]).toBeUndefined();
    expect(() => forgetBeacon(null)).not.toThrow();
  });
});

describe('districts, stops and the wizard\u2019s error sentences', () => {
  it('lists the 17 gradske četvrti with the slugs and names the Worker accepts', () => {
    expect(DISTRICTS.map((d) => d.slug)).toEqual(AREAS.map((a) => a.slug));
    expect(DISTRICTS.map((d) => d.name)).toEqual(AREAS.map((a) => a.name));
    expect(districtBySlug('trnje')?.name).toBe('Trnje');
    expect(districtLabel('nepoznato')).toBe('nepoznato');
    expect(districtLabel(null)).toBe('');
  });
  it('ranks stops nearest a point, folds accents in search and keeps one platform per name', () => {
    const stops = [STOP, { ...STOP, id: '106_2', lon: 15.9779 }, { id: '200_1', name: 'Zapruđe', lon: 15.99, lat: 45.77, routes: ['7'] }];
    const near = rankStops(stops, { near: { lon: 15.9797, lat: 45.8091 }, dedupeNames: true });
    expect(near.map((s) => s.id)).toEqual(['106_2', '200_1']);
    expect(near[0]!.distanceM).toBeLessThan(near[1]!.distanceM!);
    expect(rankStops(stops, { query: 'zaprud' }).map((s) => s.id)).toEqual(['200_1']);
    expect(rankStops(stops, { query: 'ZAPRUĐE' })).toHaveLength(1);
    expect(sortRouteIds(['12', '6', '109', '2A'])).toEqual(['2A', '6', '12', '109']);
    expect(DEFAULT_STOP_ID).toBe('106_1');
  });
  it('turns each refusal into one sentence kind; nothing here retries by itself', () => {
    expect(classifySetupError(new ScreenError('evaluation-access-required', 403))).toEqual({ kind: 'access', retryAfter: 0, field: '' });
    expect(classifySetupError(new ScreenError('screen-limit', 429, 1800))).toEqual({ kind: 'quota', retryAfter: 1800, field: '' });
    expect(classifySetupError(new ScreenError('bad-request', 400))).toMatchObject({ kind: 'invalid' });
    expect(classifySetupError(new ScreenError('screen-create-failed', 503))).toMatchObject({ kind: 'failed' });
    expect(classifySetupError(new TypeError('Failed to fetch'))).toMatchObject({ kind: 'network' });
  });
});

describe('formatting for a screen read from steps away', () => {
  it('a block states its source\'s condition in a word and never a fetch or update time (companion brief §12)', () => {
    const observation = snap('dhmz-now', []);
    expect(statusLine(observation, hr)).toBe('');
    const retrieved = { ...snap('dogadanja', []), sourceUpdatedAt: undefined };
    expect(statusLine(retrieved, hr)).toBe('');
    expect(statusLine(retrieved, kioskStrings('en'))).toBe('');
    expect(statusLine(snap('dhmz-now', [], 'stale'), hr)).toBe('zastarjelo');
    expect(statusLine(snap('dogadanja', [], 'stale'), kioskStrings('en'))).toBe(kioskStrings('en').paired.stale);
    expect(statusLine(snap('glasnik', []), hr)).toBe('');
    expect(statusLine(snap('glasnik', [], 'stale'), hr)).toBe('zastarjelo');
    expect(statusLine(snap('dhmz-now', [], 'down'), hr)).toBe(hr.paired.sourceDown);
    expect(statusLine(undefined, hr)).toBe('');
  });
  it('uses Croatian decimals, spaced units and the Zagreb wall clock', () => {
    expect(fmtNumber('hr', 12.8)).toBe('12,8');
    expect(fmtNumber('en', 12.8)).toBe('12.8');
    expect(fmtTemp('hr', 21)).toBe('21 °C');
    expect(fmtDistance('hr', 349)).toBe('350 m');
    expect(fmtDistance('hr', 1234)).toBe('1,2 km');
    expect(mmss(75)).toBe('1:15');
    expect(weekdayDayMonth('hr', '2026-09-17T07:00:00Z')).toBe('čet 17. 9.');
    expect(weekdayDayMonth('en', '2026-09-17T07:00:00Z')).toBe('Thu 17. 9.');
  });
});

describe('local content from the stop-scoped teaser', () => {
  it('reads the observation into a reading, a condition, three details and its own time (for freshness, never for print)', () => {
    const w = weatherNow(MODULES, hr, 'hr');
    expect(w.state).toBe('live');
    expect(w.temperature).toBe('21,4 °C');
    expect(w.condition).toBe('vedro');
    expect(w.station).toBe('Zagreb-Maksimir');
    expect(w.details).toEqual(['vlaga 55 %', 'vjetar sjeverozapad 2,3 m/s', '1016 hPa']);
    expect(w.observedMs).toBe(Date.parse('2026-09-11T12:00:00Z'));
    expect(w).not.toHaveProperty('observedAt');
    expect(weatherNow(MODULES.filter((m) => m.module !== 'dhmz-now'), hr, 'hr').state).toBe('loading');
    const dash = MODULES.map((m) => (m.module === 'dhmz-now' ? snap('dhmz-now', [item('dhmz-now', 'o1', 'observation', 'Zagreb-Maksimir', { at: '2026-09-11T12:00:00Z', data: { temp: 11.2, weather: '-' } })]) : m));
    expect(weatherNow(dash, hr, 'hr').condition).toBe(''); // DHMZ's "-" is "nothing to report", not a word
    expect(weatherNow(MODULES.map((m) => (m.module === 'dhmz-now' ? { ...m, status: 'down' as const } : m)), hr, 'hr').state).toBe('down');
  });
  it('lists the routes at the stop, capped, with each line\u2019s delay in words and its vehicles near the stop', () => {
    const wind = (data: Record<string, string | number>) => weatherNow(MODULES.map((m) => (m.module === 'dhmz-now' ? snap('dhmz-now', [item('dhmz-now', 'o1', 'observation', 'Zagreb-Maksimir', { at: '2026-09-11T12:00:00Z', data })]) : m)), hr, 'hr').details;
    // Wind: calm only at exactly zero; a speed without a direction is still a speed; a direction is the app's compass word.
    expect(wind({ temp: 11, windSpeed: 0, windDir: 'C' })).toEqual(['bez vjetra']);
    expect(wind({ temp: 11, windSpeed: 0.3, windDir: 'NW' })).toEqual(['vjetar sjeverozapad 0,3 m/s']);
    expect(wind({ temp: 11, windSpeed: 2.3 })).toEqual(['vjetar 2,3 m/s']);
    expect(wind({ temp: 11, windSpeed: 1.2, windDir: '-' })).toEqual(['vjetar 1,2 m/s']);
    expect(wind({ temp: 11, windSpeed: 4, windDir: 'NNE' })).toEqual(['vjetar sjeveroistok 4 m/s']);
    expect(compassLabel('ese', kioskStrings('en'))).toBe('south-east');
    expect(compassLabel('XYZ', hr)).toBe('');
    const board = linesAtStop(MODULES, STOP, i18n, 6);
    expect(board.state).toBe('live');
    expect(board.rows.map((r) => r.routeId)).toEqual(['6', '11', '12', '13', '14', '17']);
    expect(board.more).toBe(3);
    expect(board.moving).toBe(156);
    expect(board.rows[0]).toMatchObject({ routeId: '6', kind: 'tram', word: 'kasni 2 min', nearby: 2 });
    expect(board.rows[1]).toMatchObject({ routeId: '11', word: 'na vrijeme', nearby: 0 });
    expect(board.rows[2]!.word).toBe(''); // no delay row for line 12: unknown, not "on time"
    expect(linesAtStop(MODULES, null, i18n).rows.map((r) => r.routeId)).toEqual(['6']);
    expect(linesAtStop([], STOP, i18n).state).toBe('loading');
  });
  it('orders closures by distance from the stop and counts the ones within 1,5 km', () => {
    const near = closuresNear(MODULES, STOP, NOW);
    expect(near.count).toBe(2);
    expect(near.nearbyCount).toBe(1);
    expect(near.nearest?.title).toBe('Ilica');
    expect(near.nearest?.distanceM).toBeLessThan(700);
    expect(closuresNear(MODULES.map((m) => (m.module === 'prometnice' ? { ...m, status: 'down' as const } : m)), STOP, NOW)).toMatchObject({ state: 'down', count: 0 });
  });
  it('the safety strip names the warning state, the closure count with the nearest street, and the nearest on-duty pharmacy', () => {
    const strip = safetyStrip(MODULES, STOP, i18n, hr, NOW);
    expect(strip.warning).toEqual({ state: 'none', text: 'Nema upozorenja DHMZ-a za Zagreb', severity: null });
    expect(strip.closures.text).toBe('2 zatvaranja');
    expect(strip.closures.nearestText).toBe('najbliže Ilica');
    expect(strip.pharmacy.label).toBe('Trg bana J. Jelačića 3');
    expect(nearestPharmacy({ ...STOP, lon: 15.934, lat: 45.811 }).label).toBe('Ilica 291');
    const down = safetyStrip(MODULES.map((m) => (m.module === 'dhmz-cap' ? { ...m, status: 'down' as const } : m)), STOP, i18n, hr, NOW);
    expect(down.warning.state).toBe('unknown');
    expect(safetyStrip([], STOP, i18n, hr, NOW).warning.state).toBe('loading');
    const active = safetyStrip(MODULES.map((m) => (m.module === 'dhmz-cap' ? snap('dhmz-cap', [item('dhmz-cap', 'w', 'warning', 'Grmljavina', { severity: 'moderate' })]) : m)), STOP, i18n, hr, NOW);
    expect(active.warning).toEqual({ state: 'active', text: 'žuto upozorenje · Grmljavina', severity: 'moderate' });
  });
  it('interleaves city notices and the last quake into a bounded rotation with honest date lines', () => {
    const list = stories(MODULES, hr, 'hr', NOW);
    expect(list.length).toBeLessThanOrEqual(8);
    expect(list.slice(0, 2).map((s) => s.tone)).toEqual(['city', 'quake']);
    expect(list[0]).toMatchObject({ kicker: 'Gradska skupština', meta: 'čet 17. 9. 09:00', source: 'Skupština Grada Zagreba' });
    expect(list[1]!.title).toBe('Magnituda 1,6 · CROATIA · dubina 10 km');
    const byId = new Map(list.map((s) => [s.id, s]));
    expect(byId.get('city:kvartovske:1')?.meta).toBe('');
    expect(byId.get('city:zet-promet:1')?.meta).toBe('objavljeno 11. 9. 11:10');
    expect(byId.get('city:komunalne:1')?.meta).toBe('zadnja izmjena čet 2. 7.');
    expect(cityDateLine(item('dogadanja', 'x', 'event', 'x', { at: '2026-09-11T00:00:00Z', dateBasis: 'unknown' }), hr, 'hr')).toBe('');
  });
  it('lets every source the payload carries into the city rotation, the Assembly session included', () => {
    const unfiltered = MODULES.map((m) => (m.module === 'dogadanja' ? snap('dogadanja', [item('dogadanja', 'kp:9', 'event', 'Koncert u Močvari (Kulturpunkt)', { at: '2026-09-11T20:00:00Z', dateBasis: 'event', data: { source: 'kulturpunkt' } }), ...m.items]) : m));
    const list = stories(unfiltered, hr, 'hr', NOW);
    expect(list.some((s) => s.title.includes('Kulturpunkt'))).toBe(true); // every source the app fetches reaches the screen
    expect(list.some((s) => s.id === 'city:skupstina:13')).toBe(true);
  });
  it('reads the safety strip without a stop: the warning, the closures and the pharmacy', () => {
    const strip = (now: number) => safetyStrip(MODULES, null, i18n, hr, now);
    // The strip is judged at the fixture's clock: by the real one the Ilica closure (until 12 September) has ended.
    expect({ cap: strip(NOW).warning.text, closures: strip(NOW).closures.text, pharmacy: strip(NOW).pharmacy.label })
      .toEqual({ cap: 'Nema upozorenja DHMZ-a za Zagreb', closures: '2 zatvaranja', pharmacy: 'Trg bana J. Jelačića 3' });
    expect(strip(Date.parse('2026-09-13T12:00:00Z')).closures.text).toBe('1 zatvaranje');
  });
  it('the basics rows skip a silent source and read the tagged pharmacy when one exists', () => {
    const rows = essentialsRows(MODULES, i18n, hr, 'hr', STOP, NOW);
    expect(rows.map((r) => r.id)).toEqual(['closures', 'routes', 'weather', 'pharmacy']);
    expect(rows.find((r) => r.id === 'routes')).toMatchObject({ value: '6 kasni 2 min' });
    expect(rows.find((r) => r.id === 'closures')).toMatchObject({ value: '2 zatvaranja', detail: 'Ilica' });
    expect(rows.find((r) => r.id === 'weather')).toMatchObject({ value: '21,4 °C', detail: 'vedro' });
    expect(rows.find((r) => r.id === 'pharmacy')).toMatchObject({ value: 'Trg bana J. Jelačića 3' });
    expect(essentialsRows([], i18n, hr, 'hr', STOP, NOW)).toEqual([{ id: 'empty', label: '', value: hr.basics.empty }]);
  });
  it('a six-hour route median is a stale trip update, not a delay: it reads as unknown', () => {
    const stale = MODULES.map((m) => (m.module === 'zet-rt' ? snap('zet-rt', [...m.items, item('zet-rt', 'route:12', 'vehicle', '12', { data: { routeId: '12', medianDelaySeconds: 22_440, vehicles: 1 } })]) : m));
    const board = linesAtStop(stale, STOP, i18n, 6);
    expect(board.rows.find((r) => r.routeId === '12')!.word).toBe('');
    expect(board.rows.find((r) => r.routeId === '6')!.word).toBe('kasni 2 min');
  });
  it('computes the sun on the device for the day', () => {
    const staleCap = MODULES.map((m) => (m.module === 'dhmz-cap' ? { ...m, status: 'stale' as const } : m));
    expect(safetyStrip(staleCap, STOP, i18n, hr, NOW).warning).toEqual({ state: 'stale', text: 'Upozorenja DHMZ-a: zastarjelo, nepotvrđeno', severity: null });
    const staleActive = MODULES.map((m) => (m.module === 'dhmz-cap' ? snap('dhmz-cap', [item('dhmz-cap', 'w', 'warning', 'Grmljavina', { severity: 'moderate' })], 'stale') : m));
    expect(safetyStrip(staleActive, STOP, i18n, hr, NOW).warning).toMatchObject({ state: 'active', text: 'žuto upozorenje · Grmljavina · zastarjelo' });
    const staleClosures = MODULES.map((m) => (m.module === 'prometnice' ? { ...m, status: 'stale' as const } : m));
    expect(safetyStrip(staleClosures, STOP, i18n, hr, NOW).closures.text).toBe('2 zatvaranja · zastarjelo');
    const staleEmpty = MODULES.map((m) => (m.module === 'prometnice' ? snap('prometnice', [], 'stale') : m));
    expect(safetyStrip(staleEmpty, STOP, i18n, hr, NOW).closures.text).toBe('Zatvaranja: zastarjelo, nepotvrđeno');
    expect(essentialsRows(staleActive, i18n, hr, 'hr', STOP, NOW).find((r) => r.id === 'cap')).toMatchObject({ value: 'žuto upozorenje · zastarjelo' });
    expect(essentialsRows(staleClosures, i18n, hr, 'hr', STOP, NOW).find((r) => r.id === 'closures')).toMatchObject({ value: '2 zatvaranja · zastarjelo' });
  });
  it('hides trailing rows that do not fit a block and counts them; without layout it touches nothing', () => {
    const host = document.createElement('div');
    host.innerHTML = `<article class="k-block"><div class="k-block-body"><ul class="k-rows">${[1, 2, 3, 4, 5].map((n) => `<li class="k-row">${n}</li>`).join('')}</ul></div></article>`;
    fitRows(host, hr.paired.coverage);
    expect(host.querySelectorAll('.k-row[hidden]')).toHaveLength(0);
    // A body 100 px tall whose rows are 30 px each fits three.
    const measure = (el: HTMLElement) => ({ client: 100, scroll: 30 * [...el.querySelectorAll<HTMLElement>('.k-row')].filter((r) => !r.hidden).length + 10 });
    fitRows(host, hr.paired.coverage, measure);
    expect([...host.querySelectorAll<HTMLElement>('.k-row')].filter((r) => !r.hidden)).toHaveLength(3);
    expect(host.querySelector('.k-row-more')!.textContent).toBe('prikazano 3 od 5');
    fitRows(host, hr.paired.coverage, () => ({ client: 1000, scroll: 200 }));
    expect(host.querySelectorAll('.k-row[hidden]')).toHaveLength(0);
    expect(host.querySelector('.k-row-more')).toBeNull();
  });
  // T2.11 fix round 3: a cramped compact column (a long real street name
  // beside another block) can leave a block too short even for one row plus
  // its own "prikazano N od M" line; the floor is zero, not one, so the
  // line that discloses the true count is never itself the thing clipped.
  it('keeps the first useful row and reports a composition defect when it cannot fit', () => {
    const host = document.createElement('div');
    host.innerHTML = `<article class="k-block"><div class="k-block-body"><ul class="k-rows" data-total="39">${[1, 2].map((n) => `<li class="k-row">${n}</li>`).join('')}</ul></div></article>`;
    // A 64 px body: two rows of 62 px each never fit, and neither does one row (62) plus the note (28).
    const measure = (el: HTMLElement) => {
      const visible = [...el.querySelectorAll<HTMLElement>('.k-row')].filter((r) => !r.hidden).length;
      const note = el.querySelector('.k-row-more') ? 28 : 0;
      return { client: 64, scroll: visible * 62 + note };
    };
    fitRows(host, hr.paired.coverage, measure);
    expect([...host.querySelectorAll<HTMLElement>('.k-row')].filter((r) => !r.hidden)).toHaveLength(1);
    expect(host.querySelector('.k-row-more')!.textContent).toBe('prikazano 1 od 39');
    expect(host.querySelector<HTMLElement>('.k-block-body')!.dataset.overflow).toBe('true');
  });
  // T5.4: a block sized to its content (the portrait column under the map)
  // reads its body a rounding pixel over its box (clientHeight 159 against
  // scrollHeight 160 for a 159.4 px body, nothing cut); a row that fits by
  // half a pixel is never hidden for it. The e2e sweep allows the same pixel.
  it('keeps every row when the body overflows by a rounding pixel alone, and still trims from the second pixel', () => {
    const host = document.createElement('div');
    host.innerHTML = `<article class="k-block"><div class="k-block-body"><ul class="k-rows">${[1, 2, 3].map((n) => `<li class="k-row">${n}</li>`).join('')}</ul></div></article>`;
    fitRows(host, hr.paired.coverage, () => ({ client: 159, scroll: 160 }));
    expect(host.querySelectorAll('.k-row[hidden]')).toHaveLength(0);
    expect(host.querySelector('.k-row-more')).toBeNull();
    // Rows of 60 px in a 120 px box, two pixels over: a real overflow, trimmed until it fits.
    const measure = (el: HTMLElement) => ({ client: 120, scroll: 60 * [...el.querySelectorAll<HTMLElement>('.k-row')].filter((r) => !r.hidden).length + 2 });
    fitRows(host, hr.paired.coverage, measure);
    expect([...host.querySelectorAll<HTMLElement>('.k-row')].filter((r) => !r.hidden)).toHaveLength(1);
    expect(host.querySelector('.k-row-more')!.textContent).toBe('prikazano 1 od 3');
  });
  // W-fix3: a source's paragraph is never cut with an ellipsis or a clamp. It gives up whole
  // sentences from the end, then goes whole, and only once the rows have gone.
  it('splits a source paragraph into whole sentences, never at a date or a time', () => {
    expect(sentencesOf('Djelomice sunčano, uz mogućnost za malo kiše. Puhat će umjeren sjeverni vjetar. Najviša dnevna temperatura između 19 i 22 °C.'))
      .toEqual(['Djelomice sunčano, uz mogućnost za malo kiše.', 'Puhat će umjeren sjeverni vjetar.', 'Najviša dnevna temperatura između 19 i 22 °C.']);
    expect(sentencesOf('Lokalno mogući obilniji pljuskovi praćeni grmljavinom. Količina oborine > 20 mm')).toEqual(['Lokalno mogući obilniji pljuskovi praćeni grmljavinom.', 'Količina oborine > 20 mm']);
    expect(sentencesOf('Stranica ažurirana 20. 10. 2025. u 7.00 sati')).toEqual(['Stranica ažurirana 20. 10. 2025. u 7.00 sati']);
    expect(fitSentences('A b. C d.', 'p', 'k-text')).toBe('<p class="k-text" data-fit="sentences"><span class="k-fit-part">A b.</span> <span class="k-fit-part">C d.</span></p>');
  });
  it('carries the separator with a droppable paragraph, so dropping it never leaves a dot behind', () => {
    const strip = (markup: string, drop: boolean) => {
      const host = document.createElement('span');
      host.innerHTML = markup;
      if (drop) host.querySelector('.k-fit')!.remove();
      return host.textContent;
    };
    const middle = joinWithFit([{ text: 'od 14:00' }, { text: 'Pljuskovi. Tuča.', fit: true }, { text: 'do 23:59' }]);
    expect(strip(middle, false)).toBe('od 14:00 · Pljuskovi. Tuča. · do 23:59');
    expect(strip(middle, true)).toBe('od 14:00 · do 23:59');
    const first = joinWithFit([{ text: '' }, { text: 'Pljuskovi.', fit: true }, { text: 'do 23:59' }]);
    expect(strip(first, false)).toBe('Pljuskovi. · do 23:59');
    expect(strip(first, true)).toBe('do 23:59');
    expect(strip(joinWithFit([{ text: 'od 14:00' }, { text: 'Pljuskovi.', fit: true }]), true)).toBe('od 14:00');
    expect(joinWithFit([{ text: 'a < b' }, { text: 'x > 20 mm', fit: true }])).toBe('a &lt; b<span class="k-fit" data-fit="sentences"> · <span class="k-fit-part">x &gt; 20 mm</span></span>');
  });
  it('lets a paragraph give up whole sentences, then go whole, once only one row is left, and restores it on the next fit', () => {
    const host = document.createElement('div');
    host.innerHTML = `<article class="k-block"><div class="k-block-body"><ul class="k-rows">${[1, 2].map((n) => `<li class="k-row">${row(`Upozorenje ${n}`, joinWithFit([{ text: 'Prva. Druga. Treća.', fit: true }, { text: 'do 23:59' }]))}</li>`).join('')}</ul></div></article>`;
    const shownParts = () => [...host.querySelectorAll<HTMLElement>('.k-row:not([hidden]) .k-fit-part')].filter((el) => !el.hidden && !el.closest('[data-fit][hidden]')).length;
    // A row is 40 px, a sentence 20 px, the note 10 px: a 70 px body holds one row with one sentence and the note.
    const measure = (el: HTMLElement) => {
      const rows = [...el.querySelectorAll<HTMLElement>('.k-row')].filter((r) => !r.hidden);
      const parts = rows.flatMap((r) => [...r.querySelectorAll<HTMLElement>('.k-fit-part')]).filter((p) => !p.hidden && !p.closest('[data-fit][hidden]')).length;
      return { client: 70, scroll: rows.length * 40 + parts * 20 + (el.querySelector('.k-row-more') ? 10 : 0) };
    };
    fitRows(host, hr.paired.coverage, measure);
    expect([...host.querySelectorAll<HTMLElement>('.k-row')].filter((r) => !r.hidden)).toHaveLength(1);
    expect(shownParts()).toBe(1);
    expect(host.querySelector('.k-row-more')!.textContent).toBe('prikazano 1 od 2');
    expect(host.querySelector<HTMLElement>('.k-block-body')!.dataset.overflow).toBe('false');
    // 45 px: not even the first sentence fits, so the paragraph goes whole and the row keeps its title and end time.
    fitRows(host, hr.paired.coverage, (el) => ({ ...measure(el), client: 50 }));
    expect(host.querySelector<HTMLElement>('.k-row [data-fit=sentences]')!.hidden).toBe(true);
    expect(host.querySelector('.k-row .k-row-sub')!.textContent).toContain('do 23:59');
    // Room again: every row and every sentence is back.
    fitRows(host, hr.paired.coverage, () => ({ client: 1000, scroll: 200 }));
    expect(host.querySelectorAll('[hidden]')).toHaveLength(0);
  });
  it('fits the forecast\'s text, a block without rows, by whole sentences', () => {
    const host = document.createElement('div');
    host.innerHTML = `<article class="k-block" data-testid="k-forecast"><div class="k-block-body"><p class="k-figure">8 – 21 °C</p>${fitSentences('Prva rečenica. Druga rečenica. Treća rečenica.', 'p', 'k-text')}</div></article>`;
    const measure = (el: HTMLElement) => ({ client: 100, scroll: 50 + 25 * [...el.querySelectorAll<HTMLElement>('.k-fit-part')].filter((p) => !p.hidden && !p.closest('[data-fit][hidden]')).length });
    fitRows(host, hr.paired.coverage, measure);
    expect([...host.querySelectorAll<HTMLElement>('.k-fit-part')].map((p) => p.hidden)).toEqual([false, false, true]);
    expect(host.querySelector('.k-row-more')).toBeNull();
    fitRows(host, hr.paired.coverage);
    expect(host.querySelectorAll('[hidden]')).toHaveLength(0);
  });
  it('renders the forecast\'s text and a warning\'s description as whole sentences the fitter can let go of', () => {
    const cap = snap('dhmz-cap', [item('dhmz-cap', 'w', 'warning', 'Žuto upozorenje za grmljavinsku oluju', { severity: 'moderate', summary: 'Lokalno mogući obilniji pljuskovi praćeni grmljavinom. Količina oborine > 20 mm', until: '2026-09-11T21:59:00Z' })]);
    const forecast = snap('dhmz-forecast', [item('dhmz-forecast', 'f', 'forecast', 'Prognoza za Zagreb', { at: '2026-09-10T22:00:00Z', summary: 'Djelomice sunčano. Puhat će umjeren vjetar.', data: { tmin: 8, tmax: 21, weather: '3' } })]);
    const modules = [...MODULES.filter((m) => m.module !== 'dhmz-cap'), cap, forecast];
    const host = document.createElement('div');
    host.innerHTML = pairedMarkup({ layer: 'zrak-i-nebo', strings: hr, i18n, locale: 'hr', snapshots: Object.fromEntries(modules.map((m) => [m.module, m])), now: NOW, stop: STOP, selection: null, lightweight: false, size: 'wide' }).main;
    const text = host.querySelector<HTMLElement>('[data-testid=k-forecast] .k-text')!;
    expect(text.dataset.fit).toBe('sentences');
    expect([...text.querySelectorAll('.k-fit-part')].map((p) => p.textContent)).toEqual(['Djelomice sunčano.', 'Puhat će umjeren vjetar.']);
    const sub = host.querySelector<HTMLElement>('[data-testid=k-warnings] .k-row-sub')!;
    expect(sub.textContent).toMatch(/^Lokalno mogući obilniji pljuskovi praćeni grmljavinom\. Količina oborine > 20 mm · do .*23:59$/);
    expect(sub.querySelectorAll('[data-fit=sentences] .k-fit-part')).toHaveLength(2);
  });
  // Osnovno holds whole cards: at 1366 x 768 with a warning in the strip, five cards at the reading tiers do not fit the stage.
  it('keeps the whole Osnovno cards the box holds, from the first, and hides nothing without layout', () => {
    const rows = document.createElement('div');
    rows.innerHTML = ['cap', 'closures', 'routes', 'weather', 'pharmacy'].map((id) => `<div class="k-ess-row" data-row="${id}"></div>`).join('');
    fitEssentials(rows);
    expect(rows.querySelectorAll('[hidden]')).toHaveLength(0);
    // Three cards a row of 200 px each in a 343 px box: the second row does not fit, so its cards go, the last first.
    const measure = (el: HTMLElement) => ({ client: 343, scroll: 200 * Math.ceil([...el.children].filter((c) => !(c as HTMLElement).hidden).length / 3) });
    fitEssentials(rows, measure);
    expect([...rows.children].filter((c) => !(c as HTMLElement).hidden).map((c) => (c as HTMLElement).dataset.row)).toEqual(['cap', 'closures', 'routes']);
    expect(rows.dataset.overflow).toBe('false');
    // Never below the first card; a box too small even for it says so.
    fitEssentials(rows, () => ({ client: 100, scroll: 200 }));
    expect([...rows.children].filter((c) => !(c as HTMLElement).hidden)).toHaveLength(1);
    expect(rows.dataset.overflow).toBe('true');
    fitEssentials(rows, () => ({ client: 1000, scroll: 400 }));
    expect(rows.querySelectorAll('[hidden]')).toHaveLength(0);
  });
  it('computes the sun on the device for the day', () => {
    const sun = sunToday(NOW);
    expect(sun.sunrise).toMatch(/^06:[12]\d$/);
    expect(sun.sunset).toMatch(/^19:[12]\d$/);
    expect(sun.isDay).toBe(true);
    expect(sun.progress).toBeGreaterThan(0.5);
    expect(sun.progress).toBeLessThan(0.7);
  });
  it('groups events by Zagreb day and keeps published-only rows as notices; works belong to the Grad layer', () => {
    const ctx = { layer: 'kultura' as const, strings: hr, i18n, locale: 'hr', snapshots: Object.fromEntries(MODULES.map((m) => [m.module, m])), now: NOW, stop: STOP, selection: null, lightweight: false, size: 'wide' as const };
    const markup = pairedMarkup(ctx);
    // Three blocks fed by one module state their source once, under the grid, not three times.
    expect(markup.main.match(/k-main-source/g)).toHaveLength(1);
    expect(markup.main.match(/class="k-meta k-source"/g)).toBeNull();
    expect(markup.main).toContain('Močvara');
    expect(markup.main).not.toMatch(/sjednica-odbora|kulturpunkt|class="k-row-sub"><\/span>/);
    expect(markup.side).toContain('k-notices');
    // ZET's own notices (a detour, works on a line) live in this block with the neighbourhood news: Promet's column is the board alone, and the layer's one credit names ZET among the publishers.
    const side = document.createElement('div');
    side.innerHTML = markup.side;
    const noticeBlock = side.querySelector('[data-testid=k-notices]')!;
    expect(noticeBlock.textContent).toContain('Obilazak linija 6 i 11');
    expect(noticeBlock.textContent).toContain('ZET obavijest · objavljeno 11. 9. 11:10');
    expect(markup.main).toMatch(/k-main-source">[^<]*\bZET \(/);
    const items = MODULES.find((m) => m.module === 'dogadanja')!.items;
    const groups = eventGroups(items, NOW);
    expect(groups.today.map((e) => e.id)).toEqual(['kp:1']);
    expect(groups.tomorrow.map((e) => e.id)).toEqual(['kp:2']);
    expect(groups.later).toEqual([]); // the Assembly session belongs to Grad
    expect(groups.notices.map((e) => e.id)).toEqual(['kvartovske:1', 'zet-promet:1']); // undated notices, ZET's included
    const extra = [
      item('dogadanja', 'ex:1', 'event', 'Izložba koja traje', { at: '2026-09-01T09:00:00Z', until: '2026-09-30T18:00:00Z', dateBasis: 'event', data: { source: 'etnografski', category: 'izlozba', venue: 'Etnografski muzej, Zagreb' } }),
      item('dogadanja', 'ex:2', 'event', 'Izložba u Splitu', { at: '2026-09-11T09:00:00Z', dateBasis: 'event', data: { source: 'etnografski', venue: 'Etnografski muzej, Split' } }),
    ];
    const more = eventGroups([...items, ...extra], NOW);
    expect(more.ongoing.map((e) => e.id)).toEqual(['ex:1']); // began before today, still running: ongoing, not "today 09:00"
    expect(more.today.map((e) => e.id)).toEqual(['kp:1']); // Split is not Zagreb
    const withOngoing = { layer: 'kultura' as const, strings: hr, i18n, locale: 'hr', snapshots: { ...Object.fromEntries(MODULES.map((m) => [m.module, m])), dogadanja: snap('dogadanja', [...items, ...extra]) }, now: NOW, stop: STOP, selection: null, lightweight: false, size: 'wide' as const };
    const culture = pairedMarkup(withOngoing);
    expect(culture.main).toContain('data-testid="k-ongoing"');
    expect(culture.main).toContain('u tijeku · izložba · Etnografski muzej, Zagreb');
    expect(culture.main).toContain('do 30.\u00a09.'); // events.untilDate, day and month only [O-53]
    expect(culture.main).not.toContain('13. sjednica');
    expect(culture.main).not.toContain('Splitu');
    // Promet's column is the departure board alone: ZET's notices are Događanja's undated notices (asserted above), closures stay on Sada and Sigurnost.
    const promet = pairedMarkup({ ...withOngoing, layer: 'u-pokretu' as const });
    expect(promet.lines).toContain('class="k-line-list"');
    expect(promet.side).not.toContain('k-zet-notices');
    expect(promet.side).not.toContain('Obilazak linija 6 i 11');
    expect(promet.side).not.toContain('data-testid="k-closures"');
    const grad = pairedMarkup({ ...withOngoing, layer: 'uprava-i-pravo' as const });
    expect(grad.main).toContain('13. sjednica');
    expect(grad.main).toContain('data-testid="k-works"');
  });
});

// P2 task: the readers say.ts needs, moved (copy, not import: scenes.ts is
// P3's to delete) out of kiosk/scenes.ts, and new ones say.ts alone needs.
describe('readers moved from scenes.ts (P3 deletes it): eventsTonight, worksInKvart, closuresNearby, nextSession', () => {
  const KVART_STOP = { ...STOP, district: 'gornji-grad-medvescak' }; // R-DG19: Jelačić square lies in Gornji grad - Medveščak
  const south = (metres: number): [number, number] => [STOP.lon, STOP.lat - metres / ((Math.PI / 180) * 6_378_137)];
  const SESSION_DATA = { source: 'skupstina', category: 'sjednica-skupstine', precision: 'time', venue: 'Trg Stjepana Radića 1' };
  const SESSION_NEXT_WEEK = item('dogadanja', 'skupstina:13', 'event', '13. sjednica Gradske skupštine', { at: '2026-09-17T07:00:00Z', dateBasis: 'event', data: SESSION_DATA });
  const SESSION_TONIGHT = item('dogadanja', 'skupstina:14', 'event', '14. sjednica Gradske skupštine', { at: '2026-09-11T15:00:00Z', dateBasis: 'event', data: SESSION_DATA });
  const SESSION_ENDED = item('dogadanja', 'skupstina:12', 'event', '12. sjednica Gradske skupštine', { at: '2026-09-11T07:00:00Z', until: '2026-09-11T10:00:00Z', dateBasis: 'event', data: SESSION_DATA });
  const KVARTOVSKE = item('dogadanja', 'kvartovske:1', 'event', 'Novi park u Trnju', { at: '2026-09-11T00:00:00Z', dateBasis: 'unknown', data: { source: 'kvartovske' } });
  const ZET_NOTICE = item('dogadanja', 'zet-promet:1', 'event', 'Obilazak linija 6 i 11', { at: '2026-09-11T09:10:00Z', dateBasis: 'published', data: { source: 'zet-promet' } });
  const work = (id: string, title: string, coordinates: [number, number], district: string, phase = 'Radovi u tijeku'): Item =>
    item('dogadanja', `komunalne:${id}`, 'event', title, { at: '2026-07-02T00:00:00Z', dateBasis: 'updated', geo: { type: 'Point', coordinates }, data: { source: 'komunalne', phase, district } });
  const WORKS = [
    work('w1', 'Ilica 120', south(350), 'gornji-grad-medvescak'),
    work('w2', 'Avenija Dubrava 40', [16.07, 45.83], 'gornja-dubrava'),
    work('w3', 'Savska cesta 1', south(200), 'gornji-grad-medvescak', 'U pripremi'),
  ];
  const CITY_ROWS = [SESSION_NEXT_WEEK, KVARTOVSKE, ZET_NOTICE, ...WORKS];
  const READER_MODULES: ModuleSnapshot[] = MODULES.map((m) => {
    if (m.module === 'dogadanja') return snap('dogadanja', CITY_ROWS);
    if (m.module === 'prometnice') return snap('prometnice', [item('prometnice', 'rc1', 'closure', 'Ilica', { geo: { type: 'Point', coordinates: south(500) } })]);
    return m;
  });
  const TONIGHT_MODULES = READER_MODULES.map((m) => (m.module === 'dogadanja' ? snap('dogadanja', [SESSION_TONIGHT, SESSION_ENDED, ...CITY_ROWS]) : m));
  const withModule = (modules: readonly ModuleSnapshot[], id: ModuleId, patch: Partial<ModuleSnapshot>): ModuleSnapshot[] => modules.map((m) => (m.module === id ? { ...m, ...patch } : m));
  const without = (modules: readonly ModuleSnapshot[], id: ModuleId): ModuleSnapshot[] => modules.filter((m) => m.module !== id);

  it('eventsTonight keeps today’s dated open-licence rows whose end has not passed, in start order, and is empty before the source answers or while it is down', () => {
    expect(eventsTonight(TONIGHT_MODULES, NOW).map((r) => r.id)).toEqual(['skupstina:14']);
    expect(eventsTonight(READER_MODULES, NOW)).toEqual([]); // nothing dated today outside the tonight fixture
    expect(eventsTonight(without(TONIGHT_MODULES, 'dogadanja'), NOW)).toEqual([]);
    expect(eventsTonight(withModule(TONIGHT_MODULES, 'dogadanja', { status: 'down' }), NOW)).toEqual([]);
  });

  it('worksInKvart (D18) counts every ongoing work city-wide, nearest the stop first (D6 is removed: no district scoping)', () => {
    const works = worksInKvart(READER_MODULES, KVART_STOP, NOW);
    expect(works).toMatchObject({ state: 'live', count: 2 });
    expect(works.nearest).toMatchObject({ title: 'Ilica 120' });
    const city = worksInKvart(READER_MODULES, STOP, NOW);
    expect(city).toMatchObject({ count: 2 });
    expect(city.nearest).toMatchObject({ title: 'Ilica 120' });
  });

  it('closuresNearby counts only what lies within the nearby radius and gives no nearest beyond it', () => {
    const near = closuresNearby(READER_MODULES, KVART_STOP, NOW);
    expect(near).toMatchObject({ state: 'live', count: 1 });
    expect(near.nearest).toMatchObject({ title: 'Ilica' });
    const far = withModule(READER_MODULES, 'prometnice', { items: [item('prometnice', 'c2', 'closure', 'Dubrava', { geo: { type: 'Point', coordinates: [16.07, 45.83] } })] });
    expect(closuresNearby(far, KVART_STOP, NOW)).toEqual({ state: 'live', count: 0, nearest: null });
  });

  it('nextSession finds the Assembly’s next session that has not ended, or none', () => {
    expect(nextSession(READER_MODULES, NOW)!.id).toBe('skupstina:13');
    expect(nextSession(TONIGHT_MODULES, NOW)!.id).toBe('skupstina:14');
    expect(nextSession(withModule(READER_MODULES, 'dogadanja', { items: [KVARTOVSKE, ...WORKS] }), NOW)).toBeNull();
  });
});

describe('new local.ts readers say.ts uses: nearbyVehicleCount, kioskQuakes, lastDeparturesAhead', () => {
  it('nearbyVehicleCount counts the feed’s own pins within radiusM of the stop, never the fleet count (R-KP12)', () => {
    const zet = MODULES.find((m) => m.module === 'zet-rt')!; // two vehicle pins a few dozen metres from STOP, one fleet-count row that must never be read here
    expect(nearbyVehicleCount(zet, STOP)).toBe(2);
    expect(nearbyVehicleCount(zet, { ...STOP, lon: 16.5, lat: 46.5 })).toBe(0);
    expect(nearbyVehicleCount(zet, null)).toBe(2); // without a stop: every pin the box carries
    expect(nearbyVehicleCount(undefined, STOP)).toBe(0);
  });

  it('kioskQuakes keeps only magnitude >= 3.0 within the last 24 hours (R-KP9), newest first', () => {
    const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
    const emsc = snap('emsc', [
      item('emsc', 'small', 'quake', 'Q', { at: at(-1), data: { mag: 2.1, depth: 5, region: 'CROATIA' } }),
      item('emsc', 'old', 'quake', 'Q', { at: at(-30), data: { mag: 4, depth: 5, region: 'CROATIA' } }),
      item('emsc', 'big', 'quake', 'Q', { at: at(-2), data: { mag: 3.4, depth: 8, region: 'CROATIA' } }),
    ]);
    expect(kioskQuakes(emsc, NOW).map((q) => q.id)).toEqual(['big']);
    expect(kioskQuakes(undefined, NOW)).toEqual([]);
  });

  it('lastDeparturesAhead lists at most cap departures within 10 h, soonest first (R-KP14), only from 20:00 to 04:00 Zagreb', () => {
    const EVENING = Date.parse('2026-09-11T20:32:00Z'); // 22:32 in Zagreb
    const lastRun: LastRunSnapshot = {
      status: 'live', fetchedAt: '2026-09-11T12:00:00Z', sourceUpdatedAt: '2026-09-10T03:00:00Z', validUntil: '2026-09-13T22:30:00Z',
      routes: {
        '6': { '2026-09-11': '24:15' }, // 00:15: 1h43 ahead of 22:32
        '11': { '2026-09-11': '24:05' }, // 00:05: soonest, 1h33 ahead
        '12': { '2026-09-11': '22:00' }, // already left by 22:32
        '13': { '2026-09-11': '25:00' }, // 01:00: 2h28 ahead, still inside the 10 h window
      },
    };
    const stop = { ...STOP, routes: ['6', '11', '12', '13'] };
    const ahead = lastDeparturesAhead(lastRun, stop, EVENING, 4);
    expect(ahead.map((d) => d.routeId)).toEqual(['11', '6', '13']);
    expect(ahead[0]!.at).toBeLessThan(ahead[1]!.at);
    expect(ahead[1]!.at).toBeLessThan(ahead[2]!.at);
    expect(lastDeparturesAhead(lastRun, stop, EVENING, 1)).toHaveLength(1);
    expect(lastDeparturesAhead(lastRun, stop, NOW)).toEqual([]); // 14:32: outside the 20:00-04:00 window
    expect(lastDeparturesAhead(null, stop, EVENING)).toEqual([]);
    expect(lastDeparturesAhead(lastRun, null, EVENING)).toEqual([]);
  });
});

describe('the one map, through the additive adapter', () => {
  const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
  const withCap = (items: Item[], status: ModuleSnapshot['status'] = 'live') => MODULES.map((m) => (m.module === 'dhmz-cap' ? snap('dhmz-cap', items, status) : m));
  const warn = (id: string, extra: Partial<Item>) => item('dhmz-cap', id, 'warning', `W ${id}`, { severity: 'moderate', ...extra });
  it('a warning is judged by its own window: ended ones are gone, announced ones are said as announced, undated ones count', () => {
    expect(windowOf({ at: at(-2), until: at(2) }, NOW)).toBe('active');
    expect(windowOf({ at: at(1) }, NOW)).toBe('upcoming');
    expect(windowOf({ until: at(-1) }, NOW)).toBe('expired');
    expect(windowOf({}, NOW)).toBe('active');
    const ended = withCap([warn('old', { at: at(-30), until: at(-5) })]);
    expect(safetyStrip(ended, STOP, i18n, hr, NOW).warning).toEqual({ state: 'none', text: 'Nema upozorenja DHMZ-a za Zagreb', severity: null });
    expect(safetyStrip(withCap([warn('old', { at: at(-30), until: at(-5) })], 'stale'), STOP, i18n, hr, NOW).warning.state).toBe('stale'); // a stale copy of an ended warning is no all-clear
    const soon = safetyStrip(withCap([warn('soon', { at: at(3), until: at(9) })]), STOP, i18n, hr, NOW).warning;
    expect(soon.state).toBe('upcoming');
    expect(soon.text).toBe(`Najavljeno od 11. 9. 17:32: ${i18n.t('panels.severity.moderate')} · W soon`);
    const both = safetyStrip(withCap([warn('soon', { at: at(3) }), warn('now', { severity: 'severe', at: at(-1), until: at(1) })]), STOP, i18n, hr, NOW).warning;
    expect(both).toMatchObject({ state: 'active', text: `${i18n.t('panels.severity.severe')} · W now` });
    expect(essentialsRows(ended, i18n, hr, 'hr', STOP, NOW).some((r) => r.id === 'cap')).toBe(false);
  });
  it('closures count only those open right now; a quake stays inside 72 h and 150 km and a missing measure is named, never zero', () => {
    const closures = MODULES.map((m) => (m.module === 'prometnice' ? snap('prometnice', [
      item('prometnice', 'now', 'closure', 'Ilica', { at: at(-24), until: at(24), geo: { type: 'Point', coordinates: [15.9705, 45.813] } }),
      item('prometnice', 'ended', 'closure', 'Stara', { at: at(-48), until: at(-1) }),
      item('prometnice', 'later', 'closure', 'Buduća', { at: at(5), until: at(30) }),
      item('prometnice', 'open', 'closure', 'Bez kraja', {}),
    ]) : m));
    expect(closuresNear(closures, STOP, NOW)).toMatchObject({ count: 2, nearest: { title: 'Ilica' } });
    expect(safetyStrip(closures, STOP, i18n, hr, NOW).closures.text).toBe('2 zatvaranja');
    const q = (id: string, extra: Partial<Item>) => item('emsc', id, 'quake', `Q ${id}`, extra);
    const emsc = snap('emsc', [
      q('future', { at: at(1), data: { mag: 2, depth: 5, region: 'CROATIA' } }),
      q('old', { at: at(-80), data: { mag: 3, depth: 5, region: 'CROATIA' } }),
      q('far', { at: at(-1), geo: { type: 'Point', coordinates: [13, 44] }, data: { mag: 4, depth: 10, region: 'ADRIATIC' } }),
      q('near', { at: at(-2), geo: { type: 'Point', coordinates: [16.1, 45.9] }, data: { region: 'CROATIA' } }),
      q('skew', { at: new Date(NOW + 60_000).toISOString(), data: { mag: 1.5, depth: 8, region: 'CROATIA' } }),
    ]);
    expect(recentQuakes(emsc, NOW).map((x) => x.id)).toEqual(['skew', 'near']);
    expect(quakeLine(emsc.items[3]!, hr, 'hr')).toBe('magnituda nepoznata · CROATIA · dubina nepoznata');
    expect(quakeLine(emsc.items[4]!, hr, 'hr')).toBe('Magnituda 1,5 · CROATIA · dubina 8 km');
    const modules = MODULES.map((m) => (m.module === 'emsc' ? emsc : m));
    const main = pairedMarkup({ layer: 'sigurnost', strings: hr, i18n, locale: 'hr', snapshots: Object.fromEntries(modules.map((m) => [m.module, m])), now: NOW, stop: STOP, selection: null, lightweight: false, size: 'wide' }).main;
    expect(main).toContain('magnituda nepoznata');
    expect(main).not.toMatch(/Q future|Q old|Q far|M 0/);
    expect(stories(modules, hr, 'hr', NOW).find((s) => s.tone === 'quake')!.title).toBe('Magnituda 1,5 · CROATIA · dubina 8 km');
  });
  it('a failed fetch turns each last-good copy stale, source by source, leaves a never-seen module down, and the basics say so', () => {
    const zet = { ...MODULES.find((m) => m.module === 'zet-rt')!, sources: { rt: { status: 'live' as const, itemCount: 3 }, gtfs: { status: 'down' as const, itemCount: 0 } } };
    const copy = staleCopy(zet, '2026-09-11T12:33:00Z');
    expect(copy).toMatchObject({ status: 'stale', staleSince: '2026-09-11T12:33:00Z', sources: { rt: { status: 'stale', itemCount: 3 }, gtfs: { status: 'down', itemCount: 0 } } });
    expect(staleCopy(copy, '2026-09-11T12:40:00Z').staleSince).toBe('2026-09-11T12:33:00Z'); // the first failure's time stays
    expect(downPlaceholder('glasnik', '2026-09-11T12:33:00Z')).toMatchObject({ module: 'glasnik', status: 'down', items: [] });
    expect(KIOSK_TEASER_MODULES).toContain('dhmz-cap');
    const staleWeather = MODULES.map((m) => (m.module === 'dhmz-now' ? snap('dhmz-now', [item('dhmz-now', 'o1', 'observation', 'Zagreb-Maksimir', { data: { temp: 11.2, weather: '-' } })], 'stale') : m));
    expect(essentialsRows(staleWeather, i18n, hr, 'hr', STOP, NOW).find((r) => r.id === 'weather')).toMatchObject({ value: '11,2 °C · zastarjelo', detail: undefined });
  });
  it('hands the factory the stop as centre at the field zoom with the prozor options, no selection and no padding (R-KP11), keeps the handle, pushes a changed view only, and pushes the prozor set on every request so a stop change moves the drawn stops (R-KP19)', () => {
    const setView = vi.fn();
    const setProzor = vi.fn();
    const factory = vi.fn((_options: unknown) => ({ update: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(), setView, setProzor }));
    const adapter = createKioskMapAdapter(factory);
    const maps = createMapSlots(adapter.factory);
    const input = { stop: STOP, snapshots: { 'zet-rt': MODULES.find((m) => m.module === 'zet-rt')!, prometnice: MODULES.find((m) => m.module === 'prometnice')! }, now: NOW, selection: null, phase: 'invitation' as const, widthPx: 1400, heightPx: 888, spanM: FIELD_SPAN_M, ariaLabel: 'karta' };
    const container = requestKioskMap(maps, input, adapter)!;
    expect(container.dataset.testid).toBe('kiosk-map');
    expect(factory).toHaveBeenCalledTimes(1);
    const options = factory.mock.calls[0]![0] as Record<string, unknown>;
    const zoom = fieldZoom(1400, STOP.lat, FIELD_SPAN_M);
    expect(options.center).toEqual([STOP.lon, STOP.lat]);
    expect(options.zoom).toBe(zoom);
    // The enlarged screen-stop ring is the anchor: no second ring, no padding, the kiosk emphasis, the quarter drawn.
    expect(options.selectedStop).toBeUndefined();
    expect(options.padding).toBeUndefined();
    expect(options.emphasis).toEqual(KIOSK_EMPHASIS);
    expect(options.basemapProfile).toBe(KIOSK_BASEMAP_PROFILE);
    // The prozor set (contract 2): the tram figure, stops on the screen's routes only, hubs labelled from rank 4, the overlap thresholds a tenth under the field's own zoom (R-KP2), the street names' padding R-KP17's own on the wall's field.
    // The camera is at street level (a configured stop), so the buses are on the picture with the trams.
    expect(options.prozor).toEqual({ networkKinds: ['tram', 'bus'], stopRoutes: STOP.routes, stopLabelMinRank: 4, stopLabelTramInterchanges: false, placeTitles: true, stopRadius: true, overlapZoom: zoom - 0.1, labelPadding: 24, majorStreetNames: true });
    // The live handle hears the same set beside the outline, every request (R-KP19): the map is created once, the stop is not.
    expect(setProzor).toHaveBeenCalledTimes(1);
    expect(setProzor).toHaveBeenLastCalledWith(options.prozor);
    // Every pin is a dated report (one without its own time takes the
    // snapshot's), the stop is an undated place, closures are lines.
    const points = options.points as { id: string; at?: number }[];
    expect(points.find((p) => p.id === 'stop:106_1')?.at).toBeUndefined();
    expect(points.filter((p) => p.at !== undefined).map((p) => p.id)).toEqual(['vehicle:1', 'vehicle:2']);
    expect((options.lines as unknown[]).length).toBe(1);
    expect(adapter.handle()?.setView).toBe(setView);
    // The same view again is not pushed; the paired phase with a relayed route is, once, on the Promet contract (R-KP8).
    expect(requestKioskMap(maps, input, adapter)).toBe(container);
    expect(setView).not.toHaveBeenCalled();
    requestKioskMap(maps, { ...input, phase: 'paired', selection: { kind: 'route', id: '6' } }, adapter);
    expect(setView).toHaveBeenCalledTimes(1);
    expect(setView).toHaveBeenCalledWith({ zoom: PAIRED_ZOOM, emphasis: [], selectedRoute: '6' });
    // Back on the invitation a wider field asks for a closer camera, on the same map, and the overlap threshold follows it.
    requestKioskMap(maps, { ...input, widthPx: 1800 }, adapter);
    expect(setView).toHaveBeenLastCalledWith({ zoom: fieldZoom(1800, STOP.lat, FIELD_SPAN_M), emphasis: KIOSK_EMPHASIS, center: [STOP.lon, STOP.lat] });
    expect(setProzor).toHaveBeenCalledTimes(4);
    expect(setProzor).toHaveBeenLastCalledWith(expect.objectContaining({ overlapZoom: fieldZoom(1800, STOP.lat, FIELD_SPAN_M) - 0.1 }));
    // Stood up as a totem the field shows twice the wall's ground: the names' padding doubles on the same map (labelPadding), so the totem places no more of them than the wall (contract 3, R-KP17).
    requestKioskMap(maps, { ...input, widthPx: 1080, heightPx: 1365 }, adapter);
    expect(setProzor).toHaveBeenLastCalledWith(expect.objectContaining({ labelPadding: labelPadding(1080, 1365, FIELD_SPAN_M) }));
    // The DO's applyScreen moves the stop: the dots follow its routes on the same map.
    requestKioskMap(maps, { ...input, stop: { ...STOP, id: '200_1', routes: ['7', '109'] } }, adapter);
    expect(setProzor).toHaveBeenLastCalledWith(expect.objectContaining({ stopRoutes: ['7', '109'] }));
    expect(factory).toHaveBeenCalledTimes(1);
    expect(KIOSK_MAP_SLOT_ID).toBe('kiosk-map');
    expect(createKioskMapAdapter(undefined).factory).toBeUndefined();
    expect(requestKioskMap(createMapSlots(undefined), input)).toBeNull();
  });
  it('labelPadding (contract 3, R-KP17): the street names’ collision padding is the ruling’s 24 tile px on the wall’s map panel and grows in step with the ground a panel shows beyond it -- more on the totem and on a phone’s band, both taller for their width than the wall’s -- in whole pixels, never below 24, and 24 for a box not yet laid out', () => {
    expect(labelPadding(FIELD_DESIGN_WIDTH.wide, FIELD_DESIGN_HEIGHT.wide, FIELD_SPAN_M)).toBe(24);
    // The totem's panel: 1042 x 968 px at the same 1500 m span shows 1.33 of the wall's ground, so 32.
    expect(labelPadding(FIELD_DESIGN_WIDTH.portrait, FIELD_DESIGN_HEIGHT.portrait, FIELD_SPAN_M)).toBe(32);
    // The compact wall's field is a little taller than the wide one's for its width: a pixel more, not the same 24 by fiat.
    expect(labelPadding(FIELD_DESIGN_WIDTH.compact, FIELD_DESIGN_HEIGHT.compact, FIELD_SPAN_M)).toBe(26);
    // A wall wider than 16:9 (a 3840 x 2160 panel's 3138 x 1900 field) shows less ground north to south than the design wall: the ruling's literal, never less.
    expect(labelPadding(3138, 1900, FIELD_SPAN_M)).toBe(24);
    // The phone's band is taller than it is wide: at 1400 m across it shows half again the wall's ground north to south, so 35.
    expect(labelPadding(FIELD_DESIGN_WIDTH.handheld, FIELD_DESIGN_HEIGHT.handheld, HANDHELD_SPAN_M)).toBe(35);
    expect(labelPadding(1400, 0, FIELD_SPAN_M)).toBe(24);
    expect(labelPadding(0, 0, FIELD_SPAN_M)).toBe(24);
  });
  it('forwards the feed state on every paint, starts a map created in an outage held, marks the stop, and lights only the kiosk quake rule (R-KP9)', () => {
    const setFeedState = vi.fn();
    const update = vi.fn();
    const factory = vi.fn((_options: unknown) => ({ update, pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(), setFeedState }));
    const adapter = createKioskMapAdapter(factory);
    adapter.setFeedState('stale');
    expect(adapter.feedState()).toBe('stale');
    const maps = createMapSlots(adapter.factory);
    const zet = MODULES.find((m) => m.module === 'zet-rt')!;
    const base = { stop: STOP, now: NOW, selection: null, phase: 'invitation' as const, widthPx: 926, heightPx: 624, spanM: FIELD_SPAN_M, ariaLabel: 'karta' };
    requestKioskMap(maps, { ...base, snapshots: { 'zet-rt': { ...zet, status: 'stale' } } }, adapter);
    expect(setFeedState.mock.calls.map((c) => c[0])).toEqual(['stale', 'stale']); // held at creation, then told from the snapshot
    requestKioskMap(maps, { ...base, snapshots: {} }, adapter);
    expect(setFeedState).toHaveBeenLastCalledWith('loading'); // no snapshot is no evidence of motion, nor of an outage (lane p-map)
    requestKioskMap(maps, { ...base, snapshots: { 'zet-rt': zet } }, adapter);
    expect(setFeedState).toHaveBeenLastCalledWith('live');
    const options = factory.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.interactive).toBe(false);
    expect(options.symbolScale).toBe(KIOSK_SYMBOL_SCALE);
    expect(options.stop).toEqual(STOP);
    expect(options.center).toEqual([STOP.lon, STOP.lat]);
    expect(options.zoom).toBe(fieldZoom(926, STOP.lat, FIELD_SPAN_M));
    // One quake rule for the map and the statement: magnitude 3.0 or more, within the last 24 hours (recentQuakes keeps 72 h for the paired stories).
    const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
    const quake = (id: string, hours: number, mag: number | null) => item('emsc', id, 'quake', 'Q ' + id, { at: at(hours), geo: { type: 'Point', coordinates: [16.0, 45.9] }, data: mag === null ? { region: 'CROATIA' } : { mag, depth: 10, region: 'CROATIA' } });
    const emsc = snap('emsc', [quake('small', -1, 1.6), quake('old', -30, 3.4), quake('big', -2, 3.2), quake('nomag', -1, null), quake('edge', -23, 3)]);
    requestKioskMap(maps, { ...base, snapshots: { emsc } }, adapter);
    const drawn = update.mock.calls.at(-1)![0] as { id: string }[];
    expect(drawn.filter((p) => p.id.startsWith('quake:')).map((p) => p.id).sort()).toEqual(['quake:big', 'quake:edge']);
    // The rule lives once (R-KP9, R-KP23): what the map lights is exactly what local.ts's kioskQuakes selects, in its order.
    expect(kioskQuakePoints(emsc, NOW, 'hr').map((p) => p.id)).toEqual(kioskQuakes(emsc, NOW).map((quake) => `quake:${quake.id}`));
    expect(metresPerPixel(15, 45.81)).toBeCloseTo(1.665, 2);
  });
});

// A screen the one-button setup made has no stop and no district: it opens
// on the whole city, with the trams, the BAJS stations and the closures on
// it and no names over them.
describe('the kiosk\u2019s whole-city window', () => {
  const ISO = new Date(NOW - 60_000).toISOString();
  const CITY: CityState = {
    ...emptyCity(),
    places: [
      { id: 'culture-1', category: 'culture', name: 'Kino Europa', lon: 15.9738, lat: 45.8105, sourceId: 'culture', sourceRecord: '1' },
      { id: 'culture-2', category: 'culture', name: 'Mocvara', lon: 15.9611, lat: 45.8009, sourceId: 'culture', sourceRecord: '2' },
    ],
    live: {
      schema: 1 as never,
      generatedAt: ISO,
      sources: [{ id: 'bajs', name: 'BAJS', url: 'https://example.test/', licence: 'x', status: 'live', count: 2 }],
      bikes: [
        { id: 'b1', name: 'Trg bana Jelacica', lon: 15.9772, lat: 45.8128, bikes: 7, docks: 5, capacity: 12, installed: true, renting: true, returning: true, observedAt: ISO },
        { id: 'b2', name: 'Jarun', lon: 15.9312, lat: 45.7833, bikes: 0, docks: 12, capacity: 12, installed: true, renting: true, returning: true, observedAt: ISO },
      ],
      air: [],
      consultations: [],
    },
  };
  // 20:02 in Zagreb: a programme of this evening, so the venue is on the wall's curated map ('tonight') as on the week's.
  const EVENTS = [item('dogadanja', 'kvartovske:e1', 'event', 'Koncert', { at: new Date(NOW + 5.5 * 3_600_000).toISOString(), dateBasis: 'event', data: { source: 'kvartovske', venue: 'Kino Europa', precision: 'time' } })];
  /** The names the map was last asked to draw, as one of CityLabels' three answers (true/false are the older switch). */
  const lastLabels = (spy: { mock: { calls: unknown[][] } }) => cityLabelsOf(spy.mock.calls.at(-1)![0] as never);
  const stub = () => {
    const calls = { setModes: vi.fn(), setCityLabels: vi.fn(), setProzor: vi.fn(), setOutline: vi.fn(), update: vi.fn() };
    const factory = vi.fn((_options: unknown) => ({ ...calls, pause: vi.fn(), resume: vi.fn(), destroy: vi.fn() }));
    const adapter = createKioskMapAdapter(factory);
    return { calls, factory, adapter, maps: createMapSlots(adapter.factory) };
  };
  const base = { stop: null, city: CITY, snapshots: { dogadanja: snap('dogadanja', EVENTS), prometnice: MODULES.find((m) => m.module === 'prometnice')! }, now: NOW, selection: null, phase: 'invitation' as const, widthPx: 1300, heightPx: 880, spanM: FIELD_SPAN_M, ariaLabel: 'karta' };

  it('opens on the city window with the transit picture on it, a tap box for a wall, and no quarter nobody asked for', () => {
    const { calls, factory, adapter, maps } = stub();
    requestKioskMap(maps, base, adapter);
    const options = factory.mock.calls[0]![0] as Record<string, unknown>;
    expect(options.center).toEqual(cityWindowView(1300, 880).center);
    // Fitted whole (lane p-map), below the marks' own floor: they draw from the fit.
    expect(options.zoom).toBe(cityWindowView(1300, 880).zoom);
    expect(options.zoom).toBeLessThan(FIELD_MIN_ZOOM);
    expect((options.prozor as { markZoom?: number }).markZoom).toBeCloseTo((options.zoom as number) - 0.2, 10);
    expect(options.hitTolerancePx).toBe(KIOSK_HIT_TOLERANCE_PX);
    expect(options.outline).toBeNull();
    // The gate that used to empty the map whenever the default 'living' group was
    // active is gone: the network, the stops and the vehicles are the invitation.
    expect(options.prozor).toMatchObject({ networkKinds: ['tram'], stopRoutes: null, stopRadius: true });
    expect(calls.setModes).toHaveBeenLastCalledWith(new Set([0]));
    expect((options.lines as unknown[]).length).toBe(1);
  });

  // Round 2, F8 (owner, 24 Sep): no marker without a name on the whole-city window. An event's or a work's
  // square is titled only from THIN_NAMES_ZOOM (ruling 31), so below it the unframed window is handed none;
  // a framed place keeps its squares (decision 58 drops their titles there, the square is the claim).
  it('hands the whole-city window no event square, and a framed place its squares', () => {
    const located = [
      item('dogadanja', 'kvartovske:e2', 'event', 'Koncert na trgu', { at: new Date(NOW + 3_600_000).toISOString(), dateBasis: 'event', geo: { type: 'Point', coordinates: [15.9772, 45.8128] }, data: { source: 'kvartovske', venue: 'Trg', precision: 'time' } }),
      item('dogadanja', 'komunalne:w1', 'event', 'Radovi', { dateBasis: 'change', geo: { type: 'Point', coordinates: [15.975, 45.811] }, data: { source: 'komunalne', phase: 'Radovi u tijeku' } }),
    ];
    const snapshots = { ...base.snapshots, dogadanja: snap('dogadanja', [...EVENTS, ...located]) };
    const city = stub();
    requestKioskMap(city.maps, { ...base, snapshots }, city.adapter);
    const cityPoints = (city.factory.mock.calls[0]![0] as { points: { place?: string; id: string }[]; prozor: { placeTitles?: boolean } });
    expect(cityPoints.prozor.placeTitles).toBe(false);
    expect(cityPoints.points.filter((p) => p.place === 'event')).toEqual([]);
    expect(cityPoints.points.some((p) => p.place === 'city' && p.props?.category === 'bikes')).toBe(true);
    // The same events on a framed place: both squares stand, untitled (decision 58).
    const framed = stub();
    requestKioskMap(framed.maps, { ...base, snapshots, stop: { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.9772, lat: 45.8128, routes: ['6', '11'] }, place: { kind: 'tram', name: 'Trg bana J. Jelačića', lon: 15.9772, lat: 45.8128, stopId: '106_1' }, placeSet: true, frame: 6 as const }, framed.adapter);
    const framedPoints = (framed.factory.mock.calls[0]![0] as { points: { place?: string; id: string }[]; prozor: { placeTitles?: boolean; frame?: unknown } });
    expect(framedPoints.prozor.frame).toBeDefined();
    expect(framedPoints.prozor.placeTitles).toBe(false);
    expect(framedPoints.points.filter((p) => p.place === 'event').map((p) => p.id).sort()).toEqual(['event:komunalne:w1', 'event:kvartovske:e2']);
  });

  // Ruling 30, superseding Ruling 28's rank tier: below the line the window
  // asks for tram interchanges, and the rank it carries is the ordinary one
  // every nearer frame uses.
  it('asks for interchanges while the field holds the whole city, and for the ranked hubs once it holds a quarter', () => {
    const { factory, calls, adapter, maps } = stub();
    requestKioskMap(maps, base, adapter);
    const far = (factory.mock.calls[0]![0] as { prozor: { stopLabelTramInterchanges: boolean; placeTitles: boolean; stopLabelMinRank: number } }).prozor;
    expect(FIELD_MIN_ZOOM).toBeLessThan(THIN_NAMES_ZOOM);
    expect(far.stopLabelTramInterchanges).toBe(true);
    expect(far.placeTitles).toBe(false);
    expect(far.stopLabelMinRank).toBe(STOP_LABEL_MIN_RANK);
    expect(calls.setProzor).toHaveBeenLastCalledWith(expect.objectContaining({ stopLabelTramInterchanges: true }));
    // A quarter's own frame (z14.3 on a wall) is past the line, and so is a stop's.
    const near = stub();
    requestKioskMap(near.maps, { ...base, district: 'trnje' }, near.adapter);
    const opts = near.factory.mock.calls[0]![0] as { zoom: number; prozor: { stopLabelTramInterchanges: boolean; placeTitles: boolean; stopLabelMinRank: number } };
    expect(opts.zoom).toBeGreaterThanOrEqual(THIN_NAMES_ZOOM);
    expect(opts.prozor.stopLabelTramInterchanges).toBe(false);
    expect(opts.prozor.placeTitles).toBe(true);
    expect(opts.prozor.stopLabelMinRank).toBe(STOP_LABEL_MIN_RANK);
  });

  // Ruling 29: the same line drops the basemap's promoted major street names
  // outright on the whole-city window, and leaves them exactly as derived from
  // a quarter's frame up.
  it('drops the promoted street names while the field holds the whole city, and keeps them from a quarter up', () => {
    const { factory, calls, adapter, maps } = stub();
    requestKioskMap(maps, base, adapter);
    expect((factory.mock.calls[0]![0] as { prozor: { majorStreetNames: boolean } }).prozor.majorStreetNames).toBe(false);
    expect(calls.setProzor).toHaveBeenLastCalledWith(expect.objectContaining({ majorStreetNames: false }));
    const near = stub();
    requestKioskMap(near.maps, { ...base, district: 'trnje' }, near.adapter);
    expect((near.factory.mock.calls[0]![0] as { prozor: { majorStreetNames: boolean } }).prozor.majorStreetNames).toBe(true);
  });

  it('reads both readings straight off the field zoom, on either side of the line', () => {
    expect(stopLabelTramInterchanges(THIN_NAMES_ZOOM - 0.01)).toBe(true);
    expect(stopLabelTramInterchanges(THIN_NAMES_ZOOM)).toBe(false);
    expect(stopLabelTramInterchanges(THIN_NAMES_ZOOM + 0.01)).toBe(false);
    // Ruling 31 rides the same line: the square marks lose their names below it.
    expect(placeTitles(THIN_NAMES_ZOOM - 0.01)).toBe(false);
    expect(placeTitles(THIN_NAMES_ZOOM)).toBe(true);
    expect(placeTitles(THIN_NAMES_ZOOM + 0.01)).toBe(true);
    // One line, two rulings: the stop names thin and the street names go together.
    expect(majorStreetNames(THIN_NAMES_ZOOM - 0.01)).toBe(false);
    expect(majorStreetNames(THIN_NAMES_ZOOM)).toBe(true);
    expect(majorStreetNames(THIN_NAMES_ZOOM + 0.01)).toBe(true);
    // The rank is the same one at every zoom now: the far window does not rank at all.
    expect(STOP_LABEL_MIN_RANK).toBe(4);
  });

  it('keeps every tram in the city on the window, not only the lines of the screen\u2019s own stop, and still narrows to a relayed route', () => {
    const zet = MODULES.find((m) => m.module === 'zet-rt')!;
    const withStop = { ...base, stop: { ...STOP, routes: ['11'] }, snapshots: { ...base.snapshots, 'zet-rt': zet } };
    const one = stub();
    requestKioskMap(one.maps, withStop, one.adapter);
    // The teaser's two vehicles are on route 6 and the screen's stop is not: the
    // invitation used to drop them, which left the window showing a line or two.
    expect(((one.factory.mock.calls[0]![0] as Record<string, unknown>).points as { id: string }[]).filter((p) => p.id.startsWith('vehicle:')).map((p) => p.id)).toEqual(['vehicle:1', 'vehicle:2']);
    // A relayed route is still the one line the picture is about.
    const two = stub();
    requestKioskMap(two.maps, { ...withStop, phase: 'paired' as const, selection: { kind: 'route' as const, id: '11' } }, two.adapter);
    expect(((two.factory.mock.calls[0]![0] as Record<string, unknown>).points as { id: string }[]).some((p) => p.id.startsWith('vehicle:'))).toBe(false);
  });

  it('carries every BAJS station with a bike and every venue with a programme as a badge with no name, and no station name while nobody is exploring', () => {
    const { calls, factory, adapter, maps } = stub();
    requestKioskMap(maps, base, adapter);
    const options = factory.mock.calls[0]![0] as Record<string, unknown>;
    const city = (options.points as { id: string; title: string; place?: string; props?: Record<string, unknown> }[]).filter((p) => p.place === 'city');
    // Owner, 24 Sep: the empty Jarun station (b2) is a far dot with no number to say so, and is left to the frame.
    expect(city.map((p) => p.id).sort()).toEqual(['bajs-b1', 'culture-1']);
    expect(city.find((p) => p.id === 'bajs-b1')!.props).toMatchObject({ category: 'bikes', badge: '7', eventCount: 0, priority: 2, far: true });
    expect(city.find((p) => p.id === 'culture-1')!.props).toEqual({ category: 'culture', badge: '1', eventCount: 1, priority: 0 });
    // The names are the layer's to leave off (CityLabels 'none'), not the points'.
    expect(cityLabelsOf(options.cityLabels as never)).toBe('none');
    expect(lastLabels(calls.setCityLabels)).toBe('none');
    // The one on-duty pharmacy keeps its ring and loses its address: a street number is not a fact anyone reads a city window for.
    expect((options.points as { place?: string; title: string; props?: Record<string, unknown> }[]).find((p) => p.place === 'pharmacy')).toMatchObject({ title: '' });
    // The same call, exploring: discover() answers the question with the few places it is about, named.
    requestKioskMap(maps, { ...base, exploring: true }, adapter);
    const drawn = calls.update.mock.calls.at(-1)![0] as { id: string; title: string; place?: string }[];
    expect(drawn.filter((p) => p.place === 'city').some((p) => p.title !== '')).toBe(true);
    expect(lastLabels(calls.setCityLabels)).toBe('all');
  });

  it('puts the buses on the picture only once the camera is in a neighbourhood, and follows the camera without a new map', () => {
    expect(CITY_DETAIL_ZOOM).toBe(14);
    expect([busesVisible(13.99), busesVisible(14), busesVisible(15.5)]).toEqual([false, true, true]);
    const { calls, adapter, maps, factory } = stub();
    requestKioskMap(maps, base, adapter);
    expect(calls.setProzor).toHaveBeenLastCalledWith(expect.objectContaining({ networkKinds: ['tram'] }));
    expect(calls.setModes).toHaveBeenLastCalledWith(new Set([0]));
    // A tap took the camera in: the same map hears both, no second one is made.
    requestKioskMap(maps, { ...base, cameraZoom: 14.2 }, adapter);
    expect(calls.setProzor).toHaveBeenLastCalledWith(expect.objectContaining({ networkKinds: ['tram', 'bus'] }));
    expect(calls.setModes).toHaveBeenLastCalledWith(null);
    requestKioskMap(maps, { ...base, cameraZoom: 13.4 }, adapter);
    expect(calls.setModes).toHaveBeenLastCalledWith(new Set([0]));
    expect(factory).toHaveBeenCalledTimes(1);
  });

  // The window's rules are the INVITATION's. A paired presentation is a phone
  // putting one subject on the wall, and the wall has to name it.
  it('a paired presentation keeps the city’s names on and the points it always had: the presented place is named', () => {
    const { calls, factory, adapter, maps } = stub();
    const paired = { ...base, phase: 'paired' as const, selection: { kind: 'place' as const, id: 'culture-1' } };
    requestKioskMap(maps, paired, adapter);
    const options = factory.mock.calls[0]![0] as Record<string, unknown>;
    expect(cityLabelsOf(options.cityLabels as never)).toBe('all');
    expect(lastLabels(calls.setCityLabels)).toBe('all');
    // discover()'s own points, named -- not the window's nameless badges.
    const city = (options.points as { id: string; title: string; place?: string }[]).filter((p) => p.place === 'city');
    expect(city.find((p) => p.id === 'culture-1')!.title).toBe('Kino Europa');
    expect(city.find((p) => p.id === 'bajs-b1')!.title).toBe('Trg bana Jelacica');
    // The camera is on the place and the picture is about it alone, as before this round.
    expect(options.center).toEqual([15.9738, 45.8105]);
    expect(calls.setModes).toHaveBeenLastCalledWith(new Set());
    expect((options.prozor as { networkKinds: string[] }).networkKinds).toEqual([]);
    // The invitation beside it is still the nameless window.
    const invitation = stub();
    requestKioskMap(invitation.maps, base, invitation.adapter);
    const first = invitation.factory.mock.calls[0]![0] as Record<string, unknown>;
    expect(cityLabelsOf(first.cityLabels as never)).toBe('none');
    expect((first.points as { id: string; title: string }[]).some((p) => p.id === 'culture-1')).toBe(true);
  });

  it('curatedCityPoints reads the live BAJS rows and tonight\u2019s venues, and nothing a source did not place', () => {
    expect(curatedCityPoints(CITY, EVENTS, NOW, CURATED_WALL).map((p) => p.id)).toEqual(['bajs-b1', 'bajs-b2', 'culture-1']);
    expect(curatedCityPoints(CITY, EVENTS, NOW).find((p) => p.id === 'culture-1')!.title).toBe('Kino Europa');
    // A station whose own source is not live cannot claim a count: a grey disc without a number, never "?".
    const stale: CityState = { ...CITY, live: { ...CITY.live!, sources: [{ ...CITY.live!.sources[0]!, status: 'stale' }] } };
    expect(curatedCityPoints(stale, EVENTS, NOW).find((p) => p.id === 'bajs-b1')!.props).toMatchObject({ badge: '', spent: true });
    // No events, no venue marks: a venue is on the map because something is on there tonight.
    expect(curatedCityPoints(CITY, [], NOW).map((p) => p.id)).toEqual(['bajs-b1', 'bajs-b2']);
    // A 15:32 matinee is this week's, not this evening's.
    const matinee = [{ ...EVENTS[0]!, at: new Date(NOW + 3_600_000).toISOString() }];
    expect(curatedCityPoints(CITY, matinee, NOW).map((p) => p.id)).toEqual(['bajs-b1', 'bajs-b2']);
  });
});

describe('the on-duty pharmacy on the map (R-KP18)', () => {
  it('keeps its hollow ring but drops its label when it sits on the screen\u2019s own stop, and names the pharmacy from 150 m out', () => {
    // The hand-entered point for "Trg bana J. Jelačića 3" (local.ts PHARMACY_POINTS); a stop is put due south of it by a latitude offset.
    const ring = { lon: 15.9776, lat: 45.8131 };
    const stopAt = (metresSouth: number) => ({ ...STOP, lon: ring.lon, lat: ring.lat - metresSouth / 111_320 });
    // The label is the short form the strip prints; the address (worker/hitno/ljekarne.ts) is the exact one, and it is a detail, not a name.
    const address = 'Trg bana Josipa Jelačića 3, Zagreb';
    const [onTheStop] = pharmacyPoint(stopAt(80));
    expect(onTheStop).toEqual({ id: 'pharmacy:Trg bana J. Jelačića 3', lon: ring.lon, lat: ring.lat, title: '', place: 'pharmacy', props: { address } });
    const [downTheStreet] = pharmacyPoint(stopAt(400));
    // What the mark says is what the place is called; the address stays in the detail the props carry.
    expect(downTheStreet).toMatchObject({ id: 'pharmacy:Trg bana J. Jelačića 3', title: 'Gradska ljekarna Zagreb', props: { address } });
    expect(downTheStreet!.title).not.toContain('3');
    // A unit whose own handle IS a name keeps it: the operator is the name either way.
    expect(pharmaciesByDistance(null).find((p) => p.label === 'Ljekarna ZEUS')!.name).toBe('Ljekarna ZEUS');
    // The strip names the pharmacy by its address either way: the map and the strip can never name two different ones.
    expect(safetyStrip(MODULES, stopAt(80), i18n, hr, NOW).pharmacy.label).toBe('Trg bana J. Jelačića 3');
  });
});

// WP2 step 4: a wall with a chosen place (today its configured stop) frames N
// stops around it (Kadar 4 / 6 / 8, the radius measured per place by
// shared/city/frame.ts and handed in once), and the frame is a neighbourhood.
describe('the kiosk\u2019s framed wall', () => {
  const stub = () => {
    const calls = { setModes: vi.fn(), setCityLabels: vi.fn((_on: unknown) => undefined), setProzor: vi.fn(), setOutline: vi.fn(), update: vi.fn((_points: unknown, _lines: unknown) => undefined), setView: vi.fn() };
    const factory = vi.fn((_options: unknown) => ({ ...calls, pause: vi.fn(), resume: vi.fn(), destroy: vi.fn() }));
    const adapter = createKioskMapAdapter(factory);
    return { calls, factory, adapter, maps: createMapSlots(adapter.factory) };
  };
  const CITY: CityState = { ...emptyCity() };
  const zet = MODULES.find((m) => m.module === 'zet-rt')!;
  // kiosk.ts passes placeSet from the screen's record (a v1 screen's stop is one somebody chose).
  const base = { stop: STOP, placeSet: true, city: CITY, snapshots: { 'zet-rt': zet, prometnice: MODULES.find((m) => m.module === 'prometnice')! }, now: NOW, selection: null, phase: 'invitation' as const, widthPx: 1300, heightPx: 880, spanM: FIELD_SPAN_M, ariaLabel: 'karta' };
  const first = (s: ReturnType<typeof stub>) => s.factory.mock.calls[0]![0] as Record<string, unknown>;
  /** CityMapOptions.cityLabels as one of Section B's three answers (true / false are the older switch for 'all' / 'none'). */
  const labelsOf = (on: unknown) => (on === undefined || on === true ? 'all' : on === false ? 'none' : on);

  it('frames Kadar 6 on the place with buses, the frame\u2019s stops, its tram hubs named, the venues alone named and no square\u2019s title or street name', () => {
    const s = stub();
    requestKioskMap(s.maps, { ...base, frame: 6 }, s.adapter);
    const options = first(s);
    const zoom = frameView(STOP, 2000, 1300, 880).zoom;
    expect(options.center).toEqual([STOP.lon, STOP.lat]);
    expect(options.zoom).toBe(zoom);
    // Decision 58: the frame's stops alone, its tram hubs named, no square's title and no street name.
    expect(options.prozor).toEqual({ networkKinds: ['tram', 'bus'], stopRoutes: null, stopLabelMinRank: STOP_LABEL_MIN_RANK, stopLabelTramInterchanges: true, placeTitles: false, stopRadius: false, overlapZoom: zoom - 0.1, labelPadding: labelPadding(1300, 880, 4000), majorStreetNames: false, frame: { lon: STOP.lon, lat: STOP.lat, radiusM: 2000 } });
    expect(s.calls.setModes).toHaveBeenLastCalledWith(null);
    // The pharmacy point carries its name on a neighbourhood's picture, below the detail zoom too (a stop 400 m
    // south of Trg bana J. Jelačića 3 frames at z13.4); decision 58's placeTitles false keeps the layer from drawing it.
    const south = { ...STOP, lon: 15.9776, lat: 45.8131 - 400 / 111_320 };
    const near = stub();
    requestKioskMap(near.maps, { ...base, stop: south }, near.adapter);
    expect(first(near).zoom).toBeLessThan(CITY_DETAIL_ZOOM);
    expect((first(near).points as { place?: string; title: string }[]).find((p) => p.place === 'pharmacy')!.title).toBe('Gradska ljekarna Zagreb');
    // The same stop as the read-path default place keeps the whole-city window, where an address is a detail.
    const far = stub();
    requestKioskMap(far.maps, { ...base, stop: south, placeSet: false }, far.adapter);
    expect((first(far).points as { place?: string; title: string }[]).find((p) => p.place === 'pharmacy')!.title).toBe('');
    // Section B's CityLabels: the venues named, the BAJS discs counted and unnamed.
    expect(labelsOf(options.cityLabels)).toBe('venues');
    expect(labelsOf(s.calls.setCityLabels.mock.calls.at(-1)![0])).toBe('venues');
    expect(kioskCityLabels(true, true)).toBe('venues');
    // The DO's applyScreen moves the place: the frame follows it on the same map, and still draws every stop in it (R-KP19).
    const moved = { ...STOP, id: '200_1', lon: 15.99, lat: 45.8, routes: ['7', '109'] };
    requestKioskMap(s.maps, { ...base, frame: 6, stop: moved }, s.adapter);
    expect(s.calls.setView).toHaveBeenLastCalledWith(expect.objectContaining({ center: [15.99, 45.8], zoom: frameView(moved, 2000, 1300, 880).zoom }));
    expect(s.calls.setProzor).toHaveBeenLastCalledWith(expect.objectContaining({ stopRoutes: null }));
    expect(s.factory).toHaveBeenCalledTimes(1);
    // A caller from before place-v2 (no placeSet) keeps the stop's centred street-level camera and its routes' dots.
    const legacy = stub();
    requestKioskMap(legacy.maps, { ...base, placeSet: undefined }, legacy.adapter);
    expect(first(legacy).zoom).toBe(fieldZoom(1300, STOP.lat, FIELD_SPAN_M));
    expect(first(legacy).prozor).toMatchObject({ stopRoutes: STOP.routes, stopRadius: true });
  });

  // Decision 58: nothing outside the frame is a disc or a square on a placed wall; the pharmacy's ring stays wherever it is.
  it('draws the BAJS discs, the venues and the event squares inside the frame alone', () => {
    const iso = new Date(NOW - 60_000).toISOString();
    const bike = (id: string, lat: number) => ({ id, name: id, lon: STOP.lon, lat, bikes: 3, docks: 5, capacity: 8, installed: true, renting: true, returning: true, observedAt: iso });
    const city: CityState = { ...emptyCity(), live: { schema: 1 as never, generatedAt: iso, sources: [{ id: 'bajs', name: 'BAJS', url: 'https://example.test/', licence: 'x', status: 'live', count: 2 }],
      bikes: [bike('near', STOP.lat + 1500 / 111_320), bike('far', STOP.lat + 2500 / 111_320)], air: [], consultations: [] } };
    const s = stub();
    requestKioskMap(s.maps, { ...base, frame: 6, city }, s.adapter);
    const points = first(s).points as { id: string; place?: string }[];
    expect(points.filter((p) => p.place === 'city').map((p) => p.id)).toEqual(['bajs-near']);
    expect(points.some((p) => p.place === 'pharmacy')).toBe(true);
    // The whole-city window keeps its own rule (far dots across the city).
    const w = stub();
    requestKioskMap(w.maps, { ...base, frame: 6, city, placeSet: false }, w.adapter);
    expect((first(w).points as { id: string; place?: string }[]).filter((p) => p.place === 'city').map((p) => p.id)).toEqual(['bajs-near', 'bajs-far']);
  });

  // Lane p-map (owner, 24 Sep: fullscreen off, and part of Zagreb was off the
  // map): a 1280 x 800 browser window lays the wall's field out at 669 x 167
  // (the compact wall, decision 50: the card under the map; 669 x 405 before
  // it), 1920 x 1080 at 1170 x 803. The wall
  // refits to each box it is given, and what it presents stays whole in it:
  // the frame's square of side 2R, and the whole-city window. Its marks keep
  // drawing on a fit below their usual floor (ProzorOptions.markZoom).
  it('refits the frame and the whole-city window whole to each box a resize gives it, and back', () => {
    const R = 2191;
    const fits = (zoom: number, lat: number, spanM: number, px: number) => spanM / metresPerPixel(zoom, lat) <= px - 2 * 24 + 0.5;
    for (const place of ['frame', 'city'] as const) {
      const s = stub();
      const input = place === 'frame' ? { ...base, frame: 6 as const, radiusM: R } : { ...base, stop: null, placeSet: undefined };
      const views: Record<string, unknown>[] = [];
      for (const [w, h] of [[669, 167], [1170, 803], [669, 167]] as const) {
        requestKioskMap(s.maps, { ...input, widthPx: w, heightPx: h }, s.adapter);
        const view = views.length === 0 ? first(s) : s.calls.setView.mock.calls.at(-1)![0] as Record<string, unknown>;
        views.push(view);
        const zoom = view.zoom as number;
        if (place === 'frame') {
          expect(view.center, `${place} ${w}x${h}`).toEqual([STOP.lon, STOP.lat]);
          expect(fits(zoom, STOP.lat, 2 * R, Math.min(w, h)), `${place} ${w}x${h}: 2R inside at z${zoom.toFixed(2)}`).toBe(true);
        } else {
          // The whole window inside the box: within its clearance where the map's own floor allows, else at
          // that floor inside the box itself (669 x 167 needs z9.85).
          const mid = (CITY_WINDOW_BOX.south + CITY_WINDOW_BOX.north) / 2;
          const tall = ((CITY_WINDOW_BOX.north - CITY_WINDOW_BOX.south) / 360) * 40_075_016.686;
          const wide = ((CITY_WINDOW_BOX.east - CITY_WINDOW_BOX.west) / 360) * 40_075_016.686 * Math.cos((mid * Math.PI) / 180);
          const whole = zoom > WALL_FIT_MIN_ZOOM ? fits(zoom, mid, tall, h) && fits(zoom, mid, wide, w) : tall / metresPerPixel(zoom, mid) <= h && wide / metresPerPixel(zoom, mid) <= w;
          expect(whole, `${place} ${w}x${h}: the whole window inside at z${zoom.toFixed(2)}`).toBe(true);
        }
        // The plates and the stop rings still draw at the fitted zoom.
        const prozor = s.calls.setProzor.mock.calls.at(-1)![0] as { markZoom?: number };
        expect(prozor.markZoom ?? 12.5, `${place} ${w}x${h}: marks from z${prozor.markZoom}`).toBeLessThanOrEqual(zoom);
      }
      // Back at the first box, the first view again: nothing left over from the larger one.
      expect(views[2]).toEqual(expect.objectContaining({ center: views[0]!.center, zoom: views[0]!.zoom }));
      expect(views[1]!.zoom).toBeGreaterThan(views[0]!.zoom as number);
    }
  });

  it('frames Kadar 4 and 8 closer and wider, and a measured radius wins over the Kadar\u2019s fallback', () => {
    const at = (extra: Record<string, unknown>) => {
      const s = stub();
      requestKioskMap(s.maps, { ...base, ...extra }, s.adapter);
      return first(s);
    };
    expect(at({ frame: 4 }).zoom).toBe(frameView(STOP, 1300, 1300, 880).zoom);
    expect(at({ frame: 8 }).zoom).toBe(frameView(STOP, 2700, 1300, 880).zoom);
    const measured = at({ frame: 6, radiusM: 2182 });
    expect(measured.zoom).toBe(frameView(STOP, 2182, 1300, 880).zoom);
    expect((measured.prozor as { labelPadding: number }).labelPadding).toBe(labelPadding(1300, 880, 2 * 2182));
  });

  it('keeps its buses on the frame at every camera, not only from the detail zoom', () => {
    const s = stub();
    requestKioskMap(s.maps, { ...base, frame: 8, widthPx: 794, heightPx: 610 }, s.adapter);
    // The compact wall's Kadar 8 is fitted whole below the marks' own floor (lane p-map), its marks drawn from the fit.
    expect(first(s).zoom).toBe(frameView(STOP, 2700, 794, 610, 24, WALL_FIT_MIN_ZOOM).zoom);
    expect(first(s).zoom).toBeLessThan(FIELD_MIN_ZOOM);
    expect(s.calls.setModes).toHaveBeenLastCalledWith(null);
    requestKioskMap(s.maps, { ...base, frame: 8, widthPx: 794, heightPx: 610, cameraZoom: 12.9 }, s.adapter);
    expect(s.calls.setModes).toHaveBeenLastCalledWith(null);
    expect(s.calls.setProzor).toHaveBeenLastCalledWith(expect.objectContaining({ networkKinds: ['tram', 'bus'], stopLabelTramInterchanges: true }));
  });

  it('frames a chosen address place on the address, and keeps the whole-city window for the read-path default place', () => {
    const address = { kind: 'address' as const, name: 'Ilica 1', lon: 15.9738, lat: 45.8131 };
    const s = stub();
    requestKioskMap(s.maps, { ...base, place: address }, s.adapter);
    expect(first(s).center).toEqual([address.lon, address.lat]);
    // An empty field reads back as Trg with placeSet false: the list has its place, the map keeps the whole city with every stop on it.
    const d = stub();
    requestKioskMap(d.maps, { ...base, place: { kind: 'tram', name: STOP.name, lon: STOP.lon, lat: STOP.lat, stopId: STOP.id }, placeSet: false }, d.adapter);
    const window = first(d);
    expect(window.center).toEqual(cityWindowView(1300, 880).center);
    expect(window.zoom).toBe(cityWindowView(1300, 880).zoom);
    expect(window.prozor).toMatchObject({ networkKinds: ['tram'], stopRoutes: null, stopRadius: true, stopLabelTramInterchanges: true });
    expect(labelsOf(window.cityLabels)).toBe('none'); // as the whole-city window has always carried it
    expect(kioskCityLabels(false, true)).toBe('none');
    expect(d.calls.setModes).toHaveBeenLastCalledWith(new Set([0]));
  });

  // Owner, 24 Sep ("too many names, tiny empty white circles"): the whole-city
  // window carries the place's own ring and name (decision 19) and the pills,
  // and no other stop mark -- no bead and no interchange name (Ruling 30's
  // interchange names are withdrawn here). The frame keeps its own rule.
  it('draws on the whole-city window only the own place\u2019s ring and name and the pills, never another stop\u2019s bead or name', () => {
    const trg = { kind: 'tram' as const, name: STOP.name, lon: STOP.lon, lat: STOP.lat, stopId: STOP.id };
    const d = stub();
    requestKioskMap(d.maps, { ...base, stop: null, place: trg, placeSet: false, stops: [STOP] }, d.adapter);
    const window = first(d);
    expect(window.center).toEqual(cityWindowView(1300, 880).center);
    expect(window.prozor).toMatchObject({ stopMarks: false, stopRoutes: null });
    // The own ring and name: the place's stop from the table, else the place itself.
    expect(window.stop).toEqual(STOP);
    const bare = stub();
    requestKioskMap(bare.maps, { ...base, stop: null, place: trg, placeSet: false }, bare.adapter);
    expect(first(bare).stop).toEqual({ id: STOP.id, name: STOP.name, lon: STOP.lon, lat: STOP.lat, routes: [] });
    // A screen with neither place nor stop has no own ring to draw, and still no other stop mark.
    const none = stub();
    requestKioskMap(none.maps, { ...base, stop: null }, none.adapter);
    expect(first(none).stop).toBeNull();
    expect(first(none).prozor).toMatchObject({ stopMarks: false });
    // The frame and a phone's band keep their stops and names.
    const framed = stub();
    requestKioskMap(framed.maps, { ...base, frame: 6 }, framed.adapter);
    expect(first(framed).prozor).not.toHaveProperty('stopMarks');
    const phone = stub();
    requestKioskMap(phone.maps, { ...base, stop: null, place: trg, placeSet: false, handheld: true, spanM: HANDHELD_SPAN_M, widthPx: 356, heightPx: 420 }, phone.adapter);
    expect(first(phone).prozor).not.toHaveProperty('stopMarks');
  });

  it('is the wall\u2019s own: a phone\u2019s band, a person exploring and a paired presentation are not framed', () => {
    const phone = stub();
    requestKioskMap(phone.maps, { ...base, handheld: true, spanM: HANDHELD_SPAN_M, widthPx: 356, heightPx: 420 }, phone.adapter);
    expect(first(phone).zoom).toBe(fieldZoom(356, STOP.lat, HANDHELD_SPAN_M));
    expect(first(phone).prozor).toMatchObject({ stopRoutes: STOP.routes, stopRadius: true });
    expect(labelsOf(first(phone).cityLabels)).toBe('none');
    const exploring = stub();
    requestKioskMap(exploring.maps, { ...base, exploring: true }, exploring.adapter);
    expect(labelsOf(first(exploring).cityLabels)).toBe('all');
    expect(kioskCityLabels(false, false)).toBe('all');
    expect(first(exploring).prozor).toMatchObject({ stopRoutes: STOP.routes });
  });

  it('empties the vehicle points when the vehicles are hidden, and nothing else: the stops and the network stay', () => {
    const s = stub();
    requestKioskMap(s.maps, { ...base, vehiclesVisible: false }, s.adapter);
    const points = first(s).points as { id: string; at?: number }[];
    expect(points.filter((p) => p.id.startsWith('vehicle:'))).toEqual([]);
    expect(points.some((p) => p.id === 'stop:106_1')).toBe(true);
    expect(s.calls.setModes).toHaveBeenLastCalledWith(null);
    expect(s.calls.setModes).not.toHaveBeenCalledWith(new Set());
    expect((first(s).prozor as { networkKinds: string[] }).networkKinds).toEqual(['tram', 'bus']);
    requestKioskMap(s.maps, { ...base, vehiclesVisible: true }, s.adapter);
    expect((s.calls.update.mock.calls.at(-1)![0] as { id: string }[]).filter((p) => p.id.startsWith('vehicle:')).map((p) => p.id)).toEqual(['vehicle:1', 'vehicle:2']);
  });

  it('honours the wall\u2019s Prikaz: the schema on the invitation, the boot renderer otherwise', () => {
    const schema = stub();
    requestKioskMap(schema.maps, { ...base, view: 'schema' }, schema.adapter);
    expect(first(schema).renderer).toBe('schema');
    const map = stub();
    requestKioskMap(map.maps, { ...base, view: 'map' }, map.adapter);
    expect(first(map).renderer).toBe('map');
    // ?prikaz=shema at boot still holds with the setting on karta.
    const boot = stub();
    requestKioskMap(boot.maps, { ...base, renderer: 'schema', view: 'map' }, boot.adapter);
    expect(first(boot).renderer).toBe('schema');
    // A paired presentation keeps the boot renderer.
    const paired = stub();
    requestKioskMap(paired.maps, { ...base, view: 'schema', phase: 'paired' }, paired.adapter);
    expect(first(paired).renderer).toBe('map');
  });
});

describe('credits and rows on a screen read from steps away', () => {
  const all = () => Object.fromEntries(MODULES.map((m) => [m.module, m]));
  const ctx = (layer: 'kultura' | 'uprava-i-pravo', extra: Partial<Parameters<typeof pairedMarkup>[0]> = {}) => pairedMarkup({ layer, strings: hr, i18n, locale: 'hr', snapshots: all(), now: NOW, stop: STOP, selection: null, lightweight: false, size: 'wide' as const, ...extra });
  it('a credit names the publisher and the licence and points at /izvori; an act\u2019s UUID and the six-source paragraph never print; ZET\u2019s mandated sentence stays verbatim', () => {
    const glasnik = snap('glasnik', [item('glasnik', 'a1', 'act', 'Zaključak o prihvaćanju pokroviteljstva', { at: '2026-09-07T00:00:00Z', data: { broj: '29', godina: '2026', id: 'e5f003b0-c950-44de-be5f-ac76aa2ee8c6' } })]);
    glasnik.attribution = { text: 'Izvor: Službeni glasnik Grada Zagreba, {broj}/{godina}, akt {id}', url: '', licence: 'Otvorena dozvola (NN 67/17)' };
    const grad = ctx('uprava-i-pravo', { snapshots: { ...all(), glasnik } });
    expect(grad.main).toContain('Izvor: Službeni glasnik Grada Zagreba · Licenca: Otvorena dozvola (NN 67/17) · potpuna atribucija: /izvori');
    expect(grad.main).not.toContain('e5f003b0');
    expect(grad.main.match(/k-main-source/g)).toHaveLength(1);
    expect(grad.main).toContain('Izvori: Skupština Grada Zagreba (Otvorena dozvola) · Grad Zagreb, plan komunalnih aktivnosti (Otvorena dozvola) · potpuna atribucija: /izvori');
    expect(grad.side).not.toContain('k-source');
    const kultura = ctx('kultura');
    // ZET's notices are on the screen (the k-notices block), so the layer's one credit names ZET as a publisher too.
    expect(kultura.main).toContain('Izvori: Kulturpunkt (CC BY-SA 3.0 HR) · Grad Zagreb, kvartovske novosti (Otvorena dozvola) · ZET (Otvorena dozvola) · potpuna atribucija: /izvori');
    expect(kultura.main).not.toContain('Šest izvora');
    expect(kultura.side).not.toContain('k-source'); // the notices block is covered by the layer's one credit
    expect(creditText(MODULES.find((m) => m.module === 'zet-rt')!, [], hr)).toBe('Izvor: test · Licenca: Otvorena dozvola (NN 67/17) · potpuna atribucija: /izvori');
    expect(creditText(MODULES.find((m) => m.module === 'prometnice')!, [], hr)).toBe('Izvor: Grad Zagreb (data.zagreb.hr) · Licenca: Otvorena dozvola (NN 67/17) · potpuna atribucija: /izvori');
    expect(creditText(downPlaceholder('emsc', '2026-09-11T12:33:00Z'), [], kioskStrings('en'))).toBe('Source: EMSC, seismicportal.eu · full attribution: /izvori');
  });
  it('a row keeps its whole title with the aside inside it; the selected item grows to main size; an observation without a reading says so in a word', () => {
    expect(row('Naslov', 'detalj', '20:00', ' data-x="1"')).toBe('<span class="k-row-main" data-x="1"><span class="k-row-aside">20:00</span>Naslov</span><span class="k-row-sub">detalj</span>');
    expect(row('Naslov')).toBe('<span class="k-row-main">Naslov</span>');
    const selected = ctx('kultura', { selection: { kind: 'item', id: publicItemKey('dogadanja', 'kp:1'), module: 'dogadanja' } }).main;
    expect(selected).toContain('k-block--grow');
    expect(selected).toContain('class="k-select-main k-select-main--item"');
    expect(selected).toContain('potpuna atribucija: /izvori');
    const noTemp = MODULES.map((m) => (m.module === 'dhmz-now' ? snap('dhmz-now', [item('dhmz-now', 'o1', 'observation', 'Zagreb-Maksimir', { at: '2026-09-11T12:00:00Z', data: { humidity: 60 } })]) : m));
    const markup = weatherMarkup(weatherNow(noTemp, hr, 'hr'), hr);
    expect(markup).toContain('bez očitanja temperature');
    expect(markup).not.toMatch(/kiosk-temp">[–-]</);
  });
});

// T5.2: the shapes the compositions render, without a controller.
describe('T5.2 markup shapes: the two-line lockup, the departure board, badges and the pill', () => {
  const all = () => Object.fromEntries(MODULES.map((m) => [m.module, m]));
  const paired = (layer: 'u-pokretu' | 'zrak-i-nebo' | 'grad-sada', extra: Partial<Parameters<typeof pairedMarkup>[0]> = {}) => pairedMarkup({ layer, strings: hr, i18n, locale: 'hr', snapshots: all(), now: NOW, stop: STOP, selection: null, lightweight: false, size: 'wide' as const, ...extra });
  it('the weather lockup is two lines under a 48 px condition icon, the station in the credit, no kicker and no sun line', () => {
    const markup = weatherMarkup(weatherNow(MODULES, hr, 'hr'), hr);
    expect(markup).toContain('class="icon k-weather-icon"');
    expect(markup).toContain('href="#icon-sun"');
    expect(markup).not.toContain('k-kicker');
    expect(markup).not.toContain('k-weather-sun');
    expect(markup).toContain('<p class="k-weather-details">vlaga 55 % · vjetar sjeverozapad 2,3 m/s · 1016 hPa</p>');
    // The credit names the station and DHMZ, never the observation time (§12, review of lane/c-B1 P1).
    expect(markup).toContain('<p class="k-meta">Zagreb-Maksimir · DHMZ</p>');
    expect(markup).not.toMatch(/opaženo|\d\d:\d\d/);
    // The compact column holds two details on its one facts line; the pressure yields.
    expect(weatherMarkup(weatherNow(MODULES, hr, 'hr'), hr, 2)).toContain('<p class="k-weather-details">vlaga 55 % · vjetar sjeverozapad 2,3 m/s</p>');
    // A sky the words do not name gets no picture, and the word still prints.
    const fog = MODULES.map((m) => (m.module === 'dhmz-now' ? snap('dhmz-now', [item('dhmz-now', 'o1', 'observation', 'Zagreb-Grič', { at: '2026-09-11T12:00:00Z', data: { temp: 9, weather: 'lahor' } })]) : m));
    const quiet = weatherMarkup(weatherNow(fog, hr, 'hr'), hr);
    expect(quiet).not.toContain('k-weather-icon');
    expect(quiet).toContain('<span class="k-condition">lahor</span>');
    const loading = weatherMarkup(weatherNow([], hr, 'hr'), hr);
    expect(loading).toBe('<p class="k-weather-note" data-state="loading">Učitavanje podataka DHMZ-a</p>');
  });
  it('transport gives the board its own region, and a selected route becomes its subject', () => {
    const { lines, side } = paired('u-pokretu');
    expect(side).toBe('');
    expect(lines).toContain('class="k-line-list"');
    expect(lines).toContain('data-size="k"');
    expect(lines).toContain('kasni 2 min');
    expect(lines).toContain('još');
    const compact = paired('u-pokretu', { size: 'compact' });
    expect(compact.lines).toContain('class="k-line-list"');
    const selected = paired('u-pokretu', { selection: { kind: 'route', id: '6' } });
    expect(selected.lines).toContain('data-testid="k-selection"');
    expect(selected.lines).toContain('<span class="k-line-badge line" data-kind="tram" data-size="k">6</span>');
    expect(selected.lines).not.toContain('class="k-line-list"');
    expect(selected.side).toBe('');
  });
  it('a warning row carries its level as a badge word with its shape; the Sada column carries no weather block (the header is the weather)', () => {
    const cap = snap('dhmz-cap', [item('dhmz-cap', 'w1', 'warning', 'Grmljavina', { severity: 'severe', summary: 'Jaki udari vjetra.' })]);
    const { main } = paired('zrak-i-nebo', { snapshots: { ...all(), 'dhmz-cap': cap } });
    expect(main).toContain('<span class="badge k-badge" data-tone="severe">narančasto upozorenje</span> Grmljavina');
    expect(main).not.toContain('<strong>narančasto upozorenje</strong>');
    const sada = paired('grad-sada');
    expect(sada.side).not.toContain('k-weather');
    expect(sada.side).toContain('data-testid="k-closures"');
  });
  it('the strip pill exists in both catalogues; the hostname sentence carries a {host} slot', () => {
    expect(hr.safety.hitno).toBe('Sigurnost');
    expect(kioskStrings('en').safety.hitno).toBe('Safety');
    expect(hr.invitation.typeCode).toBe('ili upiši kod na {host}');
    expect(kioskStrings('en').invitation.typeCode).toBe('or type the code at {host}');
    expect(JSON.stringify(hr)).not.toContain('zagreb.aningfilm.hr');
  });
});
