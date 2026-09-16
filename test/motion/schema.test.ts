import { expect, it, vi } from 'vitest';
import {
  createSchemaPlacer, decodeSchema, matchSchemaPath, pointAt, tangentAt,
  type RawSchema,
} from '../../shared/motion/schema';
import { corridorSpec, straight, syntheticNetwork } from './synthetic-network';

/** A right-angle printed line: interpolation on its track differs visibly
 *  from the honest chord of a path which skips the middle stop. */
function artwork(): RawSchema {
  const stops = [
    { u: 0, name: 'A', ownCircle: true },
    { u: 100, name: 'B', ownCircle: false },
    { u: 200, name: 'C', ownCircle: true },
  ];
  return {
    version: 1, source: 'fixture.svg', builtAt: '2026-09-16', feedVersion: 'synthetic',
    box: [240, 160],
    lines: ['1', '2', '9', '109'].map((route) => ({
      route, night: false, colour: '#cc706f', width: 3.5,
      pts: [[10, 20], [110, 20], [110, 120]],
      stops: route === '9' ? [stops[2]] : stops.map((stop) => ({ ...stop })),
    })),
    stops: [
      { name: 'A', x: 10, y: 20, r: 2, half: null, terminal: true, label: { text: 'Stop A', rows: 1, x: 10, y: 12, rot: 0, anchor: 'start' } },
      { name: 'B', x: 110, y: 20, r: 2, half: 'D', terminal: false, label: { text: 'Stop\nB', rows: 2, x: 115, y: 12, rot: -Math.PI / 4, anchor: 'end' } },
      { name: 'C', x: 110, y: 120, r: 2, half: null, terminal: true, label: null },
    ],
    water: [
      { pts: [[0, 140], [240, 140]], width: 12, colour: '#738ec8' },
      { pts: [[150, 130], [160, 130], [150, 140], [150, 130]], width: 0, colour: '#738ec8' },
    ],
  };
}

it('places stop occurrences on forward/reverse legs, clamps termini, uses trackless chords and rejects unplaceable motion', () => {
  const raw = artwork();
  const unchanged = JSON.stringify(raw);
  const schema = decodeSchema(raw);
  expect(JSON.stringify(raw)).toBe(unchanged);
  expect(schema.lines[0]).toMatchObject({ pts: [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 120 }], cum: [0, 100, 200], len: 200 });
  expect(schema.stops).toEqual(raw.stops);
  expect(schema.water[0].pts).toEqual([{ x: 0, y: 140 }, { x: 240, y: 140 }]);
  expect(schema.water[1]).toMatchObject({ width: 0, pts: [{ x: 150, y: 130 }, { x: 160, y: 130 }, { x: 150, y: 140 }, { x: 150, y: 130 }] });
  expect(pointAt(schema.lines[0], -5)).toEqual({ x: 10, y: 20 });
  expect(pointAt(schema.lines[0], 900)).toEqual({ x: 110, y: 120 });
  expect(tangentAt(schema.lines[0], 150)).toEqual({ x: 0, y: 1 });
  for (const invalid of [
    null, { ...raw, version: 2 }, { ...raw, box: [0, 160] },
    { ...raw, lines: [{ ...raw.lines[0], pts: [[0, 0], [NaN, 2]] }] },
    { ...raw, lines: [{ ...raw.lines[0], stops: [...raw.lines[0].stops].reverse() }] },
    { ...raw, lines: [raw.lines[0], raw.lines[0]] },
    { ...raw, water: [{ ...raw.water[0], width: -1 }] },
  ]) expect(() => decodeSchema(invalid)).toThrow(/schema/i);

  const spec = corridorSpec();
  // The same printed A and B really are visited again on the return leg.
  // Nearby repeated associations are NOT extra visits.
  spec.stops = [
    { id: 'a', name: 'A', edge: 0, s: 100 },
    { id: 'a-other-platform', name: 'A', edge: 0, s: 110 },
    { id: 'b', name: 'B', edge: 0, s: 500 },
    { id: 'c', name: 'C', edge: 0, s: 1000 },
    { id: 'b-return', name: 'B', edge: 1, s: 300 },
    { id: 'a-return', name: 'A', edge: 1, s: 800 },
    { id: 'reverse-c', name: 'C', edge: 5, s: 100 },
    { id: 'reverse-b', name: 'B', edge: 5, s: 500 },
    { id: 'reverse-a', name: 'A', edge: 5, s: 1000 },
  ];
  // Direction_id intentionally agrees: the printed heading must not use it.
  spec.routes[0].paths![1].direction = 0;
  spec.edges.push({ from: 0, to: 7, pts: straight(0, 1000, -120) });
  spec.routes[1].paths![0].edges = [6];
  spec.stops.push({ id: 'short-a', name: 'A', edge: 6, s: 100 }, { id: 'short-c', name: 'C', edge: 6, s: 900 });
  // Even a bus erroneously handed a graph path must not paint as a tram.
  spec.routes[3].paths = [{ id: 'bus-path', direction: 0, edges: [0] }];
  const net = syntheticNetwork(spec);
  const path = (id: string): number => net.paths.findIndex((p) => p.id === id);
  const sourceStops = net.stopsOnPath(path('1_0'));
  sourceStops.splice(1, 0, sourceStops[0]); // the same Stop/arc associated twice
  const b = sourceStops[3];
  sourceStops.splice(4, 0,
    { stop: { ...b.stop, id: 'junction-alias', name: 'Unmatched junction alias' }, s: 505 },
    { stop: b.stop, s: 510 }, // same platform, another nearby edge projection
  );
  const originalStops = sourceStops.slice();
  const match = matchSchemaPath(schema, net, path('1_0'));
  expect(match).toMatchObject({ placeable: true, monotone: false, reason: null, collapsedAssociations: 3 });
  expect(match.unmatched.map((stop) => stop.name)).toEqual(['Unmatched junction alias']);
  expect(match.stops.map(({ name, s }) => [name, s])).toEqual([['A', 100], ['B', 500], ['C', 1000], ['B', 1800], ['A', 2300]]);
  expect(match.legs.map(({ sign, stops }) => [sign, stops.map((s) => s.u)])).toEqual([[1, [0, 100, 200]], [-1, [200, 100, 0]]]);
  expect(match.stops.at(-1)!.k).toBeGreaterThan(match.stops[0].k);
  expect(sourceStops).toEqual(originalStops); // no engine/network repair

  const lookups = vi.spyOn(net, 'stopsOnPath');
  const placer = createSchemaPlacer(schema, net);
  expect(placer.place(path('1_0'), 300)).toEqual({ x: 60, y: 20, track: { x: 1, y: 0 }, sign: 1, colour: '#cc706f', line: '1', chord: false });
  expect(placer.place(path('1_0'), 750)).toMatchObject({ x: 110, y: 70, sign: 1 });
  expect(placer.place(path('1_0'), 1400)).toMatchObject({ x: 110, y: 70, sign: -1 });
  expect(placer.place(path('1_0'), 2050)).toMatchObject({ x: 60, y: 20, sign: -1 });
  expect(placer.place(path('1_0'), -100)).toMatchObject({ x: 10, y: 20, sign: 1 });
  expect(placer.place(path('1_0'), 90_000)).toMatchObject({ x: 10, y: 20, sign: -1 });
  expect(lookups).toHaveBeenCalledTimes(1); // matched once, never per frame
  expect(placer.place(path('1_1'), 300)).toMatchObject({ x: 110, y: 70, sign: -1 });
  expect(placer.place(path('1_1'), -1)).toMatchObject({ x: 110, y: 120, sign: -1 });
  expect(placer.place(path('1_1'), 9999)).toMatchObject({ x: 10, y: 20, sign: -1 });
  const chord = placer.place(path('2_0'), 500);
  expect(chord).toEqual({ x: 60, y: 70, sign: 1, colour: '#cc706f', line: '2', chord: true });
  expect(chord).not.toHaveProperty('track');
  expect(matchSchemaPath(schema, net, path('path:9:0:abc'))).toMatchObject({ placeable: false, reason: 'too-few-stops' });
  for (const idx of [undefined, null, -1, 1.5, NaN, Infinity, 99_999, path('bus-path'), path('path:9:0:abc')]) {
    expect(placer.place(idx, 500)).toBeNull();
  }
  const busShape = net.shapes.findIndex((s) => s.id === 'B109');
  expect(placer.place(net.pathOfShape(busShape), 500)).toBeNull();
  for (const s of [undefined, null, NaN, Infinity, -Infinity]) expect(placer.place(path('1_0'), s)).toBeNull();
  expect(createSchemaPlacer({ ...schema, lines: [] }, net).place(0, 500)).toBeNull();

  // A label can occur at two artwork locations too. Sequence context must
  // choose A(0), then A(150), and the reverse path must choose them in reverse.
  const multi = artwork();
  multi.lines[0].stops.splice(2, 0, { name: 'A', u: 150, ownCircle: true });
  const multiSpec = corridorSpec();
  multiSpec.routes[0].paths![0].edges = [0];
  multiSpec.stops = [
    { id: 'a1', name: 'A', edge: 0, s: 100 }, { id: 'b1', name: 'B', edge: 0, s: 500 },
    { id: 'a2', name: 'A', edge: 0, s: 750 }, { id: 'c1', name: 'C', edge: 0, s: 1000 },
    { id: 'c2', name: 'C', edge: 5, s: 100 }, { id: 'a3', name: 'A', edge: 5, s: 500 },
    { id: 'b2', name: 'B', edge: 5, s: 750 }, { id: 'a4', name: 'A', edge: 5, s: 1000 },
  ];
  const multiNet = syntheticNetwork(multiSpec);
  const multiSchema = decodeSchema(multi);
  expect(matchSchemaPath(multiSchema, multiNet, 0).stops.map((s) => s.u)).toEqual([0, 100, 150, 200]);
  expect(matchSchemaPath(multiSchema, multiNet, 1).stops.map((s) => s.u)).toEqual([200, 150, 100, 0]);
  expect(createSchemaPlacer(multiSchema, multiNet).place(0, 750)).toMatchObject({ x: 110, y: 70, sign: 1, chord: false });
  const ambiguous = { ...multiNet, stopsOnPath: () => multiNet.stopsOnPath(0).slice(0, 2) };
  expect(matchSchemaPath(multiSchema, ambiguous, 0).reason).toBe('ambiguous-stops');
  expect(createSchemaPlacer(multiSchema, ambiguous).place(0, 300)).toBeNull();
  const zeroArc = { ...multiNet, stopsOnPath: () => multiNet.stopsOnPath(0).slice(0, 2).map((entry) => ({ ...entry, s: 100 })) };
  expect(matchSchemaPath(multiSchema, zeroArc, 0).reason).toBe('non-increasing-arc');
});
