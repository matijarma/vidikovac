// Waste's pickup tiles (plan T3.2, D7): the city's next collection days, off
// behind FEED_WASTE until Čistoća's pickup calendar can be converted to
// public/data/waste/<district>.json (docs/izvori.md "Crveni izvori"). Sutra and
// tjedan only: a pickup today is not "next" the way the band frames it, so it
// is left off exactly as bucketOf would place it (the sada/danas/veceras
// lanes), never forced into a lane that misreports it as upcoming.
import { FLAGS } from '../../core/flags';
import { mobilityStaleBadge } from '../../core/mobility';
import type { ProduceOptions, TileProducer } from '../timeband';
import type { Tile } from '../tiles';

export const wasteProducer: TileProducer = {
  domain: 'komunalno',
  modules: [],
  layer: 'uprava-i-pravo',
  skeleton: null,
  flag: 'FEED_WASTE',
  produce(ctx, o: ProduceOptions): Tile[] {
    if (!FLAGS.FEED_WASTE) return [];
    const snapshot = ctx.waste;
    if (!snapshot || snapshot.status === 'down') return [];
    const { i18n } = ctx;
    const label = i18n.t('tiles.waste.label');
    const contextText = i18n.t('kvart.wholeCity');
    // A degraded fetch still shows the last known pickup days, but badged rather than
    // read as live (global constraints §1/§8: every tile inherits the stale state too).
    const stale = snapshot.status === 'stale' ? mobilityStaleBadge(i18n, snapshot.fetchedAt) : undefined;
    const tiles: Tile[] = [];
    for (const pickup of snapshot.pickups) {
      const bucket = o.bucket(pickup.date, undefined, true);
      if (bucket !== 'sutra' && bucket !== 'tjedan') continue;
      tiles.push({
        key: `waste:${pickup.district}:${pickup.date}:${pickup.kind}`,
        domain: 'komunalno',
        variant: 'time',
        label,
        title: pickup.kind,
        at: pickup.date,
        allDay: true,
        context: contextText,
        bucket,
        layer: 'uprava-i-pravo',
        testid: 'tile-waste',
        stale,
      });
    }
    return tiles;
  },
};
