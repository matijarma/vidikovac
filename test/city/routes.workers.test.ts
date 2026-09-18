import {createExecutionContext,env} from 'cloudflare:test';
import {describe,expect,it} from 'vitest';
import type {Env} from '../../worker/env';
import {handleCity} from '../../worker/routes/city';
import {CITY_PREFIX,MANIFEST_KEY} from '../../worker/city/catalogue';
import {stopShard} from '../../worker/city/schedules';
const testEnv=env as unknown as Env;
async function call(path:string,method='GET',allow=true){
  const url=new URL('https://city.test'+path),request=new Request(url,{method});
  return handleCity(request,{...testEnv,RL_OPEN:{limit:async()=>({success:allow})}} as Env,createExecutionContext(),url);
}
describe('public UI catalogue routes',()=>{
  it('enforces read-only, bounded IDs and the public limiter',async()=>{
    expect((await call('/api/city/manifest','POST'))?.status).toBe(405);
    expect((await call('/api/city/manifest','GET',false))?.status).toBe(429);
    expect((await call('/api/city/chunks/not-a-hash'))?.status).toBe(404);
    expect((await call('/api/city/air?station=../private'))?.status).toBe(400);
    expect((await call('/api/city/departures?operator=other&stop=1'))?.status).toBe(400);
    expect(await call('/api/other')).toBeNull();
  });
  it('serves atomic R2 manifests and scheduled shards without treating them as ETA',async()=>{
    const now=Date.now(),hash='a'.repeat(64),time=new Date(now).toISOString(),day=time.slice(0,10);
    await testEnv.MAPS!.put(MANIFEST_KEY,JSON.stringify({schema:1,version:'test',generatedAt:time,sources:[{id:'hz-schedule',name:'HŽ',status:'stale',count:1,kind:'schedules',chunks:[{hash,bytes:100,part:stopShard('a')}]}]}));
    await testEnv.MAPS!.put(`${CITY_PREFIX}chunks/${hash}.json`,JSON.stringify({schema:1,operator:'hz',generatedAt:time,days:[day],validUntil:new Date(now+86400000).toISOString(),stops:{a:{name:'Zagreb',lon:15.97,lat:45.81,runs:[]}}}));
    const manifest=await call('/api/city/manifest');expect((await manifest!.json() as {version:string}).version).toBe('test');
    const chunk=await call(`/api/city/chunks/${hash}.json`);expect(chunk?.headers.get('cache-control')).toContain('immutable');
    const board=await call('/api/city/departures?operator=hz&stop=a');
    expect(await board!.json()).toMatchObject({operator:'hz',stopName:'Zagreb',status:'stale',departures:[]});
  });
});
