// Builds the two SVG figures the grant application's mocks embed and splices
// them into docs/prijava/figures/m-kiosk.html:
//
//   docs/prijava/figures/qr-s.svg            the real QR of https://zagreb.aningfilm.hr/s,
//                                            drawn exactly as app/src/ui/qr.ts draws one
//                                            (uqr, ecc M, currentColor modules on a
//                                            transparent ground), width/height stripped so
//                                            the plate sizes it;
//   docs/prijava/figures/shema-tramvaji.svg  the tram lines of app/public/data/zet-network.json's
//                                            octilinear diagram, cropped around the network's
//                                            hub (the densest cell: Trg bana J. Jelačića),
//                                            strokes in var(--tone-action-brand) at 0.9.
//
// Node >= 22, ESM, no dependency beyond uqr (already in package.json). Run from anywhere:
//   node scripts/build-prijava-figures.mjs
// Not part of `npm run build:prijava` since 23 September 2026: the two figures belong to
// the proposal as submitted, and today's network (regenerated after submission) would
// redraw the submitted scheme. Run it only to change a figure on purpose.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSVG } from 'uqr';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'docs/prijava/figures');
mkdirSync(OUT, { recursive: true });

const PAYLOAD = 'https://zagreb.aningfilm.hr/s';
const NETWORK = resolve(ROOT, 'app/public/data/zet-network.json');
const KIOSK_MOCK = resolve(OUT, 'm-kiosk.html');
const ZET_CREDIT = 'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669';
const SIZE_CAP = 150 * 1024;

// --- 1. The QR ---------------------------------------------------------------

function buildQr() {
  let svg = renderSVG(PAYLOAD, { ecc: 'M', blackColor: 'currentColor', whiteColor: 'transparent' });
  // The plate sizes the code: no intrinsic width or height, only the viewBox.
  svg = svg.replace(/\s(width|height)="[^"]*"/g, '');
  svg = svg.replace('<svg ', '<svg class="qr-svg" role="img" aria-labelledby="qr-s-title" ');
  svg = svg.replace(/(<svg[^>]*>)/, `$1<title id="qr-s-title">QR kod: ${PAYLOAD}</title>`);
  const file = resolve(OUT, 'qr-s.svg');
  writeFileSync(file, `${svg}\n`);
  return { file, bytes: Buffer.byteLength(svg) };
}

// --- 2. The tram schematic ---------------------------------------------------

/** The artefact's `diagram` as {route, kind, pts:[x,y][]}[] plus its box; only what this figure reads (see app/src/motion/network.ts RawNetworkArtefact). */
function readDiagram() {
  const raw = JSON.parse(readFileSync(NETWORK, 'utf8'));
  // Versions 1 to 3 (version 2 added the twin engine's rail graph, version 3
  // the served-stop table) carry the same `routes` and `diagram` members this
  // figure reads, untouched by either; a version past them must still stop the
  // build rather than have its bytes guessed at.
  if (![1, 2, 3].includes(raw.version)) throw new Error(`zet-network.json: unexpected artefact version ${raw.version}`);
  const typeOf = new Map(raw.routes.id.map((id, i) => [id, raw.routes.type[i]]));
  const lines = raw.diagram.lines.route.map((route, i) => ({ route, type: typeOf.get(route), pts: raw.diagram.lines.pts[i] }));
  return { lines, box: raw.diagram.box, feedVersion: raw.feedVersion };
}

/** The densest cell of the tram network, counted as distinct routes whose lines pass through it: the hub, not the longest straight. */
function hubOf(tramLines, box, cell = 0.02) {
  const cols = Math.ceil(box[0] / cell);
  const rows = Math.ceil(box[1] / cell);
  const routesAt = new Map(); // cell index -> Set(route)
  const step = cell / 4;
  for (const line of tramLines) {
    for (let i = 1; i < line.pts.length; i += 1) {
      const [x0, y0] = line.pts[i - 1];
      const [x1, y1] = line.pts[i];
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.ceil(len / step));
      for (let k = 0; k <= n; k += 1) {
        const x = x0 + ((x1 - x0) * k) / n;
        const y = y0 + ((y1 - y0) * k) / n;
        const c = Math.min(cols - 1, Math.max(0, Math.floor(x / cell)));
        const r = Math.min(rows - 1, Math.max(0, Math.floor(y / cell)));
        const key = r * cols + c;
        if (!routesAt.has(key)) routesAt.set(key, new Set());
        routesAt.get(key).add(line.route);
      }
    }
  }
  // Smooth over the 3x3 neighbourhood so the hub is the dense area, not one lucky cell.
  let best = { key: 0, score: -1 };
  for (const key of routesAt.keys()) {
    const r = Math.floor(key / cols);
    const c = key % cols;
    let score = 0;
    for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
      const set = routesAt.get((r + dr) * cols + (c + dc));
      if (set) score += set.size * (dr === 0 && dc === 0 ? 2 : 1);
    }
    if (score > best.score) best = { key, score };
  }
  const r = Math.floor(best.key / cols);
  const c = best.key % cols;
  return { x: (c + 0.5) * cell, y: (r + 0.5) * cell, routes: routesAt.get(best.key)?.size ?? 0 };
}

function segmentsIntersect(pts, win) {
  // A polyline counts when any vertex lies inside the (margin-expanded) window or a segment crosses it: a bounding-box test per segment is enough for a crop.
  for (let i = 0; i < pts.length; i += 1) {
    const [x, y] = pts[i];
    if (x >= win.x0 && x <= win.x1 && y >= win.y0 && y <= win.y1) return true;
    if (i > 0) {
      const [px, py] = pts[i - 1];
      const minX = Math.min(px, x), maxX = Math.max(px, x), minY = Math.min(py, y), maxY = Math.max(py, y);
      if (maxX >= win.x0 && minX <= win.x1 && maxY >= win.y0 && minY <= win.y1) return true;
    }
  }
  return false;
}

const fmt = (v) => String(Math.round(v * 10) / 10);

/** Distance from p to the segment ab, in the same units. */
function segDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Points along `pts` every `step` units (vertices included). */
function sample(pts, step) {
  const out = [];
  for (let i = 1; i < pts.length; i += 1) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 0; k < n; k += 1) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * The share of `pts` already drawn by `kept` (the same route's other
 * polylines): a point counts as covered when it lies within `tol` of any
 * kept segment. The diagram carries one polyline per shape, so a route's
 * return direction and its short variants retrace the same corridor a hair
 * apart; drawn twice they read as a doubled stroke, not a line.
 */
function coveredShare(pts, kept, tol) {
  const samples = sample(pts, tol);
  let hit = 0;
  for (const p of samples) {
    let near = false;
    for (const k of kept) {
      for (let i = 1; i < k.length && !near; i += 1) if (segDist(p, k[i - 1], k[i]) <= tol) near = true;
      if (near) break;
    }
    if (near) hit += 1;
  }
  return hit / samples.length;
}

/** Polylines of one route, longest first, each kept only for the corridor it adds (less than 85 % already covered within 2.5 ‰ of the box). */
function dedupeRoute(polylines, tol) {
  const kept = [];
  for (const pts of [...polylines].sort((a, b) => b.length - a.length)) {
    if (kept.length > 0 && coveredShare(pts, kept, tol) >= 0.85) continue;
    kept.push(pts);
  }
  return kept;
}

function buildSchematic() {
  const { lines, box, feedVersion } = readDiagram();
  const trams = lines.filter((l) => l.type === 0 && l.pts.length > 1);
  const hub = hubOf(trams, box);
  // The window: about half of the network's width, three by two like the kiosk's field (the map is the whole field of the public screen, the rail hangs at its foot), the hub in the middle, clamped to the box.
  const winW = Math.min(box[0], 0.5);
  const winH = Math.min(box[1], winW / 1.5);
  const x0 = Math.min(Math.max(0, hub.x - winW / 2), box[0] - winW);
  const y0 = Math.min(Math.max(0, hub.y - winH / 2), box[1] - winH);
  const win = { x0, y0, x1: x0 + winW, y1: y0 + winH };
  const margin = 0.08;
  const keep = { x0: win.x0 - margin, y0: win.y0 - margin, x1: win.x1 + margin, y1: win.y1 + margin };

  // One path per route (its diagram polylines as subpaths), coordinates in a 1000-unit box rounded to a tenth;
  // consecutive duplicate points dropped, then the route's retraced corridors (dedupeRoute) so no stroke is doubled.
  const S = 1000;
  const TOL = 6;
  const byRoute = new Map();
  let candidates = 0;
  for (const line of trams) {
    if (!segmentsIntersect(line.pts, keep)) continue;
    const pts = [];
    for (const [x, y] of line.pts) {
      const p = [Math.round(x * S * 10) / 10, Math.round(y * S * 10) / 10];
      const last = pts[pts.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
    }
    if (pts.length < 2) continue;
    candidates += 1;
    if (!byRoute.has(line.route)) byRoute.set(line.route, []);
    byRoute.get(line.route).push(pts);
  }
  let polylines = 0;
  const routes = [...byRoute.keys()].sort((a, b) => Number(a) - Number(b));
  const paths = routes.map((route) => {
    const kept = dedupeRoute(byRoute.get(route), TOL);
    polylines += kept.length;
    const d = kept.map((pts) => `M${fmt(pts[0][0])} ${fmt(pts[0][1])}L${pts.slice(1).map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(' ')}`).join('');
    return `<path data-linija="${route}" d="${d}"/>`;
  }).join('\n    ');
  const viewBox = `${fmt(win.x0 * S)} ${fmt(win.y0 * S)} ${fmt(winW * S)} ${fmt(winH * S)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="shm" viewBox="${viewBox}" preserveAspectRatio="xMidYMid slice" role="img" aria-labelledby="shm-title shm-desc">
  <title id="shm-title">Shema tramvajske mreže ZET-a oko Trga bana J. Jelačića</title>
  <desc id="shm-desc">Pojednostavljeni oktilinearni prikaz ${routes.length} tramvajskih linija iz GTFS podataka ZET-a (inačica ${feedVersion}), izrezan oko središta mreže; bez pozadine i bez oznaka stanica. ${ZET_CREDIT}</desc>
  <style>.shm path{vector-effect:non-scaling-stroke}</style>
  <g fill="none" stroke="var(--tone-action-brand)" stroke-opacity="0.9" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    ${paths}
  </g>
</svg>
`;
  const bytes = Buffer.byteLength(svg);
  if (bytes > SIZE_CAP) throw new Error(`shema-tramvaji.svg is ${bytes} bytes, over the ${SIZE_CAP} cap`);
  const file = resolve(OUT, 'shema-tramvaji.svg');
  writeFileSync(file, svg);
  return { file, bytes, routes: routes.length, polylines, candidates, hub, viewBox };
}

// --- 3. Splice both into the kiosk mock --------------------------------------

/** `<!-- mk:svg NAME -->…<!-- /mk:svg -->` in m-kiosk.html takes the current file's markup, so a rebuild refreshes the mock in place. */
function splice(mockFile, names) {
  if (!existsSync(mockFile)) return { spliced: [] };
  let html = readFileSync(mockFile, 'utf8');
  const spliced = [];
  for (const name of names) {
    const re = new RegExp(`(<!-- mk:svg ${name.replace('.', '\\.')} -->)[\\s\\S]*?(<!-- /mk:svg -->)`);
    if (!re.test(html)) continue;
    const svg = readFileSync(resolve(OUT, name), 'utf8').trim();
    html = html.replace(re, `$1\n${svg}\n$2`);
    spliced.push(name);
  }
  writeFileSync(mockFile, html);
  return { spliced };
}

const qr = buildQr();
const shm = buildSchematic();
const sp = splice(KIOSK_MOCK, ['shema-tramvaji.svg', 'qr-s.svg']);
console.log(`qr-s.svg            ${qr.bytes} B`);
console.log(`shema-tramvaji.svg  ${shm.bytes} B · ${shm.routes} linija · ${shm.polylines} od ${shm.candidates} polilinija · hub (${shm.hub.x.toFixed(3)}, ${shm.hub.y.toFixed(3)}) s ${shm.hub.routes} linija · viewBox ${shm.viewBox}`);
console.log(sp.spliced.length ? `m-kiosk.html        umetnuto: ${sp.spliced.join(', ')}` : 'm-kiosk.html        nije nađen ili bez oznaka mk:svg; ništa umetnuto');
