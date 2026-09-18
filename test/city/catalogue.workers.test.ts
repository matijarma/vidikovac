import {env,runInDurableObject} from 'cloudflare:test';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {Env} from '../../worker/env';
import {catalogueStub} from '../../worker/do/catalogue-do';
import {CITY_PREFIX,MANIFEST_KEY,emptyManifest,importReference} from '../../worker/city/catalogue';
import {REFERENCE_SOURCES,type ReferenceSource} from '../../worker/city/sources';
import type {CatalogueManifest,CatalogueEntry} from '../../shared/city/types';
const testEnv=env as unknown as Env;
afterEach(()=>vi.restoreAllMocks());
describe('catalogue promotion and retention',()=>{
  it('publishes chunks before the manifest, keeps old sessions, and preserves a good snapshot on failure',async()=>{
    const source=REFERENCE_SOURCES[0],url=new URL(source.url),now=Date.now(),oldHash='b'.repeat(64);
    const manifest=emptyManifest(now);
    manifest.sources[0]={...manifest.sources[0],status:'live',chunks:[{hash:oldHash,bytes:3}],count:1,fetchedAt:new Date(now).toISOString()};
    await testEnv.MAPS!.put(MANIFEST_KEY,JSON.stringify(manifest));
    await testEnv.MAPS!.put(`${CITY_PREFIX}chunks/${oldHash}.json`,'old');
    const stub=catalogueStub(testEnv)!;
    const due=async()=>runInDurableObject(stub,async(_,state)=>{
      await state.storage.put('attempts',Object.fromEntries(REFERENCE_SOURCES.map(s=>[s.id,s.id===source.id?0:Date.now()])));
    });
    const responses:{body:string|null;status:number;headers?:Record<string,string>}[]=[{status:200,body:JSON.stringify({type:'FeatureCollection',features:[{id:1,geometry:{type:'Point',coordinates:[15.97,45.81]},properties:{naziv:'Gavella'}}]}),headers:{etag:'v1'}}];
    let importFailure:string|undefined;
    const fetcher=vi.fn(async(input:RequestInfo|URL)=>{
      expect(String(input)).toBe(url.href);
      const response=responses.shift();if(!response)throw new Error('unexpected-source-request');
      // Streams must be constructed in the DO request that consumes them.
      return new Response(response.body,{status:response.status,headers:response.headers});
    });
    await runInDurableObject(stub,instance=>{
      const importer=instance as unknown as {importSource(source:ReferenceSource,now:number,previous?:CatalogueEntry):ReturnType<typeof importReference>};
      vi.spyOn(importer,'importSource').mockImplementation(async(source,now,previous)=>{
        try{return await importReference(source,now,fetcher as typeof fetch,previous);}
        catch(error){importFailure=String(error);throw error;}
      });
    });
    await due();await runInDurableObject(stub,instance=>instance.alarm());
    expect(importFailure).toBeUndefined();
    const current=await (await testEnv.MAPS!.get(MANIFEST_KEY))!.json<CatalogueManifest>();
    const hash=current.sources[0].chunks[0].hash;
    expect(hash).not.toBe(oldHash);expect(current.sources[0].status).toBe('live');
    expect(await testEnv.MAPS!.get(`${CITY_PREFIX}chunks/${hash}.json`)).not.toBeNull();
    expect(await testEnv.MAPS!.get(`${CITY_PREFIX}chunks/${oldHash}.json`)).not.toBeNull();
    responses.push({body:'unavailable',status:503});
    await due();await runInDurableObject(stub,instance=>instance.alarm());
    const stale=await (await testEnv.MAPS!.get(MANIFEST_KEY))!.json<CatalogueManifest>();
    expect(stale.sources[0]).toMatchObject({status:'stale',chunks:current.sources[0].chunks});
    await runInDurableObject(stub,async(_,state)=>{
      await state.storage.put('retired',[{at:now-8*86400000,hash:oldHash},{at:now-8*86400000,hash}]);
    });
    responses.push({body:null,status:304});
    await due();await runInDurableObject(stub,instance=>instance.alarm());
    expect(await testEnv.MAPS!.get(`${CITY_PREFIX}chunks/${oldHash}.json`)).toBeNull();
    expect(await testEnv.MAPS!.get(`${CITY_PREFIX}chunks/${hash}.json`)).not.toBeNull();
  });
});
