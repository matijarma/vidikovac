import { describe, expect, it } from 'vitest';
import {
  clusterLabel,
  clusterPills,
  createLineColours,
  NOSE_LENGTH_PX,
  NOSE_WIDTH_PX,
  pillChars,
  pillLabel,
  pillWidthPx,
  PILL_BASE_WIDTHS_PX,
  PILL_MAX_CHARS_CLUSTER,
  PILL_MAX_LINES,
  PILL_ROW_BREAK,
  type Cluster,
  type PillPoint,
  type Single,
} from '../../app/src/motion/pills';
import { MAP_PRESENTATIONS } from '../../app/src/map/presentation';
import { capsuleHalfPx, markRadiusPx, noseCentrePx, NOSE_TUCK_PX, outlineDistancePx, PILL_FIT_PAD_X, PILL_FIT_PAD_Y, PILL_HEIGHT_PX, PILL_LINE_HEIGHT_EM, PILL_LINE_HEIGHT_PX, PILL_TEXT_PX, pillHeightPx, pillRows, pillTextWidthPx, PLATE_RADIUS_PX } from '../../app/src/motion/pills';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The glyph advances of one PBF glyph range (the protobuf MapLibre reads:
 *  glyphs.stacks[1].glyphs[3] { id 1, advance 7 }), by code point. */
function glyphAdvances(path: string): Map<number, number> {
  const buf = readFileSync(path);
  const out = new Map<number, number>();
  const walk = (start: number, end: number, visit: (field: number, wire: number, at: number, next: number) => void): void => {
    let pos = start;
    const varint = (): number => { let r = 0, shift = 0, byte = 0; do { byte = buf[pos++]!; r += (byte & 0x7f) * 2 ** shift; shift += 7; } while (byte & 0x80); return r; };
    while (pos < end) {
      const key = varint();
      const field = key >> 3, wire = key & 7;
      if (wire === 0) { const at = pos; varint(); visit(field, wire, at, pos); }
      else if (wire === 2) { const n = varint(); visit(field, wire, pos, pos + n); pos += n; }
      else if (wire === 5) pos += 4;
      else pos += 8;
    }
  };
  const readVarint = (at: number): number => { let r = 0, shift = 0, byte = 0, pos = at; do { byte = buf[pos++]!; r += (byte & 0x7f) * 2 ** shift; shift += 7; } while (byte & 0x80); return r; };
  walk(0, buf.length, (f1, w1, s1, e1) => {
    if (f1 !== 1 || w1 !== 2) return;
    walk(s1, e1, (f2, w2, s2, e2) => {
      if (f2 !== 3 || w2 !== 2) return;
      let id = -1, advance = -1;
      walk(s2, e2, (f3, w3, s3) => { if (w3 === 0 && f3 === 1) id = readVarint(s3); if (w3 === 0 && f3 === 7) advance = readVarint(s3); });
      out.set(id, advance);
    });
  });
  return out;
}

describe('pillWidthPx / pillChars: the pill grows past four characters instead of clipping', () => {
  it('gives the four hand-tuned widths verbatim, then +7px per character up to the cluster cap', () => {
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
    // A wrapped hub label is as wide as its longer row.
    expect(pillChars('109\u00b7110\u00b7111\n112\u00b7113')).toBe(11);
  });

  it('is a line of the number taller for each further row, up to PILL_MAX_LINES (decision 23)', () => {
    expect(PILL_MAX_LINES).toBe(2);
    expect(PILL_ROW_BREAK).toBe('\n');
    // MapLibre's default text-line-height at the pill's 12 px, the line one row already sits in.
    expect(PILL_LINE_HEIGHT_EM).toBe(1.2);
    expect(PILL_LINE_HEIGHT_PX).toBeCloseTo(PILL_TEXT_PX * PILL_LINE_HEIGHT_EM, 12);
    expect(PILL_LINE_HEIGHT_PX + 2 * PILL_FIT_PAD_Y).toBeCloseTo(PILL_HEIGHT_PX, 12);
    expect(pillHeightPx(1)).toBe(PILL_HEIGHT_PX);
    expect(pillHeightPx(2)).toBeCloseTo(32.4, 12);
    expect(pillHeightPx(2)).toBeCloseTo(2 * PILL_LINE_HEIGHT_PX + 2 * PILL_FIT_PAD_Y, 12);
    // Never more rows than the cap, never fewer than one.
    expect(pillHeightPx(3)).toBe(pillHeightPx(2));
    expect(pillHeightPx(0)).toBe(PILL_HEIGHT_PX);
    expect(pillRows('6\u00b711')).toEqual(['6\u00b711']);
    expect(pillRows('109\u00b7110\n111')).toEqual(['109\u00b7110', '111']);
  });
});

describe('the capsule the city map draws: its number\u2019s glyphs plus the fit padding', () => {
  it('measures a label with the glyph advances of the font MapLibre shapes it in', () => {
    const advances = glyphAdvances(resolve(import.meta.dirname, '../../app/public/maps/fonts/Noto Sans Medium/0-255.pbf'));
    for (const ch of '0123456789\u00b7\u00a0ABCDEFGHIJKLMNOPQRSTUVWXYZ-') {
      expect(pillTextWidthPx(ch), ch).toBe((advances.get(ch.codePointAt(0)!)! * PILL_TEXT_PX) / 24);
    }
    expect(pillTextWidthPx('14')).toBe(13);
    expect(pillTextWidthPx('6\u00b711\u00b712')).toBe(5 * 6.5 + 2 * 3);
    // A route nobody knows writes one no-break space.
    expect(pillTextWidthPx('')).toBe(pillTextWidthPx('\u00a0'));
    // Two rows are as wide as the wider one: MapLibre centres the other under it.
    expect(pillTextWidthPx('109\u00b7110\u00b7111\n112\u00b7113')).toBe(pillTextWidthPx('109\u00b7110\u00b7111'));
  });

  it('lands one to four digits on the widths WP2-A measured through MapLibre\u2019s own text fit: 18, 24, 30.5 and 37, always 18 tall', () => {
    expect(['6', '14', '268', '1234'].map((label) => 2 * capsuleHalfPx(label).halfWidth)).toEqual([18, 24, 30.5, 37]);
    expect(capsuleHalfPx('').halfWidth).toBe(9);
    expect(capsuleHalfPx('6\u00b711\u00b712')).toEqual({ halfWidth: (5 * 6.5 + 2 * 3) / 2 + PILL_FIT_PAD_X, halfHeight: 9 });
  });

  it('draws a wrapped hub label a line taller and as wide as its wider row', () => {
    const hub = clusterLabel(Array.from({ length: 16 }, (_, i) => String(109 + i)));
    const { halfWidth, halfHeight } = capsuleHalfPx(hub);
    // Eight three-digit lines a row: 24 digits and 7 separators.
    expect(halfWidth).toBe((24 * 6.5 + 7 * 3) / 2 + PILL_FIT_PAD_X);
    expect(halfHeight).toBeCloseTo(pillHeightPx(2) / 2, 12);
  });
});

// The direction nose and the two-way arrows: the capsule stays upright in the
// viewport while the triangle turns with the heading, so the triangle's base
// has to meet the capsule's own outline along that heading (lane-w-e2e-2.md:
// the per-length table floated a vertical "6·7·8"'s arrows 14 to 21 px off).
describe('the nose meets its capsule on every heading', () => {
  /** Signed distance from (x, y) to a rounded rectangle centred on the origin, negative inside. */
  const sdRoundRect = (x: number, y: number, hw: number, hh: number, r: number): number => {
    const qx = Math.abs(x) - (hw - r), qy = Math.abs(y) - (hh - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  const HEADINGS = [0, 45, 90, 135, 180, 225, 270, 315];
  const digits = Array.from({ length: 40 }, (_, i) => '1234567890'.repeat(4).slice(0, i + 1));
  const clusters = Array.from({ length: 20 }, (_, i) => ['6', '11', '12', '14', '17', '101', '219', '268'].slice(0, (i % 8) + 1).join('\u00b7').slice(0, 40));
  // Wrapped hub labels (decision 23): two rows, from just past one row's budget to the full eighty characters.
  const wrapped = [11, 14, 16, 20].map((n) => clusterLabel(Array.from({ length: n }, (_, i) => String(109 + i))));
  const LABELS = ['', ...digits, ...clusters, ...wrapped, '6\u00b77\u00b78', 'K'];

  it('seats the triangle\u2019s base on the outline, within 2 px on the screen and never floating off, for the eight headings, labels of 1 to 40 characters and of two rows, plate and capsule, scale 1 and 2', () => {
    expect(wrapped.every((label) => pillRows(label).length === 2)).toBe(true);
    let worst = 0;
    for (const label of LABELS) {
      const { halfWidth, halfHeight } = capsuleHalfPx(label);
      for (const kind of ['tram', 'bus']) {
        for (const s of [1, 2]) {
          for (const heading of HEADINGS) {
            const d = noseCentrePx(label, kind, heading) * s;
            const ux = Math.sin((heading * Math.PI) / 180), uy = -Math.cos((heading * Math.PI) / 180);
            const at = (t: number) => sdRoundRect(t * ux, t * uy, halfWidth * s, halfHeight * s, markRadiusPx(kind) * s);
            const base = at(d - (NOSE_LENGTH_PX / 2) * s);
            const tip = at(d + (NOSE_LENGTH_PX / 2) * s);
            const where = `${kind} "${label}" @${heading} x${s}`;
            expect(base, where).toBeLessThanOrEqual(1e-9); // touching: never a strip of street between
            expect(base, where).toBeGreaterThanOrEqual(-2); // and never sunk into the capsule
            // The arrow stands out of the capsule: its tip well clear of the outline, whichever side it leaves by.
            expect(tip, where).toBeGreaterThan((NOSE_LENGTH_PX / 2) * s);
            worst = Math.max(worst, Math.abs(base));
          }
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(NOSE_TUCK_PX * 2 + 1e-9);
  });

  it('was the half-width alone before: the per-length table left a vertical "6\u00b77\u00b78" 21 px off the wall\u2019s capsule, and now it touches', () => {
    const table = (n: number) => (n <= 4 ? [12, 14, 17, 20][n - 1]! : 20 + (n - 4) * 3.5);
    const { halfWidth, halfHeight } = capsuleHalfPx('6\u00b77\u00b78');
    const s = 2;
    const gapAt = (centre: number, heading: number) => {
      const ux = Math.sin((heading * Math.PI) / 180), uy = -Math.cos((heading * Math.PI) / 180);
      const t = (centre - NOSE_LENGTH_PX / 2) * s;
      return sdRoundRect(t * ux, t * uy, halfWidth * s, halfHeight * s, PLATE_RADIUS_PX * s);
    };
    expect(gapAt(table(5), 0)).toBeCloseTo(21, 5);
    expect(gapAt(noseCentrePx('6\u00b77\u00b78', 'tram', 0), 0)).toBeCloseTo(-NOSE_TUCK_PX * s, 5);
  });

  it('measures the way out of a rounded rectangle through its sides and its corner arcs', () => {
    expect(outlineDistancePx(12, 9, 9, 90)).toBe(12);
    expect(outlineDistancePx(12, 9, 9, 0)).toBe(9);
    expect(outlineDistancePx(12, 9, 9, 180)).toBe(9);
    // 45 degrees through a capsule's round end: the point lies on the arc of radius 9 about (3, 0).
    const t = outlineDistancePx(12, 9, 9, 45);
    expect(Math.hypot(t * Math.SQRT1_2 - 3, t * Math.SQRT1_2)).toBeCloseTo(9, 9);
    // A plate is nearly its box.
    expect(outlineDistancePx(12, 9, 3, 45)).toBeLessThan(Math.hypot(9, 9));
    expect([markRadiusPx('tram'), markRadiusPx('bus'), markRadiusPx('other')]).toEqual([PLATE_RADIUS_PX, 9, 9]);
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

  it('wraps a hub past one row\u2019s forty characters onto a second row: a sixteen-line bus hub lists all sixteen, eight a row, never a count (decision 23)', () => {
    const hub = Array.from({ length: 16 }, (_, i) => String(109 + i));
    const label = clusterLabel(hub);
    expect(label).toBe('109·110·111·112·113·114·115·116\n117·118·119·120·121·122·123·124');
    expect(label).not.toMatch(/\+\d/);
    const rows = pillRows(label);
    expect(rows).toHaveLength(PILL_MAX_LINES);
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(PILL_MAX_CHARS_CLUSTER);
    // Every line, whole and in order: the rows break between two lines, never inside one.
    expect(label.split(/[·\n]/)).toEqual(hub);
    // Forty characters or fewer stay one row, as every tram cluster does.
    expect(clusterLabel(hub.slice(0, 10))).toBe(hub.slice(0, 10).join('·'));
    expect(clusterLabel(hub.slice(0, 10))).toHaveLength(39);
  });

  it('balances the two rows by their drawn width, the first the fuller on a tie', () => {
    const bus = (n: number) => Array.from({ length: n }, (_, i) => String(109 + i));
    // Eleven lines, 43 characters: six over five, not ten over one.
    expect(clusterLabel(bus(11))).toBe('109·110·111·112·113·114\n115·116·117·118·119');
    // Fifteen: eight over seven and seven over eight are as wide; the first row takes the extra line.
    expect(clusterLabel(bus(15))).toBe('109·110·111·112·113·114·115·116\n117·118·119·120·121·122·123');
    // Mixed lengths balance on what is drawn, not on the count of lines.
    const mixed = clusterLabel(['6', '11', '12', '14', '17', '101', '219', '268', '109', '110', '111', '112']);
    expect(mixed).toBe('6·11·12·14·17·101·109\n110·111·112·219·268');
    const [a, b] = pillRows(mixed).map(pillTextWidthPx);
    expect(Math.abs(a! - b!)).toBeLessThan(pillTextWidthPx('\u00b7109'));
  });

  it('writes twenty three-digit lines whole on two full rows, and only past the eighty characters keeps the whole lines the rows hold, never a count', () => {
    const bus = (n: number) => Array.from({ length: n }, (_, i) => String(109 + i));
    expect(clusterLabel(bus(20))).toBe(`${bus(10).join('·')}\n${bus(20).slice(10).join('·')}`);
    // Črnomerec, the committed data's one hub past two rows: 23 bus lines, 91 characters.
    const crnomerec = ['109', '117', '119', '120', '121', '122', '123', '124', '125', '126', '127', '128', '130', '131', '134', '135', '136', '137', '144', '146', '172', '176', '177'];
    const label = clusterLabel(crnomerec);
    expect(label).toBe('109·117·119·120·121·122·123·124·125·126\n127·128·130·131·134·135·136·137·144·146');
    expect(label).not.toMatch(/\+\d/);
    expect(label.split(/[·\n]/)).toEqual(crnomerec.slice(0, 20));
  });

  it('writes every bus hub of the committed stop table whole on two rows at most, Črnomerec alone past them', () => {
    const stops = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../app/public/data/stops.json'), 'utf8')) as { name: string; routes: string[] }[];
    const routes = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../app/src/data/zet-routes.json'), 'utf8')) as Record<string, { shortName: string; type: number }>;
    const hubs = new Map<string, Set<string>>();
    for (const stop of stops) {
      const lines = hubs.get(stop.name) ?? new Set<string>();
      for (const id of stop.routes) if (routes[id]?.type === 3) lines.add(routes[id]!.shortName);
      hubs.set(stop.name, lines);
    }
    const past: string[] = [];
    let wrapped = 0;
    for (const [name, lines] of hubs) {
      const label = clusterLabel([...lines]);
      if (pillRows(label).length > 1) wrapped++;
      if (label.split(/[·\n]/).length < lines.size) past.push(name);
    }
    // A name joining this list is a hub decision 23 no longer writes whole: the owner's call, not a test's.
    expect(past).toEqual(['Črnomerec']);
    expect(wrapped).toBeGreaterThan(20);
  });

  it('holds every line to one row, the first one too: an oversized single line is cut to forty characters, never emptied, and the next goes on the second row', () => {
    const long = 'K'.repeat(41);
    expect(clusterLabel([long, 'Z'])).toBe(`${'K'.repeat(PILL_MAX_CHARS_CLUSTER)}\nZ`);
    expect(clusterLabel([long])).toHaveLength(PILL_MAX_CHARS_CLUSTER);
    expect(pillLabel(long)).toBe('K'.repeat(PILL_MAX_CHARS_CLUSTER));
    // A real line, and a vehicle whose route nobody knows, pass through untouched.
    expect(pillLabel('6')).toBe('6');
    expect(pillLabel('')).toBe('');
    // The union-find's own cluster obeys the same cap.
    const groups = clusterPills([point('a', 0, 0, long), point('b', 5, 0, 'Z')], {});
    expect(groups).toHaveLength(1);
    const cluster = groups[0]!;
    if (!isCluster(cluster)) throw new Error('expected a cluster');
    for (const row of pillRows(cluster.label)) expect(row.length).toBeLessThanOrEqual(PILL_MAX_CHARS_CLUSTER);
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

