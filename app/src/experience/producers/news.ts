// Vijesti's one lead on the time band (plan A.6): the first HRT vijesti item
// (or an unsourced one, the RSS feed's own default), else the first Radio
// Sljeme item whose source is not itself reporting down. A source reporting
// down is skipped in favour of the next one rather than shown empty.
import { dataText } from '../../panels/panel';
import { relativeTime } from '../text';
import { itemSelection } from '../blocks';
import type { TileProducer } from '../timeband';
import type { Tile } from '../tiles';

const NEWS_SOURCES = ['HRT vijesti', 'Radio Sljeme'] as const;

export const newsProducer: TileProducer = {
  domain: 'news',
  modules: ['hrt-news'],
  layer: 'vijesti',
  skeleton: { bucket: 'sada', variant: 'row', count: 1 },
  produce(ctx): Tile[] {
    const { i18n } = ctx;
    const news = ctx.snapshots['hrt-news'];
    for (const source of NEWS_SOURCES) {
      if (news?.sources?.[source]?.status === 'down') continue;
      const item = news?.items.find((candidate) => dataText(candidate, 'source') === source || (source === NEWS_SOURCES[0] && !dataText(candidate, 'source')));
      if (!item) continue;
      const when = item.at && item.dateBasis !== 'unknown' ? relativeTime(i18n, item.at, ctx.now) : i18n.t('news.publishedUnknown');
      return [{
        key: `hrt-news:${item.id}`,
        domain: 'news',
        variant: 'row',
        icon: 'newspaper',
        label: i18n.t('layers.vijesti'),
        title: item.title,
        context: `${source} · ${when}`,
        selection: itemSelection(item),
        layer: 'vijesti',
        bucket: 'sada',
        testid: 'tile-news',
      }];
    }
    return [];
  },
};
