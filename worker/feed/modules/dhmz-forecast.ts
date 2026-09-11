import type { FetchContext } from '../schema';
import type { FeedPayload } from '../payload';
import { compactData } from '../payload';
import { parseXml, xmlArray, xmlText } from '../xml';
import { zagrebIso } from '../time';

// prognoza_danas.xml holds one <station> per forecast region plus a Zagreb row,
// with the city narrative in the section-level param `zg_text`. The date is
// `ddmmyy`; the forecast covers the whole Zagreb calendar day.

export const DHMZ_FORECAST_URL = 'https://prognoza.hr/prognoza_danas.xml';
export const ZAGREB_FORECAST_STATION = 'Zagreb';

interface VwParam {
  '@_name'?: unknown;
  '@_value'?: unknown;
}
interface VwStation {
  '@_name'?: unknown;
  '@_lon'?: unknown;
  '@_lat'?: unknown;
  param?: VwParam | VwParam[];
}
interface VwDocument {
  VW?: { section?: { param?: VwParam | VwParam[]; station?: VwStation | VwStation[] } };
}

const ARRAY_PATHS = ['VW.section.station', 'VW.section.station.param', 'VW.section.param'];

function paramValue(params: VwParam | VwParam[] | undefined, name: string): string {
  const found = xmlArray(params).find((param) => xmlText(param['@_name']) === name);
  return found ? xmlText(found['@_value']) : '';
}

function num(value: string): number | undefined {
  const parsed = Number(value);
  return value !== '' && Number.isFinite(parsed) ? parsed : undefined;
}

export function parseDhmzForecast(xml: string): FeedPayload {
  const section = parseXml<VwDocument>(xml, { arrayPaths: ARRAY_PATHS }).VW?.section;
  const station = xmlArray(section?.station).find(
    (entry) => xmlText(entry['@_name']) === ZAGREB_FORECAST_STATION,
  );
  if (!station) return { items: [] };

  const datum = paramValue(section?.param, 'datum'); // ddmmyy
  const day = Number(datum.slice(0, 2));
  const month = Number(datum.slice(2, 4));
  const year = 2000 + Number(datum.slice(4, 6));
  const valid = Number.isFinite(day) && Number.isFinite(month) && Number.isFinite(year) && datum.length === 6;
  const at = valid ? zagrebIso(year, month, day) : undefined;
  const until = valid ? zagrebIso(year, month, day + 1) : undefined;
  const isoDay = valid
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : 'danas';

  const lat = num(xmlText(station['@_lat']));
  const lon = num(xmlText(station['@_lon']));
  const summary = paramValue(section?.param, 'zg_text');

  return {
    items: [
      {
        id: `zagreb:${isoDay}`,
        kind: 'forecast',
        title: 'Prognoza za Zagreb',
        ...(summary ? { summary } : {}),
        ...(at ? { at } : {}),
        ...(until ? { until } : {}),
        ...(lat !== undefined && lon !== undefined ? { geo: { type: 'Point' as const, coordinates: [lon, lat] } } : {}),
        data: compactData({
          minC: num(paramValue(station.param, 'Tmn')),
          maxC: num(paramValue(station.param, 'Tmx')),
          weatherCode: paramValue(station.param, 'vrijeme') || undefined,
          windCode: paramValue(station.param, 'wind') || undefined,
        }),
      },
    ],
    ...(at ? { sourceUpdatedAt: at } : {}),
  };
}

export async function fetchDhmzForecast(ctx: FetchContext): Promise<FeedPayload> {
  const response = await ctx.fetch(DHMZ_FORECAST_URL);
  return parseDhmzForecast(await response.text());
}
