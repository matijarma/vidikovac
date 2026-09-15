// The last scheduled departure per line from the screen's stop (plan A.6,
// D7, Task T3.1): ZET's static GTFS, cut per stop by scripts/gtfs-lastrun.mjs,
// fetched once per session by the dashboard (core/lastrun.ts) and read here
// as `ctx.lastRun`. Behind FEED_LASTRUN. Nothing here reads zet-rt, so the
// producer declares no module: a schedule on disk has no feed to wait for,
// and the real-time feed's loading, stale or down state is never painted on
// it. The tile says "Zadnji polazak" and "po rasporedu · ZET GTFS"; it is a
// departure, never an arrival.
import { lastDeparture } from '../../core/lastrun';
import { ZET_ROUTES } from '../../data/routes';
import { lineBadge } from '../blocks';
import type { ProduceOptions, TileProducer } from '../timeband';
import type { Bucket, Tile } from '../tiles';

/** At most this many tiles: the lines departing last. */
const TILE_CAP = 2;

/**
 * The lanes of the current service day. The departure that comes back for a
 * line whose last one has left is tomorrow night's (its next service date
 * answers from 00:00), and that falls into sutra; a night tram's Friday
 * service ends at 05:38, after the band's 04:00 cut, and that falls into the
 * day lane while still being this service day's departure. So: never sutra
 * or tjedan, everything before them.
 */
const TONIGHT: ReadonlySet<Bucket> = new Set<Bucket>(['danas', 'veceras']);

export const lastRunProducer: TileProducer = {
  domain: 'transit',
  modules: [],
  layer: 'u-pokretu',
  skeleton: null,
  flag: 'FEED_LASTRUN',
  produce(ctx, o: ProduceOptions): Tile[] {
    const snapshot = ctx.lastRun;
    if (!snapshot || snapshot.status !== 'live') return [];
    const departures: { routeId: string; at: string }[] = [];
    for (const routeId of Object.keys(snapshot.routes)) {
      const departure = lastDeparture(snapshot, routeId, ctx.now);
      if (!departure) continue;
      const at = new Date(departure.at).toISOString();
      const bucket = o.bucket(at);
      if (bucket && TONIGHT.has(bucket)) departures.push({ routeId, at });
    }
    departures.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return departures.slice(-TILE_CAP).map(({ routeId, at }) => {
      const route = ZET_ROUTES[routeId];
      const kind = route?.type === 0 ? 'tram' : route?.type === 3 ? 'bus' : 'other';
      return {
        key: `transit:lastrun:${routeId}`,
        domain: 'transit',
        variant: 'time',
        label: ctx.i18n.t('tiles.lastRun'),
        labelMarkup: lineBadge(route?.shortName ?? routeId, kind, 'xs'),
        title: route?.longName ?? routeId,
        at,
        context: ctx.i18n.t('tiles.scheduled'),
        selection: { kind: 'route', id: routeId },
        layer: 'u-pokretu',
        testid: 'tile-lastrun',
      };
    });
  },
};
