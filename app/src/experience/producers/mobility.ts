// Promet's one closures band on the time band (plan A.6): whether a road is
// closed right now, and the planned closures the register already knows
// about, as time tiles on the day they start. Never "u tijeku" as a word
// where the band's own state does the telling.
import type { FeedItem } from '../../../../worker/feed/schema';
import { zagrebDayKey, zagrebTime, zagrebWeekdayShort } from '../../format';
import type { I18n } from '../../i18n/i18n';
import { dataText } from '../../panels/panel';
import { activeClosures } from '../safety-state';
import type { TileProducer } from '../timeband';
import type { Tile } from '../tiles';

function closuresBand(i18n: I18n, now: number, active: readonly FeedItem[]): Tile {
  const n = active.length;
  const item = active[0]!;
  const until = n === 1 ? item.until : undefined;
  const value = n !== 1
    ? ''
    : until && Number.isFinite(Date.parse(until))
      ? i18n.t('panels.until', { time: zagrebDayKey(until) === zagrebDayKey(now) ? zagrebTime(until) : zagrebWeekdayShort(until) })
      : i18n.t('safety.noEnd');
  return {
    key: 'mobility:closures',
    domain: 'mobility',
    variant: 'band',
    tone: 'mobility',
    icon: 'car-front',
    label: i18n.t('tiles.closures'),
    title: n === 1 ? item.title : i18n.t('panels.closuresCount', { count: n }),
    value,
    layer: 'u-pokretu',
    bucket: 'sada',
    testid: 'tile-closures',
  };
}

/**
 * `panels.closureType.<subtype>` for the codes the register defines today. Unlike
 * `komunalne.ts`'s phase/status, `prometnice.ts` passes `subtype` through with no
 * validation against a closed vocabulary, and drops the key entirely when the
 * upstream JSON omits it — so a missing or unrecognized subtype must not reach the
 * tile as the raw dotted key. Falls back to the register's own generic word,
 * mirroring the worker's `closureWords()` guard (`SUBTYPE_WORDS[subtype] ?? 'zatvoreno'`)
 * for the same gap, the same way `events.ts`'s `categoryLabel` falls back to `tiles.event`
 * on a catalogue miss.
 */
function closureTypeLabel(i18n: I18n, item: FeedItem): string {
  const key = `panels.closureType.${dataText(item, 'subtype')}`;
  const label = i18n.t(key);
  return label === key ? i18n.t('panels.closureType.ROAD_CLOSED') : label;
}

/**
 * `panels.direction.<direction>` when the register names a recognized one; a missing or
 * unrecognized direction (same upstream gap as the subtype above) omits the context line
 * entirely rather than showing the raw key, mirroring `closureWords()`'s own choice to drop
 * the direction clause rather than invent one.
 */
function closureDirectionContext(i18n: I18n, item: FeedItem): string {
  const key = `panels.direction.${dataText(item, 'direction')}`;
  const context = i18n.t(key);
  return context === key ? '' : context;
}

function closureTile(i18n: I18n, item: FeedItem): Tile {
  return {
    key: `prometnice:${item.id}`,
    domain: 'mobility',
    variant: 'time',
    label: closureTypeLabel(i18n, item),
    title: item.title,
    at: item.at,
    until: item.until,
    context: closureDirectionContext(i18n, item),
    layer: 'u-pokretu',
    testid: 'tile-closure',
  };
}

export const closuresProducer: TileProducer = {
  domain: 'mobility',
  modules: ['prometnice'],
  layer: 'u-pokretu',
  skeleton: null,
  produce(ctx): Tile[] {
    const snapshot = ctx.snapshots.prometnice;
    const active = activeClosures(snapshot, ctx.now);
    const tiles: Tile[] = active.length > 0 ? [closuresBand(ctx.i18n, ctx.now, active)] : [];
    const planned = (snapshot?.items ?? []).filter((item) => {
      if (item.kind !== 'closure' || !item.at) return false;
      const start = Date.parse(item.at);
      return Number.isFinite(start) && start > ctx.now;
    });
    for (const item of planned) tiles.push(closureTile(ctx.i18n, item));
    return tiles;
  },
  moreLabel: (i18n, count) => ({ text: i18n.t('timeband.moreClosures', { count }) }),
};
