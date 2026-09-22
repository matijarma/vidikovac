// @vitest-environment happy-dom
// The departures block (companion WP4 step 2): at most three rows at the
// chosen stop, a live row blue with its dot and a timetable row a plain clock,
// no word per row and no prompt; one empty rule, one row in the rows' own box.
import { describe, expect, it, vi } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import type { DepartureBoard } from '../../shared/city/types';
import { departuresBlock, nextDepartures } from '../../app/src/city/next-departures';
import type { PlaceContext } from '../../app/src/city/place';
import type { ScreenStop } from '../../app/src/core/contracts';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import type { LayerContext } from '../../app/src/layers/types';

const NOW = Date.parse('2026-09-22T15:20:00Z'); // 17:20 in Zagreb
const iso = (ms: number): string => new Date(ms).toISOString();
const STOP: ScreenStop = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '13'] };
const SIBLING: ScreenStop = { id: '106_2', name: 'Trg bana J. Jelačića', lon: 15.97653, lat: 45.81307, routes: ['6', '13'] };
const OTHER: ScreenStop = { id: '200_1', name: 'Kvaternikov trg', lon: 15.9964, lat: 45.8149, routes: ['4'] };

const board = (stopId: string, status: DepartureBoard['status'], minutes: readonly number[]): DepartureBoard => ({
  operator: 'zet', stopId, stopName: STOP.name, status, generatedAt: iso(NOW - 60_000),
  departures: minutes.map((m, i) => ({ operator: 'zet', tripId: `${stopId}-t${i}`, routeId: i % 2 ? '13' : '6', routeName: i % 2 ? '13' : '6', headsign: i % 2 ? 'Žitnjak' : 'Črnomerec', at: iso(NOW + m * 60_000) })),
});
/** A tracked tram on the first trip of 106_1, one minute late. */
const ZET_RT: ModuleSnapshot = {
  module: 'zet-rt', tier: 'session', status: 'live', fetchedAt: iso(NOW - 5_000),
  attribution: { text: 'ZET', url: 'https://example.test/', licence: 'Otvorena dozvola' },
  items: [{ id: 'vehicle:1', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6', geo: { type: 'Point', coordinates: [15.97, 45.81] }, data: { tripId: '106_1-t0', routeId: '6', delaySeconds: 60 } }],
};

function boards(held: readonly DepartureBoard[]) {
  return { ensure: vi.fn(), get: (_op: string, id: string) => held.find((b) => b.stopId === id), destroy: vi.fn() };
}
const place = (stop: ScreenStop | null, over: Partial<PlaceContext> = {}): PlaceContext =>
  ({ name: stop?.name ?? 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, kind: 'screen', stop, departuresStop: stop, ...over });
const ctx = (over: Partial<LayerContext> = {}): LayerContext =>
  ({ i18n: createDefaultI18n('hr'), snapshots: { 'zet-rt': ZET_RT }, now: NOW, stops: [STOP, SIBLING, OTHER], ...over });
const dom = (html: string): HTMLElement => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
};
const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('departuresBlock', () => {
  it('boards every platform of the stop and shows three rows, a tracked one blue with its dot, the others a clock', () => {
    const cache = boards([board('106_1', 'live', [4, 12, 25]), board('106_2', 'live', [7, 18])]);
    const host = dom(departuresBlock(ctx({ boards: cache }), place(STOP)));
    expect(cache.ensure).toHaveBeenCalledWith('zet', ['106_1', '106_2'], undefined);
    const rows = [...host.querySelectorAll<HTMLElement>('[data-testid=day-departures] > li.sada-departure[data-live]')];
    expect(rows).toHaveLength(3);
    const [tracked, ...timetable] = rows;
    expect(tracked!.dataset.live).toBe('true');
    expect(tracked!.querySelector('.t-live')?.getAttribute('aria-label')).toBe('uživo');
    expect(tracked!.querySelector('.t-eta')?.getAttribute('data-live')).toBe('true');
    expect(text(tracked)).toBe('6Črnomerecza 5 min');
    for (const row of timetable) {
      expect(row.dataset.live).toBe('false');
      expect(row.querySelector('.t-live')).toBeNull();
      expect(row.querySelector('.t-eta time')).not.toBeNull();
      expect(row.querySelector('.t-eta')?.hasAttribute('data-live')).toBe(false);
    }
    expect(rows.map((r) => r.querySelector('.line')?.getAttribute('data-kind'))).toEqual(['tram', 'tram', 'tram']);
    // No word per row, no fetch time, no prompt, no note: colour and the dot carry it [O-27].
    for (const word of ['Procjena', 'po redu vožnje', 'uživo', 'Odaberi', 'ZET']) expect(text(host)).not.toContain(word);
    expect(host.querySelector('section.sada-departures')?.getAttribute('aria-label')).toBe('Sljedeći polasci, Trg bana J. Jelačića');
  });

  it('names the stop above its rows only when asked and when the stop is not the place itself', () => {
    const cache = boards([board('200_1', 'live', [3])]);
    const named = dom(departuresBlock(ctx({ boards: cache }), place(OTHER, { kind: 'city', name: 'Trg bana J. Jelačića', stop: null }), { heading: true }));
    expect(text(named.querySelector('h3.sada-departures-title'))).toBe('Kvaternikov trg');
    expect(dom(departuresBlock(ctx({ boards: cache }), place(OTHER), { heading: true })).querySelector('h3')).toBeNull();
    expect(dom(departuresBlock(ctx({ boards: cache }), place(OTHER, { name: 'Trg bana J. Jelačića' }))).querySelector('h3')).toBeNull();
  });

  describe('one empty rule: one row in the rows’ own box', () => {
    const empty = (html: string) => {
      const host = dom(html);
      const list = host.querySelector<HTMLElement>('[data-testid=day-departures]')!;
      expect(list.children).toHaveLength(1);
      expect(list.querySelectorAll('.sada-departure')).toHaveLength(0);
      return { list, row: list.querySelector<HTMLElement>('li.sada-departure-empty')! };
    };

    it('a board on its way is a placeholder row, busy and silent', () => {
      const { list, row } = empty(departuresBlock(ctx({ boards: boards([]) }), place(STOP)));
      expect(list.getAttribute('aria-busy')).toBe('true');
      expect(row.getAttribute('aria-hidden')).toBe('true');
      expect(row.querySelector('.skeleton')).not.toBeNull();
      expect(text(row)).toBe('');
    });

    it('a board that failed says so once; a live board with nothing left says there is nothing', () => {
      const down = empty(departuresBlock(ctx({ boards: boards([board('106_1', 'down', []), board('106_2', 'down', [])]) }), place(STOP)));
      expect(text(down.row)).toBe('Vozni red trenutačno nije dostupan.');
      expect(down.list.hasAttribute('aria-busy')).toBe(false);
      const over = empty(departuresBlock(ctx({ boards: boards([board('106_1', 'live', [-30])]) }), place(STOP)));
      expect(text(over.row)).toBe('Nema najavljenih polazaka.');
    });

    it('a frozen view asks for nothing and says the timetable never came', () => {
      const cache = boards([]);
      const frozen = empty(departuresBlock(ctx({ boards: cache, frozenAt: NOW, session: { expiresAt: NOW, frozen: true } }), place(STOP)));
      expect(cache.ensure).not.toHaveBeenCalled();
      expect(text(frozen.row)).toBe('Sesija je završila prije nego što je red vožnje stigao.');
      expect(frozen.list.hasAttribute('aria-busy')).toBe(false);
    });

    it('waits for the catalogue with a placeholder, and boards nothing when no platform is within reach', () => {
      const waiting = empty(departuresBlock(ctx({ stops: undefined, boards: boards([]) }), place(null, { kind: 'city' })));
      expect(waiting.list.getAttribute('aria-busy')).toBe('true');
      expect(departuresBlock(ctx({ boards: boards([]) }), place(null, { kind: 'address', name: 'Sljeme' }))).toBe('');
    });

    it('a catalogue that failed to load says the timetable is unavailable, in one row that is not busy', () => {
      const down = empty(departuresBlock(ctx({ stops: undefined, stopsDown: true, boards: boards([]) }), place(null, { kind: 'city' })));
      expect(down.list.hasAttribute('aria-busy')).toBe(false);
      expect(down.row.hasAttribute('aria-hidden')).toBe(false);
      expect(text(down.row)).toBe('Vozni red trenutačno nije dostupan.');
    });
  });

  it('frozen, a tracked row keeps its dot but is no longer live and never says "uživo"', () => {
    const html = departuresBlock(ctx({ boards: boards([board('106_1', 'live', [4])]), frozenAt: NOW, session: { expiresAt: NOW, frozen: true } }), place(STOP));
    const row = dom(html).querySelector<HTMLElement>('li.sada-departure')!;
    expect(row.dataset.live).toBe('false');
    expect(row.querySelector('.t-live')).not.toBeNull();
    expect(html).not.toContain('uživo');
  });

  it('frozen by the session flag alone, the block uses one frozen moment: no board asked for, no live row, no "uživo"', () => {
    const cache = boards([board('106_1', 'live', [4, 9])]);
    const html = departuresBlock(ctx({ boards: cache, session: { expiresAt: NOW, frozen: true } }), place(STOP));
    expect(cache.ensure).not.toHaveBeenCalled();
    const rows = [...dom(html).querySelectorAll<HTMLElement>('li.sada-departure')];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.dataset.live)).toEqual(['false', 'false']);
    expect(rows[0]!.querySelector('.t-live')?.getAttribute('aria-label')).toBe('podaci od 17:20');
    expect(html).not.toContain('data-live="true"');
    expect(html).not.toContain('uživo');
  });
});

describe('nextDepartures (the old entry point, until Sada calls departuresBlock)', () => {
  it('reads the page’s place, else resolves one from the context', () => {
    const cache = boards([board('200_1', 'live', [3]), board('106_1', 'live', [4])]);
    const fromPage = dom(nextDepartures(ctx({ boards: cache, place: place(OTHER) })));
    expect(fromPage.querySelector('section')?.getAttribute('aria-label')).toBe('Sljedeći polasci, Kvaternikov trg');
    // No page place: the screen's stop, then (none here) Trg bana J. Jelačića from the catalogue.
    const screen = { surface: 'phone', locale: 'hr', theme: 'light', themePreference: 'auto', lightweight: false, reducedMotion: false, stop: OTHER } as const;
    expect(dom(nextDepartures(ctx({ boards: cache, screen }))).querySelector('section')?.getAttribute('aria-label')).toBe('Sljedeći polasci, Kvaternikov trg');
    const city = dom(nextDepartures(ctx({ boards: cache })));
    expect(city.querySelector('section')?.getAttribute('aria-label')).toBe('Sljedeći polasci, Trg bana J. Jelačića');
    // The place is the stop here, so no heading repeats it.
    expect(city.querySelector('h3')).toBeNull();
  });
});
