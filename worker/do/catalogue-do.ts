import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import { CITY_PREFIX, importReference, MANIFEST_KEY, readManifest } from '../city/catalogue';
import { contentHash } from '../city/normalize';
import { REFERENCE_SOURCES } from '../city/sources';
import type {ReferenceSource} from '../city/sources';
import type {CatalogueEntry} from '../../shared/city/types';
export class CatalogueDO extends DurableObject<Env> {
  private running = false;
  private importSource(source:ReferenceSource,now:number,previous?:CatalogueEntry){
    return importReference(source,now,undefined,previous);
  }
  async ensureRunning(): Promise<void> {
    if (await this.ctx.storage.getAlarm() === null) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }
  async alarm(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let nextAlarm=Date.now()+60_000;
    try {
      if (!this.env.MAPS) return;
      const now = Date.now();
      const attempts = await this.ctx.storage.get<Record<string, number>>('attempts') ?? {};
      const source = REFERENCE_SOURCES.find(s => now - (attempts[s.id] ?? 0) >= 86_400_000);
      if (!source) {
        nextAlarm=Math.max(now+60_000,Math.min(...REFERENCE_SOURCES.map(s=>(attempts[s.id]??now)+86_400_000)));
        return;
      }
      const manifest = await readManifest(this.env);
      attempts[source.id] = now;
      await this.ctx.storage.put('attempts', attempts);
      const index = manifest.sources.findIndex(s => s.id === source.id);
      try {
        const imported = await this.importSource(source, now,index>=0?manifest.sources[index]:undefined);
        for (const chunk of imported.chunks) await this.env.MAPS.put(`${CITY_PREFIX}chunks/${chunk.hash}.json`, chunk.body,
          { httpMetadata: { contentType: 'application/json', cacheControl: 'public, max-age=31536000, immutable' } });
        if (index < 0) manifest.sources.push(imported.entry);
        else {
          const old=manifest.sources[index];
          // Do not replace a good located heritage snapshot by a partially
          // failed geographic fetch. Keep the last complete snapshot visible.
          if(imported.entry.status==='stale'&&old.status==='live'&&old.chunks.length)manifest.sources[index]={...old,status:'stale'};
          else manifest.sources[index] = imported.entry;
          const retired=await this.ctx.storage.get<{at:number;hash:string}[]>('retired')??[];
          const nextHashes=new Set(manifest.sources[index].chunks.map(c=>c.hash));
          retired.push(...old.chunks.filter(c=>!nextHashes.has(c.hash)).map(c=>({at:now,hash:c.hash})));
          await this.ctx.storage.put('retired',retired);
        }
      } catch {
        if (index >= 0) manifest.sources[index] = { ...manifest.sources[index],
          status: manifest.sources[index].chunks.length ? 'stale' : 'down' };
        // Failed sources retry hourly; a failure never blocks every other source.
        attempts[source.id] = now - 23 * 3_600_000;
        await this.ctx.storage.put('attempts', attempts);
      }
      manifest.generatedAt = new Date(now).toISOString();
      manifest.version = await contentHash(JSON.stringify(manifest.sources));
      await this.env.MAPS.put(MANIFEST_KEY, JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json' } });
      const retired=await this.ctx.storage.get<{at:number;hash:string}[]>('retired')??[];
      const active=new Set(manifest.sources.flatMap(s=>s.chunks.map(c=>c.hash)));
      const expired=retired.filter(r=>now-r.at>7*86_400_000&&!active.has(r.hash)).slice(0,100);
      for(const r of expired)await this.env.MAPS.delete(`${CITY_PREFIX}chunks/${r.hash}.json`);
      const removed=new Set(expired.map(r=>r.hash));
      await this.ctx.storage.put('retired',retired.filter(r=>!removed.has(r.hash)));
    } finally {
      this.running = false;
      await this.ctx.storage.setAlarm(Math.max(Date.now()+1000,nextAlarm));
    }
  }
}
export function catalogueStub(env: Env): DurableObjectStub<CatalogueDO> | null {
  const ns = env.CATALOGUE_DO as DurableObjectNamespace<CatalogueDO> | undefined;
  return ns ? ns.get(ns.idFromName('city-catalogue-v1')) : null;
}
