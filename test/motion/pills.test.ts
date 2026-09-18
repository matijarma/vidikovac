import { describe, expect, it } from 'vitest';
import {
  clusterLabel,
  clusterPills,
  createLineColours,
  pillChars,
  pillImageId,
  pillWidthPx,
  PILL_BASE_WIDTHS_PX,
  PILL_MAX_CHARS_CLUSTER,
  type Cluster,
  type PillPoint,
  type Single,
} from '../../app/src/motion/pills';

describe('pillWidthPx / pillChars: the pill grows past four characters instead of clipping', () => {
  it('gives the four hand-tuned widths verbatim, then +7px per character up to the cluster cap, mapping onto the SDF image ids', () => {
    expect(PILL_BASE_WIDTHS_PX.map((_, i) => pillWidthPx(i + 1))).toEqual(PILL_BASE_WIDTHS_PX);
    expect(pillWidthPx(5)).toBe(45);
    expect(pillWidthPx(PILL_MAX_CHARS_CLUSTER)).toBe(108);
    // '' counts as one character (route unknown takes the smallest pill); anything past the
    // cluster cap (a run-on "+n" label) clamps to it rather than growing forever.
    expect(pillChars('')).toBe(1);
    expect(pillChars('123456789012345678')).toBe(PILL_MAX_CHARS_CLUSTER);
    expect(pillWidthPx(pillChars('123456789012345678'))).toBe(108);
    expect(pillImageId(3)).toBe('vehicle-pill-3');
    expect(pillImageId(3, true)).toBe('vehicle-plate-3');
  });
});

describe('clusterLabel: distinct labels, numeric order, capped at four', () => {
  it('sorts numbers before text, numerically, and caps the display at four with a +n tail', () => {
    expect(clusterLabel(['12', '6', '6', '11'])).toBe('6·11·12');
    expect(clusterLabel(['14', '6', '12', 'K', '11', '221'])).toBe('6·11·12·14 +2');
  });
});

type Point = PillPoint;

function point(id: string, x: number, y: number, label: string): Point {
  return { id, x, y, label };
}

function isCluster<T extends PillPoint>(g: Single<T> | Cluster<T>): g is Cluster<T> {
  return g.kind === 'cluster';
}

describe('clusterPills: union-find over overlapping pill boxes', () => {
  it('joins two overlapping pills into one cluster, labelled with both and centred on their midpoint', () => {
    const a = point('a', 0, 0, '6');
    const b = point('b', 15, 0, '11');
    const groups = clusterPills([a, b], {});
    expect(groups).toHaveLength(1);
    const cluster = groups[0]!;
    expect(isCluster(cluster)).toBe(true);
    if (!isCluster(cluster)) throw new Error('expected a cluster');
    expect(cluster.label).toBe('6·11');
    expect(cluster.members.map((m) => m.id).sort()).toEqual(['a', 'b']);
    expect(cluster.x).toBe(7.5);
    expect(cluster.y).toBe(0);
  });

  it('joins a transitive chain (A touches B, B touches C, A does not touch C) into one cluster of three', () => {
    const a = point('a', 0, 0, '6');
    const b = point('b', 15, 0, '6');
    const c = point('c', 30, 0, '6');
    const groups = clusterPills([a, b, c], {});
    expect(groups).toHaveLength(1);
    const cluster = groups[0]!;
    if (!isCluster(cluster)) throw new Error('expected a cluster');
    expect(cluster.members.map((m) => m.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('leaves two pills far apart as two singles', () => {
    const a = point('a', 0, 0, '6');
    const b = point('b', 500, 0, '11');
    const groups = clusterPills([a, b], {});
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.kind === 'single')).toBe(true);
  });

  it('never absorbs the selected vehicle into a cluster, even when its box overlaps another pill', () => {
    const a = point('a', 0, 0, '6');
    const b = point('b', 15, 0, '11');
    const groups = clusterPills([a, b], { selectedId: 'a' });
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.kind === 'single')).toBe(true);
    const selected = groups.find((g) => g.kind === 'single' && g.point.id === 'a');
    expect(selected).toBeDefined();
  });
});

describe('createLineColours: the ZET colour table with a fallback', () => {
  it('returns the table colour for a known route id, else the fallback', () => {
    const lineColour = createLineColours({ '6': '#0751bf', '11': '#b8731a' });
    expect(lineColour('6', '#000000')).toBe('#0751bf');
    expect(lineColour('99', '#000000')).toBe('#000000');
    expect(lineColour(undefined, '#000000')).toBe('#000000');
  });
});

