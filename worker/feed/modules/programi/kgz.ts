import { compactData, type ItemInput } from '../../payload';
import { decodeEntities, stripTags } from '../../html';
import { parseHrDate } from '../../hr-date';
import { zagrebIso } from '../../time';

// Knjižnice grada Zagreba (KGZ), the programme listing of the libraries
// (https://www.kgz.hr/hr/dogadjanja/10?page=N, twenty listings a page, the pager runs to page 15). Each listing is
//   <div class='dogadanje_holder'> ... <div class='date_dog'>29.09.2026.</div>
//     <div class='kat_dog'>Predstavljanje knjige</div>
//     <span class='dogExtraInfo imeknjiznice_kat'><a class='btnplavi' href='...'>Knjižnica Ivana Gorana Kovačića</a></span>
//     <div class='kat_dog'>Početak događanja: utorak, 29. 9. 2026. u 18 sati</div>
//     <a class='naslov_god' href='https://www.kgz.hr/hr/dogadjanja/egli-ilic-macji-kodeks-uspjeha/74738'>Egli Ilić: ...</a> ...
// The start time is free text ("u 18 sati", "10:30 sati", "11.30", "18:00"). A listing of one day whose text gives
// exactly one time is an event at that time. A listing of one day without a readable time, and a listing over a range
// of days ("29.09.2026. - 30.10.2026.") of at most 31 days that does not repeat (an exhibition, a week of workshops),
// is a day item (`precision: 'day'`, from the first day's 00:00 to 23:59 of the last day, Zagreb): it is on all day,
// and the layers show it under "U tijeku" (R3 D-J). A listing that repeats ("utorkom", "svakog drugog četvrtka") and a
// range of more than 31 days (a library season, "Pričaonica" 29.09.2026 to 29.06.2027) are counted and left out: a
// weekly session over nine months shown as "u tijeku" every day would be false. The description is never read. KGZ
// states no terms of reuse (yellow): the module is the unofficial view of the page ("neslužbeni prikaz").

export const KGZ_URL = 'https://www.kgz.hr/hr/dogadjanja/10';
export const kgzPageUrl = (page: number): string => `${KGZ_URL}?page=${page}`;

const HOLDER = "<div class='dogadanje_holder'>";
const RESULTS = /dogadanje_holder2['"]>\s*Rezultata:\s*(\d+)/;
const DATE = /<div class=['"]date_dog['"]>([\s\S]*?)<\/div>/;
const KAT = /<div class=['"]kat_dog['"]>([\s\S]*?)<\/div>/g;
const BRANCH = /<a class=['"]btnplavi['"] href=['"][^'"]*['"]>([\s\S]*?)<\/a>/;
const TITLE = /<a class=['"]naslov_god['"] href=['"]([^'"]*)['"]>([\s\S]*?)<\/a>/;
const ONE_DAY = /^(\d{2})\.(\d{2})\.(\d{4})\.?$/;
const RANGE = /^(\d{2})\.(\d{2})\.(\d{4})\.?\s*-\s*(\d{2})\.(\d{2})\.(\d{4})\.?$/;
/** The longest range of days kept as a day item (D-J). */
export const KGZ_RANGE_MAX_DAYS = 31;
const RECURRING = /ponedjeljkom|utorkom|srijedom|četvrtkom|petkom|subotom|nedjeljom|svak/i;
const FULL_DATE = /\d{1,2}\.\s*\d{1,2}\.\s*\d{4}\.?/g;
const CLOCK = /(?<![\d.:])(\d{1,2})(?:[:.](\d{2}))?(?![\d:])/g;
/** A floor ("2. kat", "na 1. katu", "3. etaža"): a bare "N." before the word is the storey, not a time. */
const FLOOR = /(?<![\d.:])\d{1,2}\.\s*(?:kat|etaž)\p{L}*/giu;

export interface KgzPage {
  items: ItemInput[];
  /** Listings on the page, kept or not. */
  listings: number;
  /** "Rezultata: N" of the page: every listing the site holds, all days and all pages. */
  results?: number;
  /** Left out: repeating listings, ranges over KGZ_RANGE_MAX_DAYS days, and listings whose date cannot be read. */
  dropped: { recurring: number; season: number; noTime: number };
}

/** A calendar day, or null when the numbers are not one (31.09). */
function calendarDay(year: number, month: number, day: number): { year: number; month: number; day: number } | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? { year, month, day } : null;
}

const dayKey = (d: { year: number; month: number; day: number }) => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;

/** The one start time of "Početak događanja: ..." as [hour, minute], or null when the text names none or several. */
export function startTime(text: string): [number, number] | null {
  const tokens = [...text.replace(FULL_DATE, ' ').replace(FLOOR, ' ').matchAll(CLOCK)];
  if (tokens.length !== 1) return null;
  const hour = Number(tokens[0]![1]);
  const minute = tokens[0]![2] === undefined ? 0 : Number(tokens[0]![2]);
  return hour <= 23 && minute <= 59 ? [hour, minute] : null;
}

const plain = (html: string): string => decodeEntities(stripTags(html));

/** One programme page to its events. Throws when the page is not a programme page. */
export function parseKgzPage(html: string, now: Date): KgzPage {
  const results = RESULTS.exec(html);
  const holders = html.split(HOLDER).slice(1);
  if (!results && holders.length === 0) throw new Error('kgz: not a programme page');
  const page: KgzPage = {
    items: [],
    listings: holders.length,
    ...(results ? { results: Number(results[1]) } : {}),
    dropped: { recurring: 0, season: 0, noTime: 0 },
  };
  for (const holder of holders) {
    const date = DATE.exec(holder);
    const title = TITLE.exec(holder);
    if (!date || !title) throw new Error('kgz: a listing without a date or a title');
    const start = [...holder.matchAll(KAT)].map((match) => plain(match[1]!)).find((text) => /^Početak događanja:/i.test(text));
    const when = start?.replace(/^Početak događanja:\s*/i, '') ?? '';
    if (RECURRING.test(when)) {
      page.dropped.recurring += 1;
      continue;
    }
    const dateText = plain(date[1]!);
    const id = /\/(\d+)\/?$/.exec(title[1]!)?.[1];
    const branch = BRANCH.exec(holder);
    const link = /^https:\/\/www\.kgz\.hr\/[\w./%-]+$/.test(title[1]!) ? title[1]! : undefined;
    /**
     * An all-day item from the first day 00:00 to the last minute of the last day (Zagreb), 23:59: the end the City's own
     * day items carry, because the layers read an item's last day from its `until` (an end at the next midnight would
     * list it one day too long).
     */
    const dayItem = (first: { year: number; month: number; day: number }, last: { year: number; month: number; day: number }): ItemInput => {
      return {
        id: `programi:kgz:${id}:${dayKey(first)}`,
        kind: 'event',
        title: plain(title[2]!),
        at: zagrebIso(first.year, first.month, first.day),
        until: zagrebIso(last.year, last.month, last.day, 23, 59),
        dateBasis: 'event',
        ...(link ? { link } : {}),
        data: compactData({ source: 'kgz', venue: branch ? plain(branch[1]!) || undefined : undefined, category: 'program', precision: 'day' }),
      };
    };
    const range = RANGE.exec(dateText);
    if (range) {
      const first = calendarDay(Number(range[3]), Number(range[2]), Number(range[1]));
      const last = calendarDay(Number(range[6]), Number(range[5]), Number(range[4]));
      if (!first || !last || !id || dayKey(last) < dayKey(first)) {
        page.dropped.noTime += 1;
        continue;
      }
      const span = (Date.UTC(last.year, last.month - 1, last.day) - Date.UTC(first.year, first.month - 1, first.day)) / 86_400_000;
      if (span > KGZ_RANGE_MAX_DAYS) {
        page.dropped.season += 1;
        continue;
      }
      page.items.push(dayItem(first, last));
      continue;
    }
    const day = ONE_DAY.exec(dateText);
    const oneDay = day ? calendarDay(Number(day[3]), Number(day[2]), Number(day[1])) : null;
    if (!day || !oneDay || !id) {
      page.dropped.noTime += 1;
      continue;
    }
    const time = startTime(when);
    const parsed = time ? parseHrDate(`${day[0]} u ${time[0]}:${String(time[1]).padStart(2, '0')} sati`, now) : null;
    if (!time || !parsed || parsed.precision !== 'time') {
      page.items.push(dayItem(oneDay, oneDay));
      continue;
    }
    page.items.push({
      id: `programi:kgz:${id}:${day[3]}-${day[2]}-${day[1]}`,
      kind: 'event',
      title: plain(title[2]!),
      at: parsed.startIso,
      dateBasis: 'event',
      ...(link ? { link } : {}),
      data: compactData({
        source: 'kgz',
        venue: branch ? plain(branch[1]!) || undefined : undefined,
        category: 'program',
        precision: 'time',
      }),
    });
  }
  return page;
}
