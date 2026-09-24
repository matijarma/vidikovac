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
describe('chunk backoff',()=>{
  function scripted(statuses:number[],retryAfter?:string){
    const chunkCalls:number[]=[];
    const fetcher=vi.fn(async(url:RequestInfo|URL)=>{
      const path=String(url);
      if(path.endsWith('/manifest'))return Response.json(manifest);
      if(path.endsWith('/live'))return Response.json(live);
      chunkCalls.push(Date.now());
      const status=statuses.shift()??200;
      if(status===200)return Response.json(chunk);
      return new Response('{"error":"rate-limited"}',{status,headers:retryAfter?{'retry-after':retryAfter}:{}});
    });
    return {fetcher,chunkCalls};
  }
  it('retries a rate-limited chunk by itself when Retry-After says, then loads it',async()=>{
    vi.useFakeTimers({now:NOW});
    const {fetcher,chunkCalls}=scripted([429],'30');
    const store=createCityStore(fetcher as typeof fetch);
    await store.start();
    expect(store.snapshot().places).toHaveLength(0);expect(chunkCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(29_000);expect(chunkCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_500);expect(chunkCalls).toHaveLength(2);
    expect(store.snapshot().places).toHaveLength(1);expect(store.snapshot().errors).not.toContain('culture');
    store.destroy();
  });
  it('doubles the wait after each failure and never retries after destroy',async()=>{
    vi.useFakeTimers({now:NOW});
    const {fetcher,chunkCalls}=scripted([503,503,503,503]);
    const store=createCityStore(fetcher as typeof fetch);
    await store.start();
    await vi.advanceTimersByTimeAsync(15_000);expect(chunkCalls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(29_000);expect(chunkCalls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_000);expect(chunkCalls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(60_000);expect(chunkCalls).toHaveLength(4);
    store.destroy();
    await vi.advanceTimersByTimeAsync(600_000);expect(chunkCalls).toHaveLength(4);
  });
  it('keeps the last good places while a revised chunk is rate-limited',async()=>{
    vi.useFakeTimers({now:NOW});
    let revision=false,limited=false;
    const fetcher=vi.fn(async(url:RequestInfo|URL)=>{
      const path=String(url);
      if(path.endsWith('/manifest'))return Response.json(revision?{...manifest,sources:[{...source,chunks:[{hash:'b'.repeat(64),bytes:10}]}]}:manifest);
      if(path.endsWith('/live'))return Response.json(live);
      return limited?new Response('{}',{status:429,headers:{'retry-after':'60'}}):Response.json(chunk);
    });
    const store=createCityStore(fetcher as typeof fetch);
    await store.start();expect(store.snapshot().places).toHaveLength(1);
    revision=true;limited=true;vi.setSystemTime(NOW+301_000);await store.refresh();
    expect(store.snapshot().places).toHaveLength(1);
    limited=false;await vi.advanceTimersByTimeAsync(61_000);
    expect(fetcher.mock.calls.filter(([u])=>String(u).includes('b'.repeat(64)))).toHaveLength(2);
    expect(store.snapshot().places).toHaveLength(1);expect(store.snapshot().errors).not.toContain('culture');
    store.destroy();
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
  // 24 Sep, 03:00: the owner's wall showed a frame full of "0" discs. The feed was real (42 of 200
  // stations empty, the centre emptied overnight), but nothing stopped a feed that says NO station has
  // a bike from reaching the map as two hundred zeros. Such a feed is the feed's fault, not the city's:
  // it is read like one that is too old -- the last good counts served stale, else down -- so every
  // surface (discovery.ts dynamicPlaces) shows the stations as unknown, never as empty.
  it('reads a BAJS feed in which no station has a bike as unknown, never as a city of zeros',async()=>{
    const {env}=environment();
    const info={data:{stations:Array.from({length:40},(_,i)=>({station_id:String(i),name:`Stanica ${i}`,lon:15.97,lat:45.81,capacity:10}))}};
    let bikes=(_i:number)=>0;
    const status=()=>({last_updated:NOW/1000-30,data:{stations:info.data.stations.map((s,i)=>({station_id:s.station_id,num_bikes_available:bikes(i),num_docks_available:10,is_installed:true,is_renting:true,is_returning:true,last_reported:NOW/1000-30}))}});
    const fetcher=vi.fn(async(url:RequestInfo|URL)=>{
      const path=String(url);
      if(path.endsWith('station_information.json'))return Response.json(info);
      if(path.endsWith('station_status.json'))return Response.json(status());
      throw new Error('offline');
    });
    const bajs=(r:Awaited<ReturnType<typeof loadCityLive>>)=>r.sources.find(s=>s.id==='bajs')!;
    // Nothing good to fall back on: down, and no station on the map.
    const first=await loadCityLive(env,NOW,fetcher as typeof fetch);
    expect(bajs(first).status).toBe('down');
    expect(first.bikes).toEqual([]);
    // A real night: a third of the stations empty, the rest with bikes -- live, zeros and all.
    bikes=i=>i%3===0?0:i%5+1;
    const good=await loadCityLive(env,NOW+61_000,fetcher as typeof fetch);
    expect(bajs(good).status).toBe('live');
    expect(good.bikes.filter(b=>b.bikes===0)).toHaveLength(14);
    // The feed then says every station is empty: the last good counts, marked stale.
    bikes=()=>0;
    const bad=await loadCityLive(env,NOW+122_000,fetcher as typeof fetch);
    expect(bajs(bad).status).toBe('stale');
    expect(bad.bikes.some(b=>(b.bikes??0)>0)).toBe(true);
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
