import type { FetchContext } from '../../schema';
import { compactData, type ItemInput } from '../../payload';
import { decodeEntities, stripTags } from '../../html';
import { splitHouseNumbers, streetPoint } from '../../geo/streets';
import { addZagrebDays, zagrebDate, zagrebDayKey, zagrebIso, type ZagrebDate } from '../../time';
import { cutId, type CutsResult } from './common';

// HEP ODS, Elektra Zagreb: the planned outages of the distribution area, one HTML page per day
// (https://www.hep.hr/ods/bez-struje/19?dp=zagreb&datum=DD.MM.YYYY). Each outage is a block with a
// place (Mjesto: ZAGREB, SESVETE, DOBRODOL...), the streets with the house numbers they concern
// (Ulica: "GREDICE 98-do kraja par, 135-do kraja nep, JARUNSKA 6"), and the expected hours
// (Očekivano trajanje: 08:00 - 16:00). Street names are upper case and without "ulica".
// HEP states no terms of reuse (the page's footer is a copyright line only); robots.txt allows the path.
// The module is the unofficial view of the page ("neslužbeni prikaz"): one item per street that the
// street index can place, with the hours, and the page linked.

export const HEP_URL = 'https://www.hep.hr/ods/bez-struje/19?dp=zagreb';

export function hepUrl(day: ZagrebDate): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${HEP_URL}&datum=${pad(day.day)}.${pad(day.month)}.${day.year}`;
}

const HEADING = /<h3>\s*Terenska jedinica Elektra Zagreb\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\.?\s*<\/h3>/;
const BLOCK_START = '<div class="mjesto tipR">';
const PLACE = /<div class="grad"><strong>Mjesto:<\/strong>([\s\S]*?)<\/div>/;
const STREETS = /<div class="ulica"><strong>Ulica:<\/strong>([\s\S]*?)<\/div>/;
const HOURS = /<div class="kada">\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*<\/div>/;

const plain = (html: string): string => decodeEntities(stripTags(html));

/**
 * The streets of a block's "Ulica:" line: split at the commas that are followed by an upper-case word, so
 * "GREDICE 98-do kraja par, 135-do kraja nep, JARUNSKA 6" is two streets and the second number range stays with
 * the first street.
 */
export function splitStreets(line: string): string[] {
  return line.split(/,\s*(?=[A-ZČĆŠŽĐ])/).map((entry) => entry.trim()).filter(Boolean);
}

/** One day's page to its cuts. Throws when the page is not the day's outage list. */
export function parseHep(html: string, day: ZagrebDate): CutsResult {
  const heading = HEADING.exec(html);
  if (!heading) throw new Error('hep-ods: no outage list on the page');
  const [shownDay, shownMonth, shownYear] = [Number(heading[1]), Number(heading[2]), Number(heading[3])];
  if (shownDay !== day.day || shownMonth !== day.month || shownYear !== day.year) {
    throw new Error(`hep-ods: the page lists ${shownDay}.${shownMonth}.${shownYear}., not the day asked for`);
  }
  const dayKey = zagrebDayKey(day);
  const blocks = html.split(BLOCK_START).slice(1);
  const items: ItemInput[] = [];
  const taken = new Set<string>();
  let total = 0;
  let understood = 0;
  for (const block of blocks) {
    const place = PLACE.exec(block);
    const streets = STREETS.exec(block);
    const hours = HOURS.exec(block);
    if (!place || !streets) continue;
    understood += 1;
    const settlement = plain(place[1]!);
    const entries = splitStreets(plain(streets[1]!)).map(splitHouseNumbers).filter((entry) => entry.name !== '');
    total += entries.length;
    // An outage without a clock range cannot be a cut with hours: counted, not shown.
    if (!hours) continue;
    const [startHour, startMinute, endHour, endMinute] = [hours[1], hours[2], hours[3], hours[4]].map(Number) as [number, number, number, number];
    const at = zagrebIso(day.year, day.month, day.day, startHour, startMinute);
    let until = zagrebIso(day.year, day.month, day.day, endHour, endMinute);
    // A range that ends before it starts runs past midnight.
    if (Date.parse(until) <= Date.parse(at)) until = zagrebIso(day.year, day.month, day.day + 1, endHour, endMinute);
    for (const entry of entries) {
      const point = streetPoint(entry.name, settlement);
      if (!point) continue;
      items.push({
        id: cutId('hep', dayKey, entry.name, taken),
        kind: 'cut',
        title: point.name,
        at,
        dateBasis: 'event',
        until,
        geo: { type: 'Point', coordinates: [point.lon, point.lat] },
        link: hepUrl(day),
        data: compactData({
          utility: 'struja',
          source: 'hep-ods',
          street: entry.name,
          houseNumbers: entry.numbers || undefined,
          district: point.district ?? undefined,
          precision: 'time',
        }),
      });
    }
  }
  if (blocks.length > 0 && understood === 0) throw new Error('hep-ods: outage blocks without a place and a street');
  return { items, total };
}

/** Today's and tomorrow's pages (Zagreb days). Both must answer: half a picture is not shown as the whole. */
export async function fetchHepOds(ctx: FetchContext): Promise<CutsResult> {
  const today = zagrebDate(ctx.now());
  const days = [today, addZagrebDays(today, 1)];
  const pages = await Promise.all(days.map(async (day) => parseHep(await (await ctx.fetch(hepUrl(day))).text(), day)));
  return { items: pages.flatMap((page) => page.items), total: pages.reduce((sum, page) => sum + page.total, 0) };
}
