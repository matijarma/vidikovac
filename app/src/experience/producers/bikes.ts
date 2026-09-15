// Bikes' one value tile (plan T3.2, D7): the nearest bike-share station's
// free count, off behind FEED_BIKES until Nextbike's GBFS station_status
// feed is confirmed for Zagreb (docs/izvori.md "Crveni izvori"). `stationTile`
// is shared with parking.ts, which has the identical shape and station
// choice; the plan's own A.6 originally drafted both in one `mobility.ts`
// file, split here only because that name was already the closures
// producer's (see the T3.2 controller note).
import { FLAGS } from '../../core/flags';
import { mobilityStaleBadge, nearestStation, type MobilityStation } from '../../core/mobility';
import type { LayerContext } from '../../layers/types';
import { escapeHtml } from '../../ui/dom/escape';
import { iconMarkup } from '../../ui/icons';
import { walkMinutes } from '../kvart';
import { numberText } from '../text';
import type { ProduceOptions, TileProducer } from '../timeband';
import type { Tile } from '../tiles';

/** The free-count value, or the honest "no data" word when the source has no figure for
 *  this particular station right now -- never a silent zero (the same fallback
 *  transit.ts's line tile uses for a route the delay feed has not reported on). */
function freeValue(ctx: LayerContext, free: number | null): string {
  return free === null ? ctx.i18n.t('transit.noDelayData') : numberText(ctx.i18n, free);
}

/**
 * The value tile both bikes and parking show (plan T3.2): the station name in the plain
 * context, the footprints glyph and the walking estimate appended as markup -- never the
 * word "pješice" itself (the glyph is defined; the copy "Do not" rule), and only with a
 * screen stop to walk from (D16's "hidden without a screen stop", extended here from the
 * saved-stop walking row to the nearest station). `aria` says the estimate in words for a
 * reader who cannot see the glyph, using the same minutes text -- never "pješice" either.
 */
export function stationTile(ctx: LayerContext, key: string, label: string, station: MobilityStation, testid: string): Tile {
  const { i18n } = ctx;
  const stop = ctx.screen?.stop;
  const value = freeValue(ctx, station.free);
  const minutesText = stop ? i18n.t('kvart.walkMinutes', { minutes: walkMinutes(stop, station) }) : '';
  const contextMarkup = minutesText ? `${iconMarkup('footprints')}<span class="tl-ctx-text">${escapeHtml(minutesText)}</span>` : undefined;
  return {
    key,
    domain: 'mobility',
    variant: 'value',
    label,
    value,
    valueSize: 'xl',
    context: station.name,
    contextMarkup,
    aria: [label, station.name, value, minutesText].filter(Boolean).join(', '),
    layer: 'u-pokretu',
    bucket: 'sada',
    testid,
  };
}

export const bikesProducer: TileProducer = {
  domain: 'mobility',
  // No worker module fills ctx.bikes yet (it is not a ModuleId), so nothing here
  // rides buildTimeband's per-module loading/down gating; the flag alone decides,
  // both structurally (this field) and inside produce() (belt and suspenders).
  modules: [],
  layer: 'u-pokretu',
  skeleton: null,
  flag: 'FEED_BIKES',
  produce(ctx, o: ProduceOptions): Tile[] {
    if (!FLAGS.FEED_BIKES) return [];
    const snapshot = ctx.bikes;
    if (!snapshot || snapshot.status === 'down') return [];
    const station = nearestStation(snapshot.stations, ctx.screen?.stop, o.kvart);
    if (!station) return [];
    const tile = stationTile(ctx, `bikes:${station.id}`, ctx.i18n.t('tiles.bikesFree'), station, 'tile-bikes');
    // A degraded fetch still shows the last free count, but never as if it were current
    // (global constraints §1/§8: every tile inherits the loading/stale/down states).
    if (snapshot.status === 'stale') tile.stale = mobilityStaleBadge(ctx.i18n, snapshot.fetchedAt);
    return [tile];
  },
};
