// The latest headline within three hours, the latest notice (kept until the
// next), the latest event within an hour (app/src/snimka/voices.ts).
import { describe, expect, it } from 'vitest';
import type { NewsFile, NoticesFile, SnimkaEvent } from '../../shared/snimka';
import { ARTICLE_WINDOW_S, currentArticle, currentMarker, currentNotice, MARKER_WINDOW_S } from '../../app/src/snimka/voices';

const H = 3600;
const news: NewsFile = {
  v: 1,
  outlets: { jutarnji: { name: 'Jutarnji list', home: 'https://www.jutarnji.hr/' }, vecernji: { name: 'Večernji list', home: 'https://www.vecernji.hr/' }, n1: { name: 'N1', home: 'https://n1info.hr/' } },
  items: [
    { id: 'b', outlet: 'vecernji', title: 'Drugi', link: 'https://www.vecernji.hr/2', pubSec: 20 * H, beat: null },
    { id: 'a', outlet: 'jutarnji', title: 'Prvi', link: 'https://www.jutarnji.hr/1', pubSec: 10 * H, beat: 'početak' },
    { id: 'c', outlet: 'n1', title: 'Treći', link: 'https://n1info.hr/3', pubSec: 30 * H, beat: 'sud' },
  ],
};
const notices: NoticesFile = { v: 1, items: [
  { id: 2, title: 'Druga', text: null, link: 'https://www.zet.hr/2', pubSec: 50 * H },
  { id: 1, title: 'Prva', text: 'tekst', link: 'https://www.zet.hr/1', pubSec: 5 * H },
] };
const ev = (id: string, atSec: number, chapter = true): SnimkaEvent => ({ id, atSec, kind: 'recording', title: id, text: null, sources: [], derived: false, chapter });
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
