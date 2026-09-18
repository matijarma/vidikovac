#!/usr/bin/env node
// ZET's PDF-exported SVG is the source, not a runtime dependency. Every
// coordinate below is composed into its page space before classification.
import { XMLParser } from 'fast-xml-parser';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';

const ROOT = resolve(import.meta.dirname, '..');
const IDENTITY = [1, 0, 0, 1, 0, 0];
const round = (n) => Math.round(n * 100) / 100;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const numbers = (s) => (s.match(/[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
const inside = (p, r) => p[0] >= r[0] && p[1] >= r[1] && p[0] <= r[2] && p[1] <= r[3];
const centre = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
const boxOf = (pts) => [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
const point = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function multiply(a, b) {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
export function transformMatrix(text = '') {
  let result = IDENTITY;
  for (const [, name, args] of text.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const v = numbers(args), angle = (v[0] ?? 0) * Math.PI / 180;
    let m;
    if (name === 'matrix') m = v;
    else if (name === 'translate') m = [1, 0, 0, 1, v[0], v[1] ?? 0];
    else if (name === 'scale') m = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
    else if (name === 'rotate') {
      m = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0];
      if (v.length === 3) m = multiply(multiply([1, 0, 0, 1, v[1], v[2]], m), [1, 0, 0, 1, -v[1], -v[2]]);
    } else if (name === 'skewX') m = [1, 0, Math.tan(angle), 1, 0, 0];
    else if (name === 'skewY') m = [1, Math.tan(angle), 0, 1, 0, 0];
    else throw new Error(`Unknown SVG transform ${name}`);
    if (m.length !== 6 || m.some(n => !Number.isFinite(n))) throw new Error(`Invalid SVG transform ${text}`);
    result = multiply(result, m);
  }
  return result;
}

/** The artwork uses M/L/C/Z; H/V/Q are accepted for small test fixtures.
 *  Only curves are sampled. Line vertices remain the source's own vertices. */
function pathPoints(d) {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.?\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const pts = [], onCurve = [];
  let i = 0, command = '', current = [0, 0], start = [0, 0], curves = false, closed = false;
  const add = (p) => { pts.push(p); current = p; };
  const read = (relative) => {
    const p = [Number(tokens[i++]), Number(tokens[i++])];
    return relative ? [p[0] + current[0], p[1] + current[1]] : p;
  };
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) command = tokens[i++];
    const relative = command === command.toLowerCase(), c = command.toUpperCase();
    if (c === 'Z') { add(start); closed = true; command = ''; continue; }
    if (c === 'M' || c === 'L') {
      const p = read(relative); add(p); onCurve.push(p);
      if (c === 'M') { start = p; command = relative ? 'l' : 'L'; }
    } else if (c === 'H' || c === 'V') {
      const p = [...current], axis = c === 'H' ? 0 : 1;
      p[axis] = Number(tokens[i++]) + (relative ? current[axis] : 0);
      add(p); onCurve.push(p);
    } else if (c === 'C' || c === 'Q') {
      curves = true;
      const p0 = current, p1 = read(relative), p2 = read(relative), p3 = c === 'C' ? read(relative) : p2;
      // 24 equal samples bound the deviation of the small circle paths well
      // below the artifact's 0.01-unit quantization; water is context only.
      for (let k = 1; k <= 24; k++) {
        const t = k / 24, q = 1 - t;
        add(c === 'C'
          ? [q ** 3 * p0[0] + 3 * q * q * t * p1[0] + 3 * q * t * t * p2[0] + t ** 3 * p3[0],
            q ** 3 * p0[1] + 3 * q * q * t * p1[1] + 3 * q * t * t * p2[1] + t ** 3 * p3[1]]
          : [q * q * p0[0] + 2 * q * t * p1[0] + t * t * p2[0], q * q * p0[1] + 2 * q * t * p1[1] + t * t * p2[1]]);
      }
      onCurve.push(p3);
    } else throw new Error(`Unsupported SVG path command ${command} at token ${i}`);
  }
  return { pts, onCurve, curves, closed };
}

/** Nearest point plus the arc along a source polyline. */
export function projectLine(pts, p) {
  let arc = 0, best = { d: Infinity, u: 0, point: pts[0] };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (length * length))) : 0;
    const q = [a[0] + dx * t, a[1] + dy * t], d = distance(q, p);
    if (d < best.d) best = { d, u: arc + length * t, point: q };
    arc += length;
  }
  return best;
}

function assembleLabels(glyphs) {
  const runs = [];
  for (const g of glyphs) {
    if (g.char === ' ') continue; // PDF space transforms are deliberately unusable.
    const previous = runs.at(-1), tail = previous?.glyphs.at(-1);
    const cos = Math.cos(g.rot), sin = Math.sin(g.rot);
    const dx = tail ? g.x - tail.x : Infinity, dy = tail ? g.y - tail.y : Infinity;
    const along = dx * cos + dy * sin, across = -dx * sin + dy * cos;
    const digitGap = tail && /^\d$/.test(g.char) && /^\d$/.test(tail.char) && along - tail.advance > g.size * .21;
    const compatible = tail && !digitGap && g.font === tail.font && g.fill === tail.fill && Math.abs(g.size - tail.size) < .08
      && Math.abs(g.rot - tail.rot) < .015 && Math.abs(across) < g.size * .26
      && along > -.15 && along <= g.size * 1.6;
    if (!compatible) runs.push({ ...g, text: g.char, glyphs: [g], rows: 1, anchor: 'start' });
    else {
      const inkGap = along - tail.advance;
      if (inkGap > g.size * .21) previous.text += ' ';
      previous.text += g.char;
      previous.glyphs.push(g);
    }
  }
  // The export gives different baseline offsets to rounded/capital glyphs.
  // Keep the original first anchor; merging rows only needs a size-relative tolerance.
  const merged = [];
  for (const run of runs) {
    run.box = boxOf(run.glyphs.flatMap(g => [[g.box[0], g.box[1]], [g.box[2], g.box[3]]]));
    const parent = merged.find(a => a.rows < 3 && a.fill === run.fill && Math.abs(a.size - run.size) < .08 && Math.abs(a.rot - run.rot) < .015
      && (/^[a-zčćžšđ]/u.test(run.text) || /^(MOST|KOLODVOR|DOLJE|TRG|Hrvatske|Petra|Josipa|Zagreb|S\.Radić)/u.test(run.text))
      && (() => {
        const prev = a.lastRow ?? a;
        const dx = run.x - prev.x, dy = run.y - prev.y, cos = Math.cos(a.rot), sin = Math.sin(a.rot);
        const perpendicular = -dx * sin + dy * cos, parallel = dx * cos + dy * sin;
        return perpendicular >= a.size * .6 && perpendicular <= a.size * 1.4 && Math.abs(parallel) < a.size * 3;
      })());
    if (parent && !/^\d+$/.test(parent.text) && !/^\d+$/.test(run.text)) {
      parent.text += `\n${run.text}`; parent.rows++;
      parent.lastRow = { x: run.x, y: run.y };
      parent.box = boxOf([[parent.box[0], parent.box[1]], [parent.box[2], parent.box[3]], [run.box[0], run.box[1]], [run.box[2], run.box[3]]]);
      parent.glyphs.push(...run.glyphs);
    } else merged.push(run);
  }
  return merged;
}

export function extractArtwork(svg, overrides = {}) {
  const tree = new XMLParser({ ignoreAttributes: false, preserveOrder: true, attributeNamePrefix: '' }).parse(svg);
  const symbols = new Map(), paths = [], glyphs = [];
  let viewBox = [0, 0, 1190.5512, 841.8898];
  function symbolsIn(nodes) {
    for (const node of nodes) {
      if (node.symbol) {
        const pts = node.symbol.filter(n => n.path).flatMap(n => pathPoints(n[':@']?.d ?? '').pts);
        if (pts.length) symbols.set(node[':@'].id, boxOf(pts));
      } else for (const [key, children] of Object.entries(node)) if (key !== ':@' && Array.isArray(children)) symbolsIn(children);
    }
  }
  symbolsIn(tree);
  function walk(nodes, matrix = IDENTITY, inherited = {}) {
    for (const node of nodes) {
      const tag = Object.keys(node).find(k => k !== ':@' && k !== '#text');
      if (!tag || ['symbol', 'defs', 'clipPath', 'image', 'metadata'].includes(tag)) continue;
      const own = node[':@'] ?? {};
      const style = Object.fromEntries((own.style ?? '').split(';').filter(Boolean).map(pair => pair.split(':').map(x => x.trim())));
      const attrs = { ...inherited, ...own, ...style }, m = multiply(matrix, transformMatrix(own.transform));
      if (tag === 'svg') viewBox = numbers(own.viewBox);
      if (tag === 'path') {
        const geometry = pathPoints(attrs.d ?? '');
        const pts = geometry.pts.map(p => point(m, p));
        if (!pts.length) continue;
        const bbox = boxOf(pts), p = centre(bbox);
        const inPage = pts.every(q => inside(q, viewBox));
        const excluded = (overrides.exclude ?? []).some(r => inside(p, r));
        if (inPage && !excluded) paths.push({ ...geometry, pts, box: bbox, x: p[0], y: p[1],
          fill: attrs.fill ?? '#000000', stroke: attrs.stroke,
          rawWidth: Number(attrs['stroke-width'] ?? 0),
          width: Number(attrs['stroke-width'] ?? 0) * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) });
      } else if (tag === 'use') {
        const href = attrs['xlink:href'] ?? attrs.href ?? '', hit = href.match(/^#(font_(\d+)_([0-9a-f]+))$/i);
        if (hit) {
          const char = String.fromCodePoint(parseInt(hit[3], 16)), size = Math.hypot(m[0], m[1]), rot = Math.atan2(m[1], m[0]);
          const p = point(m, [Number(own.x ?? 0), Number(own.y ?? 0)]);
          if (char === ' ' || !inside(p, viewBox) || (overrides.exclude ?? []).some(r => inside(p, r))) continue;
          const bb = symbols.get(hit[1]) ?? [0, 0, .6, .72];
          const corners = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]].map(q => point(m, q));
          glyphs.push({ char, font: hit[2], size, rot, x: p[0], y: p[1], fill: attrs.fill ?? '#000000', advance: bb[2] * size, box: boxOf(corners) });
        }
      }
      if (Array.isArray(node[tag])) walk(node[tag], m, attrs);
    }
  }
  walk(tree);
  const allLabels = assembleLabels(glyphs);
  const labels = allLabels.filter(l => l.fill === '#1a1a18' && /\p{L}/u.test(l.text) && ((l.size >= 6.6 && l.size <= 8.1) || (l.size >= 9.2 && l.size <= 9.6)));
  const badges = allLabels.filter(l => ['#e5007d', '#2f2483'].includes(l.fill) && l.size >= 5.5 && l.size <= 7.8 && /^\d{1,2}$/.test(l.text))
    .map(l => ({ ...l, centre: centre(l.box) }));
  const lines = paths.filter(p => !p.curves && !p.closed && p.rawWidth >= 1.4 && p.rawWidth < 5 && p.stroke && !['#ffffff', '#fff', '#1a1a18'].includes(p.stroke))
    .map((p, i) => ({ id: i, pts: p.pts.map(q => q.map(round)), colour: p.stroke, width: round(p.width) }));
  const circles = paths.filter(p => ['#1a1a18', '#2f2483'].includes(p.stroke) && p.rawWidth <= .5 && Math.max(p.box[2] - p.box[0], p.box[3] - p.box[1]) < 5)
    .map(p => ({ x: round(p.x), y: round(p.y), r: round(Math.max(p.box[2] - p.box[0], p.box[3] - p.box[1]) / 2),
      half: Math.min(p.box[2] - p.box[0], p.box[3] - p.box[1]) < .75 * Math.max(p.box[2] - p.box[0], p.box[3] - p.box[1]) ? 'D' : null }));
  const terminals = paths.filter(p => p.fill === '#e5007d' && p.curves && Math.max(p.box[2] - p.box[0], p.box[3] - p.box[1]) < 8)
    .map(p => ({ x: round(p.x), y: round(p.y), r: round(Math.max(p.box[2] - p.box[0], p.box[3] - p.box[1]) / 2) }));
  const water = paths.filter(p => ['#738ec8', '#cad7ef', '#73869f'].includes(p.stroke) || ['#cad7ef', '#738ec8', '#cbd9f1'].includes(p.fill))
    .map(p => ({ pts: simplify(p.pts, .12).map(q => q.map(round)), width: round(p.width), colour: p.stroke ?? p.fill, ...(p.closed ? { fill: true } : {}) }));
  return { box: [viewBox[2], viewBox[3]], lines, circles, terminals, labels, badges, water, allLabels };
}

function normal(text) {
  return text.toLocaleLowerCase('hr').replace(/\n/g, ' ').trim().replace(/\s+/g, ' ');
}
export function matchStopName(name, label) {
  const a = [...normal(name).matchAll(/([\p{L}\p{N}]+)(\.)?/gu)].map(m => ({ text: m[1], prefix: Boolean(m[2]) }));
  const b = [...normal(label).matchAll(/[\p{L}\p{N}]+/gu)].map(m => m[0]);
  if (a.length === 0 || b.length === 0) return false;
  if (name.length === 20) a[a.length - 1].prefix = true;
  const matches = (token, word) => token.prefix ? word.startsWith(token.text) : token.text === word;
  if (!matches(a[0], b[0])) return false; // "Svetice" must not swallow "Donje Svetice".
  let at = 1;
  for (let i = 1; i < a.length; i++) {
    while (at < b.length && !matches(a[i], b[at])) at++;
    if (at === b.length) return false;
    at++;
  }
  return at === b.length || b.slice(at).every(t => /^[ivx]+$/.test(t));
}

export function identifyLines(art, routes, overrides = {}) {
  const claimed = new Set(), result = [];
  for (const route of routes) {
    const explicit = overrides.routes?.[route.route];
    const candidates = art.lines.filter(line => {
      if (explicit?.colour && explicit.colour !== line.colour) return false;
      if (explicit?.point && projectLine(line.pts, explicit.point).d > 1) return false;
      return true;
    });
    const scored = candidates.map(line => {
      const votes = art.badges.filter(b => projectLine(line.pts, b.centre).d <= 3 && (Number(route.route) >= 30 ? b.fill === '#2f2483' : b.fill === '#e5007d')).map(b => b.text);
      const agreeing = votes.filter(v => v === route.route).length;
      const termini = explicit?.termini ?? (route.termini ?? []).map(name => {
        const label = art.labels.find(l => matchStopName(name, l.text));
        if (!label) return null;
        const c = centre(label.box);
        return [...art.terminals].sort((a, b) => distance([a.x, a.y], c) - distance([b.x, b.y], c))[0];
      }).filter(Boolean).map(t => Array.isArray(t) ? t : [t.x, t.y]);
      const endpoint = [line.pts[0], line.pts.at(-1)];
      const terminalAgrees = termini.length >= 2 && endpoint.every(p => termini.some(t => distance(p, t) <= 28))
        && (art.terminals.length === 0 || endpoint.every(p => art.terminals.some(t => distance(p, [t.x, t.y]) <= 2.5)));
      return { ...line, votes, agreeing, terminalAgrees };
    }).filter(l => l.agreeing >= (explicit?.badgeMinimum ?? 2) && l.terminalAgrees);
    if (scored.length !== 1 || claimed.has(scored[0]?.id)) {
      throw new Error(`Route ${route.route}: unresolved stroke (${scored.length} candidates). ${JSON.stringify(candidates.map(l => ({ colour: l.colour, at: l.pts[0], votes: art.badges.filter(b => projectLine(l.pts, b.centre).d <= 3).map(b => b.text) })))}`);
    }
    const line = scored[0]; claimed.add(line.id);
    result.push({ route: route.route, night: Number(route.route) >= 30, colour: line.colour, width: line.width, pts: line.pts, stops: [], evidence: { votes: line.votes, termini: route.termini } });
  }
  if (claimed.size !== art.lines.length) throw new Error(`Unassigned strokes: ${art.lines.filter(l => !claimed.has(l.id)).map(l => `${l.colour} at ${l.pts[0]}`).join('; ')}`);
  return result;
}

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  let index = 0, furthest = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = projectLine([points[0], points.at(-1)], points[i]).d;
    if (d > furthest) { furthest = d; index = i; }
  }
  if (furthest <= tolerance) return [points[0], points.at(-1)];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

function circleGroups(art) {
  const all = [...art.circles.map(c => ({ ...c, terminal: false })), ...art.terminals.map(c => ({ ...c, terminal: true, half: null }))];
  const seen = new Set(), groups = [];
  for (let i = 0; i < all.length; i++) {
    if (seen.has(i)) continue;
    const queue = [i], members = []; seen.add(i);
    for (let k = 0; k < queue.length; k++) {
      const a = all[queue[k]]; members.push(a);
      for (let j = 0; j < all.length; j++) {
        if (!seen.has(j) && distance([a.x, a.y], [all[j].x, all[j].y]) <= 8) { seen.add(j); queue.push(j); }
      }
    }
    groups.push({ id: groups.length, members, x: members.reduce((s, c) => s + c.x, 0) / members.length, y: members.reduce((s, c) => s + c.y, 0) / members.length });
  }
  return groups;
}

function labelDistance(label, circle) {
  const p = [circle.x, circle.y];
  // A long diagonal label's axis-aligned bbox spans unrelated stops. Use its
  // individual glyph boxes, which retain its actual baseline/rotation.
  return Math.min(...label.glyphs.map(g => {
    const b = g.box;
    return Math.hypot(Math.max(b[0] - p[0], 0, p[0] - b[2]), Math.max(b[1] - p[1], 0, p[1] - b[3]));
  }));
}

function wireLabel(label) {
  let text = label.text;
  // Two source labels use three compressed rows. Keep every word, with two
  // rows in the app's font as required by the version-1 artifact contract.
  if (label.rows > 2) {
    const rows = text.split('\n');
    text = rows.length === 3 && rows[1].length <= 2 ? `${rows[0]} ${rows[1]}\n${rows[2]}` : `${rows[0]} ${rows[1]}\n${rows.slice(2).join(' ')}`;
  }
  return { text, rows: text.includes('\n') ? 2 : 1, x: round(label.x), y: round(label.y), rot: Math.round(label.rot * 1e6) / 1e6, anchor: label.anchor };
}

export function buildSchema(art, net, routes, overrides, builtAt) {
  const lines = identifyLines(art, routes, overrides), groups = circleGroups(art);
  const names = [...new Set(net.stops.filter(s => s.onEdge?.length).map(s => s.name))].sort((a, b) => a.localeCompare(b, 'hr'));
  const stops = [], assigned = [], missing = [], conflicts = [];
  const usedLabels = new Set(), matchedGroups = new Map();
  const allow = new Set((overrides.unmapped ?? []).map(s => typeof s === 'string' ? s : s.name));
  for (const name of [...names, ...Object.keys(overrides.artworkStops ?? {})]) {
    if (allow.has(name)) continue;
    const anchor = overrides.labelAnchors?.[name] ?? overrides.artworkStops?.[name], target = overrides.aliases?.[name] ?? name;
    let labels = art.labels.filter(l => matchStopName(target, l.text));
    if (anchor) {
      const nearest = art.labels.map(l => ({ l, d: distance([l.x, l.y], anchor) })).sort((a, b) => a.d - b.d)[0];
      if (!nearest || nearest.d > 3) throw new Error(`Label anchor ${name} at ${anchor} did not resolve`);
      labels = [nearest.l];
    }
    if (labels.length !== 1) { missing.push({ name, candidates: labels.map(l => ({ text: l.text, at: [round(l.x), round(l.y)] })) }); continue; }
    const label = labels[0];
    if (usedLabels.has(label)) throw new Error(`Label '${label.text}' claimed twice; name ${name}`);
    usedLabels.add(label);
    const isTerminalLabel = label.size >= 9;
    const eligible = groups.filter(g => isTerminalLabel === g.members.some(c => c.terminal));
    const scored = eligible.map(g => ({ group: g, d: Math.min(...g.members.map(c => labelDistance(label, c))) }))
      .sort((a, b) => a.d - b.d || a.group.id - b.group.id);
    const explicit = overrides.stopGroups?.[name];
    const choice = explicit
      ? groups.map(g => ({ group: g, d: Math.min(...g.members.map(c => distance([c.x, c.y], explicit))) })).sort((a, b) => a.d - b.d)[0]
      : scored[0];
    if (!choice || choice.d > 45) throw new Error(`No stop circle for ${name} near ${round(label.x)},${round(label.y)}`);
    const group = choice.group;
    if (matchedGroups.has(group.id)) {
      conflicts.push({ name, claimedBy: matchedGroups.get(group.id), at: [round(group.x), round(group.y)],
        candidates: scored.slice(0, 4).map(s => ({ at: [round(s.group.x), round(s.group.y)], d: round(s.d), circles: s.group.members.length })) });
      continue;
    }
    matchedGroups.set(group.id, name);
    const terminal = group.members.some(c => c.terminal);
    const wire = { name, x: round(group.x), y: round(group.y), r: round(group.members[0].r), half: group.members.every(c => c.half) ? 'D' : null, label: wireLabel(label), terminal };
    stops.push(wire);
    assigned.push({ name, group, label, wire });
  }
  if (missing.length) throw new Error(`Unmatched or ambiguous tram names:\n${JSON.stringify(missing, null, 2)}`);
  if (conflicts.length) throw new Error(`Ambiguous circle groups; add named stopGroups overrides:\n${JSON.stringify(conflicts, null, 2)}`);
  // Duplicate text in the artwork represents other platform groups on the
  // same named stop. Explicit labelAnchors choose the one text the app draws;
  // attach the other group's circles too without introducing another name.
  for (const record of assigned) {
    if (record.extra || !overrides.labelAnchors?.[record.name]) continue;
    for (const label of art.labels.filter(l => l !== record.label && normal(l.text) === normal(record.label.text))) {
      if (usedLabels.has(label)) continue;
      const nearest = groups.map(g => ({ group: g, d: Math.min(...g.members.map(c => labelDistance(label, c))) })).sort((a, b) => a.d - b.d)[0];
      if (nearest && nearest.d <= 35 && !matchedGroups.has(nearest.group.id)) {
        matchedGroups.set(nearest.group.id, record.name);
        assigned.push({ name: record.name, group: nearest.group, label, wire: record.wire, extra: true });
      }
    }
  }
  for (const [name, points] of Object.entries(overrides.extraGroups ?? {})) {
    const record = assigned.find(r => r.name === name);
    if (!record) throw new Error(`Extra group name ${name} has no matched label`);
    for (const p of points) {
      const match = groups.map(g => ({ group: g, d: distance([g.x, g.y], p) })).sort((a, b) => a.d - b.d)[0];
      if (!match || match.d > 2) throw new Error(`Extra circle group ${name} at ${p} not found`);
      const owner = matchedGroups.get(match.group.id);
      if (owner === name) continue;
      if (owner) throw new Error(`Extra circle group ${name} at ${p} already belongs to ${owner}`);
      matchedGroups.set(match.group.id, name);
      assigned.push({ ...record, group: match.group, extra: true });
    }
  }
  for (const line of lines) {
    for (const record of assigned) {
      const hits = record.group.members.map(c => ({ c, hit: projectLine(line.pts, [c.x, c.y]) })).sort((a, b) => a.hit.d - b.hit.d);
      const own = hits.find(h => h.hit.d <= 2.5);
      // A corridor group's span is evidence, not a blanket proximity radius:
      // only project onto a parallel line within half one route's spacing.
      const groupHit = projectLine(line.pts, [record.group.x, record.group.y]);
      const span = Math.max(...record.group.members.map(c => distance([record.group.x, record.group.y], [c.x, c.y])));
      const hit = own?.hit ?? (groupHit.d <= span + 3 ? groupHit : null);
      if (!hit) continue;
      line.stops.push({ u: round(hit.u), name: record.name, ownCircle: Boolean(own) });
    }
    line.stops.sort((a, b) => a.u - b.u || a.name.localeCompare(b.name, 'hr'));
    line.stops = line.stops.filter((s, i, list) => !list.slice(0, i).some(p => p.name === s.name && Math.abs(p.u - s.u) < 1));
    if (line.stops.length < 2) throw new Error(`Route ${line.route}: fewer than two mapped diagram stops`);
  }
  const report = {
    names: names.length, matched: names.filter(n => stops.some(s => s.name === n)).length, artworkOnly: Object.keys(overrides.artworkStops ?? {}), allowlisted: names.filter(n => allow.has(n)),
    stops: assigned.map(r => ({ name: r.name, at: [round(r.group.x), round(r.group.y)], circles: r.group.members.length, label: normal(r.label.text) })),
    lines: lines.map(l => ({ route: l.route, colour: l.colour, ...l.evidence, circles: l.stops.length, projected: l.stops.filter(s => !s.ownCircle).map(s => s.name), stops: l.stops.map(s => s.name) })),
    unassignedGroups: groups.filter(g => !matchedGroups.has(g.id)).map(g => ({ at: [round(g.x), round(g.y)], circles: g.members.length })),
  };
  const schema = { version: 1, source: 'zet-zagreb-tram-lines-map.svg', builtAt, feedVersion: net.feedVersion,
    box: art.box, lines: lines.map(({ evidence, ...line }) => line), stops, water: art.water.map(({ fill, ...w }) => w) };
  return { schema, report };
}

/** Node-only, in-memory bundling uses the identical TS decoder as the app
 *  without duplicating network v2 or relying on Node extension resolution. */
async function loadShared(file) {
  const output = await build({ entryPoints: [resolve(ROOT, file)], bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
}

async function inputs() {
  const [svg, overrideText, networkText, tripsText, metaText] = await Promise.all([
    'zet-zagreb-tram-lines-map.svg', 'scripts/zet-schema-overrides.json', 'app/public/data/zet-network.json', 'app/public/data/zet-trips.json', 'app/src/motion/network-meta.ts',
  ].map(f => readFile(resolve(ROOT, f), 'utf8')));
  const overrides = JSON.parse(overrideText), rawNet = JSON.parse(networkText), trips = JSON.parse(tripsText);
  const feed = metaText.match(/FEED_VERSION\s*=\s*["']([^"']+)/)?.[1];
  if (rawNet.feedVersion !== feed || trips.feedVersion !== feed) throw new Error(`Feed mismatch: meta ${feed}, network ${rawNet.feedVersion}, trips ${trips.feedVersion}`);
  const { decodeNetwork } = await loadShared('shared/motion/network.ts');
  const net = decodeNetwork(rawNet), names = new Map(net.stops.map(s => [s.id, s.name]));
  const routes = [...net.routes].filter(([, r]) => r.type === 0).map(([route]) => {
    const termini = [];
    for (const direction of [0, 1]) {
      const indexes = trips.patterns.route.map((r, i) => r === route && trips.patterns.direction[i] === direction ? i : -1).filter(i => i >= 0)
        .sort((a, b) => trips.patterns.stops[b].length - trips.patterns.stops[a].length || trips.patterns.trips[b] - trips.patterns.trips[a] || a - b);
      const stops = trips.patterns.stops[indexes[0]] ?? [];
      if (stops.length) termini.push(names.get(stops[0]), names.get(stops.at(-1)));
    }
    return { route, termini: [...new Set(termini.filter(Boolean))] };
  }).sort((a, b) => Number(a.route) - Number(b.route));
  return { svg, overrides, rawNet, net, routes };
}

export async function main(argv = process.argv.slice(2)) {
  const input = await inputs();
  const art = extractArtwork(input.svg, input.overrides);
  if (argv.includes('--inspect')) {
    console.log(JSON.stringify({
      counts: { lines: art.lines.length, circles: art.circles.length, terminals: art.terminals.length, labels: art.labels.length, badges: art.badges.length, water: art.water.length },
      lines: art.lines.map(l => ({ ...l, votes: art.badges.filter(b => projectLine(l.pts, b.centre).d <= 3).map(b => ({ text: b.text, at: b.centre.map(round) })) })),
      labels: art.labels.map(l => ({ text: l.text, x: round(l.x), y: round(l.y), size: round(l.size), rot: round(l.rot), rows: l.rows })),
      routes: input.routes,
    }, null, 2));
    return;
  }
  // Derive the date from the committed network input, not the wall clock:
  // two runs over identical source bytes must produce identical bytes.
  const { schema, report } = buildSchema(art, input.net, input.routes, input.overrides, input.rawNet.builtAt);
  const { decodeSchema, matchSchemaPath } = await loadShared('shared/motion/schema.ts');
  const decoded = decodeSchema(schema);
  report.paths = input.net.paths.map((path, i) => {
    const match = matchSchemaPath(decoded, input.net, i);
    const exemption = input.overrides.unmappedPaths?.[path.id];
    if (!match.placeable && !(match.reason === 'too-few-stops' && exemption)) {
      throw new Error(`Path ${path.id}: ${match.reason}; ${match.stops.length}/${match.sourceStops} stops matched`);
    }
    for (const leg of match.legs) {
      if (!leg.stops.every((stop, k) => k === 0 || (stop.u - leg.stops[k - 1].u) * leg.sign > 0)) throw new Error(`Path ${path.id}: non-monotone diagram leg`);
    }
    return { id: path.id, matched: match.stops.length, source: match.sourceStops, legs: match.legs.map(l => l.sign), excluded: match.placeable ? null : exemption };
  });
  const text = JSON.stringify(schema) + '\n';
  // The city map's line focus paints a route in the colour ZET prints it in
  // (F5). The strokes that colour comes from are identified right here, so the
  // table is written by the same run rather than kept by hand: one feed, one
  // set of colours, one source of truth. Keys in route order and two-space
  // JSON -- it is a committed source file, and its diff has to be readable.
  const colours = {
    feedVersion: schema.feedVersion,
    colours: Object.fromEntries([...schema.lines]
      .sort((a, b) => Number(a.route) - Number(b.route) || a.route.localeCompare(b.route))
      .map(line => [line.route, line.colour])),
  };
  const coloursText = JSON.stringify(colours, null, 2) + '\n';
  if (report.unassignedGroups.length) throw new Error(`Unassigned in-diagram circle groups: ${JSON.stringify(report.unassignedGroups)}`);
  if (!argv.includes('--check')) {
    await writeFile(resolve(ROOT, 'app/public/data/zet-schema.json'), text, 'utf8');
    await writeFile(resolve(ROOT, 'app/src/data/zet-line-colours.json'), coloursText, 'utf8');
  } else {
    if (await readFile(resolve(ROOT, 'app/public/data/zet-schema.json'), 'utf8').catch(() => null) !== text) throw new Error('Committed zet-schema.json is missing or stale; run npm run build:schema');
    if (await readFile(resolve(ROOT, 'app/src/data/zet-line-colours.json'), 'utf8').catch(() => null) !== coloursText) throw new Error('Committed zet-line-colours.json is missing or stale; run npm run build:schema');
  }
  if (argv.includes('--verbose')) console.log(JSON.stringify(report, null, 2));
  else {
    for (const line of report.lines) console.log(`Line ${line.route.padStart(2)} ${line.colour}: ${line.votes.filter(v => v === line.route).length} badge votes, ${line.circles} stops, projected [${line.projected.join(', ')}], GTFS termini [${line.termini.join(' / ')}]`);
    console.log(`${report.matched}/${report.names} feed names matched; ${report.allowlisted.length} explicitly absent [${report.allowlisted.join(', ')}]; ${report.artworkOnly.length} artwork-only labels retained; ${report.unassignedGroups.length} unresolved groups.`);
    console.log(`${report.paths.filter(p => !p.excluded).length}/${report.paths.length} paths placeable with strictly monotone legs; exclusions [${report.paths.filter(p => p.excluded).map(p => p.id).join(', ')}]. Full coverage: --verbose.`);
  }
  console.log(`zet-schema.json: ${Buffer.byteLength(text)} bytes raw, ${gzipSync(text).byteLength} bytes gzip; feed ${schema.feedVersion}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
