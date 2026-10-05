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
  it('R3 review: includes whole-day and timed gas notices in the safety list', () => {
    const gas = snap('prekidi', [
      item('prekidi', 'gpz:day', 'cut', 'Dunjevac', { at: '2026-09-22T22:00:00Z', until: '2026-09-23T22:00:00Z', data: { utility: 'plin', precision: 'day', houseNumbers: '17' } }),
      item('prekidi', 'gpz:time', 'cut', 'Zagorska ulica', { at: '2026-09-24T06:00:00Z', until: '2026-09-24T12:00:00Z', data: { utility: 'plin', precision: 'time', houseNumbers: '18' } }),
    ]);
    const section = renderLayer('sigurnost', ctx({ prekidi: gas }));
    const rows = [...section.querySelectorAll('[data-testid=cut-row]')];
    expect(rows).toHaveLength(2);
    expect(text(rows[0]!)).toContain('bez plina');
    expect(text(rows[0]!)).not.toContain('00:00');
    expect(text(rows[1]!)).toContain('bez plina 08:00–14:00');
    expect(text(section)).not.toContain(hr.t('safety.cutsNone'));
    for (const row of rows) expect(text(row)).not.toMatch(FORBIDDEN);
  });
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
    expect(text(empty.querySelector('#sf-cuts'))).toContain('Nema najavljenih prekida struje, vode ni plina.');
    expect(text(empty.querySelector('#sf-roads'))).toContain('HAK ne javlja ništa za područje Zagreba.');
    const absent = renderLayer('sigurnost', ctx({}));
    expect(text(absent.querySelector('#sf-cuts'))).toContain(hr.t('status.loading'));
    const down = renderLayer('sigurnost', ctx({ hak: snap('hak', [], 'down'), prekidi: snap('prekidi', [], 'down') }));
    expect(text(down.querySelector('#sf-roads'))).toContain(hr.t('status.unknown'));
    expect(text(down.querySelector('#sf-cuts'))).toContain(hr.t('status.unknown'));
  });

  it('R0 review: never confirms no power or water cuts while one publisher is down', () => {
    const partial: ModuleSnapshot = {
      ...snap('prekidi', []),
      sources: { 'hep-ods': { status: 'live', itemCount: 0 }, vio: { status: 'down', itemCount: 0 } },
    };
    const section = renderLayer('sigurnost', ctx({ prekidi: partial }));
    expect(text(section.querySelector('#sf-cuts'))).not.toContain(hr.t('safety.cutsNone'));
    expect(text(section.querySelector('#sf-cuts'))).toContain(hr.t('status.unknown'));
    expect(section.querySelector('#sf-cuts [data-action=retry]')).not.toBeNull();
    const available = renderLayer('sigurnost', ctx({ prekidi: { ...partial, items: CUTS.items } }));
    expect(available.querySelectorAll('[data-testid=cut-row]')).toHaveLength(8);
  });

  it('R0 review: never confirms an empty cut list when source coverage is incomplete', () => {
    const limited: ModuleSnapshot = { ...snap('prekidi', []), coverage: { shown: 0, total: 1, limited: true } };
    const section = renderLayer('sigurnost', ctx({ prekidi: limited }));
    expect(text(section.querySelector('#sf-cuts'))).not.toContain(hr.t('safety.cutsNone'));
    expect(text(section.querySelector('#sf-cuts'))).toContain(hr.t('status.unknown'));
  });
});

describe('Vrijeme: the hourly grid (R0, rebuilt in the irritation pass)', () => {
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

  it('the hourly grid is a named list that does not scroll, so it needs no focus stop of its own (irritation pass; DR1 gave the old strip one)', () => {
    const section = renderLayer('zrak-i-nebo', ctx({ 'dhmz-hourly': HOURLY }));
    const grid = section.querySelector<HTMLElement>('ol[data-testid=weather-hourly]')!;
    expect(grid.classList.contains('wx-hourly')).toBe(true);
    expect(grid.hasAttribute('tabindex')).toBe(false);
    expect(grid.getAttribute('aria-labelledby')).toBe('wx-hourly-title');
  });

  it('prints twelve cells from the current hour, Grič before Maksimir, the chance of rain from 30 %', () => {
    const section = renderLayer('zrak-i-nebo', ctx({ 'dhmz-hourly': HOURLY }));
    const cells = section.querySelectorAll('[data-testid=weather-hourly] > li.wx-hour');
    expect(cells).toHaveLength(12);
    // 12:20 now: the step of the current hour (12:00, begun at most an hour ago) is the first.
    expect(text(cells[0]!.querySelector('time'))).toBe('12:00');
    expect(text(cells[0]!.querySelector('.wx-hour-temp'))).toBe('17°');
    expect(text(section.querySelector('[data-testid=weather-hourly]'))).not.toContain('30°'); // Maksimir's steps are not used
    // Every cell keeps its rain line so the rows line up; only the step at 70 % says anything in it.
    const wet = [...cells].filter((c) => c.getAttribute('data-wet') === '1');
    expect(wet).toHaveLength(1);
    expect(text(wet[0]!.querySelector('.wx-hour-rain'))).toBe('vjerojatnost oborine 70 %');
    expect(wet[0]!.querySelector('.wx-hour-rain .visually-hidden')?.textContent).toBe('vjerojatnost oborine ');
    expect([...cells].filter((c) => text(c.querySelector('.wx-hour-rain')) !== '')).toHaveLength(1);
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

  it('R0 review: starts the hourly grid at the current step on an exact hour boundary', () => {
    const section = renderLayer('zrak-i-nebo', ctx({ 'dhmz-hourly': HOURLY }, { now: Date.parse('2026-09-22T10:00:00Z') }));
    const cells = section.querySelectorAll('[data-testid=weather-hourly] > li.wx-hour');
    expect(cells).toHaveLength(12);
    expect(text(cells[0]!.querySelector('time'))).toBe('12:00');
  });
});
