import type { FetchContext } from '../schema';
import type { FeedPayload, ItemInput } from '../payload';
import { compactData } from '../payload';
import { isoOrUndefined } from '../time';

// data.zagreb.hr publishes closures as a flat JSON array with a Waze-style
// polyline in "lat lon lat lon" order and no identifier, so the item id is built
// from the street and the start time: stable across refreshes, unique in practice.

export const PROMETNICE_URL =
  'https://data.zagreb.hr/dataset/7ff5514d-0a1f-4f6c-86bd-8ed9a3c55eee/resource/e48b6992-add0-45a1-ae95-c5d97d8db259/download/data.json';

const SUBTYPE_WORDS: Record<string, string> = {
  ROAD_CLOSED_CONSTRUCTION: 'zatvoreno zbog radova',
  ROAD_CLOSED_EVENT: 'zatvoreno zbog događaja',
  ROAD_CLOSED_HAZARD: 'zatvoreno zbog opasnosti',
};

const DIRECTION_WORDS: Record<string, string> = {
  BOTH_DIRECTIONS: 'oba smjera',
  ONE_DIRECTION: 'jedan smjer',
};

export function parsePolyline(polyline: string): number[][] {
  const numbers = polyline
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)
    .filter((value) => Number.isFinite(value));
  const pairs: number[][] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    pairs.push([numbers[index + 1], numbers[index]]); // source is lat lon, GeoJSON is lon lat
  }
  return pairs;
}

export function closureWords(subtype: string, direction: string): string {
  const why = SUBTYPE_WORDS[subtype] ?? 'zatvoreno';
  const where = DIRECTION_WORDS[direction];
  return where ? `${why}, ${where}` : why;
}

const DIACRITICS: Record<string, string> = { č: 'c', ć: 'c', đ: 'd', š: 's', ž: 'z' };

function slug(value: string): string {
  return value
    .toLocaleLowerCase('hr')
    .replace(/[čćđšž]/g, (char) => DIACRITICS[char])
    .normalize('NFD')
    .replace(new RegExp(`[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`, 'g'), '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

interface ClosureRecord {
  type?: string;
  street?: string;
  subtype?: string;
  polyline?: string;
  direction?: string;
  expectedStartTime?: string;
  expectedEndTime?: string;
}

export function parsePrometnice(json: unknown): FeedPayload {
  if (!Array.isArray(json)) return { items: [] };
  const items: ItemInput[] = [];
  const used = new Set<string>();

  for (const entry of json) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as ClosureRecord;
    const street = (record.street ?? '').trim();
    const coordinates = parsePolyline(record.polyline ?? '');
    if (!street || coordinates.length === 0) continue;

    const at = isoOrUndefined(record.expectedStartTime);
    const until = isoOrUndefined(record.expectedEndTime);
    let id = `${slug(street)}:${at ?? 'bez-pocetka'}`;
    for (let suffix = 2; used.has(id); suffix += 1) id = `${slug(street)}:${at ?? 'bez-pocetka'}:${suffix}`;
    used.add(id);

    items.push({
      id,
      kind: 'closure',
      title: street,
      summary: closureWords(record.subtype ?? '', record.direction ?? ''),
      severity: record.type === 'ROAD_CLOSED' ? 'moderate' : 'minor',
      ...(at ? { at } : {}),
      ...(until ? { until } : {}),
      geo: { type: 'LineString', coordinates },
      data: compactData({ type: record.type, subtype: record.subtype, direction: record.direction }),
    });
  }

  return { items };
}

export async function fetchPrometnice(ctx: FetchContext): Promise<FeedPayload> {
  const response = await ctx.fetch(PROMETNICE_URL);
  // This JSON has item windows, not a dataset publication timestamp.
  // The feed wrapper records retrieval in fetchedAt; do not duplicate it
  // as a claim about when the publisher updated the data.
  return parsePrometnice(await response.json());
}
