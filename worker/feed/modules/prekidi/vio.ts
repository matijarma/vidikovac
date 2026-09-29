import type { FetchContext } from '../../schema';
import { compactData, type ItemInput } from '../../payload';
import { decodeEntities, stripTags } from '../../html';
import { splitHouseNumbers, streetPoint } from '../../geo/streets';
import { addZagrebDays, zagrebDate, zagrebDayKey, zagrebIso } from '../../time';
import { cutId, type CutsResult } from './common';

// Vodoopskrba i odvodnja Zagreb (VIO), "Obavijesti" (https://www.vio.hr/zona-za-medije/obavijesti/1832): a
// short list of notices, one line each, of the form
//   Dana 29. rujna 2026. godine, zbog planiranih radova HEP-a, bez vode će biti potrošači u ulicama
//   Aleja Seljačke bune, Jagodišće i Meglenjak u Podsusedu
// (also "u ulici X", "na Y cesti u Z", "u naselju W na području V"). A notice names a day and streets, never
// an hour: the cut is the whole day (00:00 to 24:00, day precision), and the wall says "bez vode" without hours.
// VIO states no terms of reuse and robots.txt is absent; the module is the unofficial view of the page.
// Beside the list stands an old permanent notice ("Privremeni prekid u opskrbi vodom zbog radova", 2024), which is
// not a day's notice and is not read.

export const VIO_URL = 'https://www.vio.hr/zona-za-medije/obavijesti/1832';
const VIO_ORIGIN = 'https://www.vio.hr';

const MONTHS: Record<string, number> = {
  siječnja: 1, veljače: 2, ožujka: 3, travnja: 4, svibnja: 5, lipnja: 6,
  srpnja: 7, kolovoza: 8, rujna: 9, listopada: 10, studenog: 11, studenoga: 11, prosinca: 12,
};

const NOTICE_LINK = /<a\s+class=['"]naslov-aktualno['"]\s+href=['"]([^'"]*)['"][^>]*>([\s\S]*?)<\/a>/g;
const DAY = /^Dana\s+(\d{1,2})\.\s*(\p{L}+)\s+(\d{4})\.\s*godine\s*,\s*(.*)$/isu;
const WITHOUT_WATER = /bez\s+vode\s+će\s+biti\s+potrošači\s+(?:u\s+ulicama|u\s+ulici|u\s+naselju|na)\s+(.+?)\s*$/isu;
const OTHER_AREA = /\s+na\s+području\s+(.+)$/iu;
const SETTLEMENT = /\s+u\s+(\p{Lu}[\p{L}-]*(?:\s+\p{Lu}[\p{L}-]*){0,2})$/u;

/** The streets of a notice's tail: "A, B i C u D" is A, B and C in D. */
export function noticeStreets(tail: string): { streets: string[]; settlement: string | undefined; area: string | undefined } {
  let rest = tail.trim();
  const area = OTHER_AREA.exec(rest)?.[1]?.trim();
  if (area) rest = rest.replace(OTHER_AREA, '');
  const settlement = SETTLEMENT.exec(rest)?.[1];
  if (settlement) rest = rest.replace(SETTLEMENT, '');
  const streets = rest.split(/\s*,\s*|\s+i\s+/).map((name) => name.trim()).filter(Boolean);
  return { streets, settlement, area };
}

/**
 * The notices of the page for today and tomorrow (Zagreb days) to their cuts. A notice for another day, one that does
 * not say which streets lose water, and one for a place outside the City (na području Jastrebarskog) are not cuts here.
 * Throws when the page has no notice list at all.
 */
export function parseVio(html: string, now: Date): CutsResult {
  const notices = [...html.matchAll(NOTICE_LINK)];
  if (notices.length === 0) throw new Error('vio: no notice list on the page');
  const today = zagrebDate(now);
  const days = new Map([today, addZagrebDays(today, 1)].map((day) => [zagrebDayKey(day), day]));
  const items: ItemInput[] = [];
  const taken = new Set<string>();
  let total = 0;
  for (const notice of notices) {
    const title = decodeEntities(stripTags(notice[2]!));
    const dated = DAY.exec(title);
    const month = dated ? MONTHS[dated[2]!.toLocaleLowerCase('hr')] : undefined;
    if (!dated || !month) continue;
    const day = { year: Number(dated[3]), month, day: Number(dated[1]) };
    const dayKey = zagrebDayKey(day);
    const kept = days.get(dayKey);
    const tail = WITHOUT_WATER.exec(dated[4]!)?.[1];
    if (!kept || !tail) continue;
    const { streets, settlement, area } = noticeStreets(tail);
    if (area && !/zagreb/i.test(area)) continue;
    const href = notice[1]!;
    const link = /^\/(?:zona-za-medije\/)?obavijesti\/[\w./-]+$/.test(href) ? `${VIO_ORIGIN}${href}` : undefined;
    const at = zagrebIso(kept.year, kept.month, kept.day);
    const until = zagrebIso(kept.year, kept.month, kept.day + 1);
    for (const written of streets) {
      total += 1;
      const point = streetPoint(splitHouseNumbers(written).name, settlement);
      if (!point) continue;
      items.push({
        id: cutId('vio', dayKey, written, taken),
        kind: 'cut',
        title: point.name,
        at,
        dateBasis: 'event',
        until,
        geo: { type: 'Point', coordinates: [point.lon, point.lat] },
        ...(link ? { link } : {}),
        data: compactData({
          utility: 'voda',
          source: 'vio',
          street: written,
          district: point.district ?? undefined,
          precision: 'day',
        }),
      });
    }
  }
  // The page lists the newest notice first; the cuts go by day, the page's order within a day.
  items.sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!));
  return { items, total };
}

export async function fetchVio(ctx: FetchContext): Promise<CutsResult> {
  const response = await ctx.fetch(VIO_URL);
  return parseVio(await response.text(), ctx.now());
}
