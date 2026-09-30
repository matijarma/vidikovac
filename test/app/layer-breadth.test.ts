// @vitest-environment happy-dom
// The breadth on the phone and the desktop (R0): Sigurnost lists HAK's road states and the planned power and water
// cuts, Vrijeme shows DHMZ's hourly strip. Their words are the wall's own (kiosk.nearby.road.*, kiosk.nearby.cut.*),
// their states the layers' (listState), their credits in the provenance block; no caveat word in a row.
import { describe, expect, it } from 'vitest';
import type { FeedItem, ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { renderLayer } from '../../app/src/layers';
import type { LayerContext } from '../../app/src/layers/types';

const NOW = Date.parse('2026-09-22T10:20:00Z'); // Tue 12:20 in Zagreb
const hr = createDefaultI18n('hr');
const FORBIDDEN = /registra|nije provjera|Obuhvat|Dohvaćeno|zastarjelo|nepotvrđeno|uživo|vozni red|Procjena|nedostupn|…/i;
const snap = (module: ModuleId, items: FeedItem[], status: ModuleSnapshot['status'] = 'live'): ModuleSnapshot => ({
  module, tier: 'open', status, fetchedAt: new Date(NOW - 60_000).toISOString(),
  attribution: { text: `Izvor: ${module}`, url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' }, items,
});
const item = (module: ModuleId, id: string, kind: string, title: string, extra: Partial<FeedItem> = {}): FeedItem =>
  ({ id, module, kind: kind as FeedItem['kind'], tier: 'open', title, ...extra });
const ctx = (snapshots: LayerContext['snapshots'], over: Partial<LayerContext> = {}): LayerContext => ({ i18n: hr, snapshots, now: NOW, ...over });
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

const ROADS = snap('hak', [
  item('hak', 'hak:a', 'road', 'Ulica grada Vukovara', { at: '2026-09-21T06:00:00Z', until: '2026-09-23T16:00:00Z', data: { state: 'privremena regulacija' } }),
  item('hak', 'hak:b', 'road', 'Slavonska avenija', { at: '2026-09-20T06:00:00Z', until: '2026-09-22T08:00:00Z', data: { state: 'radovi' } }), // ended
]);
const CUTS = snap('prekidi', Array.from({ length: 10 }, (_, i) => item('prekidi', `prekidi:hep:2026-09-23:u${i}`, 'cut', `Ulica ${String.fromCharCode(65 + i)}`, {
  at: `2026-09-2${3 + (i % 2)}T06:00:00Z`, until: `2026-09-2${3 + (i % 2)}T12:00:00Z`,
  data: { utility: i === 9 ? 'voda' : 'struja', houseNumbers: '12-20', district: 'Donji grad', precision: 'time' },
})));

describe('Sigurnost: HAK road states and the planned cuts (R0)', () => {
  it('lists the road state that has not ended with its word and end, eight cuts and a show-more, both credited', () => {
    const section = renderLayer('sigurnost', ctx({ hak: ROADS, prekidi: CUTS }));
    const roads = section.querySelectorAll('[data-testid=road-row]');
    expect(roads).toHaveLength(1);
    expect(text(roads[0]!.querySelector('.row-title'))).toBe('Ulica grada Vukovara');
    expect(text(roads[0]!.querySelector('.row-sub'))).toMatch(/^privremena regulacija · do /);
    expect(text(section.querySelector('#sf-roads-title'))).toContain('Stanje na cestama (HAK)');
    const cuts = section.querySelectorAll('[data-testid=cut-row]');
    expect(cuts).toHaveLength(8);
    expect(text(cuts[0]!.querySelector('.row-title'))).toBe('Ulica A 12-20');
    expect(text(cuts[0]!.querySelector('.row-sub'))).toContain('bez struje 08:00–14:00 · Donji grad');
    expect(section.querySelector('#sf-cuts .sf-more')).not.toBeNull();
    expect(text(section.querySelector('#sf-cuts-title'))).toContain('Planirani prekidi');
    const provenance = text(section.querySelector('.provenance'));
    expect(provenance).toContain('Izvor: hak');
    expect(provenance).toContain('Izvor: prekidi');
    for (const row of [...roads, ...cuts]) expect(text(row)).not.toMatch(FORBIDDEN);
  });

  it('says so when nothing is announced, and waits or says unknown when a module is absent or down', () => {
    const empty = renderLayer('sigurnost', ctx({ hak: snap('hak', []), prekidi: snap('prekidi', []) }));
    expect(text(empty.querySelector('#sf-cuts'))).toContain('Nema najavljenih prekida struje ni vode.');
    expect(text(empty.querySelector('#sf-roads'))).toContain('HAK ne javlja ništa za područje Zagreba.');
    const absent = renderLayer('sigurnost', ctx({}));
    expect(text(absent.querySelector('#sf-cuts'))).toContain(hr.t('status.loading'));
    const down = renderLayer('sigurnost', ctx({ hak: snap('hak', [], 'down'), prekidi: snap('prekidi', [], 'down') }));
    expect(text(down.querySelector('#sf-roads'))).toContain(hr.t('status.unknown'));
    expect(text(down.querySelector('#sf-cuts'))).toContain(hr.t('status.unknown'));
  });
});

describe('Vrijeme: the hourly strip (R0)', () => {
  const step = (station: 'gric' | 'maksimir', hour: number, temp: number | null, prob: number): FeedItem => {
    const at = new Date(Date.parse('2026-09-22T09:00:00Z') + hour * 3_600_000).toISOString();
    return item('dhmz-hourly', `dhmz-hourly:${station}:${at}`, 'forecast', station === 'gric' ? 'Zagreb-Grič' : 'Zagreb-Maksimir', {
      at, until: new Date(Date.parse(at) + 3_600_000).toISOString(),
      data: { station, prob, ...(temp === null ? {} : { temp }) },
    });
  };
  const HOURLY = snap('dhmz-hourly', [
    ...Array.from({ length: 20 }, (_, i) => step('gric', i - 2, 14 + i, i === 3 ? 70 : 10)),
    ...Array.from({ length: 20 }, (_, i) => step('maksimir', i - 2, 30, 90)),
  ]);

  it('prints twelve cells from the current hour, Grič before Maksimir, the chance of rain from 30 %', () => {
    const section = renderLayer('zrak-i-nebo', ctx({ 'dhmz-hourly': HOURLY }));
    const cells = section.querySelectorAll('[data-testid=weather-hourly] > li.wx-hour');
    expect(cells).toHaveLength(12);
    // 12:20 now: the step of the current hour (12:00, begun at most an hour ago) is the first.
    expect(text(cells[0]!.querySelector('time'))).toBe('12:00');
    expect(text(cells[0]!.querySelector('.wx-hour-temp'))).toBe('17 °C');
    expect(text(section.querySelector('[data-testid=weather-hourly]'))).not.toContain('30 °C'); // Maksimir's steps are not used
    const wet = [...cells].find((c) => c.querySelector('.wx-hour-rain'));
    expect(text(wet!.querySelector('.wx-hour-rain'))).toBe('vjerojatnost 70 %');
    expect(section.querySelectorAll('.wx-hour-rain')).toHaveLength(1);
    expect(text(section.querySelector('#wx-hourly-title'))).toContain('Po satima');
    expect(text(section.querySelector('.provenance'))).toContain('Izvor: dhmz-hourly');
  });

  it('takes Maksimir where Grič has no step, skips a step without a temperature, and waits while the module is absent', () => {
    const maksimir = snap('dhmz-hourly', [step('maksimir', 1, 18, 0), step('maksimir', 2, null, 0), step('maksimir', 3, 19, 0)]);
    const cells = renderLayer('zrak-i-nebo', ctx({ 'dhmz-hourly': maksimir })).querySelectorAll('[data-testid=weather-hourly] > li.wx-hour');
    expect([...cells].map((c) => text(c.querySelector('time')))).toEqual(['12:00', '14:00']);
    expect(renderLayer('zrak-i-nebo', ctx({})).querySelector('[data-testid=weather-hourly]')).toBeNull();
    expect(text(renderLayer('zrak-i-nebo', ctx({})).querySelector('#wx-hourly'))).toContain(hr.t('status.loading'));
  });
});
