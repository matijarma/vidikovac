import type { FetchContext } from '../schema';
import type { FeedPayload } from '../payload';
import { compactData } from '../payload';
import { parseXml, xmlArray, xmlText } from '../xml';
import { zagrebIso } from '../time';

// hrvatska1_n.xml holds one <Grad> per station for the latest term. The term is
// Zagreb local time with no offset, and values are padded (` 15.2`) or flagged
// (`904.5*` for a reduced pressure), so every number is cleaned before use.

export const DHMZ_NOW_URL = 'https://vrijeme.hr/hrvatska1_n.xml';
export const ZAGREB_STATION = 'Zagreb-Maksimir';

interface DhmzCity {
  GradIme?: unknown;
  Lat?: unknown;
  Lon?: unknown;
  Podatci?: {
    Temp?: unknown;
    Vlaga?: unknown;
    Tlak?: unknown;
    VjetarSmjer?: unknown;
    VjetarBrzina?: unknown;
    Vrijeme?: unknown;
  };
}
interface DhmzDocument {
  Hrvatska?: { DatumTermin?: { Datum?: unknown; Termin?: unknown }; Grad?: DhmzCity | DhmzCity[] };
}

function num(value: unknown): number | undefined {
  const cleaned = xmlText(value).replace(/[^0-9.+-]/g, '');
  const parsed = Number(cleaned);
  return cleaned !== '' && Number.isFinite(parsed) ? parsed : undefined;
}

function hr(value: number | undefined): string {
  return value === undefined ? '' : String(value).replace('.', ',');
}

export function parseDhmzNow(xml: string): FeedPayload {
  const doc = parseXml<DhmzDocument>(xml, { arrayPaths: ['Hrvatska.Grad'] });
  const city = xmlArray(doc.Hrvatska?.Grad).find((entry) => xmlText(entry.GradIme) === ZAGREB_STATION);
  if (!city) return { items: [] };

  const [day, month, year] = xmlText(doc.Hrvatska?.DatumTermin?.Datum).split('.').map(Number);
  const term = Number(xmlText(doc.Hrvatska?.DatumTermin?.Termin));
  const at =
    Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) && Number.isFinite(term)
      ? zagrebIso(year, month, day, term)
      : undefined;

  const temp = num(city.Podatci?.Temp);
  const humidity = num(city.Podatci?.Vlaga);
  const pressure = num(city.Podatci?.Tlak);
  const windSpeed = num(city.Podatci?.VjetarBrzina);
  const windDir = xmlText(city.Podatci?.VjetarSmjer) || undefined;
  const weather = xmlText(city.Podatci?.Vrijeme) || undefined;
  const lat = num(city.Lat);
  const lon = num(city.Lon);

  const summary = [
    weather,
    temp === undefined ? '' : `${hr(temp)} °C`,
    humidity === undefined ? '' : `vlaga ${humidity} %`,
    windDir && windSpeed !== undefined ? `vjetar ${windDir} ${hr(windSpeed)} m/s` : '',
  ]
    .filter(Boolean)
    .join(', ');

  return {
    items: [
      {
        id: 'zagreb-maksimir',
        kind: 'observation',
        title: ZAGREB_STATION,
        ...(summary ? { summary } : {}),
        ...(at ? { at } : {}),
        ...(lat !== undefined && lon !== undefined ? { geo: { type: 'Point' as const, coordinates: [lon, lat] } } : {}),
        data: compactData({ temp, humidity, pressure, windDir, windSpeed, weather }),
      },
    ],
    ...(at ? { sourceUpdatedAt: at } : {}),
  };
}

export async function fetchDhmzNow(ctx: FetchContext): Promise<FeedPayload> {
  const response = await ctx.fetch(DHMZ_NOW_URL);
  return parseDhmzNow(await response.text());
}
