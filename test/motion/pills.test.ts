import { describe, expect, it } from 'vitest';
import {
  clusterLabel,
  clusterPills,
  createLineColours,
  NOSE_LENGTH_PX,
  NOSE_WIDTH_PX,
  pillChars,
  pillImageId,
  pillWidthPx,
  PILL_BASE_WIDTHS_PX,
  PILL_MAX_CHARS_CLUSTER,
  type Cluster,
  type PillPoint,
  type Single,
} from '../../app/src/motion/pills';
import { MAP_PRESENTATIONS } from '../../app/src/map/presentation';

describe('pillWidthPx / pillChars: the pill grows past four characters instead of clipping', () => {
  it('gives the four hand-tuned widths verbatim, then +7px per character up to the cluster cap, mapping onto the SDF image ids', () => {
    expect(PILL_BASE_WIDTHS_PX.map((_, i) => pillWidthPx(i + 1))).toEqual(PILL_BASE_WIDTHS_PX);
    expect(pillWidthPx(5)).toBe(45);
    // The widest capsule: forty characters, the hard cap. All fifteen tram
    // lines together are thirty-five, so every tram cluster fits whole.
    expect(PILL_MAX_CHARS_CLUSTER).toBe(40);
    expect(pillWidthPx(PILL_MAX_CHARS_CLUSTER)).toBe(290);
    // '' counts as one character (route unknown takes the smallest pill); anything past the
    // cluster cap (a label no clusterLabel writes) clamps to it rather than growing forever.
    expect(pillChars('')).toBe(1);
    expect(pillChars('109·113·119·120·121')).toBe(19); // an everyday bus cluster, written whole
    expect(pillChars('23-characters-is-no-cap')).toBe(23); // once the old cap, now an ordinary pill
    const past = '1234567890'.repeat(4) + '12345'; // 45 characters, past the cap
    expect(pillChars(past)).toBe(PILL_MAX_CHARS_CLUSTER);
    expect(pillWidthPx(pillChars(past))).toBe(290);
    expect(pillImageId(3)).toBe('vehicle-pill-3');
    expect(pillImageId(3, true)).toBe('vehicle-plate-3');
  });
});

describe('clusterLabel: distinct labels, numeric order, never folded', () => {
  it('lists every line, numbers ascending then letters, joined by "·", with no "+n" tail [O-35]', () => {
    expect(clusterLabel(['12', '6', '6', '11'])).toBe('6·11·12');
    expect(clusterLabel(['14', '6', '12', 'K', '11', '221'])).toBe('6·11·12·14·221·K');
    // Moved from test/city/readable.test.ts: one line is its own name, and
    // the everyday bus cluster is written whole, not bounded to a summary.
    expect(clusterLabel(['6'])).toBe('6');
    expect(clusterLabel(['109', '113', '119', '120', '121'])).toBe('109·113·119·120·121');
  });

  it('writes all fifteen tram lines whole: 35 characters, inside the cap', () => {
    const trams = ['17', '15', '14', '13', '12', '11', '9', '8', '7', '6', '5', '4', '3', '2', '1'];
    const label = clusterLabel(trams);
    expect(label).toBe('1·2·3·4·5·6·7·8·9·11·12·13·14·15·17');
    expect(label).toHaveLength(35);
    expect(pillChars(label)).toBe(label.length);
  });

  it('past the 40-character cap keeps the whole lines that fit and drops the rest, never a count', () => {
    const hub = Array.from({ length: 16 }, (_, i) => String(109 + i));
    const label = clusterLabel(hub);
    expect(label).toBe('109·110·111·112·113·114·115·116·117·118');
    expect(label.length).toBeLessThanOrEqual(PILL_MAX_CHARS_CLUSTER);
    expect(label).not.toMatch(/\+/);
    // Every name in it is a whole line of the cluster, never a number cut short.
    for (const line of label.split('·')) expect(hub).toContain(line);
  });

  it('is the same on every surface: no presentation profile carries a cluster budget of its own', () => {
    for (const [name, profile] of Object.entries(MAP_PRESENTATIONS)) {
      expect(profile, name).not.toHaveProperty('clusterMaxNumbers');
    }
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

describe('the nose: one triangle for the city map’s SDF image and the schema’s two-way arrows', () => {
  it('is 8 px long along the direction of travel and 9 px wide across it, as the city map has always drawn it', () => {
    expect([NOSE_LENGTH_PX, NOSE_WIDTH_PX]).toEqual([8, 9]);
  });
});

