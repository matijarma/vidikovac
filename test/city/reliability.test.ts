import {afterEach,describe,expect,it,vi} from 'vitest';
import {createCityStore} from '../../app/src/core/city-store';
import {cachedAirDetail,loadCityLive} from '../../worker/city/live';
import {ageManifest,importReference} from '../../worker/city/catalogue';
import {REFERENCE_SOURCES} from '../../worker/city/sources';
import {emptyCatalogue,type CatalogueManifest,type CatalogueEntry} from '../../shared/city/types';
import type {Env} from '../../worker/env';
const NOW=Date.parse('2026-09-18T12:00:00Z');
const source:CatalogueEntry={id:'culture',name:'Culture',url:'https://example.test',licence:'test',kind:'places',status:'live',count:1,fetchedAt:new Date(NOW).toISOString(),chunks:[{hash:'a'.repeat(64),bytes:10}]};
const manifest:CatalogueManifest={schema:1,version:'test',generatedAt:new Date(NOW).toISOString(),sources:[source]};
const chunk={schema:1,source,data:{...emptyCatalogue(),places:[{id:'culture-a',name:'Gavella',sourceId:'culture',sourceRecord:'a',category:'culture'}]}};
const live={schema:1,bikes:[],air:[],consultations:[],sources:[]};
function environment(){
  const values=new Map<string,string>();
  const FEED={get:vi.fn(async(key:string)=>values.has(key)?JSON.parse(values.get(key)!):null),put:vi.fn(async(key:string,value:string)=>{values.set(key,value);})};
  return {env:{FEED} as unknown as Env,values};
}
afterEach(()=>vi.useRealTimers());
describe('catalogue delivery',()=>{
  it('ages an unattended source using its fetch timestamp, without changing chunk identity',()=>{
    const aged=ageManifest(manifest,NOW+4*86400000);
    expect(aged.sources[0].status).toBe('stale');expect(aged.sources[0].chunks).toEqual(source.chunks);
    expect(manifest.sources[0].status).toBe('live');
  });
  it('a 304 preserves recorded partial coverage and its chunks',async()=>{
    const fetcher=vi.fn(async()=>new Response(null,{status:304}));
    const previous={...source,status:'stale' as const,limited:true,etag:'v1'};
    const result=await importReference(REFERENCE_SOURCES[0],NOW,fetcher as typeof fetch,previous);
    expect(result.entry).toMatchObject({status:'stale',limited:true,chunks:source.chunks});
    expect(result.chunks).toEqual([]);
  });
  it('coalesces chunks, backs off failures, retains the last good source on revision failure',async()=>{
    vi.useFakeTimers({now:NOW});
    let fail=false,revision=false;
    const fetcher=vi.fn(async(url:RequestInfo|URL)=>{
      const path=String(url);
      if(path.endsWith('/manifest'))return Response.json(revision?{...manifest,sources:[{...source,chunks:[{hash:'b'.repeat(64),bytes:10}]}]}:manifest);
      if(path.endsWith('/live'))return Response.json(live);
      if(fail)throw new Error('offline');
      return Response.json(chunk);
    });
    const store=createCityStore(fetcher as typeof fetch);
    await store.start();expect(store.snapshot().places).toHaveLength(1);
    await Promise.all([store.ensure(['culture']),store.ensure(['culture'])]);
    expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/chunks/'))).toHaveLength(1);
    fail=true;revision=true;vi.setSystemTime(NOW+301_000);await store.refresh();
    expect(store.snapshot().places).toHaveLength(1);expect(store.snapshot().errors).toContain('culture');
    const before=fetcher.mock.calls.length;await store.ensure(['culture']);expect(fetcher).toHaveBeenCalledTimes(before);
    store.destroy();
  });
  it('a response that arrives after freezing cannot mutate the snapshot',async()=>{
    let deliver:(response:Response)=>void=()=>{};
    const fetcher=vi.fn(async(url:RequestInfo|URL)=>{
      if(String(url).endsWith('/manifest'))return Response.json(manifest);
      if(String(url).endsWith('/live'))return Response.json(live);
      return new Promise<Response>(resolve=>{deliver=resolve;});
    });
    const store=createCityStore(fetcher as typeof fetch),start=store.start();
    await vi.waitFor(()=>expect(fetcher.mock.calls.some(([u])=>String(u).includes('/chunks/'))).toBe(true));
    store.pause();const before=store.snapshot();deliver(Response.json(chunk));await start;
    expect(store.snapshot()).toBe(before);store.destroy();
  });
});
describe('live source safety',()=>{
  it('coalesces simultaneous source requests and negatively caches outages',async()=>{
    const {env}=environment(),fetcher=vi.fn(async()=>{throw new Error('offline');});
    const [first,second]=await Promise.all([loadCityLive(env,NOW,fetcher as typeof fetch),loadCityLive(env,NOW,fetcher as typeof fetch)]);
    expect(first.sources.every(s=>s.status==='down')).toBe(true);expect(second.sources).toEqual(first.sources);
    const calls=fetcher.mock.calls.length;expect(calls).toBe(5);
    await loadCityLive(env,NOW+10_000,fetcher as typeof fetch);expect(fetcher).toHaveBeenCalledTimes(calls);
  });
  it('filters expired consultations even while the catalogue cache is fresh',async()=>{
    const {env,values}=environment();
    values.set('city-live:v1:consultations',JSON.stringify({expires:NOW+600000,source:{id:'consultations',status:'live'},data:[{id:'old',start:'2026-09-01',end:'2026-09-17'},{id:'open',start:'2026-09-01',end:'2026-09-19'}]}));
    const result=await loadCityLive(env,NOW,(async()=>{throw new Error('offline');}) as typeof fetch);
    expect(result.consultations.map(c=>c.id)).toEqual(['open']);
  });
  it('bounds pollutant calls with positive and negative cache entries',async()=>{
    const {env}=environment(),fetcher=vi.fn(async()=>Response.json([['NO₂',0,1]]));
    expect(await cachedAirDetail(env,'155',NOW,fetcher as typeof fetch)).toEqual([{name:'NO₂',value:0,index:1}]);
    await cachedAirDetail(env,'155',NOW+1,fetcher as typeof fetch);expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockRejectedValue(new Error('offline'));
    await expect(cachedAirDetail(env,'155',NOW+601000,fetcher as typeof fetch)).rejects.toThrow();
    await expect(cachedAirDetail(env,'155',NOW+602000,fetcher as typeof fetch)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
