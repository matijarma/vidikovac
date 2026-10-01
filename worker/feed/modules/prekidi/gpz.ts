import type { FetchContext } from '../../schema';
import { compactData, type ItemInput } from '../../payload';
import { decodeEntities, stripTags } from '../../html';
import { streetPoint } from '../../geo/streets';
import { addZagrebDays, zagrebDate, zagrebDayKey, zagrebIso, type ZagrebDate } from '../../time';
import { cutId, type CutsResult } from './common';

// Gradska plinara Zagreb (GPZ), "Novosti" (https://www.plinara-zagreb.hr/novosti/50): a list of notices, each a page
// of its own. A gas notice reads "Obavještavamo Vas da će dana <strong>31.8.2026</strong>. godine zbog radova ... biti
// obustavljena isporuka plina.", then "ZONA OBUHVATA RADOVA:" and the streets with their house numbers, one
// `<strong>` per street ("ULICA DUNJEVAC - 17") or several streets on one line ("SELSKA 32, 34, ..., 52/1 ZAGORSKA
// 18"). A notice can also be an index of stages, holding a list of its own child notices. No notice read on 30 Sep
// 2026 states hours, so a gas cut is a whole day (00:00 to 24:00, day precision) unless its text gives a clock range.
// GPZ states no terms of reuse and robots.txt is absent (404); the module is the unofficial view of the page.

export const GPZ_URL = 'https://www.plinara-zagreb.hr/novosti/50';
export const GPZ_ORIGIN = 'https://www.plinara-zagreb.hr';
/** Notices published this many days back are followed. */
export const GPZ_LOOKBACK_DAYS = 30;
export const GPZ_MAX_NOTICES = 5;
export const GPZ_MAX_CHILDREN = 4;
/** Cut days kept: today and the two after it. */
export const GPZ_AHEAD_DAYS = 2;

export interface GpzEntry { published: ZagrebDate; href: string; url: string; title: string }

const NOTICE_HREF = /^\/(?:ostalo\/)?novosti\/[\w-]+(?:\/[\w-]+)?\/\d+$/;
const ITEM = /<div class=['"]al-date['"]>\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\.?\s*<\/div>\s*<a class=['"]al-title['"] href=['"]([^'"]*)['"][^>]*>([\s\S]*?)<\/a>/g;
const HOURS = /(?:od|u vremenu od)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(?:h|sati)?\s*do\s*(\d{1,2})(?:[:.](\d{2}))?/iu;
const ONE_DAY = /\bdana\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/iu;
const RANGE = /\bod\s+(\d{1,2})\.\s*(\d{1,2})\.(?:\s*(\d{4})\.?)?\s*do\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/iu;
/** A house number as GPZ writes it: "17", "8/1", "52/1", "12DV", "2A". */
const HOUSE_NUMBER = /^\d+(?:[-/][\da-z]+|[a-z]{1,2})?$/i;

const text = (html: string) => decodeEntities(stripTags(html)).replace(/\s+/g, ' ').trim();

/** The entries of a list (the news page, or an index notice's own list). Throws when there is no list. */
export function parseGpzList(html: string): GpzEntry[] {
  const start = html.search(/<div class=['"]article-list['"]>/);
  if (start < 0) throw new Error('gpz: no article-list on the page');
  const entries: GpzEntry[] = [];
  for (const match of html.slice(start).matchAll(ITEM)) {
    const href = match[4]!;
    if (!NOTICE_HREF.test(href)) continue;
    entries.push({
      published: { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) },
      href,
      url: `${GPZ_ORIGIN}${href}`,
      title: text(match[5]!),
    });
  }
  return entries;
}

/** The notice's own text block, without the page around it. */
function userContent(html: string): string {
  const start = html.search(/<div class=['"]user-content['"]>/);
  if (start < 0) return '';
  const end = html.indexOf('<div class="clearfix">', start);
  return html.slice(start, end < 0 ? undefined : end);
}

/**
 * The streets of a notice's zone, with their house numbers as written. Lines break at `<br>` and `</strong>`; a line
 * "NAME - numbers" splits at " - "; otherwise the tokens run left to right, a house number (or a comma) joins the
 * current street's numbers and a word after a number starts the next street.
 */
export function splitZone(html: string): { street: string; houseNumbers: string }[] {
  const out: { street: string; houseNumbers: string }[] = [];
  for (const raw of html.split(/<br\s*\/?>|<\/strong>/i)) {
    const line = text(raw).replace(/^[:\s]+/, '').trim();
    if (!line) continue;
    const dash = line.indexOf(' - ');
    if (dash > 0) {
      out.push({ street: line.slice(0, dash).trim(), houseNumbers: line.slice(dash + 3).trim() });
      continue;
    }
    let name: string[] = [];
    let numbers: string[] = [];
    const flush = () => {
      if (name.length > 0) out.push({ street: name.join(' '), houseNumbers: numbers.join(', ') });
      name = [];
      numbers = [];
    };
    for (const token of line.split(/[\s,]+/).filter(Boolean)) {
      if (HOUSE_NUMBER.test(token)) {
        if (name.length > 0) numbers.push(token);
        continue;
      }
      if (numbers.length > 0) flush();
      name.push(token);
    }
    flush();
  }
  return out;
}

/** The work days a notice names: "dana D.M.YYYY", or every day of "od D.M. do D.M.YYYY". */
function noticeDays(content: string): ZagrebDate[] {
  const range = RANGE.exec(content);
  if (range) {
    const endYear = Number(range[6]);
    const from = { year: range[3] ? Number(range[3]) : endYear, month: Number(range[2]), day: Number(range[1]) };
    const to = { year: endYear, month: Number(range[5]), day: Number(range[4]) };
    const days: ZagrebDate[] = [];
    for (let day = from; zagrebDayKey(day) <= zagrebDayKey(to) && days.length < 31; day = addZagrebDays(day, 1)) days.push(day);
    return days;
  }
  const one = ONE_DAY.exec(content);
  return one ? [{ year: Number(one[3]), month: Number(one[2]), day: Number(one[1]) }] : [];
}

/**
 * One notice page: its child notices when it is an index of stages, else its cuts for the days from today to
 * today + 2 (Zagreb), one per street the street index can place. `total` counts every street named for those days.
 */
export function parseGpzNotice(html: string, now: Date, link?: string, taken: Set<string> = new Set()): { children: GpzEntry[] } | CutsResult {
  const block = userContent(html);
  if (/<div class=['"]article-list['"]>/.test(block)) return { children: parseGpzList(block) };
  const content = text(block);
  const today = zagrebDate(now);
  const first = zagrebDayKey(today);
  const last = zagrebDayKey(addZagrebDays(today, GPZ_AHEAD_DAYS));
  const days = noticeDays(content).filter((day) => zagrebDayKey(day) >= first && zagrebDayKey(day) <= last);
  const zoneAt = block.search(/ZONA OBUHVATA RADOVA/i);
  if (days.length === 0 || zoneAt < 0) return { items: [], total: 0 };
  const zoneHtml = block.slice(zoneAt).replace(/^ZONA OBUHVATA RADOVA/i, '');
  const linkAt = zoneHtml.search(/<a\s/i);
  const streets = splitZone(linkAt < 0 ? zoneHtml : zoneHtml.slice(0, linkAt));
  // The hours are read from the notice's own text only (the page's sidebar gives the office's opening hours).
  const hours = HOURS.exec(content.replace(RANGE, ''));
  const items: ItemInput[] = [];
  let total = 0;
  for (const day of days) {
    const key = zagrebDayKey(day);
    const next = addZagrebDays(day, 1);
    const timed = hours !== null;
    const at = timed ? zagrebIso(day.year, day.month, day.day, Number(hours[1]), Number(hours[2] ?? 0)) : zagrebIso(day.year, day.month, day.day);
    const until = timed ? zagrebIso(day.year, day.month, day.day, Number(hours[3]), Number(hours[4] ?? 0)) : zagrebIso(next.year, next.month, next.day);
    for (const { street, houseNumbers } of streets) {
      total += 1;
      const point = streetPoint(street, 'Zagreb');
      if (!point) continue;
      items.push({
        id: cutId('gpz', key, street, taken),
        kind: 'cut',
        title: point.name,
        at,
        until,
        dateBasis: 'event',
        geo: { type: 'Point', coordinates: [point.lon, point.lat] },
        ...(link ? { link } : {}),
        data: compactData({
          utility: 'plin',
          source: 'gpz',
          street,
          houseNumbers: houseNumbers || undefined,
          district: point.district ?? undefined,
          precision: timed ? 'time' : 'day',
        }),
      });
    }
  }
  return { items, total };
}

function recent(entries: readonly GpzEntry[], now: Date, max: number, seen: Set<string>): GpzEntry[] {
  const since = zagrebDayKey(addZagrebDays(zagrebDate(now), -GPZ_LOOKBACK_DAYS));
  const kept: GpzEntry[] = [];
  for (const entry of entries) {
    if (kept.length >= max) break;
    if (zagrebDayKey(entry.published) < since || seen.has(entry.url)) continue;
    seen.add(entry.url);
    kept.push(entry);
  }
  return kept;
}

/** The list, the notices of the last 30 days (at most 5) and one level of their children (at most 4): at most 10 requests. */
export async function fetchGpz(ctx: FetchContext): Promise<CutsResult> {
  const now = ctx.now();
  const list = parseGpzList(await (await ctx.fetch(GPZ_URL)).text());
  const seen = new Set<string>();
  const taken = new Set<string>();
  const items: ItemInput[] = [];
  let total = 0;
  const read = (entries: readonly GpzEntry[]) => Promise.all(entries.map(async (entry) => ({ entry, html: await (await ctx.fetch(entry.url)).text() })));
  const children: GpzEntry[] = [];
  const collect = (pages: { entry: GpzEntry; html: string }[]) => {
    for (const { entry, html } of pages) {
      const result = parseGpzNotice(html, now, entry.url, taken);
      if ('children' in result) {
        children.push(...result.children);
        continue;
      }
      items.push(...result.items);
      total += result.total;
    }
  };
  collect(await read(recent(list, now, GPZ_MAX_NOTICES, seen)));
  collect(await read(recent(children, now, GPZ_MAX_CHILDREN, seen)));
  items.sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!));
  return { items, total };
}
