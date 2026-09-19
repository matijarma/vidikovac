import type { CatalogueChunk, CatalogueEntry, CatalogueManifest } from '../../shared/city/types';
import { emptyCatalogue } from '../../shared/city/types';
import type { Env } from '../env';
import { contentHash, normalizeReference, splitCatalogue } from './normalize';
import { heritageCatalogue } from './heritage';
import { REFERENCE_SOURCES, type ReferenceSource } from './sources';
import { buildSchedule } from './schedules';
export const CITY_PREFIX = 'city/v1/';
export const MANIFEST_KEY = CITY_PREFIX + 'manifest.json';
export const catalogueFetch: typeof fetch = (input, init) => fetch(input, { ...init,
  headers: { 'User-Agent': 'Kajima/1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)', ...init?.headers },
  signal: AbortSignal.timeout(60_000) });
export function emptyManifest(now = Date.now()): CatalogueManifest {
  return { schema: 1, version: 'empty', generatedAt: new Date(now).toISOString(),
    sources: REFERENCE_SOURCES.map(s => ({ id: s.id, name: s.name, url: s.catalogue, licence: s.licence, kind: s.kind, status: 'down', count: 0, chunks: [] })) };
}
export function ageManifest(data:CatalogueManifest,now=Date.now()):CatalogueManifest {
  return {...data,sources:data.sources.map(source=>{
    const age=now-Date.parse(source.fetchedAt??data.generatedAt);
    return source.status==='live'&&(!Number.isFinite(age)||age>3*86_400_000)?{...source,status:'stale' as const}:source;
  })};
}
export async function readManifest(env: Env): Promise<CatalogueManifest> {
  const r = await env.MAPS?.get(MANIFEST_KEY);
  if (r) return ageManifest(await r.json<CatalogueManifest>());
  // Build-time verified bootstrap: local development and the first production
  // boot work before the background importer has promoted its first version.
  const fallback = await env.ASSETS.fetch(new Request('https://catalogue.internal/data/city/manifest.json')).catch(() => null);
  if (fallback?.ok) {
    const data = await fallback.json() as CatalogueManifest;
    if (data.schema === 1 && Array.isArray(data.sources)) return ageManifest(data);
  }
  return emptyManifest();
}
export async function importReference(source: ReferenceSource, now: number, fetcher = catalogueFetch, previous?:CatalogueEntry): Promise<{ chunks: { body: string; hash: string; part?: string }[]; entry: CatalogueEntry }> {
  const time = new Date(now).toISOString();
  let chunk: CatalogueChunk;
  const chunks: { body: string; hash: string; part?: string }[] = [];
  let etag:string|undefined,lastModified:string|undefined;
  const conditional = async () => {
    const headers:Record<string,string>={};
    // Timetables are rebuilt as the rolling horizon advances even when the
    // upstream archive is unchanged. Reference inventories can reuse 304s.
    if(source.format!=='gtfs'){
      if(previous?.etag)headers['If-None-Match']=previous.etag;
      else if(previous?.lastModified)headers['If-Modified-Since']=previous.lastModified;
    }
    const r=await fetcher(source.url,{headers});
    etag=r.headers.get('etag')??previous?.etag;
    lastModified=r.headers.get('last-modified')??previous?.lastModified;
    return r;
  };
  if (source.format === 'gtfs') {
    const response = await conditional();
    if (!response.ok) throw new Error('gtfs-http-' + response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const schedule = await buildSchedule(bytes, source.id === 'zet-schedule' ? 'zet' : 'hz', now);
    const stopCount=schedule.parts.reduce((n,p)=>n+Object.keys(p.stops).length,0);
    for (let i = 0; i < schedule.parts.length; i++) {
      const body = JSON.stringify(schedule.parts[i]);
      chunks.push({ body, hash: await contentHash(body), part: String(i).padStart(2, '0') });
      // A serialized shard no longer needs its object graph. Do not retain
      // both the entire decoded timetable and every output string.
      schedule.parts[i].stops={};
    }
    chunk = { schema: 1, data: { ...emptyCatalogue(), places: schedule.places },
      source: { id: source.id, name: source.name, url: source.catalogue, licence: source.licence, count: stopCount,
        status: 'live', fetchedAt: time, updatedAt: response.headers.get('last-modified') ?? undefined } };
  } else if (source.format === 'heritage') chunk = await heritageCatalogue(source, fetcher, time);
  else {
    const response = await conditional();
    if(response.status===304&&previous)return {chunks:[],entry:{...previous,status:previous.limited&&previous.status==='stale'?'stale':'live',fetchedAt:time}};
    if (!response.ok) throw new Error('catalogue-http-' + response.status);
    chunk = normalizeReference(source, await response.text(), time, response.headers.get('last-modified') ?? undefined);
  }
  for (const piece of splitCatalogue(chunk)) {
    const body = JSON.stringify(piece);
    chunks.push({ body, hash: await contentHash(body) });
  }
  return { chunks, entry: { ...chunk.source, kind: source.kind,etag,lastModified,
    chunks: chunks.map(c => ({ hash: c.hash, bytes: new TextEncoder().encode(c.body).length, ...(c.part ? { part: c.part } : {}) })) } };
}
