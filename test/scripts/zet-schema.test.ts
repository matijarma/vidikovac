import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { extractArtwork, identifyLines, matchStopName } from '../../scripts/zet-schema.mjs';
import { FEED_VERSION } from '../../app/src/motion/network-meta';
import { decodeNetwork } from '../../shared/motion/network';
import { createSchemaPlacer, decodeSchema, LOOP_PATH_DIRECTION, matchSchemaPath, pointAt } from '../../shared/motion/schema';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));

// Glyphs are deliberately placed as an exported PDF places them, including
// the unusable space transform. The two identically coloured lines must be
// distinguished by independent labels/badges, not by their paint.
const glyph = (char: string, x: number, y: number, colour = '#1a1a18', size = 7.92, rot = 0) => {
  const a = Math.cos(rot) * size, b = Math.sin(rot) * size;
  return `<use xlink:href="#font_0_${char.codePointAt(0)!.toString(16)}" fill="${colour}" transform="matrix(${a},${b},${b},${-a},${x},${y})"/>`;
};
const word = (text: string, x: number, y: number, colour = '#1a1a18', size = 7.92, rot = 0) =>
  [...text].map((c, i) => glyph(c, x + i * size * .6 * Math.cos(rot), y + i * size * .6 * Math.sin(rot), colour, size, rot)).join('');

describe('the ZET artwork build', () => {
  it('composes nested transforms, reads rotated labels, rejects decorative votes and requires a route/stroke bijection', () => {
    const svg = `<svg viewBox="0 0 200 150"><g transform="translate(10 10)">
      <g transform="scale(2)"><path stroke="#a69ccc" stroke-width="3.5345" fill="none" d="M 0 15 L 70 15"/>
      <path stroke="#a69ccc" stroke-width="3.5345" fill="none" d="M 0 25 L 70 25"/></g>
      <path stroke="#1a1a18" stroke-width=".3606" fill="none" transform="matrix(0,1,1,0,0,0)" d="M 28 20 C 28 21.1 28.9 22 30 22 C 31.1 22 32 21.1 32 20 C 32 18.9 31.1 18 30 18 C 28.9 18 28 18.9 28 20 Z"/>
      ${word('1', 25, 30, '#e5007d', 6)}${word('1', 100, 30, '#e5007d', 6)}
      ${word('2', 25, 50, '#e5007d', 6)}${word('2', 100, 50, '#e5007d', 6)}
      ${word('99', 60, 30, '#1a1a18', 6)}
      ${word('Trg', 20, 90, '#1a1a18', 7.92, -Math.PI / 4)}
      ${glyph(' ', 1e10, 1e10)}
      ${word('mira', 26, 96, '#1a1a18', 7.92, -Math.PI / 4)}
      ${word('3', 160, 120, '#e5007d', 6)}
    </g></svg>`;
    const art = extractArtwork(svg, { exclude: [[160, 110, 200, 150]] });
    expect(art.lines.map((l: any) => l.pts)).toEqual([[[10, 40], [150, 40]], [[10, 60], [150, 60]]]);
    expect(art.circles.some((c: any) => Math.abs(c.x - 30) < .01 && Math.abs(c.y - 40) < .01)).toBe(true);
    expect(art.badges.map((b: any) => b.text)).not.toContain('99');
    expect(art.badges.map((b: any) => b.text)).not.toContain('3');
    expect(art.labels.some((l: any) => l.text.replace(/\s+/g, ' ') === 'Trg mira' && l.rows === 2)).toBe(true);
    const routes = [
      { route: '1', termini: ['A', 'B'] },
      { route: '2', termini: ['C', 'D'] },
    ];
    const identified = identifyLines(art, routes, {
      routes: {
        '1': { colour: '#a69ccc', point: [50, 40], termini: [[10, 40], [150, 40]], reason: 'fixture A/B terminal positions' },
        '2': { colour: '#a69ccc', point: [50, 60], termini: [[10, 60], [150, 60]], reason: 'fixture C/D terminal positions' },
      },
    });
    expect(identified.map((l: any) => l.route)).toEqual(['1', '2']);
    expect(() => identifyLines(art, [...routes, { route: '3', termini: [] }], {})).toThrow();
    expect(matchStopName('Trg žrt. fašizma', 'Trg žrtava fašizma')).toBe(true);
    expect(matchStopName('Mihaljevac', 'Gračanski Mihaljevac')).toBe(false);
    expect(matchStopName('Svetice', 'Donje Svetice')).toBe(false);
  });

  it('ships a complete, feed-bound, compact artifact with finite page geometry and explicit stop coverage', () => {
    const path = resolve(root, 'app/public/data/zet-schema.json');
    const bytes = readFileSync(path);
    const schema = JSON.parse(bytes.toString('utf8'));
    const net = decodeNetwork(read('app/public/data/zet-network.json'));
    const overrides = read('scripts/zet-schema-overrides.json');
    expect(schema.feedVersion).toBe(FEED_VERSION);
    expect(schema.feedVersion).toBe(net.feedVersion);
    expect(new Set(schema.lines.map((l: any) => l.route))).toEqual(new Set([...net.routes].filter(([, r]) => r.type === 0).map(([id]) => id)));
    expect(schema.lines).toHaveLength(19);
    const decoded = decodeSchema(schema);
    for (let i = 0; i < net.paths.length; i++) {
      const match = matchSchemaPath(decoded, net, i);
      // A terminus loop (scripts/gtfs-shapes.mjs) is not laid along the
      // artwork at all; the placer draws it at its terminus circle, or, where
      // the line prints neither end, not at all (both below).
      if (net.paths[i].direction === LOOP_PATH_DIRECTION) {
        expect(match, net.paths[i].id).toMatchObject({ placeable: false, legs: [] });
        expect(['loop-path', 'loop-undrawn'], net.paths[i].id).toContain(match.reason);
        continue;
      }
      if (!match.placeable) {
        expect(match.reason, net.paths[i].id).toBe('too-few-stops');
        expect(overrides.unmappedPaths[net.paths[i].id], net.paths[i].id).toBeTruthy();
      }
      for (const leg of match.legs) expect(leg.stops.every((s, k) => k === 0 || (s.u - leg.stops[k - 1].u) * leg.sign > 0), net.paths[i].id).toBe(true);
    }
    const names = new Set(schema.stops.map((s: any) => s.name));
    const unassigned = [...new Set(net.stops.filter(s => s.onEdge?.length).map(s => s.name))].filter(name => !names.has(name));
    expect(unassigned.every(name => overrides.unmapped.some((entry: any) => (typeof entry === 'string' ? entry : entry.name) === name))).toBe(true);
    for (const line of schema.lines) {
      expect(line.pts.every(([x, y]: number[]) => Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x <= schema.box[0] && y <= schema.box[1])).toBe(true);
      expect(line.stops.every((s: any, i: number) => i === 0 || s.u >= line.stops[i - 1].u)).toBe(true);
    }
    // Pin the measured artifact with headroom, not the source SVG's 1.1 MB.
    expect(bytes.byteLength).toBeLessThan(65_000);
    expect(gzipSync(bytes).byteLength).toBeLessThan(20_000);
  });
});

// WP0: the rule (DESIGN.md takes the same sentence): a loop vehicle is drawn
// at the terminus circle of the loop's first stop that exists on ZET's
// schematic (stops[0], else stops[1]), on its own line, wherever along the loop
// it is: the artwork draws a terminus as one point, and a loop has no legs to
// lay along it. Mandlova, the depot, is explicitly absent from the artwork, so
// the loops that leave it are drawn at their other end. The one exception is
// named, not silent: a loop whose line's artwork prints neither end is
// matchSchemaPath's 'loop-undrawn', and the schematic does not draw its tram
// (the geographic map still does), because another line's terminus circle
// would misplace it. On feed 000395 that is exactly the depot runs: from
// Mandlova to Ravnice of the seven lines that do not serve Ravnice, and, with
// the terminus connectors of decision 25, from the Ljubljanica depot platform
// to Selska of the eight lines whose depot runs end at Ljubljanica, plus line
// 5's Žitnjak, line 12's Savski most and line 14's Črnomerec turns, all of
// them at another line's terminus. The list is pinned, so a new undrawn loop
// fails here, and every other loop keeps the mandatory placement below.
const UNDRAWN_LOOPS = [
  ...['6', '8', '13', '14', '15', '31', '33'].map((route) => `${route}: Mandlova -> Ravnice`),
  ...['1', '2', '5', '6', '11', '14', '17', '32'].map((route) => `${route}: Ljubljanica -> Selska`),
  '5: Žitnjak -> Žitnjak',
  '12: Savski most -> Savski most',
  '14: Črnomerec -> Črnomerec',
];
describe('a vehicle on a terminus loop on the diagram', () => {
  it('sits on its own line at the terminus circle of the loop\'s first stop that exists on the schematic, whatever its arc, with no track to point along; only the named loop-undrawn loops are not drawn', () => {
    const net = decodeNetwork(read('app/public/data/zet-network.json'));
    const schema = decodeSchema(read('app/public/data/zet-schema.json'));
    const placer = createSchemaPlacer(schema, net);
    const loops = net.paths.map((path, idx) => ({ path, idx })).filter(({ path }) => path.direction === LOOP_PATH_DIRECTION);
    expect(loops.length).toBeGreaterThan(0);
    const nameOf = (stopId: string) => net.stops.find((stop) => stop.id === stopId)!.name;
    const lineOf = (route: string) => schema.lines.find((l) => l.route === route)!;
    const entryFor = (route: string, stopId: string) => {
      const line = lineOf(route);
      const name = nameOf(stopId);
      return line.stops.find((stop) => stop.name === name && stop.ownCircle) ?? line.stops.find((stop) => stop.name === name);
    };
    // Derived from the artefact and the artwork, independently of the module:
    // the loops whose line prints neither of the two platforms.
    const undrawn = loops.filter(({ path }) => !entryFor(path.route, path.stops![0]) && !entryFor(path.route, path.stops![1]));
    expect(undrawn.map(({ path }) => `${path.route}: ${nameOf(path.stops![0])} -> ${nameOf(path.stops![1])}`).sort()).toEqual([...UNDRAWN_LOOPS].sort());
    for (const { path, idx } of undrawn) {
      expect(matchSchemaPath(schema, net, idx), path.id).toMatchObject({ placeable: false, reason: 'loop-undrawn', legs: [] });
      for (const s of [0, path.len / 2, path.len]) expect(placer.place(idx, s), path.id).toBeNull();
    }
    let second = 0;
    for (const { path, idx } of loops) {
      if (undrawn.some((u) => u.idx === idx)) continue;
      expect(matchSchemaPath(schema, net, idx), path.id).toMatchObject({ placeable: false, reason: 'loop-path', legs: [] });
      const line = lineOf(path.route);
      const first = entryFor(path.route, path.stops![0]);
      const entry = first ?? entryFor(path.route, path.stops![1]);
      if (!first) second++;
      expect(entry, `${path.id}: neither end is on line ${path.route}'s artwork`).toBeTruthy();
      const circle = pointAt(line, entry!.u);
      for (const s of [0, path.len / 2, path.len]) {
        const at = placer.place(idx, s);
        expect(at, path.id).toMatchObject({ x: circle.x, y: circle.y, line: path.route, colour: line.colour });
        expect(at!.track, path.id).toBeUndefined();
      }
    }
    // The second stop is reached only where the first is not printed: the
    // drawn loops out of Mandlova on feed 000395, whose other end the line does
    // print. Every loop out of Mandlova is one or the other.
    expect(second).toBeGreaterThan(0);
    const fromMandlova = loops.filter(({ path }) => nameOf(path.stops![0]) === 'Mandlova');
    expect(fromMandlova).toHaveLength(second + undrawn.filter(({ path }) => nameOf(path.stops![0]) === 'Mandlova').length);
  });
});

// The city map paints a focused line in the colour ZET prints it in (F5).
// That table is not a second hand-kept list: the same build that writes the
// schema artefact writes it, from the same strokes, in the same run.
describe('the ZET line colour table', () => {
  it('carries one colour per tram line, bound to the artefact’s own feed and strokes, in a stable order', () => {
    const table = read('app/src/data/zet-line-colours.json');
    const schema = read('app/public/data/zet-schema.json');
    expect(table.feedVersion).toBe(schema.feedVersion);
    const ids = Object.keys(table.colours);
    expect(ids).toHaveLength(19);
    // Deterministic bytes: two runs over the same source produce the same file.
    expect(ids).toEqual([...ids].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)));
    for (const line of schema.lines) expect(table.colours[line.route], line.route).toBe(line.colour);
  });
});
