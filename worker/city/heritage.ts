import { cityId, representative } from '../../shared/city/geo';
import { emptyCatalogue, type CatalogueChunk, type Place } from '../../shared/city/types';
import { districtOf } from '../feed/geo/districts';
import { clean } from './normalize';
import type { ReferenceSource } from './sources';
const WFS = 'https://geoportal.kulturnadobra.hr/servisi/grafika/RKD_MK_Javni/wfs';
const TYPES = ['StambenaGradjevina', 'JavnaGradjevina', 'JavSkulpturaUrbOprema', 'SakralnaGradjevina',
  'GradjPromKomInfrastrukture', 'GospodarskaIndustrijskaGradjevina', 'GospodarskaIndustrijskaCjelina',
  'MemorijalnaGradjevina', 'MemorijalnaCjelina', 'VojnaObrambenaGradjevina', 'VojnaObrambenaCjelina',
  'UredjenaZelenaPovrsina', 'UrbanaCjelina', 'RuralnaCjelina', 'KulturniKrajolik', 'KopnenoArhNalazisteZona'];
export async function heritageCatalogue(source: ReferenceSource, fetcher: typeof fetch, now: string): Promise<CatalogueChunk> {
  const response = await fetcher(source.url);
  if (!response.ok) throw new Error('heritage-registry-down');
  const raw = await response.json() as Record<string, unknown>[];
  if (!Array.isArray(raw)) throw new Error('heritage-registry-schema');
  const rows = raw.filter(r => clean(r.Opcina_grad).toLocaleUpperCase('hr') === 'GRAD ZAGREB');
  if (!rows.length) throw new Error('heritage-zagreb-empty');
  const geometry = new Map<string, { polygons: [number, number][][][]; coordinate: [number, number]; id: string }>();
  let failed = 0;
  // A missing geographic category does not erase registry records. Unmatched
  // descriptions remain searchable, explicitly without a map location.
  for (const type of TYPES) {
    try {
      const params = new URLSearchParams({ service: 'WFS', version: '2.0.0', request: 'GetFeature',
        typeNames: `RKD_MK_Javni:${type}`, outputFormat: 'application/json', srsName: 'CRS:84',
        bbox: '15.7,45.5,16.3,46.02,CRS:84', count: '1000' });
      const r = await fetcher(`${WFS}?${params}`);
      if (!r.ok) throw new Error('heritage-geometry-down');
      const json = await r.json() as any;
      if (!Array.isArray(json.features) || Number(json.numberMatched) > json.features.length) throw new Error('heritage-geometry-partial');
      for (const feature of json.features) {
        const key = clean(feature.properties?.kd_reg_br);
        const geo = feature.geometry;
        const polygons = geo?.type === 'MultiPolygon' ? geo.coordinates : geo?.type === 'Polygon' ? [geo.coordinates] : [];
        if (!key || !polygons.length) continue;
        const point = representative(polygons);
        if (point) geometry.set(key, { polygons, coordinate: point, id: clean(feature.properties?.kd_id) });
      }
    } catch { failed++; }
  }
  const data = emptyCatalogue();
  data.places = rows.map(r => {
    const registry = clean(r.Oznaka_dobra);
    const match = geometry.get(registry);
    const p: Place = {
      id: cityId('heritage', registry || r.id), category: 'heritage', name: clean(r.Naziv),
      sourceId: source.id, sourceRecord: registry, address: clean(r.Adresa_smjestaja) || undefined,
      subtype: clean(r.Vrsta_kulturnog_dobra), description: clean(r.Opis_dobra),
      website: 'https://registar.kulturnadobra.hr/',
      facts: { period: clean(r.Vrijeme_nastanka), classification: clean(r.Klasifikacija), registry, access: 'not-established' },
    };
    if (match) {
      p.lon = match.coordinate[0]; p.lat = match.coordinate[1];
      p.polygons = match.polygons; p.district = districtOf(p.lon, p.lat) ?? undefined;
    }
    return p;
  });
  return { schema: 1, data, source: { id: source.id, name: source.name, url: source.catalogue, licence: source.licence,
    status: failed ? 'stale' : 'live', count: data.places.length, fetchedAt: now,
    limited: failed > 0 || data.places.some(p => p.lon === undefined),
    note: 'Geometrija je obuhvat zaštite, ne ulaz; pristup javnosti nije potvrđen.' } };
}
