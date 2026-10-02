// Two SVG minimaps, now and the comparison day, drawn into an element the
// shell provides (plan section 3.3, decision S-17): the main shapes of the
// recorded network simplified once at RDP_TOLERANCE_M, one <path> per route,
// its state (alive, dead, quiet) a class re-applied once per five-minute
// sample from the window's routes and from the weekday-matched comparison
// day aligned by time of day. No second MapLibre instance. On the map graph:
// load it with `import('./minimap')` beside map-layer.ts, never statically
// from the entry; its sheet (ui/snimka-minimap.css) is linked by app/snimka/index.html like every snimka sheet.
import type { XY } from '../../../shared/motion/geo';
import { decodeNetwork, mainShapes, type Network } from '../../../shared/motion/network';
import { ZAGREB_OFFSET_S } from '../../../shared/snimka';
import { comparisonFor, type SnimkaContext } from './context';
import type { MountMinimaps, Subject } from './contracts';
import { aliveStates, routeSlotAt, scheduledCount, liveCounts, type AliveState, type RouteStates } from './live-network';
import { zagrebDay } from './format';
import { SN, fill } from './strings';
import { comparisonDayLabel } from './subject';

/** Ramer-Douglas-Peucker tolerance in metres: 20,711 main-shape points come down to about 6,900 (plan section 3.3). */
export const RDP_TOLERANCE_M = 25;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Ramer-Douglas-Peucker over a plane polyline, iterative (a long shape never recurses deep), both ends kept. */
export function simplifyRdp(pts: readonly XY[], tolerance: number): XY[] {
  if (pts.length <= 2) return [...pts];
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const tol2 = tolerance * tolerance;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    const A = pts[a]!;
    const B = pts[b]!;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = tol2;
    for (let i = a + 1; i < b; i++) {
      const P = pts[i]!;
      let d2: number;
      if (len2 === 0) d2 = (P.x - A.x) ** 2 + (P.y - A.y) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2));
        d2 = (P.x - (A.x + t * dx)) ** 2 + (P.y - (A.y + t * dy)) ** 2;
      }
      if (d2 > bestD) { bestD = d2; best = i; }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

export interface MinimapRoute { id: string; kind: 'tram' | 'bus'; d: string; points: number }
export interface MinimapGeometry { routes: MinimapRoute[]; viewBox: string }

/** One SVG path per route of the file that the network carries (file order), its main shapes simplified; y points down. */
export function minimapGeometry(net: Pick<Network, 'routes' | 'shapes'>, routeIds: readonly { id: string; type: 0 | 3 }[], tolerance = RDP_TOLERANCE_M): MinimapGeometry {
  const routes: MinimapRoute[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const route of routeIds) {
    const parts: string[] = [];
    let points = 0;
    for (const idx of mainShapes(net, route.id)) {
      const shape = net.shapes[idx];
      if (!shape || shape.pts.length < 2) continue;
      const simple = simplifyRdp(shape.pts, tolerance);
      points += simple.length;
      parts.push(simple.map((p, i) => {
        const x = Math.round(p.x);
        const y = Math.round(-p.y);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        return `${i === 0 ? 'M' : 'L'}${x} ${y}`;
      }).join(''));
    }
    if (parts.length === 0) continue;
    routes.push({ id: route.id, kind: route.type === 0 ? 'tram' : 'bus', d: parts.join(''), points });
  }
  const pad = 200;
  const viewBox = routes.length ? `${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}` : '0 0 1 1';
  return { routes, viewBox };
}

const STATE_CLASSES: AliveState[] = ['alive', 'dead', 'quiet'];

interface Side { svg: SVGSVGElement; name: HTMLElement; count: HTMLElement; paths: Map<string, SVGPathElement>; lastSlot: number; lastFile: object | null }

export const mountMinimaps: MountMinimaps = (ctx, host, opts) => {
  const { doc, frames, view } = ctx;
  let disposed = false;
  const root = doc.createElement('div');
  root.className = 'sn-mm';
  root.dataset.snMinimaps = 'loading';

  function side(cls: string): Side {
    const figure = doc.createElement('figure');
    figure.className = `sn-mm-side ${cls}`;
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'sn-mm-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('viewBox', '0 0 1 1');
    const caption = doc.createElement('figcaption');
    caption.className = 'sn-mm-caption';
    const name = doc.createElement('span');
    name.className = 'sn-mm-name';
    const count = doc.createElement('span');
    count.className = 'sn-mm-count';
    caption.append(name, count);
    figure.append(svg, caption);
    root.append(figure);
    return { svg, name, count, paths: new Map(), lastSlot: -2, lastFile: null };
  }
  const nowSide = side('sn-mm-now');
  const normalSide = side('sn-mm-normal');
  nowSide.name.textContent = fill(SN.twins.now, { day: zagrebDay(ctx.manifest.window.fromSec * 1000) });
  if (opts.large) {
    const legend = doc.createElement('ul');
    legend.className = 'sn-mm-legend';
    legend.setAttribute('aria-label', SN.twins.title);
    for (const state of STATE_CLASSES) {
      const li = doc.createElement('li');
      const swatch = doc.createElement('span');
      swatch.className = 'sn-mm-swatch';
      swatch.dataset.state = state;
      swatch.setAttribute('aria-hidden', 'true');
      li.append(swatch, SN.legend[state]);
      legend.append(li);
    }
    root.append(legend);
  }
  host.append(root);

  function draw(s: Side, geometry: MinimapGeometry): void {
    s.svg.setAttribute('viewBox', geometry.viewBox);
    s.paths.clear();
    // Buses first, trams over them: the tram network is the picture, the buses its ground.
    for (const route of [...geometry.routes.filter((r) => r.kind === 'bus'), ...geometry.routes.filter((r) => r.kind === 'tram')]) {
      const path = doc.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', `sn-mm-route sn-mm-${route.kind} sn-mm-quiet`);
      path.setAttribute('d', route.d);
      path.dataset.route = route.id;
      s.svg.append(path);
      s.paths.set(route.id, path);
    }
    s.svg.dataset.snMmPaths = String(s.paths.size);
  }

  function apply(s: Side, states: RouteStates): void {
    for (const [id, path] of s.paths) {
      const state = states.get(id) ?? 'quiet';
      for (const c of STATE_CLASSES) path.classList.toggle(`sn-mm-${c}`, c === state);
    }
  }

  function outline(subject: Subject | null): void {
    const routeId = subject?.kind === 'route' ? subject.id : null;
    for (const s of [nowSide, normalSide]) for (const [id, path] of s.paths) path.classList.toggle('sn-mm-subject', id === routeId);
    if (routeId) root.dataset.snMmSubject = routeId; else delete root.dataset.snMmSubject;
  }

  let ready = false;
  function update(t: number): void {
    if (disposed || !ready) return;
    const atSec = t / 1000;
    const nowSlot = routeSlotAt(ctx.routes, atSec);
    if (nowSlot !== nowSide.lastSlot) {
      nowSide.lastSlot = nowSlot;
      const states = aliveStates(ctx.routes, atSec);
      apply(nowSide, states);
      const counts = liveCounts(states);
      nowSide.name.textContent = fill(SN.twins.now, { day: zagrebDay(t) });
      nowSide.count.textContent = fill(SN.twins.count, { alive: counts.alive, scheduled: Math.max(scheduledCount(ctx.routes, atSec), counts.alive) });
      nowSide.svg.dataset.snMmAlive = String(counts.alive);
    }
    const c = comparisonFor(ctx, atSec);
    const tod = (((Math.floor(atSec) + ZAGREB_OFFSET_S) % 86_400) + 86_400) % 86_400;
    const cAt = c.fromSec + tod;
    const cSlot = routeSlotAt(c.routes, cAt);
    if (cSlot !== normalSide.lastSlot || c.routes !== normalSide.lastFile) {
      normalSide.lastSlot = cSlot;
      normalSide.lastFile = c.routes;
      const states = aliveStates(c.routes, cAt);
      apply(normalSide, states);
      const counts = liveCounts(states);
      normalSide.name.textContent = fill(SN.twins.normal, { day: comparisonDayLabel(c) });
      normalSide.count.textContent = fill(SN.twins.count, { alive: counts.alive, scheduled: Math.max(scheduledCount(c.routes, cAt), counts.alive) });
      normalSide.svg.dataset.snMmAlive = String(counts.alive);
      normalSide.svg.setAttribute('aria-label', `${SN.twins.title}: ${normalSide.name.textContent}`);
    }
  }
  nowSide.svg.setAttribute('aria-label', `${SN.twins.title}: ${nowSide.name.textContent}`);

  void ctx.data.get(ctx.manifest.networks['396'], decodeNetwork).then((net) => {
    if (disposed) return;
    const geometry = minimapGeometry(net, ctx.routes.routes);
    draw(nowSide, geometry);
    draw(normalSide, geometry);
    ready = true;
    root.dataset.snMinimaps = 'ready';
    outline(view.get().subject);
    update(ctx.clock.now());
  }, () => {
    if (!disposed) root.dataset.snMinimaps = 'unavailable';
  });

  const offFrames = frames.subscribe(update);
  const offView = view.onChange((next, prev) => { if (next.subject !== prev.subject) outline(next.subject); });

  return () => {
    disposed = true;
    offView();
    offFrames();
    root.remove();
  };
};
