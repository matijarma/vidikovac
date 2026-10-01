import type { FetchContext, SourceAvailability } from '../schema';
import type { FeedPayload, ItemInput } from '../payload';
import { parseXml, xmlArray, xmlText } from '../xml';
import { addZagrebDays, zagrebDate, zagrebDayKey, zagrebIso } from '../time';

// DHMZ's heat and cold wave warnings, https://prognoza.hr/toplinskival_5.xml and https://prognoza.hr/hladnival.xml
// (Otvorena dozvola, "Izvor: DHMZ"): eight stations, one of them Zagreb (15.98 45.82), a letter per day (`dan1..dan5`
// in the heat file, `dan1..dan4` in the cold one). DHMZ names four levels of danger (nema opasnosti, umjerena,
// velika, vrlo velika opasnost) and colours them green, yellow, orange and red; the files carry the colour's letter,
// and the cold file's `W` is drawn by DHMZ's own page as a grey "0". So W and G are level 0, Y 1, O 2, R 3. A letter
// outside that table drops the station's item and is counted in `coverage`: a change of format shows, no level is
// guessed (docs/reveal-2026-10-plan/R3.md D-F).
//
// Out of season DHMZ leaves the last file in place (the cold file of 30 Sep 2026 was made on 24 Feb), so a file is
// read only when its first day is today or yesterday in Zagreb (D-G); otherwise it is a successful empty answer. The
// two files are fetched in parallel and fail one at a time (the prekidi pattern): the module throws only when both do.

export const HEAT_URL = 'https://prognoza.hr/toplinskival_5.xml';
export const COLD_URL = 'https://prognoza.hr/hladnival.xml';
export const WAVE_STATION = 'Zagreb';

export type Wave = 'heat' | 'cold';

/** DHMZ's colour letters to its levels of danger (D-F). */
export const WAVE_LEVELS: Readonly<Record<string, number>> = { W: 0, G: 0, Y: 1, O: 2, R: 3 };

interface Param { '@_name'?: unknown; '@_value'?: unknown }
interface Station { '@_name'?: unknown; '@_lon'?: unknown; '@_lat'?: unknown; param?: Param[] }
interface WaveDocument {
  TriVis?: { metadata?: { datatime?: unknown; creationtime?: unknown }; section?: { station?: Station[] } | string };
}

export interface WaveResult {
  items: ItemInput[];
  /** Stations dropped for a letter outside WAVE_LEVELS. */
  dropped: number;
  sourceUpdatedAt?: string;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** `creationtime` in either form DHMZ writes it: RFC 2822 with an offset, or C's ctime in Zagreb time. */
export function creationInstant(text: string): { year: number; iso?: string } | undefined {
  const year = /\b(\d{4})\b/.exec(text)?.[1];
  if (!year) return undefined;
  if (/[+-]\d{4}\s*$/.test(text)) {
    const parsed = Date.parse(text);
    return { year: Number(year), ...(Number.isFinite(parsed) ? { iso: new Date(parsed).toISOString() } : {}) };
  }
  const ctime = /^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(\d{4})$/.exec(text.trim());
  const month = ctime ? MONTHS.indexOf(ctime[1]!.toLowerCase()) + 1 : 0;
  if (!ctime || month === 0) return { year: Number(year) };
  return { year: Number(year), iso: zagrebIso(Number(ctime[6]), month, Number(ctime[2]), Number(ctime[3]), Number(ctime[4])) };
}

/** One wave file to its Zagreb item, if the file is current. Throws when the root is not TriVis. */
export function parseWaves(xml: string, wave: Wave, now: Date): WaveResult {
  const doc = parseXml<WaveDocument>(xml, { arrayPaths: ['TriVis.section.station', 'TriVis.section.station.param'] });
  if (!doc.TriVis) throw new Error(`dhmz-waves: ${wave} file has no TriVis root`);
  const created = creationInstant(xmlText(doc.TriVis.metadata?.creationtime));
  const base = { items: [] as ItemInput[], dropped: 0, ...(created?.iso ? { sourceUpdatedAt: created.iso } : {}) };
  const section = doc.TriVis.section;
  const stations = typeof section === 'object' && section ? xmlArray(section.station) : [];
  const datatime = /^(\d{2})(\d{2})(\d{2})$/.exec(xmlText(doc.TriVis.metadata?.datatime));
  if (stations.length === 0 || !datatime || !created) return base;
  const first = { year: created.year, month: Number(datatime[2]), day: Number(datatime[1]) };
  const today = zagrebDate(now);
  const firstKey = zagrebDayKey(first);
  const offset = firstKey === zagrebDayKey(today) ? 0 : firstKey === zagrebDayKey(addZagrebDays(today, -1)) ? 1 : -1;
  if (offset < 0) return base;
  const station = stations.find((entry) => xmlText(entry['@_name']) === WAVE_STATION);
  if (!station) return base;
  const days = xmlArray(station.param)
    .map((param) => ({ n: Number(/^dan(\d)$/.exec(xmlText(param['@_name']))?.[1]), letter: xmlText(param['@_value']).toUpperCase() }))
    .filter((entry) => Number.isInteger(entry.n))
    .sort((a, b) => a.n - b.n);
  const levels = days.map((entry) => WAVE_LEVELS[entry.letter]);
  if (days.length === 0 || levels.some((level) => level === undefined) || offset >= days.length) {
    return { ...base, dropped: days.length === 0 || offset >= days.length ? 0 : 1 };
  }
  const lon = Number(xmlText(station['@_lon']));
  const lat = Number(xmlText(station['@_lat']));
  const end = addZagrebDays(first, days.length);
  return {
    ...base,
    items: [{
      id: `dhmz-waves:${wave}:${firstKey}`,
      kind: 'forecast',
      title: wave === 'heat' ? 'Toplinski val' : 'Hladni val',
      at: zagrebIso(first.year, first.month, first.day),
      until: zagrebIso(end.year, end.month, end.day),
      dateBasis: 'event',
      ...(Number.isFinite(lon) && Number.isFinite(lat) ? { geo: { type: 'Point' as const, coordinates: [lon, lat] } } : {}),
      data: { wave, levels: levels.join(','), level: levels[offset]!, station: WAVE_STATION },
    }],
  };
}

async function readWave(ctx: FetchContext, url: string, wave: Wave): Promise<WaveResult> {
  const response = await ctx.fetch(url);
  // The files declare ISO-8859-1; windows-1252 is its superset as browsers decode it.
  const xml = new TextDecoder('windows-1252').decode(await response.arrayBuffer());
  return parseWaves(xml, wave, ctx.now());
}

export async function fetchDhmzWaves(ctx: FetchContext): Promise<FeedPayload> {
  const jobs: [Wave, string][] = [['heat', HEAT_URL], ['cold', COLD_URL]];
  const settled = await Promise.allSettled(jobs.map(([wave, url]) => readWave(ctx, url, wave)));
  if (settled.every((result) => result.status === 'rejected')) throw new Error('dhmz-waves: both files failed');
  const fetchedAt = ctx.now().toISOString();
  const sources: Record<string, SourceAvailability> = {};
  const items: ItemInput[] = [];
  let dropped = 0;
  let sourceUpdatedAt: string | undefined;
  settled.forEach((result, index) => {
    const [wave] = jobs[index]!;
    if (result.status === 'rejected') {
      sources[wave] = { status: 'down', itemCount: 0 };
      return;
    }
    items.push(...result.value.items);
    dropped += result.value.dropped;
    sources[wave] = { status: 'live', itemCount: result.value.items.length, fetchedAt, ...(result.value.sourceUpdatedAt ? { sourceUpdatedAt: result.value.sourceUpdatedAt } : {}) };
    if (result.value.sourceUpdatedAt && (!sourceUpdatedAt || result.value.sourceUpdatedAt > sourceUpdatedAt)) sourceUpdatedAt = result.value.sourceUpdatedAt;
  });
  return {
    items,
    sources,
    ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
    ...(dropped > 0 ? { coverage: { shown: items.length, total: items.length + dropped, limited: true } } : {}),
  };
}
