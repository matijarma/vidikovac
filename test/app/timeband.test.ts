// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import type { ScreenContext, ScreenStop } from '../../app/src/core/contracts';
import { DEFAULT_PRODUCERS } from '../../app/src/experience/producers';
import { statusBadge } from '../../app/src/experience/status';
import type { Tile } from '../../app/src/experience/tiles';
import {
  buildTimeband, bucketOf, columnsFor, renderTimeband, renderTimebandSeg, tickTimebandClock, zagrebInstant, type TileProducer,
} from '../../app/src/experience/timeband';
import { weatherStatusMarkup, weatherStatus } from '../../app/src/experience/weather-status';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import type { LayerContext } from '../../app/src/layers/types';
import { createElementFromHTML } from '../../app/src/ui/dom/escape';
import { text } from './helpers';

// The time band (plan A.3): one axis, sada · poslijepodne · večeras · sutra ·
// tjedan, cut at the service day's 04:00 and the evening's 18:00 in Zagreb
// wall-clock time. Every worked example of A.3 is a row here, so the cuts, the
// labels and the buckets are pinned where the design argued them. The model
// and the markup (A.4) are tested with hand-made producers: the real ones
// arrive with T2.3 and are tested over the layers fixtures there.

const hr = createDefaultI18n('hr');
const en = createDefaultI18n('en');
const at = (iso: string): number => Date.parse(iso);

const FRI_AFTERNOON = at('2026-09-11T12:32:00Z'); // Fri 11. 9. 14:32 CEST: the unit fixture
const FRI_MORNING = at('2026-09-11T07:10:00Z');   // Fri 09:10
const FRI_EVENING = at('2026-09-11T17:40:00Z');   // Fri 19:40: night mode
const SAT_NIGHT = at('2026-09-11T23:15:00Z');     // Sat 12. 9. 01:15: before the service day turns
const DST_NIGHT = at('2026-10-24T23:00:00Z');     // Sun 25. 10. 01:00 CEST: the clocks fall back at 03:00

const SAT_0400 = at('2026-09-12T02:00:00Z');
const SUN_0400 = at('2026-09-13T02:00:00Z');
const FRI18_0400 = at('2026-09-18T02:00:00Z');

describe('zagrebInstant: the UTC instant of a Zagreb wall-clock hour, safe across the DST cuts', () => {
  it('reads 18:00 CEST on 11. 9. as 16:00Z', () => {
    expect(zagrebInstant('2026-09-11', 18)).toBe(at('2026-09-11T16:00:00Z'));
  });
  it('reads 04:00 on 25. 10. as 03:00Z: the clocks have already fallen back to CET that night', () => {
    expect(zagrebInstant('2026-10-25', 4)).toBe(at('2026-10-25T03:00:00Z'));
  });
  it('reads 04:00 on 29. 3. as 02:00Z: the clocks have already sprung forward to CEST', () => {
    expect(zagrebInstant('2026-03-29', 4)).toBe(at('2026-03-29T02:00:00Z'));
  });
  it('corrects a CET guess across midnight: 00:00 on 15. 1. is 23:00Z the evening before, 04:00 is 03:00Z', () => {
    expect(zagrebInstant('2026-01-15', 0)).toBe(at('2026-01-14T23:00:00Z'));
    expect(zagrebInstant('2026-01-15', 4)).toBe(at('2026-01-15T03:00:00Z'));
  });
  it('is NaN for a key that is not a date, so every comparison against it is false', () => {
    expect(zagrebInstant('', 4)).toBeNaN();
    expect(zagrebInstant('sutra', 4)).toBeNaN();
  });
});

describe('columnsFor: the axis for this moment', () => {
  it('Fri 14:32: five columns; the afternoon runs to 18:00, the evening from 18:00 to 04:00, sutra is Saturday, the week ends Thursday', () => {
    const cols = columnsFor(hr, FRI_AFTERNOON);
    expect(cols.map((c) => c.id)).toEqual(['sada', 'danas', 'veceras', 'sutra', 'tjedan']);
    expect(cols.map((c) => c.label)).toEqual(['sada', 'poslijepodne', 'večeras', 'sutra', 'tjedan']);
    expect(cols.map((c) => c.seg)).toEqual(['sada', 'popodne', 'večeras', 'sutra', 'tjedan']);
    expect(cols.map((c) => c.head)).toEqual(['', 'do 18:00', 'od 18:00', 'sub 12. 9.', 'do čet 17. 9.']);
    expect(cols.map((c) => [c.start, c.end])).toEqual([
      [FRI_AFTERNOON, FRI_AFTERNOON],
      [FRI_AFTERNOON, at('2026-09-11T16:00:00Z')],
      [at('2026-09-11T16:00:00Z'), SAT_0400],
      [SAT_0400, SUN_0400],
      [SUN_0400, FRI18_0400],
    ]);
  });
  it('speaks English with the same cuts', () => {
    const cols = columnsFor(en, FRI_AFTERNOON);
    expect(cols.map((c) => c.label)).toEqual(['now', 'afternoon', 'tonight', 'tomorrow', 'this week']);
    expect(cols.map((c) => c.seg)).toEqual(['now', 'p.m.', 'tonight', 'tomorrow', 'week']);
    expect(cols.map((c) => c.head)).toEqual(['', 'until 18:00', 'from 18:00', 'sub 12. 9.', 'until čet 17. 9.']);
  });
  it('Fri 09:10: before noon the day column says "danas", still to 18:00', () => {
    const cols = columnsFor(hr, FRI_MORNING);
    expect(cols.map((c) => c.id)).toEqual(['sada', 'danas', 'veceras', 'sutra', 'tjedan']);
    expect(cols[1]).toMatchObject({ label: 'danas', seg: 'danas', head: 'do 18:00', start: FRI_MORNING, end: at('2026-09-11T16:00:00Z') });
    expect(columnsFor(en, FRI_MORNING)[1]).toMatchObject({ label: 'today', seg: 'today' });
  });
  it('Fri 19:40: night mode has four columns; the afternoon has left and "noćas" runs from now to 04:00', () => {
    const cols = columnsFor(hr, FRI_EVENING);
    expect(cols.map((c) => c.id)).toEqual(['sada', 'veceras', 'sutra', 'tjedan']);
    expect(cols[1]).toMatchObject({ label: 'noćas', seg: 'noćas', head: 'do 04:00', start: FRI_EVENING, end: SAT_0400 });
    expect(cols[2]).toMatchObject({ label: 'sutra', head: 'sub 12. 9.', start: SAT_0400, end: SUN_0400 });
    expect(cols[3]).toMatchObject({ label: 'tjedan', head: 'do čet 17. 9.', start: SUN_0400, end: FRI18_0400 });
    expect(columnsFor(en, FRI_EVENING)[1]).toMatchObject({ label: 'overnight', seg: 'night', head: 'until 04:00' });
  });
  it('Sat 01:15: still Friday’s service day; the next column is Saturday and is labelled "danas" with its date', () => {
    const cols = columnsFor(hr, SAT_NIGHT);
    expect(cols.map((c) => c.id)).toEqual(['sada', 'veceras', 'sutra', 'tjedan']);
    expect(cols[1]).toMatchObject({ label: 'noćas', head: 'do 04:00', start: SAT_NIGHT, end: SAT_0400 });
    expect(cols[2]).toMatchObject({ id: 'sutra', label: 'danas', seg: 'danas', head: 'sub 12. 9.', start: SAT_0400, end: SUN_0400 });
    expect(cols[3]).toMatchObject({ label: 'tjedan', head: 'do čet 17. 9.', end: FRI18_0400 });
  });
  it('Sun 25. 10. 01:00, the DST night: the day turns at 04:00 CET (03:00Z) and every later cut follows CET', () => {
    const cols = columnsFor(hr, DST_NIGHT);
    expect(cols.map((c) => c.id)).toEqual(['sada', 'veceras', 'sutra', 'tjedan']);
    expect(cols[1]).toMatchObject({ label: 'noćas', head: 'do 04:00', start: DST_NIGHT, end: at('2026-10-25T03:00:00Z') });
    expect(cols[2]).toMatchObject({ label: 'danas', head: 'ned 25. 10.', start: at('2026-10-25T03:00:00Z'), end: at('2026-10-26T03:00:00Z') });
    expect(cols[3]).toMatchObject({ label: 'tjedan', head: 'do pet 30. 10.', start: at('2026-10-26T03:00:00Z'), end: at('2026-10-31T03:00:00Z') });
  });
});

describe('bucketOf: which lane a start belongs to (A.3’s worked rows)', () => {
  const cols = columnsFor(hr, FRI_AFTERNOON);
  const bucket = (start: string | undefined, until?: string, allDay?: boolean) => bucketOf(FRI_AFTERNOON, cols, start, until, allDay);

  it('Fri 17:00 is the afternoon', () => expect(bucket('2026-09-11T15:00:00Z')).toBe('danas'));
  it('Fri 20:00 is the evening', () => expect(bucket('2026-09-11T18:00:00Z')).toBe('veceras'));
  it('Sat 01:30 is still the evening: the service day runs to 04:00', () => expect(bucket('2026-09-11T23:30:00Z')).toBe('veceras'));
  it('Sat 04:00 opens sutra', () => expect(bucket('2026-09-12T02:00:00Z')).toBe('sutra'));
  it('Mon 14. 9. 11:00 is the week', () => expect(bucket('2026-09-14T09:00:00Z')).toBe('tjedan'));
  it('Fri 18. 9. 10:00 lies beyond D0+7 04:00: null', () => expect(bucket('2026-09-18T08:00:00Z')).toBeNull());
  it('an all-day item today whose noon has passed still belongs to the first time lane', () => {
    expect(bucket('2026-09-11T00:00:00Z', undefined, true)).toBe('danas');
    expect(bucket('2026-09-11', undefined, true)).toBe('danas');
  });
  it('an all-day item on Sun 13. 9. is the week', () => expect(bucket('2026-09-13T00:00:00Z', undefined, true)).toBe('tjedan'));
  it('an item running from 10. 9. to 1. 10. is sada (the producer decides whether to show it)', () => {
    expect(bucket('2026-09-10T07:00:00Z', '2026-10-01T16:00:00Z')).toBe('sada');
    expect(bucket('2026-09-11T12:32:00Z', '2026-09-11T13:00:00Z')).toBe('sada');
  });
  it('Fri 14:00 with no end has passed: null', () => expect(bucket('2026-09-11T12:00:00Z')).toBeNull());
  it('now Fri 09:10: Fri 11:00 is "danas · do 18:00"', () => {
    const morning = columnsFor(hr, FRI_MORNING);
    expect(bucketOf(FRI_MORNING, morning, '2026-09-11T09:00:00Z')).toBe('danas');
    expect(morning.find((c) => c.id === 'danas')).toMatchObject({ label: 'danas', head: 'do 18:00' });
  });
  it('now Fri 19:40: Fri 22:00 is "noćas · do 04:00" among four columns', () => {
    const evening = columnsFor(hr, FRI_EVENING);
    expect(evening).toHaveLength(4);
    expect(bucketOf(FRI_EVENING, evening, '2026-09-11T20:00:00Z')).toBe('veceras');
    expect(evening.find((c) => c.id === 'veceras')).toMatchObject({ label: 'noćas', head: 'do 04:00' });
  });
  it('now Sat 01:15: Sat 02:30 is noćas, Sat 10:00 is the "danas"-labelled sutra lane, Sun 10:00 is the week', () => {
    const night = columnsFor(hr, SAT_NIGHT);
    expect(bucketOf(SAT_NIGHT, night, '2026-09-12T00:30:00Z')).toBe('veceras');
    expect(bucketOf(SAT_NIGHT, night, '2026-09-12T08:00:00Z')).toBe('sutra');
    expect(night.find((c) => c.id === 'sutra')).toMatchObject({ label: 'danas', head: 'sub 12. 9.' });
    expect(bucketOf(SAT_NIGHT, night, '2026-09-13T08:00:00Z')).toBe('tjedan');
    // Friday's all-day item is still this service day's: the first time lane; Saturday's is the next day's.
    expect(bucketOf(SAT_NIGHT, night, '2026-09-11T00:00:00Z', undefined, true)).toBe('veceras');
    expect(bucketOf(SAT_NIGHT, night, '2026-09-12T00:00:00Z', undefined, true)).toBe('sutra');
  });
  it('now Sun 25. 10. 01:00 (the DST night): Sun 06:00 CET is sutra', () => {
    expect(bucketOf(DST_NIGHT, columnsFor(hr, DST_NIGHT), '2026-10-25T05:00:00Z')).toBe('sutra');
  });
  it('is null without a start, for an unparseable start, for a past all-day item and for an all-day item beyond the horizon', () => {
    expect(bucket(undefined)).toBeNull();
    expect(bucket('')).toBeNull();
    expect(bucket('sutra')).toBeNull();
    expect(bucket('2026-09-10T00:00:00Z', undefined, true)).toBeNull();
    expect(bucket('2026-09-19T00:00:00Z', undefined, true)).toBeNull();
  });
  it('a start exactly on a cut belongs to the lane the cut opens', () => {
    expect(bucket('2026-09-11T16:00:00Z')).toBe('veceras');
    expect(bucket('2026-09-13T02:00:00Z')).toBe('tjedan');
  });
});

// ---------------------------------------------------------------------------
// The model and the markup, with hand-made producers.

const NOW = FRI_AFTERNOON;
const ATTR = { text: 'Izvor: test', url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' };
const live = (module: ModuleId, items: ModuleSnapshot['items'] = []): ModuleSnapshot => ({
  module, tier: 'open', status: 'live', fetchedAt: '2026-09-11T12:31:00Z', attribution: ATTR, items,
});
const stale = (module: ModuleId): ModuleSnapshot => ({ ...live(module), status: 'stale', staleSince: '2026-09-11T12:00:00Z' });
const down = (module: ModuleId): ModuleSnapshot => ({ ...live(module), status: 'down' });
const OBSERVATION = live('dhmz-now', [{ id: 'o1', module: 'dhmz-now', kind: 'observation', tier: 'open', title: 'Maksimir', at: '2026-09-11T12:00:00Z', data: { temp: 21, weather: 'vedro' } }]);
const NO_TEMP = live('dhmz-now', [{ id: 'o1', module: 'dhmz-now', kind: 'observation', tier: 'open', title: 'Maksimir', at: '2026-09-11T12:00:00Z', data: { weather: 'vedro' } }]);

const ALL_LIVE: LayerContext['snapshots'] = { 'zet-rt': live('zet-rt'), dogadanja: live('dogadanja'), 'hrt-news': live('hrt-news'), glasnik: live('glasnik'), 'dhmz-cap': live('dhmz-cap') };

function screen(surface: 'phone' | 'desktop'): ScreenContext {
  return { surface, locale: 'hr', theme: 'light', themePreference: 'light', lightweight: false, reducedMotion: false };
}
function ctx(over: Partial<LayerContext> = {}): LayerContext {
  return { i18n: hr, snapshots: ALL_LIVE, now: NOW, screen: screen('desktop'), ...over };
}
const phone = (over: Partial<LayerContext> = {}): LayerContext => ctx({ screen: screen('phone'), ...over });
const view = (col: string): LayerContext['view'] => ({ layer: 'grad-sada', selection: null, filters: { 'tb-col': col } });

const lineTile = (id: string): Tile => ({
  key: `zet-rt:route:${id}`, domain: 'transit', variant: 'value', label: `Linija ${id}`, value: 'na vrijeme', valueTone: 'ontime',
  layer: 'u-pokretu', selection: { kind: 'route', id }, bucket: 'sada', testid: 'tile-transit',
});
const transit = (ids: readonly string[]): TileProducer => ({
  domain: 'transit', modules: ['zet-rt'], layer: 'u-pokretu', skeleton: { bucket: 'sada', variant: 'value', count: 4 },
  produce: () => ids.map(lineTile),
  moreLabel: (_i18n, count) => ({ text: `+ ${count} linije`, aria: `+ ${count} linije, Sa stanice Trg bana J. Jelačića` }),
});
interface Start { id: string; at: string; until?: string; allDay?: boolean }
const eventTile = (s: Start): Tile => ({
  key: `dogadanja:${s.id}`, domain: 'events', variant: 'time', label: 'Koncerti', title: `Događaj ${s.id}`, at: s.at, until: s.until, allDay: s.allDay,
  context: 'Pogon', layer: 'kultura', selection: { kind: 'item', id: s.id, module: 'dogadanja' }, testid: 'tile-events',
});
/** Like the real events producer: drops what is running (sada) or off the band (null). */
const events = (starts: readonly Start[], moreLabel?: TileProducer['moreLabel']): TileProducer => ({
  domain: 'events', modules: ['dogadanja'], layer: 'kultura', skeleton: { bucket: 'next', variant: 'time', count: 3 },
  produce: (_ctx, o) => starts.flatMap((s) => { const b = o.bucket(s.at, s.until, s.allDay); return b && b !== 'sada' ? [eventTile(s)] : []; }),
  moreLabel,
});
const news: TileProducer = {
  domain: 'news', modules: ['hrt-news'], layer: 'vijesti', skeleton: { bucket: 'sada', variant: 'row', count: 1 },
  produce: () => [{ key: 'hrt-news:n1', domain: 'news', variant: 'row', icon: 'newspaper', label: 'Vijesti', title: 'Naslov vijesti', context: 'HRT vijesti · prije 3 sata', layer: 'vijesti', bucket: 'sada', testid: 'tile-news' }],
};
const gazette: TileProducer = {
  domain: 'civic', modules: ['glasnik'], layer: 'uprava-i-pravo', skeleton: { bucket: 'sada', variant: 'value', count: 1 },
  produce: () => [{ key: 'glasnik:issue', domain: 'civic', variant: 'value', label: 'Glasnik', value: '21/2026', valueSize: 'xl', layer: 'uprava-i-pravo', bucket: 'sada', testid: 'tile-gazette' }],
};
/** The safety band is itself the state word: it stands whatever its sources do. */
const safety: TileProducer = {
  domain: 'safety', modules: ['dhmz-cap', 'emsc', 'prometnice'], layer: 'sigurnost', skeleton: null,
  produce: (c) => {
    const level = c.snapshots['dhmz-cap']?.status === 'live' ? 'calm' : 'unknown';
    return [{ key: 'safety', domain: 'safety', variant: 'band', tone: level, icon: 'check-circle', label: 'Sigurnost', title: level === 'calm' ? 'mirno' : 'nije potvrđeno', layer: 'sigurnost', data: { level }, bucket: 'sada', testid: 'tile-safety' }];
  },
};
const bikesProduce = vi.fn(() => [lineTile('bikes')]);
const bikes: TileProducer = { domain: 'mobility', modules: ['zet-rt'], layer: 'u-pokretu', skeleton: { bucket: 'sada', variant: 'value', count: 1 }, flag: 'FEED_BIKES', produce: bikesProduce };

const SIX_LINES = ['6', '11', '12', '13', '14', '17'] as const;
const STARTS: Start[] = [
  { id: 'fri17', at: '2026-09-11T15:00:00Z' },
  { id: 'fri20', at: '2026-09-11T18:00:00Z' },
  { id: 'sat0130', at: '2026-09-11T23:30:00Z' },
  { id: 'sat10', at: '2026-09-12T08:00:00Z' },
  { id: 'mon11', at: '2026-09-14T09:00:00Z' },
  { id: 'beyond', at: '2026-09-18T08:00:00Z' },
  { id: 'running', at: '2026-09-10T07:00:00Z', until: '2026-10-01T16:00:00Z' },
  { id: 'friAllDay', at: '2026-09-11T00:00:00Z', allDay: true },
];
const PRODUCERS: TileProducer[] = [gazette, news, safety, transit(SIX_LINES), events(STARTS)];
const lane = (model: ReturnType<typeof buildTimeband>, col: string) => model.lanes.find((l) => l.col === col)!;
const keys = (model: ReturnType<typeof buildTimeband>, col: string): string[] => lane(model, col).tiles.map((t) => t.key);

describe('buildTimeband: the model', () => {
  it('places every tile on its lane: live values in sada, starts by their bucket, nothing beyond the band', () => {
    const model = buildTimeband(ctx(), PRODUCERS);
    expect(model.lanes.map((l) => l.col)).toEqual(['sada', 'danas', 'veceras', 'sutra', 'tjedan']);
    expect(keys(model, 'danas')).toEqual(['dogadanja:friAllDay', 'dogadanja:fri17']);
    expect(keys(model, 'veceras')).toEqual(['dogadanja:fri20', 'dogadanja:sat0130']);
    expect(keys(model, 'sutra')).toEqual(['dogadanja:sat10']);
    expect(keys(model, 'tjedan')).toEqual(['dogadanja:mon11']);
    expect(model.lanes.flatMap((l) => l.tiles.map((t) => t.key))).not.toContain('dogadanja:beyond');
    expect(model.lanes.flatMap((l) => l.tiles.map((t) => t.key))).not.toContain('dogadanja:running');
  });
  it('orders the sada lane by DOMAIN_ORDER whatever order the producers came in', () => {
    const model = buildTimeband(ctx(), PRODUCERS);
    expect(keys(model, 'sada')).toEqual(['zet-rt:route:6', 'zet-rt:route:11', 'zet-rt:route:12', 'zet-rt:route:13', 'safety', 'hrt-news:n1', 'glasnik:issue']);
  });
  it('trims sada transit to two on the phone and four on the desktop, counting the rest into one more foot in the producer’s words', () => {
    const onPhone = lane(buildTimeband(phone(), PRODUCERS), 'sada');
    expect(onPhone.tiles.filter((t) => t.domain === 'transit').map((t) => t.key)).toEqual(['zet-rt:route:6', 'zet-rt:route:11']);
    expect(onPhone.foot[0]).toEqual({ kind: 'more', domain: 'transit', layer: 'u-pokretu', count: 4, text: '+ 4 linije', aria: '+ 4 linije, Sa stanice Trg bana J. Jelačića' });
    expect(onPhone.foot).toHaveLength(1);
    const onDesk = lane(buildTimeband(ctx(), PRODUCERS), 'sada');
    expect(onDesk.tiles.filter((t) => t.domain === 'transit')).toHaveLength(4);
    expect(onDesk.foot).toEqual([{ kind: 'more', domain: 'transit', layer: 'u-pokretu', count: 2, text: '+ 2 linije', aria: '+ 2 linije, Sa stanice Trg bana J. Jelačića' }]);
  });
  it('caps a time lane at four on the phone and six on the desktop: eight starts on Saturday leave 4 + 4 and 6 + 2, worded by timeband.moreItems when the producer has no words', () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ id: `sat${i}`, at: `2026-09-12T${String(8 + i).padStart(2, '0')}:00:00Z` }));
    const onPhone = lane(buildTimeband(phone(), [events(eight)]), 'sutra');
    expect(onPhone.tiles.map((t) => t.key)).toEqual(['dogadanja:sat0', 'dogadanja:sat1', 'dogadanja:sat2', 'dogadanja:sat3']);
    expect(onPhone.foot).toEqual([{ kind: 'more', domain: 'events', layer: 'kultura', count: 4, text: '+ 4 stavke', aria: undefined }]);
    const onDesk = lane(buildTimeband(ctx(), [events(eight)]), 'sutra');
    expect(onDesk.tiles).toHaveLength(6);
    expect(onDesk.foot).toEqual([{ kind: 'more', domain: 'events', layer: 'kultura', count: 2, text: '+ 2 stavke', aria: undefined }]);
    expect(lane(buildTimeband(ctx({ i18n: en }), [events(eight)]), 'sutra').foot[0]).toMatchObject({ text: '+ 2 items' });
  });
  it('sorts a time lane by start, all-day items leading their day', () => {
    const saturday: Start[] = [
      { id: 'evening', at: '2026-09-12T18:00:00Z' },
      { id: 'morning', at: '2026-09-12T08:00:00Z' },
      { id: 'allday', at: '2026-09-12T00:00:00Z', allDay: true },
      { id: 'early', at: '2026-09-12T02:30:00Z' },
    ];
    expect(keys(buildTimeband(ctx(), [events(saturday)]), 'sutra')).toEqual(['dogadanja:allday', 'dogadanja:early', 'dogadanja:morning', 'dogadanja:evening']);
  });
  it('tints only the first events tile in večeras', () => {
    const model = buildTimeband(ctx(), PRODUCERS);
    expect(lane(model, 'veceras').tiles.map((t) => t.tone)).toEqual(['events', undefined]);
    expect(lane(model, 'danas').tiles.map((t) => t.tone)).toEqual([undefined, undefined]);
    expect(lane(model, 'sutra').tiles[0]!.tone).toBeUndefined();
  });
  it('a stale lead module marks every tile of its producer with the status badge and no one else’s', () => {
    const snapshots = { ...ALL_LIVE, 'zet-rt': stale('zet-rt') };
    const sada = lane(buildTimeband(ctx({ snapshots }), PRODUCERS), 'sada');
    const badge = statusBadge(hr, snapshots['zet-rt']);
    expect(badge).toContain('data-status="stale"');
    for (const tile of sada.tiles) expect(tile.stale, tile.key).toBe(tile.domain === 'transit' ? badge : undefined);
  });
  it('a source that failed puts one state foot with a retry in the producer’s lane and paints no tile: before its first answer, and when it answers down', () => {
    const withoutNews: LayerContext['snapshots'] = { ...ALL_LIVE };
    delete withoutNews['hrt-news'];
    const failed = lane(buildTimeband(ctx({ snapshots: withoutNews, errors: { 'hrt-news': 'HTTP 503' } }), PRODUCERS), 'sada');
    expect(failed.tiles.some((t) => t.domain === 'news')).toBe(false);
    expect(failed.busy).toBe(false);
    const state = failed.foot.find((f) => f.kind === 'state');
    expect(state).toMatchObject({ kind: 'state', domain: 'news' });
    expect(state!.kind === 'state' && state!.markup).toContain('data-testid="tb-state-news"');
    expect(state!.kind === 'state' && state!.markup).toContain('data-action="retry" data-module="hrt-news"');
    expect(state!.kind === 'state' && state!.markup).toContain('Stanje nije potvrđeno: izvor ne odgovara.');
    const answeredDown = lane(buildTimeband(ctx({ snapshots: { ...ALL_LIVE, 'hrt-news': down('hrt-news') } }), PRODUCERS), 'sada');
    expect(answeredDown.tiles.some((t) => t.domain === 'news')).toBe(false);
    expect(answeredDown.foot.filter((f) => f.kind === 'state')).toHaveLength(1);
  });
  it('says a down module once per lane even when several producers read it, and once per lane it feeds', () => {
    const worksLike: TileProducer = { ...gazette, domain: 'komunalno', modules: ['dogadanja'], skeleton: { bucket: 'sada', variant: 'band', count: 1 } };
    const assemblyLike: TileProducer = { ...gazette, domain: 'civic', modules: ['dogadanja'], skeleton: null };
    const model = buildTimeband(ctx({ snapshots: { ...ALL_LIVE, dogadanja: down('dogadanja') } }), [worksLike, assemblyLike, events(STARTS)]);
    expect(lane(model, 'sada').foot.filter((f) => f.kind === 'state')).toHaveLength(1);
    expect(lane(model, 'danas').foot.filter((f) => f.kind === 'state')).toHaveLength(1);
    expect(model.lanes.flatMap((l) => l.tiles)).toHaveLength(0);
  });
  it('a lead module still loading paints the producer’s skeletons in its lane and marks it busy: transit 2/4 in sada, events 3 in the first time lane', () => {
    const onPhone = buildTimeband(phone({ snapshots: { 'hrt-news': live('hrt-news'), glasnik: live('glasnik') } }), PRODUCERS);
    const sada = lane(onPhone, 'sada');
    expect(sada.busy).toBe(true);
    expect(sada.skeletons).toEqual([{ domain: 'transit', variant: 'value', key: 'sk-transit-0' }, { domain: 'transit', variant: 'value', key: 'sk-transit-1' }]);
    expect(sada.tiles.map((t) => t.key)).toEqual(['safety', 'hrt-news:n1', 'glasnik:issue']);
    const danas = lane(onPhone, 'danas');
    expect(danas.busy).toBe(true);
    expect(danas.skeletons.map((s) => s.key)).toEqual(['sk-events-0', 'sk-events-1', 'sk-events-2']);
    expect(danas.skeletons.every((s) => s.variant === 'time' && s.domain === 'events')).toBe(true);
    expect(lane(onPhone, 'veceras').busy).toBe(false);
    expect(lane(buildTimeband(ctx({ snapshots: {} }), PRODUCERS), 'sada').skeletons.filter((s) => s.domain === 'transit')).toHaveLength(4);
    // At night the first time lane is noćas.
    const night = buildTimeband(ctx({ snapshots: {}, now: FRI_EVENING }), PRODUCERS);
    expect(lane(night, 'veceras').skeletons).toHaveLength(3);
    expect(night.lanes.map((l) => l.col)).toEqual(['sada', 'veceras', 'sutra', 'tjedan']);
  });
  it('safety never skeletons, downs or goes stale: its band stands whatever its sources do', () => {
    for (const snapshots of [{}, { 'dhmz-cap': down('dhmz-cap') }, { 'dhmz-cap': stale('dhmz-cap') }]) {
      const sada = lane(buildTimeband(ctx({ snapshots }), [safety]), 'sada');
      expect(sada.tiles.map((t) => t.key)).toEqual(['safety']);
      expect(sada.tiles[0]!.stale).toBeUndefined();
      expect(sada.foot).toEqual([]);
      expect(sada.skeletons).toEqual([]);
      expect(sada.busy).toBe(false);
    }
  });
  it('selects the column tb-col names when it exists, else sada', () => {
    expect(buildTimeband(ctx({ view: view('tjedan') }), PRODUCERS).selected).toBe('tjedan');
    expect(buildTimeband(ctx({ view: view('bogus') }), PRODUCERS).selected).toBe('sada');
    expect(buildTimeband(ctx({ view: view('danas'), now: FRI_EVENING }), PRODUCERS).selected).toBe('sada');
    expect(buildTimeband(ctx(), PRODUCERS).selected).toBe('sada');
  });
  it('skips a producer whose flag is off: no tile, no skeleton, never asked', () => {
    bikesProduce.mockClear();
    const model = buildTimeband(ctx({ snapshots: {} }), [bikes, safety]);
    expect(bikesProduce).not.toHaveBeenCalled();
    expect(lane(model, 'sada').skeletons).toEqual([]);
    expect(lane(buildTimeband(ctx(), [bikes]), 'sada').tiles).toEqual([]);
  });
  it('hands every producer the columns, the surface, the kvart (the whole city until the shell sets one) and the bucket function', () => {
    const produce = vi.fn<TileProducer['produce']>(() => []);
    const probe: TileProducer = { domain: 'civic', modules: ['glasnik'], layer: 'uprava-i-pravo', skeleton: null, produce };
    buildTimeband(phone(), [probe]);
    const o = produce.mock.calls[0]![1];
    expect(o.surface).toBe('phone');
    expect(o.kvart).toBeNull();
    expect(o.columns.map((c) => c.id)).toEqual(['sada', 'danas', 'veceras', 'sutra', 'tjedan']);
    expect(o.bucket('2026-09-11T18:00:00Z')).toBe('veceras');
    // The shell's kvart (area S) reaches the context as `kvart`; the band reads it structurally until the field lands.
    buildTimeband({ ...ctx(), kvart: 'tresnjevka-sjever' } as LayerContext, [probe]);
    expect(produce.mock.calls[1]![1].kvart).toBe('tresnjevka-sjever');
  });
  it('drops a tile whose bucket is null even when the producer kept it', () => {
    const careless: TileProducer = { ...events([]), produce: () => [eventTile({ id: 'past', at: '2026-09-11T10:00:00Z' })] };
    expect(buildTimeband(ctx(), [careless]).lanes.flatMap((l) => l.tiles)).toEqual([]);
  });
  it('carries the moment, the mode, the surface, the clock, and the weather on the phone only', () => {
    expect(buildTimeband(ctx(), PRODUCERS)).toMatchObject({ now: NOW, mode: 'day', surface: 'desktop', selected: 'sada', clock: '14:32', weather: null });
    expect(buildTimeband(ctx({ now: FRI_EVENING }), PRODUCERS).mode).toBe('night');
    expect(buildTimeband(ctx({ snapshots: { ...ALL_LIVE, 'dhmz-now': OBSERVATION } }), PRODUCERS).weather).toBeNull();
    expect(buildTimeband(phone({ snapshots: { ...ALL_LIVE, 'dhmz-now': OBSERVATION } }), PRODUCERS).weather).toEqual(weatherStatus(hr, { 'dhmz-now': OBSERVATION }, NOW));
    expect(buildTimeband(phone(), PRODUCERS).weather).toBeNull();
    expect(buildTimeband(phone({ snapshots: { ...ALL_LIVE, 'dhmz-now': NO_TEMP } }), PRODUCERS).weather).toBeNull();
  });
});

const SEG_BUTTON = (value: string, pressed: boolean, aria: string, word: string): string =>
  `<button type="button" class="tb-seg-btn" data-action="filter" data-filter-key="tb-col" data-filter-value="${value}" aria-pressed="${pressed}" aria-label="${aria}"><span>${word}</span></button>`;

describe('renderTimebandSeg: the phone’s segmented control (A.4)', () => {
  it('writes a group of five pressed-state buttons whose labels read the time word and its head, the clock for sada', () => {
    expect(renderTimebandSeg(hr, buildTimeband(ctx(), PRODUCERS))).toBe(
      '<div class="tb-seg" role="group" aria-label="Doba dana" data-key="tb-seg" data-testid="tb-seg" data-col="sada">'
      + SEG_BUTTON('sada', true, 'sada, 14:32', 'sada')
      + SEG_BUTTON('danas', false, 'poslijepodne, do 18:00', 'popodne')
      + SEG_BUTTON('veceras', false, 'večeras, od 18:00', 'večeras')
      + SEG_BUTTON('sutra', false, 'sutra, sub 12. 9.', 'sutra')
      + SEG_BUTTON('tjedan', false, 'tjedan, do čet 17. 9.', 'tjedan')
      + '</div>',
    );
  });
  it('presses the selected column and names it on the group', () => {
    const html = renderTimebandSeg(hr, buildTimeband(ctx({ view: view('sutra') }), PRODUCERS));
    expect(html).toContain('data-testid="tb-seg" data-col="sutra"');
    expect(html).toContain('data-filter-value="sutra" aria-pressed="true"');
    expect(html).toContain('data-filter-value="sada" aria-pressed="false"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });
  it('has four buttons at night', () => {
    expect(renderTimebandSeg(hr, buildTimeband(ctx({ now: FRI_EVENING }), PRODUCERS)).match(/<button/g)).toHaveLength(4);
  });
});

const render = (c: LayerContext, producers: readonly TileProducer[] = PRODUCERS): HTMLElement => createElementFromHTML(renderTimeband(c.i18n, buildTimeband(c, producers)));
const SADA_HEAD = '<div class="tb-head" data-col="sada" data-key="head-sada" data-testid="tb-head-sada" data-current="true"><h3 class="tb-head-title" id="tb-head-sada"><span class="tb-word kicker">sada</span> <time class="tb-h tb-clock" data-testid="tb-clock" datetime="2026-09-11T12:32:00.000Z">14:32</time></h3></div>';

describe('renderTimeband: the band (A.4)', () => {
  it('writes the root, five heads, the axis, then five lanes in time order; heads precede lanes in the DOM', () => {
    const tb = render(ctx());
    expect(tb.matches('section.tb[data-cols="5"][data-mode="day"][data-key="tb"][data-testid="tb"]')).toBe(true);
    expect([...tb.children].map((c) => c.className)).toEqual(['tb-heads', 'tb-axis', 'tb-lanes']);
    expect([...tb.querySelectorAll('.tb-head')].map((h) => h.getAttribute('data-col'))).toEqual(['sada', 'danas', 'veceras', 'sutra', 'tjedan']);
    expect([...tb.querySelectorAll('.tb-lane')].map((l) => l.getAttribute('data-col'))).toEqual(['sada', 'danas', 'veceras', 'sutra', 'tjedan']);
    expect([...tb.querySelectorAll('.tb-head, .tb-lane')].map((el) => el.className)).toEqual([...Array(5).fill('tb-head'), ...Array(5).fill('tb-lane')]);
    expect([...tb.querySelectorAll('.tb-head h3')].map((h) => text(h))).toEqual(['sada 14:32', 'poslijepodne do 18:00', 'večeras od 18:00', 'sutra sub 12. 9.', 'tjedan do čet 17. 9.']);
    expect(tb.querySelector('.tb-heads')?.getAttribute('data-key')).toBe('heads');
    expect(tb.querySelector('.tb-lanes')?.matches('[data-key="lanes"][data-testid="tb-lanes"][data-col="sada"]')).toBe(true);
  });
  it('writes the sada head exactly: the time word and the 40 px clock as one h3, no weather on the desktop', () => {
    const tb = render(ctx());
    expect(tb.querySelector('[data-testid="tb-head-sada"]')?.outerHTML).toBe(SADA_HEAD);
    expect(tb.querySelector('[data-testid="tb-head-danas"]')?.outerHTML).toBe(
      '<div class="tb-head" data-col="danas" data-key="head-danas" data-testid="tb-head-danas"><h3 class="tb-head-title" id="tb-head-danas"><span class="tb-word kicker">poslijepodne</span> <span class="tb-h">do 18:00</span></h3></div>',
    );
    expect(tb.querySelector('.tb-weather')).toBeNull();
  });
  it('names every lane by its head: role group, aria-labelledby the h3 id', () => {
    const tb = render(ctx());
    for (const col of ['sada', 'danas', 'veceras', 'sutra', 'tjedan']) {
      const lane = tb.querySelector(`[data-testid="tb-lane-${col}"]`)!;
      expect(lane.matches(`.tb-lane[data-col="${col}"][data-key="lane-${col}"][role="group"][aria-labelledby="tb-head-${col}"]`), col).toBe(true);
      expect(tb.querySelector(`h3#tb-head-${col}`), col).not.toBeNull();
    }
  });
  it('marks the selected column current on its head, its lane and the lanes row; the axis is decorative and its filled dot is sada, the origin', () => {
    const tb = render(ctx({ view: view('tjedan') }));
    expect([...tb.querySelectorAll('[data-current="true"]')].map((el) => `${el.className}:${el.getAttribute('data-col')}`)).toEqual(['tb-head:tjedan', 'tb-lane:tjedan']);
    expect(tb.querySelector('.tb-lanes')?.getAttribute('data-col')).toBe('tjedan');
    const axis = tb.querySelector('.tb-axis')!;
    expect(axis.matches('[aria-hidden="true"][data-key="axis"]')).toBe(true);
    expect([...axis.querySelectorAll('.tb-dot')].map((d) => d.getAttribute('data-col'))).toEqual(['sada', 'danas', 'veceras', 'sutra', 'tjedan']);
    expect([...axis.querySelectorAll('.tb-dot[data-on="true"]')].map((d) => d.getAttribute('data-col'))).toEqual(['sada']);
  });
  it('night mode: four columns, data-cols 4, data-mode night', () => {
    const tb = render(ctx({ now: FRI_EVENING }));
    expect(tb.matches('[data-cols="4"][data-mode="night"]')).toBe(true);
    expect([...tb.querySelectorAll('.tb-head h3')].map((h) => text(h))).toEqual(['sada 19:40', 'noćas do 04:00', 'sutra sub 12. 9.', 'tjedan do čet 17. 9.']);
    expect(tb.querySelectorAll('.tb-dot')).toHaveLength(4);
  });
  it('renders each tile through the tile grammar in lane order, then the feet', () => {
    const tb = render(phone());
    const sada = tb.querySelector('[data-testid="tb-lane-sada"]')!;
    expect([...sada.children].map((el) => el.getAttribute('data-key'))).toEqual(['zet-rt:route:6', 'zet-rt:route:11', 'safety', 'hrt-news:n1', 'glasnik:issue', 'more-transit']);
    expect(sada.querySelector('.tl[data-variant="value"][data-domain="transit"][data-testid="tile-transit"]')).not.toBeNull();
    expect(sada.querySelector('.tl[data-variant="band"][data-domain="safety"][data-level="calm"]')).not.toBeNull();
    expect(text(tb.querySelector('[data-testid="tb-lane-danas"] .tl-time'))).toBe('cijeli dan');
    expect([...tb.querySelectorAll('[data-testid="tb-lane-veceras"] .tl')].map((t) => t.getAttribute('data-tone'))).toEqual(['events', null]);
    expect(tb.getAttribute('aria-busy')).toBeNull();
  });
  it('writes the more foot exactly: a link into the domain with the words and the arrow, its aria only when the producer worded one', () => {
    const tb = render(phone());
    expect(tb.querySelector('[data-testid="tb-more-transit"]')?.outerHTML).toBe(
      '<a class="tb-more" data-key="more-transit" data-testid="tb-more-transit" href="#layer=u-pokretu" data-action="nav" data-layer="u-pokretu" aria-label="+ 4 linije, Sa stanice Trg bana J. Jelačića"><span>+ 4 linije</span><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-arrow-up-right"></use></svg></a>',
    );
    const eight = Array.from({ length: 8 }, (_, i) => ({ id: `sat${i}`, at: `2026-09-12T${String(8 + i).padStart(2, '0')}:00:00Z` }));
    const more = render(phone(), [events(eight)]).querySelector('[data-testid="tb-more-events"]')!;
    expect(more.hasAttribute('aria-label')).toBe(false);
    expect(text(more)).toBe('+ 4 stavke');
    expect(more.getAttribute('href')).toBe('#layer=kultura');
  });
  it('a busy lane carries aria-busy and one visually hidden loading word, then the skeletons where their domain will stand', () => {
    const tb = render(phone({ snapshots: { 'hrt-news': live('hrt-news'), glasnik: live('glasnik') } }));
    const sada = tb.querySelector('[data-testid="tb-lane-sada"]')!;
    expect(sada.getAttribute('aria-busy')).toBe('true');
    expect(sada.firstElementChild?.outerHTML).toBe('<span class="visually-hidden" data-key="loading">učitavanje podataka</span>');
    expect([...sada.children].map((el) => el.getAttribute('data-key'))).toEqual(['loading', 'sk-transit-0', 'sk-transit-1', 'safety', 'hrt-news:n1', 'glasnik:issue']);
    expect(sada.querySelectorAll('.tl[data-skeleton][data-variant="value"][aria-hidden="true"]')).toHaveLength(2);
    expect(sada.querySelectorAll('.visually-hidden')).toHaveLength(1);
    const danas = tb.querySelector('[data-testid="tb-lane-danas"]')!;
    expect(danas.getAttribute('aria-busy')).toBe('true');
    expect([...danas.children].map((el) => el.getAttribute('data-key'))).toEqual(['loading', 'sk-events-0', 'sk-events-1', 'sk-events-2']);
    expect(danas.querySelectorAll('.tl[data-skeleton][data-variant="time"]')).toHaveLength(3);
    expect(danas.querySelector('.tb-empty')).toBeNull();
    expect(tb.querySelector('[data-testid="tb-lane-veceras"]')?.getAttribute('aria-busy')).toBeNull();
    expect(tb.querySelectorAll('.tl[data-skeleton][href], .tl[data-skeleton][data-action]')).toHaveLength(0);
  });
  it('a stale transit tile keeps its shape, shows the badge in place of its context and is marked data-stale', () => {
    const tb = render(ctx({ snapshots: { ...ALL_LIVE, 'zet-rt': stale('zet-rt') } }));
    const tiles = tb.querySelectorAll('.tl[data-domain="transit"]');
    expect(tiles).toHaveLength(4);
    for (const tile of tiles) {
      expect(tile.hasAttribute('data-stale')).toBe(true);
      expect(tile.querySelector('.tl-context .status-badge[data-status="stale"]')).not.toBeNull();
      expect(tile.getAttribute('aria-label')).toContain('zastarjelo od 14:00');
    }
    expect(tb.querySelectorAll('.tl[data-stale]')).toHaveLength(4);
  });
  it('a down source renders the state block with its retry at the foot of the lane, after the tiles, and no tile of its own', () => {
    const tb = render(ctx({ snapshots: { ...ALL_LIVE, 'hrt-news': down('hrt-news') } }));
    const sada = tb.querySelector('[data-testid="tb-lane-sada"]')!;
    expect(sada.querySelector('[data-testid="tile-news"]')).toBeNull();
    const state = sada.querySelector('.state[data-kind="down"][data-testid="tb-state-news"]')!;
    expect(state.querySelector('[data-action="retry"][data-module="hrt-news"]')).not.toBeNull();
    expect(text(state)).toContain('Stanje nije potvrđeno: izvor ne odgovara.');
    expect(sada.lastElementChild).toBe(state);
    expect([...sada.children].filter((el) => el.classList.contains('tl'))).toHaveLength(6);
  });
  it('says "ništa najavljeno" only in an empty lane with no foot and no skeleton', () => {
    const tb = render(ctx(), [safety, events([{ id: 'fri17', at: '2026-09-11T15:00:00Z' }])]);
    expect(tb.querySelector('[data-testid="tb-lane-tjedan"]')?.innerHTML).toBe('<p class="tb-empty" data-key="empty">ništa najavljeno</p>');
    expect(tb.querySelector('[data-testid="tb-lane-danas"] .tb-empty')).toBeNull();
    expect(tb.querySelector('[data-testid="tb-lane-sada"] .tb-empty')).toBeNull();
    const downEvents = render(ctx({ snapshots: { ...ALL_LIVE, dogadanja: down('dogadanja') } }), [events([])]);
    expect(downEvents.querySelector('[data-testid="tb-lane-danas"] .tb-empty')).toBeNull();
    expect(downEvents.querySelector('[data-testid="tb-lane-danas"] .state')).not.toBeNull();
    expect(render(ctx({ snapshots: {} }), [events([])]).querySelector('[data-testid="tb-lane-danas"] .tb-empty')).toBeNull();
    expect(text(render(ctx({ i18n: en }), [safety]).querySelector('[data-testid="tb-lane-sutra"] .tb-empty'))).toBe('nothing announced');
  });
  it('on the phone the sada head links glyph, temperature and sunset into Vrijeme; on the desktop it does not; without a usable observation the clock stands alone, never a dash', () => {
    const status = weatherStatus(hr, { 'dhmz-now': OBSERVATION }, NOW)!;
    const onPhone = render(phone({ snapshots: { ...ALL_LIVE, 'dhmz-now': OBSERVATION } }));
    const head = onPhone.querySelector('[data-testid="tb-head-sada"]')!;
    expect(head.outerHTML).toBe(SADA_HEAD.replace('</h3></div>', `</h3><a class="tb-weather" href="#layer=zrak-i-nebo" data-action="nav" data-layer="zrak-i-nebo" data-testid="tb-weather" data-status="live" aria-label="vedro, 21 °C, zalazak 19:16">${weatherStatusMarkup(status)}</a></div>`));
    expect(text(head.querySelector('.tb-temp'))).toBe('21 °C');
    expect(head.querySelector('.tb-weather .icon use')?.getAttribute('href')).toBe('#icon-sun');
    const staleObservation = { ...OBSERVATION, status: 'stale' as const, staleSince: '2026-09-11T12:00:00Z' };
    expect(render(phone({ snapshots: { ...ALL_LIVE, 'dhmz-now': staleObservation } })).querySelector('.tb-weather')?.getAttribute('data-status')).toBe('stale');
    expect(render(ctx({ snapshots: { ...ALL_LIVE, 'dhmz-now': OBSERVATION } })).querySelector('.tb-weather')).toBeNull();
    for (const snapshots of [ALL_LIVE, { ...ALL_LIVE, 'dhmz-now': NO_TEMP }, { ...ALL_LIVE, 'dhmz-now': down('dhmz-now') }]) {
      const bare = render(phone({ snapshots })).querySelector('[data-testid="tb-head-sada"]')!;
      expect(bare.querySelector('.tb-weather')).toBeNull();
      expect(bare.outerHTML).toBe(SADA_HEAD);
      expect(text(bare)).not.toMatch(/[–—-]/);
    }
  });
});

describe('tickTimebandClock: the one clock ticks through the shell seam', () => {
  const mount = (c: LayerContext): HTMLElement => {
    const model = buildTimeband(c, PRODUCERS);
    document.body.innerHTML = renderTimebandSeg(hr, model) + renderTimeband(hr, model);
    return document.body;
  };
  it('updates the clock text and datetime, and the sada segment’s label, when the minute changed, and leaves the DOM alone within the minute', () => {
    const root = mount(ctx());
    const clock = root.querySelector('.tb-clock')!;
    tickTimebandClock(root, NOW + 30_000);
    expect(clock.textContent).toBe('14:32');
    expect(clock.getAttribute('datetime')).toBe('2026-09-11T12:32:00.000Z');
    tickTimebandClock(root, NOW + 60_000);
    expect(clock.textContent).toBe('14:33');
    expect(clock.getAttribute('datetime')).toBe('2026-09-11T12:33:00.000Z');
    expect(root.querySelector('.tb-seg-btn[data-filter-value="sada"]')?.getAttribute('aria-label')).toBe('sada, 14:33');
    expect(text(root.querySelector('#tb-head-sada'))).toBe('sada 14:33');
  });
  it('does nothing without a clock in the root', () => {
    document.body.innerHTML = '<div class="tb"></div>';
    expect(() => tickTimebandClock(document.body, NOW)).not.toThrow();
    expect(document.body.innerHTML).toBe('<div class="tb"></div>');
  });
});

// ---------------------------------------------------------------------------
// The real producers (Task T2.3; T3.2 appends bikes/parking/waste behind
// their own flags), through buildTimeband's own default parameter: each
// producer's own fixtures live in producers.test.ts and
// producers-mobility.test.ts; this is the integration proof that
// DEFAULT_PRODUCERS, assembled and ordered, is what a caller gets from
// `buildTimeband(ctx)` with no second argument.

describe('buildTimeband: the real producers over the layers fixtures (DEFAULT_PRODUCERS)', () => {
  const REAL_NOW = FRI_AFTERNOON;
  const attribution = (text: string) => ({ text, url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' });
  const snap = (module: ModuleId, items: ModuleSnapshot['items']): ModuleSnapshot => ({
    module, tier: 'open', status: 'live', fetchedAt: new Date(REAL_NOW - 60_000).toISOString(), attribution: attribution(`Izvor: ${module}`), items,
  });
  const REAL_STOP: ScreenStop = { id: '106_1', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, routes: ['6', '11'] };
  const REAL_SNAPSHOTS: LayerContext['snapshots'] = {
    'zet-rt': snap('zet-rt', [
      { id: 'route:6', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '6', data: { routeId: '6', medianDelaySeconds: 90, vehicles: 2 } },
      { id: 'route:11', module: 'zet-rt', kind: 'vehicle', tier: 'session', title: '11', data: { routeId: '11', medianDelaySeconds: -20, vehicles: 1 } },
    ]),
    prometnice: snap('prometnice', [
      { id: 'c1', module: 'prometnice', kind: 'closure', tier: 'open', title: 'Grada Vukovara', at: '2026-04-18T07:00:00Z', until: '2026-09-11T22:00:00Z' },
    ]),
    'dhmz-cap': snap('dhmz-cap', []),
    emsc: snap('emsc', []),
    'hrt-news': snap('hrt-news', [{ id: 'n1', module: 'hrt-news', kind: 'news', tier: 'open', title: 'Naslov vijesti', at: '2026-09-11T11:00:00Z' }]),
    glasnik: snap('glasnik', [{ id: 'a1', module: 'glasnik', kind: 'act', tier: 'open', title: 'Odluka', at: '2026-09-10T00:00:00Z', data: { broj: '21', godina: '2026' } }]),
    dogadanja: snap('dogadanja', [
      { id: 'kulturpunkt:1', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Koncert u parku', at: '2026-09-12T18:00:00Z', data: { source: 'kulturpunkt', category: 'koncert', precision: 'time' } },
      { id: 'komunalne:5', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Horvati', at: '2026-06-01T00:00:00Z', data: { source: 'komunalne', phase: 'Radovi u tijeku', status: 'U tijeku', amount: 1500, precision: 'day' } },
      { id: 'skupstina:4', module: 'dogadanja', kind: 'event', tier: 'session', title: 'Poziv na 13. sjednicu', at: '2026-09-14T09:00:00Z', data: { source: 'skupstina', venue: 'Stara gradska vijećnica', precision: 'time' } },
    ]),
  };
  function realCtx(): LayerContext {
    return {
      i18n: hr,
      snapshots: REAL_SNAPSHOTS,
      now: REAL_NOW,
      screen: { surface: 'desktop', locale: 'hr', theme: 'light', themePreference: 'light', lightweight: false, reducedMotion: false, stop: REAL_STOP },
    };
  }

  it('assembles every sada domain from the real producers, in DOMAIN_ORDER, using the default parameter', () => {
    const model = buildTimeband(realCtx()); // no second argument: DEFAULT_PRODUCERS
    const sada = model.lanes.find((l) => l.col === 'sada')!;
    expect(sada.tiles.map((t) => t.domain)).toEqual(['transit', 'transit', 'mobility', 'komunalno', 'safety', 'news', 'civic']);
    expect(sada.tiles.find((t) => t.testid === 'tile-safety')?.tone).toBe('calm');
    expect(sada.tiles.find((t) => t.testid === 'tile-gazette')?.value).toBe('21/2026');
    expect(sada.tiles.find((t) => t.testid === 'tile-works')?.value).toBe('1');
    expect(sada.tiles.find((t) => t.testid === 'tile-closures')?.title).toBe('Grada Vukovara');
    expect(sada.tiles.find((t) => t.testid === 'tile-news')?.title).toBe('Naslov vijesti');
  });

  it('lands the next Assembly session and the next culture event in their own time lanes', () => {
    const model = buildTimeband(realCtx());
    const tjedan = model.lanes.find((l) => l.col === 'tjedan')!;
    expect(tjedan.tiles.some((t) => t.variant === 'ink' && t.title === 'Poziv na 13. sjednicu')).toBe(true);
    const sutra = model.lanes.find((l) => l.col === 'sutra')!;
    expect(sutra.tiles.some((t) => t.key === 'dogadanja:kulturpunkt:1')).toBe(true);
  });

  it('never asks the last-run producer while FEED_LASTRUN is off: no lastrun tile anywhere on the band', () => {
    const model = buildTimeband(realCtx());
    const keys = model.lanes.flatMap((l) => l.tiles.map((t) => t.key));
    expect(keys.some((k) => k.includes('lastrun'))).toBe(false);
  });

  it('is the same producer list DEFAULT_PRODUCERS exports, in the sada reading order the plan names', () => {
    expect(DEFAULT_PRODUCERS.map((p) => p.domain)).toEqual([
      'transit', 'mobility', 'komunalno', 'safety', 'news', 'civic', 'civic', 'events', 'transit', 'mobility', 'mobility', 'komunalno',
    ]);
  });

  it('never asks bikes, parking or waste while their flags are off: no such tile anywhere on the band', () => {
    const model = buildTimeband(realCtx());
    const keys = model.lanes.flatMap((l) => l.tiles.map((t) => t.key));
    expect(keys.some((k) => k.startsWith('bikes:') || k.startsWith('parking:') || k.startsWith('waste:'))).toBe(false);
  });
});
