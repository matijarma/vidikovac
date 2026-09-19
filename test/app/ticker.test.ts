// The header ticker's one pure module (kiosk/ticker.ts): the city's news as
// an ordered, deduplicated list of one-line items, and the index the 8 s
// period picks from it. No DOM, no clock of its own, no fetch.
import { describe, expect, it } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import type { CityState, Place } from '../../shared/city/types';
import { emptyCity } from '../../shared/city/types';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { kioskStrings } from '../../app/src/kiosk/strings';
import { TICKER_PERIOD_MS, tickerIndex, tickerItems } from '../../app/src/kiosk/ticker';

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb, a Friday
const i18n = createDefaultI18n('hr');
const s = kioskStrings('hr');
const attr = { text: 'Izvor: test', url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' };

type Item = ModuleSnapshot['items'][number];
function snap(module: ModuleId, items: Item[], status: ModuleSnapshot['status'] = 'live'): ModuleSnapshot {
  return { module, tier: 'open', status, fetchedAt: new Date(NOW - 30_000).toISOString(), sourceUpdatedAt: new Date(NOW - 40_000).toISOString(), attribution: attr, items };
}
function item(module: ModuleId, id: string, kind: Item['kind'], title: string, extra: Partial<Item> = {}): Item {
  return { id, module, kind, tier: 'open', title, ...extra };
}
function route(id: string, medianDelaySeconds: number, vehicles = 3): Item {
  return item('zet-rt', `route:${id}`, 'vehicle', `Linija ${id}`, { data: { routeId: id, medianDelaySeconds, vehicles } });
}
const VENUE: Place = { id: 'emz', category: 'culture', name: 'Etnografski muzej', lon: 15.972, lat: 45.807, sourceId: 'culture', sourceRecord: 'emz' };
const city = (places: Place[] = [VENUE]): CityState => ({ ...emptyCity(), places });

const kickers = { weather: 'Vrijeme', transit: 'Promet', works: 'Radovi', tonight: 'Večeras', city: 'Grad' };

describe('tickerItems: the city in one line at a time', () => {
  it('says nothing at all before any source answers', () => {
    expect(tickerItems([], null, NOW, s, i18n)).toEqual([]);
    expect(tickerItems([snap('zet-rt', [], 'down')], emptyCity(), NOW, s, i18n)).toEqual([]);
  });

  it('opens with the late lines, worst delay first, in the app\'s own delay words', () => {
    const items = tickerItems([snap('zet-rt', [route('6', 240), route('11', 600), route('2', 10)])], null, NOW, s, i18n);
    expect(items.map((t) => t.text)).toEqual(['11 kasni 10 min', '6 kasni 4 min']);
    expect(items.map((t) => t.kicker)).toEqual([kickers.transit, kickers.transit]);
    expect(items.map((t) => t.key)).toEqual(['route:11', 'route:6']);
  });

  it('shares the exceptions card\u2019s thresholds: an outlier never leads the header, and neither does a two-minute median', () => {
    // 74 minutes is a trip update nobody closed; two minutes is the timetable breathing; three minutes is news.
    const items = tickerItems([snap('zet-rt', [route('281', -4_440), route('9', 40_000), route('6', 120), route('4', 180)])], null, NOW, s, i18n);
    expect(items.map((t) => t.text)).toEqual(['4 kasni 3 min']);
  });

  it('counts an early line as an exception too, in the card\u2019s order: late first, then trams, then the largest', () => {
    const items = tickerItems([snap('zet-rt', [route('109', 300), route('11', 200), route('6', 900), route('2', -300)])], null, NOW, s, i18n);
    expect(items.map((t) => t.key)).toEqual(['route:6', 'route:11', 'route:109']);
    expect(items.map((t) => t.text)).toEqual(['6 kasni 15 min', '11 kasni 3 min', '109 kasni 5 min']);
  });

  it('names a ZET notice, and a closure as a closure with the hour it ends, both under PROMET', () => {
    const modules = [
      snap('dogadanja', [item('dogadanja', 'n1', 'notice', 'Tramvaji preko Savske voze obilazno', { at: new Date(NOW - 3_600_000).toISOString(), data: { source: 'zet-promet' } })]),
      snap('prometnice', [item('prometnice', 'c1', 'closure', 'Ilica zatvorena', { at: new Date(NOW - 7_200_000).toISOString(), until: '2026-09-11T14:00:00Z' })]),
    ];
    const items = tickerItems(modules, null, NOW, s, i18n);
    expect(items.map((t) => [t.kicker, t.text])).toEqual([
      [kickers.transit, 'Tramvaji preko Savske voze obilazno'],
      [kickers.transit, 'Zatvoreno: Ilica zatvorena · do 16:00'],
    ]);
  });

  it('says a closure the worker has already condensed in the worker\'s own words, unprefixed', () => {
    const modules = [snap('prometnice', [item('prometnice', 'c1', 'closure', 'Sarajevska cesta', { brief: 'Sarajevska je zatvorena do subote zbog radova.' })])];
    expect(tickerItems(modules, null, NOW, s, i18n)[0]!.text).toBe('Sarajevska je zatvorena do subote zbog radova.');
  });

  it('gives works under way their own kicker', () => {
    const modules = [snap('dogadanja', [item('dogadanja', 'w1', 'notice', 'Obnova kolnika u Vlaškoj', { data: { source: 'komunalne', phase: 'U tijeku' } })])];
    const items = tickerItems(modules, null, NOW, s, i18n);
    expect(items).toEqual([{ key: 'works:w1', kicker: kickers.works, text: 'Obnova kolnika u Vlaškoj' }]);
  });

  it('puts tonight\'s events on the line with their hour and their venue', () => {
    const modules = [snap('dogadanja', [item('dogadanja', 'e1', 'event', 'Sa zida na zid', {
      at: '2026-09-11T17:00:00Z', dateBasis: 'event', data: { source: 'etnografski', precision: 'time', venue: 'Etnografski muzej' },
    })])];
    const items = tickerItems(modules, city(), NOW, s, i18n);
    expect(items).toEqual([{ key: 'event:e1', kicker: kickers.tonight, text: '19:00 · Sa zida na zid · Etnografski muzej' }]);
  });

  it('reads DHMZ\'s narrative for today and tomorrow, never the forecast row\'s own label', () => {
    const modules = [snap('dhmz-forecast', [
      item('dhmz-forecast', 'f1', 'forecast', 'Prognoza 11.9.', { at: '2026-09-11T00:00:00Z', summary: 'Pretežno oblačno uz povremenu kišu.' }),
      item('dhmz-forecast', 'f2', 'forecast', 'Prognoza 12.9.', { at: '2026-09-12T00:00:00Z', summary: 'Sunčano i toplije.' }),
      item('dhmz-forecast', 'f3', 'forecast', 'Prognoza 13.9.', { at: '2026-09-13T00:00:00Z', summary: 'Nestabilno.' }),
    ])];
    const items = tickerItems(modules, null, NOW, s, i18n);
    expect(items).toEqual([
      { key: 'forecast:today', kicker: kickers.weather, text: 'danas: Pretežno oblačno uz povremenu kišu.' },
      { key: 'forecast:tomorrow', kicker: kickers.weather, text: 'sutra: Sunčano i toplije.' },
    ]);
  });

  it('names the gazette\'s issue with its first act, the next Assembly session and the kvart news under GRAD', () => {
    const modules = [
      snap('glasnik', [
        item('glasnik', 'g1', 'act', 'Sadržaj', { at: '2026-09-10T00:00:00Z', data: { broj: '21', godina: '2026' } }),
        item('glasnik', 'g2', 'act', 'Odluka o komunalnoj naknadi', { data: { broj: '21', godina: '2026' } }),
      ]),
      snap('dogadanja', [
        item('dogadanja', 's1', 'event', '13. sjednica Gradske skupštine', { at: '2026-09-17T08:00:00Z', dateBasis: 'event', data: { source: 'skupstina', precision: 'time' } }),
        item('dogadanja', 'k1', 'notice', 'Nova šetnica na Savici', { data: { source: 'kvartovske' } }),
      ]),
    ];
    const items = tickerItems(modules, null, NOW, s, i18n);
    expect(items.map((t) => t.kicker)).toEqual([kickers.city, kickers.city, kickers.city]);
    expect(items.map((t) => t.text)).toEqual([
      'Službeni glasnik 21/2026 · Odluka o komunalnoj naknadi',
      '13. sjednica Gradske skupštine · čet 17. 9. 10:00',
      'Nova šetnica na Savici',
    ]);
  });

  it('prefers the worker\'s one-line brief to a long title', () => {
    const modules = [snap('dogadanja', [item('dogadanja', 'n1', 'notice', 'OBAVIJEST O PRIVREMENOJ IZMJENI REŽIMA PROMETA NA PODRUČJU GRADSKE ČETVRTI TREŠNJEVKA', { at: new Date(NOW - 60_000).toISOString(), data: { source: 'zet-promet' }, brief: 'Tramvaji 3 i 9 voze obilazno do subote.' })])];
    expect(tickerItems(modules, null, NOW, s, i18n)[0]!.text).toBe('Tramvaji 3 i 9 voze obilazno do subote.');
  });

  it('says one thing once: two sources with the same sentence make one item', () => {
    const modules = [snap('dogadanja', [
      item('dogadanja', 'k1', 'notice', 'Nova šetnica na Savici', { data: { source: 'kvartovske' } }),
      item('dogadanja', 'k2', 'notice', 'Nova šetnica na Savici', { data: { source: 'kvartovske' } }),
    ])];
    expect(tickerItems(modules, null, NOW, s, i18n)).toHaveLength(1);
  });

  it('keeps the order PROMET, RADOVI, VEČERAS, VRIJEME, GRAD across a full city', () => {
    const modules = [
      snap('zet-rt', [route('6', 240)]),
      snap('prometnice', [item('prometnice', 'c1', 'closure', 'Ilica zatvorena', { until: '2026-09-11T14:00:00Z' })]),
      snap('dogadanja', [
        item('dogadanja', 'w1', 'notice', 'Obnova kolnika', { data: { source: 'komunalne', phase: 'U tijeku' } }),
        item('dogadanja', 'e1', 'event', 'Sa zida na zid', { at: '2026-09-11T17:00:00Z', dateBasis: 'event', data: { source: 'etnografski', precision: 'time', venue: 'Etnografski muzej' } }),
        item('dogadanja', 'k1', 'notice', 'Nova šetnica', { data: { source: 'kvartovske' } }),
      ]),
      snap('dhmz-forecast', [item('dhmz-forecast', 'f1', 'forecast', 'Prognoza', { at: '2026-09-11T00:00:00Z', summary: 'Pretežno oblačno.' })]),
    ];
    expect(tickerItems(modules, city(), NOW, s, i18n).map((t) => t.kicker)).toEqual([
      kickers.transit, kickers.transit, kickers.works, kickers.tonight, kickers.weather, kickers.city,
    ]);
  });

  it('speaks English when the page does', () => {
    const en = kioskStrings('en');
    const items = tickerItems([snap('zet-rt', [route('6', 240)])], null, NOW, en, createDefaultI18n('en'));
    expect(items[0]!.kicker).toBe('Transit');
    expect(items[0]!.text).toBe('6 4 min late');
  });
});

describe('tickerIndex: one item at a time on the 8 s period', () => {
  it('is eight seconds', () => {
    expect(TICKER_PERIOD_MS).toBe(8_000);
  });
  it('has nothing to point at in an empty list', () => {
    expect(tickerIndex(0, NOW)).toBe(-1);
  });
  it('holds one item for a whole period and then moves on, wrapping at the end', () => {
    const base = 3 * TICKER_PERIOD_MS;
    expect(tickerIndex(3, base)).toBe(0);
    expect(tickerIndex(3, base + TICKER_PERIOD_MS - 1)).toBe(0);
    expect(tickerIndex(3, base + TICKER_PERIOD_MS)).toBe(1);
    expect(tickerIndex(3, base + 2 * TICKER_PERIOD_MS)).toBe(2);
    expect(tickerIndex(3, base + 3 * TICKER_PERIOD_MS)).toBe(0);
  });
  it('stands still on a single item', () => {
    expect(tickerIndex(1, NOW)).toBe(0);
    expect(tickerIndex(1, NOW + 99 * TICKER_PERIOD_MS)).toBe(0);
  });
});
