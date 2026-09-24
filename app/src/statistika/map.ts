// The 17 gradske četvrti as a small SVG map, for "where" on /statistika/.
// The outlines are the same files the screen's district frame draws
// (app/public/data/kvart/<slug>.json, 88 kB for all 17), fetched only when the
// map is about to scroll into view. Plain equirectangular projection at the
// city's latitude: at this size and this far from the poles the difference
// from Web Mercator is under a pixel.
import { DISTRICTS } from '../kiosk/districts';
import { escapeHtml } from '../ui/dom/escape';
import { hideTip, showTip } from './charts';

type Ring = [number, number][];
export interface DistrictShape {
  slug: string;
  name: string;
  polygons: Ring[][];
}

const KVART = '/data/kvart';
const COS_LAT = Math.cos((45.81 * Math.PI) / 180);
let shapes: Promise<DistrictShape[]> | null = null;

/** All 17 outlines, fetched once; a district whose file fails is left out, never guessed. */
export function loadDistricts(): Promise<DistrictShape[]> {
  shapes ??= Promise.all(
    DISTRICTS.map(async (d): Promise<DistrictShape | null> => {
      try {
        const res = await fetch(`${KVART}/${d.slug}.json`);
        if (!res.ok) return null;
        const body = (await res.json()) as { polygons?: Ring[][] };
        return Array.isArray(body.polygons) ? { slug: d.slug, name: d.name, polygons: body.polygons } : null;
      } catch {
        return null;
      }
    }),
  ).then((list) => list.filter((d): d is DistrictShape => d !== null));
  return shapes;
}

interface Frame {
  minX: number;
  maxY: number;
  width: number;
  height: number;
  scale: number;
}

const WIDTH = 600;

function frameOf(districts: readonly DistrictShape[]): Frame {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const d of districts)
    for (const poly of d.polygons)
      for (const ring of poly)
        for (const [lon, lat] of ring) {
          const x = lon * COS_LAT;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, lat);
          maxY = Math.max(maxY, lat);
        }
  const scale = WIDTH / (maxX - minX);
  return { minX, maxY, width: WIDTH, height: Math.ceil((maxY - minY) * scale), scale };
}

function project(f: Frame, lon: number, lat: number): [number, number] {
  return [(lon * COS_LAT - f.minX) * f.scale, (f.maxY - lat) * f.scale];
}

function pathOf(f: Frame, d: DistrictShape): string {
  return d.polygons
    .map((poly) =>
      poly
        .map((ring) => ring.map(([lon, lat], i) => {
          const [x, y] = project(f, lon, lat);
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
        }).join('') + 'Z')
        .join(''),
    )
    .join('');
}

/** A district's fill step, 1 to 5, by its share of the largest published value. */
function step(value: number, max: number): number {
  return max > 0 ? Math.max(1, Math.ceil((value / max) * 5)) : 1;
}

export interface ChoroplethOptions {
  /** Published value per district slug; a district absent here published nothing. */
  values: ReadonlyMap<string, number>;
  label: string;
  describe: (name: string, value: number | null) => string;
}

/** The districts shaded by value; hovering one, or its bar in the list beside
 *  it (data-key), lights both. The map itself is decorative for assistive
 *  technology: the bar list says the same in text. */
export function choropleth(districts: readonly DistrictShape[], o: ChoroplethOptions, list?: HTMLElement): SVGSVGElement {
  const f = frameOf(districts);
  const max = Math.max(0, ...o.values.values());
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${f.width} ${f.height}`);
  svg.setAttribute('class', 'st-map');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', o.label);
  svg.innerHTML = districts
    .map((d) => {
      const v = o.values.get(d.slug);
      const cls = v === undefined ? 'st-area st-area-none' : `st-area st-ramp-fill-${step(v, max)}`;
      return `<path class="${cls}" data-key="${escapeHtml(d.slug)}" d="${pathOf(f, d)}"></path>`;
    })
    .join('');
  const light = (key: string | null): void => {
    svg.querySelectorAll('.is-lit').forEach((el) => el.classList.remove('is-lit'));
    list?.querySelectorAll('.is-lit').forEach((el) => el.classList.remove('is-lit'));
    if (key === null) return;
    svg.querySelector(`[data-key="${CSS.escape(key)}"]`)?.classList.add('is-lit');
    list?.querySelector(`[data-key="${CSS.escape(key)}"]`)?.classList.add('is-lit');
  };
  svg.addEventListener('pointerover', (e) => {
    const area = (e.target as Element).closest<SVGPathElement>('[data-key]');
    if (!area) return;
    const key = area.dataset.key ?? '';
    light(key);
    const d = districts.find((x) => x.slug === key);
    if (d) showTip(area.getBoundingClientRect(), escapeHtml(o.describe(d.name, o.values.get(key) ?? null)));
  });
  svg.addEventListener('pointerleave', () => {
    light(null);
    hideTip();
  });
  list?.addEventListener('pointerover', (e) => light((e.target as Element).closest<HTMLElement>('[data-key]')?.dataset.key ?? null));
  list?.addEventListener('pointerleave', () => light(null));
  return svg;
}

export interface Dot {
  lon: number;
  lat: number;
  /** 0 to 1: the dot's size among the others. */
  weight: number;
  label: string;
  rank: number;
}

/** The district outlines, quiet, with numbered dots where trams wait. The
 *  view is framed on the dots (at least 5 km wide), since the crossings that
 *  cost the most sit close together in the centre. */
export function dotMap(districts: readonly DistrictShape[], dots: readonly Dot[], label: string): SVGSVGElement {
  const f = frameOf(districts);
  const at = dots.map((d) => project(f, d.lon, d.lat));
  const xs = at.map((p) => p[0]);
  const ys = at.map((p) => p[1]);
  const minSpan = 5000 / (111_320 * COS_LAT) * COS_LAT * f.scale;
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  const padX = Math.max((minSpan - (x1 - x0)) / 2, (x1 - x0) * 0.2);
  x0 -= padX;
  x1 += padX;
  const width = x1 - x0;
  const height = Math.max(y1 - y0 + width * 0.3, width * 0.62);
  const cy = (y0 + y1) / 2;
  y0 = cy - height / 2;
  y1 = cy + height / 2;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `${x0.toFixed(1)} ${y0.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}`);
  svg.setAttribute('class', 'st-map st-map-dots');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const unit = width / 100;
  const outlines = districts.map((d) => `<path class="st-area st-area-quiet" vector-effect="non-scaling-stroke" d="${pathOf(f, d)}"/>`).join('');
  const circles = dots
    .map((d, i) => ({ d, p: at[i] }))
    .sort((a, b) => b.d.weight - a.d.weight)
    .map(({ d, p: [x, y] }) => {
      const r = unit * (2.2 + 2.6 * Math.sqrt(Math.max(0, Math.min(1, d.weight))));
      return (
        `<g class="st-dot" data-rank="${d.rank}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" vector-effect="non-scaling-stroke"/>` +
        `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" dy="0.35em" font-size="${(unit * 2.6).toFixed(1)}">${d.rank}</text></g>`
      );
    })
    .join('');
  svg.innerHTML = outlines + circles;
  svg.addEventListener('pointerover', (e) => {
    const g = (e.target as Element).closest<SVGGElement>('.st-dot');
    const dot = g ? dots.find((d) => String(d.rank) === g.dataset.rank) : undefined;
    if (g && dot) showTip(g.getBoundingClientRect(), escapeHtml(dot.label));
  });
  svg.addEventListener('pointerleave', hideTip);
  return svg;
}
