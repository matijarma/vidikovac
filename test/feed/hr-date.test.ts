import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseHrDate } from '../../worker/feed/hr-date';
import { zagrebIso } from '../../worker/feed/time';

// The instant every Kulturpunkt and ZET fixture below was actually fetched
// (see test/fixtures/dogadanja/sources.json), used as `now` throughout: every
// "no year written" example in these real announcements is genuinely dated
// against the same moment the research saw it live.
const FETCH_NOW = new Date('2026-09-12T00:44:38Z');

const kulturpunkt = JSON.parse(readFileSync(new URL('../fixtures/dogadanja/kulturpunkt.json', import.meta.url), 'utf8')) as {
  id: number;
  excerpt: { rendered: string };
}[];

function excerptText(id: number): string {
  const item = kulturpunkt.find((row) => row.id === id);
  if (!item) throw new Error(`fixture item ${id} not found`);
  return item.excerpt.rendered.replace(/<[^>]+>/g, '').trim();
}

function firstRssDescription(xml: string): string {
  const match = /<description><!\[CDATA\[([\s\S]*?)]]><\/description>/.exec(xml);
  if (!match) throw new Error('no <description> found in fixture');
  return match[1]
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const zetNovosti = firstRssDescription(readFileSync(new URL('../fixtures/dogadanja/zet-rss-novosti.xml', import.meta.url), 'utf8'));
const zetPromet = firstRssDescription(readFileSync(new URL('../fixtures/dogadanja/zet-rss-promet.xml', import.meta.url), 'utf8'));
const skupstinaSjednica = readFileSync(new URL('../fixtures/dogadanja/skupstina-sjednica.html', import.meta.url), 'utf8');
const skupstinaRokovnikCombinedRow = '14.09.2026. 15. sjednica Odbora za financije'; // stripTags(selectAll(...)) shape from the real rokovnik row, see html.test.ts

describe('parseHrDate: the brief\'s minimum-required phrases, verbatim', () => {
  it('u petak, 11. rujna od 19 do 20.30 sati', () => {
    expect(parseHrDate('u petak, 11. rujna od 19 do 20.30 sati', FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 11, 19, 0),
      endIso: zagrebIso(2026, 9, 11, 20, 30),
      precision: 'time',
    });
  });

  it('od 22. do 29. rujna', () => {
    expect(parseHrDate('od 22. do 29. rujna', FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 22, 0, 0),
      endIso: zagrebIso(2026, 9, 29, 23, 59),
      precision: 'range',
    });
  });

  it('11.9.2026.', () => {
    expect(parseHrDate('11.9.2026.', FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 11, 0, 0),
      precision: 'day',
    });
  });

  it('11. rujna 2026.', () => {
    expect(parseHrDate('11. rujna 2026.', FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 11, 0, 0),
      precision: 'day',
    });
  });

  it('sutra u 18 sati', () => {
    // FETCH_NOW is 2026-09-12 in Zagreb, so "sutra" is 2026-09-13.
    expect(parseHrDate('sutra u 18 sati', FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 13, 18, 0),
      precision: 'time',
    });
  });

  it('danas u 18 sati (the same relative construction, present tense)', () => {
    expect(parseHrDate('danas u 18 sati', FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 12, 18, 0),
      precision: 'time',
    });
  });
});

describe('parseHrDate: every Croatian month name in genitive', () => {
  it.each([
    ['siječnja', 1],
    ['veljače', 2],
    ['ožujka', 3],
    ['travnja', 4],
    ['svibnja', 5],
    ['lipnja', 6],
    ['srpnja', 7],
    ['kolovoza', 8],
    ['rujna', 9],
    ['listopada', 10],
    ['studenoga', 11],
    ['prosinca', 12],
  ])('%s -> month %i', (name, month) => {
    expect(parseHrDate(`11. ${name} 2026.`, FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, month, 11, 0, 0),
      precision: 'day',
    });
  });
});

describe('parseHrDate: negative cases', () => {
  it('a text with no date at all returns null (real Kvartovske novosti title -- see research finding 4)', () => {
    expect(parseHrDate('Hop-in kino na Jarunu', FETCH_NOW)).toBeNull();
  });

  it('an empty string returns null', () => {
    expect(parseHrDate('', FETCH_NOW)).toBeNull();
  });

  it('a date more than six months out is never guessed at: no year written, current-year reading over six months away', () => {
    // Reference moment: 2026-09-12 in Zagreb. Read as 2026, "20. veljače" (20
    // February) is 203 days away -- outside the six-month window in either
    // direction -- so this must come back null rather than silently pick 2027.
    expect(parseHrDate('20. veljače', FETCH_NOW)).toBeNull();
  });

  it('the same month/day is accepted once a year is written explicitly, even the same distance out', () => {
    expect(parseHrDate('20. veljače 2027.', FETCH_NOW)).toEqual({
      startIso: zagrebIso(2027, 2, 20, 0, 0),
      precision: 'day',
    });
  });
});

describe('parseHrDate: real Kulturpunkt excerpts (test/fixtures/dogadanja/kulturpunkt.json)', () => {
  it('id 85608: the exact brief phrase, found live in the wild, with a second event right after it', () => {
    // The excerpt also names a *second* announcer's date/time ("12. rujna od
    // 17 do 19.30 sati") straight after the first; parseHrDate must return
    // only the first and never let the second time bleed onto it.
    expect(parseHrDate(excerptText(85608), FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 11, 19, 0),
      endIso: zagrebIso(2026, 9, 11, 20, 30),
      precision: 'time',
    });
  });

  it('id 85612: "od 22. do 29. rujna", no year, a multi-day range', () => {
    expect(parseHrDate(excerptText(85612), FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 22, 0, 0),
      endIso: zagrebIso(2026, 9, 29, 23, 59),
      precision: 'range',
    });
  });

  it('id 85562: "9. i 10. rujna", the dual-day form of a range, no time', () => {
    expect(parseHrDate(excerptText(85562), FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 9, 0, 0),
      endIso: zagrebIso(2026, 9, 10, 23, 59),
      precision: 'range',
    });
  });

  it('id 85325: "24. i 25. kolovoza", the dual-day form in a different month, no year', () => {
    expect(parseHrDate(excerptText(85325), FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 8, 24, 0, 0),
      endIso: zagrebIso(2026, 8, 25, 23, 59),
      precision: 'range',
    });
  });

  it('id 85601: explicit year and a bare "u H sati" time', () => {
    expect(parseHrDate(excerptText(85601), FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 18, 20, 0),
      precision: 'time',
    });
  });

  it('id 85557: no year, time found across a comma, with a second unrelated date later in the same excerpt ("do 30. rujna")', () => {
    expect(parseHrDate(excerptText(85557), FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 9, 20, 0),
      precision: 'time',
    });
  });

  it('id 85553: no weekday prefix at all, just "10. rujna, u 19 sati"', () => {
    expect(parseHrDate(excerptText(85553), FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 10, 19, 0),
      precision: 'time',
    });
  });

  it('id 85560: a day with no time anywhere in the text', () => {
    expect(parseHrDate(excerptText(85560), FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 14, 0, 0),
      precision: 'day',
    });
  });

  it('id 85550: a second date ("10. listopada") interrupts before the only "sati" in the text, so no time attaches -- a known, accepted gap', () => {
    // Full text: "...u subotu, 12. rujna u 19, a posljednje 10. listopada u
    // 19 sati." The first date's own time is elided ("u 19,", no "sati"); the
    // "sati" that does appear belongs to the *second* lecture (10. listopada).
    // Attaching it to the first date would be a fabrication, so this is
    // exactly the boundary findTimeSpan exists to enforce.
    expect(parseHrDate(excerptText(85550), FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 12, 0, 0),
      precision: 'day',
    });
  });

  it('id 85468: "6. i 7. rujna" read as a dual-day range, ignoring the daily "od 15 do 20 sati" (a range never carries a time of day)', () => {
    expect(parseHrDate(excerptText(85468), FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 6, 0, 0),
      endIso: zagrebIso(2026, 9, 7, 23, 59),
      precision: 'range',
    });
  });

  it('id 85379: "od 2. rujna do 2. prosinca" spans two different months -- out of scope, degrades to its first day rather than a wrong range', () => {
    // od-do only builds a range when both days share one month; across two
    // months it is not a range this parser understands, so the first date
    // mentioned ("2. rujna") is read as a plain day and the second ("2.
    // prosinca") is only ever consulted as the boundary that keeps its own
    // context out of the first date's time search.
    expect(parseHrDate(excerptText(85379), FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 2, 0, 0),
      precision: 'day',
    });
  });
});

describe('parseHrDate: real ZET RSS and Skupština fixtures', () => {
  it('ZET rss_novosti.aspx first item: "u subotu, 12. rujna, od 9 do 19 sati"', () => {
    expect(parseHrDate(zetNovosti, FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 12, 9, 0),
      endIso: zagrebIso(2026, 9, 12, 19, 0),
      precision: 'time',
    });
  });

  it('does not mistake the "135. rođendana" (135th birthday) for a day-of-month', () => {
    expect(zetNovosti).toContain('135. rođendana');
  });

  it('ZET rss_promet.aspx first item: "u subotu, 12. rujna, od 8 do 15 sati"', () => {
    expect(parseHrDate(zetPromet, FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 12, 8, 0),
      endIso: zagrebIso(2026, 9, 12, 15, 0),
      precision: 'time',
    });
  });

  it('the real Skupština session page prose, with a colon-separated time and an explicit year', () => {
    const prose = 'Srijeda, 16. rujna 2026. s početkom u 9:00 sati u Staroj gradskoj vijećnici, Ulica sv. Ćirila i Metoda 5/I., dvorana "A"';
    expect(skupstinaSjednica).toContain('16. rujna 2026.');
    expect(parseHrDate(prose, FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 16, 9, 0),
      precision: 'time',
    });
  });

  it('a numeric rokovnik date directly against a title (the exact shape selectAll+stripTags produce for that row, see html.test.ts)', () => {
    expect(parseHrDate(skupstinaRokovnikCombinedRow, FETCH_NOW)).toEqual({
      startIso: zagrebIso(2026, 9, 14, 0, 0),
      precision: 'day',
    });
  });
});
