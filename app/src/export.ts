// Every way a person takes something out of Vidikovac. The source line travels
// with the data in all four: clipboard, share sheet, calendar file and GeoJSON.
// Pure functions with injected browser seams, so all of it is unit-tested.
import type { Attribution, FeedItem, ModuleSnapshot } from '../../worker/feed/schema';

export const ICS_PRODID = '-//Vidikovac//Zagreb//HR';
const UID_HOST = 'zagreb.aningfilm.hr';

export function attributionBlock(attribution: Attribution): string {
  return `${attribution.text}\n${attribution.url}\n${attribution.licence}`;
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
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsStamp(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
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
}

/** Closures and events as a calendar. `attribution`, when given, goes into every
 *  DESCRIPTION so the file carries its own source line. */
export function icsForItems(
  items: readonly FeedItem[],
  attribution?: Attribution,
  deps: IcsDeps = {},
): string {
  const stamp = icsStamp(deps.now ?? new Date());
  const host = deps.uidHost ?? UID_HOST;
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${ICS_PRODID}`, 'CALSCALE:GREGORIAN'];

  for (const item of items) {
    const start = item.at ? new Date(item.at) : null;
    if (!start || !Number.isFinite(start.getTime())) continue;
    const end = item.until ? new Date(item.until) : null;
    const description = [item.summary, attribution ? attributionBlock(attribution) : '']
      .filter(Boolean)
      .join('\n');
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${icsEscape(item.id)}@${host}`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${icsStamp(start)}`);
    if (end && Number.isFinite(end.getTime())) lines.push(`DTEND:${icsStamp(end)}`);
    else lines.push('DURATION:PT1H');
    lines.push(`SUMMARY:${icsEscape(item.title)}`);
    if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
    if (item.link) lines.push(`URL:${icsEscape(item.link)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.flatMap(fold).join('\r\n')}\r\n`;
}

export function icsFile(items: readonly FeedItem[], attribution?: Attribution): File {
  return new File([icsForItems(items, attribution)], 'vidikovac.ics', { type: 'text/calendar;charset=utf-8' });
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
  return {
    type: 'FeatureCollection',
    adapted: true,
    attribution: snapshot.attribution,
    features: snapshot.items
      .filter((item) => item.geo !== undefined)
      .map((item) => ({
        type: 'Feature' as const,
        geometry: { type: item.geo!.type, coordinates: item.geo!.coordinates },
        properties: {
          id: item.id,
          title: item.title,
          ...(item.summary ? { summary: item.summary } : {}),
          ...(item.at ? { at: item.at } : {}),
          ...(item.until ? { until: item.until } : {}),
          ...(item.data ?? {}),
          adapted: true,
          attribution: snapshot.attribution.text,
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
