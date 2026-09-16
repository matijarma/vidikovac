// A tiny hand-built artefact in the exact wire shape scripts/gtfs-shapes.mjs
// produces at version 2, shared by network.test.ts and graph.test.ts.
// Geometry: tram route R1 whose shape S1 runs two edges, E0 east from (0,0)
// to (3,0) units and E1 north from (3,0) to (3,2); bus route RB whose shape
// B1 is a plain polyline from (10,10) to (14,10); one synthetic path over E1.
// Every lon/lat is derived from its integer units through the same
// arithmetic the decoder uses, so comparisons are exact.
export const ORIGIN: [number, number] = [16, 45.8];
export const SCALE = 0.0001;

export const unitLonLat = (x: number, y: number): [number, number] => [ORIGIN[0] + x * SCALE, ORIGIN[1] + y * SCALE];

export const E0_LONLAT: [number, number][] = [unitLonLat(0, 0), unitLonLat(3, 0)];
export const E1_LONLAT: [number, number][] = [unitLonLat(3, 0), unitLonLat(3, 2)];
export const B1_LONLAT: [number, number][] = [unitLonLat(10, 10), unitLonLat(14, 10)];

export function rawArtefactV2() {
  return {
    version: 2,
    feedVersion: '000123',
    origin: ORIGIN,
    scale: SCALE,
    routes: { id: ['R1', 'RB'], short: ['1', '101'], type: [0, 3], rank: [1, 2], shapes: [[0], [1]] },
    // E1 is chained on from E0's end: its first pair is a zero delta.
    edges: { from: [0, 1], to: [1, 2], d: [[0, 0, 3, 0], [0, 0, 0, 2]] },
    shapes: { id: ['S1', 'B1'], route: ['R1', 'RB'], dir: [0, -1], d: [[], [10, 10, 4, 0]], e: [[0, 1], []], len: [999.9, 888.8] },
    paths: { id: ['path:R1:1:deadbeef'], route: ['R1'], dir: [1], e: [[1]], stops: [['B', 'C']] },
    stops: {
      id: ['A', 'B', 'C', 'D'],
      name: ['Stop A', 'Stop B', 'Stop C', 'Stop D'],
      p: [[0, 0], [0, 0], [0, 0], [10, 10]], // chain across the whole array
      on: [[], [], [], [[1, 250]]], // bus-shape links [dShapeIdx, frac * 500]
      onEdge: [[[0, 47]], [[1, 100]], [[1, 150]], []], // tram-edge links [dEdgeIdx, decimetres]
    },
    diagram: { lines: { route: ['R1'], pts: [[[0, 0], [1, 0.5]]] }, box: [1, 1] },
  };
}
