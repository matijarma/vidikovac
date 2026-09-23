// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import { createDefaultI18n, DEFAULT_LOCALE, LOCALE_STORAGE_KEY, resolveInitialLocale, SUPPORTED_LOCALES } from '../../app/src/i18n/create-default-i18n';
import { createLanguageToggle } from '../../app/src/i18n/toggle';

function leafKeys(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leafKeys(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}
const PLURAL = ['_zero', '_one', '_two', '_few', '_many', '_other'];
const base = (k: string): string => { const s = PLURAL.find((p) => k.endsWith(p)); return s ? k.slice(0, -s.length) : k; };

// Keys every wave found dead and parked for the consolidation (T6.3), plus the
// old flat kiosk keys the typed adapter replaced, plus the old kiosk's chapter,
// tile and countdown copy Prozor retired (R-KP23). None may come back.
const DEAD_KEYS = [
  'kiosk.scenes.tonight', 'kiosk.scenes.position', 'kiosk.scenes.moreEvents_one', 'kiosk.tiles.vehicles', 'kiosk.tiles.closures', 'kiosk.safety.nextScene',
  'kiosk.legendPanorama', 'kiosk.legendPanoramaLoading', 'kiosk.legendQr', 'kiosk.legendMeander', 'kiosk.safetyLabel',
  'kiosk.catalogueWeather', 'kiosk.catalogueVehicles', 'kiosk.catalogueClosures', 'kiosk.typeCode', 'kiosk.invitationEn',
  'kiosk.teaserSoon', 'kiosk.teaserCity', 'kiosk.essentialsTitle', 'kiosk.unitVehicles_one', 'kiosk.unitClosed_one',
  'session.legendMeander', 'session.panoramaAlt', 'session.panoramaAltLoading', 'session.remainingFine',
  'session.labelPhone', 'session.remaining', 'session.noRoom', 'session.tabsLabel', 'session.openTier',
  'scan.steps.find', 'scan.steps.scan', 'scan.steps.use', 'scan.safetyNote', 'scan.scanDialogTitle',
  'shell.frozenCta', 'shell.sessionTitle', 'shell.staleNotice',
  'panels.culture', 'panels.cultureStage1', 'panels.cultureEuropeana', 'panels.cultureNsk', 'panels.capNone', 'panels.quakes', 'panels.quakeNone',
  'common.links.kiosk', 'common.links.open', 'events.venueUnknown', 'safety.showAll',
  'civic.coverage', 'civic.coverageLimited', 'civic.worksEmpty', 'civic.worksCount_one', 'civic.worksCount_few', 'civic.worksCount_other',
  'overview.weatherKicker', 'overview.closuresNone', 'overview.closuresNow_one', 'overview.quakeRecent', 'overview.warningsUnknown',
  'transit.tram', 'transit.bus', 'transit.closuresTitle', 'directory.title', 'export.ics', 'export.geojson', 'time.labelEvent',
  'common.tagline', 'common.showAll', 'common.openLayer', 'common.seconds_one', 'attribution.updated', 'attribution.adapted',
  // T3: the kiosk sets itself up with one button (no address to open on the
  // wall) and a screen without a stop simply has no such note to print.
  'kiosk.setup.handheld', 'kiosk.lines.noStop', 'kiosk.say.forecast',
  // WP5: the stop sheet now says what comes next, so the sentence that said
  // ZET publishes no arrivals is retired. It may not come back beside rows
  // that carry arrival times.
  'transport.noArrivals',
];
function has(catalog: unknown, key: string): boolean {
  return typeof key.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined), catalog) === 'string';
}

describe('catalogs', () => {
  it('hr and en have identical key sets (plural forms compared on base names)', () => {
    expect([...new Set(leafKeys(hr).map(base))].sort()).toEqual([...new Set(leafKeys(en).map(base))].sort());
  });
  it('is the one catalogue: the transport workspace, the kiosk and the shared sentences live here', () => {
    expect(hr.transport.trams).toBe('Tramvaji');
    expect(en.transport.trams).toBe('Trams');
    expect(hr.transport.vehiclesNow_few).toBe('{count} vozila u pokretu');
    expect(hr.kiosk.invite.lead).toBe('Skeniraj za 10 minuta grada.');
    expect(hr.kiosk.sentence.kicker.promet).toBe('Promet');
    expect(hr.kiosk.lines.nearby_few).toBe('{count} vozila u blizini');
    expect(hr.shared.closuresNone).toBe('Nema zatvorenih prometnica.');
    expect(en.shared.closuresNone).toBe('No road closures.');
  });
  it('carries none of the keys the waves found dead', () => {
    for (const key of DEAD_KEYS) {
      expect(has(hr, key), `${key} (hr)`).toBe(false);
      expect(has(en, key), `${key} (en)`).toBe(false);
    }
  });
  it('no leaf is empty and hr never addresses the reader as Vi', () => {
    for (const k of leafKeys(hr)) expect(k.length).toBeGreaterThan(0);
    const all = JSON.stringify(hr);
    // JavaScript's ASCII \b splits "Više" after "Vi". Keep the informal-voice
    // rule without rejecting an ordinary Croatian word in the new headline.
    const formal = /(?<![\p{L}\p{N}_])(?:Vi|Vam)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])Vaš|Skenirajte|Kopirajte|Podijelite|Plaćate/u;
    expect(all).not.toMatch(formal);
    expect('Više grada.').not.toMatch(formal);
    expect('Vi možete nastaviti.').toMatch(formal);
  });
  it('carries the approved copy verbatim', () => {
    expect(hr.kiosk.invitation).toBe('Skeniraj za 10 minuta grada. Manje ekrana, više Zagreba.');
    expect(hr.session.unlocked).toBe('Otključano · {label} · do {time}');
    expect(hr.session.expiring60).toBe('Još minuta. Ono što gledaš ostaje na zaslonu i nakon isteka.');
    // The end of the ten minutes [O-59], [O-62] (WP4 step 11): the owner's three sentences, verbatim.
    expect(hr.session.expired).toBe('Deset minuta je prošlo. Zaslon u blizini otključava novih 10 minuta.');
    expect(hr.session.expiredHint).toBe('Sigurnost ostaje otvorena na /hitno.');
    expect(hr.session.expiredCta).toBe('Skeniraj za novih 10 minuta');
    expect(hr.scan.errors['same-network']).toBe('Ovaj kod trenutačno nije moguće iskoristiti s ove veze. Skeniraj ponovno.');
  });
});

describe('createDefaultI18n', () => {
  it('defaults to hr, interpolates, and falls back to hr for a missing en key', () => {
    const i18n = createDefaultI18n();
    expect(DEFAULT_LOCALE).toBe('hr');
    expect(SUPPORTED_LOCALES).toEqual(['hr', 'en']);
    expect(i18n.t('session.unlocked', { label: 'kafić', time: '14:32' })).toBe('Otključano · kafić · do 14:32');
    expect(i18n.setLocale('en')).toBe('en');
    expect(i18n.t('common.copy')).toBe('Copy');
    expect(i18n.t('nonexistent.key')).toBe('nonexistent.key');
  });
  it('uses Croatian plural categories', () => {
    const i18n = createDefaultI18n('hr');
    expect(i18n.t('common.minutes', { count: 1 })).toBe('1 minuta');
    expect(i18n.t('common.minutes', { count: 3 })).toBe('3 minute');
    expect(i18n.t('common.minutes', { count: 10 })).toBe('10 minuta');
  });
  it('resolveInitialLocale prefers a stored choice, then the browser list, then undefined', () => {
    expect(resolveInitialLocale('en', ['hr'])).toBe('en');
    expect(resolveInitialLocale(null, ['de-DE', 'en-GB'])).toBe('en');
    expect(resolveInitialLocale(null, ['de'])).toBeUndefined();
  });
});

describe('createLanguageToggle', () => {
  it('shows the other language, switches, stores under vidikovac-locale and translates the page', () => {
    document.body.innerHTML = '<h1 data-i18n="scan.title"></h1>';
    const i18n = createDefaultI18n('hr');
    const stored: Record<string, string> = {};
    const seen: string[] = [];
    const btn = createLanguageToggle(i18n, { storage: { setItem: (k, v) => { stored[k] = v; } }, onChange: (l) => seen.push(l) });
    expect(btn.textContent).toBe('English');
    expect(btn.getAttribute('lang')).toBe('en');
    btn.click();
    expect(i18n.getLocale()).toBe('en');
    expect(btn.textContent).toBe('Hrvatski');
    expect(stored[LOCALE_STORAGE_KEY]).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('h1')?.textContent).toBe(en.scan.title);
    expect(seen).toEqual(['en']);
  });
});
