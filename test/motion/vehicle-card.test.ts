import { describe, expect, it } from 'vitest';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import type { XY } from '../../app/src/motion/geo';
import type { Drawn } from '../../app/src/motion/model';
import type { Network, Shape, Stop } from '../../app/src/motion/network';
import { cumulative } from '../../app/src/motion/polyline';
import { compassKey, describeVehicle } from '../../app/src/motion/vehicle-card';

function shapeOf(id: string, route: string, pts: XY[]): Shape {
  const cum = cumulative(pts);
  return { id, route, pts, cum, len: cum[cum.length - 1] };
}

/** Route '6' (a real ZET id, so routeName resolves its long name) running
 *  west to east with three stops; the last one is the terminus. */
function net(): Network {
  const shape = shapeOf('S6', '6', [{ x: 0, y: 0 }, { x: 3000, y: 0 }]);
  const stops: Stop[] = [
    { id: 'A', name: 'Črnomerec', p: { x: 0, y: 0 }, on: [{ shape: 0, s: 0 }] },
    { id: 'B', name: 'Trg bana Jelačića', p: { x: 1500, y: 0 }, on: [{ shape: 0, s: 1500 }] },
    { id: 'C', name: 'Sopot', p: { x: 3000, y: 0 }, on: [{ shape: 0, s: 3000 }] },
  ];
  return {
    version: 1, feedVersion: 'test',
    routes: new Map([['6', { short: '6', type: 0, rank: 1, shapes: [0] }]]),
    shapes: [shape], stops, diagram: { lines: [], box: [1, 1] }, nextStop: () => null,
  };
}

function drawn(over: Partial<Drawn> & { id: string }): Drawn {
  return { type: 0, p: { x: 1000, y: 0 }, heading: null, speed: 0, confidence: 1, onShape: 0, routeId: '6', ...over };
}

const i18n = createDefaultI18n('hr');

describe('describeVehicle', () => {
  it('names the line, the direction as the terminus of the shape it rides, and the route median delay in the shared word', () => {
    const card = describeVehicle(i18n, net(), drawn({ id: 'v1', heading: { x: 1, y: 0 } }), new Map([['6', 40]]));
    expect(card).toEqual({ line: '6 · Črnomerec-Sopot', direction: 'smjer Sopot', delay: 'kašnjenje linije: +40 s' });
  });
  it('reads "smjer nepoznat" at a standstill (heading null), whatever shape it is on', () => {
    const card = describeVehicle(i18n, net(), drawn({ id: 'v1', heading: null }), new Map([['6', 0]]));
    expect(card.direction).toBe('smjer nepoznat');
    expect(card.delay).toBe('kašnjenje linije: po redu');
  });
  it('falls back to a compass word when the heading is known but there is no shape terminus to name', () => {
    const free = describeVehicle(i18n, net(), drawn({ id: 'v1', onShape: null, heading: { x: 0, y: 1 } }), new Map());
    expect(free.direction).toBe('smjer sjever');
    expect(free.delay).toBe('kašnjenje linije nepoznato');
  });
  it('says the line is unknown when the fix carried no route', () => {
    const card = describeVehicle(i18n, net(), drawn({ id: 'v1', routeId: undefined, onShape: null }), new Map());
    expect(card.line).toBe('linija nepoznata');
  });
  it('speaks English too', () => {
    const en = createDefaultI18n('en');
    const card = describeVehicle(en, net(), drawn({ id: 'v1', heading: { x: 1, y: 0 } }), new Map([['6', -40]]));
    expect(card).toEqual({ line: '6 · Črnomerec-Sopot', direction: 'towards Sopot', delay: 'route delay: −40 s' });
  });
});

describe('compassKey', () => {
  it('rounds a plane heading (x east, y north) to eight points', () => {
    expect(compassKey({ x: 0, y: 1 })).toBe('N');
    expect(compassKey({ x: 1, y: 1 })).toBe('NE');
    expect(compassKey({ x: 1, y: 0 })).toBe('E');
    expect(compassKey({ x: 1, y: -1 })).toBe('SE');
    expect(compassKey({ x: 0, y: -1 })).toBe('S');
    expect(compassKey({ x: -1, y: -1 })).toBe('SW');
    expect(compassKey({ x: -1, y: 0 })).toBe('W');
    expect(compassKey({ x: -1, y: 1 })).toBe('NW');
  });
});
