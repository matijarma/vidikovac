// The heatmap "Sve linije, svaki sat" (app/src/snimka/heatmap.ts): an hour's
// cell is the mean of its ratios min(1, seen/expected), the same rule as
// route-series.ts hourMeans; an hour with nothing scheduled is hatched, an
// hour with nothing recorded blank (never a zero); trams, then the bus lines
// that ran in the strike, then one aggregate row of the rest; the table twin
// has one row per line and one column per day; a row's button sets the subject.
import { Window } from 'happy-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoutesFile } from '../../shared/snimka';
import { encodeBase64, ROUTES_MISSING } from '../../shared/snimka-codec';
import { createReplayClock } from '../../app/src/snimka/clock';
import { createViewStore, type SnimkaContext } from '../../app/src/snimka/context';
import { cellText, dayTable, heatmapModel, hourCells, mountHeatmap, rampStep } from '../../app/src/snimka/heatmap';
import { hourMeans } from '../../app/src/snimka/route-series';
import { MARKS, buildRoutes } from '../../e2e/snimka-fixtures';

const routes = buildRoutes();

/** A two-route file of `hours` hours from the window start, rows given as byte arrays. */
function file(rows: { id: string; type: 0 | 3; seen: number[]; expected: number[] }[]): RoutesFile {
  return {
    v: 2, t0: routes.t0, step: 300, n: rows[0]!.seen.length, net: '396+395',
    routes: rows.map((r) => ({ id: r.id, shortName: r.id, type: r.type })),
    seen: rows.map((r) => encodeBase64(Uint8Array.from(r.seen))),
    expected: rows.map((r) => encodeBase64(Uint8Array.from(r.expected))),
  };
}
const twelve = (v: number): number[] => new Array<number>(12).fill(v);

describe('hourCells', () => {
  it('means the ratios capped at one, hatches an hour with nothing scheduled, leaves an hour with nothing recorded blank', () => {
    const seen = [...twelve(2), ...twelve(0), ...twelve(ROUTES_MISSING), ...[5, 5, 5, 5, 5, 5, 0, 0, 0, 0, 0, 0]];
    const expected = [...twelve(4), ...twelve(0), ...twelve(ROUTES_MISSING), ...twelve(4)];
    const f = file([{ id: '6', type: 0, seen, expected }]);
    const cells = hourCells(f.n, (j) => (seen[j] === ROUTES_MISSING || expected[j] === ROUTES_MISSING ? null : { s: seen[j]!, e: expected[j]! }));
    expect(cells.cells).toEqual([0.5, 'off', null, 0.5]);
    expect(cells.seen).toEqual([2, 0, null, 2.5]);
    expect(cells.expected).toEqual([4, 0, null, 4]);
    // The numbers agree with V2's hourMeans wherever a ratio exists.
    expect(hourMeans(f, '6')).toEqual([0.5, null, null, 0.5]);
  });
  it('agrees with hourMeans on every line of the fixture', () => {
    const model = heatmapModel(routes);
    for (const row of [...model.trams, ...model.strike, ...model.others]) {
      const means = hourMeans(routes, row.id);
      row.cells.forEach((c, h) => {
        if (typeof c === 'number') expect(c).toBeCloseTo(means[h]!, 10);
        else expect(means[h]).toBeNull();
      });
    }
  });
});

describe('heatmapModel', () => {
  const model = heatmapModel(routes);
  it('has 112 hour columns, the 19 trams, the three strike buses and the aggregate of the other ten', () => {
    expect(model.hours).toBe(112);
    expect(model.trams).toHaveLength(19);
    expect(model.trams.every((r) => r.kind === 'tram')).toBe(true);
    expect(model.strike.map((r) => r.id).sort()).toEqual(['116', '217', '228']);
    expect(model.others).toHaveLength(10);
    expect(model.aggregate!.label).toBe('Ostale autobusne linije (10), zajedno');
    expect(model.aggregate!.cells).toHaveLength(112);
  });
  it('the frame gap of Tuesday 03:00 is not a zero, and the night is hatched for the day trams', () => {
    const h = (sec: number): number => Math.floor((sec - model.t0) / 3600);
    const tram = model.trams.find((r) => r.id === '6')!;
    // The gap is five minutes of a twelve-sample hour: the hour keeps a value from its other samples.
    expect(typeof tram.cells[h(MARKS.frameGapFrom)] === 'number' || tram.cells[h(MARKS.frameGapFrom)] === 'off').toBe(true);
    expect(tram.cells[h(MARKS.monday0745 - 5 * 3600)]).toBe('off'); // Monday 02:45: no day tram scheduled
    expect(tram.cells[h(MARKS.thursday0745)]).toBeGreaterThan(0.9);
    expect(tram.cells[h(MARKS.monday0745)]).toBe(0);
  });
  it('the aggregate sums the other lines per sample before the ratio', () => {
    const f = file([
      { id: '6', type: 0, seen: twelve(1), expected: twelve(1) },
      { id: '300', type: 3, seen: twelve(0), expected: twelve(4) },
      { id: '301', type: 3, seen: twelve(0), expected: twelve(0) },
    ]);
    const m = heatmapModel(f, { from: f.t0 + 7200, to: f.t0 + 9000 });
    expect(m.strike).toHaveLength(0);
    expect(m.aggregate!.cells).toEqual([0]);
    expect(m.aggregate!.expected).toEqual([4]);
  });
});

describe('ramp, tip and table twin', () => {
  it('steps by quarters and keeps a sliver of service off the empty step', () => {
    expect([0, 0.01, 0.25, 0.26, 0.5, 0.75, 0.76, 1].map(rampStep)).toEqual([0, 1, 1, 2, 2, 3, 4, 4]);
  });
  it('a cell tip names the line, the day and the hour with its counts, or the word for a hatched or blank hour', () => {
    const model = heatmapModel(routes);
    const row = model.strike.find((r) => r.id === '228')!;
    const h = Math.floor((MARKS.line228 + 2.5 * 3600 - model.t0) / 3600);
    expect(cellText(model, row, h)).toMatch(/^linija 228, uto 29\. 9\. u 12 h: \d+ od \d+$/);
    const hatched = { ...row, cells: row.cells.map(() => 'off' as const) };
    expect(cellText(model, hatched, h)).toBe('linija 228, uto 29. 9. u 12 h: ne vozi po voznom redu');
    const blank = { ...row, cells: row.cells.map(() => null) };
    expect(cellText(model, blank, h)).toBe('linija 228, uto 29. 9. u 12 h: bez podatka');
  });
  it('the twin is one row per line and one column per Zagreb day', () => {
    const model = heatmapModel(routes);
    const t = dayTable(model, [...model.trams, ...model.strike]);
    expect(t.head).toEqual(['Linija', 'ned 27. 9.', 'pon 28. 9.', 'uto 29. 9.', 'sri 30. 9.', 'čet 1. 10.', 'pet 2. 10.']);
    expect(t.body).toHaveLength(22);
    expect(t.body[0]![0]).toBe(model.trams[0]!.label);
    expect(t.body.every((r) => r.slice(1).every((c) => /^\d+ %$|^ne vozi po voznom redu$|^bez podatka$/.test(c)))).toBe(true);
  });
});

describe('mountHeatmap', () => {
  const DOM = ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'DOMRect'] as const;
  let page: Window | null = null;
  beforeAll(() => {
    page = new Window({ url: 'http://localhost/snimka/', width: 1366, height: 900 });
    const g = globalThis as Record<string, unknown>;
    for (const key of DOM) g[key] = key === 'window' ? page : (page as unknown as Record<string, unknown>)[key];
  });
  afterAll(async () => {
    const g = globalThis as Record<string, unknown>;
    for (const key of DOM) delete g[key];
    await page?.happyDOM.close();
  });
  it('draws one rect per known cell, row buttons that set the route subject, the rest behind a disclosure, and one twin', () => {
    const subs = new Set<(t: number) => void>();
    const view = createViewStore();
    const ctx = {
      routes, view, doc: document, clock: createReplayClock({ start: routes.t0 * 1000, end: (routes.t0 + routes.n * 300) * 1000, at: MARKS.monday0745 * 1000, now: () => 0 }),
      frames: { subscribe: (fn: (t: number) => void) => { subs.add(fn); return () => subs.delete(fn); }, kick() {}, destroy() {} },
    } as unknown as SnimkaContext;
    const root = document.createElement('div');
    document.body.append(root);
    const off = mountHeatmap(ctx, root);
    const box = root.querySelector<HTMLElement>('[data-sn-heatmap]')!;
    expect(box.dataset.snHeatmap).toBe('23');
    const svgs = root.querySelectorAll('svg.sn-hm-svg');
    expect(svgs).toHaveLength(2);
    const model = heatmapModel(routes);
    const known = [...model.trams, ...model.strike, model.aggregate!].reduce((a, r) => a + r.cells.filter((c) => c !== null).length, 0);
    expect(svgs[0]!.querySelectorAll('rect:not(.sn-hm-hatch-bg)')).toHaveLength(known);
    expect(svgs[0]!.querySelectorAll('rect.sn-hm-off').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('.sn-hm-more summary')[0]!.textContent).toBe('Prikaži sve autobusne linije');
    expect(root.querySelectorAll('details.st-table')).toHaveLength(1);
    root.querySelector<HTMLButtonElement>('.sn-hm-row[data-route="228"]')!.click();
    expect(view.get().subject).toEqual({ kind: 'route', id: '228' });
    for (const fn of subs) fn(MARKS.wednesday0745 * 1000);
    const x = Number(root.querySelector<HTMLElement>('.sn-hm-cursor')!.style.getPropertyValue('--x'));
    expect(x).toBeCloseTo((MARKS.wednesday0745 - routes.t0) / 3600 / 112, 4);
    off();
    expect(root.querySelector('[data-sn-heatmap]')).toBeNull();
  });
});
