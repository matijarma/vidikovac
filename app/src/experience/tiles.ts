// The tile grammar of the time band (newdesignsystem.md §4.3, plan A.4): one
// `<a class="tl">` per fact, five variants under `data-variant`, the same
// children everywhere. label · value · context is the value tile (a line at
// the stop, the gazette number); time · label · title · context the time tile
// (what starts next) and, under the ink fill, the one Skupština tile; glyph ·
// main · trail the band (works now, the safety verdict) and the row (the news
// lead). The whole tile is the control and its hash is a real, restorable URL
// (selectionParams), so a tile is a link a reader can open, copy or send to
// the screen, never a JS-only button.
//
// Producers (experience/producers/*) describe a Tile; buildTimeband sorts,
// caps and marks stale; this module writes markup and nothing else. Text
// fields are escaped here; `labelMarkup`, `contextMarkup` and `stale` are
// markup other builders produced. Hover and press live in layers.css with the
// other controls; the tile inherits base.css's global focus ring.
import type { LayerId } from '../../../worker/protocol';
import { selectionParams, type PublicSelection } from '../core/contracts';
import { zagrebTime } from '../format';
import type { I18n } from '../i18n/i18n';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup, type IconName } from '../ui/icons';
import { attrs } from './blocks';

export type TileDomain = 'transit' | 'mobility' | 'komunalno' | 'safety' | 'events' | 'civic' | 'news';
export type TileVariant = 'value' | 'time' | 'band' | 'row' | 'ink';
/** The sada lane's reading order: what moves first, what the city decided last. */
export const DOMAIN_ORDER: readonly TileDomain[] = ['transit', 'mobility', 'komunalno', 'safety', 'news', 'civic'];
export type Bucket = 'sada' | 'danas' | 'veceras' | 'sutra' | 'tjedan';

export interface Tile {
  /** Reconciler identity: `<module>:<itemId>` or `<domain>:<slug>`. */
  key: string;
  domain: TileDomain;
  variant: TileVariant;
  /** Kicker text; the first aria part after the time. */
  label: string;
  /** Trusted markup replacing the kicker visually (transit: the .line badge); the label is still read aloud. */
  labelMarkup?: string;
  value?: string;
  valueSize?: 'xl' | 'l' | 'm';
  valueTone?: 'late' | 'early' | 'ontime' | 'none';
  /** A unit after the value ("min"), set at the secondary role and muted; read aloud with the value. */
  unit?: string;
  /** time/ink/band/row: the two-line clamp; a value tile carries it for the aria only (the line's destination). */
  title?: string;
  /** One line, never wraps. */
  context?: string;
  /** Trusted markup appended to the context (glyph + count, xs badges). */
  contextMarkup?: string;
  /** band/row glyph. */
  icon?: IconName;
  at?: string;
  until?: string;
  allDay?: boolean;
  /** Forced lane for live values. */
  bucket?: Bucket;
  tone?: 'komunalno' | 'events' | 'calm' | 'unknown' | 'urgent' | 'mobility';
  layer: LayerId;
  selection?: PublicSelection;
  /** A producer's own wording of the whole label; composed from the parts when absent. */
  aria?: string;
  testid?: string;
  /** Extra data-* attributes on the control (safety writes its level). */
  data?: Record<string, string>;
  /** Set by buildTimeband: the status badge markup that replaces the context. */
  stale?: string;
}

/** '#layer=…' plus the public selection as view-store writes it, so the hash restores the same place. */
export function tileHref(layer: LayerId, selection?: PublicSelection): string {
  const params = selectionParams(selection ?? null);
  return params ? `#layer=${layer}&${new URLSearchParams(params).toString()}` : `#layer=${layer}`;
}

/** The words of a badge another builder wrote, for the aria label: tags off, escapeHtml's five entities back to text. */
function markupText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * The tile read aloud in the order the eye takes it: the time when the tile
 * shows one, then label, title, value and context, whatever is present. A
 * producer may word the whole label itself (`tile.aria`); a stale tile adds
 * the badge's own word, so a reader hears exactly what the badge says. A
 * caller that renders its own time line passes its text; an all-day tile
 * says "cijeli dan" even when the caller passed none.
 */
export function tileAria(i18n: I18n, tile: Tile, timeText: string): string {
  const time = timeText || (tile.allDay && (tile.variant === 'time' || tile.variant === 'ink') ? i18n.t('time.allDay') : '');
  const base = tile.aria ?? [time, tile.label, tile.title, valueText(tile), tile.context].filter(Boolean).join(', ');
  const stale = tile.stale ? markupText(tile.stale) : '';
  return stale ? `${base}, ${stale}` : base;
}

/** The value with its unit, as one phrase: "kasni 2 min"; the value alone without a unit. */
function valueText(tile: Tile): string {
  if (!tile.value) return '';
  return tile.unit ? `${tile.value} ${tile.unit}` : tile.value;
}

/** The visible time of a time or ink tile: the all-day word, or the Zagreb clock of `at`; '' otherwise. */
function timeTextOf(i18n: I18n, tile: Tile): string {
  if (tile.variant !== 'time' && tile.variant !== 'ink') return '';
  if (tile.allDay) return i18n.t('time.allDay');
  return tile.at ? zagrebTime(tile.at) : '';
}

function timeMarkup(tile: Tile, text: string): string {
  if (!text) return '';
  if (tile.allDay) return `<span class="tl-time" data-allday>${escapeHtml(text)}</span>`;
  return `<time class="tl-time" datetime="${escapeAttribute(tile.at)}">${escapeHtml(text)}</time>`;
}

/** The kicker, or the badge another builder wrote; a value tile with a badge shows its title beside it (the line's two ends), one line, ellipsised. */
function labelMarkup(tile: Tile): string {
  if (!tile.labelMarkup) return `<span class="tl-label kicker">${escapeHtml(tile.label)}</span>`;
  const title = tile.variant === 'value' && tile.title ? `<span class="tl-label-title">${escapeHtml(tile.title)}</span>` : '';
  return `<span class="tl-label">${tile.labelMarkup}${title}</span>`;
}

function titleMarkup(tile: Tile): string {
  return tile.title ? `<span class="tl-title">${escapeHtml(tile.title)}</span>` : '';
}

/**
 * The value line, marked for the reconciler: the node is swapped (and the
 * crossfade replays) only when its text changes. A unit ("min") follows the
 * number in its own span at the secondary role, with the space inside the
 * span, so the line's text stays the whole phrase.
 */
function valueMarkup(tile: Tile): string {
  if (!tile.value) return '';
  const state = tile.valueTone ? ` data-state="${tile.valueTone}"` : '';
  const unit = tile.unit ? `<span class="tl-unit"> ${escapeHtml(tile.unit)}</span>` : '';
  return `<span class="tl-value" data-size="${tile.valueSize ?? 'l'}"${state} data-replace data-sig="${escapeAttribute(valueText(tile))}">${escapeHtml(tile.value)}${unit}</span>`;
}

/** The context line of a value, time or ink tile; a stale tile shows the status badge in its place. */
function contextMarkup(tile: Tile): string {
  if (tile.stale) return `<span class="tl-context">${tile.stale}</span>`;
  if (!tile.context && !tile.contextMarkup) return '';
  const text = tile.context ? `<span class="tl-ctx-text">${escapeHtml(tile.context)}</span>` : '';
  return `<span class="tl-context">${text}${tile.contextMarkup ?? ''}</span>`;
}

function glyphMarkup(tile: Tile): string {
  return tile.icon ? iconMarkup(tile.icon, undefined, 'icon tl-glyph') : '';
}

function trailMarkup(inner: string): string {
  return inner ? `<span class="tl-trail">${inner}</span>` : '';
}

function bodyMarkup(tile: Tile, timeText: string): string {
  switch (tile.variant) {
    case 'value':
      return `${labelMarkup(tile)}${valueMarkup(tile)}${contextMarkup(tile)}`;
    case 'time':
    case 'ink':
      return `${timeMarkup(tile, timeText)}${labelMarkup(tile)}${titleMarkup(tile)}${contextMarkup(tile)}`;
    case 'band':
      // The trail is the value: a count of works, or when the calm verdict was confirmed.
      return `${glyphMarkup(tile)}<span class="tl-main">${labelMarkup(tile)}${titleMarkup(tile)}${tile.stale ?? ''}</span>${trailMarkup(escapeHtml(tile.value ?? ''))}`;
    case 'row':
      // The label is heard, not shown; the trail is the context (source and age).
      return `${glyphMarkup(tile)}<span class="tl-main">${titleMarkup(tile)}${tile.stale ?? ''}</span>${trailMarkup(`${escapeHtml(tile.context ?? '')}${tile.contextMarkup ?? ''}`)}`;
  }
}

/** One tile: the control, its restorable hash, its label for AT, its variant's children. */
export function tileMarkup(i18n: I18n, tile: Tile): string {
  const timeText = timeTextOf(i18n, tile);
  const extra = Object.fromEntries(Object.entries(tile.data ?? {}).map(([k, v]) => [`data-${k}`, v]));
  const root = attrs({
    class: 'tl',
    'data-variant': tile.variant,
    'data-domain': tile.domain,
    'data-tone': tile.tone,
    ...extra,
    'data-stale': tile.stale ? true : undefined,
    'data-key': tile.key,
    'data-testid': tile.testid,
    href: tileHref(tile.layer, tile.selection),
    'data-action': 'nav',
    'data-layer': tile.layer,
    'data-selection': tile.selection ? JSON.stringify(tile.selection) : undefined,
    'aria-label': tileAria(i18n, tile, timeText),
  });
  return `<a ${root}>${bodyMarkup(tile, timeText)}</a>`;
}

/**
 * The shape a source is about to fill, in the box the finished tile will have
 * (signage.css sizes each bar to its type role's line). Hidden from AT and no
 * control: the lane carries `aria-busy` and one visually hidden loading word.
 */
export function skeletonTileMarkup(variant: TileVariant, key: string): string {
  const bar = (role: string): string => `<span class="sk tl-sk-${role}"></span>`;
  const inner = variant === 'value' ? `${bar('label')}${bar('value')}${bar('context')}`
    : variant === 'band' ? `${bar('glyph')}<span class="tl-main">${bar('label')}${bar('title1')}</span>`
      : variant === 'row' ? `${bar('glyph')}<span class="tl-main">${bar('title1')}</span>${bar('context')}`
        : `${bar('time')}${bar('label')}${bar('title')}${bar('context')}`;
  return `<div class="tl" data-variant="${variant}" data-skeleton data-key="${escapeAttribute(key)}" aria-hidden="true">${inner}</div>`;
}
