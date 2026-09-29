import { compactData, type ItemInput } from '../../payload';
import { decodeEntities, stripTags } from '../../html';
import { parseHrDate } from '../../hr-date';

// Knjižnice grada Zagreba (KGZ), the programme listing of the libraries
// (https://www.kgz.hr/hr/dogadjanja/10?page=N, twenty listings a page, the pager runs to page 15). Each listing is
//   <div class='dogadanje_holder'> ... <div class='date_dog'>29.09.2026.</div>
//     <div class='kat_dog'>Predstavljanje knjige</div>
//     <span class='dogExtraInfo imeknjiznice_kat'><a class='btnplavi' href='...'>Knjižnica Ivana Gorana Kovačića</a></span>
//     <div class='kat_dog'>Početak događanja: utorak, 29. 9. 2026. u 18 sati</div>
//     <a class='naslov_god' href='https://www.kgz.hr/hr/dogadjanja/egli-ilic-macji-kodeks-uspjeha/74738'>Egli Ilić: ...</a> ...
// The start time is free text ("u 18 sati", "10:30 sati", "11.30", "18:00"). A listing is kept when it is one day and
// the text gives exactly one time; a listing that runs over several days (an exhibition, a season of workshops), one
// that repeats ("utorkom", "svakog drugog četvrtka") and one without a time are counted and left out, because none of
// them is a place and an hour to go to. The description is never read. KGZ states no terms of reuse (yellow): the
// module is the unofficial view of the page ("neslužbeni prikaz").

export const KGZ_URL = 'https://www.kgz.hr/hr/dogadjanja/10';
export const kgzPageUrl = (page: number): string => `${KGZ_URL}?page=${page}`;

const HOLDER = "<div class='dogadanje_holder'>";
const RESULTS = /dogadanje_holder2['"]>\s*Rezultata:\s*(\d+)/;
const DATE = /<div class=['"]date_dog['"]>([\s\S]*?)<\/div>/;
const KAT = /<div class=['"]kat_dog['"]>([\s\S]*?)<\/div>/g;
const BRANCH = /<a class=['"]btnplavi['"] href=['"][^'"]*['"]>([\s\S]*?)<\/a>/;
const TITLE = /<a class=['"]naslov_god['"] href=['"]([^'"]*)['"]>([\s\S]*?)<\/a>/;
const ONE_DAY = /^(\d{2})\.(\d{2})\.(\d{4})\.?$/;
const RECURRING = /ponedjeljkom|utorkom|srijedom|četvrtkom|petkom|subotom|nedjeljom|svak/i;
const FULL_DATE = /\d{1,2}\.\s*\d{1,2}\.\s*\d{4}\.?/g;
const CLOCK = /(?<![\d.:])(\d{1,2})(?:[:.](\d{2}))?(?![\d:])/g;

export interface KgzPage {
  items: ItemInput[];
  /** Listings on the page, kept or not. */
  listings: number;
  /** "Rezultata: N" of the page: every listing the site holds, all days and all pages. */
  results?: number;
  dropped: { multiDay: number; recurring: number; noTime: number };
}

/** The one start time of "Početak događanja: ..." as [hour, minute], or null when the text names none or several. */
export function startTime(text: string): [number, number] | null {
  const tokens = [...text.replace(FULL_DATE, ' ').matchAll(CLOCK)];
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
    dropped: { multiDay: 0, recurring: 0, noTime: 0 },
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
    const day = ONE_DAY.exec(plain(date[1]!));
    if (!day) {
      page.dropped.multiDay += 1;
      continue;
    }
    const time = startTime(when);
    const id = /\/(\d+)\/?$/.exec(title[1]!)?.[1];
    const parsed = time ? parseHrDate(`${day[0]} u ${time[0]}:${String(time[1]).padStart(2, '0')} sati`, now) : null;
    if (!time || !id || !parsed || parsed.precision !== 'time') {
      page.dropped.noTime += 1;
      continue;
    }
    const link = /^https:\/\/www\.kgz\.hr\/[\w./%-]+$/.test(title[1]!) ? title[1]! : undefined;
    const branch = BRANCH.exec(holder);
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
