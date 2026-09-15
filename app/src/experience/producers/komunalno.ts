// Komunalno's one works band (plan A.6): how many neighbourhood works the
// City's own register lists as "u tijeku" right now, in the reader's kvart
// when one is chosen, the whole city otherwise. The register has no end
// dates (komunalne.ts:81), so this producer never emits a works-end time tile.
import { districtLabel } from '../../kiosk/districts';
import { filterBySource } from '../../layers/kultura';
import { dataText } from '../../panels/panel';
import { numberText } from '../text';
import type { ProduceOptions, TileProducer } from '../timeband';
import type { Tile } from '../tiles';

const WORKS_PHASE = 'Radovi u tijeku';

export const worksProducer: TileProducer = {
  domain: 'komunalno',
  modules: ['dogadanja'],
  layer: 'uprava-i-pravo',
  skeleton: { bucket: 'sada', variant: 'band', count: 1 },
  produce(ctx, o: ProduceOptions): Tile[] {
    const { i18n } = ctx;
    const works = filterBySource(ctx.snapshots.dogadanja, ['komunalne']).filter((item) => dataText(item, 'phase') === WORKS_PHASE);
    // The kvart scopes the count only once the register actually carries
    // districts (T2.1); before that (or when the item has none), the city
    // count stays honest rather than being labelled with a kvart it cannot
    // verify — the same city-wide fallback D18 names for the kiosk.
    const withDistrict = works.some((item) => dataText(item, 'district') !== '');
    const scoped = o.kvart && withDistrict ? works.filter((item) => dataText(item, 'district') === o.kvart) : works;
    const count = scoped.length;
    if (count === 0) return [];
    const label = i18n.t('tiles.works');
    const title = o.kvart && withDistrict ? districtLabel(o.kvart) : i18n.t('tiles.worksCity');
    return [{
      key: 'komunalno:works',
      domain: 'komunalno',
      variant: 'band',
      tone: 'komunalno',
      icon: 'hard-hat',
      label,
      title,
      value: numberText(i18n, count),
      aria: `${label}, ${i18n.t('tiles.worksNow', { count })}, ${title}`,
      layer: 'uprava-i-pravo',
      bucket: 'sada',
      testid: 'tile-works',
    }];
  },
};
