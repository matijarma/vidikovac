import { describe, expect, it } from 'vitest';
import type { FeedItem, ModuleSnapshot } from '../../worker/feed/schema';
import {
  HITNO_MODULES,
  SEVERITY_WORDS,
  ZBORNA_MJESTA_LAYER,
  selectHitno,
} from '../../worker/hitno/select';

// Friday 11 Sept 2026, 10:00 in Zagreb.
const NOW = new Date('2026-09-11T08:00:00Z');

function snapshot(module: ModuleSnapshot['module'], items: FeedItem[]): ModuleSnapshot {
  return {
    module,
    tier: 'open',
    status: 'live',
    fetchedAt: '2026-09-11T07:59:30Z',
    attribution: { text: `Izvor: ${module}`, url: 'https://example.test', licence: 'Otvorena dozvola' },
    items,
  };
}

function item(partial: Partial<FeedItem> & Pick<FeedItem, 'id' | 'module' | 'kind' | 'title'>): FeedItem {
  return { tier: 'open', ...partial };
}

describe('selectHitno', () => {
  it('lists the four modules the page needs, in page order', () => {
    expect([...HITNO_MODULES]).toEqual(['dhmz-cap', 'emsc', 'prometnice', 'ckan-geo']);
  });

  it('maps every CAP severity to a Croatian word', () => {
    expect(SEVERITY_WORDS).toEqual({
      info: 'obavijest',
      minor: 'manje upozorenje',
      moderate: 'žuto upozorenje',
      severe: 'narančasto upozorenje',
      extreme: 'crveno upozorenje',
    });
  });

  it('keeps unexpired warnings, most severe first, and drops expired ones', () => {
    const cap = snapshot('dhmz-cap', [
      item({ id: 'a', module: 'dhmz-cap', kind: 'warning', title: 'Žuto upozorenje za grmljavinsku oluju', severity: 'moderate', at: '2026-09-11T05:00:00+02:00', until: '2026-09-11T17:00:00+02:00' }),
      item({ id: 'b', module: 'dhmz-cap', kind: 'warning', title: 'Narančasto upozorenje za vjetar', severity: 'severe', at: '2026-09-11T12:00:00+02:00', until: '2026-09-11T23:00:00+02:00' }),
      item({ id: 'c', module: 'dhmz-cap', kind: 'warning', title: 'Isteklo upozorenje', severity: 'moderate', at: '2026-09-11T00:00:00+02:00', until: '2026-09-11T08:00:00+02:00' }),
    ]);
    const data = selectHitno([cap], NOW);
    expect(data.warnings.items.map((w) => w.id)).toEqual(['b', 'a']);
    expect(data.warnings.snapshot?.module).toBe('dhmz-cap');
  });

  it('keeps quakes of the last 72 hours only, newest first', () => {
    const emsc = snapshot('emsc', [
      item({ id: 'old', module: 'emsc', kind: 'quake', title: 'M 2.1, Pokuplje', at: '2026-09-07T12:00:00Z' }),
      item({ id: 'q1', module: 'emsc', kind: 'quake', title: 'M 1.6, Rijeka', at: '2026-09-09T17:11:21Z' }),
      item({ id: 'q2', module: 'emsc', kind: 'quake', title: 'M 1.3, Krapina', at: '2026-09-10T11:08:40Z' }),
      item({ id: 'nodate', module: 'emsc', kind: 'quake', title: 'bez vremena' }),
    ]);
    const data = selectHitno([emsc], NOW);
    expect(data.quakes.items.map((q) => q.id)).toEqual(['q2', 'q1']);
  });

  it('keeps closures that have started and not ended, soonest reopening first', () => {
    const prometnice = snapshot('prometnice', [
      item({ id: 'future', module: 'prometnice', kind: 'closure', title: 'Ilica', at: '2026-09-12T07:00:00Z' }),
      item({ id: 'ended', module: 'prometnice', kind: 'closure', title: 'Savska', at: '2026-09-01T07:00:00Z', until: '2026-09-10T07:00:00Z' }),
      item({ id: 'open-ended', module: 'prometnice', kind: 'closure', title: 'Vukomerec', at: '2026-06-23T07:00:00Z' }),
      item({ id: 'today', module: 'prometnice', kind: 'closure', title: 'Sarajevska cesta', at: '2026-04-30T11:46:00Z', until: '2026-09-11T18:00:00Z' }),
    ]);
    const data = selectHitno([prometnice], NOW);
    expect(data.closures.items.map((c) => c.id)).toEqual(['today', 'open-ended']);
  });

  it('takes assembly points only from the zborna mjesta dataset, sorted by name', () => {
    const ckan = snapshot('ckan-geo', [
      item({ id: 'p2', module: 'ckan-geo', kind: 'poi', title: 'Trešnjevka – Park Stara Trešnjevka', data: { layer: ZBORNA_MJESTA_LAYER }, geo: { type: 'Point', coordinates: [15.95, 45.8] } }),
      item({ id: 'p1', module: 'ckan-geo', kind: 'poi', title: 'Centar – Zrinjevac', data: { layer: ZBORNA_MJESTA_LAYER } }),
      item({ id: 'lj', module: 'ckan-geo', kind: 'poi', title: 'Ljekarna', data: { dataset: 'ljekarne' } }),
    ]);
    const data = selectHitno([ckan], NOW);
    expect(data.assembly.items.map((p) => p.id)).toEqual(['p1', 'p2']);
  });

  it('yields a null snapshot and an empty list for a module that did not arrive', () => {
    const data = selectHitno([], NOW);
    for (const panel of Object.values(data)) {
      expect(panel).toEqual({ snapshot: null, items: [], availability: null, state: 'unavailable' });
    }
  });

  it.each([
    ['dhmz-cap', 'warnings'], ['emsc', 'quakes'], ['prometnice', 'closures'],
  ] as const)('distinguishes live empty, stale empty and unavailable %s', (module, key) => {
    const live = snapshot(module, []);
    expect(selectHitno([live], NOW)[key]).toMatchObject({
      state: 'empty', items: [], availability: { status: 'live', itemCount: 0, fetchedAt: live.fetchedAt },
    });
    const stale = selectHitno([{ ...live, status: 'stale' }], NOW)[key];
    expect(stale.state).toBe('stale');
    expect(stale.availability?.status).toBe('stale');
    const down = selectHitno([{ ...live, status: 'down' }], NOW)[key];
    expect(down.state).toBe('unavailable');
    expect(down.availability).toEqual({ status: 'down', itemCount: 0 });
  });

  it('reports a successful current empty result after filtering, without changing the source count', () => {
    const cap = snapshot('dhmz-cap', [
      item({ id: 'expired', module: 'dhmz-cap', kind: 'warning', title: 'Expired', until: '2026-09-10T08:00:00Z' }),
    ]);
    const panel = selectHitno([cap], NOW).warnings;
    expect(panel.state).toBe('empty');
    expect(panel.items).toEqual([]);
    expect(panel.availability?.itemCount).toBe(1);
  });

  it('retains current selections with explicit live or stale health', () => {
    const cap = snapshot('dhmz-cap', [
      item({ id: 'active', module: 'dhmz-cap', kind: 'warning', title: 'Active' }),
    ]);
    const live = selectHitno([cap], NOW).warnings;
    expect(live.state).toBe('ready');
    const stale = selectHitno([{ ...cap, status: 'stale' }], NOW).warnings;
    expect(stale.state).toBe('stale');
    expect(stale.items).toEqual(live.items);
  });

  it('does not let successful districts hide failed assembly-point data', () => {
    const ckan = snapshot('ckan-geo', [
      item({ id: 'district', module: 'ckan-geo', kind: 'poi', title: 'Centar', data: { layer: 'gradske-cetvrti' } }),
    ]);
    ckan.sources = {
      'gradske-cetvrti': { status: 'live', itemCount: 1 },
      'zborna-mjesta': { status: 'down', itemCount: 0 },
    };
    const panel = selectHitno([ckan], NOW).assembly;
    expect(panel.snapshot).toBe(ckan);
    expect(panel.items).toEqual([]);
    expect(panel.availability).toEqual({ status: 'down', itemCount: 0 });
    expect(panel.state).toBe('unavailable');
  });

  it('recognises successful empty assembly data even if districts are down', () => {
    const ckan = snapshot('ckan-geo', []);
    ckan.sources = {
      'gradske-cetvrti': { status: 'down', itemCount: 0 },
      'zborna-mjesta': { status: 'live', itemCount: 0, fetchedAt: '2026-09-11T07:50:00Z' },
    };
    const panel = selectHitno([ckan], NOW).assembly;
    expect(panel.state).toBe('empty');
    expect(panel.availability).toEqual(ckan.sources['zborna-mjesta']);
  });

  it.each([
    ['live', 0, 'empty'],
    ['live', 1, 'ready'],
    ['stale', 0, 'stale'],
    ['stale', 1, 'stale'],
  ] as const)('uses assembly source %s with %i items when districts are down and the composite is stale', (status, count, state) => {
    const point = item({
      id: 'z1', module: 'ckan-geo', kind: 'poi', title: 'Zrinjevac', data: { layer: ZBORNA_MJESTA_LAYER },
    });
    const ckan = snapshot('ckan-geo', count ? [point] : []);
    ckan.status = 'stale';
    ckan.staleSince = ckan.fetchedAt;
    ckan.sources = {
      'gradske-cetvrti': { status: 'down', itemCount: 0 },
      'zborna-mjesta': { status, itemCount: count, fetchedAt: ckan.fetchedAt },
    };
    const before = structuredClone(ckan);
    const panel = selectHitno([ckan], NOW).assembly;
    expect(panel.state).toBe(state);
    expect(panel.items).toEqual(ckan.items);
    expect(panel.availability).toEqual(ckan.sources['zborna-mjesta']);
    expect(ckan).toEqual(before);
  });

  it.each([undefined, '', 'not-a-date'])(
    'conservatively marks a legacy live assembly source stale without a readable fetch timestamp: %s',
    (fetchedAt) => {
      const ckan = snapshot('ckan-geo', []);
      ckan.status = 'stale';
      ckan.sources = {
        'gradske-cetvrti': { status: 'down', itemCount: 0 },
        'zborna-mjesta': { status: 'live', itemCount: 0, fetchedAt },
      };
      const panel = selectHitno([ckan], NOW).assembly;
      expect(panel.state).toBe('stale');
      expect(panel.availability).toEqual({ ...ckan.sources['zborna-mjesta'], status: 'stale' });
    },
  );

  it.each([undefined, {}, { 'gradske-cetvrti': { status: 'live' as const, itemCount: 17 } }])(
    'does not infer assembly health from a legacy snapshot or unrelated sources: %s',
    (sources) => {
      const ckan = { ...snapshot('ckan-geo', []), sources };
      expect(selectHitno([ckan], NOW).assembly).toMatchObject({ availability: null, state: 'unavailable' });
    },
  );

  it('keeps legacy assembly records without treating their presence as successful source health', () => {
    const point = item({
      id: 'z1', module: 'ckan-geo', kind: 'poi', title: 'Zrinjevac', data: { layer: ZBORNA_MJESTA_LAYER },
    });
    const panel = selectHitno([snapshot('ckan-geo', [point])], NOW).assembly;
    expect(panel.items).toEqual([point]);
    expect(panel.availability).toBeNull();
    expect(panel.state).toBe('unavailable');
  });

  it('uses assembly-specific timestamps and counts, not the combined snapshot or district timestamps', () => {
    const point = item({
      id: 'z1', module: 'ckan-geo', kind: 'poi', title: 'Zrinjevac', data: { layer: ZBORNA_MJESTA_LAYER },
    });
    const ckan = snapshot('ckan-geo', [point]);
    ckan.sourceUpdatedAt = '2026-09-11T07:59:00Z';
    ckan.sources = {
      'gradske-cetvrti': { status: 'live', itemCount: 17, fetchedAt: ckan.fetchedAt },
      'zborna-mjesta': {
        status: 'live', itemCount: 1, fetchedAt: '2026-09-11T07:45:00Z',
        sourceUpdatedAt: '2026-08-01T10:00:00Z', totalItems: 1,
      },
    };
    const panel = selectHitno([ckan], NOW).assembly;
    expect(panel.state).toBe('ready');
    expect(panel.availability).toEqual(ckan.sources['zborna-mjesta']);
    expect(panel.availability?.sourceUpdatedAt).not.toBe(ckan.sourceUpdatedAt);
  });

  it.each([
    ['live', 'stale', 'stale', 'stale'],
    ['stale', 'live', 'live', 'empty'],
    ['stale', 'stale', 'stale', 'stale'],
    ['stale', 'down', 'down', 'unavailable'],
    ['down', 'live', 'down', 'unavailable'],
  ] as const)('uses independent timestamped assembly health for parent %s and source %s', (parent, source, status, state) => {
    const ckan = snapshot('ckan-geo', []);
    ckan.status = parent;
    ckan.sources = { 'zborna-mjesta': { status: source, itemCount: 0, fetchedAt: '2026-09-10T08:00:00Z' } };
    const before = structuredClone(ckan);
    const panel = selectHitno([ckan], NOW).assembly;
    expect(panel.state).toBe(state);
    expect(panel.availability?.status).toBe(status);
    expect(panel.availability?.fetchedAt).toBe('2026-09-10T08:00:00Z');
    expect(ckan).toEqual(before);
  });

  it('does not invent a successful fetch timestamp from the district-level snapshot', () => {
    const ckan = snapshot('ckan-geo', []);
    ckan.sources = { 'zborna-mjesta': { status: 'down', itemCount: 0 } };
    expect(selectHitno([ckan], NOW).assembly.availability).not.toHaveProperty('fetchedAt');
  });
});
