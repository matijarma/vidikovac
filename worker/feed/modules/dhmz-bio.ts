import type { FetchContext } from '../schema';
import type { FeedPayload, ItemInput } from '../payload';
import { parseXml, xmlArray, xmlText } from '../xml';
import { addZagrebDays, isCalendarDate, zagrebDate, zagrebDayKey, zagrebIso } from '../time';

// DHMZ's biometeorological forecast, https://prognoza.hr/bio_novo.xml (Otvorena dozvola, "Izvor: DHMZ"): three days
// or fewer, each one text for the whole country (`<Tekst>`) and a number per region (`<station name="sredisnja">3`).
// DHMZ publishes no legend for the numbers (its page draws level 3 as a smiling face), so `level` is kept as the
// number and never turned into a word. The item's `text` is the first sentence of the day's national text, DHMZ's
// own words, kept only at 120 characters or fewer; the whole text is the summary (docs/reveal-2026-10-plan/R3.md §0.1).

export const BIO_URL = 'https://prognoza.hr/bio_novo.xml';
/** Central Croatia, where Zagreb is. */
export const BIO_REGION = 'sredisnja';
/** The longest first sentence kept as `data.text`. */
export const BIO_TEXT_MAX = 120;
/** DHMZ's Zagreb point (Zagreb-Grič, as dhmz-hourly). */
const ZAGREB: [number, number] = [15.97, 45.81];

interface Station { '@_name'?: unknown; '#text'?: unknown }
interface Podaci { Datum?: unknown; Tekst?: unknown; station?: Station[] }
interface BioDocument { Bioprognoza?: { Prognozirano?: unknown; Podaci?: Podaci[] } }

const FIRST_SENTENCE = /^(.+?[.!?])(?=\s+\p{Lu}|\s*$)/u;

/** The first sentence of a text (whitespace collapsed), or undefined. */
export function firstSentence(text: string): string | undefined {
  return FIRST_SENTENCE.exec(text)?.[1];
}

function day(value: string): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/.exec(value);
  const parsed = match ? { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) } : undefined;
  return parsed && isCalendarDate(parsed) ? parsed : undefined;
}

/** "29.09.2026 u 09:34", Zagreb time, to ISO. */
function forecastAt(value: string): string | undefined {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?\s+u\s+(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [d, m, y, h, min] = match.slice(1).map(Number) as [number, number, number, number, number];
  if (!isCalendarDate({ year: y, month: m, day: d }) || h > 23 || min > 59) return undefined;
  return zagrebIso(y, m, d, h, min);
}

export function parseBio(xml: string, now: Date): FeedPayload {
  const doc = parseXml<BioDocument>(xml, { arrayPaths: ['Bioprognoza.Podaci', 'Bioprognoza.Podaci.station'] });
  const days = xmlArray(doc.Bioprognoza?.Podaci);
  if (!doc.Bioprognoza || days.length === 0) throw new Error('dhmz-bio: no Podaci in the document');
  const today = zagrebDayKey(zagrebDate(now));
  const items: ItemInput[] = [];
  for (const podaci of days) {
    const date = day(xmlText(podaci.Datum));
    if (!date) continue;
    const key = zagrebDayKey(date);
    if (key < today) continue;
    const station = xmlArray(podaci.station).find((entry) => xmlText(entry['@_name']) === BIO_REGION);
    const levelText = xmlText(station);
    const level = Number(levelText);
    if (!station || levelText === '' || !Number.isFinite(level)) continue;
    const summary = xmlText(podaci.Tekst).replace(/\s+/g, ' ').trim();
    const sentence = firstSentence(summary);
    const next = addZagrebDays(date, 1);
    items.push({
      id: `dhmz-bio:${key}`,
      kind: 'forecast',
      title: 'Biometeorološka prognoza',
      ...(summary ? { summary } : {}),
      at: zagrebIso(date.year, date.month, date.day),
      until: zagrebIso(next.year, next.month, next.day),
      dateBasis: 'event',
      geo: { type: 'Point', coordinates: ZAGREB },
      data: { region: BIO_REGION, level, ...(sentence && sentence.length <= BIO_TEXT_MAX ? { text: sentence } : {}) },
    });
  }
  const sourceUpdatedAt = forecastAt(xmlText(doc.Bioprognoza.Prognozirano));
  return { items, ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}) };
}

export async function fetchDhmzBio(ctx: FetchContext): Promise<FeedPayload> {
  const response = await ctx.fetch(BIO_URL);
  return parseBio(await response.text(), ctx.now());
}
