// @vitest-environment happy-dom
// U0 step 7 (docs/upgrade-2026-10-plan/U0.md, acceptance U0-6): the wall fitter on the one-departure morning. On
// Tuesday 29 September from about 06:00 to 12:00 the wall at 106_1 showed one departure: a 111-character event title
// with no short form wrapped to nine lines, and the fitter dropped the second and third departures and both closures
// to keep it. This replays the kiosk loop (kiosk.ts paintWall: selectNearby with the held and departed departures,
// the fixes after step 5) and the wall's timeline on the committed fixtures test/fixtures/wall/* at the simulated
// 1920 x 1080 layout (test/app/timeline-measure.ts), as the seed replay did (review.local/strike/scratch/wall-fit.test.ts).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ScreenStop } from '../../app/src/core/contracts';
import { liveFixes } from '../../app/src/city/feed';
import { selectNearby, type NearbyInput, type NearbyRow } from '../../app/src/city/nearby';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { byModule } from '../../app/src/kiosk/local';
import { EVENT_TITLE_MAX_LINES, mountTimeline } from '../../app/src/kiosk/timeline';
import { canonicalPlaces } from '../../shared/city/events';
import { placeFromStop } from '../../shared/city/place';
import { positionsUnavailable, resetServiceStateMemory } from '../../shared/city/service-state';
import { emptyCity, type CityState, type DepartureBoard, type Place } from '../../shared/city/types';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { simulated, WALL_1920 } from './timeline-measure';

const hr = createDefaultI18n('hr');
const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'wall');
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

interface Inputs { stops: ScreenStop[]; city: CityState; boards: DepartureBoard[]; modules: ModuleSnapshot[] }
function fixture(dir: string): Inputs {
  const root = join(FIXTURES, dir);
  const places = read<Place[]>(join(root, 'places.json'));
  const boards = ['106_1', '106_2', '1849_23', '1849_24'].map((s) => join(root, 'boards', `${s}.json`)).filter(existsSync).map((f) => read<DepartureBoard>(f));
  return { stops: read(join(root, 'stops.json')), city: { ...emptyCity(), places: canonicalPlaces(places) }, boards, modules: read<{ modules: ModuleSnapshot[] }>(join(root, 'teaser.json')).modules };
}
const readings = (dir: string): { at: number; rowIds: string[] }[] =>
  readFileSync(join(FIXTURES, dir, 'readings.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));

/** The wall's own timeless row at 07:45 on both days (the recorded monument, which the catalogue holds without coordinates; README). */
const WALL_HERITAGE = { id: 'always:heritage:heritage-9cae1bf25c9ce440', title: 'Spomenik banu Josipu Jelačiću', sub: 'Trg bana Josipa Jelačića' };
const EVENT = 'event:etnografski:22659';
const CLOSURES = ['closure:amruseva:2026-09-12T06:00:00.000Z', 'closure:gunduliceva:2026-07-04T05:00:00.000Z'];
const TUE = '2026-09-29-0745';
const MON = '2026-09-28-0745';
const FULL_AT = { [TUE]: Date.parse('2026-09-29T05:45:03.1Z'), [MON]: Date.parse('2026-09-28T05:45:03.1Z') } as const;

interface Painted { at: number; ids: string[]; rows: NearbyRow[]; host: HTMLElement; measure: ReturnType<typeof simulated> }
interface Loop {
  inputs: Inputs;
  fullAt: number;
  /** A zet-rt module to use in place of the day's own (scene C). */
  zetFrom?: ModuleSnapshot[];
  /** An edit of the selected rows before the fitter (scenes D to G). */
  edit?: (rows: NearbyRow[]) => NearbyRow[];
}

/** The kiosk loop at `times`: before `fullAt` only board 106_1 is in hand, then every board. */
function loop({ inputs, fullAt, zetFrom, edit }: Loop, times: readonly number[], onPaint: (painted: Painted) => void): void {
  resetServiceStateMemory();
  document.body.innerHTML = '';
  const host = document.createElement('div');
  host.className = 'k-nearby-host';
  document.body.appendChild(host);
  const section = (): HTMLElement => host.querySelector<HTMLElement>('[data-testid=nearby]')!;
  const measure = simulated(section, WALL_1920);
  const t = mountTimeline(host, { i18n: hr, reduced: true, designHeightPx: WALL_1920.boxPx, measure });
  const place = placeFromStop(inputs.stops.find((s) => s.id === '106_1')!, (r) => Number(r) < 100);
  let snapshots = byModule(inputs.modules);
  if (zetFrom) snapshots = { ...snapshots, 'zet-rt': byModule(zetFrom)['zet-rt'] };
  let wallItems: NearbyRow[] = [];
  const departedAt = new Map<string, number>();
  try {
    for (const at of times) {
      const heldDepartures = wallItems.filter((row) => row.kind === 'departure');
      // kiosk.ts after U0 step 5: outage() is positionsUnavailable, and the list takes the phone's fix-age rule.
      const zet = snapshots['zet-rt'];
      const input: NearbyInput = {
        place, radiusM: 2200, now: at, boards: at < fullAt ? inputs.boards.filter((b) => b.stopId === '106_1') : inputs.boards,
        fixes: positionsUnavailable(zet, at) ? [] : liveFixes(zet, at), snapshots, city: inputs.city, lastRun: null, locale: 'hr', i18n: hr,
        stops: inputs.stops, heldDepartures, departedDepartures: [...departedAt].map(([id, leftAt]) => ({ id, leftAt })),
      };
      wallItems = selectNearby(input);
      for (const row of heldDepartures) if (!wallItems.some((item) => item.id === row.id)) departedAt.set(row.id, at);
      for (const [id, leftAt] of departedAt) if (at - leftAt > 60_000) departedAt.delete(id);
      const substituted = wallItems.map((r) => (r.always && r.kind === 'always' ? { ...r, ...WALL_HERITAGE } : r));
      const rows = edit ? edit(substituted) : substituted;
      t.update(rows, 2200, at);
      onPaint({ at, ids: [...host.querySelectorAll<HTMLElement>('li.nearby-row')].map((li) => li.dataset.id!), rows, host, measure });
    }
  } finally {
    t.destroy();
    resetServiceStateMemory();
  }
}

const departuresOf = (ids: readonly string[]): number => ids.filter((id) => id.startsWith('dep:')).length;

afterEach(() => resetServiceStateMemory());

describe('the recorded slots, 07:45 to 07:56 Zagreb', () => {
  it('Tuesday 29 September: three departures and both closures at every one of the 300 reading instants', () => {
    const recorded = readings(TUE);
    expect(recorded).toHaveLength(300);
    const shown: string[][] = [];
    loop({ inputs: fixture(TUE), fullAt: FULL_AT[TUE] }, [FULL_AT[TUE] - 200, ...recorded.map((r) => r.at)], ({ ids }) => shown.push(ids));
    const atReadings = shown.slice(1);
    const good = atReadings.filter((ids) => departuresOf(ids) === 3 && CLOSURES.every((id) => ids.includes(id)));
    expect(good.length).toBe(300);
  });

  it('Monday 28 September (the control): the replayed wall equals the recorded row ids in at least 294 of 300 readings', () => {
    const recorded = readings(MON);
    const shown: string[][] = [];
    loop({ inputs: fixture(MON), fullAt: FULL_AT[MON] }, [FULL_AT[MON] - 200, ...recorded.map((r) => r.at)], ({ ids }) => shown.push(ids));
    const equal = shown.slice(1).filter((ids, i) => ids.join(' ') === recorded[i]!.rowIds.join(' ')).length;
    expect(equal).toBeGreaterThanOrEqual(294);
  });
});

/** The seed's scenes C to G, every 2 s from 05:45:02.9Z to 05:48:00Z of their day. */
interface Scene { label: string; day: typeof TUE | typeof MON; closures: boolean; event?: boolean; zetFrom?: typeof MON; edit?: (rows: NearbyRow[]) => NearbyRow[] }
const scenes: Scene[] = [
  { label: 'C: Tuesday with Monday\'s zet-rt snapshot (two ghost vehicles)', day: TUE, closures: true, zetFrom: MON },
  { label: 'D: Tuesday with the closures removed', day: TUE, closures: false, event: true, edit: (rows) => rows.filter((r) => r.kind !== 'closure') },
  { label: 'E: Tuesday without the event', day: TUE, closures: true, edit: (rows) => rows.filter((r) => r.id !== EVENT) },
  { label: 'F: Tuesday with a short event title', day: TUE, closures: true, edit: (rows) => rows.map((r) => (r.id === EVENT ? { ...r, title: 'Promocija kataloga' } : r)) },
  {
    label: 'G: Monday with the event moved to Monday 12:00', day: MON, closures: true,
    edit: (rows) => {
      const moved = rows.map((r) => (r.id === EVENT ? { ...r, atMs: Date.parse('2026-09-28T10:00:00Z') } : r));
      const timed = moved.filter((r) => r.kind !== 'departure' && !r.always).sort((a, b) => a.atMs! - b.atMs!);
      return [...moved.filter((r) => r.kind === 'departure'), ...timed, ...moved.filter((r) => r.always)];
    },
  },
];

describe('the seed\'s scenes C to G', () => {
  it.each(scenes)('$label: three departures at every instant', ({ day, closures, event, zetFrom, edit }) => {
    const from = Date.parse(`${day.slice(0, 10)}T05:45:02.9Z`);
    const to = Date.parse(`${day.slice(0, 10)}T05:48:00Z`);
    const times = Array.from({ length: Math.floor((to - from) / 2000) + 1 }, (_, i) => from + i * 2000);
    let instants = 0;
    loop({ inputs: fixture(day), fullAt: FULL_AT[day], ...(zetFrom ? { zetFrom: fixture(zetFrom).modules } : {}), ...(edit ? { edit } : {}) }, times, ({ at, ids, rows, host, measure }) => {
      instants += 1;
      const when = new Date(at).toISOString();
      expect(departuresOf(ids), when).toBe(3);
      if (closures) expect(CLOSURES.filter((id) => ids.includes(id)), when).toEqual(CLOSURES);
      if (event) {
        // Scene D: with no closure beside it, the event row is shown, its title at most two lines.
        expect(rows.some((r) => r.id === EVENT), when).toBe(true);
        expect(ids, when).toContain(EVENT);
        const title = host.querySelector<HTMLElement>(`li[data-id="${EVENT}"] .nearby-title`)!;
        expect(measure.lines(title), when).toBeLessThanOrEqual(EVENT_TITLE_MAX_LINES);
      }
    });
    expect(instants).toBe(times.length);
  });
});
