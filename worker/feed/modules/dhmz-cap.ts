import type { FetchContext, Severity } from '../schema';
import type { FeedPayload, ItemInput } from '../payload';
import { compactData } from '../payload';
import { parseXml, xmlArray, xmlText } from '../xml';
import { isoOrUndefined } from '../time';

// DHMZ publishes one CAP 1.2 document for the whole country, with one <info>
// block per region and per language. Zagreb is EMMA_ID HR002; the areaDesc is a
// second, human-readable way of saying the same thing, so either identifies it.

export const CAP_URL = 'https://meteo.hr/upozorenja/cap_hr_today.xml';
export const ZAGREB_EMMA_ID = 'HR002';
export const ZAGREB_AREA_DESC = 'Zagrebačka regija';

export const CAP_SEVERITY: Record<string, Severity> = {
  Minor: 'minor',
  Moderate: 'moderate',
  Severe: 'severe',
  Extreme: 'extreme',
};

interface CapGeocode {
  valueName?: unknown;
  value?: unknown;
}
interface CapArea {
  areaDesc?: unknown;
  geocode?: CapGeocode | CapGeocode[];
}
interface CapInfo {
  language?: unknown;
  event?: unknown;
  severity?: unknown;
  onset?: unknown;
  expires?: unknown;
  description?: unknown;
  instruction?: unknown;
  area?: CapArea | CapArea[];
}
interface CapDocument {
  alert?: { identifier?: unknown; sent?: unknown; info?: CapInfo | CapInfo[] };
}

const ARRAY_PATHS = ['alert.info', 'alert.info.area', 'alert.info.area.geocode'];

export function parseDhmzCap(xml: string): FeedPayload {
  const alert = parseXml<CapDocument>(xml, { arrayPaths: ARRAY_PATHS }).alert;
  const identifier = xmlText(alert?.identifier) || 'cap';
  const items: ItemInput[] = [];

  for (const info of xmlArray(alert?.info)) {
    const area = zagrebArea(info);
    if (!area) continue;
    const language = xmlText(info.language) || 'hr';
    const summary = [xmlText(info.description), xmlText(info.instruction)]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    items.push({
      id: `${identifier}:${language}`,
      kind: 'warning',
      title: xmlText(info.event),
      ...(summary ? { summary } : {}),
      severity: CAP_SEVERITY[xmlText(info.severity)] ?? 'info',
      ...(isoOrUndefined(xmlText(info.onset)) ? { at: isoOrUndefined(xmlText(info.onset)) } : {}),
      ...(isoOrUndefined(xmlText(info.expires)) ? { until: isoOrUndefined(xmlText(info.expires)) } : {}),
      data: compactData({ language, area: area.areaDesc, emmaId: area.emmaId }),
    });
  }

  return { items, ...(isoOrUndefined(xmlText(alert?.sent)) ? { sourceUpdatedAt: isoOrUndefined(xmlText(alert?.sent)) } : {}) };
}

function zagrebArea(info: CapInfo): { areaDesc: string; emmaId?: string } | null {
  for (const area of xmlArray(info.area)) {
    const areaDesc = xmlText(area.areaDesc);
    const emmaId = xmlArray(area.geocode)
      .filter((code) => xmlText(code.valueName) === 'EMMA_ID')
      .map((code) => xmlText(code.value))
      .find(Boolean);
    if (emmaId === ZAGREB_EMMA_ID || areaDesc.includes(ZAGREB_AREA_DESC)) {
      return emmaId ? { areaDesc, emmaId } : { areaDesc };
    }
  }
  return null;
}

export async function fetchDhmzCap(ctx: FetchContext): Promise<FeedPayload> {
  const response = await ctx.fetch(CAP_URL);
  return parseDhmzCap(await response.text());
}
