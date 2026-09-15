// The last departure from the screen's stop (plan A.6, D7): GTFS static on
// disk, behind FEED_LASTRUN, off until Task T3.1 ships the producer's real
// source of `ctx.lastRun`. FLAGS[flag] === false means buildTimeband never
// calls `produce` in production (it skips a flagged-off producer before
// asking its state at all), so the structural read below is exercised only
// by this file's own unit tests until then.
import { ZET_ROUTES } from '../../data/routes';
import type { LayerContext } from '../../layers/types';
import { lineBadge } from '../blocks';
import type { ProduceOptions, TileProducer } from '../timeband';
import type { Tile } from '../tiles';

/**
 * T3.1's shape, forward-declared so this producer has something concrete to
 * compile and be tested against before that task lands: one scheduled
 * departure per line worth mentioning, and the instant this whole batch stops
 * being valid (the next service day's data replaces it, never extends it).
 * A plain read once `LayerContext` carries `lastRun` for real — recorded
 * under this task's Rulings for T3.1 to confirm or adjust.
 */
export interface LastRunDeparture {
  routeId: string;
  at: string;
}
export interface LastRun {
  validUntil: string;
  departures: readonly LastRunDeparture[];
}

function readLastRun(ctx: LayerContext): LastRun | undefined {
  return (ctx as LayerContext & { lastRun?: LastRun }).lastRun;
}

export const lastRunProducer: TileProducer = {
  domain: 'transit',
  modules: ['zet-rt'],
  layer: 'u-pokretu',
  skeleton: null,
  flag: 'FEED_LASTRUN',
  produce(ctx, o: ProduceOptions): Tile[] {
    const lastRun = readLastRun(ctx);
    if (!lastRun) return [];
    const validUntil = Date.parse(lastRun.validUntil);
    const departures = [...lastRun.departures]
      .filter((d) => {
        const at = Date.parse(d.at);
        return Number.isFinite(at) && (!Number.isFinite(validUntil) || at <= validUntil);
      })
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      .slice(-2);
    const tiles: Tile[] = [];
    for (const departure of departures) {
      const bucket = o.bucket(departure.at);
      if (!bucket) continue;
      const route = ZET_ROUTES[departure.routeId];
      const kind = route?.type === 0 ? 'tram' : route?.type === 3 ? 'bus' : 'other';
      tiles.push({
        key: `zet-rt:lastrun:${departure.routeId}`,
        domain: 'transit',
        variant: 'time',
        label: ctx.i18n.t('tiles.lastRun'),
        labelMarkup: lineBadge(route?.shortName ?? departure.routeId, kind, 'xs'),
        title: route?.longName ?? departure.routeId,
        at: departure.at,
        context: ctx.i18n.t('tiles.scheduled'),
        selection: { kind: 'route', id: departure.routeId },
        layer: 'u-pokretu',
      });
    }
    return tiles;
  },
};
