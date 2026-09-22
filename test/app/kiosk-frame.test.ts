// The kiosk frame's pure builders (kiosk/frame.ts): the safety strip's
// verdict, trail and pharmacy. Nothing counts down and nothing is a tile any
// more (R-KP11, R-KP23); weather is the front page's own card (T3), never a
// header group, so nothing here reads DHMZ. The footer of 22 September (WP1)
// names its sources without a time and the pharmacy as the green cross, 24/7
// and the short address.
import { describe, expect, it } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { frameStrip, PHARMACY_HOURS, stripMarkup } from '../../app/src/kiosk/frame';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { kioskStrings } from '../../app/src/kiosk/strings';

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb, well before sunset
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

describe('frameStrip', () => {
  it('reads calm from safetyState when every source answers with nothing current', () => {
    const strip = frameStrip(CALM_MODULES, STOP, i18n, s, NOW);
    expect(strip.level).toBe('calm');
    expect(strip.verdict).toBe('mirno');
  });
  it('reads urgent from a severe warning', () => {
    const modules = CALM_MODULES.map((m) => (m.module === 'dhmz-cap' ? { ...m, items: [item('dhmz-cap', 'w1', 'warning', 'Grmljavina', { severity: 'severe' })] } : m));
    const strip = frameStrip(modules, STOP, i18n, s, NOW);
    expect(strip.level).toBe('urgent');
    expect(strip.verdict).toBe('upozorenje'); // a warning, not an emergency: /hitno keeps its name, the strip says what the level is
  });
  it('reads unknown when a safety source is down', () => {
    const modules = CALM_MODULES.map((m) => (m.module === 'emsc' ? { ...m, status: 'down' as const } : m));
    const strip = frameStrip(modules, STOP, i18n, s, NOW);
    expect(strip.level).toBe('unknown');
    expect(strip.verdict).toBe('nepotvrđeno');
    // Nothing rotates (R-KP11): the strip carries no countdown field at all.
    expect('nextIn' in strip).toBe(false);
  });
});

describe('stripMarkup', () => {
  const strip = frameStrip(CALM_MODULES, STOP, i18n, s, NOW);
  it('one row (kajimafix 03.5): the shield kicker, the verdict with its glyph as the button that opens Osnovno, the sources without a time, the pharmacy, the /hitno pill; no countdown, no closures cell, no Osnovno chip', () => {
    const markup = stripMarkup(strip, s, { noBasics: false });
    expect(markup).toContain('data-testid="kiosk-essentials-open" data-level="calm"');
    expect(markup).toContain('aria-label="Sigurnost: mirno. Otvori Osnovno"');
    expect(markup).toContain('<span data-testid="strip-verdict">');
    expect(markup).toContain('#icon-check-circle');
    expect(markup).toContain('>mirno<');
    // Every source answered, and still no confirmation time (principle 5): the trail is the sources' names.
    expect(markup).toContain('<span class="k-strip-item" data-testid="strip-sources">DHMZ · EMSC</span>');
    expect(markup).not.toMatch(/\d{1,2}:\d{2}/);
    expect('confirmedAt' in strip).toBe(false);
    expect(markup).not.toContain('data-testid="strip-warning"');
    expect(markup).not.toContain('data-testid="strip-closures"');
    expect(markup).not.toContain('k-strip-basics');
    expect(markup).not.toContain('Osnovno<');
    expect(markup).toContain('data-testid="strip-pharmacy"');
    expect(markup).toContain('href="/hitno"');
    expect(markup).not.toContain('strip-next');
    expect(markup).not.toContain('prizor');
    expect(markup).not.toContain('k-strip-sub');
    expect(markup).not.toContain('k-strip-item--sun');
    // The public, unpaired /kiosk/ screen renders this on every load: no
    // engineering note (deprecation markers included) ships as an HTML
    // comment into production output, visible via view-source.
    expect(markup).not.toContain('<!--');
  });
  it('shows the on-duty pharmacy as the green cross, 24/7 and its short address, the cross naming it for a screen reader', () => {
    const cell = /<span class="k-strip-item k-strip-pharmacy" data-testid="strip-pharmacy">(.*?)<\/span>\s*<\/div>/s.exec(stripMarkup(strip, s, { noBasics: false }))?.[1] ?? '';
    // The probe contract (§15.6): [data-testid=strip-pharmacy] [data-symbol=pharmacy] is the cross itself.
    expect(cell).toMatch(/^<svg data-symbol="pharmacy" class="icon k-icon k-cross" role="img" aria-label="Dežurna ljekarna"><use href="#icon-cross"><\/use><\/svg>/);
    expect(cell).toContain('<span class="k-247">24/7</span>');
    // The screen stands at Trg bana Jelačića, so the nearest on-duty unit is the one on the square.
    expect(cell).toContain('<strong>Trg bana J. Jelačića 3</strong>');
    expect(PHARMACY_HOURS).toBe('24/7');
    // The word is the cross's accessible name, never printed beside it.
    expect(cell.replace(/<svg[^>]*>.*?<\/svg>/s, '')).not.toContain('ljekarna');
    const en = kioskStrings('en');
    const english = stripMarkup(frameStrip(CALM_MODULES, STOP, createDefaultI18n('en'), en, NOW), en, { noBasics: true });
    expect(english).toContain('aria-label="On-duty pharmacy"');
    expect(english).toContain('<span class="k-247">24/7</span>');
    expect(english).toContain('<span class="k-strip-item" data-testid="strip-sources">DHMZ · EMSC</span>');
  });
  it('names an active warning as the trail in DHMZ\'s words, with its glyph and the level word, instead of the sources', () => {
    const modules = CALM_MODULES.map((m) => (m.module === 'dhmz-cap' ? { ...m, items: [item('dhmz-cap', 'w1', 'warning', 'Grmljavina', { severity: 'severe' })] } : m));
    const markup = stripMarkup(frameStrip(modules, STOP, i18n, s, NOW), s, { noBasics: false });
    expect(markup).toContain('data-testid="strip-warning" data-state="active" data-severity="severe"');
    expect(markup).toContain('Grmljavina');
    expect(markup).not.toContain('data-testid="strip-sources"');
    expect(markup).toContain('#icon-triangle-alert');
    expect(markup).toContain('>upozorenje<');
  });
  it('renders the verdict as a plain word, no button, when a session or the wizard owns the screen', () => {
    const markup = stripMarkup(strip, s, { noBasics: true });
    expect(markup).not.toContain('kiosk-essentials-open');
    expect(markup).toContain('<span class="k-strip-verdict" data-testid="strip-verdict" data-level="calm">');
  });
});
