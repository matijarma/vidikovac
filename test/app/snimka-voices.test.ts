// The latest headline within three hours, the latest notice (kept until the
// next), the latest event within an hour (app/src/snimka/voices.ts); and the
// feed's pure half (Objave, v3): order, kinds, no companion or internal items,
// dedupe by noticeId and its fallback, the fold per beat, the current item and
// the log, the subject, the timeline's one marker row and the state band.
import { describe, expect, it } from 'vitest';
import type { NewsFile, NoticesFile, SnimkaEvent } from '../../shared/snimka';
import { SNIMKA_WINDOW } from '../../shared/snimka';
import { buildEvents, buildNews, buildNotices, buildWindowSeries, MARKS } from '../../e2e/snimka-fixtures';
import {
  buildVoices, chipKeys, feedAt, feedMarkers, focusSubject, foldedUpTo, foldPress, kickerOf, mentionsSubject, repeatedNotice, speaksInFeed, stateBand, type VoiceItem,
} from '../../app/src/snimka/voices';
import { ARTICLE_WINDOW_S, currentArticle, currentMarker, currentNotice, MARKER_WINDOW_S } from '../../app/src/snimka/voices';

const H = 3600;
const P = { focus: { kind: 'none' } as const, facts: [] as never[], mentions: {} };
const news: NewsFile = {
  v: 2,
  outlets: { jutarnji: { name: 'Jutarnji list', home: 'https://www.jutarnji.hr/' }, vecernji: { name: 'Večernji list', home: 'https://www.vecernji.hr/' }, n1: { name: 'N1', home: 'https://n1info.hr/' } },
  items: [
    { id: 'b', outlet: 'vecernji', title: 'Drugi', link: 'https://www.vecernji.hr/2', pubSec: 20 * H, beat: null, ...P },
    { id: 'a', outlet: 'jutarnji', title: 'Prvi', link: 'https://www.jutarnji.hr/1', pubSec: 10 * H, beat: 'pocetak', ...P },
    { id: 'c', outlet: 'n1', title: 'Treći', link: 'https://n1info.hr/3', pubSec: 30 * H, beat: 'presuda', ...P },
  ],
};
const notices: NoticesFile = { v: 2, items: [
  { id: 2, title: 'Druga', text: null, link: 'https://www.zet.hr/2', pubSec: 50 * H, ...P },
  { id: 1, title: 'Prva', text: 'tekst', link: 'https://www.zet.hr/1', pubSec: 5 * H, ...P },
] };
const ev = (id: string, atSec: number, chapter = true): SnimkaEvent => ({ id, atSec, kind: 'recording', title: id, text: null, sources: [], derived: false, chapter, ...P });
const events = [ev('late', 40 * H), ev('early', 2 * H), ev('plain', 41 * H, false)];

describe('currentArticle', () => {
  it('answers the latest headline published at or before the instant, with its outlet, in file order or not', () => {
    expect(currentArticle(news, 10 * H)).toEqual({ item: news.items[1], outlet: 'Jutarnji list' });
    expect(currentArticle(news, 21 * H)).toEqual({ item: news.items[0], outlet: 'Večernji list' });
    expect(currentArticle(news, 30 * H + 1)).toEqual({ item: news.items[2], outlet: 'N1' });
  });
  it('lets a headline live three hours, then says nothing; nothing before the first', () => {
    expect(ARTICLE_WINDOW_S).toBe(3 * H);
    expect(currentArticle(news, 13 * H)?.item.id).toBe('a');
    expect(currentArticle(news, 13 * H + 1)).toBeNull();
    expect(currentArticle(news, 10 * H - 1)).toBeNull();
    expect(currentArticle(news, 25 * H, 6 * H)?.item.id).toBe('b');
  });
  it('names an outlet the file does not describe by its key', () => {
    const odd = { ...news, outlets: { ...news.outlets, n1: undefined as never } };
    expect(currentArticle(odd, 31 * H)?.outlet).toBe('n1');
  });
});

describe('currentNotice', () => {
  it('keeps the latest notice until the next one', () => {
    expect(currentNotice(notices, 4 * H)).toBeNull();
    expect(currentNotice(notices, 5 * H)?.id).toBe(1);
    expect(currentNotice(notices, 49 * H)?.id).toBe(1);
    expect(currentNotice(notices, 50 * H)?.id).toBe(2);
    expect(currentNotice(notices, 1000 * H)?.id).toBe(2);
  });
});

describe('currentMarker', () => {
  it('shows an event for an hour, chapters and plain events alike', () => {
    expect(MARKER_WINDOW_S).toBe(H);
    expect(currentMarker(events, 2 * H)?.id).toBe('early');
    expect(currentMarker(events, 3 * H)?.id).toBe('early');
    expect(currentMarker(events, 3 * H + 1)).toBeNull();
    expect(currentMarker(events, 40 * H + 30)?.id).toBe('late');
    expect(currentMarker(events, 41 * H)?.id).toBe('plain');
    expect(currentMarker(events, 1)).toBeNull();
  });
});

// ---- the feed's pure half (v3: Objave) -------------------------------------------------------------
const fixtureFiles = { notices: buildNotices(), news: buildNews(), events: buildEvents().events };
const press = (id: string, atSec: number, beat: string | null, extra: Partial<VoiceItem> = {}): VoiceItem => ({
  id, atSec, kind: 'press', title: id, text: null, link: `https://n1info.hr/${id}`, source: { label: 'N1', url: 'https://n1info.hr/' }, focus: { kind: 'none' }, facts: [], mentions: {}, beat, tone: null, ...extra,
});

describe('buildVoices', () => {
  const items = buildVoices(fixtureFiles);
  it('notices, headlines, chapters and what ZET and the court said, in time order, each with its kind and tone', () => {
    for (let i = 1; i < items.length; i++) expect(items[i]!.atSec).toBeGreaterThanOrEqual(items[i - 1]!.atSec);
    const kinds = new Map(items.map((i) => [i.id, i.kind]));
    expect(kinds.get('notice:10164')).toBe('zet');
    expect(kinds.get('news:v1')).toBe('press');
    expect(kinds.get('event:sud')).toBe('chapter');
    expect(items.find((i) => i.id === 'event:sud')!.tone).toBe('court');
    expect(kinds.get('event:prvo-jutro')).toBe('chapter');
    expect(kinds.get('event:vozni-red-396')).toBe('zet');
    expect(items.find((i) => i.id === 'news:v1')!.tone).toBeNull();
    // A notice published before the window is still a voice (it is what ZET said the day before).
    expect(items[0]!.id).toBe('notice:10164');
  });
  it('no companion items and no recording-internal events; plain readings of the service stay out', () => {
    expect(items.some((i) => (i.kind as string) === 'companion' || i.id.startsWith('companion:'))).toBe(false);
    expect(items.some((i) => i.id === 'event:stanje-usluge' || i.id === 'event:zapisivaci')).toBe(false);
    expect(items.some((i) => i.id === 'event:kraj-snimke')).toBe(false);
    expect(speaksInFeed({ chapter: true, kind: 'recording', internal: true })).toBe(false);
    expect(speaksInFeed({ chapter: false, kind: 'service' })).toBe(false);
    expect(speaksInFeed({ chapter: false, kind: 'court' })).toBe(true);
  });
  it('dedupe by noticeId: a chapter keeps its heading and takes the notice link; any other event gives way to the notice', () => {
    expect(items.some((i) => i.id === 'notice:10166')).toBe(false);
    const ch = items.find((i) => i.id === 'event:linija-228')!;
    expect(ch.kind).toBe('chapter');
    expect(ch.link).toBe('https://www.zet.hr/obavijesti/10166');
    expect(ch.focus).toEqual({ kind: 'route', id: '228' });
    expect(items.some((i) => i.id === 'event:puni-opseg')).toBe(false);
    expect(items.some((i) => i.id === 'notice:10168')).toBe(true);
  });
  it('without a noticeId: within 60 minutes and the same title, or the notice linked among the sources', () => {
    const notice = { id: 7, title: 'Promet ponovno u punom opsegu', text: null, link: 'https://www.zet.hr/obavijesti/7', pubSec: 1000, focus: { kind: 'none' as const }, facts: [], mentions: {} };
    const base = { sources: [] as { label: string; url: string | null }[] };
    expect(repeatedNotice({ ...base, atSec: 1000 + 3000, title: 'promet ponovno u punom opsegu ' }, [notice])?.id).toBe(7);
    expect(repeatedNotice({ ...base, atSec: 1000 + 3700, title: 'Promet ponovno u punom opsegu' }, [notice])).toBeNull();
    expect(repeatedNotice({ atSec: 1500, title: 'ZET: puni opseg', sources: [{ label: 'ZET', url: 'https://www.zet.hr/obavijesti/7' }] }, [notice])?.id).toBe(7);
    expect(repeatedNotice({ atSec: 1500, title: 'Nešto drugo', sources: [] }, [notice])).toBeNull();
    expect(repeatedNotice({ atSec: 99_999, title: 'x', sources: [], noticeId: 7 }, [notice])?.id).toBe(7);
  });
  it('titles stay verbatim; a headline links its article and names its outlet as its kicker', () => {
    const v1 = items.find((i) => i.id === 'news:v1')!;
    expect(v1.title).toBe('ZET uveo autobusnu liniju do Rebra');
    expect(v1.link).toBe('https://www.vecernji.hr/zagreb/primjer-2');
    expect(kickerOf(v1)).toBe('Večernji list');
    expect(kickerOf(items.find((i) => i.id === 'notice:10164')!)).toBe('ZET');
    expect(kickerOf(items.find((i) => i.id === 'event:prvo-jutro')!)).toBe('Poglavlje');
  });
  it('chips: at most two, never on a headline', () => {
    expect(chipKeys(items.find((i) => i.id === 'news:v1')!)).toEqual([]);
    expect(chipKeys(items.find((i) => i.id === 'event:prvo-jutro')!)).toEqual(['seen', 'expected']);
    expect(chipKeys(items.find((i) => i.id === 'notice:10164')!).length).toBe(2);
  });
  it('the subject of an item is its line, station or stop; a city, a place or a layer is none', () => {
    expect(focusSubject({ focus: { kind: 'route', id: '228' } })).toEqual({ kind: 'route', id: '228' });
    expect(focusSubject({ focus: { kind: 'station', id: 'bajs-3' } })).toEqual({ kind: 'station', id: 'bajs-3' });
    expect(focusSubject({ focus: { kind: 'stop', id: '109_1' } })).toEqual({ kind: 'stop', id: '109_1' });
    expect(focusSubject({ focus: { kind: 'city' } })).toBeNull();
    expect(focusSubject({ focus: { kind: 'place', id: 'jelacic' } })).toBeNull();
    expect(focusSubject({ focus: { kind: 'layer', layer: 'bikes' } })).toBeNull();
    expect(mentionsSubject({ focus: { kind: 'none' }, mentions: { routes: ['228'] } }, { kind: 'route', id: '228' })).toBe(true);
    expect(mentionsSubject({ focus: { kind: 'none' }, mentions: { routes: ['17'] } }, { kind: 'route', id: '228' })).toBe(false);
  });
});

describe('foldPress', () => {
  const H = 3600;
  const list = [press('a', 0, 'bajs'), press('b', 1 * H, 'bajs'), press('c', 2.9 * H, 'bajs'), press('d', 3 * H, 'bajs'), press('e', 1 * H, 'taksi'), press('f', 1.5 * H, null), press('g', 1.6 * H, null)];
  const folded = foldPress(list);
  it('keeps one headline per beat per three hours and folds the rest under it', () => {
    expect(folded.map((i) => i.id)).toEqual(['a', 'e', 'f', 'g', 'd']);
    const a = folded.find((i) => i.id === 'a')!;
    expect(a.folded!.map((i) => i.id)).toEqual(['b', 'c']);
    // Three hours after the first, a new head.
    expect(folded.find((i) => i.id === 'd')!.folded).toEqual([]);
    // A headline without a beat is never folded.
    expect(folded.filter((i) => i.beat === null).map((i) => i.id)).toEqual(['f', 'g']);
  });
  it('the fold under a head grows with the clock and leaves the input alone', () => {
    const a = folded.find((i) => i.id === 'a')!;
    expect(foldedUpTo(a, 0)).toEqual([]);
    expect(foldedUpTo(a, 1 * H).map((i) => i.id)).toEqual(['b']);
    expect(foldedUpTo(a, 3 * H).map((i) => i.id)).toEqual(['b', 'c']);
    expect(list[0]!.folded).toBeUndefined();
  });
});

describe('feedAt', () => {
  const many = Array.from({ length: 20 }, (_, i) => press(`p${i}`, i * 60, null, i % 4 === 0 ? { mentions: { routes: ['228'] } } : {}));
  it('the latest at or before the instant is current, the rest the log, newest first; no cap; nothing after the clock', () => {
    const at = feedAt(many, 19 * 60);
    expect(at.current!.id).toBe('p19');
    expect(at.log.length).toBe(19);
    expect(at.log[0]!.id).toBe('p18');
    expect(at.count).toBe(20);
    expect(at.hiddenCount).toBe(0);
    expect(feedAt(many, 5 * 60 - 1).current!.id).toBe('p4');
    expect(feedAt(many, -1)).toEqual({ current: null, log: [], hiddenCount: 0, count: 0 });
  });
  it('a subject keeps only what speaks of it and counts what it left out', () => {
    const at = feedAt(many, 19 * 60, { kind: 'route', id: '228' });
    expect([at.current!.id, ...at.log.map((i) => i.id)]).toEqual(['p16', 'p12', 'p8', 'p4', 'p0']);
    expect(at.hiddenCount).toBe(15);
  });
  it('on the fixture: the 228 subject keeps the chapter and the headline about the line', () => {
    const at = feedAt(foldPress(buildVoices(fixtureFiles)), SNIMKA_WINDOW.toSec, { kind: 'route', id: '228' });
    expect([at.current!.id, ...at.log.map((i) => i.id)]).toEqual(['news:v1', 'event:linija-228']);
  });
});

describe('feedMarkers and stateBand', () => {
  it('one row: the chapters as pins and what ZET and the court said as dots; no press marks', () => {
    const items = buildVoices(fixtureFiles);
    const markers = feedMarkers(foldPress(items));
    const lane = (l: string) => markers.filter((m) => m.lane === l).map((m) => m.id);
    expect(lane('chapter')).toEqual(fixtureFiles.events.filter((e) => e.chapter && !e.internal).map((e) => `event:${e.id}`));
    expect(lane('notice')).toEqual(expect.arrayContaining(['notice:10164', 'notice:10168', 'event:feed-stoji-pon', 'event:vozni-red-396']));
    expect(lane('press')).toEqual([]);
    expect(new Set(markers.map((m) => m.lane)).size).toBe(2);
    for (const m of markers) expect(m.title.length).toBeGreaterThan(0);
  });
  it('the state band: consecutive runs of the judged state with the machine\'s since, none where it held', () => {
    const series = buildWindowSeries();
    const band = stateBand(series);
    expect(band[0]!.from).toBe(series.t0);
    expect(band.at(-1)!.to).toBe(series.t0 + series.n * 60);
    for (let i = 1; i < band.length; i++) {
      expect(band[i]!.from).toBe(band[i - 1]!.to);
      expect(band[i]!.cls).not.toBe(band[i - 1]!.cls);
    }
    const monday = band.find((r) => r.from <= MARKS.monday0745 && MARKS.monday0745 < r.to)!;
    expect(monday.cls).toBe('silent');
    const thursday = band.find((r) => r.from <= MARKS.thursday0745 && MARKS.thursday0745 < r.to)!;
    expect(thursday.cls).toBe('normal');
  });
});
