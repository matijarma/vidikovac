// Parking's one value tile (plan T3.2, D7): the nearest garage's free places,
// off behind FEED_PARKING until Zagrebparking's occupancy feed is published
// on data.gov.hr (docs/izvori.md "Crveni izvori", request 368). Shares its
// station choice and tile shape with bikes.ts -- see that file's header.
import { FLAGS } from '../../core/flags';
import { mobilityStaleBadge, nearestStation } from '../../core/mobility';
import type { ProduceOptions, TileProducer } from '../timeband';
import type { Tile } from '../tiles';
import { stationTile } from './bikes';

export const parkingProducer: TileProducer = {
  domain: 'mobility',
  modules: [],
  layer: 'u-pokretu',
  skeleton: null,
  flag: 'FEED_PARKING',
  produce(ctx, o: ProduceOptions): Tile[] {
    if (!FLAGS.FEED_PARKING) return [];
    const snapshot = ctx.parking;
    if (!snapshot || snapshot.status === 'down') return [];
    const station = nearestStation(snapshot.stations, ctx.screen?.stop);
    if (!station) return [];
    const tile = stationTile(ctx, `parking:${station.id}`, ctx.i18n.t('tiles.parkingFree'), station, 'tile-parking');
    // Same stale handling as bikes.ts: a degraded fetch keeps the last free count, badged.
    if (snapshot.status === 'stale') tile.stale = mobilityStaleBadge(ctx.i18n, snapshot.fetchedAt);
    return [tile];
  },
};
