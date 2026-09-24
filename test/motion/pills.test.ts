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
import { capsuleHalfPx, DEFLECT_GAIN, DEFLECT_MARGIN_PX, DEFLECT_MAX_PX, deflectMarks, markRadiusPx, noseCentrePx, NOSE_TUCK_PX, outlineDistancePx, PILL_FIT_PAD_X, PILL_FIT_PAD_Y, PILL_HEIGHT_PX, PILL_LINE_HEIGHT_PX, PILL_TEXT_PX, pillHeightPx, pillRows, pillTextWidthPx, PLATE_RADIUS_PX, type DeflectableMark } from '../../app/src/motion/pills';
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
    expect(PILL_MAX_LINES).toBe(3);
    expect(PILL_ROW_BREAK).toBe('\n');
    // MapLibre's default text-line-height (1.2 em, overlays.ts) at the pill's 12 px, the line one row already sits in.
    expect(PILL_LINE_HEIGHT_PX).toBeCloseTo(PILL_TEXT_PX * 1.2, 12);
    expect(PILL_LINE_HEIGHT_PX + 2 * PILL_FIT_PAD_Y).toBeCloseTo(PILL_HEIGHT_PX, 12);
    expect(pillHeightPx(1)).toBe(PILL_HEIGHT_PX);
    expect(pillHeightPx(2)).toBeCloseTo(32.4, 12);
    expect(pillHeightPx(2)).toBeCloseTo(2 * PILL_LINE_HEIGHT_PX + 2 * PILL_FIT_PAD_Y, 12);
    expect(pillHeightPx(3)).toBeCloseTo(46.8, 12);
    expect(pillHeightPx(3)).toBeCloseTo(3 * PILL_LINE_HEIGHT_PX + 2 * PILL_FIT_PAD_Y, 12);
    expect(pillRows('6\u00b711')).toEqual(['6\u00b711']);
    expect(pillRows('109\u00b7110\n111')).toEqual(['109\u00b7110', '111']);
    expect(pillRows('109\u00b7110\n111\n112')).toEqual(['109\u00b7110', '111', '112']);
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
  // Wrapped hub labels (decision 23): two rows from just past one row's budget to the full eighty
  // characters, then three rows up to thirty three-digit lines.
  const wrapped = [11, 14, 16, 20, 21, 23, 30].map((n) => clusterLabel(Array.from({ length: n }, (_, i) => String(109 + i))));
  const LABELS = ['', ...digits, ...clusters, ...wrapped, '6\u00b77\u00b78', 'K'];

  it('seats the triangle\u2019s base on the outline, within 2 px on the screen and never floating off, for the eight headings, labels of 1 to 40 characters and of two and three rows, plate and capsule, scale 1 and 2', () => {
    expect(wrapped.map((label) => pillRows(label).length)).toEqual([2, 2, 2, 2, 3, 3, 3]);
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
    expect(rows).toHaveLength(2);
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

  it('balances three rows by their drawn width, the earlier rows the fuller on a tie (decision 23)', () => {
    const bus = (n: number) => Array.from({ length: n }, (_, i) => String(109 + i));
    // Twenty-one three-digit lines are 83 characters: past two rows of forty, so seven a row.
    expect(clusterLabel(bus(21))).toBe(`${bus(7).join('·')}\n${bus(14).slice(7).join('·')}\n${bus(21).slice(14).join('·')}`);
    // Twenty-two: eight, seven, seven; twenty-three: eight, eight, seven.
    expect(pillRows(clusterLabel(bus(22))).map((row) => row.split('·').length)).toEqual([8, 7, 7]);
    expect(pillRows(clusterLabel(bus(23))).map((row) => row.split('·').length)).toEqual([8, 8, 7]);
    // Mixed lengths balance on what is drawn, not on the count of lines.
    const mixed = clusterLabel(['6', '11', '12', '14', '17', '101', '219', '268', ...bus(15)]);
    expect(mixed).toBe('6·11·12·14·17·101·109·110·111\n112·113·114·115·116·117·118\n119·120·121·122·123·219·268');
    const widths = pillRows(mixed).map(pillTextWidthPx);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(pillTextWidthPx('\u00b7109'));
  });

  it('writes twenty three-digit lines on two full rows and thirty on three, and only past the 120 characters keeps the whole lines the rows hold, never a count', () => {
    const bus = (n: number) => Array.from({ length: n }, (_, i) => String(109 + i));
    expect(clusterLabel(bus(20))).toBe(`${bus(10).join('·')}\n${bus(20).slice(10).join('·')}`);
    const thirty = `${bus(10).join('·')}\n${bus(20).slice(10).join('·')}\n${bus(30).slice(20).join('·')}`;
    expect(clusterLabel(bus(30))).toBe(thirty);
    // Thirty-one lines are 123 characters: the first thirty are kept, whole and in order.
    expect(clusterLabel(bus(31))).toBe(thirty);
    expect(clusterLabel(bus(31))).not.toMatch(/\+\d/);
    // Črnomerec, the committed data's largest hub: 23 bus lines, 91 characters, all of them on three rows.
    const crnomerec = ['109', '117', '119', '120', '121', '122', '123', '124', '125', '126', '127', '128', '130', '131', '134', '135', '136', '137', '144', '146', '172', '176', '177'];
    const label = clusterLabel(crnomerec);
    expect(label).toBe('109·117·119·120·121·122·123·124\n125·126·127·128·130·131·134·135\n136·137·144·146·172·176·177');
    expect(label).not.toMatch(/\+\d/);
    expect(label.split(/[·\n]/)).toEqual(crnomerec);
  });

  it('writes every bus hub of the committed stop table whole on three rows at most, Črnomerec the largest and the only one on three', () => {
    const stops = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../app/public/data/stops.json'), 'utf8')) as { name: string; routes: string[] }[];
    const routes = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../app/src/data/zet-routes.json'), 'utf8')) as Record<string, { shortName: string; type: number }>;
    const hubs = new Map<string, Set<string>>();
    for (const stop of stops) {
      const lines = hubs.get(stop.name) ?? new Set<string>();
      for (const id of stop.routes) if (routes[id]?.type === 3) lines.add(routes[id]!.shortName);
      hubs.set(stop.name, lines);
    }
    const past: string[] = [];
    const threeRows: string[] = [];
    let wrapped = 0;
    let largest = { name: '', chars: 0 };
    for (const [name, lines] of hubs) {
      const label = clusterLabel([...lines]);
      const rows = pillRows(label).length;
      if (rows > 1) wrapped++;
      if (rows === 3) threeRows.push(name);
      if (label.split(/[·\n]/).length < lines.size) past.push(name);
      const chars = [...lines].join('·').length;
      if (chars > largest.chars) largest = { name, chars };
    }
    // A name joining this list is a hub decision 23 no longer writes whole: the owner's call, not a test's.
    expect(past).toEqual([]);
    expect(threeRows).toEqual(['Črnomerec']);
    expect(largest).toEqual({ name: 'Črnomerec', chars: 91 });
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


// Round 2, F6 (phone lane's handoff): at the frame zoom half the BAJS discs sat under vehicle pills (26 of 53 on
// the framed wall at 22:32, 21 of 41 on the phone's Karta at z12.7), and a tram standing at a stop covered the
// station's count for a minute at a time. A mark now steps aside for a disc's number, and a bus pill for a tram's
// plate: up or down the screen, by the smallest hop past everything in its way, ramped so it never jumps.
describe('deflectMarks: a mark steps aside for a disc\u2019s number and for a mark placed before it', () => {
  const tram = (id: string, x: number, y: number, bearing: number | null = 0, label = '6'): DeflectableMark => ({ id, x, y, label, kind: 'tram', bearing });
  const bus = (id: string, x: number, y: number, bearing: number | null = 90, label = '109'): DeflectableMark => ({ id, x, y, label, kind: 'bus', bearing });
  /** The distance from a disc's centre to the nearest point of a mark's capsule as drawn (capsuleHalfPx). */
  const clearance = (mark: DeflectableMark, at: { x: number; y: number }, disc: { x: number; y: number; r: number }): number => {
    const { halfWidth, halfHeight } = capsuleHalfPx(mark.label);
    const spine = Math.max(0, halfWidth - halfHeight);
    const dx = Math.max(0, Math.abs(disc.x - at.x) - spine);
    return Math.hypot(dx, disc.y - at.y) - halfHeight - disc.r;
  };
  const disc = { x: 100, y: 100, r: 11 };
  /** Half the plate, the disc and the margin: the hop that clears a disc under the plate's middle. */
  const clear = PILL_HEIGHT_PX / 2 + 11 + DEFLECT_MARGIN_PX;

  it('a plate dead on a disc steps ahead of it: up for a north-bound tram, down for a south-bound one, by what clears the number and a margin', () => {
    const north = deflectMarks([tram('a', 100, 100, 0)], [disc]).get('a')!;
    expect(north.x).toBe(100);
    expect(north.y).toBeCloseTo(100 - clear, 6);
    expect(north.moved).toBeCloseTo(clear, 6);
    expect(clearance(tram('a', 100, 100, 0), north, disc)).toBeGreaterThanOrEqual(DEFLECT_MARGIN_PX - 1e-9);
    const south = deflectMarks([tram('b', 100, 100, 180)], [disc]).get('b')!;
    expect(south.y).toBeCloseTo(100 + clear, 6);
    // A wide hub label costs no more: the hop is across the capsule's height, never along its width.
    const hub = tram('h', 100, 100, 0, '1·2·3·4·5·6·7·8·9·11·12·13·14·17');
    const placedHub = deflectMarks([hub], [disc]).get('h')!;
    expect(placedHub.moved).toBeCloseTo(clear, 6);
    expect(clearance(hub, placedHub, disc)).toBeGreaterThanOrEqual(DEFLECT_MARGIN_PX - 1e-9);
  });

  it('a mark moving across the screen keeps to the side of the disc it is already on; one with no heading too; dead level it steps down', () => {
    const above = deflectMarks([tram('a', 100, 95, 90)], [disc]).get('a')!;
    expect(above.y).toBeLessThan(95);
    expect(clearance(tram('a', 100, 95, 90), above, disc)).toBeGreaterThanOrEqual(DEFLECT_MARGIN_PX - 1e-9);
    const below = deflectMarks([bus('b', 100, 104, 270)], [disc]).get('b')!;
    expect(below.y).toBeGreaterThan(104);
    const headless = deflectMarks([bus('c', 100, 98, null)], [disc]).get('c')!;
    expect(headless.y).toBeLessThan(98);
    expect(deflectMarks([bus('d', 100, 100, 90)], [disc]).get('d')!.y).toBeCloseTo(100 + clear, 6);
  });

  it('a mark that does not meet a disc, and a mark with no disc at all, stay exactly where the model put them', () => {
    const at = deflectMarks([tram('a', 100, 100 - clear - 0.01)], [disc]).get('a')!;
    expect(at).toMatchObject({ x: 100, y: 100 - clear - 0.01, moved: 0 });
    expect(deflectMarks([tram('a', 100, 100)], [])).toEqual(new Map([['a', { x: 100, y: 100, moved: 0 }]]));
  });

  it('is continuous: a north-bound plate sweeping through a disc steps ahead by a growing hop and settles back on its rail beyond it, never a jump', () => {
    const offsets: number[] = [];
    for (let t = 40; t >= -40; t -= 1) offsets.push(deflectMarks([tram('a', 100, 100 + t, 0)], [disc]).get('a')!.y - (100 + t));
    expect(offsets[0]).toBe(0);
    expect(offsets.at(-1)).toBe(0);
    // Deepest while still short of the centre (ahead of the disc means past it), the clearance itself at the centre.
    expect(Math.min(...offsets)).toBeLessThanOrEqual(-clear);
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(-2 * clear);
    expect(offsets[40]).toBeCloseTo(-clear, 6);
    // Always ahead (up), never flipped below.
    expect(Math.max(...offsets)).toBe(0);
    for (let i = 1; i < offsets.length; i++) expect(Math.abs(offsets[i]! - offsets[i - 1]!), `step ${i}`).toBeLessThanOrEqual(DEFLECT_GAIN + 1e-9);
    // A tram standing at the stop, dead on the station's disc: its plate just ahead of the disc, clear of the number.
    const standing = deflectMarks([tram('s', 100, 100, 0)], [disc]).get('s')!;
    expect(clearance(tram('s', 100, 100, 0), standing, disc)).toBeGreaterThanOrEqual(DEFLECT_MARGIN_PX - 1e-9);
  });

  it('hops past a pile of discs in its way, not into the next one, and stops at the cap', () => {
    // Hub stations twelve pixels apart under a north-bound plate: the hop clears the whole pile.
    const pile = [disc, { x: 100, y: 88, r: 11 }, { x: 100, y: 76, r: 11 }];
    const placed = deflectMarks([tram('a', 100, 100, 0)], pile).get('a')!;
    for (const d of pile) expect(clearance(tram('a', 100, 100, 0), placed, d), `disc at ${d.y}`).toBeGreaterThanOrEqual(DEFLECT_MARGIN_PX - 1e-9);
    expect(placed.moved).toBeCloseTo(24 + clear, 6);
    // A pile too deep to hop: the mark goes as far as the cap and keeps what it covers.
    const deep = Array.from({ length: 8 }, (_, i) => ({ x: 100, y: 100 - 12 * i, r: 11 }));
    expect(deflectMarks([tram('b', 100, 100, 0)], deep).get('b')!.moved).toBe(DEFLECT_MAX_PX);
  });

  it('a bus pill on a tram plate steps off it; the plate, placed first, stays; a plate pushed onto a neighbour pushes the neighbour on', () => {
    const marks = [bus('b', 100, 100, 90), tram('a', 100, 100, 0)];
    const placed = deflectMarks(marks, []);
    expect(placed.get('a')).toEqual({ x: 100, y: 100, moved: 0 });
    const b = placed.get('b')!;
    expect(b.x).toBe(100);
    expect(b.y).toBeCloseTo(100 + PILL_HEIGHT_PX + DEFLECT_MARGIN_PX, 6);
    // 'a' steps up off the disc onto 'c', placed after it, which steps up in turn by what they overlap.
    const c = tram('c', 100, 100 - clear - 4, 0, '11');
    const chain = deflectMarks([c, tram('a', 100, 100, 0)], [disc]);
    expect(chain.get('a')!.y).toBeCloseTo(100 - clear, 6);
    expect(chain.get('c')!.y).toBeLessThan(c.y);
    expect(chain.get('c')!.y).toBeCloseTo(chain.get('a')!.y - PILL_HEIGHT_PX - DEFLECT_MARGIN_PX, 6);
  });
});
