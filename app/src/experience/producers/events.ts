// Kultura's next starts on the time band (plan A.6): the culture and
// community sources of dogadanja, Zagreb venues only, the next starts by
// time. A running exhibition (bucket sada) or a start beyond the horizon
// (bucket null) is dropped here — buildTimeband drops null tiles too, but a
// running item would otherwise land in the sada lane as if it were a live
// value, which this domain never is (DOMAIN_ORDER has no 'events' entry).
import type { FeedItem } from '../../../../worker/feed/schema';
import type { ScreenStop } from '../../../../worker/protocol';
import { ZET_ROUTES } from '../../data/routes';
import type { I18n } from '../../i18n/i18n';
import { cultureEvents, eventCategory, isAllDay, upcomingEvents, venueOutsideZagreb } from '../../layers/kultura';
import type { LayerContext } from '../../layers/types';
import { dataText } from '../../panels/panel';
import { distanceKm, pointOf } from '../text';
import { itemSelection, lineBadge } from '../blocks';
import type { ProduceOptions, TileProducer } from '../timeband';
import type { Tile } from '../tiles';

/** `events.category.<key>` for every key `eventCategory` can return; `tiles.event` only guards a catalogue gap. */
function categoryLabel(i18n: I18n, item: FeedItem): string {
  const key = `events.category.${eventCategory(item)}`;
  const label = i18n.t(key);
  return label === key ? i18n.t('tiles.event') : label;
}

/**
 * Small line badges for the stop nearest the event, when the shell has a stop
 * catalogue to search — `ctx.stops` (T2.5) is dormant in wave 2: nothing
 * populates it yet, so this branch never fires until a later wave wires the
 * catalogue in, and the read stays structural until then for the same reason
 * `transit.ts` reads `ctx.saved` structurally (see that file's note).
 */
function nearestStopBadges(item: FeedItem, ctx: LayerContext): string | undefined {
  const point = pointOf(item);
  const stops = (ctx as LayerContext & { stops?: readonly ScreenStop[] }).stops;
  if (!point || !stops || stops.length === 0) return undefined;
  const [lon, lat] = point;
  let nearest: ScreenStop | undefined;
  let best = Infinity;
  for (const stop of stops) {
    const d = distanceKm(lon, lat, stop.lon, stop.lat);
    if (d < best) {
      best = d;
      nearest = stop;
    }
  }
  if (!nearest) return undefined;
  return nearest.routes
    .map((id) => {
      const route = ZET_ROUTES[id];
      const kind = route?.type === 0 ? 'tram' : route?.type === 3 ? 'bus' : 'other';
      return lineBadge(route?.shortName ?? id, kind, 'xs');
    })
    .join('');
}

function eventTile(i18n: I18n, item: FeedItem, ctx: LayerContext): Tile {
  const venue = dataText(item, 'venue');
  const source = dataText(item, 'source');
  return {
    key: `dogadanja:${item.id}`,
    domain: 'events',
    variant: 'time',
    label: categoryLabel(i18n, item),
    title: item.title,
    at: item.at,
    until: item.until,
    allDay: isAllDay(item),
    context: venue || i18n.t(`events.sources.${source}`),
    contextMarkup: nearestStopBadges(item, ctx),
    selection: itemSelection(item),
    layer: 'kultura',
    testid: 'tile-events',
  };
}

export const eventsProducer: TileProducer = {
  domain: 'events',
  modules: ['dogadanja'],
  layer: 'kultura',
  skeleton: { bucket: 'next', variant: 'time', count: 3 },
  produce(ctx, o: ProduceOptions): Tile[] {
    const local = cultureEvents(ctx.snapshots.dogadanja).filter((item) => !venueOutsideZagreb(item));
    const upcoming = upcomingEvents(local, ctx.now);
    const tiles: Tile[] = [];
    for (const item of upcoming) {
      const bucket = o.bucket(item.at, item.until, isAllDay(item));
      if (!bucket || bucket === 'sada') continue;
      tiles.push(eventTile(ctx.i18n, item, ctx));
    }
    return tiles;
  },
  moreLabel: (i18n, count) => ({ text: i18n.t('timeband.moreEvents', { count }) }),
};
