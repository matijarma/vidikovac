import type { FetchContext } from '../schema';
import type { FeedPayload, ItemInput } from '../payload';
import { compactData } from '../payload';
import { decodeEntities, stripTags } from '../html';
import { streetPoint } from '../geo/streets';
import { districtOf } from '../geo/districts';
import { zagrebIso, type ZagrebDate } from '../time';

// HAK, "Stanje na cestama" (https://www.hak.hr/info/stanje-na-cestama/): the Croatian Auto Club's road report, an
// HTML page of sections (Prohodnost cesta, Stanje na autocestama, Granični prijelazi...) that each carry their own
// "Ažurirano d.m.yyyy. HH:MM". The lines of a section are free text, most of them about motorways far from Zagreb.
//
// The terms of the site (hak.hr/hak/uvjeti-koristenja) allow, in article 8, the continuous or automated transfer of a
// limited selection of information from HAK's publications, in order to inform the public, if it is transferred
// exactly, with HAK named as the source, the exact time of the last update and a link to the HAK original, without
// misleading presentation or an impression of partnership. Article 10 forbids collecting the content with scripts
// without HAK's prior written approval. This module is the article-8 relay: a closed selection (the lines about the
// Zagreb area that say when they end), each line verbatim as the summary, the section's update time as the item's
// time, the HAK page as the link, the credit "Izvor: HAK, stanje na cestama, {vrijeme}; neslužbeni prikaz". Article 10
// is quoted beside the row in docs/izvori.md, and a letter to HAK is the owner's to write. Switching the relay off is
// one line in TEASER_MODULES (worker/feed/registry.ts).

export const HAK_URL = 'https://www.hak.hr/info/stanje-na-cestama/';

/** The Zagreb-area closed list: the bypass and its junctions, the City by name, the marathon. */
export const ZAGREB_LINE = /zagrebačk\w* obilaznic|\b(?:Lučko|Jankomir|Zagreb zapad|Zagreb istok|Ivanja Reka|Buzin|Jakuševec|Kosnica|Sesvete)|\bu Zagrebu\b|\bGrad[au]? Zagreb|Zagrebački .{0,20}maraton/i;
/** A line is kept only when it ends within this many days. */
export const HAK_HORIZON_DAYS = 7;

/** The junctions a line can name, with the point of the ZET stop of the same locality (HAK gives no coordinate). */
const JUNCTIONS: readonly { pattern: RegExp; name: string; lon: number; lat: number }[] = [
  { pattern: /Lučko/i, name: 'Čvor Lučko', lon: 15.88405, lat: 45.76984 },
  { pattern: /Jankomir|Zagreba? zapad/i, name: 'Čvor Zagreb zapad', lon: 15.88049, lat: 45.81158 },
  { pattern: /Buzin/i, name: 'Čvor Buzin', lon: 15.99181, lat: 45.74871 },
  { pattern: /Jakuševec/i, name: 'Čvor Jakuševec', lon: 16.01581, lat: 45.76052 },
  { pattern: /Ivanja Reka|Zagreba? istok/i, name: 'Čvor Zagreb istok', lon: 16.11897, lat: 45.79782 },
  { pattern: /Sesvete/i, name: 'Čvor Sesvete', lon: 16.10951, lat: 45.82544 },
  { pattern: /Kosnica/i, name: 'Čvor Kosnica', lon: 16.08648, lat: 45.75648 },
];

const MONTH = 'siječnja|veljače|ožujka|travnja|svibnja|lipnja|srpnja|kolovoza|rujna|listopada|studenoga?|prosinca';
const MONTHS: Record<string, number> = {
  siječnja: 1, veljače: 2, ožujka: 3, travnja: 4, svibnja: 5, lipnja: 6, srpnja: 7, kolovoza: 8, rujna: 9, listopada: 10,
  studenog: 11, studenoga: 11, prosinca: 12,
};
const CLOCK = '(\\d{1,2}):(\\d{2})';
const UNTIL_DATE = new RegExp(`\\bdo\\s+(\\d{1,2})\\.\\s*(${MONTH})`, 'i');
const DATE_WINDOW = new RegExp(`(?<!\\d)(\\d{1,2})\\.\\s*(${MONTH})\\s+od\\s+${CLOCK}\\s*(?:h|sati)?\\s*do\\s+${CLOCK}`, 'i');
const WINDOW = new RegExp(`\\bod\\s+${CLOCK}\\s*(?:h|sati)?\\s*do\\s+${CLOCK}`, 'i');
const UNTIL_CLOCK = new RegExp(`\\bdo\\s+${CLOCK}`, 'i');

const TIMESTAMP = /<h4 class="timestamp">\s*Ažurirano\s*<strong>\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\.\s*(\d{1,2}):(\d{2})\s*<\/strong>\s*<\/h4>/g;
const SECTION_START = 'class="content-category';
const HEADING = /<h3[^>]*>([\s\S]*?)<\/h3>/g;
const BLOCK_BOUNDARY = /<\/?(?:br|p|li|ul|ol|div|h[1-6]|tr|table)\b[^>]*>/gi;

interface Section {
  title: string;
  /** The section's "Ažurirano", as the instant it names in Zagreb time. */
  at: string;
  day: ZagrebDate;
  html: string;
}

/** 32-bit FNV-1a as 8 hex digits: the stable id of a line. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const plain = (html: string): string => decodeEntities(stripTags(html));

/** The sections that carry an "Ažurirano": the title, the time and the markup up to the next section. Throws when there are none. */
export function sectionsOf(html: string): Section[] {
  const stamps = [...html.matchAll(TIMESTAMP)];
  if (stamps.length === 0) throw new Error('hak: no "Ažurirano" section on the page');
  const headings = [...html.matchAll(HEADING)].map((match) => ({ at: match.index!, title: plain(match[1]!) }));
  return stamps.map((stamp, i) => {
    const bodyStart = stamp.index! + stamp[0].length;
    const next = html.indexOf(SECTION_START, bodyStart);
    const bodyEnd = Math.min(next < 0 ? html.length : next, stamps[i + 1]?.index ?? html.length);
    const [day, month, year, hour, minute] = stamp.slice(1).map(Number) as [number, number, number, number, number];
    const title = [...headings].reverse().find((heading) => heading.at < stamp.index!)?.title ?? '';
    return { title, at: zagrebIso(year, month, day, hour, minute), day: { year, month, day }, html: html.slice(bodyStart, bodyEnd) };
  });
}

/** The text lines of a section's markup: block boundaries split lines, tags and entities are gone, blanks dropped. */
export function linesOf(html: string): string[] {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(BLOCK_BOUNDARY, '\n')
    .split('\n')
    .map((line) => plain(line))
    .filter(Boolean);
}

/** The instant the line's notice ends, or undefined when it names none in a form this module reads. */
export function lineEnd(line: string, section: Pick<Section, 'at' | 'day'>): string | undefined {
  const stamp = Date.parse(section.at);
  const { year, month, day } = section.day;
  const at = (offset: number, hour: number, minute: number): number => Date.parse(zagrebIso(year, month, day + offset, hour, minute));
  const iso = (ms: number): string => new Date(ms).toISOString();

  // "do 3. listopada", "do 30.rujna": the end of that day. A month earlier in the calendar than the section is next year's.
  const date = UNTIL_DATE.exec(line);
  if (date) {
    const target = MONTHS[date[2]!.toLocaleLowerCase('hr')]!;
    let end = Date.parse(zagrebIso(year, target, Number(date[1]) + 1, 0, 0));
    if (end < stamp - 86_400_000) end = Date.parse(zagrebIso(year + 1, target, Number(date[1]) + 1, 0, 0));
    return iso(end);
  }
  // "30. rujna od 00:00 do 05:00 sati": that day's window.
  const dated = DATE_WINDOW.exec(line);
  if (dated) {
    const target = MONTHS[dated[2]!.toLocaleLowerCase('hr')]!;
    const [d, sh, sm, eh, em] = [dated[1], dated[3], dated[4], dated[5], dated[6]].map(Number) as [number, number, number, number, number];
    const start = Date.parse(zagrebIso(year, target, d, sh, sm));
    let end = Date.parse(zagrebIso(year, target, d, eh, em));
    if (end <= start) end = Date.parse(zagrebIso(year, target, d + 1, eh, em));
    return iso(end);
  }
  // "od 00:00 do 05:00 sati": the window that is on at the section's time or the next one after it.
  const window = WINDOW.exec(line);
  if (window) {
    const [sh, sm, eh, em] = window.slice(1).map(Number) as [number, number, number, number];
    for (const offset of [-1, 0, 1]) {
      const start = at(offset, sh, sm);
      let end = at(offset, eh, em);
      if (end <= start) end = at(offset + 1, eh, em);
      if (end > stamp) return iso(end);
    }
    return undefined;
  }
  // "do 22:00": the next 22:00 after the section's time.
  const clock = UNTIL_CLOCK.exec(line);
  if (clock) {
    const [h, m] = [Number(clock[1]), Number(clock[2])] as const;
    const today = at(0, h, m);
    return iso(today > stamp ? today : at(1, h, m));
  }
  return undefined;
}

/** The state the line describes, by the first of these that its words name. */
export function lineState(line: string): 'zatvoreno za promet' | 'zastoj' | 'privremena regulacija' | 'radovi' {
  if (/zatvor/i.test(line)) return 'zatvoreno za promet';
  if (/kolon|zastoj|gužv/i.test(line)) return 'zastoj';
  if (/jednim trakom|preusmjer|regulacij|sužen/i.test(line)) return 'privremena regulacija';
  return 'radovi';
}

const STREET_NOUN = 'ulic\\w*|cest\\w*|avenij\\w*|most\\w*|obal\\w*';
/** "Savska cesta", "Jadranski most": capitalised words and then the noun. */
const NAME_THEN_NOUN = new RegExp(`((?:\\p{Lu}[\\p{L}.-]*\\s+){1,3})(${STREET_NOUN})(?![\\p{L}])`, 'gu');
/** "Ulica grada Vukovara", "Avenija Većeslava Holjevca": the noun and the words after it. */
const NOUN_THEN_NAME = new RegExp(`(?<![\\p{L}])((?:Ulic|Cest|Avenij|Trg)\\p{L}*)((?:\\s+[\\p{L}.-]+){1,4})`, 'gu');

/** The street names a line seems to speak of, in order of appearance, longer readings before shorter ones. */
export function streetCandidates(line: string): string[] {
  const found: { index: number; names: string[] }[] = [];
  for (const match of line.matchAll(NAME_THEN_NOUN)) {
    const words = match[1]!.trim().split(/\s+/);
    found.push({ index: match.index!, names: words.map((_, i) => `${words.slice(i).join(' ')} ${match[2]}`) });
  }
  for (const match of line.matchAll(NOUN_THEN_NAME)) {
    const words = match[2]!.trim().split(/\s+/);
    found.push({ index: match.index!, names: words.map((_, i) => `${match[1]} ${words.slice(0, words.length - i).join(' ')}`).filter((name) => name.split(' ').length > 1) });
  }
  return found.sort((a, b) => a.index - b.index).flatMap((entry) => entry.names);
}

interface Placed {
  title: string;
  street: string;
  lon: number;
  lat: number;
}

/** Where a line is: the first junction it names, else the first street the index can place; else nowhere. */
export function placeOf(line: string): Placed | undefined {
  let first: { index: number; junction: (typeof JUNCTIONS)[number] } | undefined;
  for (const junction of JUNCTIONS) {
    const index = junction.pattern.exec(line)?.index;
    if (index !== undefined && (!first || index < first.index)) first = { index, junction };
  }
  if (first) return { title: first.junction.name, street: first.junction.name, lon: first.junction.lon, lat: first.junction.lat };
  for (const candidate of streetCandidates(line)) {
    const point = streetPoint(candidate);
    if (point) return { title: point.name, street: candidate, lon: point.lon, lat: point.lat };
  }
  return undefined;
}

export function parseHak(html: string, now: Date): FeedPayload {
  const sections = sectionsOf(html);
  const horizon = now.getTime() + HAK_HORIZON_DAYS * 86_400_000;
  const items: ItemInput[] = [];
  const seen = new Set<string>();
  const used: string[] = [];
  for (const section of sections) {
    for (const line of linesOf(section.html)) {
      if (!ZAGREB_LINE.test(line)) continue;
      const until = lineEnd(line, section);
      if (!until || Date.parse(until) <= now.getTime() || Date.parse(until) > horizon) continue;
      const place = placeOf(line);
      if (!place) continue;
      const id = `hak:${fnv1a(line.toLocaleLowerCase('hr').replace(/\s+/g, ' ').trim())}`;
      if (seen.has(id)) continue;
      seen.add(id);
      used.push(section.at);
      items.push({
        id,
        kind: 'road',
        title: place.title,
        summary: line,
        at: section.at,
        dateBasis: 'updated',
        until,
        geo: { type: 'Point', coordinates: [place.lon, place.lat] },
        link: HAK_URL,
        data: compactData({
          source: 'hak',
          section: section.title || undefined,
          state: lineState(line),
          street: place.street,
          district: districtOf(place.lon, place.lat) ?? undefined,
        }),
      });
    }
  }
  // The credit names the time of the update the selection stands on: the oldest section a shown line comes from,
  // so it never claims a fresher page than a line shown; with nothing shown, the newest update on the page.
  const times = used.length > 0 ? used : sections.map((section) => section.at);
  const sourceUpdatedAt = (used.length > 0 ? [...times].sort()[0] : [...times].sort().at(-1))!;
  return { items, sourceUpdatedAt, coverage: { shown: items.length, limited: true } };
}

export async function fetchHak(ctx: FetchContext): Promise<FeedPayload> {
  const response = await ctx.fetch(HAK_URL);
  return parseHak(await response.text(), ctx.now());
}
