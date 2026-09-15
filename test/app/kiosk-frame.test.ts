// The kiosk frame's pure builders (kiosk/frame.ts): the header's weather
// group, the safety strip's verdict and countdown, and the right column's
// two value tiles.
import { describe, expect, it } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { countdownText, frameStrip, headerWeather, stripMarkup, tileMarkup, valueTiles, weatherGroupMarkup } from '../../app/src/kiosk/frame';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { sunToday } from '../../app/src/kiosk/local';
import { kioskStrings } from '../../app/src/kiosk/strings';

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb, well before sunset
const EVENING = Date.parse('2026-09-11T20:32:00Z'); // 22:32 in Zagreb, well after sunset
const STOP = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6'] };
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
// A closure 500 m due south of the stop (a pure latitude offset), so
// closuresNear's distance is deterministic without depending on the map
// projection's exact constants.
const CLOSURE_LAT = STOP.lat - 500 / ((Math.PI / 180) * 6_378_137);

const CALM_MODULES: ModuleSnapshot[] = [
  snap('dhmz-now', [item('dhmz-now', 'o1', 'observation', 'Zagreb-Maksimir', { at: '2026-09-11T12:00:00Z', data: { temp: 21, humidity: 55, windDir: 'NW', windSpeed: 2.3, weather: 'vedro' } })]),
  snap('dhmz-cap', []),
  snap('prometnice', [item('prometnice', 'c1', 'closure', 'Ilica', { geo: { type: 'Point', coordinates: [STOP.lon, CLOSURE_LAT] }, data: { subtype: 'ROAD_CLOSED' } })]),
  snap('zet-rt', [item('zet-rt', 'vozila', 'vehicle', '156 vozila u pokretu', { data: { vehicles: 156 } })]),
  snap('emsc', []),
];

describe('headerWeather', () => {
  it('is null while dhmz-now has no snapshot yet: the clock stands alone', () => {
    expect(headerWeather([], s, 'hr', NOW)).toBeNull();
  });
  it('is null while the source is down', () => {
    const modules = CALM_MODULES.map((m) => (m.module === 'dhmz-now' ? { ...m, status: 'down' as const, items: [] } : m));
    expect(headerWeather(modules, s, 'hr', NOW)).toBeNull();
  });
  it('reports live with the icon, the temperature and today\'s sunset before it passes', () => {
    const weather = headerWeather(CALM_MODULES, s, 'hr', NOW)!;
    expect(weather.state).toBe('live');
    expect(weather.icon).toBe('sun');
    expect(weather.temperature).toBe('21 °C');
    expect(weather.sun.kind).toBe('sunset');
    expect(weather.sun.time).toBe(sunToday(NOW).sunset);
  });
  it('reports stale from the snapshot\'s own status, the observation unchanged', () => {
    const modules = CALM_MODULES.map((m) => (m.module === 'dhmz-now' ? { ...m, status: 'stale' as const } : m));
    expect(headerWeather(modules, s, 'hr', NOW)!.state).toBe('stale');
  });
  it('shows the glyph and the sun alone when the observation carries no numeric reading, never a dash', () => {
    const modules = CALM_MODULES.map((m) => (m.module === 'dhmz-now' ? { ...m, items: [item('dhmz-now', 'o1', 'observation', 'Zagreb-Maksimir', { data: { weather: 'vedro' } })] } : m));
    const weather = headerWeather(modules, s, 'hr', NOW)!;
    expect(weather.temperature).toBeNull();
    expect(weather.icon).toBe('sun');
  });
  it('switches to tomorrow\'s sunrise once the sunset has passed', () => {
    const weather = headerWeather(CALM_MODULES, s, 'hr', EVENING)!;
    expect(weather.sun.kind).toBe('sunrise');
    expect(weather.sun.time).toBe(sunToday(EVENING + 24 * 3_600_000).sunrise);
  });
});

describe('weatherGroupMarkup', () => {
  it('is empty for null: the caller keeps the group hidden', () => {
    expect(weatherGroupMarkup(null, s)).toBe('');
  });
  it('draws the icon, the temperature and the sun line for a live reading', () => {
    const markup = weatherGroupMarkup(headerWeather(CALM_MODULES, s, 'hr', NOW), s);
    expect(markup).toContain('#icon-sun');
    expect(markup).toContain('data-testid="kiosk-temp"');
    expect(markup).toContain('21 °C');
    expect(markup).toContain('k-sun');
    expect(markup).not.toContain('k-chip--stale');
  });
  it('marks a stale reading with the stale chip', () => {
    const modules = CALM_MODULES.map((m) => (m.module === 'dhmz-now' ? { ...m, status: 'stale' as const } : m));
    const markup = weatherGroupMarkup(headerWeather(modules, s, 'hr', NOW), s);
    expect(markup).toContain('k-chip--stale');
    expect(markup).toContain('zastarjelo');
  });
  it('never prints a dash or the k-temp element when there is no reading', () => {
    const modules = CALM_MODULES.map((m) => (m.module === 'dhmz-now' ? { ...m, items: [item('dhmz-now', 'o1', 'observation', 'Zagreb-Maksimir', { data: { weather: 'vedro' } })] } : m));
    const markup = weatherGroupMarkup(headerWeather(modules, s, 'hr', NOW), s);
    expect(markup).not.toContain('kiosk-temp');
    expect(markup).not.toContain('—');
    expect(markup).not.toMatch(/ - /);
  });
});

describe('frameStrip', () => {
  const notRotating = { rotating: false, lastRotateAt: NOW, period: 20_000 };
  it('reads calm from safetyState when every source answers with nothing current', () => {
    const strip = frameStrip(CALM_MODULES, STOP, i18n, s, NOW, notRotating);
    expect(strip.level).toBe('calm');
    expect(strip.verdict).toBe('mirno');
  });
  it('reads urgent from a severe warning', () => {
    const modules = CALM_MODULES.map((m) => (m.module === 'dhmz-cap' ? { ...m, items: [item('dhmz-cap', 'w1', 'warning', 'Grmljavina', { severity: 'severe' })] } : m));
    const strip = frameStrip(modules, STOP, i18n, s, NOW, notRotating);
    expect(strip.level).toBe('urgent');
    expect(strip.verdict).toBe('hitno');
  });
  it('reads unknown when a safety source is down', () => {
    const modules = CALM_MODULES.map((m) => (m.module === 'emsc' ? { ...m, status: 'down' as const } : m));
    const strip = frameStrip(modules, STOP, i18n, s, NOW, notRotating);
    expect(strip.level).toBe('unknown');
    expect(strip.verdict).toBe('nepotvrđeno');
  });
  it('counts down the whole seconds left in the rotation', () => {
    const strip = frameStrip(CALM_MODULES, STOP, i18n, s, NOW + 5_000, { rotating: true, lastRotateAt: NOW, period: 20_000 });
    expect(strip.nextIn).toBe(15);
  });
  it('is null when the field is not rotating', () => {
    const strip = frameStrip(CALM_MODULES, STOP, i18n, s, NOW, notRotating);
    expect(strip.nextIn).toBeNull();
  });
});

describe('countdownText', () => {
  it('is empty when there is nothing to count down to', () => {
    expect(countdownText(null, s)).toBe('');
  });
  it('names the whole seconds', () => {
    expect(countdownText(15, s)).toBe('sljedeći prizor za 15 s');
    expect(countdownText(15, s)).toMatch(/sljedeći prizor za \d+ s/);
  });
});

describe('stripMarkup', () => {
  const strip = frameStrip(CALM_MODULES, STOP, i18n, s, NOW, { rotating: true, lastRotateAt: NOW, period: 20_000 });
  it('carries the three item testids, the verdict and the countdown, and drops the old sun sub-line', () => {
    const markup = stripMarkup(strip, s, { noBasics: false });
    expect(markup).toContain('data-testid="strip-warning"');
    expect(markup).toContain('data-testid="strip-closures"');
    expect(markup).toContain('data-testid="strip-pharmacy"');
    expect(markup).toContain('data-testid="strip-verdict"');
    expect(markup).toContain("data-level=\"calm\"");
    expect(markup).toContain('data-testid="strip-next"');
    expect(markup).toContain('sljedeći prizor za 20 s');
    expect(markup).not.toContain('k-strip-sub');
    expect(markup).not.toContain('k-strip-item--sun');
  });
  it('hides the basics button when a session or the wizard owns the screen', () => {
    expect(stripMarkup(strip, s, { noBasics: true })).toContain('data-testid="kiosk-essentials-open" hidden');
  });
  it('hides the countdown when the field is not rotating', () => {
    const still = frameStrip(CALM_MODULES, STOP, i18n, s, NOW, { rotating: false, lastRotateAt: NOW, period: 20_000 });
    const markup = stripMarkup(still, s, { noBasics: false });
    expect(markup).toContain('data-testid="strip-next" hidden');
  });
});

describe('valueTiles', () => {
  it('reads the fleet count with its glyph and the ZET credit line', () => {
    const [vehicles] = valueTiles(CALM_MODULES, STOP, i18n, s, 'hr', NOW);
    expect(vehicles.state).toBe('live');
    expect(vehicles.value).toBe('156');
    expect(vehicles.glyph).toBe('tram-front');
    expect(vehicles.context).toContain('ZET');
    expect(vehicles.context).toContain('podaci od');
  });
  it('counts closures within the nearby radius, with the nearest street and its distance', () => {
    const [, closures] = valueTiles(CALM_MODULES, STOP, i18n, s, 'hr', NOW);
    expect(closures.value).toBe('1');
    expect(closures.context).toBe('najbliže Ilica · 500 m');
  });
  it('says the radius, not a street, when nothing is nearby', () => {
    const modules = CALM_MODULES.map((m) => (m.module === 'prometnice' ? { ...m, items: [] } : m));
    const [, closures] = valueTiles(modules, STOP, i18n, s, 'hr', NOW);
    expect(closures.value).toBe('0');
    expect(closures.context).toBe('u krugu 1,5 km');
  });
  it('is down with no value when the fleet source has not answered', () => {
    const modules = CALM_MODULES.map((m) => (m.module === 'zet-rt' ? { ...m, status: 'down' as const, items: [] } : m));
    const [vehicles] = valueTiles(modules, STOP, i18n, s, 'hr', NOW);
    expect(vehicles.state).toBe('down');
    expect(vehicles.value).toBeNull();
  });
  it('is stale from the last-good copy', () => {
    const modules = CALM_MODULES.map((m) => (m.module === 'zet-rt' ? { ...m, status: 'stale' as const } : m));
    const [vehicles] = valueTiles(modules, STOP, i18n, s, 'hr', NOW);
    expect(vehicles.state).toBe('stale');
    expect(vehicles.value).toBe('156');
  });
  it('is loading before the first snapshot', () => {
    const [vehicles] = valueTiles([], STOP, i18n, s, 'hr', NOW);
    expect(vehicles.state).toBe('loading');
    expect(vehicles.value).toBeNull();
  });
});

describe('tileMarkup', () => {
  it('draws three skeleton bars while loading', () => {
    const markup = tileMarkup({ id: 'vehicles', testid: 'tile-vehicles', state: 'loading', label: 'Vozila u pokretu', value: null, context: '' }, s);
    expect(markup.match(/class="sk /g)).toHaveLength(3);
  });
  it('stays in place with the honest word when the source is down', () => {
    const markup = tileMarkup({ id: 'vehicles', testid: 'tile-vehicles', state: 'down', label: 'Vozila u pokretu', value: null, context: '' }, s);
    expect(markup).toContain('data-state="down"');
    expect(markup).toContain(s.paired.sourceDown);
  });
  it('marks a stale value with the badge in place of the context', () => {
    const markup = tileMarkup({ id: 'closures', testid: 'tile-closures', state: 'stale', label: 'Zatvaranja u blizini', value: '1', context: 'najbliže Ilica · 500 m' }, s);
    expect(markup).toContain('data-tone="stale"');
    expect(markup).not.toContain('najbliže Ilica');
  });
  it('draws the glyph, the value and the context for a live tile', () => {
    const markup = tileMarkup({ id: 'vehicles', testid: 'tile-vehicles', state: 'live', label: 'Vozila u pokretu', value: '156', glyph: 'tram-front', context: 'ZET · podaci od 14:31' }, s);
    expect(markup).toContain('#icon-tram-front');
    expect(markup).toContain('156');
    expect(markup).toContain('ZET · podaci od 14:31');
  });
});
