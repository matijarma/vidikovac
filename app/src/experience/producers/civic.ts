// Grad's two civic producers (plan A.6): the one ink tile a screen ever
// carries (the next Assembly session, while it is still within the band —
// beyond the horizon, Grad has it), and the gazette's own number, a
// reference module that is never stale.
import { zagrebWeekdayShort } from '../../format';
import { dataText } from '../../panels/panel';
import { itemSelection } from '../blocks';
import type { ProduceOptions, TileProducer } from '../timeband';
import type { Tile } from '../tiles';

export const assemblyProducer: TileProducer = {
  domain: 'civic',
  modules: ['dogadanja'],
  layer: 'uprava-i-pravo',
  skeleton: null,
  produce(ctx, o: ProduceOptions): Tile[] {
    const items = ctx.snapshots.dogadanja?.items ?? [];
    const next = items
      .filter((item) => dataText(item, 'source') === 'skupstina' && item.at && Date.parse(item.at) >= ctx.now)
      .sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!))[0];
    if (!next) return [];
    const bucket = o.bucket(next.at, next.until, dataText(next, 'precision') !== 'time');
    if (!bucket) return [];
    return [{
      key: `dogadanja:${next.id}`,
      domain: 'civic',
      variant: 'ink',
      label: ctx.i18n.t('civic.assembly'),
      title: next.title,
      at: next.at,
      allDay: dataText(next, 'precision') !== 'time',
      context: dataText(next, 'venue'),
      selection: itemSelection(next),
      layer: 'uprava-i-pravo',
      testid: 'tile-assembly',
    }];
  },
};

export const gazetteProducer: TileProducer = {
  domain: 'civic',
  modules: ['glasnik'],
  layer: 'uprava-i-pravo',
  skeleton: { bucket: 'sada', variant: 'value', count: 1 },
  produce(ctx): Tile[] {
    const { i18n } = ctx;
    const glasnik = ctx.snapshots.glasnik;
    const act = glasnik?.items[0];
    if (!act || !glasnik) return [];
    const context = [
      act.at ? i18n.t('civic.issuePublished', { date: zagrebWeekdayShort(act.at) }) : '',
      i18n.t('civic.actsCount', { count: glasnik.items.length }),
    ].filter(Boolean).join(' · ');
    return [{
      key: 'glasnik:issue',
      domain: 'civic',
      variant: 'value',
      label: i18n.t('tiles.gazette'),
      value: `${dataText(act, 'broj')}/${dataText(act, 'godina')}`,
      valueSize: 'xl',
      context,
      layer: 'uprava-i-pravo',
      bucket: 'sada',
      testid: 'tile-gazette',
    }];
  },
};
