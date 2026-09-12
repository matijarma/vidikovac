// Every way a person takes something out of Vidikovac. The source line travels
// with the data in all four: clipboard, share sheet, calendar file and GeoJSON.
// Pure functions with injected browser seams, so all of it is unit-tested.
import type { Attribution, FeedItem, ModuleSnapshot } from '../../worker/feed/schema';
import { fillAttribution } from './attribution';

export const ICS_PRODID = '-//Vidikovac//Zagreb//HR';
const UID_HOST = 'zagreb.aningfilm.hr';

/**
 * `attribution.text` may be an unfilled R-08 template. Pass `snapshot` (and,
 * where the template needs one, `item`) to fill it first (R-62); omit both
 * when the caller has already filled it (or the text has no placeholder at
 * all) — the block is then built from `attribution.text` verbatim, exactly
 * as before.
 */
export function attributionBlock(
  attribution: Attribution,
  snapshot?: Pick<ModuleSnapshot, 'sourceUpdatedAt' | 'fetchedAt'>,
  item?: FeedItem,
): string {
  const text = snapshot ? fillAttribution(attribution, snapshot, item) : attribution.text;
  return `${text}\n${attribution.url}\n${attribution.licence}`;
}

export interface CopyDeps {
  clipboard?: Pick<Clipboard, 'writeText'>;
}

/** Never throws: the caller shows export.copied or export.copyFailed. */
export async function copyWithAttribution(
  text: string,
  attribution: Attribution,
  deps: CopyDeps = {},
): Promise<boolean> {
  const clipboard = 'clipboard' in deps ? deps.clipboard : globalThis.navigator?.clipboard;
  if (!clipboard) return false;
  try {
    await clipboard.writeText(`${text}\n\n${attributionBlock(attribution)}`);
    return true;
  } catch {
    return false;
  }
}

export type ShareOutcome = 'shared' | 'copied' | 'failed';

export interface ShareDeps {
  share?: (data: { title: string; url: string }) => Promise<void>;
  clipboard?: Pick<Clipboard, 'writeText'>;
}

export async function shareLink(url: string, title: string, deps: ShareDeps = {}): Promise<ShareOutcome> {
  const share = 'share' in deps ? deps.share : globalThis.navigator?.share?.bind(globalThis.navigator);
  if (share) {
    try {
      await share({ title, url });
      return 'shared';
    } catch (error) {
      // A deliberate cancel is not a failure to route around: the person said no.
      if (error instanceof Error && error.name === 'AbortError') return 'failed';
    }
  }
  const clipboard = 'clipboard' in deps ? deps.clipboard : globalThis.navigator?.clipboard;
  if (!clipboard) return 'failed';
  try {
    await clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n?|\n/g, '\\n');
}

function icsStamp(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}

/** Text-export boundary, not an HTML sanitizer: HTML consumers must still escape. */
function exportText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/<!--[\s\S]*?(?:-->|$)/g, ' ')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\r\n?|\n/g, '\n')
    .replace(/ *\n */g, '\n')
    .trim();
}

/** Only an actual string summary; never stringify RSS objects or invent act fulltext. */
export function itemExportSummary(item: FeedItem): string {
  return exportText(item.summary);
}

/** Item-level copy text. Pass this to copyWithAttribution with the item's source. */
export function itemExportText(item: FeedItem): string {
  return [exportText(item.title), itemExportSummary(item), exportText(item.link)].filter(Boolean).join('\n');
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ZONED_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const ZAGREB_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Zagreb', year: 'numeric', month: '2-digit', day: '2-digit',
});

function validDay(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Reject JS's rollover dates and host-local/ambiguous timestamps. */
function calendarDate(value: string | undefined): Date | null {
  if (typeof value !== 'string') return null;
  if (DATE_ONLY.test(value)) return validDay(value) ? new Date(`${value}T00:00:00Z`) : null;
  const match = ZONED_TIME.exec(value);
  if (!match || !validDay(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 ||
    Number(match[4] ?? 0) > 59) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function calendarDay(value: string, date: Date): string {
  // A literal date has no zone; parser-normalised day/range timestamps name
  // a Zagreb calendar day, often the previous UTC date in both winter and summer.
  if (DATE_ONLY.test(value)) return value.replace(/-/g, '');
  const parts = ZAGREB_DAY.formatToParts(date);
  return ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type)!.value).join('');
}

interface CalendarDates {
  allDay: boolean;
  start: string;
  end?: string;
}

function calendarDatesForItem(item: FeedItem): CalendarDates | null {
  // Only this legacy parser is known to use expectedStartTime/expectedEndTime.
  // An explicit non-event basis always wins, even for a closure.
  const legacyClosure = item.dateBasis === undefined && item.module === 'prometnice' && item.kind === 'closure';
  if (item.dateBasis !== 'event' && !legacyClosure) return null;
  if (item.kind !== 'event' && item.kind !== 'closure') return null;
  const start = calendarDate(item.at);
  if (!start) return null;
  const end = calendarDate(item.until);
  const precision = item.data?.precision;
  const allDay = DATE_ONLY.test(item.at!) || precision === 'day' || precision === 'range';
  if (!allDay) {
    return {
      allDay, start: icsStamp(start),
      ...(end && !DATE_ONLY.test(item.until!) && end.getTime() > start.getTime()
        ? { end: icsStamp(end) } : {}),
    };
  }
  const startDay = calendarDay(item.at!, start);
  const endDay = end ? calendarDay(item.until!, end) : undefined;
  // Feed `until` names the last included day, unlike iCalendar's exclusive DTEND.
  // Do calendar arithmetic, not elapsed hours, so DST cannot change the date.
  if (endDay && endDay >= startDay && end!.getTime() >= start.getTime()) {
    const exclusive = new Date(`${endDay.slice(0, 4)}-${endDay.slice(4, 6)}-${endDay.slice(6)}T00:00:00Z`);
    exclusive.setUTCDate(exclusive.getUTCDate() + 1);
    return { allDay, start: startDay, end: exclusive.toISOString().slice(0, 10).replace(/-/g, '') };
  }
  return { allDay, start: startDay };
}

/** Use the same eligibility check for buttons and the actual calendar export. */
export function canExportCalendarItem(item: FeedItem): boolean {
  return calendarDatesForItem(item) !== null;
}

/** RFC 5545 folding: 75 octets per line, continuations start with one space. */
function fold(line: string): string[] {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return [line];
  const out: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (currentBytes + size > limit) {
      out.push(current);
      current = ' ';
      currentBytes = 1;
      limit = 75;
    }
    current += char;
    currentBytes += size;
  }
  if (current) out.push(current);
  return out;
}

export interface IcsDeps {
  now?: Date;
  uidHost?: string;
  /** Snapshot time context for filling {vrijeme}/{datum} in `attribution`'s
   *  text (R-62); omit when it carries no placeholder. */
  snapshot?: Pick<ModuleSnapshot, 'sourceUpdatedAt' | 'fetchedAt'>;
}

/** Only verified event dates (plus legacy prometnice closure dates) leave as
 *  calendar entries. `attribution`, when given, travels in every DESCRIPTION. */
export function icsForItems(
  items: readonly FeedItem[],
  attribution?: Attribution,
  deps: IcsDeps = {},
): string {
  const stamp = icsStamp(deps.now ?? new Date());
  const host = deps.uidHost ?? UID_HOST;
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${ICS_PRODID}`, 'CALSCALE:GREGORIAN'];

  for (const item of items) {
    const dates = calendarDatesForItem(item);
    if (!dates) continue;
    const description = [itemExportSummary(item), attribution ? attributionBlock(attribution, deps.snapshot, item) : '']
      .filter(Boolean)
      .join('\n');
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${icsEscape(item.id)}@${host}`);
    lines.push(`DTSTAMP:${stamp}`);
    const dateType = dates.allDay ? ';VALUE=DATE' : '';
    lines.push(`DTSTART${dateType}:${dates.start}`);
    if (dates.end) lines.push(`DTEND${dateType}:${dates.end}`);
    lines.push(`SUMMARY:${icsEscape(exportText(item.title))}`);
    if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
    if (item.link) lines.push(`URL:${icsEscape(item.link)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.flatMap(fold).join('\r\n')}\r\n`;
}

/** A disabled item action returns null, never a misleading empty download. */
export function icsForItem(item: FeedItem, attribution?: Attribution, deps: IcsDeps = {}): string | null {
  return canExportCalendarItem(item) ? icsForItems([item], attribution, deps) : null;
}

export function icsFile(
  items: readonly FeedItem[],
  attribution?: Attribution,
  snapshot?: Pick<ModuleSnapshot, 'sourceUpdatedAt' | 'fetchedAt'>,
): File {
  return new File([icsForItems(items, attribution, { snapshot })], 'vidikovac.ics', {
    type: 'text/calendar;charset=utf-8',
  });
}

export interface ClosureFeature {
  type: 'Feature';
  geometry: { type: 'Point' | 'LineString'; coordinates: number[] | number[][] };
  properties: Record<string, string | number | boolean>;
}

export interface ClosureFeatureCollection {
  type: 'FeatureCollection';
  /** Foreign members: this file is our derivation, not the City's original. */
  adapted: true;
  attribution: Attribution;
  features: ClosureFeature[];
}

export function geojsonForClosures(snapshot: ModuleSnapshot): ClosureFeatureCollection {
  // Filled once, from the full snapshot this function already owns, so the
  // exported file's own attribution line never carries a raw brace (R-62).
  const attribution: Attribution = {
    ...snapshot.attribution,
    text: fillAttribution(snapshot.attribution, snapshot, snapshot.items[0]),
  };
  return {
    type: 'FeatureCollection',
    adapted: true,
    attribution,
    features: snapshot.items
      .filter((item) => item.geo !== undefined)
      .map((item) => ({
        type: 'Feature' as const,
        geometry: { type: item.geo!.type, coordinates: item.geo!.coordinates },
        properties: {
          ...Object.fromEntries(Object.entries(item.data ?? {}).filter(([key, value]) =>
            !['id', 'title', 'summary', 'at', 'until'].includes(key) &&
            (typeof value === 'string' || typeof value === 'boolean' ||
              (typeof value === 'number' && Number.isFinite(value))))),
          id: item.id,
          title: exportText(item.title),
          ...(itemExportSummary(item) ? { summary: itemExportSummary(item) } : {}),
          ...(item.at ? { at: item.at } : {}),
          ...(item.until ? { until: item.until } : {}),
          adapted: true,
          attribution: attribution.text,
          licence: snapshot.attribution.licence,
          source: snapshot.attribution.url,
        },
      })),
  };
}

export function geojsonFile(snapshot: ModuleSnapshot): File {
  return new File([JSON.stringify(geojsonForClosures(snapshot), null, 2)], `vidikovac-${snapshot.module}.geojson`, {
    type: 'application/geo+json',
  });
}

/** The print stylesheet turns the panel into an A4 page with the permalink. */
export function printAct(deps: { print?: () => void } = {}): void {
  (deps.print ?? (() => globalThis.print()))();
}
