import { XMLParser } from 'fast-xml-parser';
import type { Env } from '../env';
import type { AirStation, BikeStation, CityLive, CitySource, Consultation } from '../../shared/city/types';
import { LIVE_SOURCES } from './sources';
import { clean, urlOf } from './normalize';
const GBFS = 'https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_hd/hr/';
const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const bool = (v: unknown) => v === true || v === 1;
const isoSeconds = (v: unknown): string | undefined => typeof v === 'number' && v > 0 ? new Date(v * 1000).toISOString() : undefined;
async function json(url: string, fetcher: typeof fetch): Promise<any> {
  const r = await fetcher(url);
  if (!r.ok) throw new Error(`city-source-http-${r.status}`);
  return r.json();
}
export function parseBikes(info: any, status: any): BikeStation[] {
  if (!Array.isArray(info?.data?.stations) || !Array.isArray(status?.data?.stations)) throw new Error('gbfs-schema');
  const statuses = new Map<string, any>(status.data.stations.map((s: any) => [String(s.station_id), s]));
  return info.data.stations.flatMap((s: any) => {
    if (typeof s.name !== 'string' || !Number.isFinite(s.lon) || !Number.isFinite(s.lat) || s.lon < 15.5 || s.lon > 16.5 || s.lat < 45.5 || s.lat > 46.1) return [];
    const state = statuses.get(String(s.station_id));
    return [{ id: String(s.station_id), name: clean(s.name), lon: s.lon, lat: s.lat,
      bikes: number(state?.num_bikes_available), docks: number(state?.num_docks_available), capacity: number(s.capacity),
      installed: bool(state?.is_installed), renting: bool(state?.is_renting), returning: bool(state?.is_returning),
      observedAt: isoSeconds(state?.last_reported), rentalUrl: urlOf(s.rental_uris?.web)??LIVE_SOURCES.bikes.url } satisfies BikeStation];
  });
}
/** A BAJS feed at least this long in which not one station has a bike is the
 *  feed's fault, not the city's: Zagreb's two hundred stations hold some 1,800
 *  bikes, and even at 03:00, with the centre emptied overnight, three in four
 *  stations have one (24 Sep: 158 of 200). Below it, a few empty stations may
 *  be the truth. */
export const BIKES_DEGENERATE_MIN_STATIONS = 10;
/** True when `stations` says nothing about the city: long enough to be the
 *  network, and no station with a bike. loadCityLive reads such a feed like
 *  one that is too old (the last good counts served stale, else down), so the
 *  map shows unknown stations, never two hundred zeros. */
export function bikesDegenerate(stations: readonly BikeStation[]): boolean {
  return stations.length >= BIKES_DEGENERATE_MIN_STATIONS && !stations.some(s => (s.bikes ?? 0) > 0);
}
export function parseAir(rows: any): AirStation[] {
  if (!Array.isArray(rows)) throw new Error('air-schema');
  return rows.filter(s => /^GZ/.test(String(s.kod)) || /^RH010[123]$|^RH0133$/.test(String(s.kod))).flatMap(s => {
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return [];
    return [{ id: String(s.id), name: clean(s.naziv), lon: s.y, lat: s.x,
      index: Number.isInteger(s.indeks) && s.indeks >= 1 && s.indeks <= 6 ? s.indeks : null,
      observedAt: typeof s.vrijeme === 'number' && s.vrijeme > 0 ? new Date(s.vrijeme).toISOString() : undefined } satisfies AirStation];
  });
}
export function parseConsultations(rows: any, now: string): Consultation[] {
  if (!Array.isArray(rows)) throw new Error('consultations-schema');
  const day = now.slice(0, 10);
  return rows.filter(r => r.statusSavjetovanja === 'Otvoren' && r.pocetakSavjetovanja <= day && r.zavrsetakSavjetovanja >= day)
    .map(r => ({ id: String(r.id), title: clean(r.nazivSavjetovanja), institution: clean(r.nazivTijela),
      status: 'Otvoren', start: r.pocetakSavjetovanja, end: r.zavrsetakSavjetovanja,
      url: `https://esavjetovanja.gov.hr/ECon/MainScreen?entityId=${encodeURIComponent(String(r.id))}` }));
}
type SourceKey = keyof typeof LIVE_SOURCES;
type Cached = { source: CitySource; data: unknown; expires: number };
const TTL: Record<SourceKey, number> = { bikes: 60, air: 3600, river: 3600, consultations: 43_200 };
const MAX_AGE: Record<SourceKey, number> = { bikes: 300, air: 21_600, river: 172_800, consultations: 2_592_000 };
const inflight=new WeakMap<object,Map<string,Promise<Cached>>>();
export async function loadCityLive(env: Env, now = Date.now(), fetcher: typeof fetch = fetch): Promise<CityLive> {
  const timed: typeof fetch = (input, init) => fetcher(input, { ...init,
    headers: { 'User-Agent': 'Kajima/1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)', ...init?.headers },
    signal: AbortSignal.timeout(12_000) });
  const response: CityLive = { schema: 1, generatedAt: new Date(now).toISOString(), sources: [], bikes: [], air: [], consultations: [] };
  async function loadSource(key: SourceKey): Promise<Cached> {
    const base = LIVE_SOURCES[key], kv = `city-live:v1:${key}`;
    const previous = await env.FEED.get<Cached>(kv, 'json');
    if (previous && previous.expires > now) return previous;
    let data: unknown;
    try {
      if (key === 'bikes') {
        const [info,status] = await Promise.all([json(GBFS + 'station_information.json', timed),json(GBFS + 'station_status.json', timed)]);
        if (!Number.isFinite(status.last_updated) || status.last_updated*1000>now+30_000 || now - status.last_updated * 1000 > MAX_AGE.bikes * 1000) throw new Error('bajs-old');
        data = parseBikes(info, status);
        if (bikesDegenerate(data as BikeStation[])) throw new Error('bajs-degenerate');
      } else if (key === 'air') {
        const rows = await json('https://iszz.azo.hr/iskzl/rs/eaqi/indeks?h=3', timed);
        const stations = parseAir(rows);
        // Pollutant values are on demand, not twelve extra calls per overview.
        data = stations;
      } else if (key === 'river') {
        const r = await timed('https://hidro.hr/hidro_bilten.xml');
        if (!r.ok) throw new Error('river-down');
        const p = new XMLParser().parse(await r.text()).hidro_bilten;
        const m = clean(p?.datum_upisa).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
        if (!p?.sava || !m) throw new Error('river-schema');
        const publishedAt = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
        if (now - Date.parse(publishedAt) > MAX_AGE.river * 1000) throw new Error('river-old');
        data = { text: clean(p.sava), publishedAt, period: clean(p.period_prognoze) };
      } else {
        data = parseConsultations(await json('https://data.gov.hr/ckan/dataset/3df5d8d8-e2b2-4608-8a3e-f27c95b2f643/resource/6476f525-7468-4ded-8381-1e60b2eb0365/download/data.json', timed), response.generatedAt);
      }
      const source: CitySource = { ...base, status: 'live', count: Array.isArray(data) ? data.length : 1, fetchedAt: response.generatedAt };
      if(key==='bikes'||key==='air'){
        const times=(data as (BikeStation|AirStation)[]).flatMap(s=>s.observedAt?[Date.parse(s.observedAt)]:[]).filter(t=>Number.isFinite(t)&&t<=now+30_000);
        if(times.length)source.updatedAt=new Date(Math.max(...times)).toISOString();
        if(!times.length||now-Math.max(...times)>MAX_AGE[key]*1000)source.status='stale';
      }
      if(key==='river')source.updatedAt=(data as NonNullable<CityLive['river']>).publishedAt;
      const cached = { source, data, expires: now + TTL[key] * 1000 };
      await env.FEED.put(kv, JSON.stringify(cached), { expirationTtl: MAX_AGE[key] });
      return cached;
    } catch {
      const cached:Cached=previous?.source.fetchedAt && now-Date.parse(previous.source.fetchedAt)<=MAX_AGE[key]*1000
        ? {...previous,expires:now+60_000,source:{...previous.source,status:'stale'}}
        : {source:{...base,status:'down',count:0},data:key==='river'?undefined:[],expires:now+60_000};
      await env.FEED.put(kv,JSON.stringify(cached),{expirationTtl:Math.max(60,MAX_AGE[key])});
      return cached;
    }
  }
  function load(key:SourceKey):Promise<Cached>{
    let pending=inflight.get(env.FEED);
    if(!pending){pending=new Map();inflight.set(env.FEED,pending);}
    const previous=pending.get(key);if(previous)return previous;
    const task=loadSource(key).finally(()=>pending!.delete(key));pending.set(key,task);return task;
  }
  for (const [key, cached] of await Promise.all((Object.keys(LIVE_SOURCES) as SourceKey[]).map(async key => [key, await load(key)] as const))) {
    response.sources.push(cached.source);
    if (key === 'bikes') response.bikes = cached.data as BikeStation[];
    if (key === 'air') response.air = cached.data as AirStation[];
    if (key === 'river') response.river = cached.data as CityLive['river'];
    if (key === 'consultations') response.consultations = (cached.data as Consultation[]).filter(c=>c.start<=response.generatedAt.slice(0,10)&&c.end>=response.generatedAt.slice(0,10));
  }
  return response;
}
export async function cachedAirDetail(env:Env,id:string,now=Date.now(),fetcher:typeof fetch=fetch):Promise<AirStation['pollutants']>{
  if(!/^\d{1,5}$/.test(id))throw new Error('invalid-station');
  const key=`city-air:v1:${id}`;
  const cached=await env.FEED.get<{pollutants?:AirStation['pollutants'];expires:number}>(key,'json');
  if(cached&&cached.expires>now){
    if(!cached.pollutants)throw new Error('air-unavailable');
    return cached.pollutants;
  }
  try{
    const pollutants=await airDetail(id,fetcher);
    await env.FEED.put(key,JSON.stringify({pollutants,expires:now+600_000}),{expirationTtl:600});
    return pollutants;
  }catch(error){
    await env.FEED.put(key,JSON.stringify({expires:now+60_000}),{expirationTtl:60});
    throw error;
  }
}
export async function airDetail(id: string, fetcher: typeof fetch = fetch): Promise<AirStation['pollutants']> {
  if (!/^\d{1,5}$/.test(id)) throw new Error('invalid-station');
  const timed:typeof fetch=(u,init)=>fetcher(u,{...init,signal:AbortSignal.timeout(12_000)});
  const rows = await json(`https://iszz.azo.hr/iskzl/rs/eaqi/tvari?p=${id}&h=3`, timed);
  if (!Array.isArray(rows)) throw new Error('air-pollutants-schema');
  return rows.filter(r => Array.isArray(r) && typeof r[0] === 'string').map(r => ({ name: clean(r[0]), value: number(r[1]), index: number(r[2]) }));
}
