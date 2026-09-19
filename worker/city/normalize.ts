import { cityId, representative } from '../../shared/city/geo';
import { emptyCatalogue, type CatalogueChunk, type CatalogueData, type Place } from '../../shared/city/types';
import type { ReferenceSource } from './sources';
import { districtOf } from '../feed/geo/districts';

type Row = Record<string, unknown>;
export const clean = (value: unknown): string => String(value ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
export function urlOf(value: unknown): string | undefined {
  const text = clean(value);
  if (!text) return undefined;
  try {
    const u = new URL(text.startsWith('www.') ? 'https://' + text : text);
    return ['https:', 'http:'].includes(u.protocol) ? u.href : undefined;
  } catch { return undefined; }
}
const get = (r: Row, ...keys: string[]) => keys.map(k => clean(r[k])).find(Boolean) ?? '';
const dateOf = (v: unknown): string | undefined => {
  if (typeof v === 'number' && v > 0) return new Date(v).toISOString();
  const m = clean(v).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : undefined;
};
export function csvRows(text: string, separator = ';'): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { if (quoted && s[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && (c === separator || c === '\n' || c === '\r')) {
      row.push(cell); cell = '';
      if (c !== separator) { if (row.some(Boolean)) rows.push(row); row = []; if (c === '\r' && s[i + 1] === '\n') i++; }
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function polygonsOf(geo: any): [number, number][][][] {
  const polygons = geo?.type === 'Polygon' ? [geo.coordinates] : geo?.type === 'MultiPolygon' ? geo.coordinates : [];
  if (!Array.isArray(polygons)) return [];
  return polygons.filter((p: any) => Array.isArray(p) && p.every((r: any) => Array.isArray(r) && r.length >= 4 && r.every((q: any) =>
    Array.isArray(q) && q.length >= 2 && Number.isFinite(q[0]) && Number.isFinite(q[1]) && Math.abs(q[0]) <= 180 && Math.abs(q[1]) <= 90)));
}
/** Whitelist public-facing attributes. Never emit utility IDs or staff names. */
const FACTS: Record<string, string> = {
  naplata: 'payment', status_odrz: 'maintenance', tip_zdenca: 'type', Vrsta: 'type',
  VRSTA: 'type', Vrsta_objekta: 'sport', BROJ_UTICNICA: 'sockets', TIP_UTICNICE: 'connector',
  kapacitet: 'capacity', invalidska_mj: 'designated-accessible-spaces', punionica_za_EV: 'charging-points',
  broj_stalaka: 'racks', broj_bicikala: 'capacity', PAPIR: 'paper', PLASTIKA: 'plastic', STAKLO: 'glass',
  METALNA_AM: 'metal', STARE_BATE: 'batteries', BIOOTPAD: 'biowaste', OTPAD_GUME: 'tyres', ELEK_OTPAD: 'electronics',
};
export function normalizeReference(source: ReferenceSource, body: string, fetchedAt: string, updatedAt?: string): CatalogueChunk {
  const data = emptyCatalogue();
  let total = 0;
  if (source.format === 'streets') {
    const [headers, ...rows] = csvRows(body);
    if (!headers?.includes('Opis_značenja_imena_ulice') || !headers.includes('UL_JID')) throw new Error('streets-schema');
    total = rows.length;
    for (const row of rows) {
      const r = Object.fromEntries(headers.map((key, i) => [key, row[i] ?? '']));
      if (!r.UL_JID || !r.UL_IME || !r.Opis_značenja_imena_ulice?.trim()) continue;
      data.streets.push({ id: r.UL_JID, name: r.UL_IME, settlement: r.NA_IME, settlementId: r.NA_MB, description: r.Opis_značenja_imena_ulice.trim(), updatedAt: dateOf(r.datum_a) });
    }
  } else {
    const json = JSON.parse(body);
    if (json.type !== 'FeatureCollection' || !Array.isArray(json.features) || json.exceededTransferLimit) throw new Error('catalogue-geojson-incomplete');
    total = json.features.length;
    for (const feature of json.features) {
      const p: Row = feature.properties ?? {};
      const sourceRecord = get(p, 'OBJECTID', 'OBJECTID_1', 'objectid', 'FID', 'UL_JID', 'NA_MB') || clean(feature.id);
      if (!sourceRecord) continue;
      const polygons = polygonsOf(feature.geometry);
      if (source.format === 'settlements') {
        const id = get(p, 'NA_MB', 'MB', 'NAS_MB', 'MATICNI_BR', 'maticni_broj'), name = get(p, 'NA_IME', 'IME', 'NAZIV', 'naziv');
        if (id && name && polygons.length) data.settlements.push({ id: String(Number(id)), name, polygons });
        continue;
      }
      if (source.kind === 'paths') {
        const lines = feature.geometry?.type === 'MultiLineString' ? feature.geometry.coordinates : feature.geometry?.type === 'LineString' ? [feature.geometry.coordinates] : [];
        if (lines.length) data.paths.push({ id: cityId(source.id, sourceRecord), name: get(p, 'lokacija'), kind: 'cycle', lines, surface: get(p, 'zavrsni_sloj'), sourceId: source.id });
        continue;
      }
      const position = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : representative(polygons);
      const name = get(p, 'naziv', 'NAZIV', 'naziv_obj', 'lokacija', 'Lokacija', 'NAZIV_PUNI', 'adresa', 'ADRESA', 'ADRESA_LOK')
        || (source.id==='dogs'?'Površina za pse':source.id==='cycle-parking'?'Parkiralište za bicikle':'');
      if (!name) continue;
      const place: Place = {
        id: cityId(source.id, sourceRecord), name, category: source.category!, sourceId: source.id, sourceRecord,
        address: get(p, 'adresa', 'ADRESA', 'ADRESA_LOK', 'lokacija', 'Lokacija') || undefined,
        subtype: get(p, 'ustanove', 'VRSTA', 'Vrsta', 'Vrsta_objekta', 'tip_zdenca') || undefined,
        website: urlOf(p.web ?? p.WEB),
        phone: get(p, 'telefon', 'TELEFON') || undefined,
        hours: get(p, 'radno_vrijeme', 'RADNO_VRIJ') || undefined,
        updatedAt: dateOf(p.editdate ?? p.last_edited_date) ?? updatedAt,
      };
      if (position && Number.isFinite(position[0]) && Number.isFinite(position[1]) && position[0] > 15 && position[0] < 17 && position[1] > 45 && position[1] < 47) {
        place.lon = position[0]; place.lat = position[1];
        place.district = districtOf(place.lon!, place.lat!) ?? undefined;
      }
      const facts: NonNullable<Place['facts']> = {};
      for (const [field, key] of Object.entries(FACTS)) {
        const value = p[field];
        if (value !== null && value !== undefined && value !== '') facts[key] = typeof value === 'number' || typeof value === 'boolean' ? value : clean(value);
      }
      if (source.id === 'drinking-water') facts['water-type'] = 'pitka voda, prema registru';
      if (Object.keys(facts).length) place.facts = facts;
      data.places.push(place);
    }
  }
  const count = data.places.length + data.streets.length + data.paths.length + data.settlements.length;
  if (total > 0 && count === 0) throw new Error('catalogue-unreadable');
  // Missing street descriptions are a genuine documented coverage limit.
  return { schema: 1, source: { id: source.id, name: source.name, url: source.catalogue, licence: source.licence, status: 'live', count, fetchedAt, updatedAt, limited: count < total }, data };
}
/** Bounded fragments keep details lazy and R2 objects manageable. */
export function splitCatalogue(chunk: CatalogueChunk, maxBytes = 180_000): CatalogueChunk[] {
  const result: CatalogueChunk[] = [];
  let data = emptyCatalogue(), size = 0;
  for (const key of ['places', 'streets', 'paths', 'settlements'] as const) {
    for (const row of chunk.data[key]) {
      const bytes = JSON.stringify(row).length * 2;
      if (size > 0 && size + bytes > maxBytes) { result.push({ ...chunk, data }); data = emptyCatalogue(); size = 0; }
      (data[key] as unknown[]).push(row); size += bytes;
    }
  }
  result.push({ ...chunk, data });
  return result;
}
export async function contentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
