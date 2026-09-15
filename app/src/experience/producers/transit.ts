// u-pokretu's sada lines (plan A.6): the reader's saved lines first, the
// screen's stop routes as the fallback that fills the cap, or (without a
// stop) the lines deviating most right now. Never a next-vehicle time, never
// the fleet count (that word is the honest-data line, not a tile): the only
// number on a transit tile is the delay word delayWord() already renders,
// and the vehicle count beside it is a glyph plus a figure, not "vozila".
// The tile says which line, between which ends, in what state, how many
// vehicles are out and at which stop (kajimafix 01.2, 01.3): badge and the
// line's ends on the label line, the state word large with its unit small,
// the glyph, the count and the stop's name on the context line.
import { ZET_ROUTES } from '../../data/routes';
import type { I18n } from '../../i18n/i18n';
import { dataText } from '../../panels/panel';
import { escapeHtml } from '../../ui/dom/escape';
import { iconMarkup } from '../../ui/icons';
import { delayWord } from '../../layers/shared';
import { routeDelays, type RouteDelay } from '../../layers/u-pokretu';
import type { LayerContext } from '../../layers/types';
import { routeEnds } from '../../transport/catalogue';
import { lineBadge } from '../blocks';
import { delayTone, splitUnit } from '../delay';
import type { TileProducer } from '../timeband';
import type { Tile } from '../tiles';

/** `ZET_ROUTES[id].type` is the GTFS route_type (0 tram, 3 bus); anything else reads as `'other'`. */
function lineKind(id: string): 'tram' | 'bus' | 'other' {
  const type = ZET_ROUTES[id]?.type;
  return type === 0 ? 'tram' : type === 3 ? 'bus' : 'other';
}

/**
 * Saved routes, read structurally: `ExperienceActions.saved` (T2.5) is not
 * yet a field of `LayerContext` in this worktree (merge order runs A before
 * S). The shape read here — `list(): { kind, id }[]` — matches T2.5's
 * `SavedStore` exactly, so this becomes a plain read once that field lands;
 * absent today, it reads as no saved lines, never a thrown error.
 */
function savedRouteIds(ctx: LayerContext): string[] {
  const saved = (ctx as LayerContext & { saved?: { list(): readonly { kind: string; id: string }[] } }).saved;
  return (saved?.list() ?? []).filter((r) => r.kind === 'route').map((r) => r.id);
}

function lineTile(i18n: I18n, id: string, byId: Map<string, RouteDelay>, stop: { name: string } | undefined): Tile {
  const row = byId.get(id);
  const delay = row?.meanDelay;
  const route = ZET_ROUTES[id];
  const kind = lineKind(id);
  const line = route?.shortName ?? id;
  const ends = route?.longName ? routeEnds(route.longName) : '';
  const word = delay === undefined ? i18n.t('transit.noDelayData') : delayWord(i18n, delay);
  const { value, unit } = splitUnit(word);
  const count = row?.count;
  const label = i18n.t('tiles.line', { line });
  const aria = [label, ends, word, count ? i18n.t('panels.vehiclesCount', { count }) : '', row ? stop?.name ?? '' : '']
    .filter(Boolean)
    .join(', ');
  // The context is the vehicles glyph, the count and the stop the count is read from; without a row there is nothing to count.
  const context = row ? [String(count), stop?.name].filter(Boolean).join(' · ') : '';
  return {
    key: `zet-rt:route:${id}`,
    domain: 'transit',
    variant: 'value',
    label,
    labelMarkup: lineBadge(line, kind, 's'),
    title: ends || undefined,
    value,
    unit,
    // The state word stands at l (the concept's own 24 px; xl ellipsised "kasni 5 min" in a half-width tile), the unit small beside it; "nema podataka" steps down to m so it never ellipsises.
    valueSize: word.length > 11 ? 'm' : 'l',
    valueTone: delayTone(i18n, delay),
    contextMarkup: row ? `${iconMarkup(kind === 'bus' ? 'bus-front' : 'tram-front')}<span class="tl-ctx-text">${escapeHtml(context)}</span>` : undefined,
    // The notification band (T3.3) reads a saved line's delay off the tile itself, in whole
    // seconds; absent without a row, exactly where the value already says "nema podataka".
    data: row ? { delay: String(delay) } : undefined,
    aria,
    layer: 'u-pokretu',
    selection: { kind: 'route', id },
    bucket: 'sada',
    testid: 'tile-transit',
  };
}

export const transitProducer: TileProducer = {
  domain: 'transit',
  modules: ['zet-rt'],
  layer: 'u-pokretu',
  skeleton: { bucket: 'sada', variant: 'value', count: 4 },
  produce(ctx): Tile[] {
    const zet = ctx.snapshots['zet-rt'];
    const stop = ctx.screen?.stop;
    const delays = routeDelays(zet);
    const byId = new Map(delays.map((d) => [d.routeId, d] as const));
    // No cap here: buildTimeband trims the sada lane to SADA_DOMAIN_CAP.transit
    // and counts the rest into the "+ N" foot this producer words below.
    const deviating = delays.filter((d) => delayTone(ctx.i18n, d.meanDelay) !== 'none').map((d) => d.routeId);
    const ids = [...new Set([...savedRouteIds(ctx), ...(stop ? stop.routes : deviating)])];
    return ids.map((id) => lineTile(ctx.i18n, id, byId, stop));
  },
  moreLabel(i18n, count, ctx) {
    const text = i18n.t('timeband.moreLines', { count });
    const stop = ctx.screen?.stop;
    return { text, aria: stop ? `${text}, ${i18n.t('transit.fromStop', { stop: stop.name })}` : undefined };
  },
};
