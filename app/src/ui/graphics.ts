// Inline SVG figures that encode actual data only: a measured value on a
// forecast range, a computed sun path, wind from the station's own reading,
// recorded magnitudes, phases counted in the shown set. Pure string
// builders; every figure is marked `data-replace` with a signature so the
// reconciler swaps it only when its data changed. Colours come from CSS
// (currentColor and role tokens), so light, dark and solar update live.
//
// A figure's SVG draws geometry only (tracks, fills, markers, dials); any
// number a person actually reads (a range's min/max/now, a bar's value, a
// sun time, a distance ring) is HTML text beside it, sized in the type
// tokens (rem), so it grows with the reader's own text zoom the way the
// SVG's internal px-based `<text>` never could (finding 6). `wrap()` is the
// one place that carries `data-replace`/`data-sig`, so every figure builder
// still swaps wholesale on a signature change, whatever moved inside it.
import { escapeAttribute, escapeHtml } from './dom/escape';

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();

/**
 * `ring()`'s own builder: its sole caller (experience/chrome.ts, area S)
 * sizes the returned element as a direct flex child of the session chip via
 * dashboard.css's `.g-ring { flex: none }`; wrapping it would move that flex
 * item one level down and change what the rule targets. `ring()` has no
 * readable number to move to HTML, so it keeps data-replace on the `<svg>`
 * itself, unlike every other figure below.
 */
function svg(className: string, viewBox: string, body: string, sig: string, label?: string): string {
  const a11y = label
    ? `role="img" aria-label="${escapeAttribute(label)}"`
    : 'aria-hidden="true"';
  return `<svg class="g ${escapeAttribute(className)}" viewBox="${viewBox}" ${a11y} focusable="false" data-replace data-sig="${escapeAttribute(sig)}">${body}</svg>`;
}

/** An SVG figure's geometry only, no `data-replace`: `wrap()` carries that on the outer element. */
function figureSvg(className: string, viewBox: string, body: string, label?: string): string {
  const a11y = label
    ? `role="img" aria-label="${escapeAttribute(label)}"`
    : 'aria-hidden="true"';
  return `<svg class="g ${escapeAttribute(className)}" viewBox="${viewBox}" ${a11y} focusable="false">${body}</svg>`;
}

/** The element the reconciler swaps wholesale on a signature change. */
function wrap(kind: string, sig: string, inner: string): string {
  return `<div class="g-wrap g-wrap-${escapeAttribute(kind)}" data-replace data-sig="${escapeAttribute(sig)}">${inner}</div>`;
}

/**
 * The HTML numbers beside a figure's SVG. Marked `aria-hidden`: the SVG
 * keeps the one accessible name (its `aria-label`) that already reads the
 * whole figure as a sentence, so a screen reader is not told the same
 * numbers twice; a sighted reader at 200% text sees them grow because they
 * are real text in a type role, not SVG geometry.
 */
function htmlLabels(spans: string): string {
  return `<div class="g-labels" aria-hidden="true">${spans}</div>`;
}

function text(x: number, y: number, value: string, className: string, anchor: 'start' | 'middle' | 'end' = 'middle'): string {
  return `<text x="${fmt(x)}" y="${fmt(y)}" class="${className}" text-anchor="${anchor}">${escapeHtml(value)}</text>`;
}

/** A point on a circle; angleDeg is compass style, 0 at the top, clockwise. */
export function polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const a = polar(cx, cy, r, fromDeg);
  const b = polar(cx, cy, r, toDeg);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${fmt(a.x)} ${fmt(a.y)} A ${fmt(r)} ${fmt(r)} 0 ${large} 1 ${fmt(b.x)} ${fmt(b.y)}`;
}

export interface RangeBarOptions {
  min: number;
  max: number;
  /** The current measurement; omitted when the station has none. */
  now?: number | null;
  minLabel: string;
  maxLabel: string;
  nowLabel?: string;
  label?: string;
}

/** Today's forecast range as a segment on a wider scale, with the measured value as a marker; min, max and now are HTML beside the track. */
export function rangeBar(o: RangeBarOptions): string {
  const W = 320;
  const pad = 4;
  const lo = Math.min(o.min, o.now ?? o.min) - pad;
  const hi = Math.max(o.max, o.now ?? o.max) + pad;
  const span = Math.max(1, hi - lo);
  const x = (v: number): number => 16 + ((v - lo) / span) * (W - 32);
  const y = 34;
  let body = `<rect class="g-track" x="16" y="${y - 4}" width="${W - 32}" height="8" rx="4"/>`;
  body += `<rect class="g-fill g-fill-weather" x="${fmt(x(o.min))}" y="${y - 4}" width="${fmt(Math.max(4, x(o.max) - x(o.min)))}" height="8" rx="4"/>`;
  let nowLabel = '';
  if (o.now !== undefined && o.now !== null) {
    const nx = x(o.now);
    body += `<line class="g-marker" x1="${fmt(nx)}" y1="${y - 12}" x2="${fmt(nx)}" y2="${y + 8}"/><circle class="g-dot" cx="${fmt(nx)}" cy="${y}" r="5"/>`;
    if (o.nowLabel) {
      const pct = Math.min(100, Math.max(0, (nx / W) * 100));
      nowLabel = `<span class="g-label-now" style="left:${fmt(pct)}%">${escapeHtml(o.nowLabel)}</span>`;
    }
  }
  const figure = figureSvg('g-range', `0 0 ${W} 60`, body, o.label);
  const labels = htmlLabels(`<span class="g-label-min">${escapeHtml(o.minLabel)}</span>${nowLabel}<span class="g-label-max">${escapeHtml(o.maxLabel)}</span>`);
  return wrap('range', `${o.min}|${o.max}|${o.now ?? ''}|${o.nowLabel ?? ''}`, figure + labels);
}

export interface ArcGaugeOptions {
  /** 0..1 */
  fraction: number;
  value: string;
  caption: string;
  tone?: 'weather' | 'action' | 'transit';
  label?: string;
}

/** A half-ring gauge for a bounded quantity (humidity, a share of a set). */
export function arcGauge(o: ArcGaugeOptions): string {
  const f = Math.min(1, Math.max(0, o.fraction));
  const cx = 60;
  const cy = 58;
  const r = 44;
  let body = `<path class="g-track-stroke" d="${arcPath(cx, cy, r, 270, 450)}"/>`;
  if (f > 0) body += `<path class="g-fill-stroke g-fill-${o.tone ?? 'weather'}" d="${arcPath(cx, cy, r, 270, 270 + 180 * f)}"/>`;
  body += text(cx, cy - 6, o.value, 'g-value', 'middle');
  body += text(cx, cy + 12, o.caption, 'g-label', 'middle');
  const figure = figureSvg('g-arc', '0 0 120 72', body, o.label);
  return wrap('arc', `${f.toFixed(3)}|${o.value}|${o.caption}`, figure);
}

/** A thin ring showing a remaining fraction (the session chip). */
export function ring(fraction: number, label?: string): string {
  const f = Math.min(1, Math.max(0, fraction));
  const pct = Math.round(f * 1000) / 10;
  const body =
    `<circle class="g-track-stroke" cx="18" cy="18" r="15.9"/>` +
    `<circle class="g-fill-stroke g-fill-action" cx="18" cy="18" r="15.9" stroke-dasharray="${fmt(pct)} 100" transform="rotate(-90 18 18)"/>`;
  return svg('g-ring', '0 0 36 36', body, String(pct), label);
}
export interface SunPathOptions {
  sunrise: number;
  sunset: number;
  now: number;
  sunriseLabel: string;
  sunsetLabel: string;
  noonLabel: string;
  label?: string;
}

/** The sun's computed path for the day, with its position now; below the horizon at night. Sunrise, noon and sunset times are HTML beside the arc. */
export function sunPath(o: SunPathOptions): string {
  const W = 320;
  const hy = 84;
  const cx = 160;
  const rx = 132;
  const ry = 62;
  const day = o.sunset - o.sunrise;
  let f = day > 0 ? (o.now - o.sunrise) / day : 0.5;
  let up = f >= 0 && f <= 1;
  if (!up) {
    // Night: from sunset to the next sunrise (a day later), mirrored under the horizon.
    const nightStart = o.now > o.sunset ? o.sunset : o.sunset - 86_400_000;
    const nightEnd = o.now > o.sunset ? o.sunrise + 86_400_000 : o.sunrise;
    f = nightEnd > nightStart ? (o.now - nightStart) / (nightEnd - nightStart) : 0.5;
    up = false;
  }
  const angle = Math.PI * Math.min(1, Math.max(0, f));
  const sx = cx - rx * Math.cos(angle);
  const sy = up ? hy - ry * Math.sin(angle) : hy + 26 * Math.sin(angle);
  let body = `<path class="g-path" d="M ${cx - rx} ${hy} A ${rx} ${ry} 0 0 1 ${cx + rx} ${hy}"/>`;
  body += `<line class="g-horizon" x1="8" y1="${hy}" x2="${W - 8}" y2="${hy}"/>`;
  body += `<line class="g-tick" x1="${cx}" y1="${hy - ry - 4}" x2="${cx}" y2="${hy - ry + 4}"/>`;
  body += `<circle class="g-sun-halo" cx="${fmt(sx)}" cy="${fmt(sy)}" r="12"/><circle class="g-sun${up ? '' : ' g-sun-down'}" cx="${fmt(sx)}" cy="${fmt(sy)}" r="7"/>`;
  const figure = figureSvg('g-sun', `0 0 ${W} 112`, body, o.label);
  const labels = htmlLabels(`<span>${escapeHtml(o.sunriseLabel)}</span><span>${escapeHtml(o.noonLabel)}</span><span>${escapeHtml(o.sunsetLabel)}</span>`);
  return wrap('sun', `${Math.round(o.sunrise / 60000)}|${Math.round(o.sunset / 60000)}|${Math.round(o.now / 60000)}`, figure + labels);
}

export interface CompassOptions {
  /** Where the wind comes from, compass degrees; null when calm or unknown. */
  bearing: number | null;
  value: string;
  caption: string;
  /** The four cardinal letters in the reader's language, N E S W order. */
  letters: [string, string, string, string];
  label?: string;
}

/** Wind: the reading's own direction as an arrow blowing towards the centre, speed inside. */
export function compass(o: CompassOptions): string {
  const c = 60;
  const r = 46;
  let body = `<circle class="g-track-stroke" cx="${c}" cy="${c}" r="${r}"/>`;
  o.letters.forEach((letter, index) => {
    const p = polar(c, c, r + 9, index * 90);
    body += text(p.x, p.y + 3, letter, 'g-label', 'middle');
  });
  for (let deg = 45; deg < 360; deg += 90) {
    const a = polar(c, c, r - 3, deg);
    const b = polar(c, c, r + 3, deg);
    body += `<line class="g-tick" x1="${fmt(a.x)}" y1="${fmt(a.y)}" x2="${fmt(b.x)}" y2="${fmt(b.y)}"/>`;
  }
  if (o.bearing !== null) {
    const from = polar(c, c, r - 2, o.bearing);
    const tip = polar(c, c, 22, o.bearing);
    const left = polar(tip.x, tip.y, 7, o.bearing + 150);
    const right = polar(tip.x, tip.y, 7, o.bearing + 210);
    body += `<line class="g-arrow" x1="${fmt(from.x)}" y1="${fmt(from.y)}" x2="${fmt(tip.x)}" y2="${fmt(tip.y)}"/>`;
    body += `<polygon class="g-arrow-head" points="${fmt(tip.x)},${fmt(tip.y)} ${fmt(left.x)},${fmt(left.y)} ${fmt(right.x)},${fmt(right.y)}"/>`;
    body += `<circle class="g-dot" cx="${fmt(from.x)}" cy="${fmt(from.y)}" r="4"/>`;
  }
  body += text(c, c + 3, o.value, 'g-value', 'middle');
  body += text(c, c + 17, o.caption, 'g-label', 'middle');
  const figure = figureSvg('g-compass', '0 0 120 120', body, o.label);
  return wrap('compass', `${o.bearing ?? 'calm'}|${o.value}|${o.caption}|${o.letters.join('')}`, figure);
}
export interface BarRow {
  id: string;
  label: string;
  value: number;
  /** Printed at the end of the bar. */
  valueText: string;
  caption?: string;
  tone?: 'urgency' | 'weather' | 'events' | 'action' | 'transit' | 'neutral';
}

/** Horizontal bars on one fixed scale, so rows stay comparable across polls. Labels and values are HTML rows; there is no SVG. */
export function bars(rows: readonly BarRow[], max: number, label?: string, labelWidth = 96): string {
  const items = rows
    .map((row) => {
      const pct = Math.max(1, Math.min(100, (Math.min(row.value, max) / Math.max(1, max)) * 100));
      const caption = row.caption ? `<span class="g-bar-caption">${escapeHtml(row.caption)}</span>` : '';
      return `<li><span class="g-bar-label">${escapeHtml(row.label)}</span><span class="g-bar-track"><span class="g-bar-fill" data-tone="${escapeAttribute(row.tone ?? 'neutral')}" style="inline-size:${fmt(pct)}%"></span></span><span class="g-bar-value">${escapeHtml(row.valueText)}</span>${caption}</li>`;
    })
    .join('');
  const sig = rows.map((r) => `${r.id}:${r.value}:${r.valueText}`).join('|');
  const attrLabel = label ? ` aria-label="${escapeAttribute(label)}"` : '';
  return `<ol class="g-bars" role="list" data-replace data-sig="${escapeAttribute(`${max}|${sig}`)}"${attrLabel} style="--bar-label-w:${fmt(labelWidth / 16)}rem">${items}</ol>`;
}

export interface RadarPoint {
  id: string;
  distanceKm: number;
  bearingDeg: number;
  /** Magnitude, sizes the dot. */
  size: number;
  title: string;
}

export interface RadarOptions {
  points: readonly RadarPoint[];
  maxKm: number;
  /** Ring labels from the inner ring outwards, e.g. ['50 km','100 km','150 km']. */
  rings: readonly string[];
  centreLabel: string;
  label?: string;
}

/** Places recorded quakes by their own distance and bearing from Zagreb, no basemap needed. Ring distances and the centre name are HTML beside the dial. */
export function radar(o: RadarOptions): string {
  const c = 120;
  const R = 100;
  let body = '';
  o.rings.forEach((_ringLabel, index) => {
    const r = (R * (index + 1)) / o.rings.length;
    body += `<circle class="g-track-stroke g-ring-line" cx="${c}" cy="${c}" r="${fmt(r)}"/>`;
  });
  body += `<line class="g-tick" x1="${c}" y1="${c - R}" x2="${c}" y2="${c + R}"/><line class="g-tick" x1="${c - R}" y1="${c}" x2="${c + R}" y2="${c}"/>`;
  for (const p of o.points) {
    const r = Math.min(R, (p.distanceKm / o.maxKm) * R);
    const pos = polar(c, c, r, p.bearingDeg);
    const size = 3 + Math.max(0, p.size) * 1.6;
    body += `<circle class="g-dot g-dot-urgency" data-key="${escapeAttribute(p.id)}" cx="${fmt(pos.x)}" cy="${fmt(pos.y)}" r="${fmt(size)}"><title>${escapeHtml(p.title)}</title></circle>`;
  }
  body += `<circle class="g-centre" cx="${c}" cy="${c}" r="4"/>`;
  const figure = figureSvg('g-radar', '0 0 240 240', body, o.label);
  const labels = htmlLabels(`${o.rings.map((r) => `<span>${escapeHtml(r)}</span>`).join('')}<span>${escapeHtml(o.centreLabel)}</span>`);
  const sig = o.points.map((p) => `${p.id}:${p.distanceKm.toFixed(0)}:${p.bearingDeg.toFixed(0)}`).join('|');
  return wrap('radar', `${o.maxKm}|${sig}`, figure + labels);
}
