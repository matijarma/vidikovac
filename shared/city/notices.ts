// ZET's own notices as the wall and Sada may show them (upgrade U1): which of
// the items of ZET's two RSS feeds (worker/feed/modules/dogadanja/zet-rss.ts)
// stand as the one "ZET javlja" row after the departures, and for how long.
//
// Pure: no DOM, no clock of its own. This file holds the one regex with ZET's
// own word "štrajk", because the filter has to recognise a service statement by
// the words ZET wrote. It must never move into app/src/i18n, shared/kiosk/
// sentence.ts or app/src/city/sentence.ts: no product string names a cause, and
// the upgrade's acceptance greps those three for the word (U1-5, U2-A7). ZET's
// title is shown as ZET's title, never rephrased and never explained.
//
// Two feeds, two rules (decisions 14, 22):
//   - zet-promet is ZET's traffic-notice feed: every item is a candidate, but it
//     shows where a line it names serves the place's boards (`lines`);
//   - zet-novosti is its news feed: an item is a candidate only when its title
//     reads like a service statement (NOVOSTI_NOTICE), and it shows everywhere.
// No date is ever read out of a notice's prose: it stands for NOTICE_WINDOW_MS
// after its publish time and, when its title names a weekday, not after that day.

import type { FeedItem } from '../../worker/feed/schema';

/**
 * How long a notice stands after ZET publishes it: 96 hours. The CRO Race
 * notices were published on a Thursday at 07:00 and 12:50 for the Sunday, 72 to
 * 77 hours ahead; 48 hours (the paired card's window) hides both on the day.
 */
export const NOTICE_WINDOW_MS = 96 * 3_600_000;

/**
 * A news item is a service statement when its title says so. D14's words plus
 * "hitn" and "izvanredn" (D22) and "uspostavljen", "zamjensk", "autobusn(a|e|u)
 * linij" and "tramvajsk(a|e|u) linij" (the emergency line 228 of 29 Sep is
 * "Uspostavljena autobusna linija 228 ..." and D22's list alone misses it).
 * Of the 23 news titles of 27 to 29 Sep it passes two, the strike notice and
 * line 228; of the 18 titles of the 12 Sep fixture, none.
 */
export const NOVOSTI_NOTICE = /štrajk|obustav|ne voz|ne prometuj|prometuje|ne koristi|izmijenj|izmjen|preusmjer|zatvor|prekid|skraćen|obilazn|mijenja|uvodi se|uspinjač|hitn|izvanredn|uspostavljen|zamjensk|autobusn[aeu] linij|tramvajsk[aeu] linij/i;

const LINE_LIST = /linij\p{L}*\s+(\d{1,3}[A-Z]?(?:\s*(?:,|\bi\b|\bte\b)\s*\d{1,3}[A-Z]?)*)/giu;
const LINE_SPLIT = /\s*(?:,|\bi\b|\bte\b)\s*/iu;

/** The lines a text names after the word "linija" in any case ("linije 5 i 13", "linija 263A"), upper case. */
export function noticeLines(text: string): string[] {
  const lines: string[] = [];
  for (const match of text.matchAll(LINE_LIST)) {
    for (const part of match[1]!.split(LINE_SPLIT)) {
      const line = part.trim().toUpperCase();
      if (line !== '') lines.push(line);
    }
  }
  return lines;
}

const WEEKDAY_IN_TITLE = /\bu (ponedjeljak|utorak|srijedu|četvrtak|petak|subotu|nedjelju)\b/iu;
/** getUTCDay() of the weekday the title names: the accusative after "u". */
const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  nedjelju: 0, ponedjeljak: 1, utorak: 2, srijedu: 3, četvrtak: 4, petak: 5, subotu: 6,
};

const ZAGREB_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zagreb', year: 'numeric', month: '2-digit', day: '2-digit' });
/** "2026-09-27": the Zagreb calendar day of an instant. */
const dayKey = (ms: number): string => ZAGREB_DAY.format(ms);

/**
 * Whether the day the title names is behind us. "U subotu izmjene na linijama
 * ..." names the first Saturday on or after the Zagreb day it was published;
 * ZET removes items up to a day late (the Saturday notice of line 137 stood all
 * Sunday), so the row ends with that day. A title without a weekday word is
 * never over by this rule. It only ever hides a notice; it never dates one.
 */
export function noticeDayOver(title: string, atMs: number, now: number): boolean {
  const match = WEEKDAY_IN_TITLE.exec(title);
  if (!match) return false;
  const wanted = WEEKDAY_INDEX[match[1]!.toLowerCase()];
  if (wanted === undefined) return false;
  const published = dayKey(atMs);
  const publishedDow = new Date(`${published}T12:00:00Z`).getUTCDay();
  const ahead = (wanted - publishedDow + 7) % 7;
  const endsOn = dayKey(Date.parse(`${published}T12:00:00Z`) + ahead * 86_400_000);
  return dayKey(now) > endsOn;
}

/**
 * The notices that may stand now, newest first (ties by id): a traffic notice
 * whose text names one of `lines` (the route names of the departures on the
 * place's boards, upper case), a news item that reads as a service statement;
 * published, not in the future, within NOTICE_WINDOW_MS, and not after the day
 * its title names.
 */
export function noticeCandidates(items: readonly FeedItem[], now: number, lines: ReadonlySet<string>): FeedItem[] {
  const out: Array<{ item: FeedItem; at: number }> = [];
  for (const item of items) {
    const source = String(item.data?.source ?? '');
    if (source !== 'zet-promet' && !(source === 'zet-novosti' && NOVOSTI_NOTICE.test(item.title))) continue;
    const at = item.at === undefined ? Number.NaN : Date.parse(item.at);
    if (!Number.isFinite(at) || at > now || now - at > NOTICE_WINDOW_MS) continue;
    if (noticeDayOver(item.title, at, now)) continue;
    if (source === 'zet-promet' && !noticeLines(`${item.title} ${item.summary ?? ''}`).some((line) => lines.has(line))) continue;
    out.push({ item, at });
  }
  return out.sort((a, b) => b.at - a.at || a.item.id.localeCompare(b.item.id)).map((entry) => entry.item);
}

/** ZET's own page of a notice: https, host zet.hr or www.zet.hr, no credentials or port; anything else is not linked. */
export function zetNoticeLink(link: string | undefined): string | undefined {
  if (link === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (url.hostname !== 'www.zet.hr' && url.hostname !== 'zet.hr') return undefined;
  if (url.username !== '' || url.password !== '' || url.port !== '') return undefined;
  return `https://${url.hostname}${url.pathname}${url.search}`;
}
