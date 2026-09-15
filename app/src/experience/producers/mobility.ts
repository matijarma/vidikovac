// Promet's one closures band on the time band (plan A.6): whether a road is
// closed right now, and the planned closures the register already knows
// about, as time tiles on the day they start. Never "u tijeku" as a word
// where the band's own state does the telling.
//
// The band is komunalno work seen from the street (kajimafix 01.5): amber,
// the hard hat, and, with a kvart chosen and closures the worker stamped
// with a district, the nearest closed street in that kvart with its end as
// the trail and the kvart's count in the label. Without a kvart match the
// band falls back to the one street (a single closure) or the city count.
import type { FeedItem } from '../../../../worker/feed/schema';
import type { AreaSlug } from '../../../../worker/pairing/areas';
import { zagrebDayKey, zagrebTime, zagrebWeekdayShort } from '../../format';
import type { I18n } from '../../i18n/i18n';
import type { LayerContext } from '../../layers/types';
import { dataText } from '../../panels/panel';
import { referencePoint } from '../kvart';
import { activeClosures } from '../safety-state';
import { distanceKm } from '../text';
import type { ProduceOptions, TileProducer } from '../timeband';
import type { Tile } from '../tiles';

/** A closure's first vertex (a closure is filed where it starts), or its point; null without a geometry. */
function firstVertex(item: FeedItem): [number, number] | null {
  if (!item.geo) return null;
  const point = item.geo.type === 'Point' ? (item.geo.coordinates as number[]) : (item.geo.coordinates as number[][])[0];
  return point && Number.isFinite(point[0]) && Number.isFinite(point[1]) ? [point[0]!, point[1]!] : null;
}

/** The active closures in the kvart, nearest to the reference point first (unknown geometry last). */
function closuresInKvart(ctx: LayerContext, kvart: string | null, active: readonly FeedItem[]): FeedItem[] {
  if (!kvart) return [];
  const ref = referencePoint(ctx, kvart as AreaSlug);
  return active
    .filter((c) => dataText(c, 'district') === kvart)
    .map((c) => {
      const p = firstVertex(c);
      return { c, d: p ? distanceKm(ref.lon, ref.lat, p[0], p[1]) : Infinity };
    })
    .sort((a, b) => a.d - b.d)
    .map(({ c }) => c);
}

function endText(i18n: I18n, now: number, item: FeedItem): string {
  const until = item.until;
  return until && Number.isFinite(Date.parse(until))
    ? i18n.t('panels.until', { time: zagrebDayKey(until) === zagrebDayKey(now) ? zagrebTime(until) : zagrebWeekdayShort(until) })
    : i18n.t('safety.noEnd');
}

function closuresBand(ctx: LayerContext, o: ProduceOptions, active: readonly FeedItem[]): Tile {
  const { i18n, now } = ctx;
  const inKvart = closuresInKvart(ctx, o.kvart, active);
  // One street to name: the nearest in the kvart, else the only closure in the city; a city-wide plural is a count.
  const subject = inKvart[0] ?? (active.length === 1 ? active[0] : undefined);
  const label = inKvart.length > 0
    ? `${i18n.t('tiles.closures')} · ${i18n.t('tiles.inKvart', { count: inKvart.length })}`
    : i18n.t('tiles.closures');
  const title = subject ? subject.title : i18n.t('panels.closuresCount', { count: active.length });
  return {
    key: 'mobility:closures',
    domain: 'mobility',
    variant: 'band',
    tone: 'komunalno',
    icon: 'hard-hat',
    label,
    title,
    value: subject ? endText(i18n, now, subject) : '',
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
  produce(ctx, o: ProduceOptions): Tile[] {
    const snapshot = ctx.snapshots.prometnice;
    const active = activeClosures(snapshot, ctx.now);
    const tiles: Tile[] = active.length > 0 ? [closuresBand(ctx, o, active)] : [];
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
