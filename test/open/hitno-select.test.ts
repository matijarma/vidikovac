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
      minor: 'blago',
      moderate: 'umjereno',
      severe: 'ozbiljno',
      extreme: 'izuzetno',
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
    expect(data.warnings).toEqual({ snapshot: null, items: [] });
    expect(data.quakes).toEqual({ snapshot: null, items: [] });
    expect(data.closures).toEqual({ snapshot: null, items: [] });
    expect(data.assembly).toEqual({ snapshot: null, items: [] });
  });
});
