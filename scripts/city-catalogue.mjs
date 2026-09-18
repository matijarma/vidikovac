// Build the verified bootstrap using the exact production adapters.
// No production resources are written. Runtime refresh is CatalogueDO's job.
import { createServer } from 'vite';
import { mkdir, writeFile, readFile, readdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'app/public/data/city');
const cache = resolve(root, 'review.local/city-downloads');
await mkdir(`${out}/chunks`, { recursive: true });
await mkdir(cache, { recursive: true });
const loader = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'error',
  cacheDir: resolve(root, 'review.local/city-ssr'), server: { middlewareMode: true, hmr: false, watch: null } });
try {
  const { REFERENCE_SOURCES } = await loader.ssrLoadModule('/worker/city/sources.ts');
  const { importReference, emptyManifest } = await loader.ssrLoadModule('/worker/city/catalogue.ts');
  const { contentHash } = await loader.ssrLoadModule('/worker/city/normalize.ts');
  const selected = process.argv.slice(2).filter(s => !s.startsWith('--'));
  let manifest;
  try { manifest = JSON.parse(await readFile(`${out}/manifest.json`, 'utf8')); } catch { manifest = emptyManifest(); }
  const sourceErrors = [];
  let cityNextAt = 0;
  let sourceFetchedAt=Infinity;
  const cachedFetch = async (url, init) => {
    const key = await contentHash(String(url)), file = `${cache}/${key}`;
    if (!process.argv.includes('--fresh')) {
      try {
        const meta = JSON.parse(await readFile(file + '.json', 'utf8'));
        const captured=Date.parse(meta.downloadedAt);
        if(Number.isFinite(captured))sourceFetchedAt=Math.min(sourceFetchedAt,captured);
        return new Response(await readFile(file), { status: meta.status, headers: meta.headers });
      } catch {}
    }
    if (String(url).includes('data.zagreb.hr') || String(url).includes('data.gov.hr')) {
      await new Promise(r => setTimeout(r, Math.max(0, cityNextAt - Date.now())));
      cityNextAt = Date.now() + 10_100;
    }
    const response = await fetch(url, { ...init, headers: { 'User-Agent': 'Kajima/1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)' }, signal: AbortSignal.timeout(60_000) });
    const body = new Uint8Array(await response.arrayBuffer());
    if (response.ok) {
      const downloadedAt=new Date().toISOString();
      sourceFetchedAt=Math.min(sourceFetchedAt,Date.parse(downloadedAt));
      await writeFile(file, body);
      await writeFile(file + '.json', JSON.stringify({ url: String(url), status: response.status, headers: Object.fromEntries(response.headers), downloadedAt }));
    }
    return new Response(body, { status: response.status, headers: response.headers });
  };
  for (const source of REFERENCE_SOURCES.filter(s => !selected.length || selected.includes(s.id))) {
    sourceFetchedAt=Infinity;
    console.log(`Importing ${source.id}`);
    try {
      const { entry, chunks } = await importReference(source, Date.now(), cachedFetch);
      // Rebuilding a schedule advances its derived horizon, not the date of
      // the last upstream download. Replaying a cache must not renew source age.
      if(Number.isFinite(sourceFetchedAt)){
        entry.fetchedAt=new Date(sourceFetchedAt).toISOString();
        for(const chunk of chunks.filter(c=>!c.part)){
          const decoded=JSON.parse(chunk.body);decoded.source.fetchedAt=entry.fetchedAt;
          chunk.body=JSON.stringify(decoded);chunk.hash=await contentHash(chunk.body);
        }
        entry.chunks=chunks.map(c=>({hash:c.hash,bytes:Buffer.byteLength(c.body),...(c.part?{part:c.part}:{})}));
      }
      for (const chunk of chunks) await writeFile(`${out}/chunks/${chunk.hash}.json`, chunk.body);
      const i = manifest.sources.findIndex(s => s.id === source.id);
      if (i < 0) manifest.sources.push(entry); else manifest.sources[i] = entry;
      console.log(`${source.id}: ${entry.count} records, ${chunks.length} chunks, ${entry.status}`);
    } catch (e) {
      sourceErrors.push({ id: source.id, error: String(e) });
      console.error(`${source.id}: ${e.message}`);
      const old=manifest.sources.find(s=>s.id===source.id);
      if(old)old.status=old.chunks.length?'stale':'down';
    }
    manifest.generatedAt = new Date().toISOString();
    manifest.version = await contentHash(JSON.stringify(manifest.sources));
    await writeFile(`${out}/manifest.json`, JSON.stringify(manifest));
  }
  await writeFile(resolve(root, 'review.local/city-import.json'), JSON.stringify({ manifest, sourceErrors }, null, 2));
  if(process.argv.includes('--prune')){
    const active=new Set(manifest.sources.flatMap(s=>s.chunks.map(c=>c.hash+'.json')));
    for(const name of await readdir(`${out}/chunks`))if(/^[a-f0-9]{64}\.json$/.test(name)&&!active.has(name))await unlink(`${out}/chunks/${name}`);
  }
  if (sourceErrors.length) process.exitCode = 1;
} finally { await loader.close(); }
