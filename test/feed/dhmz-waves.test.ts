import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FetchContext } from '../../worker/feed/schema';
import { COLD_URL, HEAT_URL, creationInstant, fetchDhmzWaves, parseWaves } from '../../worker/feed/modules/dhmz-waves';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const file = (name: string) => readFileSync(join(DIR, name), 'latin1');
const raw = (name: string) => new Uint8Array(readFileSync(join(DIR, name)));

function context(now: string, heat: () => Response, cold: () => Response): FetchContext {
  return {
    now: () => new Date(now),
    fetch: async (url) => {
      if (url === HEAT_URL) return heat();
      if (url === COLD_URL) return cold();
      throw new Error(`no fixture for ${url}`);
    },
  };
}

describe('dhmz-waves', () => {
  it('reads the filled heat and cold files on their first day', () => {
    const heat = parseWaves(file('toplinskival_5.xml'), 'heat', new Date('2026-09-30T15:00:00Z'));
    expect(heat.items).toHaveLength(1);
    expect(heat.items[0]).toMatchObject({
      id: 'dhmz-waves:heat:2026-09-30', kind: 'forecast', title: 'Toplinski val', dateBasis: 'event',
      at: '2026-09-29T22:00:00.000Z', until: '2026-10-04T22:00:00.000Z',
      geo: { type: 'Point', coordinates: [15.98, 45.82] },
      data: { wave: 'heat', levels: '1,2,3,1,0', level: 1, station: 'Zagreb' },
    });
    expect(heat.sourceUpdatedAt).toBe('2026-09-30T07:00:00.000Z');
    const cold = parseWaves(file('hladnival.xml'), 'cold', new Date('2026-09-30T15:00:00Z'));
    expect(cold.items[0]).toMatchObject({
      id: 'dhmz-waves:cold:2026-09-30', title: 'Hladni val', until: '2026-10-03T22:00:00.000Z',
      data: { wave: 'cold', levels: '0,1,2,0', level: 0, station: 'Zagreb' },
    });
    expect(cold.sourceUpdatedAt).toBe('2026-09-30T07:00:00.000Z');
  });

  it('keeps yesterday\'s file with today\'s level, and drops one two days old', () => {
    const now = new Date('2026-10-01T10:00:00Z');
    expect(parseWaves(file('toplinskival_5.xml'), 'heat', now).items[0]!.data!.level).toBe(2);
    expect(parseWaves(file('hladnival.xml'), 'cold', now).items[0]!.data!.level).toBe(1);
    const later = new Date('2026-10-02T10:00:00Z');
    expect(parseWaves(file('toplinskival_5.xml'), 'heat', later).items).toEqual([]);
    expect(parseWaves(file('hladnival.xml'), 'cold', later).items).toEqual([]);
  });

  it('gives no item and no error for the files as served out of season', async () => {
    const now = new Date('2026-10-01T02:10:00Z');
    expect(parseWaves(file('hladnival-stale.xml'), 'cold', now)).toMatchObject({ items: [], dropped: 0 });
    expect(parseWaves(file('toplinskival_5-empty.xml'), 'heat', now)).toMatchObject({ items: [], dropped: 0 });
    const payload = await fetchDhmzWaves(context('2026-10-01T02:10:00Z', () => new Response(raw('toplinskival_5-empty.xml')), () => new Response(raw('hladnival-stale.xml'))));
    expect(payload.items).toEqual([]);
    expect(payload.sources).toMatchObject({ heat: { status: 'live', itemCount: 0 }, cold: { status: 'live', itemCount: 0 } });
  });

  it('drops a station whose letter is outside the table and says the coverage is limited', async () => {
    const odd = file('toplinskival_5.xml').replace('<param name="dan3" value="R"/>', '<param name="dan3" value="Q"/>');
    const payload = await fetchDhmzWaves(context('2026-09-30T15:00:00Z', () => new Response(odd), () => new Response(raw('hladnival.xml'))));
    expect(payload.items.map((item) => item.id)).toEqual(['dhmz-waves:cold:2026-09-30']);
    expect(payload.coverage).toEqual({ shown: 1, total: 2, limited: true });
  });

  it('leaves one file\'s item when the other fails, and throws only when both do', async () => {
    const failing = () => { throw new Error('upstream 500'); };
    const payload = await fetchDhmzWaves(context('2026-09-30T15:00:00Z', failing, () => new Response(raw('hladnival.xml'))));
    expect(payload.items).toHaveLength(1);
    expect(payload.sources).toMatchObject({ heat: { status: 'down' }, cold: { status: 'live', itemCount: 1 } });
    await expect(fetchDhmzWaves(context('2026-09-30T15:00:00Z', failing, failing))).rejects.toThrow(/both/);
  });

  it('throws on a foreign root and reads both forms of creationtime', () => {
    expect(() => parseWaves('<?xml version="1.0"?><Bioprognoza/>', 'heat', new Date())).toThrow(/TriVis/);
    expect(creationInstant('Tue, 24 Feb 2026 09:27:51 +0100')).toEqual({ year: 2026, iso: '2026-02-24T08:27:51.000Z' });
    expect(creationInstant('Sun Sep 13 14:42:59 2026')).toEqual({ year: 2026, iso: '2026-09-13T12:42:00.000Z' });
  });
});
