// The latest headline within three hours, the latest notice (kept until the
// next), the latest event within an hour (app/src/snimka/voices.ts); and the
// feed's pure half: order, kinds, the fold per beat, the cap and the subject,
// the companion's own voices, the timeline's lanes and the state band.
import { describe, expect, it } from 'vitest';
import type { NewsFile, NoticesFile, SnimkaEvent } from '../../shared/snimka';
import { SNIMKA_WINDOW, type VoiceFile } from '../../shared/snimka';
import { buildEvents, buildNews, buildNotices, buildVoiceDay, buildWindowSeries, MARKS, zg } from '../../e2e/snimka-fixtures';
import {
  buildVoices, companionVoices, COMPANION_GAP_S, feedMarkers, focusSubject, foldedUpTo, foldPress, mentionsSubject, stateBand, voicesUpTo, type VoiceItem,
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

// ---- the feed's pure half (v2) ----------------------------------------------------------------
const fixtureFiles = { notices: buildNotices(), news: buildNews(), events: buildEvents().events };
const press = (id: string, atSec: number, beat: string | null, extra: Partial<VoiceItem> = {}): VoiceItem => ({
  id, atSec, kind: 'press', title: id, text: null, link: `https://n1info.hr/${id}`, source: { label: 'N1', url: 'https://n1info.hr/' }, focus: { kind: 'none' }, facts: [], mentions: {}, beat, ...extra,
});

describe('buildVoices', () => {
  const items = buildVoices(fixtureFiles);
  it('every notice, headline and event in time order, each with its kind', () => {
    for (let i = 1; i < items.length; i++) expect(items[i]!.atSec).toBeGreaterThanOrEqual(items[i - 1]!.atSec);
    const kinds = new Map(items.map((i) => [i.id, i.kind]));
    expect(kinds.get('notice:10164')).toBe('zet');
    expect(kinds.get('news:v1')).toBe('press');
    expect(kinds.get('event:sud')).toBe('court');
    expect(kinds.get('event:prvo-jutro')).toBe('event');
    // A notice published before the window is still a voice (it is what ZET said the day before).
    expect(items[0]!.id).toBe('notice:10164');
  });
  it('a chapter that repeats a notice of the same minute speaks once, as the notice', () => {
    expect(items.some((i) => i.id === 'event:linija-228')).toBe(false);
    expect(items.find((i) => i.id === 'notice:10166')?.focus).toEqual({ kind: 'route', id: '228' });
    expect(items.length).toBe(fixtureFiles.notices.items.length + fixtureFiles.news.items.length + fixtureFiles.events.length - 1);
  });
  it('titles stay verbatim; a headline links its article and names its outlet', () => {
    const v1 = items.find((i) => i.id === 'news:v1')!;
    expect(v1.title).toBe('ZET uveo autobusnu liniju do Rebra');
    expect(v1.link).toBe('https://www.vecernji.hr/zagreb/primjer-2');
    expect(v1.source).toEqual({ label: 'Večernji list', url: 'https://www.vecernji.hr/' });
    expect(v1.beat).toBe('linija-228');
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

describe('voicesUpTo', () => {
  const many = Array.from({ length: 20 }, (_, i) => press(`p${i}`, i * 60, null, i % 4 === 0 ? { mentions: { routes: ['228'] } } : {}));
  it('newest first, cut at fourteen, the rest older; nothing after the clock', () => {
    const at = voicesUpTo(many, 19 * 60);
    expect(at.visible.length).toBe(14);
    expect(at.visible[0]!.id).toBe('p19');
    expect(at.visible[13]!.id).toBe('p6');
    expect(at.older.map((i) => i.id)).toEqual(['p5', 'p4', 'p3', 'p2', 'p1', 'p0']);
    expect(at.olderCount).toBe(6);
    expect(at.hiddenCount).toBe(0);
    expect(voicesUpTo(many, 5 * 60 - 1).visible.map((i) => i.id)).toEqual(['p4', 'p3', 'p2', 'p1', 'p0']);
    expect(voicesUpTo(many, -1).visible).toEqual([]);
  });
  it('a subject keeps only what speaks of it and counts what it left out', () => {
    const at = voicesUpTo(many, 19 * 60, { subject: { kind: 'route', id: '228' } });
    expect(at.visible.map((i) => i.id)).toEqual(['p16', 'p12', 'p8', 'p4', 'p0']);
    expect(at.hiddenCount).toBe(15);
    expect(at.olderCount).toBe(0);
  });
  it('on the fixture: the 228 subject keeps the notice and the headline about the line', () => {
    const at = voicesUpTo(foldPress(buildVoices(fixtureFiles)), SNIMKA_WINDOW.toSec, { subject: { kind: 'route', id: '228' } });
    expect(at.visible.map((i) => i.id)).toEqual(['news:v1', 'notice:10166']);
  });
});

describe('companionVoices', () => {
  const mon = buildVoiceDay('mon');
  const thu = buildVoiceDay('thu');
  it('speaks when the lead fact turns to a family not heard for two hours, at most once an hour', () => {
    const voices = companionVoices([thu, mon]);
    // Monday's first minute (07:30) is new; its bikes sentence at 07:32 is new too but within the hour; Thursday 07:30 is new again.
    expect(voices.map((v) => v.atSec)).toEqual([zg(9, 28, 7, 30), zg(10, 1, 7, 30)]);
    expect(voices[0]!.title).toBe('U pokretu su 2 vozila, po voznom redu oko 230.');
    expect(voices[1]!.kind).toBe('companion');
    for (let i = 1; i < voices.length; i++) expect(voices[i]!.atSec - voices[i - 1]!.atSec).toBeGreaterThanOrEqual(COMPANION_GAP_S);
  });
  it('the first live departure after hours of the timetable is a voice of its own', () => {
    const day = (t0: number, minutes: [number, number][]): VoiceFile => ({
      v: 2, place: '106_1', day: 'd', t0, step: 60, n: 600,
      facts: [{ id: 'service:zet', kind: 'service', wording: 'silent', text: 'U pokretu su 3 vozila.' }, { id: 'dep:6', kind: 'departure', wording: 'live', text: 'Tramvaj 6 polazi za 4 min.' }],
      rows: [], sentences: ['U pokretu su 3 vozila.', 'Tramvaj 6 polazi za 4 min.'],
      minutes: Array.from({ length: 600 }, (_, m) => {
        const which = minutes.find(([from]) => m >= from) ? minutes.filter(([from]) => m >= from).at(-1)![1] : 0;
        return { at: t0 + m * 60, f: [which], r: [], lead: which, state: 'silent' as const, voice: 'all' as const, seen: 3, expected: 200, note: null };
      }),
    });
    const evening = zg(9, 30, 12, 0);
    const voices = companionVoices([day(evening, [[0, 0], [370, 1]])]);
    expect(voices.map((v) => v.atSec)).toEqual([evening, evening + 370 * 60]);
    expect(voices[1]!.title).toBe('Tramvaj 6 polazi za 4 min.');
    // Back and forth within two hours is not news: the service sentence returning after a few minutes says nothing.
    const flicker = companionVoices([day(evening, [[0, 0], [370, 1], [375, 0], [380, 1]])]);
    expect(flicker.length).toBe(2);
  });
});

describe('feedMarkers and stateBand', () => {
  it('chapters, notices with the court and ZET\'s own markers, and the press thinned to the first headline per beat', () => {
    const events = fixtureFiles.events;
    const items = buildVoices(fixtureFiles);
    const markers = feedMarkers(items, events);
    const lane = (l: string) => markers.filter((m) => m.lane === l).map((m) => m.id);
    expect(lane('chapter')).toEqual(events.filter((e) => e.chapter && e.id !== 'linija-228' && e.kind !== 'court').map((e) => `event:${e.id}`));
    expect(lane('notice')).toEqual(expect.arrayContaining(['notice:10164', 'notice:10166', 'event:sud', 'event:feed-stoji-pon', 'event:vozni-red-396']));
    expect(lane('press')).toEqual(['news:j1', 'news:j2', 'news:v1', 'news:n1', 'news:n2']);
    const thinned = feedMarkers([press('a', 0, 'bajs'), press('b', 10, 'bajs'), press('c', 20, null), press('d', 30, null)]);
    expect(thinned.map((m) => m.id)).toEqual(['a', 'c', 'd']);
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
