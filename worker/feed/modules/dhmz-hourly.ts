import type { FetchContext } from '../schema';
import type { FeedPayload, ItemInput } from '../payload';
import { compactData } from '../payload';
import { parseXml, xmlArray, xmlText } from '../xml';
import { zagrebIso } from '../time';

// DHMZ's hourly model output for the Zagreb area, https://meteo.hr/7d_graf_i_simboli.xml (Otvorena dozvola,
// the same licence as the other DHMZ modules). One document holds 323 stations with 107 steps each (hourly to
// lead time 84 h, then every 3 and every 6 hours): 6.9 MB, of which the two Zagreb points are 40 KB. So the
// document is read as text, the two station blocks are found with indexOf and only those two slices go through
// the XML parser; the rest is never parsed (test/feed/dhmz-hourly.test.ts proves it with a spy).
//
// A step is one hour of temperature, precipitation (mm) and its probability (%). The file has no legend for its
// weather symbols, so no word is taken from a symbol: a wet step (0.2 mm or more, or a probability of 60 % or more)
// gets its rain word from the amount, and none at all near freezing, where the same amount may be snow.

export const DHMZ_HOURLY_URL = 'https://meteo.hr/7d_graf_i_simboli.xml';
/** Steps up to this lead time (hours after the run) are hourly. */
export const HOURLY_LEADTIME_MAX = 84;
/** A step is wet from this amount (mm) or this probability (%). */
export const WET_MM = 0.2;
export const WET_PROBABILITY = 60;
/** The amounts (mm) where the rain word changes: under the first "slaba kiša", from it "kiša", from the second "jaka kiša". */
export const RAIN_MM = 1;
export const HEAVY_RAIN_MM = 4;
/** At or under this temperature (°C) a wet step carries no rain word. */
export const NO_RAIN_WORD_AT_C = 1;

interface Station {
  /** The id part and the `data.station` value. */
  key: 'gric' | 'maksimir';
  name: string;
  /** How the block opens in the document, tab included: the anchor of the slice. */
  opening: string;
  /** DHMZ's own point of the station (hrvatska1_n.xml: Zagreb-Grič 45.81 15.97, Zagreb-Maksimir 45.822 16.034). */
  lon: number;
  lat: number;
}

export const STATIONS: readonly Station[] = [
  { key: 'gric', name: 'Zagreb-Grič', opening: '\t<grad ime="ZAGREB-GRIČ"', lon: 15.97, lat: 45.81 },
  { key: 'maksimir', name: 'Zagreb-Maksimir', opening: '\t<grad ime="ZAGREB-MAKSIMIR"', lon: 16.034, lat: 45.822 },
];

const CLOSING = '</grad>';

interface Dan {
  '@_datum'?: unknown;
  '@_sat'?: unknown;
  '@_leadtime'?: unknown;
  t_2m?: unknown;
  oborina?: unknown;
  vjerojatnost?: unknown;
}
interface GradDocument {
  grad?: { dan?: Dan | Dan[] };
}

function num(value: unknown): number | undefined {
  const text = xmlText(value);
  const parsed = Number(text);
  return text !== '' && Number.isFinite(parsed) ? parsed : undefined;
}

/** The rain word of a wet step, from its amount; none when it is cold enough to snow. */
export function rainWord(precip: number, temp: number): string | undefined {
  if (temp <= NO_RAIN_WORD_AT_C) return undefined;
  return precip >= HEAVY_RAIN_MM ? 'jaka kiša' : precip >= RAIN_MM ? 'kiša' : 'slaba kiša';
}

/**
 * The steps of one station's block: hourly only, in order of time, each ending where the next begins. A step's
 * time is its local date and hour (`zagrebIso(y, m, d, sat)`); the first step is read that way and the others are
 * the lead-time hours after it, which is the same on every day but the two nights the clocks change, when a local
 * hour is missing or comes twice and the lead time stays right.
 */
export function parseStation(station: Station, block: string): ItemInput[] {
  const doc = parseXml<GradDocument>(block, { arrayPaths: ['grad.dan'] });
  const steps = xmlArray(doc.grad?.dan).flatMap((dan) => {
    const leadtime = num(dan['@_leadtime']);
    const [day, month, year] = xmlText(dan['@_datum']).split('.').map(Number);
    const hour = num(dan['@_sat']);
    const temp = num(dan.t_2m);
    const precip = num(dan.oborina);
    const prob = num(dan.vjerojatnost);
    const known = leadtime !== undefined && hour !== undefined && temp !== undefined && precip !== undefined && prob !== undefined
      && Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day);
    if (!known || leadtime > HOURLY_LEADTIME_MAX) return [];
    return [{ leadtime, local: zagrebIso(year!, month!, day!, hour), temp, precip, prob }];
  });
  if (steps.length === 0) throw new Error(`dhmz-hourly: no hourly steps for ${station.name}`);
  steps.sort((a, b) => a.leadtime - b.leadtime);
  const first = steps[0]!;
  const distinct = steps.filter((step, i) => i === 0 || step.leadtime !== steps[i - 1]!.leadtime);
  const timed = distinct.map((step) => ({ ...step, at: new Date(Date.parse(first.local) + (step.leadtime - first.leadtime) * 3_600_000).toISOString() }));
  return timed.map((step, i) => {
    const wet = step.precip >= WET_MM || step.prob >= WET_PROBABILITY;
    const until = timed[i + 1]?.at ?? new Date(Date.parse(step.at) + 3_600_000).toISOString();
    return {
      id: `dhmz-hourly:${station.key}:${step.at}`,
      kind: 'forecast' as const,
      title: station.name,
      at: step.at,
      until,
      geo: { type: 'Point' as const, coordinates: [station.lon, station.lat] },
      data: compactData({
        station: station.key,
        temp: step.temp,
        precip: step.precip,
        prob: step.prob,
        weather: wet ? rainWord(step.precip, step.temp) : undefined,
      }),
    };
  });
}

const UPDATED = /Zadnja izmjena\s+(\d{1,2})\.(\d{1,2})\.(\d{4})\.\s+u\s+(\d{1,2}):(\d{2})/;

/** The document's own update time ("Zadnja izmjena 29.09.2026. u 11:22.", Zagreb time), from its head. */
export function updatedAt(head: string): string | undefined {
  const match = UPDATED.exec(head);
  if (!match) return undefined;
  const [day, month, year, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  return zagrebIso(year, month, day, hour, minute);
}

export function parseDhmzHourly(xml: string): FeedPayload {
  const items: ItemInput[] = [];
  for (const station of STATIONS) {
    const start = xml.indexOf(station.opening);
    const end = start < 0 ? -1 : xml.indexOf(CLOSING, start);
    if (start < 0 || end < 0) throw new Error(`dhmz-hourly: no block for ${station.name}`);
    items.push(...parseStation(station, xml.slice(start, end + CLOSING.length)));
  }
  const first = xml.indexOf('<grad');
  const sourceUpdatedAt = updatedAt(first < 0 ? xml : xml.slice(0, first));
  return { items, ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}) };
}

export async function fetchDhmzHourly(ctx: FetchContext): Promise<FeedPayload> {
  const response = await ctx.fetch(DHMZ_HOURLY_URL);
  return parseDhmzHourly(await response.text());
}
