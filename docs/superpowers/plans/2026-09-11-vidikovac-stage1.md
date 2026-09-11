# Vidikovac Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the stage-1 prototype of Vidikovac on zagreb.aningfilm.hr by 15 September 2026: a presence-unlocked, ten-minute, real-time dashboard of Zagreb on open data with rotating-QR public screens, an always-open safety tier, identifier-free counters, and the grant documents for the 16 September filing.

**Architecture:** One Cloudflare Worker (`worker/index.ts` dispatcher) serves a vite-built multi-page app from static assets and answers `/api/*`, `/ws/*`, `/hitno`, `/open/*` and `/stats` itself. Four SQLite Durable Objects carry the mechanic: `BeaconDO` per public screen mints batches of rotating codes, `RoomDO` per session holds both devices' WebSockets and the expiry alarm chain, `IndexDO` resolves codes, `MetricsDO` keeps `(day, hour, event, dim1, dim2) -> count`. A feed layer normalises nine open sources into one `ModuleSnapshot` shape with Cache API TTLs and a KV last-good copy, so panels are always live, honestly stale, or down, never blank. The browser app has three surfaces from one codebase: phone (`/s`, `/d`), kiosk (`/kiosk`) and desktop.

**Tech Stack:** TypeScript strict, Cloudflare Workers with static assets, Durable Objects (SQLite, WebSocket hibernation, alarms), KV, Rate Limiting bindings, vite multi-page build, vitest (`unit` project) and `@cloudflare/vitest-pool-workers` (`workers` project), Playwright two-context e2e, `gtfs-realtime-bindings`, `fast-xml-parser`, `uqr`, MapLibre GL, Remotion for the demo video. Deploy is `git push` to `main` (Workers Builds); never `wrangler deploy`.

**Spec:** `docs/superpowers/specs/2026-09-11-vidikovac-design.md` (approved 11 Sept 2026; the plan argues from it). Contracts every task must use verbatim: `worker/feed/schema.ts` (ModuleId, Tier, FeedItem, ModuleSnapshot, ModuleSpec, FetchContext) and `worker/protocol.ts` (CODE_ALPHABET, CODE_LENGTH, CODES_PER_BATCH, CODE_EARLY_MS, CODE_GRACE_MS, CodeSlot, ScanRequest, ScanOk, ScanFail, ScanError, Beacon and Room message unions, CLOSE_SESSION_EXPIRED, LayerId, LAYERS, ClientEvent, ServerEvent).

## Global Constraints

- Repository `D:\scratch\vidikovac`, GitHub `matijarma/vidikovac`, branch `main` is production; every push deploys. Commit after every green task.
- Node >= 22 (local 25), npm with `package-lock.json`, wrangler 4, TypeScript strict, `"type": "module"`.
- Worker config is `wrangler.jsonc`: assets `app/dist` with `run_worker_first` for `/api/*`, `/ws/*`, `/hitno`, `/hitno/*`, `/open/*`, `/stats`, `/stats/*`; DO bindings `BEACON_DO`, `ROOM_DO`, `INDEX_DO`, `METRICS_DO` (migration `v1`); KV `FEED` (id `8cb66336f0424a8ea1246bfc6a4ae29b`); rate limiters `RL_SCAN` 10/60 s, `RL_DATA` 240/60 s, `RL_OPEN` 120/60 s; cron `*/5 * * * *`; custom domain `zagreb.aningfilm.hr`; `keep_vars: true`.
- Runtime values come from `worker/config.ts`: `sessionMinutes(env)` default 10, `peerMinutes(env)` default 5, `codeRotateSeconds(env)` default 30, `networkCheck(env)` in `enforce | warn | off` default `enforce`. Secrets `SESSION_SECRET` and `NET_KEY_SECRET` are set with `wrangler secret put`, never committed; `.dev.vars` (ignored) holds dev values, `.dev.vars.example` documents them.
- File ownership for parallel work: Area A `worker/feed/**` (not `schema.ts`), `worker/routes/feed.ts`, `test/feed/**`; Area B `worker/pairing/**`, `worker/do/**`, `worker/routes/pairing.ts`, `worker/routes/admin.ts`, `worker/metrics.ts`, `worker/metrics-do.ts`, `test/pairing/**`; Area C `app/**`, `vite.config.ts`, `app/tsconfig.json`; Area D `worker/routes/open.ts`, `worker/routes/stats.ts`, `worker/hitno/**`, `worker/open/**`, `worker/stats/**`, `worker/security-headers.ts`, `app/public/_headers`, `test/open/**`; Area E `e2e/**`, `playwright.config.ts`, `docs/**`, `scripts/**`, `README.md`, `video/**`. `worker/index.ts` is the dispatcher already in place: it calls `handleFeed`, `handlePairing`, `handleAdmin`, `handleOpen`, `handleStats` (each `(request, env, ctx, url) => Promise<Response | null>`), falls back to `env.ASSETS.fetch`, and `scheduled()` calls `warmFeeds(env, ctx)` from `worker/feed/cache.ts`.
- Cross-area interfaces: `verifyDataToken(env: Env, token: string): Promise<{ roomId: string; expiresAt: number } | null>` in `worker/pairing/tokens.ts` (Area B, consumed by A); `getModules(env: Env, ctx: ExecutionContext, ids: ModuleId[]): Promise<ModuleSnapshot[]>` and `getModule(env, ctx, id)` in `worker/feed/cache.ts` (Area A, consumed by D); `recordMetric(env: Env, event: ServerEvent, dim1?: string, dim2?: string): void` in `worker/metrics.ts` (Area B, consumed by D); `verifyAccess(env: Env, request: Request): Promise<boolean>` in `worker/pairing/access.ts` (Area B, consumed by D), honouring `E2E_ADMIN_BYPASS` only when `networkCheck(env) === 'off'`.
- Every upstream fetch sends `User-Agent: Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)` and times out at 6 s. Attribution strings are the ones in the spec, section "3. Privacy, counting, licences, WCAG", rendered in every panel footer, on `/izvori`, on the kiosk teaser and in every export.
- Privacy: no cookies, no IP or user agent stored, `netKey` only in the kiosk socket attachment, counters only from closed vocabularies. Croatian-first copy with singular imperatives (Skeniraj, Kopiraj, Podijeli), never "Vi". WCAG 2.2 AA except the declared time-limit deviation.
- Licence AGPL-3.0-or-later; ported psdlat files keep their headers.

---


## Area D: Open tier, derived data, operator stats, security headers

400}D`;
  if (seconds % 3600 === 0) return `PT${seconds / 3600}H`;
  if (seconds % 60 === 0) return `PT${seconds / 60}M`;
  return `PT${seconds}S`;
}

export interface CatalogDistribution {
  '@type': 'dcat:Distribution';
  'dcat:accessURL': string;
  'dcat:downloadURL': string;
  'dct:format': string;
  'dcat:mediaType': string;
  'dct:license': string;
  'dct:description': string;
}

export interface CatalogDataset {
  '@type': 'dcat:Dataset';
  '@id': string;
  'dct:identifier': string;
  'dct:title': string;
  'dct:description': string;
  'dcat:keyword': string[];
  'dct:accrualPeriodicity': string;
  'dct:license': string;
  'dct:source': string;
  'dct:provenance': string;
  'dct:language': 'hr';
  'dcat:distribution': CatalogDistribution[];
}

export interface CatalogDocument {
  '@context': Record<string, string>;
  '@type': 'dcat:Catalog';
  '@id': string;
  'dct:title': string;
  'dct:description': string;
  'dct:publisher': { '@type': 'foaf:Agent'; 'foaf:name': string; 'foaf:homepage': string };
  'dct:license': string;
  'dct:language': 'hr';
  'dct:issued': string;
  'dct:modified': string;
  'dcat:dataset': CatalogDataset[];
}

export function buildCatalog(origin: string, issued: Date): CatalogDocument {
  const iso = issued.toISOString();
  return {
    '@context': {
      dcat: 'http://www.w3.org/ns/dcat#',
      dct: 'http://purl.org/dc/terms/',
      foaf: 'http://xmlns.com/foaf/0.1/',
    },
    '@type': 'dcat:Catalog',
    '@id': `${origin}/open/catalog.json`,
    'dct:title': 'Vidikovac – izvedeni otvoreni podaci o Zagrebu',
    'dct:description':
      'Normalizirani, strojno čitljivi prikazi otvorenih izvora koje nadzorna ploča Vidikovac koristi u stvarnom vremenu. ' +
      'Svaki skup nosi izvornu atribuciju i oznaku prilagodbe. Objavljeno pod Otvorenom dozvolom. ' +
      'Grad Zagreb može svaki skup preuzeti i ponovno objaviti na data.zagreb.hr bez daljnjeg odobrenja; ovaj katalog je dovoljna poveznica.',
    'dct:publisher': { '@type': 'foaf:Agent', 'foaf:name': PUBLISHER.name, 'foaf:homepage': origin },
    'dct:license': OPEN_LICENCE.url,
    'dct:language': 'hr',
    'dct:issued': iso,
    'dct:modified': iso,
    'dcat:dataset': OPEN_DATASETS.map((d) => ({
      '@type': 'dcat:Dataset',
      '@id': `${origin}/open/${d.module}`,
      'dct:identifier': d.module,
      'dct:title': d.title,
      'dct:description': d.description,
      'dcat:keyword': [...d.keywords],
      'dct:accrualPeriodicity': isoDuration(d.ttl),
      'dct:license': OPEN_LICENCE.url,
      'dct:source': d.source.url,
      'dct:provenance': `${d.source.text} (${d.source.licence})`,
      'dct:language': 'hr',
      'dcat:distribution': d.distributions.map((x) => ({
        '@type': 'dcat:Distribution',
        'dcat:accessURL': `${origin}${x.path}`,
        'dcat:downloadURL': `${origin}${x.path}`,
        'dct:format': x.format,
        'dcat:mediaType': x.mediaType,
        'dct:license': OPEN_LICENCE.url,
        'dct:description': x.description,
      })),
    })),
  };
}
```

- [ ] **Step 4: Run the catalog tests, then commit**

`npx vitest run --project unit test/open/catalog.test.ts test/open/catalog-registry.test.ts`
Expected: `catalog.test.ts` 4 passed; `catalog-registry.test.ts` 2 passed once Area A's `worker/feed/registry.ts` exists (before that: `Failed to load url ../../worker/feed/registry`, which is the expected state of a parallel build, not a defect in this task).

```
git add worker/open/catalog.ts test/open/catalog.test.ts test/open/catalog-registry.test.ts
git commit -m "/open catalogue: DCAT-AP-like JSON-LD with Otvorena dozvola, per-module attribution and republishing offer"
```

- [ ] **Step 5: Write the failing GeoJSON test**

`D:\scratch\vidikovac\test\open\geojson.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { closuresToGeoJson } from '../../worker/open/geojson';

const SNAPSHOT: ModuleSnapshot = {
  module: 'prometnice',
  tier: 'open',
  status: 'live',
  fetchedAt: '2026-09-11T08:00:00Z',
  sourceUpdatedAt: '2026-09-11T07:57:00Z',
  attribution: {
    text: "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup 'prometnice'",
    url: 'https://data.zagreb.hr/dataset/prometnice',
    licence: 'Otvorena dozvola',
  },
  items: [
    {
      id: 'c1',
      module: 'prometnice',
      kind: 'closure',
      tier: 'open',
      title: 'Grada Vukovara',
      summary: 'Zatvoreno zbog radova, jedan smjer',
      at: '2026-04-18T07:00:00+00:00',
      until: '2026-09-11T22:00:00+00:00',
      geo: { type: 'LineString', coordinates: [[15.9599, 45.7994], [15.9590, 45.7993]] },
      data: { type: 'ROAD_CLOSED', subtype: 'ROAD_CLOSED_CONSTRUCTION', direction: 'ONE_DIRECTION', adapted: false },
    },
    {
      id: 'c2',
      module: 'prometnice',
      kind: 'closure',
      tier: 'open',
      title: 'Bez geometrije',
    },
    {
      id: 'x',
      module: 'prometnice',
      kind: 'poi',
      tier: 'open',
      title: 'Nije zatvaranje',
      geo: { type: 'Point', coordinates: [15.9, 45.8] },
    },
  ],
};

describe('closuresToGeoJson', () => {
  const fc = closuresToGeoJson(SNAPSHOT, 'https://zagreb.aningfilm.hr');

  it('emits one Feature per closure that has a geometry', () => {
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.type).toBe('Feature');
    expect(f.id).toBe('c1');
    expect(f.geometry).toEqual({ type: 'LineString', coordinates: [[15.9599, 45.7994], [15.9590, 45.7993]] });
  });

  it('marks every feature and the collection as adapted, with the attribution', () => {
    const p = fc.features[0].properties;
    expect(p.adapted).toBe(true); // the item's own `adapted: false` extra does not win
    expect(p.title).toBe('Grada Vukovara');
    expect(p.summary).toBe('Zatvoreno zbog radova, jedan smjer');
    expect(p.from).toBe('2026-04-18T07:00:00+00:00');
    expect(p.until).toBe('2026-09-11T22:00:00+00:00');
    expect(p.direction).toBe('ONE_DIRECTION');
    expect(fc.adapted).toBe(true);
    expect(fc.adaptedBy).toBe('Vidikovac, https://zagreb.aningfilm.hr');
    expect(fc.attribution).toBe(SNAPSHOT.attribution.text);
    expect(fc.licence).toBe('Otvorena dozvola');
    expect(fc.source).toBe('https://data.zagreb.hr/dataset/prometnice');
    expect(fc.fetchedAt).toBe('2026-09-11T08:00:00Z');
    expect(fc.sourceUpdatedAt).toBe('2026-09-11T07:57:00Z');
    expect(fc.status).toBe('live');
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

`npx vitest run --project unit test/open/geojson.test.ts`
Expected: fails with `Failed to load url ../../worker/open/geojson`.

- [ ] **Step 7: Write the GeoJSON module**

`D:\scratch\vidikovac\worker\open\geojson.ts`:

```ts
// /open/prometnice.geojson: the closures snapshot as a GeoJSON
// FeatureCollection. The Otvorena dozvola requires adaptations to be marked,
// so the collection and every feature carry `adapted: true` and the source
// attribution rides along as top-level foreign members (RFC 7946 §6.1).
import type { FeedItem, Geo, ModuleSnapshot } from '../feed/schema';

export interface ClosureFeature {
  type: 'Feature';
  id: string;
  geometry: Geo;
  properties: Record<string, string | number | boolean | null>;
}

export interface ClosuresGeoJson {
  type: 'FeatureCollection';
  features: ClosureFeature[];
  attribution: string;
  licence: string;
  source: string;
  adapted: true;
  adaptedBy: string;
  fetchedAt: string;
  sourceUpdatedAt: string | null;
  status: ModuleSnapshot['status'];
}

function toFeature(item: FeedItem, geo: Geo): ClosureFeature {
  return {
    type: 'Feature',
    id: item.id,
    geometry: { type: geo.type, coordinates: geo.coordinates },
    properties: {
      // Source-specific extras first (type, subtype, direction...); the named
      // keys below always win, so `adapted` cannot be overridden by a feed.
      ...(item.data ?? {}),
      id: item.id,
      title: item.title,
      summary: item.summary ?? null,
      severity: item.severity ?? null,
      from: item.at ?? null,
      until: item.until ?? null,
      module: item.module,
      adapted: true,
    },
  };
}

export function closuresToGeoJson(snapshot: ModuleSnapshot, origin: string): ClosuresGeoJson {
  const features: ClosureFeature[] = [];
  for (const item of snapshot.items) {
    if (item.kind !== 'closure' || item.geo === undefined) continue;
    features.push(toFeature(item, item.geo));
  }
  return {
    type: 'FeatureCollection',
    features,
    attribution: snapshot.attribution.text,
    licence: snapshot.attribution.licence,
    source: snapshot.attribution.url,
    adapted: true,
    adaptedBy: `Vidikovac, ${origin}`,
    fetchedAt: snapshot.fetchedAt,
    sourceUpdatedAt: snapshot.sourceUpdatedAt ?? null,
    status: snapshot.status,
  };
}
```

- [ ] **Step 8: Run the GeoJSON test, then commit**

`npx vitest run --project unit test/open/geojson.test.ts`
Expected: 2 passed.

```
git add worker/open/geojson.ts test/open/geojson.test.ts
git commit -m "/open/prometnice.geojson: closures as an adapted, attributed FeatureCollection"
```

- [ ] **Step 9: Write the failing /open route test**

`D:\scratch\vidikovac\test\open\open-routes.workers.test.ts`:

```ts
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../worker/env';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { handleOpen } from '../../worker/routes/open';

const baseEnv = env as unknown as Env;
const admitAll: Env['RL_OPEN'] = { limit: async () => ({ success: true }) };
const denyAll: Env['RL_OPEN'] = { limit: async () => ({ success: false }) };

function snapshot(module: ModuleId, tier: ModuleSnapshot['tier'] = 'open'): ModuleSnapshot {
  return {
    module,
    tier,
    status: 'live',
    fetchedAt: '2026-09-11T08:00:00Z',
    attribution: { text: `Izvor: ${module}`, url: `https://example.test/${module}`, licence: 'Otvorena dozvola' },
    items:
      module === 'prometnice'
        ? [
            {
              id: 'c1',
              module,
              kind: 'closure',
              tier,
              title: 'Ilica',
              geo: { type: 'LineString', coordinates: [[15.97, 45.81], [15.96, 45.81]] },
            },
          ]
        : [],
  };
}

function fake(...snapshots: ModuleSnapshot[]) {
  const calls: ModuleId[][] = [];
  const getModules = async (_e: Env, _c: ExecutionContext, ids: ModuleId[]) => {
    calls.push(ids);
    return snapshots.filter((s) => ids.includes(s.module));
  };
  return { getModules, calls };
}

async function call(host: string, path: string, deps: Parameters<typeof handleOpen>[4], rl = admitAll, init: RequestInit = {}) {
  const request = new Request(`https://${host}${path}`, init);
  const ctx = createExecutionContext();
  const response = await handleOpen(request, { ...baseEnv, RL_OPEN: rl }, ctx, new URL(request.url), deps);
  await waitOnExecutionContext(ctx);
  return response!;
}

describe('/open/*', () => {
  it('serves catalog.json as JSON-LD with CORS and an hour at the edge', async () => {
    const { getModules, calls } = fake();
    const response = await call('open-cat.test', '/open/catalog.json', { getModules });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=3600');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await response.json()) as { '@type': string; '@id': string; 'dcat:dataset': unknown[] };
    expect(body['@type']).toBe('dcat:Catalog');
    expect(body['@id']).toBe('https://open-cat.test/open/catalog.json');
    expect(body['dcat:dataset']).toHaveLength(4);
    expect(calls).toHaveLength(0);
  });

  it('serves an open-tier module snapshot with s-maxage equal to its ttl', async () => {
    const { getModules, calls } = fake(snapshot('dhmz-cap'));
    const response = await call('open-cap.test', '/open/dhmz-cap.json', { getModules });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=300');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await response.json()) as ModuleSnapshot;
    expect(body.module).toBe('dhmz-cap');
    expect(body.attribution.text).toBe('Izvor: dhmz-cap');
    expect(calls).toEqual([['dhmz-cap']]);
  });

  it('404s a module that is not in the catalogue without touching the feed', async () => {
    const { getModules, calls } = fake(snapshot('zet-rt', 'session'));
    const response = await call('open-zet.test', '/open/zet-rt.json', { getModules });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not-found' });
    expect(calls).toHaveLength(0);
  });

  it('404s when the registry says the module is session-tier after all', async () => {
    const { getModules } = fake(snapshot('emsc', 'session'));
    const response = await call('open-tier.test', '/open/emsc.json', { getModules });
    expect(response.status).toBe(404);
  });

  it('serves closures as GeoJSON with the prometnice ttl', async () => {
    const { getModules } = fake(snapshot('prometnice'));
    const response = await call('open-geo.test', '/open/prometnice.geojson', { getModules });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/geo+json; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=180');
    const body = (await response.json()) as { type: string; features: unknown[]; adapted: boolean };
    expect(body.type).toBe('FeatureCollection');
    expect(body.features).toHaveLength(1);
    expect(body.adapted).toBe(true);
  });

  it('caches a module snapshot at the edge for the ttl', async () => {
    const first = fake(snapshot('emsc'));
    await call('open-cache.test', '/open/emsc.json', { getModules: first.getModules });
    const second = fake(snapshot('emsc'));
    const response = await call('open-cache.test', '/open/emsc.json', { getModules: second.getModules });
    expect(response.status).toBe(200);
    expect(second.calls).toHaveLength(0);
  });

  it('rate-limits by IP with a JSON 429', async () => {
    const { getModules, calls } = fake(snapshot('emsc'));
    const response = await call('open-429.test', '/open/emsc.json', { getModules }, denyAll);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    await expect(response.json()).resolves.toEqual({
      error: 'rate-limited',
      message: 'Previše zahtjeva. Pokušaj ponovno za minutu.',
    });
    expect(calls).toHaveLength(0);
  });

  it('404s unknown paths under /open/ and 405s non-GET', async () => {
    const { getModules } = fake();
    expect((await call('open-404.test', '/open/nesto', { getModules })).status).toBe(404);
    expect((await call('open-404.test', '/open/../etc', { getModules })).status).toBe(404);
    const post = await call('open-405.test', '/open/catalog.json', { getModules }, admitAll, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });
});
```

- [ ] **Step 10: Run it and watch it fail**

`npx vitest run --project workers test/open/open-routes.workers.test.ts`
Expected: every test fails with `TypeError: Cannot read properties of null (reading 'status')` because `handleOpen` still returns null for `/open/*`.

- [ ] **Step 11: Write the /open route and wire it**

`D:\scratch\vidikovac\worker\open\route.ts`:

```ts
// GET /open/*: catalog.json, <module>.json for open-tier modules,
// prometnice.geojson, and (Task D5) the /open/ index page. Same discipline as
// /hitno: method gate, RL_OPEN by IP, edge cache keyed on the path, then work.
import type { Env } from '../env';
import { getModules } from '../feed/cache';
import type { ModuleId, ModuleSnapshot } from '../feed/schema';
import { CATALOG_TTL_SECONDS, buildCatalog, findOpenDataset } from './catalog';
import { closuresToGeoJson } from './geojson';
import { cacheControl, edgeCached, jsonResponse, openRateLimited } from './http';

export interface OpenDeps {
  getModules?: (env: Env, ctx: ExecutionContext, ids: ModuleId[]) => Promise<ModuleSnapshot[]>;
  now?: () => Date;
}

const MODULE_JSON = /^\/open\/([a-z][a-z0-9-]*)\.json$/;

const CORS = { 'access-control-allow-origin': '*' } as const;

function notFound(): Response {
  return jsonResponse({ error: 'not-found' }, 404, CORS);
}

function data(body: string, contentType: string, ttl: number): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': cacheControl(ttl),
      ...CORS,
    },
  });
}

export async function handleOpenData(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  deps: OpenDeps = {},
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse({ error: 'method-not-allowed' }, 405, { allow: 'GET, HEAD', ...CORS });
  }
  if (await openRateLimited(env, 'open', request)) {
    return jsonResponse(
      { error: 'rate-limited', message: 'Previše zahtjeva. Pokušaj ponovno za minutu.' },
      429,
      { 'retry-after': '60', ...CORS },
    );
  }

  const load = deps.getModules ?? getModules;
  const now = deps.now ?? (() => new Date());
  const path = url.pathname;
  const cacheKey = new Request(`${url.origin}${path}`, { method: 'GET' });

  let produced: { response: Response } | null = null;

  if (path === '/open/catalog.json') {
    produced = await edgeCached(ctx, cacheKey, async () =>
      data(JSON.stringify(buildCatalog(url.origin, now()), null, 2), 'application/json; charset=utf-8', CATALOG_TTL_SECONDS),
    );
  } else if (path === '/open/prometnice.geojson') {
    const dataset = findOpenDataset('prometnice');
    if (dataset === undefined) return notFound();
    produced = await edgeCached(ctx, cacheKey, async () => {
      const [snapshot] = await load(env, ctx, ['prometnice']);
      if (snapshot === undefined || snapshot.tier !== 'open') return notFound();
      return data(JSON.stringify(closuresToGeoJson(snapshot, url.origin)), 'application/geo+json; charset=utf-8', dataset.ttl);
    });
  } else {
    const match = MODULE_JSON.exec(path);
    if (match !== null) {
      const dataset = findOpenDataset(match[1]);
      if (dataset === undefined) return notFound();
      produced = await edgeCached(ctx, cacheKey, async () => {
        const [snapshot] = await load(env, ctx, [dataset.module]);
        if (snapshot === undefined || snapshot.tier !== 'open') return notFound();
        return data(JSON.stringify(snapshot), 'application/json; charset=utf-8', dataset.ttl);
      });
    }
  }

  if (produced === null) return notFound();
  if (request.method === 'HEAD') return new Response(null, produced.response);
  return produced.response;
}
```

`D:\scratch\vidikovac\worker\routes\open.ts` (full file):

```ts
import type { Env } from '../env';
import { handleHitno, type HitnoDeps } from '../hitno/route';
import { handleOpenData, type OpenDeps } from '../open/route';

export type OpenRouteDeps = HitnoDeps & OpenDeps;

/**
 * Open-tier dispatcher: /hitno and /open/*. Returns null for any other path
 * so worker/index.ts moves on to the next handler and finally to the asset
 * store. The optional fifth argument is a test seam only; the dispatcher
 * calls it with four.
 */
export async function handleOpen(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  deps: OpenRouteDeps = {},
): Promise<Response | null> {
  if (url.pathname === '/hitno' || url.pathname === '/hitno/') {
    return handleHitno(request, env, ctx, url, deps);
  }
  if (url.pathname === '/open' || url.pathname.startsWith('/open/')) {
    return handleOpenData(request, env, ctx, url, deps);
  }
  return null;
}
```

- [ ] **Step 12: Run the route test and the typecheck, then commit**

`npx vitest run --project workers test/open/open-routes.workers.test.ts`
Expected: 8 passed.
`npx tsc --noEmit -p worker/tsconfig.json`
Expected: no output.

```
git add worker/open/route.ts worker/routes/open.ts test/open/open-routes.workers.test.ts
git commit -m "/open/*: catalog.json, open-tier module snapshots and prometnice.geojson, edge-cached per ttl, CORS, RL_OPEN"
```

---

### Task D3: Access-gated `/stats` with CSV exports

**Files:**
- Create: `D:\scratch\vidikovac\worker\stats\export.ts`, `D:\scratch\vidikovac\worker\stats\page.ts`
- Modify: `D:\scratch\vidikovac\worker\routes\stats.ts` (replace the stub)
- Test: `D:\scratch\vidikovac\test\open\stats-export.test.ts`, `D:\scratch\vidikovac\test\open\stats-page.test.ts`, `D:\scratch\vidikovac\test\open\stats.workers.test.ts`

**Interfaces:**
- Consumes: Area B `verifyAccess(env: Env, request: Request): Promise<boolean>` from `worker/pairing/access.ts` (fail-closed, false when `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` are unset); Area B `METRICS_DO_NAME: string`, `MetricsDO` with `query(sinceDay: string): MetricsDailyRow[]`, and `MetricsDailyRow = { day: string; hour: number; event: string; dim1: string; dim2: string; count: number }` from `worker/metrics-do.ts` (psdlat's row plus the `hour` column the plan adds; `day` is the Europe/Zagreb day); `ServerEvent`, `ClientEvent` names from `worker/protocol.ts`; from D1 `escapeHtml`, `zagrebDay`, `jsonResponse`.
- Produces: `RAW_COLUMNS`, `CITY_COLUMNS`, `CITY_EXCLUDED_EVENTS`, `CITY_MIN_CELL = 10`, `CITY_ROUND_TO = 5`, `OSTALO = 'ostalo'`, `csvField(value): string`, `toCsv(columns, rows): string`, `rawCsv(rows): string`, `cityRows(rows): CityRow[]`, `cityCsv(rows): string` (`worker/stats/export.ts`); `MAX_DAYS = 365`, `DEFAULT_DAYS = 30`, `DAY_MS`, `StatsView`, `renderStatsPage(view: StatsView): string` (`worker/stats/page.ts`); `handleStats(request, env, ctx, url, deps?: StatsDeps): Promise<Response | null>`, `StatsDeps { verify?; loadRows?; now? }`, `STATS_PATHS` (`worker/routes/stats.ts`).

- [ ] **Step 1: Write the failing export test**

`D:\scratch\vidikovac\test\open\stats-export.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MetricsDailyRow } from '../../worker/metrics-do';
import {
  CITY_COLUMNS,
  RAW_COLUMNS,
  cityCsv,
  cityRows,
  csvField,
  rawCsv,
} from '../../worker/stats/export';

const row = (hour: number, event: string, dim1: string, dim2: string, count: number, day = '2026-09-10'): MetricsDailyRow => ({
  day,
  hour,
  event,
  dim1,
  dim2,
  count,
});

const ROWS: MetricsDailyRow[] = [
  row(10, 'session_start', 'kiosk', 'donji-grad', 23),
  row(10, 'session_start', 'kiosk', 'tresnjevka', 4),
  row(10, 'session_start', 'phone', '', 3),
  row(11, 'session_start', 'phone', '', 6),
  row(12, 'over_cap', '', '', 50),
  row(12, 'source_fetch', 'zet-rt', 'ok', 120),
  row(12, 'hitno_view', 'page', '', 12),
  row(13, 'scan_fail', 'code-expired', '', 2),
];

describe('CSV primitives', () => {
  it('quotes fields with commas, quotes or line breaks and doubles inner quotes', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField(42)).toBe('42');
  });

  it('writes the raw export with CRLF line endings and the documented header', () => {
    const csv = rawCsv(ROWS.slice(0, 2));
    expect([...RAW_COLUMNS]).toEqual(['day', 'hour', 'event', 'dim1', 'dim2', 'count']);
    expect(csv).toBe(
      'day,hour,event,dim1,dim2,count\r\n' +
        '2026-09-10,10,session_start,kiosk,donji-grad,23\r\n' +
        '2026-09-10,10,session_start,kiosk,tresnjevka,4\r\n',
    );
  });
});

describe('City variant (grad.csv)', () => {
  it('drops over_cap and source_fetch, folds cells under 10 into ostalo, rounds to 5', () => {
    const out = cityRows(ROWS);
    expect(out).toEqual([
      { month: '2026-09', day: '2026-09-10', hour: '10', event: 'session_start', dim1: 'kiosk', dim2: 'donji-grad', count: 25 },
      { month: '2026-09', day: '2026-09-10', hour: '12', event: 'hitno_view', dim1: 'page', dim2: '', count: 10 },
      // 4 + 3 (hour 10) and 6 (hour 11) were each under 10; folded to ostalo per hour they were
      // still under 10, so they fold once more to the whole day: 13, rounded to 15.
      { month: '2026-09', day: '2026-09-10', hour: '', event: 'session_start', dim1: 'ostalo', dim2: 'ostalo', count: 15 },
    ]);
    // scan_fail 2 could not reach 10 even at day level and is gone; nothing under 10 survives.
    for (const r of out) expect(r.count).toBeGreaterThanOrEqual(10);
    expect(out.some((r) => r.event === 'scan_fail')).toBe(false);
    expect(out.some((r) => r.event === 'over_cap')).toBe(false);
    expect(out.some((r) => r.event === 'source_fetch')).toBe(false);
  });

  it('keeps days apart when folding', () => {
    const out = cityRows([
      row(9, 'export', 'sigurnost', 'ics', 7, '2026-09-10'),
      row(9, 'export', 'sigurnost', 'ics', 7, '2026-09-11'),
    ]);
    // 7 on each day: never combined across days, so both vanish.
    expect(out).toEqual([]);
  });

  it('writes grad.csv with the month column first', () => {
    const csv = cityCsv(ROWS);
    expect([...CITY_COLUMNS]).toEqual(['month', 'day', 'hour', 'event', 'dim1', 'dim2', 'count']);
    expect(csv.split('\r\n')[0]).toBe('month,day,hour,event,dim1,dim2,count');
    expect(csv).toContain('2026-09,2026-09-10,10,session_start,kiosk,donji-grad,25\r\n');
    expect(csv).toContain('2026-09,2026-09-10,,session_start,ostalo,ostalo,15\r\n');
    expect(csv).not.toContain('23');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

`npx vitest run --project unit test/open/stats-export.test.ts`
Expected: fails with `Failed to load url ../../worker/stats/export`.

- [ ] **Step 3: Write the export module**

`D:\scratch\vidikovac\worker\stats\export.ts`:

```ts
// Two CSV shapes over the same counter rows.
//
//   export.csv  raw rows for the operator: (day, hour, event, dim1, dim2, count).
//   grad.csv    the City variant from design section 3: (month, day, hour,
//               event, dim1, dim2, count), counts rounded to 5, cells under 10
//               folded into "ostalo", over_cap excluded (design: overflow is not
//               part of the City dataset), source_fetch excluded (it is an
//               operations signal reported separately in the reliability report).
//
// Folding is done in three passes so that no cell under CITY_MIN_CELL can ever
// appear: (1) sub-threshold cells lose their dimensions and merge into the
// hour's "ostalo" cell; (2) an "ostalo" cell still under threshold merges into
// the day's "ostalo" cell (hour left empty); (3) whatever is still under
// threshold is dropped. Days are never merged with each other.
import type { MetricsDailyRow } from '../metrics-do';

export const RAW_COLUMNS = ['day', 'hour', 'event', 'dim1', 'dim2', 'count'] as const;
export const CITY_COLUMNS = ['month', 'day', 'hour', 'event', 'dim1', 'dim2', 'count'] as const;

export const CITY_EXCLUDED_EVENTS: ReadonlySet<string> = new Set(['over_cap', 'source_fetch']);
export const CITY_MIN_CELL = 10;
export const CITY_ROUND_TO = 5;
export const OSTALO = 'ostalo';

export interface CityRow {
  month: string;
  day: string;
  /** '0'..'23', or '' for a cell folded to the whole day. */
  hour: string;
  event: string;
  dim1: string;
  dim2: string;
  count: number;
}

export function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const lines = [columns.map(csvField).join(',')];
  for (const r of rows) lines.push(r.map(csvField).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

export function rawCsv(rows: readonly MetricsDailyRow[]): string {
  return toCsv(
    RAW_COLUMNS,
    rows.map((r) => [r.day, r.hour, r.event, r.dim1, r.dim2, r.count]),
  );
}

type CellKey = string;

interface Cell {
  day: string;
  hour: string;
  event: string;
  dim1: string;
  dim2: string;
  count: number;
}

function key(c: Omit<Cell, 'count'>): CellKey {
  return `${c.day}\u0000${c.hour}\u0000${c.event}\u0000${c.dim1}\u0000${c.dim2}`;
}

function add(cells: Map<CellKey, Cell>, c: Cell): void {
  const k = key(c);
  const existing = cells.get(k);
  if (existing === undefined) cells.set(k, { ...c });
  else existing.count += c.count;
}

function hourSortKey(hour: string): number {
  return hour === '' ? 24 : Number(hour);
}

export function cityRows(rows: readonly MetricsDailyRow[]): CityRow[] {
  // Pass 0: aggregate the eligible rows into cells.
  const cells = new Map<CellKey, Cell>();
  for (const r of rows) {
    if (CITY_EXCLUDED_EVENTS.has(r.event)) continue;
    add(cells, { day: r.day, hour: String(r.hour), event: r.event, dim1: r.dim1, dim2: r.dim2, count: r.count });
  }

  // Pass 1: sub-threshold cells fold into the hour's ostalo cell.
  const pass1 = new Map<CellKey, Cell>();
  for (const c of cells.values()) {
    if (c.count >= CITY_MIN_CELL) add(pass1, c);
    else add(pass1, { ...c, dim1: OSTALO, dim2: OSTALO });
  }

  // Pass 2: still under threshold -> the day's ostalo cell (hour '').
  const pass2 = new Map<CellKey, Cell>();
  for (const c of pass1.values()) {
    if (c.count >= CITY_MIN_CELL) add(pass2, c);
    else add(pass2, { ...c, hour: '', dim1: OSTALO, dim2: OSTALO });
  }

  // Pass 3: drop what could not be protected, round the rest.
  const out: CityRow[] = [];
  for (const c of pass2.values()) {
    if (c.count < CITY_MIN_CELL) continue;
    out.push({
      month: c.day.slice(0, 7),
      day: c.day,
      hour: c.hour,
      event: c.event,
      dim1: c.dim1,
      dim2: c.dim2,
      count: Math.round(c.count / CITY_ROUND_TO) * CITY_ROUND_TO,
    });
  }
  out.sort(
    (a, b) =>
      a.day.localeCompare(b.day) ||
      hourSortKey(a.hour) - hourSortKey(b.hour) ||
      a.event.localeCompare(b.event) ||
      a.dim1.localeCompare(b.dim1) ||
      a.dim2.localeCompare(b.dim2),
  );
  return out;
}

export function cityCsv(rows: readonly MetricsDailyRow[]): string {
  return toCsv(
    CITY_COLUMNS,
    cityRows(rows).map((r) => [r.month, r.day, r.hour, r.event, r.dim1, r.dim2, r.count]),
  );
}
```

- [ ] **Step 4: Run the export test, then commit**

`npx vitest run --project unit test/open/stats-export.test.ts`
Expected: 5 passed.

```
git add worker/stats/export.ts test/open/stats-export.test.ts
git commit -m "Stats exports: raw CSV and the City variant with ostalo folding and rounding to 5"
```

- [ ] **Step 5: Write the failing page test**

`D:\scratch\vidikovac\test\open\stats-page.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MetricsDailyRow } from '../../worker/metrics-do';
import { DEFAULT_DAYS, MAX_DAYS, renderStatsPage } from '../../worker/stats/page';

const row = (day: string, hour: number, event: string, dim1: string, dim2: string, count: number): MetricsDailyRow => ({
  day,
  hour,
  event,
  dim1,
  dim2,
  count,
});

const ROWS: MetricsDailyRow[] = [
  row('2026-09-10', 10, 'session_start', 'kiosk', 'donji-grad', 23),
  row('2026-09-10', 10, 'session_start', 'phone', '', 3),
  row('2026-09-10', 10, 'session_end', 'expired', '10m', 20),
  row('2026-09-10', 10, 'session_end', 'left', '<1m', 6),
  row('2026-09-10', 11, 'scan_fail', 'code-expired', '', 2),
  row('2026-09-10', 12, 'hitno_view', 'page', '', 12),
  row('2026-09-10', 12, 'kiosk_online', 'donji-grad', '', 1),
  row('2026-09-10', 12, 'source_fetch', 'zet-rt', 'ok', 118),
  row('2026-09-10', 12, 'source_fetch', 'zet-rt', 'stale', 2),
  row('2026-09-10', 13, 'panel_open', 'u-pokretu', 'kiosk', 9),
  row('2026-09-10', 13, 'export', 'sigurnost', 'ics', 4),
  row('2026-09-10', 13, 'over_cap', '', '', 1),
  row('2026-09-11', 9, 'session_start', 'kiosk', 'donji-grad', 5),
];

const VIEW = { days: 7, since: '2026-09-05', today: '2026-09-11', rows: ROWS };

describe('renderStatsPage', () => {
  const html = renderStatsPage(VIEW);

  it('is Croatian, zero-JS, self-contained HTML', () => {
    expect(html).toContain('<html lang="hr">');
    expect(html).toContain('Statistika');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
    expect(html).not.toMatch(/url\(\s*['"]?https?:/);
  });

  it('shows RAW counts, never rounded or folded, and no identifier column', () => {
    expect(html).toContain('>23<');
    expect(html).toContain('>3<');
    expect(html).toContain('>2<');
    expect(html).not.toContain('ostalo');
    for (const forbidden of ['IP', 'user-agent', 'roomId', 'beaconId', 'cookie']) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('leads with the vitals: sessions, ended, failed scans, hitno views, screens, source health', () => {
    expect(html).toContain('<div class="vital-k">Sesije</div>');
    expect(html).toContain('<div class="vital-v">28</div>'); // 23 + 3 + 5 session_start
    expect(html).toContain('<div class="vital-k">Neuspjeli skenovi</div>');
    expect(html).toContain('<div class="vital-k">Pregledi /hitno</div>');
    expect(html).toContain('<div class="vital-k">Zasloni online</div>');
    expect(html).toContain('<div class="vital-k">Dohvati izvora u redu</div>');
    expect(html).toContain('98,3 %'); // 118 of 120
    expect(html.indexOf('class="vitals"')).toBeLessThan(html.indexOf('<h2>'));
  });

  it('breaks sessions down by screen type and district, and sources by status', () => {
    expect(html).toMatch(/Sesije po vrsti zaslona i četvrti[\s\S]*?<th scope="row">kiosk<\/th>[\s\S]*?>23</);
    expect(html).toMatch(/Izvori[\s\S]*?<th scope="row">zet-rt<\/th>[\s\S]*?>118<[\s\S]*?>2</);
    expect(html).toContain('Preko kapaciteta');
  });

  it('renders every day of the window, newest first, as real zeros where nothing happened', () => {
    const dayTable = html.slice(html.indexOf('Po danu'));
    expect(dayTable.indexOf('2026-09-11')).toBeLessThan(dayTable.indexOf('2026-09-10'));
    expect(dayTable).toContain('2026-09-05');
    expect(dayTable).toMatch(/<th scope="row">2026-09-07<\/th><td class="num">0<\/td>/);
  });

  it('renders a 24-row hour table in Zagreb time', () => {
    expect(html).toContain('Po satu (Europe/Zagreb)');
    expect(html).toMatch(/<th scope="row">10<\/th><td class="num">26<\/td>/); // 23 + 3 sessions at 10h
    expect(html).toMatch(/<th scope="row">23<\/th><td class="num">0<\/td>/);
  });

  it('links the three exports for the same window', () => {
    expect(html).toContain('href="/stats/export.csv?days=7"');
    expect(html).toContain('href="/stats/grad.csv?days=7"');
    expect(html).toContain('href="/stats/data.json?days=7"');
  });

  it('says once, plainly, when the window is empty', () => {
    const empty = renderStatsPage({ ...VIEW, rows: [] });
    expect(empty).toContain('Nema brojača u ovom razdoblju');
    expect(empty).not.toContain('<table');
    expect(empty).toContain('/stats?days=90');
  });

  it('exports the window constants the route clamps against', () => {
    expect(DEFAULT_DAYS).toBe(30);
    expect(MAX_DAYS).toBe(365);
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

`npx vitest run --project unit test/open/stats-page.test.ts`
Expected: fails with `Failed to load url ../../worker/stats/page`.

- [ ] **Step 7: Write the page renderer**

`D:\scratch\vidikovac\worker\stats\page.ts`:

```ts
// The operator page over MetricsDO counters: raw numbers, Croatian, zero JS,
// one inline <style>, no external request (so Task D4 can pin
// `default-src 'none'`). Rounding and folding happen only in the City export
// (worker/stats/export.ts); this page is where the operator sees the truth.
import type { MetricsDailyRow } from '../metrics-do';
import { escapeHtml } from '../open/html';

export const MAX_DAYS = 365;
export const DEFAULT_DAYS = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;
const RANGE_OPTIONS: readonly number[] = [7, 30, 90, 365];

export interface StatsView {
  days: number;
  /** First Zagreb day of the window, YYYY-MM-DD. */
  since: string;
  /** Today's Zagreb day, YYYY-MM-DD. */
  today: string;
  rows: MetricsDailyRow[];
}

type Pivot = Map<string, Map<string, number>>;

function fmt(n: number): string {
  return n.toLocaleString('hr-HR');
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return '&mdash;';
  return `${((part / whole) * 100).toLocaleString('hr-HR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

function label(value: string): string {
  return value === '' ? '<span class="dim">(bez dimenzije)</span>' : escapeHtml(value);
}

function sum(rows: readonly MetricsDailyRow[], pred: (r: MetricsDailyRow) => boolean): number {
  let total = 0;
  for (const r of rows) if (pred(r)) total += r.count;
  return total;
}

function pivot(rows: readonly MetricsDailyRow[], event: string, rowDim: 'dim1' | 'dim2', colDim: 'dim1' | 'dim2' | null): Pivot {
  const out: Pivot = new Map();
  for (const r of rows) {
    if (r.event !== event) continue;
    const rk = r[rowDim];
    const ck = colDim === null ? 'ukupno' : r[colDim];
    let inner = out.get(rk);
    if (inner === undefined) {
      inner = new Map();
      out.set(rk, inner);
    }
    inner.set(ck, (inner.get(ck) ?? 0) + r.count);
  }
  return out;
}

function rowTotal(m: Map<string, number>): number {
  let t = 0;
  for (const v of m.values()) t += v;
  return t;
}

/** One table: a heading row, one row per first dimension, one column per second dimension, totals. */
function matrixTable(heading: string, rowLabel: string, p: Pivot, empty: string): string {
  if (p.size === 0) return `<h3>${escapeHtml(heading)}</h3><p class="empty">${escapeHtml(empty)}</p>`;
  const cols = [...new Set([...p.values()].flatMap((m) => [...m.keys()]))].sort((a, b) => a.localeCompare(b, 'hr'));
  const rows = [...p.entries()].sort((a, b) => rowTotal(b[1]) - rowTotal(a[1]));
  const colTotals = cols.map((c) => rows.reduce((t, [, m]) => t + (m.get(c) ?? 0), 0));
  const grand = colTotals.reduce((a, b) => a + b, 0);
  const showTotals = cols.length > 1;
  return (
    `<h3>${escapeHtml(heading)}</h3>` +
    `<div class="scroll" tabindex="0" role="region" aria-label="${escapeHtml(heading)}"><table class="tbl"><thead><tr>` +
    `<th scope="col">${escapeHtml(rowLabel)}</th>` +
    cols.map((c) => `<th scope="col" class="num">${label(c)}</th>`).join('') +
    (showTotals ? `<th scope="col" class="num">Ukupno</th>` : '') +
    `</tr></thead><tbody>` +
    rows
      .map(
        ([rk, m]) =>
          `<tr><th scope="row">${label(rk)}</th>` +
          cols.map((c) => `<td class="num${(m.get(c) ?? 0) === 0 ? ' dim' : ''}">${fmt(m.get(c) ?? 0)}</td>`).join('') +
          (showTotals ? `<td class="num">${fmt(rowTotal(m))}</td>` : '') +
          `</tr>`,
      )
      .join('') +
    `</tbody>` +
    (rows.length > 1
      ? `<tfoot><tr><th scope="row">Ukupno</th>${colTotals.map((t) => `<td class="num">${fmt(t)}</td>`).join('')}` +
        (showTotals ? `<td class="num">${fmt(grand)}</td>` : '') +
        `</tr></tfoot>`
      : '') +
    `</table></div>`
  );
}

/** Every Zagreb day in the window, oldest first, so a gap renders as a zero. */
function dayRange(since: string, today: string): string[] {
  const days: string[] = [];
  for (let t = Date.parse(`${since}T00:00:00Z`); days.length <= MAX_DAYS; t += DAY_MS) {
    const day = new Date(t).toISOString().slice(0, 10);
    days.push(day);
    if (day >= today) break;
  }
  return days;
}

const DAY_COLUMNS: readonly { event: string; label: string }[] = [
  { event: 'session_start', label: 'Sesije' },
  { event: 'session_end', label: 'Završene' },
  { event: 'scan_fail', label: 'Neuspjeli skenovi' },
  { event: 'hitno_view', label: '/hitno' },
  { event: 'kiosk_online', label: 'Zasloni' },
  { event: 'panel_open', label: 'Paneli' },
  { event: 'export', label: 'Izvozi' },
  { event: 'over_cap', label: 'Preko kapaciteta' },
];

const HOUR_COLUMNS: readonly { event: string; label: string }[] = [
  { event: 'session_start', label: 'Sesije' },
  { event: 'hitno_view', label: '/hitno' },
  { event: 'scan_fail', label: 'Neuspjeli skenovi' },
];

function dayTable(view: StatsView): string {
  const byDay = new Map<string, Map<string, number>>();
  for (const r of view.rows) {
    let inner = byDay.get(r.day);
    if (inner === undefined) {
      inner = new Map();
      byDay.set(r.day, inner);
    }
    inner.set(r.event, (inner.get(r.event) ?? 0) + r.count);
  }
  const days = dayRange(view.since, view.today).reverse();
  return (
    `<h2>Po danu</h2><p class="lede">Svaki dan razdoblja je u tablici; nula je stvarna nula.</p>` +
    `<div class="scroll" tabindex="0" role="region" aria-label="Po danu"><table class="tbl"><thead><tr><th scope="col">Dan</th>` +
    DAY_COLUMNS.map((c) => `<th scope="col" class="num">${escapeHtml(c.label)}</th>`).join('') +
    `</tr></thead><tbody>` +
    days
      .map(
        (day) =>
          `<tr><th scope="row">${escapeHtml(day)}</th>` +
          DAY_COLUMNS.map((c) => `<td class="num">${fmt(byDay.get(day)?.get(c.event) ?? 0)}</td>`).join('') +
          `</tr>`,
      )
      .join('') +
    `</tbody></table></div>`
  );
}

function hourTable(rows: readonly MetricsDailyRow[]): string {
  const byHour: number[][] = Array.from({ length: 24 }, () => HOUR_COLUMNS.map(() => 0));
  for (const r of rows) {
    if (!Number.isInteger(r.hour) || r.hour < 0 || r.hour > 23) continue;
    HOUR_COLUMNS.forEach((c, i) => {
      if (r.event === c.event) byHour[r.hour][i] += r.count;
    });
  }
  return (
    `<h2>Po satu (Europe/Zagreb)</h2><p class="lede">Zbroj cijelog razdoblja po satu u danu; pokazuje kada su zasloni i /hitno zaista u uporabi.</p>` +
    `<div class="scroll" tabindex="0" role="region" aria-label="Po satu"><table class="tbl"><thead><tr><th scope="col">Sat</th>` +
    HOUR_COLUMNS.map((c) => `<th scope="col" class="num">${escapeHtml(c.label)}</th>`).join('') +
    `</tr></thead><tbody>` +
    byHour
      .map(
        (counts, hour) =>
          `<tr><th scope="row">${hour}</th>${counts.map((n) => `<td class="num">${fmt(n)}</td>`).join('')}</tr>`,
      )
      .join('') +
    `</tbody></table></div>`
  );
}

const STYLE = `
:root{color-scheme:dark light;--bg:#0b1020;--fg:#e8ecf5;--muted:#9aa5bf;--accent:#7cd4ff;--line:rgba(232,236,245,.16);--card:#121a30}
@media (prefers-color-scheme:light){:root{--bg:#f7f3ea;--fg:#14181f;--muted:#5a6172;--accent:#005f8a;--line:rgba(20,24,31,.16);--card:#fffdf8}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:1rem/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
.wrap{max-width:72rem;margin:0 auto;padding:1.25rem 1.25rem 4rem}
header{display:flex;flex-wrap:wrap;gap:.75rem 1.5rem;align-items:baseline;border-bottom:1px solid var(--line);padding-bottom:1rem}
h1{margin:0;font-size:1.25rem}h1 span{color:var(--muted);font-weight:400}
.window{color:var(--muted);margin:0 auto 0 0;font-variant-numeric:tabular-nums}
nav.range{display:flex;gap:.25rem}
nav.range a,nav.range span{padding:.15rem .5rem;border-radius:.4rem;text-decoration:none;font-variant-numeric:tabular-nums}
nav.range span{background:var(--card);border:1px solid var(--line)}
.exports{font-size:.95rem}
.vitals{display:grid;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr));gap:1rem 1.5rem;margin:1.5rem 0 2rem;padding:1rem 0;border-block:1px solid var(--line)}
.vital-k{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.vital-v{font-size:1.75rem;font-variant-numeric:tabular-nums;font-weight:500}
.vital-s{color:var(--muted);font-size:.9rem}
section{margin-top:2rem}
h2{margin:0 0 .25rem;font-size:1.25rem}h3{margin:1.25rem 0 .35rem;font-size:1.05rem}
.lede{margin:0 0 .75rem;color:var(--muted);max-width:70ch}
.tbl{border-collapse:collapse;font-size:.95rem;min-width:100%}
.tbl th,.tbl td{padding:.35rem .75rem .35rem 0;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
.tbl thead th{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
.tbl tfoot th,.tbl tfoot td{border-bottom:0;font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.dim{color:var(--muted)}.empty{color:var(--muted);margin:.25rem 0}
.scroll{overflow-x:auto}
.blank{max-width:36rem;margin:3rem auto;padding:2rem;text-align:center;border:1px dashed var(--line);border-radius:12px;color:var(--muted)}
.blank b{display:block;color:var(--fg);font-size:1.25rem;margin-bottom:.5rem}
`;

function rangeSwitcher(days: number): string {
  return (
    `<nav class="range" aria-label="Razdoblje">` +
    RANGE_OPTIONS.map((n) =>
      n === days ? `<span aria-current="page">${n} d</span>` : `<a href="/stats?days=${n}">${n} d</a>`,
    ).join('') +
    `</nav>`
  );
}

function shell(view: StatsView, body: string): string {
  return `<!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="robots" content="noindex">
<title>Vidikovac · Statistika</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header>
<h1>Vidikovac <span>/ Statistika</span></h1>
<p class="window">${view.days} dana do ${escapeHtml(view.today)} · od ${escapeHtml(view.since)} · Europe/Zagreb</p>
${rangeSwitcher(view.days)}
<p class="exports"><a href="/stats/export.csv?days=${view.days}">export.csv</a> · <a href="/stats/grad.csv?days=${view.days}">grad.csv (za Grad, zaokruženo)</a> · <a href="/stats/data.json?days=${view.days}">data.json</a></p>
</header>
<main>
${body}
</main>
</div>
</body>
</html>
`;
}

export function renderStatsPage(view: StatsView): string {
  const { rows } = view;
  if (rows.length === 0) {
    return shell(
      view,
      `<div class="blank"><b>Nema brojača u ovom razdoblju</b>` +
        `<p>Između ${escapeHtml(view.since)} i ${escapeHtml(view.today)} nije zabilježen nijedan događaj. ` +
        `Brojači počinju s prvom sesijom ili prvim pregledom /hitno; mirno razdoblje ovdje izgleda isto kao razdoblje prije objave. Odaberi šire razdoblje.</p></div>`,
    );
  }

  const sessions = sum(rows, (r) => r.event === 'session_start');
  const ended = sum(rows, (r) => r.event === 'session_end');
  const scanFails = sum(rows, (r) => r.event === 'scan_fail');
  const hitno = sum(rows, (r) => r.event === 'hitno_view');
  const kiosks = sum(rows, (r) => r.event === 'kiosk_online');
  const fetches = sum(rows, (r) => r.event === 'source_fetch');
  const fetchesOk = sum(rows, (r) => r.event === 'source_fetch' && r.dim2 === 'ok');
  const overCap = sum(rows, (r) => r.event === 'over_cap');
  const panelOpens = sum(rows, (r) => r.event === 'panel_open');
  const exportsN = sum(rows, (r) => r.event === 'export');

  const vitals: { k: string; v: string; s: string }[] = [
    { k: 'Sesije', v: fmt(sessions), s: `${fmt(ended)} završenih` },
    { k: 'Neuspjeli skenovi', v: fmt(scanFails), s: `${pct(scanFails, scanFails + sessions)} pokušaja` },
    { k: 'Pregledi /hitno', v: fmt(hitno), s: 'otvoreni sloj, bez skeniranja' },
    { k: 'Zasloni online', v: fmt(kiosks), s: 'dnevnih prijava zaslona' },
    { k: 'Dohvati izvora u redu', v: pct(fetchesOk, fetches), s: `${fmt(fetches)} dohvata` },
    { k: 'Paneli i izvozi', v: fmt(panelOpens), s: `${fmt(exportsN)} izvoza` },
  ];

  const body =
    `<div class="vitals">` +
    vitals
      .map(
        (v) =>
          `<div class="vital"><div class="vital-k">${escapeHtml(v.k)}</div><div class="vital-v">${v.v}</div><div class="vital-s">${v.s}</div></div>`,
      )
      .join('') +
    `</div>` +
    `<section><h2>Sesije</h2><p class="lede">Otključavanja i njihov kraj. Brojevi su sirovi; zaokruživanje i sažimanje primjenjuju se samo u grad.csv.</p>` +
    matrixTable('Sesije po vrsti zaslona i četvrti', 'Vrsta zaslona', pivot(rows, 'session_start', 'dim1', 'dim2'), 'još nema sesija') +
    matrixTable('Kraj sesije po razlogu i trajanju', 'Razlog', pivot(rows, 'session_end', 'dim1', 'dim2'), 'još nema završenih sesija') +
    matrixTable('Neuspjeli skenovi po razlogu', 'Razlog', pivot(rows, 'scan_fail', 'dim1', null), 'nema neuspjelih skenova') +
    `<h3>Preko kapaciteta</h3><p>${fmt(overCap)} sesija iznad ograničenja po zaslonu (30 na sat, 200 na dan); isključene iz skupa za Grad.</p>` +
    `</section>` +
    `<section><h2>Uporaba</h2><p class="lede">Što ljudi otvaraju i izvoze dok je sesija otključana; klijentski događaji stižu samo autenticiranom utičnicom sobe, najviše 60 po sesiji.</p>` +
    matrixTable('Otvoreni paneli po sloju i vrsti zaslona', 'Sloj', pivot(rows, 'panel_open', 'dim1', 'dim2'), 'još nema otvorenih panela') +
    matrixTable('Izvozi po sloju i vrsti', 'Sloj', pivot(rows, 'export', 'dim1', 'dim2'), 'još nema izvoza') +
    matrixTable('Pregledi otvorenog sloja', 'Stranica', pivot(rows, 'hitno_view', 'dim1', null), 'još nema pregleda /hitno') +
    `</section>` +
    `<section><h2>Izvori</h2><p class="lede">Dohvati po izvoru i ishodu. Stupac <em>error</em> je onaj koji treba gledati; <em>stale</em> znači da je poslužena zadnja dobra kopija.</p>` +
    matrixTable('Dohvati izvora po ishodu', 'Izvor', pivot(rows, 'source_fetch', 'dim1', 'dim2'), 'još nema dohvata') +
    matrixTable('Zasloni online po četvrti', 'Četvrt', pivot(rows, 'kiosk_online', 'dim1', null), 'nijedan zaslon se još nije prijavio') +
    `</section>` +
    `<section>${dayTable(view)}</section>` +
    `<section>${hourTable(rows)}</section>`;

  return shell(view, body);
}
```

- [ ] **Step 8: Run the page test, then commit**

`npx vitest run --project unit test/open/stats-page.test.ts`
Expected: 9 passed.

```
git add worker/stats/page.ts test/open/stats-page.test.ts
git commit -m "Stats page: raw counters by event, dimension, day and Zagreb hour; zero-JS Croatian HTML"
```

- [ ] **Step 9: Write the failing route test (workers pool)**

`D:\scratch\vidikovac\test\open\stats.workers.test.ts`:

```ts
import { SELF, createExecutionContext, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../worker/env';
import type { MetricsDailyRow } from '../../worker/metrics-do';
import { handleStats } from '../../worker/routes/stats';

const testEnv = env as unknown as Env;
const NOW = () => new Date('2026-09-11T10:00:00Z');

const ROWS: MetricsDailyRow[] = [
  { day: '2026-09-10', hour: 10, event: 'session_start', dim1: 'kiosk', dim2: 'donji-grad', count: 23 },
  { day: '2026-09-10', hour: 10, event: 'session_start', dim1: 'phone', dim2: '', count: 3 },
  { day: '2026-09-10', hour: 12, event: 'over_cap', dim1: '', dim2: '', count: 1 },
];

const allow = async () => true;
const deny = async () => false;
const loadRows = async (_env: Env, since: string) => ROWS.filter((r) => r.day >= since);

async function call(path: string, deps: Parameters<typeof handleStats>[4], init: RequestInit = {}) {
  const request = new Request(`https://zagreb.aningfilm.hr${path}`, init);
  return handleStats(request, testEnv, createExecutionContext(), new URL(request.url), deps);
}

async function expectNotFound(response: Response | null): Promise<void> {
  expect(response).not.toBeNull();
  expect(response!.status).toBe(404);
  expect(response!.headers.get('cache-control')).toBe('no-store');
  expect(response!.headers.get('x-robots-tag')).toBe('noindex');
  await expect(response!.json()).resolves.toEqual({ error: 'not-found' });
}

describe('/stats access control', () => {
  it('404s every /stats path when the verifier says no', async () => {
    for (const path of ['/stats', '/stats/data.json', '/stats/export.csv', '/stats/grad.csv', '/stats/anything']) {
      await expectNotFound(await call(path, { verify: deny, loadRows, now: NOW }));
    }
  });

  it('404s unknown paths and non-GET even when verified', async () => {
    await expectNotFound(await call('/stats/admin', { verify: allow, loadRows, now: NOW }));
    await expectNotFound(await call('/stats', { verify: allow, loadRows, now: NOW }, { method: 'POST' }));
  });

  it('404s when the row loader throws (an ops problem is not information for the caller)', async () => {
    await expectNotFound(
      await call('/stats', {
        verify: allow,
        now: NOW,
        loadRows: async () => {
          throw new Error('do-unavailable');
        },
      }),
    );
  });

  it('404s through the real Worker with no Access vars set', async () => {
    const response = await SELF.fetch('https://zagreb.aningfilm.hr/stats');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not-found' });
  });

  it('returns null for paths outside /stats so the dispatcher moves on', async () => {
    expect(await call('/hitno', { verify: allow, loadRows, now: NOW })).toBeNull();
  });
});

describe('/stats with a verified caller', () => {
  it('renders the page with raw counts and a 7-day window in Zagreb days', async () => {
    const response = await call('/stats?days=7', { verify: allow, loadRows, now: NOW });
    expect(response!.status).toBe(200);
    expect(response!.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response!.headers.get('cache-control')).toBe('no-store');
    const html = await response!.text();
    expect(html).toContain('7 dana do 2026-09-11 · od 2026-09-05');
    expect(html).toContain('>23<');
    expect(html).not.toContain('<script');
  });

  it('clamps ?days= to 1..365 and defaults to 30', async () => {
    const big = await (await call('/stats?days=9999', { verify: allow, loadRows, now: NOW }))!.text();
    expect(big).toContain('365 dana');
    const bad = await (await call('/stats?days=abc', { verify: allow, loadRows, now: NOW }))!.text();
    expect(bad).toContain('30 dana');
    const zero = await (await call('/stats?days=0', { verify: allow, loadRows, now: NOW }))!.text();
    expect(zero).toContain('1 dana');
  });

  it('serves data.json with the window and the raw rows', async () => {
    const response = await call('/stats/data.json?days=30', { verify: allow, loadRows, now: NOW });
    expect(response!.status).toBe(200);
    expect(response!.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const body = (await response!.json()) as { days: number; since: string; today: string; timeZone: string; rows: MetricsDailyRow[] };
    expect(body).toMatchObject({ days: 30, since: '2026-08-13', today: '2026-09-11', timeZone: 'Europe/Zagreb' });
    expect(body.rows).toEqual(ROWS);
  });

  it('serves export.csv raw and grad.csv folded, both as attachments', async () => {
    const raw = await call('/stats/export.csv?days=30', { verify: allow, loadRows, now: NOW });
    expect(raw!.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(raw!.headers.get('content-disposition')).toBe('attachment; filename="vidikovac-brojaci-2026-08-13-2026-09-11.csv"');
    const rawText = await raw!.text();
    expect(rawText).toContain('2026-09-10,10,session_start,kiosk,donji-grad,23\r\n');
    expect(rawText).toContain('over_cap');

    const city = await call('/stats/grad.csv?days=30', { verify: allow, loadRows, now: NOW });
    expect(city!.headers.get('content-disposition')).toBe('attachment; filename="vidikovac-grad-2026-08-13-2026-09-11.csv"');
    const cityText = await city!.text();
    expect(cityText).toContain('2026-09,2026-09-10,10,session_start,kiosk,donji-grad,25\r\n');
    expect(cityText).not.toContain(',23');
    expect(cityText).not.toContain('over_cap');
    expect(cityText).not.toContain('phone');
  });
});
```

- [ ] **Step 10: Run it and watch it fail**

`npx vitest run --project workers test/open/stats.workers.test.ts`
Expected: fails: the stub `handleStats` has no deps parameter and returns null, so `expectNotFound` fails on `expect(response).not.toBeNull()`.

- [ ] **Step 11: Write the stats route**

`D:\scratch\vidikovac\worker\routes\stats.ts` (replaces the stub):

```ts
// /stats: the operator surface over MetricsDO. TWO GATES, both required, as in
// psdlat's stats.ts: Cloudflare Access in front of the route, and Area B's
// verifyAccess re-checking the injected JWT in full inside the Worker. Every
// failure mode (verifier says no, non-GET, unknown path, storage error) is the
// same `404 {"error":"not-found"}`, so an unauthenticated caller cannot learn
// that the route exists.
import type { Env } from '../env';
import { METRICS_DO_NAME, type MetricsDO, type MetricsDailyRow } from '../metrics-do';
import { zagrebDay } from '../open/time';
import { verifyAccess } from '../pairing/access';
import { cityCsv, rawCsv } from '../stats/export';
import { DAY_MS, DEFAULT_DAYS, MAX_DAYS, renderStatsPage } from '../stats/page';

export const STATS_PATHS = ['/stats', '/stats/data.json', '/stats/export.csv', '/stats/grad.csv'] as const;
type StatsPath = (typeof STATS_PATHS)[number];

export interface StatsDeps {
  /** Test seam; production uses worker/pairing/access.ts. */
  verify?: (env: Env, request: Request) => Promise<boolean>;
  /** Test seam; production queries the MetricsDO singleton. */
  loadRows?: (env: Env, sinceDay: string) => Promise<MetricsDailyRow[]>;
  now?: () => Date;
}

const NO_STORE = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } as const;

function notFound(): Response {
  return new Response(JSON.stringify({ error: 'not-found' }), {
    status: 404,
    headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE },
  });
}

function clampDays(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DAYS;
  return Math.min(MAX_DAYS, Math.max(1, parsed));
}

async function defaultLoadRows(env: Env, sinceDay: string): Promise<MetricsDailyRow[]> {
  const namespace = env.METRICS_DO as unknown as DurableObjectNamespace<MetricsDO>;
  const stub = namespace.get(namespace.idFromName(METRICS_DO_NAME));
  return await stub.query(sinceDay);
}

function isStatsPath(path: string): path is StatsPath {
  return (STATS_PATHS as readonly string[]).includes(path);
}

function csv(body: string, filename: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      ...NO_STORE,
    },
  });
}

export async function handleStats(
  request: Request,
  env: Env,
  _ctx: ExecutionContext,
  url: URL,
  deps: StatsDeps = {},
): Promise<Response | null> {
  if (url.pathname !== '/stats' && !url.pathname.startsWith('/stats/')) return null;

  const verify = deps.verify ?? verifyAccess;
  if (!(await verify(env, request))) return notFound();
  if (request.method !== 'GET') return notFound();
  if (!isStatsPath(url.pathname)) return notFound();

  const now = (deps.now ?? (() => new Date()))();
  const days = clampDays(url.searchParams.get('days'));
  const today = zagrebDay(now);
  const since = zagrebDay(new Date(now.getTime() - (days - 1) * DAY_MS));

  try {
    const rows = await (deps.loadRows ?? defaultLoadRows)(env, since);
    switch (url.pathname) {
      case '/stats':
        return new Response(renderStatsPage({ days, since, today, rows }), {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8', 'content-language': 'hr', ...NO_STORE },
        });
      case '/stats/data.json':
        return new Response(JSON.stringify({ days, since, today, timeZone: 'Europe/Zagreb', rows }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE },
        });
      case '/stats/export.csv':
        return csv(rawCsv(rows), `vidikovac-brojaci-${since}-${today}.csv`);
      case '/stats/grad.csv':
        return csv(cityCsv(rows), `vidikovac-grad-${since}-${today}.csv`);
    }
  } catch (error) {
    console.error(
      `[vidikovac] stats-render-failed ${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown-error'}`,
    );
  }
  return notFound();
}
```

- [ ] **Step 12: Run the route test and the typecheck, then commit**

`npx vitest run --project workers test/open/stats.workers.test.ts`
Expected: 9 passed (the `SELF.fetch` case needs Area B's `verifyAccess` to fail closed with unset vars, which is its contract).
`npx tsc --noEmit -p worker/tsconfig.json`
Expected: no output.

```
git add worker/routes/stats.ts test/open/stats.workers.test.ts
git commit -m "Access-gated /stats: page, data.json, export.csv and the folded City variant grad.csv, uniform 404"
```

---

### Task D4: security headers for Worker responses and static assets

**Files:**
- Create: `D:\scratch\vidikovac\worker\security-headers.ts`, `D:\scratch\vidikovac\app\public\_headers`
- Modify: `D:\scratch\vidikovac\worker\routes\open.ts`, `D:\scratch\vidikovac\worker\routes\stats.ts`
- Test: `D:\scratch\vidikovac\test\open\security-headers.test.ts`, `D:\scratch\vidikovac\test\open\security-headers.workers.test.ts`

**Interfaces:**
- Consumes: `handleOpen`, `handleStats` from D1–D3; Area C's tile host (assumed `https://tile.openstreetmap.org`; change `TILE_HOST` if Area C picks another) and Area C's decision to load theme init as an external module (`INLINE_SCRIPT_HASHES` stays empty; the landing page's current inline `<script type="module">` in `app/index.html` must move to a module file or its `sha256-` hash goes into the list).
- Produces: `TILE_HOST`, `INLINE_SCRIPT_HASHES`, `APP_CSP`, `APP_SECURITY_HEADERS`, `PAGE_SECURITY_HEADERS`, `DATA_SECURITY_HEADERS`, `STATS_SECURITY_HEADERS`, `withSecurityHeaders(response: Response, headers: Readonly<Record<string, string>>): Response`, `securityHeadersFor(response: Response): Readonly<Record<string, string>>` (`worker/security-headers.ts`); `app/public/_headers` with a `/*` rule identical to `APP_SECURITY_HEADERS`.

- [ ] **Step 1: Write the failing policy and parity test (unit)**

`D:\scratch\vidikovac\test\open\security-headers.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  APP_CSP,
  APP_SECURITY_HEADERS,
  DATA_SECURITY_HEADERS,
  PAGE_SECURITY_HEADERS,
  STATS_SECURITY_HEADERS,
  TILE_HOST,
} from '../../worker/security-headers';

/** Parses the Workers static-assets `_headers` format: a path rule line, then indented `Name: value` lines. */
function parseHeadersFile(text: string): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {};
  let current: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '' || raw.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = raw.trim();
      rules[current] = {};
      continue;
    }
    if (current === null) throw new Error(`header line before any rule: ${raw}`);
    const idx = raw.indexOf(':');
    rules[current][raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
  }
  return rules;
}

describe('security header policy', () => {
  it('keeps the app CSP strict: no inline or eval scripts, tiles only from the chosen host', () => {
    expect(TILE_HOST).toBe('https://tile.openstreetmap.org');
    expect(APP_CSP).toContain("default-src 'self'");
    expect(APP_CSP).toContain("script-src 'self'");
    expect(APP_CSP).not.toContain("'unsafe-eval'");
    expect(APP_CSP).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(APP_CSP).toContain(`img-src 'self' data: blob: ${TILE_HOST}`);
    expect(APP_CSP).toContain(`connect-src 'self' wss://zagreb.aningfilm.hr ${TILE_HOST}`);
    expect(APP_CSP).toContain("worker-src 'self' blob:"); // MapLibre GL spawns its worker from a blob URL
    expect(APP_CSP).toContain("style-src 'self' 'unsafe-inline'"); // MapLibre and theme.ts set style attributes
    expect(APP_CSP).toContain("object-src 'none'");
    expect(APP_CSP).toContain("frame-ancestors 'none'");
    expect(APP_CSP).toContain("base-uri 'self'");
  });

  it('carries the companion hardening headers with camera and geolocation for this origin only', () => {
    expect(APP_SECURITY_HEADERS['Content-Security-Policy']).toBe(APP_CSP);
    expect(APP_SECURITY_HEADERS['Strict-Transport-Security']).toBe('max-age=31536000');
    expect(APP_SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(APP_SECURITY_HEADERS['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(APP_SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
    expect(APP_SECURITY_HEADERS['Permissions-Policy']).toBe(
      'camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), browsing-topics=()',
    );
  });

  it('pins default-src none for the server-rendered pages and the stats page', () => {
    for (const set of [PAGE_SECURITY_HEADERS, STATS_SECURITY_HEADERS]) {
      expect(set['Content-Security-Policy']).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      );
      expect(set['X-Content-Type-Options']).toBe('nosniff');
      expect(set['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
      expect(set['Strict-Transport-Security']).toBe('max-age=31536000');
    }
    expect(PAGE_SECURITY_HEADERS['Permissions-Policy']).toBe(
      'camera=(), geolocation=(), microphone=(), payment=(), usb=(), browsing-topics=()',
    );
    expect(STATS_SECURITY_HEADERS['X-Robots-Tag']).toBe('noindex');
    expect(STATS_SECURITY_HEADERS['Cache-Control']).toBe('no-store');
    expect(PAGE_SECURITY_HEADERS['Cache-Control']).toBeUndefined(); // /hitno keeps its own s-maxage
  });

  it('keeps data responses framing-proof and sniff-proof without touching CORS', () => {
    expect(DATA_SECURITY_HEADERS['Content-Security-Policy']).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(DATA_SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(DATA_SECURITY_HEADERS['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('app/public/_headers carries exactly APP_SECURITY_HEADERS under /*', () => {
    const file = readFileSync(fileURLToPath(new URL('../../app/public/_headers', import.meta.url)), 'utf8');
    const rules = parseHeadersFile(file);
    expect(Object.keys(rules)).toEqual(['/*']);
    expect(rules['/*']).toEqual(APP_SECURITY_HEADERS);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

`npx vitest run --project unit test/open/security-headers.test.ts`
Expected: fails with `Failed to load url ../../worker/security-headers`.

- [ ] **Step 3: Write the policy module and the `_headers` file**

`D:\scratch\vidikovac\worker\security-headers.ts`:

```ts
// Security headers, one typed definition.
//
// HOW THEY ARE APPLIED. Static assets (everything under app/dist) never invoke
// the Worker: `run_worker_first` in wrangler.jsonc lists only /api/*, /ws/*,
// /hitno, /open, /open/*, /stats and /stats/*. Their headers come from
// `app/public/_headers`, which the asset layer applies without a Worker
// invocation; that file is hand-authored to equal APP_SECURITY_HEADERS and
// test/open/security-headers.test.ts fails when the two drift (psdlat's
// arrangement, worker/src/security-headers.ts). Worker-generated responses
// get their set stamped in code: worker/routes/open.ts and
// worker/routes/stats.ts call withSecurityHeaders.
//
// THE APP POLICY (kiosk, scan page, dashboard):
//   script-src 'self'            no inline scripts, no eval. Theme init is an
//                                external module. INLINE_SCRIPT_HASHES exists for
//                                the day a hashed inline bootstrap is unavoidable:
//                                add `sha256-<base64>` computed with
//                                node -e "const c=require('crypto');process.stdout.write('sha256-'+c.createHash('sha256').update(require('fs').readFileSync(process.argv[1])).digest('base64'))" script.js
//   style-src 'unsafe-inline'    MapLibre GL and theme.ts set style attributes.
//   img-src / connect-src TILE_HOST   raster tiles; MapLibre fetches tiles with
//                                fetch(), so both directives name the host.
//   worker-src 'self' blob:      MapLibre GL spawns its worker from a blob URL.
//   connect-src wss://zagreb.aningfilm.hr   the room and beacon sockets on the
//                                custom domain; 'self' already covers same-origin
//                                WebSockets in current browsers, the explicit
//                                entry is for older Safari.
//   Permissions-Policy camera=(self) for the in-app QR scanner, geolocation=(self)
//   for "departures at the nearest stop" (location stays on the phone).
//
// THE PAGE POLICY (/hitno, /open/): server-rendered, zero JS, one inline
// <style>, no fetch of any kind, so `default-src 'none'` holds.
// THE STATS POLICY adds noindex and no-store: the page sits behind Access.
// THE DATA POLICY (/open/*.json, .geojson): nothing executes, nothing frames.

export const TILE_HOST = 'https://tile.openstreetmap.org';
export const SOCKET_ORIGIN = 'wss://zagreb.aningfilm.hr';

/** `sha256-...` tokens for inline scripts the app cannot avoid. Empty by design. */
export const INLINE_SCRIPT_HASHES: readonly string[] = [];

const scriptSrc = ["'self'", ...INLINE_SCRIPT_HASHES.map((h) => `'${h}'`)].join(' ');

export const APP_CSP = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${TILE_HOST}`,
  `connect-src 'self' ${SOCKET_ORIGIN} ${TILE_HOST}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "font-src 'self'",
  "manifest-src 'self'",
  "media-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const HSTS = 'max-age=31536000';
const REFERRER = 'strict-origin-when-cross-origin';

export const APP_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': APP_CSP,
  'Strict-Transport-Security': HSTS,
  'Referrer-Policy': REFERRER,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), browsing-topics=()',
};

const NONE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** /hitno and /open/ index: public, cacheable, zero-JS pages. */
export const PAGE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': NONE_CSP,
  'Strict-Transport-Security': HSTS,
  'Referrer-Policy': REFERRER,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=(), browsing-topics=()',
};

/** /open/*.json and .geojson. CORS is set by the route, not here. */
export const DATA_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': HSTS,
  'Referrer-Policy': REFERRER,
  'X-Content-Type-Options': 'nosniff',
};

/** /stats and every response under it, the fail-closed 404s included. */
export const STATS_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': NONE_CSP,
  'Strict-Transport-Security': HSTS,
  'Referrer-Policy': REFERRER,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex',
  'Cache-Control': 'no-store',
};

export function withSecurityHeaders(response: Response, headers: Readonly<Record<string, string>>): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) secured.headers.set(name, value);
  return secured;
}

/** Pages get the page set, everything else the data set. */
export function securityHeadersFor(response: Response): Readonly<Record<string, string>> {
  const type = response.headers.get('content-type') ?? '';
  return type.startsWith('text/html') ? PAGE_SECURITY_HEADERS : DATA_SECURITY_HEADERS;
}
```

`D:\scratch\vidikovac\app\public\_headers`:

```
# Static-asset security headers. Applied by the Workers static-asset layer to
# everything it serves (never to Worker-generated responses; /api/*, /ws/*,
# /hitno, /open, /open/*, /stats and /stats/* are routed to the Worker first and
# get their headers from worker/security-headers.ts). This file must equal
# APP_SECURITY_HEADERS in worker/security-headers.ts; test/open/security-headers.test.ts
# fails when they drift.
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self' wss://zagreb.aningfilm.hr https://tile.openstreetmap.org; worker-src 'self' blob:; child-src 'self' blob:; font-src 'self'; manifest-src 'self'; media-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
  Strict-Transport-Security: max-age=31536000
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Permissions-Policy: camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), browsing-topics=()
```

- [ ] **Step 4: Run the unit test, then commit**

`npx vitest run --project unit test/open/security-headers.test.ts`
Expected: 5 passed.

```
git add worker/security-headers.ts app/public/_headers test/open/security-headers.test.ts
git commit -m "Security headers: one typed policy for app assets, open pages, open data and /stats; _headers parity pinned"
```

- [ ] **Step 5: Write the failing route-header test (workers pool)**

`D:\scratch\vidikovac\test\open\security-headers.workers.test.ts`:

```ts
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../worker/env';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { handleOpen } from '../../worker/routes/open';
import { handleStats } from '../../worker/routes/stats';
import {
  DATA_SECURITY_HEADERS,
  PAGE_SECURITY_HEADERS,
  STATS_SECURITY_HEADERS,
} from '../../worker/security-headers';

const testEnv = { ...(env as unknown as Env), RL_OPEN: { limit: async () => ({ success: true }) } } as Env;

const CAP: ModuleSnapshot = {
  module: 'dhmz-cap',
  tier: 'open',
  status: 'live',
  fetchedAt: new Date().toISOString(),
  attribution: { text: 'Izvor: DHMZ', url: 'https://meteo.hr', licence: 'Otvorena dozvola' },
  items: [],
};
const getModules = async () => [CAP];

async function open(host: string, path: string) {
  const request = new Request(`https://${host}${path}`);
  const ctx = createExecutionContext();
  const response = await handleOpen(request, testEnv, ctx, new URL(request.url), { getModules });
  await waitOnExecutionContext(ctx);
  return response!;
}

function expectHeaders(response: Response, set: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(set)) expect(response.headers.get(name), name).toBe(value);
}

describe('security headers on Worker responses', () => {
  it('/hitno carries the page set and keeps its own cache-control', async () => {
    const response = await open('sec-hitno.test', '/hitno');
    expect(response.status).toBe(200);
    expectHeaders(response, PAGE_SECURITY_HEADERS);
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=60');
  });

  it('/open/*.json carries the data set and keeps CORS', async () => {
    const response = await open('sec-data.test', '/open/dhmz-cap.json');
    expect(response.status).toBe(200);
    expectHeaders(response, DATA_SECURITY_HEADERS);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('/open 404s carry the data set too', async () => {
    const response = await open('sec-404.test', '/open/nepoznato.json');
    expect(response.status).toBe(404);
    expectHeaders(response, DATA_SECURITY_HEADERS);
  });

  it('/stats carries the stats set on the fail-closed 404 and on the page', async () => {
    const denied = new Request('https://zagreb.aningfilm.hr/stats');
    const r404 = await handleStats(denied, testEnv, createExecutionContext(), new URL(denied.url), { verify: async () => false });
    expect(r404!.status).toBe(404);
    expectHeaders(r404!, STATS_SECURITY_HEADERS);

    const allowed = new Request('https://zagreb.aningfilm.hr/stats?days=7');
    const r200 = await handleStats(allowed, testEnv, createExecutionContext(), new URL(allowed.url), {
      verify: async () => true,
      loadRows: async () => [],
    });
    expect(r200!.status).toBe(200);
    expectHeaders(r200!, STATS_SECURITY_HEADERS);
    expect(r200!.headers.get('set-cookie')).toBeNull();
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

`npx vitest run --project workers test/open/security-headers.workers.test.ts`
Expected: 4 failures, each `expected null to be "default-src 'none'; ..."` for `Content-Security-Policy`.

- [ ] **Step 7: Stamp the headers in both route files**

`D:\scratch\vidikovac\worker\routes\open.ts` (full file):

```ts
import type { Env } from '../env';
import { handleHitno, type HitnoDeps } from '../hitno/route';
import { handleOpenData, type OpenDeps } from '../open/route';
import { securityHeadersFor, withSecurityHeaders } from '../security-headers';

export type OpenRouteDeps = HitnoDeps & OpenDeps;

/**
 * Open-tier dispatcher: /hitno and /open/*. Returns null for any other path
 * so worker/index.ts moves on to the next handler and finally to the asset
 * store. Every response leaving here carries the page or data security set
 * (worker/security-headers.ts). The optional fifth argument is a test seam
 * only; the dispatcher calls it with four.
 */
export async function handleOpen(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  deps: OpenRouteDeps = {},
): Promise<Response | null> {
  let response: Response | null = null;
  if (url.pathname === '/hitno' || url.pathname === '/hitno/') {
    response = await handleHitno(request, env, ctx, url, deps);
  } else if (url.pathname === '/open' || url.pathname.startsWith('/open/')) {
    response = await handleOpenData(request, env, ctx, url, deps);
  }
  return response === null ? null : withSecurityHeaders(response, securityHeadersFor(response));
}
```

`D:\scratch\vidikovac\worker\routes\stats.ts`: add the import and wrap every return. Replace the import block's first lines and the exported function with:

```ts
import type { Env } from '../env';
import { METRICS_DO_NAME, type MetricsDO, type MetricsDailyRow } from '../metrics-do';
import { zagrebDay } from '../open/time';
import { verifyAccess } from '../pairing/access';
import { STATS_SECURITY_HEADERS, withSecurityHeaders } from '../security-headers';
import { cityCsv, rawCsv } from '../stats/export';
import { DAY_MS, DEFAULT_DAYS, MAX_DAYS, renderStatsPage } from '../stats/page';
```

and rename the existing `handleStats` body to `handleStatsInner` (same signature, unchanged code), then add below it:

```ts
/** Every response under /stats, the fail-closed 404 included, carries STATS_SECURITY_HEADERS. */
export async function handleStats(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  deps: StatsDeps = {},
): Promise<Response | null> {
  const response = await handleStatsInner(request, env, ctx, url, deps);
  return response === null ? null : withSecurityHeaders(response, STATS_SECURITY_HEADERS);
}
```

(`handleStatsInner` is not exported; the `export` keyword moves from it to the wrapper.)

- [ ] **Step 8: Run all Area D tests and the typecheck, then commit**

`npx vitest run --project workers test/open/security-headers.workers.test.ts test/open/hitno.workers.test.ts test/open/open-routes.workers.test.ts test/open/stats.workers.test.ts`
Expected: all pass (4 + 6 + 8 + 9).
`npx tsc --noEmit -p worker/tsconfig.json`
Expected: no output.

```
git add worker/routes/open.ts worker/routes/stats.ts test/open/security-headers.workers.test.ts
git commit -m "Stamp security headers on every /hitno, /open and /stats response"
```

---

### Task D5: `/open/` index page, `/open` routing, robots.txt note, integration test

**Files:**
- Create: `D:\scratch\vidikovac\worker\open\index-page.ts`
- Modify: `D:\scratch\vidikovac\worker\open\route.ts`, `D:\scratch\vidikovac\wrangler.jsonc` (one token added to `run_worker_first`; shared file, additive)
- Test: `D:\scratch\vidikovac\test\open\open-index.test.ts`, `D:\scratch\vidikovac\test\open\integration.workers.test.ts`

**Interfaces:**
- Consumes: `OPEN_DATASETS`, `OPEN_LICENCE`, `PUBLISHER`, `isoDuration` (D2); `escapeHtml`, `formatZagrebDateTime` (D1); `cacheControl`, `edgeCached` (D1); the dispatcher `worker/index.ts` default export and `SELF` from `cloudflare:test`; `app/public/robots.txt` (Area C, static, currently `User-agent: *` / `Allow: /`; nothing in this area changes it, `/stats` is protected by the uniform 404 and `X-Robots-Tag: noindex`, not by robots.txt).
- Produces: `renderOpenIndex(origin: string, now: Date): string` (`worker/open/index-page.ts`); `GET /open` and `GET /open/` answered by `handleOpenData` with the HTML index, `s-maxage=3600`.

- [ ] **Step 1: Write the failing index-page test**

`D:\scratch\vidikovac\test\open\open-index.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OPEN_DATASETS } from '../../worker/open/catalog';
import { renderOpenIndex } from '../../worker/open/index-page';

const ORIGIN = 'https://zagreb.aningfilm.hr';
const NOW = new Date('2026-09-11T08:00:00Z');

describe('renderOpenIndex', () => {
  const html = renderOpenIndex(ORIGIN, NOW);

  it('is a zero-JS Croatian page listing every dataset with its distributions and attribution', () => {
    expect(html).toContain('<html lang="hr">');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<link');
    for (const d of OPEN_DATASETS) {
      expect(html).toContain(d.title);
      expect(html).toContain(d.source.text.replace(/'/g, '&#39;'));
      for (const x of d.distributions) expect(html).toContain(`href="${x.path}"`);
    }
    expect(html).toContain('href="/open/catalog.json"');
  });

  it('states refresh cadence in words and the licence once per dataset', () => {
    expect(html).toContain('svake 3 minute');
    expect(html).toContain('svakih 5 minuta');
    expect(html).toContain('svaku minutu');
    expect(html).toContain('svaki dan');
    expect((html.match(/Otvorena dozvola/g) ?? []).length).toBeGreaterThanOrEqual(OPEN_DATASETS.length);
  });

  it('makes the republishing offer to Grad Zagreb and marks adaptations', () => {
    expect(html).toContain('Ponuda Gradu Zagrebu');
    expect(html).toContain('data.zagreb.hr');
    expect(html).toContain('prilagodba izvora');
  });

  it('robots.txt stays a static asset that allows crawling', () => {
    const robots = readFileSync(fileURLToPath(new URL('../../app/public/robots.txt', import.meta.url)), 'utf8');
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Allow: /');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

`npx vitest run --project unit test/open/open-index.test.ts`
Expected: fails with `Failed to load url ../../worker/open/index-page`.

- [ ] **Step 3: Write the index page**

`D:\scratch\vidikovac\worker\open\index-page.ts`:

```ts
// /open/ as HTML: the catalogue for people, with the same facts the JSON-LD
// carries and the standing offer to the City. Zero JS, one inline <style>,
// no external request (page security set, Task D4).
import { escapeHtml } from './html';
import { OPEN_DATASETS, OPEN_LICENCE, PUBLISHER, type OpenDataset } from './catalog';
import { formatZagrebDateTime } from './time';

export function cadenceWords(ttl: number): string {
  if (ttl % 86400 === 0) {
    const d = ttl / 86400;
    return d === 1 ? 'svaki dan' : `svakih ${d} dana`;
  }
  if (ttl % 3600 === 0) {
    const h = ttl / 3600;
    return h === 1 ? 'svaki sat' : `svakih ${h} sati`;
  }
  const m = Math.round(ttl / 60);
  if (m === 1) return 'svaku minutu';
  if (m >= 2 && m <= 4) return `svake ${m} minute`;
  return `svakih ${m} minuta`;
}

const STYLE = `
:root{color-scheme:dark light;--bg:#0b1020;--fg:#e8ecf5;--muted:#9aa5bf;--accent:#7cd4ff;--line:rgba(232,236,245,.16);--card:#121a30}
@media (prefers-color-scheme:light){:root{--bg:#f7f3ea;--fg:#14181f;--muted:#5a6172;--accent:#005f8a;--line:rgba(20,24,31,.16);--card:#fffdf8}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--fg);font:1.125rem/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
.wrap{max-width:46rem;margin:0 auto;padding:1.25rem 1.25rem 4rem}
.brand{font-weight:600;letter-spacing:.02em;text-decoration:none;color:var(--muted)}
h1{font-size:clamp(2rem,6vw,3rem);line-height:1.05;margin:.4rem 0 .5rem;letter-spacing:-.02em}
.lede{margin:0 0 1.5rem}
article{margin:0 0 1.5rem;padding:1rem 1.1rem;border:1px solid var(--line);border-radius:14px;background:var(--card)}
h2{margin:0 0 .35rem;font-size:1.35rem;line-height:1.25}
.meta{color:var(--muted);font-size:1rem;margin:0 0 .5rem}
ul.dl{list-style:none;padding:0;margin:.5rem 0 0;display:flex;flex-wrap:wrap;gap:.5rem}
ul.dl a{display:inline-block;padding:.3rem .75rem;border:1px solid var(--line);border-radius:999px;text-decoration:none}
.src{margin:.75rem 0 0;padding-top:.5rem;border-top:1px dashed var(--line);color:var(--muted);font-size:.95rem}
.offer{margin:2rem 0;padding:1rem 1.1rem;border-left:4px solid var(--accent)}
footer{color:var(--muted);font-size:.95rem}
`;

function datasetCard(d: OpenDataset): string {
  return (
    `<article id="${escapeHtml(d.module)}">` +
    `<h2>${escapeHtml(d.title)}</h2>` +
    `<p class="meta">Osvježava se ${escapeHtml(cadenceWords(d.ttl))} · ${escapeHtml(d.keywords.join(', '))}</p>` +
    `<p>${escapeHtml(d.description)}</p>` +
    `<ul class="dl">` +
    d.distributions
      .map((x) => `<li><a href="${escapeHtml(x.path)}" type="${escapeHtml(x.mediaType)}">${escapeHtml(x.format)}</a></li>`)
      .join('') +
    `</ul>` +
    `<p class="src">${escapeHtml(d.source.text)} · ${escapeHtml(d.source.licence)} · ` +
    `<a href="${escapeHtml(d.source.url)}" rel="noopener">izvornik</a>. Objavljeno pod: Otvorena dozvola. Prikaz je prilagodba izvora.</p>` +
    `</article>`
  );
}

export function renderOpenIndex(origin: string, now: Date): string {
  return `<!doctype html>
<html lang="hr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>Otvoreni podaci · Vidikovac</title>
<meta name="description" content="Izvedeni otvoreni podaci o Zagrebu koje Vidikovac koristi u stvarnom vremenu: upozorenja DHMZ-a, potresi, prometnice, sigurnosne točke. Otvorena dozvola, DCAT katalog.">
<link rel="alternate" type="application/ld+json" href="/open/catalog.json">
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<header>
<a class="brand" href="/">Vidikovac</a>
<h1>Otvoreni podaci</h1>
<p class="lede">Sve što nadzorna ploča prikazuje bez skeniranja objavljeno je i kao strojno čitljiv skup. Isti podaci, isti izvori, ista atribucija; bez ograničenja trajanja. Katalog u obliku DCAT-AP: <a href="/open/catalog.json">catalog.json</a>.</p>
</header>
<main>
${OPEN_DATASETS.map(datasetCard).join('\n')}
<aside class="offer" aria-labelledby="h-ponuda">
<h2 id="h-ponuda">Ponuda Gradu Zagrebu</h2>
<p>Svaki skup na ovoj stranici Grad Zagreb može preuzeti i ponovno objaviti na <a href="https://data.zagreb.hr/" rel="noopener">data.zagreb.hr</a> pod Otvorenom dozvolom, bez daljnjeg odobrenja i bez naknade. Katalog <a href="/open/catalog.json">/open/catalog.json</a> dovoljan je za automatsko preuzimanje; izvorni kod koji ga proizvodi objavljen je pod licencom AGPL-3.0-or-later, a Gradu se nudi i pod EUPL-1.2.</p>
</aside>
</main>
<footer>
<p>Izdavač: ${escapeHtml(PUBLISHER.name)} · Licenca: <a href="${escapeHtml(OPEN_LICENCE.url)}" rel="noopener">${escapeHtml(OPEN_LICENCE.title)}</a> · Stanje ${escapeHtml(formatZagrebDateTime(now))}</p>
<p>Sadrži informacije tijela javne vlasti u skladu s Otvorenom dozvolom. Izvorni skupovi i vrijeme zadnje izmjene navedeni su uz svaki skup; ovaj prikaz nije službena objava tijela koja podatke izdaju.</p>
<p><a href="/hitno">Hitno</a> · <a href="/izvori/">Izvori i licence</a> · <a href="/privatnost/">Privatnost</a></p>
</footer>
</div>
</body>
</html>
`;
}
```

Note on the `<link rel="alternate">`: the index test asserts `not.toContain('<link')`. Remove that `<link>` line from the template before running; the catalogue link already exists as an `<a>` in the lede, and the page policy's `default-src 'none'` makes any fetched `<link>` moot. Final template head is `<meta ...>` lines and `<style>` only.

- [ ] **Step 4: Run the index test, then commit**

`npx vitest run --project unit test/open/open-index.test.ts`
Expected: 4 passed.

```
git add worker/open/index-page.ts test/open/open-index.test.ts
git commit -m "/open/ index: datasets, cadence, attribution and the republishing offer to Grad Zagreb"
```

- [ ] **Step 5: Write the failing integration test**

`D:\scratch\vidikovac\test\open\integration.workers.test.ts`:

```ts
// Final check of Area D through the real dispatcher (worker/index.ts): the
// routes are reached, the headers are on, the 404s are uniform. /hitno is
// exercised through handleOpen with a fake feed (no fetchMock in this pool
// version) and through the dispatcher only for the method gate, which answers
// before any upstream call.
import { SELF, createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../worker/env';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import worker from '../../worker/index';
import { handleOpen } from '../../worker/routes/open';
import { DATA_SECURITY_HEADERS, PAGE_SECURITY_HEADERS, STATS_SECURITY_HEADERS } from '../../worker/security-headers';

const testEnv = env as unknown as Env;

const CAP: ModuleSnapshot = {
  module: 'dhmz-cap',
  tier: 'open',
  status: 'live',
  fetchedAt: new Date().toISOString(),
  attribution: { text: 'Izvor: DHMZ, Otvorena dozvola', url: 'https://meteo.hr/upozorenja/cap_hr_today.xml', licence: 'Otvorena dozvola' },
  items: [
    {
      id: 'w',
      module: 'dhmz-cap',
      kind: 'warning',
      tier: 'open',
      title: 'Crveno upozorenje za obilnu kišu',
      severity: 'extreme',
      at: new Date(Date.now() - 60_000).toISOString(),
      until: new Date(Date.now() + 3_600_000).toISOString(),
    },
  ],
};

describe('Area D through the Worker', () => {
  it('GET /hitno renders the warning in words with the page security set', async () => {
    const request = new Request('https://integ-hitno.test/hitno');
    const ctx = createExecutionContext();
    const response = await handleOpen(request, { ...testEnv, RL_OPEN: { limit: async () => ({ success: true }) } }, ctx, new URL(request.url), {
      getModules: async () => [CAP],
    });
    await waitOnExecutionContext(ctx);
    expect(response!.status).toBe(200);
    const html = await response!.text();
    expect(html).toContain('Crveno upozorenje za obilnu kišu');
    expect(html).toContain('<span class="sev sev-extreme">izuzetno</span>');
    expect(html).toContain('href="tel:112"');
    for (const [k, v] of Object.entries(PAGE_SECURITY_HEADERS)) expect(response!.headers.get(k)).toBe(v);
  });

  it('the dispatcher routes /hitno to Area D (405 for POST arrives before any feed call)', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request('https://zagreb.aningfilm.hr/hitno', { method: 'POST' }), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });

  it('GET /open/catalog.json answers as specified through SELF', async () => {
    const response = await SELF.fetch('https://zagreb.aningfilm.hr/open/catalog.json');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    for (const [k, v] of Object.entries(DATA_SECURITY_HEADERS)) expect(response.headers.get(k)).toBe(v);
    const body = (await response.json()) as { '@type': string; 'dct:license': string; 'dcat:dataset': { 'dct:identifier': string }[] };
    expect(body['@type']).toBe('dcat:Catalog');
    expect(body['dct:license']).toBe('https://data.gov.hr/otvorena-dozvola');
    expect(body['dcat:dataset'].map((d) => d['dct:identifier'])).toEqual(['dhmz-cap', 'emsc', 'prometnice', 'ckan-geo']);
  });

  it('GET /open/ and GET /open serve the HTML index with the page set', async () => {
    for (const path of ['/open/', '/open']) {
      const response = await SELF.fetch(`https://zagreb.aningfilm.hr${path}`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=3600');
      for (const [k, v] of Object.entries(PAGE_SECURITY_HEADERS)) expect(response.headers.get(k)).toBe(v);
      const html = await response.text();
      expect(html).toContain('Ponuda Gradu Zagrebu');
      expect(html).toContain('href="/open/prometnice.geojson"');
    }
  });

  it('GET /open/<unknown>.json is a uniform JSON 404 without any upstream call', async () => {
    const response = await SELF.fetch('https://zagreb.aningfilm.hr/open/nepoznato.json');
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'not-found' });
  });

  it('GET /stats without Access is the uniform 404 with the stats set', async () => {
    for (const path of ['/stats', '/stats/data.json', '/stats/export.csv', '/stats/grad.csv', '/stats/x']) {
      const response = await SELF.fetch(`https://zagreb.aningfilm.hr${path}`);
      expect(response.status, path).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: 'not-found' });
      for (const [k, v] of Object.entries(STATS_SECURITY_HEADERS)) expect(response.headers.get(k), `${path} ${k}`).toBe(v);
    }
  });

  it('/api/health is untouched by Area D headers', async () => {
    const response = await SELF.fetch('https://zagreb.aningfilm.hr/api/health');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toBeNull();
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

`npx vitest run --project workers test/open/integration.workers.test.ts`
Expected: the `/open/` case fails with `expected 404 to be 200` (index not implemented); the others pass.

- [ ] **Step 7: Serve the index and route bare `/open`**

`D:\scratch\vidikovac\worker\open\route.ts`: add `import { renderOpenIndex } from './index-page';` and, inside `handleOpenData`, replace the line `let produced: { response: Response } | null = null;` and the `if (path === '/open/catalog.json')` chain head with:

```ts
  let produced: { response: Response } | null = null;

  if (path === '/open' || path === '/open/') {
    const indexKey = new Request(`${url.origin}/open/`, { method: 'GET' });
    produced = await edgeCached(ctx, indexKey, async () =>
      new Response(renderOpenIndex(url.origin, now()), {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-language': 'hr',
          'cache-control': cacheControl(CATALOG_TTL_SECONDS),
        },
      }),
    );
  } else if (path === '/open/catalog.json') {
```

(the rest of the chain, `else if (path === '/open/prometnice.geojson')` and the module match, stays as written in D2).

`D:\scratch\vidikovac\wrangler.jsonc`: change the `run_worker_first` line to

```jsonc
    "run_worker_first": ["/api/*", "/ws/*", "/hitno", "/hitno/*", "/open", "/open/*", "/stats", "/stats/*"],
```

(`/open/*` does not match `/open`; without this token the bare path falls to the asset store's 404 page.)

- [ ] **Step 8: Run the whole Area D suite, the typecheck and the build, then commit**

`npx vitest run --project workers test/open/integration.workers.test.ts`
Expected: 7 passed.
`npx vitest run test/open`
Expected: every Area D file passes in both projects (unit: time, hitno-select, hitno-render, catalog, catalog-registry, geojson, stats-export, stats-page, security-headers, open-index; workers: hitno, open-routes, stats, security-headers, integration).
`npm run typecheck`
Expected: no output.
`npm run build`
Expected: vite build writes `app/dist/_headers` next to `robots.txt` (copied from `app/public`), then the worker typecheck passes.

```
git add worker/open/route.ts wrangler.jsonc test/open/integration.workers.test.ts
git commit -m "/open index page, bare /open routed to the Worker, Area D integration test"
```

- [ ] **Step 9: Deploy check (after `git push` by the integrator)**

Read-only verification against production once the Workers Build is green:

```
curl -sI https://zagreb.aningfilm.hr/hitno | grep -i -E "^(content-security-policy|cache-control|content-language|strict-transport)"
curl -s https://zagreb.aningfilm.hr/open/catalog.json | head -c 400
curl -sI https://zagreb.aningfilm.hr/stats | head -1
curl -sI https://zagreb.aningfilm.hr/ | grep -i -E "^(content-security-policy|permissions-policy)"
```

Expected: `/hitno` shows `default-src 'none'...`, `public, max-age=0, s-maxage=60`, `content-language: hr`; the catalogue starts with `{"@context"`; `/stats` answers `HTTP/2 404`; `/` carries the `_headers` policy (the asset layer, not the Worker).

---

### Critical Files for Implementation
- `D:\scratch\vidikovac\worker\hitno\render.ts` (the zero-JS safety page; every attribution, severity word and empty state lives here)
- `D:\scratch\vidikovac\worker\open\route.ts` (catalog, module snapshots, GeoJSON, index; edge cache and RL_OPEN discipline)
- `D:\scratch\vidikovac\worker\stats\export.ts` (the City folding and rounding rules from design section 3)
- `D:\scratch\vidikovac\worker\routes\stats.ts` (fail-closed two-gate boundary over Area B's `verifyAccess` and MetricsDO)
- `D:\scratch\vidikovac\worker\security-headers.ts` (one typed policy; `app/public/_headers` must equal `APP_SECURITY_HEADERS`)


## Area E: Verification, tooling, documentation, video, grant documents

aceGrotesk` and `@remotion/google-fonts/Inter` (`loadFont(style, { weights, subsets })` returning `{ fontFamily }`); colours from `app/index.html` (night `#0b1020`, fg `#e8ecf5`, muted `#9aa5bf`, accent `#7cd4ff`, paper `#f7f3ea`).
- Produces: compositions `TitleCard` (1920x1080, 30 fps, 120 frames) and `EndCard` (1920x1080, 30 fps, 180 frames); `docs/video/shot-list.md` table whose durations sum to 90 s (Task E5's test and the cut depend on it); render outputs `video/out/title.mp4`, `video/out/end.mp4`.

- [ ] **Step 1: Write the failing shot-list test**

Create `test/video/shot-list.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

interface Shot {
  n: number;
  from: number;
  to: number;
  seconds: number;
  source: string;
}

/** Parses the shot table: | # | Od | Do | s | Kadar | Izvor | Tekst/titl | */
export function parseShotList(md: string): Shot[] {
  const rows = md.split('\n').filter((l) => /^\| \d+ \|/.test(l));
  return rows.map((l) => {
    const c = l.split('|').map((s) => s.trim());
    return { n: Number(c[1]), from: Number(c[2]), to: Number(c[3]), seconds: Number(c[4]), source: c[6] };
  });
}

describe('docs/video/shot-list.md', () => {
  const shots = parseShotList(readFileSync(new URL('../../docs/video/shot-list.md', import.meta.url), 'utf8'));

  it('has fourteen contiguous shots that sum to exactly 90 seconds', () => {
    expect(shots).toHaveLength(14);
    expect(shots.reduce((n, s) => n + s.seconds, 0)).toBe(90);
    expect(shots[0].from).toBe(0);
    expect(shots.at(-1)!.to).toBe(90);
    for (let i = 0; i < shots.length; i++) {
      expect(shots[i].to - shots[i].from, `shot ${shots[i].n}`).toBe(shots[i].seconds);
      if (i > 0) expect(shots[i].from, `shot ${shots[i].n} starts where ${shots[i - 1].n} ends`).toBe(shots[i - 1].to);
    }
  });

  it('opens and closes with the Remotion cards and names a source for every shot', () => {
    expect(shots[0].source).toBe('Remotion TitleCard');
    expect(shots.at(-1)!.source).toBe('Remotion EndCard');
    for (const s of shots) expect(s.source.length, `shot ${s.n} has no source`).toBeGreaterThan(0);
  });

  it('card durations match the Remotion compositions (4 s title, 6 s end)', () => {
    expect(shots[0].seconds).toBe(4);
    expect(shots.at(-1)!.seconds).toBe(6);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
npx vitest run --project unit test/video/shot-list.test.ts
```

Expected: `ENOENT ... docs/video/shot-list.md`.

- [ ] **Step 3: Write `docs/video/shot-list.md`**

````markdown
# Demo video, 90 sekundi, 1920x1080, 30 fps

Hrvatski govor ili hrvatski titlovi urezani u sliku, engleski titlovi kao zasebna `.srt` datoteka. Snimanje u kafiću u ponedjeljak 14. 9. navečer (zaslon na Wi-Fiju prostora, telefon na mobilnim podacima, jedan iPhone i jedan Android), snimke zaslona u utorak 15. 9. ujutro protiv produkcije. Rez u DaVinci Resolveu; naslovna i završna kartica iz `video/` (Remotion). Video pokazuje samo ono što je gotovo.

| # | Od | Do | s | Kadar | Izvor | Tekst ili titl (hr) |
|---|---|---|---|---|---|---|
| 1 | 0 | 4 | 4 | Naslovna kartica: kicker, naslov, prsten QR-a | Remotion TitleCard | Dobro došli u budućnost. Zagreb, povezan. |
| 2 | 4 | 10 | 6 | Širok kadar kafića, zaslon na zidu u teaseru: sigurnosna traka, kartica vremena, QR u prstenu | Telefon, kafić | Javni zaslon. Čitljiv svima, bez telefona. |
| 3 | 10 | 16 | 6 | Krupni plan: telefon kamerom hvata rotirajući QR; kod ispisan u dvije skupine | Telefon, kafić | Skeniraj. Bez aplikacije, bez računa. |
| 4 | 16 | 22 | 6 | Dvostruki kadar: zaslon i telefon otključavaju se istodobno | Telefon, kafić | Oba uređaja se otključavaju u sekundi. |
| 5 | 22 | 26 | 4 | Krupni plan kartice potvrde na telefonu: "Zaslon: kafić, Donji grad, 10 minuta", gumb Otključaj | Telefon, kafić | Znaš što otključavaš i koliko traje. |
| 6 | 26 | 32 | 6 | Prijatelj skenira kod s telefona prve osobe ("Podijeli grad"), dobiva pet minuta | Telefon, kafić | Podijeli grad: pet minuta za drugu osobu. |
| 7 | 32 | 40 | 8 | Snimka zaslona: sloj Grad sada s upozorenjem DHMZ-a (CAP), vremenom i brojem ZET vozila | Snimka zaslona, /d/ | Sve u stvarnom vremenu, iz otvorenih podataka. |
| 8 | 40 | 48 | 8 | Snimka zaslona: U pokretu, karta sa ZET vozilima i zatvorenim prometnicama | Snimka zaslona, /d/ | ZET uživo. Zatvorene ceste na karti. |
| 9 | 48 | 54 | 6 | Snimka zaslona: Zrak i nebo, potresi EMSC-a i zrak | Snimka zaslona, /d/ | Potresi, zrak, nebo. |
| 10 | 54 | 60 | 6 | Snimka zaslona: Vijesti (HRT s poveznicom), izvoz "Kopiraj s izvorom" i ICS | Snimka zaslona, /d/ | Svaki podatak nosi izvor. Sve se može izvesti. |
| 11 | 60 | 68 | 8 | Snimka zaslona: odbrojavanje, upozorenje 60 s, istek: prikaz zamrznut, /hitno ostaje otvoren | Snimka zaslona, /d/ i /hitno | Deset minuta. Zatim se prikaz zamrzne, a sigurnosni sloj ostaje otvoren svima. |
| 12 | 68 | 76 | 8 | Snimka zaslona: /stats brojači bez identifikatora | Snimka zaslona, /stats | Gradu Zagrebu: anonimni zbrojevi po satu i četvrti. Bez IP adresa, bez kolačića. |
| 13 | 76 | 84 | 8 | Zaslon se vraća na teaser, novi QR u prstenu; osoblje briše stol | Telefon, kafić | Zaslon čeka sljedeću osobu. |
| 14 | 84 | 90 | 6 | Završna kartica: adresa, licenca, atribucije | Remotion EndCard | zagreb.aningfilm.hr · AGPL-3.0-or-later · izvori |

## Snimanje i rez

- Telefon vodoravno, 1080p 30 fps, zaključana ekspozicija na zaslonu (zaslon je izvor svjetla). Snimiti svaki kadar dva puta.
- Snimke zaslona: Chrome u prozoru 1920x1080, `chrome --window-size=1920,1080 --force-device-scale-factor=1`, snimanje s OBS-om ili `ffmpeg -f gdigrab`, bez pokazivača gdje nije potreban.
- Titlovi hr urezani (Inter 44 px, podloga 60 % crne); en `.srt` s istim vremenima iz ove tablice.
- Konačni izvoz: `ffmpeg -i rez.mov -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p -c:a aac -b:a 160k demo.mp4`. Ako je datoteka ispod 25 MiB, ide u `app/public/demo.mp4` (granica Cloudflare statičkih datoteka je 25 MiB); inače u R2 javni bucket, a `/demo.mp4` preusmjerava.
- Uvijek i neizlistan YouTube upload; poveznica u prijavi i u README-u.
````

- [ ] **Step 4: Run the shot-list test**

```
npx vitest run --project unit test/video/shot-list.test.ts
```

Expected: `Tests 3 passed`.

- [ ] **Step 5: Scaffold the Remotion project files**

Create `video/package.json`:

```json
{
  "name": "vidikovac-video",
  "private": true,
  "type": "module",
  "scripts": {
    "studio": "remotion studio src/index.ts",
    "check": "tsc --noEmit",
    "compositions": "remotion compositions src/index.ts",
    "still:title": "remotion still src/index.ts TitleCard out/title-check.png --frame=90",
    "still:end": "remotion still src/index.ts EndCard out/end-check.png --frame=150",
    "render:title": "remotion render src/index.ts TitleCard out/title.mp4 --codec=h264 --crf=18",
    "render:end": "remotion render src/index.ts EndCard out/end.mp4 --codec=h264 --crf=18",
    "render": "npm run render:title && npm run render:end"
  },
  "dependencies": {
    "@remotion/cli": "4.0.518",
    "@remotion/google-fonts": "4.0.518",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "remotion": "4.0.518"
  },
  "devDependencies": {
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "typescript": "^6.0.3"
  }
}
```

Create `video/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "resolveJsonModule": true
  },
  "include": ["src", "remotion.config.ts"]
}
```

Create `video/remotion.config.ts`:

```ts
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
```

Create `video/.gitignore`:

```
node_modules/
out/
.remotion/
```

Create `video/src/index.ts`:

```ts
import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';

registerRoot(RemotionRoot);
```

Create `video/src/theme.ts`:

```ts
// The dashboard's layer-1 tokens, mirrored for the two cards so the video and
// the product share one canvas: deep night blue, paper white, one cool accent.
export const COLORS = {
  night: '#0b1020',
  fg: '#e8ecf5',
  muted: '#9aa5bf',
  accent: '#7cd4ff',
  paper: '#f7f3ea',
} as const;

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
/** Safe area for 1920x1080: 140 px sides, 180 px top and bottom (scaled from the 80/100 rule at 1080 wide). */
export const SAFE = { x: 140, y: 180 } as const;
export const TITLE_SECONDS = 4;
export const END_SECONDS = 6;
```

- [ ] **Step 6: Write the compositions**

Create `video/src/Root.tsx`:

```tsx
import React from 'react';
import { Composition } from 'remotion';
import { EndCard } from './EndCard';
import { TitleCard } from './TitleCard';
import { END_SECONDS, FPS, HEIGHT, TITLE_SECONDS, WIDTH } from './theme';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="TitleCard"
      component={TitleCard}
      durationInFrames={TITLE_SECONDS * FPS}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
    <Composition
      id="EndCard"
      component={EndCard}
      durationInFrames={END_SECONDS * FPS}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  </>
);
```

Create `video/src/TitleCard.tsx`:

```tsx
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont as loadSpaceGrotesk } from '@remotion/google-fonts/SpaceGrotesk';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { COLORS, SAFE } from './theme';

const display = loadSpaceGrotesk('normal', { weights: ['700'], subsets: ['latin', 'latin-ext'] });
const body = loadInter('normal', { weights: ['500'], subsets: ['latin', 'latin-ext'] });

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** The QR ring from the kiosk: the only continuous motion in the product, and here. */
const Ring: React.FC<{ progress: number }> = ({ progress }) => {
  const r = 54;
  const circumference = 2 * Math.PI * r;
  return (
    <svg
      width={140}
      height={140}
      viewBox="0 0 140 140"
      style={{ position: 'absolute', right: SAFE.x, bottom: SAFE.y - 40 }}
      aria-hidden
    >
      <circle cx={70} cy={70} r={r} fill="none" stroke={COLORS.fg} strokeOpacity={0.15} strokeWidth={6} />
      <circle
        cx={70}
        cy={70}
        r={r}
        fill="none"
        stroke={COLORS.accent}
        strokeWidth={6}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
        style={{ rotate: '-90deg', transformOrigin: '70px 70px' }}
      />
    </svg>
  );
};

export const TitleCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.night,
        color: COLORS.fg,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: interpolate(frame, [durationInFrames - 12, durationInFrames], [1, 0], CLAMP),
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 32,
          maxWidth: 1920 - SAFE.x * 2,
          padding: `0 ${SAFE.x}px`,
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontFamily: body.fontFamily,
            fontWeight: 500,
            fontSize: 48,
            letterSpacing: '0.01em',
            color: COLORS.muted,
            opacity: interpolate(frame, [0, 24], [0, 1], { ...CLAMP, easing: EASE_OUT }),
            translate: `0px ${interpolate(frame, [0, 24], [16, 0], { ...CLAMP, easing: EASE_OUT })}px`,
          }}
        >
          Dobro došli u budućnost.
        </div>
        <div
          style={{
            fontFamily: display.fontFamily,
            fontWeight: 700,
            fontSize: 172,
            lineHeight: 1,
            letterSpacing: '-0.02em',
            opacity: interpolate(frame, [18, 54], [0, 1], { ...CLAMP, easing: EASE_OUT }),
            translate: `0px ${interpolate(frame, [18, 54], [48, 0], { ...CLAMP, easing: EASE_OUT })}px`,
          }}
        >
          Zagreb, povezan.
        </div>
      </div>
      <Ring progress={interpolate(frame, [0, durationInFrames], [0, 1], CLAMP)} />
    </AbsoluteFill>
  );
};
```

Create `video/src/EndCard.tsx`:

```tsx
import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { loadFont as loadSpaceGrotesk } from '@remotion/google-fonts/SpaceGrotesk';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { COLORS, SAFE } from './theme';

const display = loadSpaceGrotesk('normal', { weights: ['700'], subsets: ['latin', 'latin-ext'] });
const body = loadInter('normal', { weights: ['400', '500'], subsets: ['latin', 'latin-ext'] });

const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

// Verbatim strings from docs/izvori.md; the end card is one of the four
// attribution places the plan requires.
const ATTRIBUTIONS = [
  'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669',
  'Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom',
  'Izvor: DHMZ, Otvorena dozvola',
  'Izvor: EMSC, seismicportal.eu',
  'Izvor: HRT, poveznica na izvornik',
];

const Line: React.FC<{ from: number; children: React.ReactNode; style?: React.CSSProperties }> = ({
  from,
  children,
  style,
}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        opacity: interpolate(frame, [from, from + 20], [0, 1], { ...CLAMP, easing: EASE_OUT }),
        translate: `0px ${interpolate(frame, [from, from + 20], [14, 0], { ...CLAMP, easing: EASE_OUT })}px`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.night,
        color: COLORS.fg,
        opacity: interpolate(frame, [durationInFrames - 15, durationInFrames], [1, 0], CLAMP),
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: `${SAFE.y}px ${SAFE.x}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Line from={0} style={{ fontFamily: display.fontFamily, fontWeight: 700, fontSize: 120, lineHeight: 1, letterSpacing: '-0.02em' }}>
            zagreb.aningfilm.hr
          </Line>
          <Line from={10} style={{ fontFamily: body.fontFamily, fontWeight: 500, fontSize: 52, color: COLORS.muted }}>
            Otvoreni kod: AGPL-3.0-or-later. Izvedeni podaci: Otvorena dozvola.
          </Line>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Line from={30} style={{ fontFamily: body.fontFamily, fontWeight: 500, fontSize: 40, color: COLORS.accent }}>
            Izgrađeno na otvorenim podacima
          </Line>
          {ATTRIBUTIONS.map((text, i) => (
            <Line
              key={text}
              from={40 + i * 12}
              style={{ fontFamily: body.fontFamily, fontWeight: 400, fontSize: 36, lineHeight: 1.25, color: COLORS.fg, maxWidth: 1640 }}
            >
              {text}
            </Line>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 7: Install, typecheck, list compositions, render a still and both cards**

```
cd video
npm install
npm run check
npm run compositions
npm run still:title
npm run still:end
npm run render
```

Expected: `npm run check` prints nothing; `npm run compositions` lists `TitleCard 1920x1080 30fps 120 frames` and `EndCard 1920x1080 30fps 180 frames`; the stills appear at `video/out/title-check.png` and `video/out/end-check.png` (open both: one focal message each, nothing overlapping, text inside the safe area); `npm run render` writes `video/out/title.mp4` (4 s) and `video/out/end.mp4` (6 s).

- [ ] **Step 8: Commit**

```
cd ..
git add docs/video/shot-list.md test/video/shot-list.test.ts video/package.json video/package-lock.json video/tsconfig.json video/remotion.config.ts video/.gitignore video/src
git commit -m "Demo video: 90-second shot list and Remotion title and end cards" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task E6: The grant documents in Croatian (docs/prijava)

**Files:**
- Create: `D:\scratch\vidikovac\docs\prijava\prijedlog-projekta.md`
- Create: `D:\scratch\vidikovac\docs\prijava\obrazac-3-financijski-plan.md`
- Create: `D:\scratch\vidikovac\docs\prijava\plan-provedbe.md`
- Create: `D:\scratch\vidikovac\docs\prijava\rizici-i-odgovori.md`
- Test: `D:\scratch\vidikovac\test\docs\prijava.test.ts`

**Interfaces:**
- Consumes: the plan's section 4 (criteria, budget rows, work plan, objections), `docs/izvori.md` (source list), `docs/arhitektura.md`.
- Produces: the application text pasted into the Word proposal (item 8 of call točka 4) and into Obrazac 2.2 and Obrazac 3; fill-in fields are marked `[[POPUNITI: ...]]` and are the only thing Matija completes before filing (Task E7 refuses to pass with `--filing` while any remain).

- [ ] **Step 1: Write the failing test for the application's structure and arithmetic**

Create `test/docs/prijava.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../../docs/prijava/${p}`, import.meta.url), 'utf8');
const headingIndex = (md: string, heading: string) => {
  const i = md.indexOf(`\n${heading}\n`);
  if (i === -1) throw new Error(`heading not found: ${heading}`);
  return i;
};
const eur = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

describe('prijedlog-projekta.md', () => {
  const md = read('prijedlog-projekta.md');
  it('has the five mandatory item-8 headings in order', () => {
    const order = [
      '## 1. Popis funkcionalnosti',
      '## 2. Potencijalni profil korisnika',
      '## 3. Tip rješenja',
      '## 4. Obrazloženje interesa projekta za Grad Zagreb',
      '## 5. Popis otvorenih podataka koji bi se koristili',
    ].map((h) => headingIndex(md, h));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('has one section per Prilog 1 criterion in the 2026 order with the points stated', () => {
    const order = [
      '### 6.1 Dosadašnje iskustvo prijavitelja u razvojnim ili istraživačkim programima (0–10 bodova)',
      '### 6.2 Kapacitet prijavitelja za provedbu projekta (0–10 bodova)',
      '### 6.3 Tehnička izvedivost (0–10 bodova)',
      '### 6.4 Društvena korist (0–30 bodova)',
      '### 6.5 Inovativnost (0–20 bodova)',
      '### 6.6 Konačni proizvod pod licencom otvorenog koda ili u javnom dobru (0–10 bodova)',
      '### 6.7 Kvaliteta financijskog plana i obrazloženje troškova (0–10 bodova)',
    ].map((h) => headingIndex(md, h));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('never addresses the reader as Vi and uses the singular imperative in UI quotes', () => {
    expect(md).not.toMatch(/\bVi\b|\bVaš/);
    expect(md).toContain('Skeniraj');
  });
});

describe('obrazac-3-financijski-plan.md', () => {
  const md = read('obrazac-3-financijski-plan.md');
  const rows = md.split('\n').filter((l) => /^\| [1-5]\. /.test(l));
  const amounts = rows.map((l) => eur(l.split('|').map((s) => s.trim()).at(-2)!));
  it('has exactly the five rows of Obrazac 3 with the approved amounts', () => {
    expect(amounts).toEqual([6300, 11090, 1200, 320, 1090]);
  });
  it('sums to 20,000 EUR without VAT and keeps promotion at or above 5 percent', () => {
    const total = amounts.reduce((a, b) => a + b, 0);
    expect(total).toBe(20000);
    expect(amounts[2] / total).toBeGreaterThanOrEqual(0.05);
    expect(md).toContain('20.000,00');
    expect(md).toContain('bez PDV-a');
  });
  it('states the hourly formula and the 10.00 EUR alternative that still sums to 20,000', () => {
    expect(md).toContain('1.720');
    expect(md).toContain('12,60');
    expect(md).toContain('10,00');
    expect(md).toContain('5.000,00');
    expect(md).toContain('12.390,00');
  });
});

describe('plan-provedbe.md and rizici-i-odgovori.md', () => {
  it('has milestones M0 to M7 in order', () => {
    const md = read('plan-provedbe.md');
    const idx = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7'].map((m) => headingIndex(md, `### ${m}`.slice(0, 6)) );
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });
  it('answers exactly seven committee objections', () => {
    const md = read('rizici-i-odgovori.md');
    expect(md.match(/^### \d\. /gm)).toHaveLength(7);
  });
});
```

Note on the M-heading lookup: `plan-provedbe.md` headings are written as `### M0 ...`, so `headingIndex(md, '### M0')` must match a whole line; replace that line of the test with `const idx = [...].map((m) => { const i = md.indexOf(`\n### ${m} `); if (i === -1) throw new Error(m); return i; });` when writing it.

- [ ] **Step 2: Run it and watch it fail**

```
npx vitest run --project unit test/docs/prijava.test.ts
```

Expected: `ENOENT ... docs/prijava/prijedlog-projekta.md`.

- [ ] **Step 3: Write `docs/prijava/prijedlog-projekta.md`**

````markdown
# Prijedlog projekta: Vidikovac. Zagreb, povezan.

**Prijavitelj:** Aning Film d.o.o., [[POPUNITI: adresa sjedišta]], OIB [[POPUNITI: OIB]]. Zakonski zastupnik: Matija Radeljak, direktor.
**Javni poziv:** za dodjelu potpora male vrijednosti za financiranje projekata korištenja otvorenih podataka za 2026.
**Zatraženi iznos:** 20.000,00 EUR (bez PDV-a). **Trajanje:** 10 mjeseci od potpisa ugovora, unutar 31. 12. 2027.
**Prototip:** https://zagreb.aningfilm.hr · **Izvorni kod:** https://github.com/matijarma/vidikovac (AGPL-3.0-or-later) · **Video (90 s):** [[POPUNITI: poveznica na video nakon 15. 9.]]

## Sažetak

Vidikovac je pogled na Zagreb u stvarnom vremenu, izgrađen isključivo na otvorenim podacima Grada Zagreba, ZET-a, DHMZ-a, EMSC-a i drugih javnih izvora, koji se otključava na deset minuta skeniranjem rotirajućeg QR koda s javnog zaslona u kafiću, knjižnici, uredu gradske četvrti ili prostoru udruge, ili na pet minuta s telefona druge osobe koja ga upravo gleda. Nitko ništa ne plaća: plaća se prisutnošću i pažnjom. Sigurnosni sloj (upozorenja DHMZ-a, potresi, zatvorene prometnice, dežurne ljekarne, zborna mjesta civilne zaštite, planirani prekidi) otvoren je svima, bez skeniranja i bez ograničenja trajanja. Javni zasloni su čitljivi i bez telefona. Sav kod je otvoren, svi izvedeni podaci su otvoreni, a Grad Zagreb mjesečno dobiva anonimne, identifikatorima neopterećene zbrojeve korištenja po satu, četvrti i vrsti prostora, kao podatak o potražnji za gradskim informacijama koji danas ne postoji. Prototip je javno dostupan prije roka prijave.

## 1. Popis funkcionalnosti

### 1.1 Otvoreni sloj, dostupan svima bez skeniranja

Stranica `/hitno` prikazuje se bez JavaScripta, na svakom uređaju i u svakom pregledniku, i može se ispisati: važeća upozorenja DHMZ-a za Zagrebačku regiju riječima i oblikom (nikad samo bojom), potresi u posljednja 72 sata u krugu od 150 km (EMSC), vodostaj Save iz hidrološkog biltena, brojevi za hitne slučajeve (provjereni prema službenoj stranici), dežurne ljekarne, zborna mjesta civilne zaštite, javni zdenci i javni zahodi, trenutno zatvorene prometnice, planirani prekidi struje, toplinske energije i vode (označeni kao neslužbeni prikaz) i tekst HAK-a o stanju na cestama s izvornim vremenom. Isti sloj identičan je unutar otključane sesije.

### 1.2 Javni zaslon (Prozor), čitljiv bez telefona

Zaslon bez dodira prikazuje sigurnosnu traku uz donji rub (stanje upozorenja, zatvorene prometnice u blizini, najbliža dežurna ljekarna) i iznad nje izmjenu kartica svakih 20 sekundi: vrijeme sada, sljedeći polasci na stanici prostora, zrak na najbližoj postaji, jedan naslov HRT-a s izvorom, jedna arhivska slika Zagreba s atribucijom i pozivna kartica "Skeniraj za 10 minuta pogleda na Zagreb. Plaćaš pažnjom, ne novcem." QR kod rotira svakih 30 sekundi unutar vidljivog prstena, kod je ispisan u dvije skupine za čitanje naglas ili tipkanje, a podnožje rotira izvore podataka. Tema je tamna nakon zalaska i svijetla danju, prema izračunatim vremenima sunca, uz mogućnost da prostor odabere. Nakon skeniranja zaslon prikazuje sloj koji gleda osoba koja ga vodi, u rasporedu za velike zaslone (tijelo najmanje 40 px, naslovi 72 px na 1080p).

### 1.3 Otključana nadzorna ploča (Ruka na telefonu, Stol na radnoj površini)

Sedam slojeva, svaki s oznakom svježine (Živo ispod 5 minuta, Danas, Referenca) i atribucijom u podnožju svakog panela:

- **Grad sada:** sat, mjerenje s postaje Zagreb-Maksimir, prognoza i tekst za Zagreb, stanje CAP upozorenja, broj ZET vozila u pokretu, broj aktivnih zatvaranja, peludni semafor, fotogram Trga bana Jelačića.
- **U pokretu:** karta ZET vozila u stvarnom vremenu s imenima linija, polasci sa stanice koju osoba odabere (lokacija ostaje na telefonu), zatvorene prometnice kao linije na karti, tekst HAK-a s atribucijom, polasci HŽPP-a prema voznom redu, poveznica na zračnu luku, BAJS ako se otvoreni GBFS izvor potvrdi.
- **Zrak i nebo:** indeks kvalitete zraka po postaji, prognoza, upozorenja, pelud, potresi u krugu od 1,5° u sedam dana, vodostaj Save, izlazak i zalazak sunca izračunati na uređaju.
- **Sigurnost:** otvoreni sloj, identičan.
- **Uprava i pravo:** najnoviji akti Službenog glasnika Grada Zagreba s popravljenim dijakriticima i ispisom u PDF, najnovija izdanja Narodnih novina (ELI), sljedeća sjednica Gradske skupštine s prijenosom, otvorena savjetovanja, plan komunalnih aktivnosti.
- **Kultura i sjećanje:** baština Zagreba iz Europeane i Digitalnih zbirki NSK s atribucijom, knjižnice i muzeji iz gradskih prostornih slojeva, događanja s atribucijom i poveznicom, "na današnji dan" iz Wikidate; program HRT-a i radija kao tekst s poveznicom na njihov vlastiti player, nikad ugrađeno.
- **Vijesti:** HRT i Radio Sljeme kao tekst s izvorom i poveznicom, ostali portali samo naslov i poveznica; HINA se ne preuzima.

### 1.4 Uparivanje bez računa, bez aplikacije i bez kolačića

Telefon skenira QR kod vlastitom kamerom; otvara se stranica koja prikazuje karticu potvrde ("Zaslon: kafić, Donji grad, 10 minuta") i gumb Otključaj. Kod je jednokratan, vrijedi 30 sekundi uz kratku toleranciju, a poslužitelj odbija skeniranje s telefona koji je na istoj mreži kao zaslon ("Ovaj zaslon i tvoj telefon dijele istu mrežu. Isključi Wi-Fi i skeniraj mobilnim podacima."), čime se dokazuje fizička prisutnost. Kod se uvijek može i utipkati, što je put za osobe koje ne mogu koristiti kameru. Osoba u sesiji može pritisnuti "Podijeli grad" i dati drugoj osobi pet svježih minuta s vlastitog telefona (jedan skok, bez lančanja).

### 1.5 Istek sesije koji ništa ne gubi

Šezdeset i dvadeset sekundi prije kraja prikazuje se upozorenje (i čita čitaču zaslona). Istekom se prikaz zamrzne kao statička, atribuirana snimka: navigacija i osvježavanje prestaju, ali kopiranje, dijeljenje i izvoz i dalje rade. Ponovno skeniranje istog zaslona vraća isti sloj ("Nastavi gdje si stao"). Nema hlađenja.

### 1.6 Izvoz i dijeljenje

Svaki panel: kopiraj s izvorom, podijeli poveznicu (otvara statičku stranicu "pogled izvana" s kartom javnih zaslona), ICS (zatvaranja, sjednice, događanja), GeoJSON izvedenih zatvaranja (označeno kao prilagodba), PDF akta kroz stilove za ispis. Atribucija je na početku svakog izvoza.

### 1.7 Otvoreni izvedeni podaci i sučelje

Sve što sustav izvede objavljuje se na `/open/*.json` pod Otvorenom dozvolom s katalogom DCAT-AP i dnevnim snimkama; stranica `/izvori` navodi svaki izvor, licencu i vrijeme posljednje promjene; `/privatnost` i `/pristupacnost` (izjava o pristupačnosti s deklariranim odstupanjem) su dio proizvoda.

### 1.8 Podaci za Grad Zagreb

Brojači bez identifikatora `(dan, sat, događaj, dimenzija 1, dimenzija 2) → broj` u zatvorenim rječnicima: početak i kraj sesije s vrstom prostora i četvrti, neuspjela skeniranja s razlogom, dostupnost svakog izvora podataka, otvaranja slojeva i izvozi, pogledi otvorenog sloja. Mjesečni CSV i JSON te tromjesečni HTML izvještaj Gradskom uredu za digitalizaciju, nove tehnologije i tehničke poslove: brojevi zaokruženi na 5, ćelije ispod 10 sažete u "ostalo". Grad dobiva trajnu, besplatnu, neisključivu licencu za planiranje i unapređenje gradskih usluga, s pravom objave na data.zagreb.hr.

### 1.9 Upravljanje zaslonima

Provizioniranje zaslona kroz stranicu zaštićenu Cloudflare Accessom (vrsta prostora, četvrt, oznaka, stanica), jednokratna adresa za postavljanje, opoziv jednim klikom, vodič za Raspberry Pi 5 i bilo koji preglednik (`docs/kiosk.md`).

## 2. Potencijalni profil korisnika

- **Stanovnici u prostoru s javnim zaslonom** (gosti kafića, posjetitelji knjižnice, stranke u uredu gradske četvrti, članovi udruge): deset minuta pregleda grada bez instaliranja, prijave ili kolačića; sigurnosni sloj uvijek.
- **Posjetitelji i turisti** s inozemnim SIM karticama: skeniranje radi s mobilnim podacima bilo kojeg operatera; engleski jezik jednim dodirom; nikakav račun.
- **Starije osobe i osobe koje ne koriste pametne telefone:** zaslon je čitljiv sam, s velikim tipom i riječima umjesto boja; osoblje može pročitati kod naglas; u knjižnicama i četvrtima zaslon je servis, ne reklama.
- **Osobe s invaliditetom:** utipkani kod umjesto kamere, čitač zaslona vodi kroz svaki korak, kontrast i zum 200 %, bez treptanja, ozbiljnost uvijek riječima i oblikom; otvoreni sloj bez vremenskog ograničenja za svaku informaciju (WCAG 2.2, kriterij 2.2.1 s deklariranim odstupanjem i alternativama).
- **Prostori koji ugošćuju zaslon** (kafići, knjižnice, četvrti, udruge, ZET): sadržaj koji zadržava ljude, bez troška i bez održavanja.
- **Grad Zagreb:** prvi skup podataka o potražnji za gradskim informacijama po satu, četvrti i vrsti prostora, te mjesečni izvještaj o pouzdanosti vlastitih otvorenih izvora.
- **Razvojna zajednica:** otvoreni kod, otvoreni izvedeni podaci, dokumentirani protokol uparivanja koji svatko može ponovno upotrijebiti.

## 3. Tip rješenja

Progresivna web-aplikacija (PWA) za telefon i radnu površinu, softver za javne zaslone (isti kod, kiosk raspored, radi u svakom pregledniku, preporučeno na Raspberry Pi 5) i otvoreno sučelje za izvedene podatke. Tehnički: jedan Cloudflare Worker sa statičkim datotekama, četiri Durable Object klase sa SQLite pohranom (zaslon, sesija, indeks kodova, brojači), KV za posljednju dobru kopiju svakog izvora, WebSocket s hibernacijom za zaslone i sesije, HMAC tokeni bez stanja za podatke, MapLibre GL karta s otvorenim pločicama. Bez baze korisnika, bez kolačića, bez identifikatora uređaja. Sve je opisano na jednoj stranici u `docs/arhitektura.md`.

## 4. Obrazloženje interesa projekta za Grad Zagreb

Grad Zagreb je usvojio okvirnu strategiju pametnog grada sa šest područja i 27 mjera, vodi Centar za upravljanje prometom sa 160 semaforiziranih raskrižja, pilotira ZET-ove e-ink zaslone sa stvarnim vremenom, razvija Pristupačni Zagreb i Guru za kulturu, te kroz ovaj Program i ZGBit susrete gradi zajednicu koja koristi njegove otvorene podatke. Vidikovac spaja te niti u jedan javni proizvod:

1. **Vidljivost otvorenih podataka na ulici.** Podaci s data.zagreb.hr, ZET-a i DHMZ-a danas žive u portalima i aplikacijama za one koji ih traže. Javni zaslon u kafiću, knjižnici ili uredu četvrti donosi ih ljudima koji ih ne traže, s izvorom i licencom ispisanima na zaslonu. Svaki zaslon je stalna, javna referenca na data.zagreb.hr.
2. **Sigurnosna informacija bez ikakve prepreke.** Otvoreni sloj s upozorenjima DHMZ-a, potresima, zatvaranjima i zbornim mjestima civilne zaštite radi bez JavaScripta i bez telefona, čitljiv na zaslonu, ispisiv na papir. To je javna usluga koju Grad može pokazati kao izravni rezultat svoje politike otvorenih podataka.
3. **Podatak koji Grad nema: potražnja.** Gradski uredi znaju što objavljuju, ali ne znaju kad i gdje građani traže gradske informacije. Anonimni zbrojevi po satu, četvrti i vrsti prostora, dostavljeni mjesečno pod licencom koja Gradu daje pravo objave, prvi su takav skup. Izvještaj o pouzdanosti izvora (koliko često koji gradski izvor kasni ili pada) izravna je povratna informacija timu za otvorene podatke.
4. **Inkluzivniji Zagreb.** Zasloni u knjižnicama, uredima gradskih četvrti i prostorima udruga, utipkani kod, čitač zaslona, veliki tip i riječi umjesto boja, engleski za posjetitelje. Projekt je izravno na temi 9. ZGBita "Otvoreni podaci za inkluzivniji Zagreb".
5. **Trajno vlasništvo.** Kod je pod AGPL-3.0-or-later s ponudom Gradu pod EUPL-1.2; Grad može preuzeti, pokrenuti i mijenjati sustav bez ikakve ovisnosti o prijavitelju. Predlažemo ugovorno da najmanje jedan zaslon bude na lokaciji koju Grad odabere (gradska četvrt, knjižnica ili ZET stanica).

## 5. Popis otvorenih podataka koji bi se koristili

Potpuni popis s licencama, adresama, učestalošću i doslovnim atribucijama je u `docs/izvori.md` u repozitoriju i na stranici `/izvori`; ovdje sažeto.

| Izvor | Skup | Licenca | Osvježavanje |
|---|---|---|---|
| ZET | GTFS-Realtime (položaji vozila, kašnjenja) i statični GTFS | Otvorena dozvola | 30 s; dnevno |
| Grad Zagreb, data.zagreb.hr | Zatvaranje prometnica; Plan komunalnih aktivnosti | Otvorena dozvola | 3 min; dnevno |
| Grad Zagreb, ArcGIS prostorni slojevi | Gradske četvrti, zborna mjesta civilne zaštite, ljekarne, vatrogasci, policija, javni zdenci, javni WC, knjižnice, muzeji, parkovi, biciklističke staze | Otvorena dozvola | dnevno |
| DHMZ | Trenutna mjerenja, prognoza, upozorenja CAP, hidrološki bilten | Otvorena dozvola | 10 min; 30 min; 5 min; dnevno |
| EMSC | Potresi (FDSN event servis) | slobodno uz izvor | 1 min |
| Hrvatska agencija za okoliš i prirodu | Indeks kvalitete zraka (INSPIRE WFS/WMS) | otvoreno uz izvor | 1 h |
| HŽ Putnički prijevoz | Statični GTFS (data.gov.hr) | nije navedena, upit poslan | dnevno |
| Grad Zagreb | Službeni glasnik Grada Zagreba (JSON API) | službeni tekstovi | 1 h |
| Narodne novine | API s ELI identifikatorima | službeni tekstovi | dnevno |
| HRT | RSS Vijesti i Radio Sljeme (tekst s poveznicom) | uz navođenje HRT-a i poveznicu | 5 min |
| Europeana, NSK, Wikidata, Wikimedia Commons | Baština Zagreba, metapodaci | CC0 / javno vlasništvo / CC BY-SA | dnevno |
| HAK | Stanje na cestama (tekst) | uz izvor, poveznicu i izvorno vrijeme | 10 min |
| HEP ODS, HEP Toplinarstvo, VIO | Planirani prekidi (neslužbeni prikaz) | uvjeti u provjeri | dnevno |

Izvori su ocijenjeni zeleno (otvorena licenca, strojno čitljivo, bez ključa), žuto (službeni HTML, uz oprez i oznaku "neslužbeni prikaz") i crveno (zatvoreno; prikazuje se samo poveznica dok pisano odobrenje ne stigne). U prototipu su isključivo zeleni izvori. Pisma ZET-u (oznaka "samo za testiranje" na GTFS-RT feedu), HRT-u i HAK-u te upit HŽPP-u o licenci dio su plana provedbe.

## 6. Kriteriji iz Priloga 1. Programa

### 6.1 Dosadašnje iskustvo prijavitelja u razvojnim ili istraživačkim programima (0–10 bodova)

Aning Film d.o.o. je produkcijska tvrtka čiji direktor posljednjih godina samostalno razvija i vodi softverske proizvode u produkciji, s tehnološkim temeljem identičnim ovom projektu: psh.lat (uparivanje uređaja QR kodom i WebSocket na Cloudflare Durable Objects, PWA s više od trideset komponenata bez okvira, dvojezično sučelje), kompmajstor.eu (Cloudflare Workers s ograničivačima brzine, Turnstile provjerom i brojanjem posjeta bez kolačića), radi.li (karta i servisni radnik) i cjenik.app (PWA). Svi su javno dostupni i mogu se provjeriti u trenutku ocjenjivanja. Filmski i produkcijski rad tvrtke: [[POPUNITI: tri do pet naslova s godinom i ulogom, iz službene filmografije]]. Ta dva iskustva se u ovom projektu sastaju: softver koji radi u produkciji i vizualni zanat za javne zaslone.

### 6.2 Kapacitet prijavitelja za provedbu projekta (0–10 bodova)

Prototip je na https://zagreb.aningfilm.hr prije roka prijave: otvoreni sloj, javni zaslon s rotirajućim kodom, skeniranje, sesija s istekom i pet izvora u stvarnom vremenu. Primitivi koje projekt koristi već rade u produkciji drugih proizvoda prijavitelja i preneseni su datoteka po datoteku (QR generator i skener, WebSocket Durable Object s hibernacijom, brojači bez identifikatora, sigurnosna zaglavlja, sustav tema, i18n, Playwright testovi u dva konteksta). Infrastruktura je plaćeni Cloudflare Workers račun s Durable Objects u produkciji. Suradnici po ulozi i satu su u financijskom planu: drugi razvojni inženjer za integracije izvora i testove, revizor pristupačnosti koji testira s korisnicima s invaliditetom, UX i motion dizajner, pravni i privacy pregled, instalater zaslona. Otvorena licenca uklanja rizik ovisnosti o jednoj osobi: kod je javan od prvog commita.

### 6.3 Tehnička izvedivost (0–10 bodova)

Arhitektura je na jednoj stranici (`docs/arhitektura.md`): jedan Worker, četiri Durable Object klase, KV, tri ograničivača, bez baze korisnika. Protokol uparivanja slijedi provjerene obrasce (OAuth device flow, rotacija kodova kao TOTP, jednokratni tokeni, 40 bita entropije, provjera posjedovanja karticom potvrde) i opisan je u `worker/protocol.ts`. Svaki izvor ima ocjenu, rok dohvata od 6 sekundi, predmemoriju s TTL-om, posljednju dobru kopiju i iskren status (živo, zastarjelo, nedostupno); stranica nikad nije prazna. Testovi: jedinični za svaki parser prema spremljenim živim uzorcima, integracijski za Durable Objects u Workers runtimeu, Playwright u dva preglednička konteksta za uparivanje i istek, axe i Lighthouse za pristupačnost. Postavljanje je `git push`; povratak na prethodnu inačicu je `git revert`. Prototip je dokaz izvedivosti u trenutku ocjenjivanja, ne obećanje.

### 6.4 Društvena korist (0–30 bodova)

Prvo, sigurnost bez prepreka: upozorenja, potresi, zatvaranja, ljekarne, zborna mjesta i prekidi na jednoj stranici koja radi bez JavaScripta, na zaslonu bez telefona i na papiru. Drugo, inkluzija: zasloni u knjižnicama, uredima gradskih četvrti i prostorima udruga (predlažemo da Grad ugovorno odabere najmanje jednu lokaciju), utipkani kod za osobe koje ne koriste kameru, čitač zaslona vodi kroz svaki korak, veliki tip i riječi umjesto boja, engleski za posjetitelje s inozemnim SIM karticama, izjava o pristupačnosti s revizijom uz korisnike s invaliditetom dvaput tijekom projekta. Treće, privatnost kao struktura, ne kao obećanje: nema računa, kolačića, identifikatora uređaja, IP adresa ni koordinata; mrežna usporedba radi se u memoriji i odbacuje; brojači nemaju identifikatore; nema pristanka koji treba tražiti jer nema ničega što bi se pratilo. Četvrto, podatak za Grad: skup o potražnji za gradskim informacijama i izvještaj o pouzdanosti gradskih izvora, mjesečno, s pravom objave. Peto, korist za prostore: kafić, knjižnica ili udruga dobivaju sadržaj koji zadržava ljude, bez troška, s pripremljenim uputama za osoblje. Šesto, vidljivost otvorenih podataka: svaki zaslon ispisuje "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom" stotinama ljudi dnevno.

### 6.5 Inovativnost (0–20 bodova)

Dosad financirani projekti ovog Programa su vrijedne aplikacije za pojedina područja: promet (ZET info), gradski asistent (ZgInfo.AI), Skupština (Parlametar), Službeni glasnik (ZG Legalbot), zrak (ZG Air), hodljivost (Urban Score), proračun (ZagrebViz). Nijedan ne integrira područja, nijedan nije u stvarnom vremenu preko više područja, nijedan nema mehaniku fizičke prisutnosti ni javne zaslone i nijedan ne vraća Gradu uvid o korištenju. Vidikovac donosi četiri nove stvari: (1) jedan pogled na grad preko sedam slojeva u stvarnom vremenu; (2) otključavanje prisutnošću, bez računa, aplikacije i kolačića, s rotirajućim jednokratnim kodovima i provjerom da telefon nije na mreži zaslona; (3) javne zaslone koji su korisni i bez skeniranja i koje osoba s telefonom može voditi; (4) anonimni skup o potražnji koji Grad dobiva pod licencom s pravom objave. Presedani su poznati i navedeni pošteno: BeRealov dvominutni prozor (55 % korisnika objavljuje dnevno unutar njega) pokazuje da oskudica stvara ritual; Pokémon Go PokéStopovi pokazuju vrijednost prisutnosti za prostore; Nintendo StreetPass relejne točke pokazuju mrežu zaslona; Clubhouse pokazuje da vrata bez sadržaja propadaju kad se otvore, zato je naš sadržaj otvoren i bez vrata, a vrata ograničavaju samo vrijeme.

### 6.6 Konačni proizvod pod licencom otvorenog koda ili u javnom dobru (0–10 bodova)

Kod je pod AGPL-3.0-or-later, javan od prvog commita na https://github.com/matijarma/vidikovac, s zaglavljima prenesenih datoteka očuvanima. Gradu Zagrebu nudimo isti kod i pod EUPL-1.2, licencom Europske komisije prilagođenom javnim tijelima, kako bi ga mogao preuzeti i mijenjati pod uvjetima koje njegove službe već poznaju. Izvedeni podaci na `/open` su pod Otvorenom dozvolom s DCAT-AP katalogom i dnevnim snimkama, uz stalnu ponudu Gradu da ih objavi na data.zagreb.hr. Dokumentacija je na hrvatskom: arhitektura, protokol, vodič za zaslone, popis izvora, izjava o privatnosti, izjava o pristupačnosti. Skup o potražnji Grad dobiva pod posebnom neisključivom, trajnom, besplatnom licencom s pravom objave; mi ga ne objavljujemo, jer objava je odluka Grada.

### 6.7 Kvaliteta financijskog plana i obrazloženje troškova (0–10 bodova)

Financijski plan je u Obrascu 3 i u `obrazac-3-financijski-plan.md`: 20.000,00 EUR bez PDV-a u pet redaka. Troškovi zaposlenih (500 sati voditelja projekta i glavnog razvoja) računaju se po satnici izvedenoj iz stvarne bruto plaće formulom godišnji trošak rada / 1.720 produktivnih sati (12,60 EUR), s alternativom bruto / 155 (10,00 EUR) ako Grad tako propisuje, pri čemu se razlika premješta u sate drugog razvojnog inženjera, a ukupni iznos ostaje isti. Vanjski suradnici su navedeni po ulozi, satu i cijeni sata. Promidžba je 6 % ukupnog iznosa (iznad propisanih 5 %) i konkretna: video i titlovi, tiskani stalci i upute za prostore, prezentacija na ZGBitu, javno predstavljanje u pilot kafiću. Licence su stvarni godišnji trošak infrastrukture. Oprema su četiri zaslona za pilot lokacije po 245 EUR plus rezerva. Svaki euro ima isporuku i mjesec u planu provedbe.

## 7. Kako čitamo uvjet "rezultati nenaplatno dostupni javnosti"

Program i Javni poziv traže da rezultati budu nenaplatno dostupni javnosti; Program taj pojam definira kao dostupnost bez naknade. Vidikovac ni od koga ne traži novac ni protuvrijednost koja bi se mogla naplatiti. Sigurnosni sloj je otvoren svima bez ikakvog uvjeta; javni zaslon je čitljiv bez telefona; kod i izvedeni podaci su otvoreni; skeniranje ograničava trajanje pogleda, ne krug ljudi koji ga mogu vidjeti, a ponoviti ga može svatko odmah. Predlažemo ugovorni minimum zaslona na lokacijama koje Grad odabere kako bi pristup ne ovisio o komercijalnim prostorima.

## 8. Poveznice

- Prototip: https://zagreb.aningfilm.hr · otvoreni sloj: https://zagreb.aningfilm.hr/hitno · izvori: https://zagreb.aningfilm.hr/izvori
- Repozitorij: https://github.com/matijarma/vidikovac · arhitektura: `docs/arhitektura.md` · zasloni: `docs/kiosk.md`
- Video: [[POPUNITI: poveznica]]

## Polja za ispunu prije predaje

Sva mjesta označena `[[POPUNITI: ...]]` popunjavaju se iz službenih registara i dokumenata tvrtke (sudski registar, filmografija, poveznica na video). Skripta `npm run check:izvori -- --filing` odbija proći dok ijedno ostane.
````

- [ ] **Step 4: Write `docs/prijava/obrazac-3-financijski-plan.md`**

````markdown
# Obrazac 3. Financijski plan i izračun troškova

Prijavitelj: Aning Film d.o.o. · Projekt: Vidikovac. Zagreb, povezan. · Svi iznosi su u eurima **bez PDV-a**. Ukupno zatraženo: **20.000,00 EUR**.

| Redak | Stavka | Izračun | Iznos (EUR) |
|---|---|---|---|
| 1. Troškovi zaposlenih | Matija Radeljak, voditelj projekta i glavni razvoj (ugovor o radu, direktor). Ukupno 500 sati. | 500 h × 12,60 EUR/h | 6.300,00 |
| 2. Troškovi vanjskih suradnika | Drugi razvojni inženjer, integracije izvora podataka i testovi: 150 h × 40,00 = 6.000,00. Revizija pristupačnosti i testiranje s korisnicima s invaliditetom (dvije revizije): 50 h × 45,00 = 2.250,00. UX i motion dizajn: 40 h × 40,00 = 1.600,00. Pravni i privacy pregled (izjave, licenca skupa za Grad): 8 h × 80,00 = 640,00. Instalacija četiri zaslona: 4 × 150,00 = 600,00. | 6.000 + 2.250 + 1.600 + 640 + 600 | 11.090,00 |
| 3. Troškovi promidžbe | Postprodukcija demo videa i titlovi (hr, en); tiskani stalci i upute za osoblje prostora; prezentacija na ZGBit susretu; javno predstavljanje u pilot kafiću. Najmanje 5 % odobrenog iznosa: ovdje 6,0 %. | paušal po stavkama | 1.200,00 |
| 4. Troškovi licenci i druge nematerijalne imovine | Cloudflare Workers Paid 12 mjeseci (5 USD/mj.) s korištenjem Durable Objects i R2; domena i alati. | 12 × oko 5 USD + korištenje + domena | 320,00 |
| 5. Troškovi opreme i druge materijalne imovine | Četiri pilot zaslona (Raspberry Pi 5 2 GB, zaslon, nosač, napajanje) 4 × 245,00 = 980,00; rezervni Raspberry Pi 65,00; kabeli i sitni materijal 45,00. | 980 + 65 + 45 | 1.090,00 |
| **Ukupno** | | | **20.000,00** |

Zbroj: 6.300,00 + 11.090,00 + 1.200,00 + 320,00 + 1.090,00 = 20.000,00 EUR bez PDV-a. Prijavitelj je u sustavu PDV-a i PDV nije trošak projekta.

## Obrazloženje satnice u retku 1

Prijavitelj je društvo s ograničenom odgovornošću u kojem je direktor jedini zaposlenik na ugovoru o radu, s bruto plaćom (bruto 1) od oko 1.550,00 EUR mjesečno. Satnica se računa metodom koja se koristi u projektima financiranima iz europskih fondova: **godišnji trošak rada podijeljen s 1.720 produktivnih sati**. Godišnji trošak rada je bruto 2, to jest bruto 1 uvećan za doprinos za zdravstveno osiguranje na plaću (16,5 %): 1.550,00 × 1,165 × 12 = 21.669,00 EUR; 21.669,00 / 1.720 = **12,60 EUR po satu**. Broj sati (500) je procjena voditelja za deset mjeseci provedbe uz paralelno vođenje tvrtke i potvrđuje se evidencijom radnog vremena po projektu. Iznos se prije predaje provjerava prema obračunu plaće za kolovoz 2026.

**Alternativa ako Grad primjenjuje formulu bruto / 155:** 1.550,00 / 155 = **10,00 EUR po satu**; redak 1 tada iznosi 500 × 10,00 = **5.000,00 EUR**, a razlika od 1.300,00 EUR premješta se u sate drugog razvojnog inženjera (dodatnih 32,5 h × 40,00), pa redak 2 iznosi **12.390,00 EUR**. Ostali redci se ne mijenjaju; ukupno ostaje 20.000,00 EUR bez PDV-a. Prijavitelj prihvaća bilo koju od dvije metode; upit o metodi poslan je na otvoreni.podaci@zagreb.hr 11. 9. 2026.

## Obrazloženje ostalih redaka

**Redak 2.** Drugi razvojni inženjer preuzima integracije žutih izvora (HAK, HEP, VIO, AZO WFS, HŽPP, BAJS, kultura) i pisanje testova za svaki parser, čime voditelj ostaje na protokolu, zaslonima i izvještajima. Revizija pristupačnosti se provodi dvaput (mjesec 2 i mjesec 9) s korisnicima s invaliditetom i rezultira dvjema inačicama izjave o pristupačnosti. UX i motion dizajn pokriva raspored za kiosk, prsten QR koda, stanja skenera i prijelaz u zamrznuti prikaz. Pravni i privacy pregled potvrđuje izjavu o privatnosti, licencu skupa podataka za Grad i tekstove atribucija. Instalacija zaslona uključuje montažu, mrežu i puštanje u rad na četiri lokacije.

**Redak 3.** Promidžba je ono što projektu daje javnost: 90-sekundni video s titlovima za ZGBit, društvene mreže i stranicu projekta; tiskane upute na svakom zaslonu ("Skeniraj kod s telefona na mobilnim podacima"); jedno javno predstavljanje u pilot kafiću s pozivom Gradskom uredu i medijima. Iznos od 1.200,00 EUR je 6,0 % od 20.000,00 EUR; ako se odobri manji iznos, promidžba ostaje najmanje 5 % odobrenog iznosa.

**Redak 4.** Cloudflare Workers Paid je jedini stalni trošak rada sustava; Durable Objects, KV i R2 unutar uključenih kvota ili s malim prekoračenjem; domena aningfilm.hr već postoji. Nakon projekta trošak ostaje ispod 100 EUR godišnje, što je temelj održivosti.

**Redak 5.** Četiri zaslona su pilot: kafić, prostor udruge, jedna lokacija koju odabere Grad (gradska četvrt, knjižnica ili ZET stanica) i jedna rezervna lokacija. Raspberry Pi 5 je odabran zbog cijene, potrošnje i podrške za Chromium u kiosk načinu; zasloni su standardni HDMI. Oprema ostaje u vlasništvu prijavitelja i u funkciji projekta najmanje do kraja Programa (31. 12. 2027.).

## Napomene

- Projekt nije i neće biti financiran iz drugih javnih izvora (Prilog 5.).
- Potpora je de minimis prema Uredbi (EU) 2023/2831; Aning Film d.o.o. i KompMajstor čine jednog poduzetnika i zajednički su ispod praga od 300.000 EUR u tri fiskalne godine (Prilozi 7.a i 7.b).
- Vlastito sufinanciranje nije propisano; plan je financiran u cijelosti iz potpore. Ako Grad zatraži udio, prijavitelj ga pokriva iz retka 1 (sati iznad 500 koje ne fakturira).
````

- [ ] **Step 5: Write `docs/prijava/plan-provedbe.md`**

````markdown
# Plan provedbe

Trajanje: 10 mjeseci od potpisa ugovora, u cijelosti unutar Programa (do 31. 12. 2027.). Mjeseci su relativni prema potpisu (M1 = prvi mjesec nakon potpisa). M0 je gotov prije roka prijave i može se provjeriti u trenutku ocjenjivanja.

### M0 Prototip uživo (do 16. 9. 2026., prije potpisa)

Isporuke: https://zagreb.aningfilm.hr s otvorenim slojem `/hitno`, javnim zaslonom s rotirajućim kodom, skeniranjem s karticom potvrde, sesijom od deset minuta sa zamrzavanjem, pet izvora u stvarnom vremenu (upozorenja DHMZ-a, potresi, ZET, zatvorene prometnice, vrijeme) i tri u dnevnom ritmu (vijesti HRT-a, prognoza, gradski prostorni slojevi), stranice `/izvori`, `/privatnost`, `/pristupacnost`, javni repozitorij pod AGPL-3.0-or-later, Playwright testovi zeleni protiv produkcije, demo video. Mjera: definicija gotovog prototipa iz dizajnerske specifikacije.

### M1 Učvršćivanje protokola, izjave, prva revizija pristupačnosti (mjeseci 1 do 2)

Isporuke: dovršena provjera iste mreže u načinu enforce na stvarnim mrežama (kafić Wi-Fi, tri mobilna operatera, iPhone i Android), WASM rezervni skener za preglednike bez BarcodeDetectora, Turnstile iza zastavice, ograničenja po zaslonu (30 sesija na sat, 200 na dan), prva revizija pristupačnosti s korisnicima s invaliditetom i izjava o pristupačnosti v1 s deklariranim odstupanjem, izjava o privatnosti nakon pravnog pregleda. Mjera: revizijski izvještaj i dvije izjave objavljene na stranici.

### M2 Svi zeleni izvori u produkciji, pisma vlasnicima podataka (mjeseci 2 do 3)

Isporuke: hidrološki bilten, indeks zraka (INSPIRE WFS/WMS), HŽPP polasci prema voznom redu, Službeni glasnik s ispisom u PDF, Narodne novine (ELI), Europeana i NSK, Wikidata "na današnji dan", BAJS ako se GBFS izvor potvrdi; test za svaki parser prema spremljenom uzorku; pisma ZET-u (oznaka "samo za testiranje"), HRT-u (audio i video) i HAK-u (kamere), upit HŽPP-u o licenci, upit Gradu o uvjetima API-ja Službenog glasnika. Mjera: `/izvori` prikazuje sve zelene izvore sa statusom živo; kopije pisama u dokumentaciji.

### M3 Četiri zaslona instalirana, administracija zaslona (mjeseci 3 do 4)

Isporuke: zasloni u pilot kafiću, prostoru udruge, na lokaciji koju odabere Grad i na četvrtoj lokaciji; administracija zaslona (provizioniranje, opoziv, oznaka stanice, pregled dostupnosti) iza Cloudflare Accessa; tiskane upute za osoblje; `docs/kiosk.md` dopunjen iskustvom s terena. Mjera: četiri zaslona javljaju `kiosk_online` svakog dana u mjesecu 4.

### M4 Prvi skup podataka Gradu, ZGBit, javni katalog `/open` (mjesec 5)

Isporuke: prvi mjesečni CSV i JSON `(mjesec, dan, sat, događaj, dim1, dim2, broj)` s zaokruživanjem na 5 i sažimanjem ćelija ispod 10, uz tekst licence za Grad; prezentacija na ZGBit susretu; `/open/catalog.json` (DCAT-AP) s dnevnim snimkama u R2 i ponudom Gradu za objavu na data.zagreb.hr. Mjera: potvrda primitka Gradskog ureda; katalog validiran DCAT-AP validatorom.

### M5 Žuti izvori, sadržaj HRT-a i HAK-a ako je dopušten, izvještaj o pouzdanosti (mjeseci 6 do 8)

Isporuke: dežurne ljekarne, planirani prekidi HEP-a, Toplinarstva i VIO-a, peludni semafor, tekst HAK-a, sve s oznakom "neslužbeni prikaz" gdje je izvor HTML; ugradnja HRT-ovog ili HAK-ovog sadržaja samo ako pisano odobrenje stigne; prvi tromjesečni izvještaj o pouzdanosti izvora (postotak vremena živo, zastarjelo, nedostupno po izvoru) Gradskom uredu. Mjera: izvještaj dostavljen; svaki žuti izvor ima test i atribuciju.

### M6 Druga revizija pristupačnosti, izjava v2, javni izvještaj (mjesec 9)

Isporuke: druga revizija s korisnicima s invaliditetom na stvarnim zaslonima (knjižnica ili četvrt), ispravci, izjava o pristupačnosti v2; javni izvještaj o šest mjeseci rada (broj zaslona, sesija po četvrti i vrsti prostora, pouzdanost izvora, što nije uspjelo) na stranici projekta. Mjera: izjava v2 objavljena; izvještaj objavljen.

### M7 Završni izvještaj, inačica 1.0, paket za predaju (mjesec 10)

Isporuke: inačica 1.0 označena u repozitoriju; paket za predaju Gradu: kod pod EUPL-1.2, dokumentacija na hrvatskom, licenca skupa podataka, vodič za provizioniranje zaslona, popis izvora s uvjetima; završni sadržajni i financijski izvještaj prema ugovoru; dogovor o nastavku rada zaslona nakon projekta (trošak ispod 100 EUR godišnje, prostori zadržavaju zaslone). Mjera: izvještaj predan; paket zaprimljen.

## Tko što radi

| Uloga | M0 | M1 | M2 | M3 | M4 | M5 | M6 | M7 |
|---|---|---|---|---|---|---|---|---|
| Voditelj projekta i glavni razvoj (redak 1) | ● | ● | ● | ● | ● | ● | ● | ● |
| Drugi razvojni inženjer (redak 2) | | | ● | | | ● | | ● |
| Revizor pristupačnosti (redak 2) | | ● | | | | | ● | |
| UX i motion dizajner (redak 2) | | ● | | ● | | | | |
| Pravni i privacy pregled (redak 2) | | ● | | | ● | | | |
| Instalater zaslona (redak 2, redak 5) | | | | ● | | | | |
| Promidžba (redak 3) | ● | | | ● | ● | | ● | |
````

- [ ] **Step 6: Write `docs/prijava/rizici-i-odgovori.md`**

````markdown
# Rizici i odgovori na očekivane prigovore Povjerenstva

Sedam prigovora koje očekujemo, s odgovorom koji je već ugrađen u proizvod, a ne obećan.

### 1. "Još jedna ZET aplikacija."

ZET je jedan od dvadesetak panela u sedam slojeva, a mi ga ne pokušavamo zamijeniti: panel U pokretu prikazuje vozila i kašnjenja, a za planiranje putovanja upućuje na već financirane aplikacije. Vrijednost Vidikovca je u spoju: upozorenje DHMZ-a, zatvorena prometnica, potres, akt Službenog glasnika i vijest na istom mjestu, u istoj minuti, s istim standardom atribucije. Nijedan financirani projekt Programa to ne radi.

### 2. "Ograničen pristup se ne slaže s uvjetom 'rezultati nenaplatno dostupni javnosti'."

Nitko ništa ne plaća. Program pojam "nenaplatno" definira kao dostupnost bez naknade, i to je ispunjeno u cijelosti. Povrh toga: sigurnosni sloj je otvoren svima bez ikakvog uvjeta i bez ograničenja trajanja; javni zaslon je čitljiv bez telefona; kod i izvedeni podaci su otvoreni; skeniranje ograničava trajanje pogleda, ne krug ljudi, i može se ponoviti odmah. Nudimo ugovorni minimum zaslona na lokacijama koje odabere Grad, kako pristup ne bi ovisio o komercijalnim prostorima. Ograničenje trajanja je bit proizvoda: kratki pogled na grad koji se otključava prisutnošću, kao izlog, a ne pretplata.

### 3. "Jedna osoba nosi projekt."

Prijavitelj ima softverske proizvode u produkciji čije adrese su u prijedlogu i mogu se otvoriti u trenutku ocjenjivanja; prototip ovog projekta je uživo prije roka; drugi razvojni inženjer, revizor pristupačnosti, dizajner, pravnik i instalater su u proračunu po satu; kod je javan pod otvorenom licencom od prvog commita, pa projekt ne ovisi o jednoj osobi ni jednoj tvrtki. Grad dobiva ponudu pod EUPL-1.2 i može ga preuzeti u cijelosti.

### 4. "Izvori su krhki: ZET feed je označen 'samo za testiranje', vrijeme.hr pada, CKAN se mijenja."

Svaki izvor ima ocjenu (zeleno, žuto, crveno), rok dohvata, predmemoriju, posljednju dobru kopiju i iskren status na svakom panelu (živo, zastarjelo, nedostupno); stranica nikad nije prazna, a korisnik nikad ne vidi zastarjeli podatak kao svjež. Dostupnost svakog izvora se broji i tromjesečno izvještava Gradskom uredu, što je konkretna korist za tim otvorenih podataka: prvi sustavni zapis o tome koji gradski izvori kasne ili padaju. Pismo ZET-u o oznaci "samo za testiranje" dio je plana (M2), a do tada oznaka stoji uz panel.

### 5. "Kamere, praćenje, privatnost."

Ne upravljamo nikakvim kamerama i ne prikazujemo tuđe kamere bez dopuštenja; jedini ugrađeni fotogram je onaj čiji vlasnik ugradnju izričito dopušta. Sustav ne pohranjuje ništa što identificira osobu ili uređaj: nema računa, kolačića, identifikatora uređaja, IP adresa ni koordinata; usporedba mreže zaslona i telefona radi se u memoriji i odbacuje istog trenutka; brojači imaju samo dan, sat, događaj i dvije dimenzije iz zatvorenih rječnika. Nema bannera za pristanak jer nema ničega za što bi se pristanak tražio. Izjava o privatnosti prolazi pravni pregled u M1.

### 6. "Održivost nakon projekta."

Trošak rada sustava nakon projekta je ispod 100 EUR godišnje (jedan plaćeni Cloudflare račun). Zaslone drže prostori koji od njih imaju korist, uz upute i opoziv na daljinu. Kod je otvoren i dokumentiran na hrvatskom; Grad ima ponudu pod EUPL-1.2 i može preuzeti sustav bez ikakvog dogovora s prijaviteljem. Projekt ne stvara ovisnost ni o osobi, ni o tvrtki, ni o ugovoru.

### 7. "Zašto filmska tvrtka?"

Zato što je javni zaslon medij, a ne samo sučelje: tipografija čitljiva s tri metra, ritam izmjene kartica, tema koja prati dnevno svjetlo, prsten QR koda kao jedina kretnja, kartica potvrde koja se čita u sekundi, sve su to zanati vizualnog pripovijedanja koje Aning Film radi. Softverska strana nije obećanje: proizvodi prijavitelja u produkciji navedeni su adresama, a prototip ovog projekta je uživo prije roka. Spoj tih dviju kompetencija je razlog zašto ovaj projekt predlaže baš ova tvrtka.
````

- [ ] **Step 7: Run the application test**

```
npx vitest run --project unit test/docs/prijava.test.ts
```

Expected: `Tests 8 passed` (five mandatory headings in order; seven criteria in order; no "Vi"; five rows equal `[6300, 11090, 1200, 320, 1090]`; total 20,000 with promotion at 6 %; formula strings present; M0 to M7 in order; seven objections).

- [ ] **Step 8: Commit**

```
git add docs/prijava/prijedlog-projekta.md docs/prijava/obrazac-3-financijski-plan.md docs/prijava/plan-provedbe.md docs/prijava/rizici-i-odgovori.md test/docs/prijava.test.ts
git commit -m "Grant application text: project proposal with item-8 headings and Prilog 1 sections, Obrazac 3, work plan, objections" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task E7: Pre-filing check, scripts/check-plan-links.mjs

**Files:**
- Create: `D:\scratch\vidikovac\scripts\check-plan-links.mjs`
- Test: `D:\scratch\vidikovac\test\scripts\check-plan-links.test.ts`

**Interfaces:**
- Consumes: `docs/izvori.md` (Task E4), `worker/feed/schema.ts` (`ModuleId` union), `docs/prijava/*.md` (Task E6, `[[POPUNITI: ...]]` fields), global `fetch` with `AbortSignal.timeout`.
- Produces: `extractUrls(markdown: string): string[]`, `moduleIdsFromSchema(src: string): string[]`, `missingModuleIds(ids: string[], markdown: string): string[]`, `checkUrl(url: string, opts?: { fetchImpl?, timeoutMs? }): Promise<{ url; method: 'HEAD' | 'GET' | '-'; status: number; ok: boolean; ms: number; error?: string }>`, `findFillFields(text: string): string[]`, `renderTable(rows): string`, `main(argv: string[], deps?): Promise<number>`; npm script `check:izvori`; flag `--filing`.

- [ ] **Step 1: Write the failing test**

Create `test/scripts/check-plan-links.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  checkUrl,
  extractUrls,
  findFillFields,
  missingModuleIds,
  moduleIdsFromSchema,
  renderTable,
} from '../../scripts/check-plan-links.mjs';

describe('extractUrls', () => {
  it('finds markdown links and bare URLs, dedupes, strips trailing punctuation, skips templates', () => {
    const md = [
      '| `zet-rt` | ZET | https://www.zet.hr/gtfs-rt-protobuf | OD |',
      'See [the API](https://www1.zagreb.hr/sluzbeni-glasnik-gateway/api/v1/sifarnici).',
      'Repeated: https://www.zet.hr/gtfs-rt-protobuf, and a template https://example.org/{datum} to skip.',
      'Query stays: https://www.seismicportal.eu/fdsnws/event/1/query?lat=45.81&lon=15.98&maxradius=1.5&format=json',
    ].join('\n');
    expect(extractUrls(md)).toEqual([
      'https://www.zet.hr/gtfs-rt-protobuf',
      'https://www1.zagreb.hr/sluzbeni-glasnik-gateway/api/v1/sifarnici',
      'https://www.seismicportal.eu/fdsnws/event/1/query?lat=45.81&lon=15.98&maxradius=1.5&format=json',
    ]);
  });
});

describe('module coverage', () => {
  const schema = `export type ModuleId =\n  | 'zet-rt'\n  | 'prometnice'\n  | 'emsc';\n\nexport type Tier = 'open' | 'session';`;
  it('reads the ModuleId union and reports ids without a table row', () => {
    const ids = moduleIdsFromSchema(schema);
    expect(ids).toEqual(['zet-rt', 'prometnice', 'emsc']);
    const md = '| `zet-rt` | ... |\n| `emsc` | ... |\n';
    expect(missingModuleIds(ids, md)).toEqual(['prometnice']);
  });
});

describe('checkUrl', () => {
  it('reports HEAD success without a GET', async () => {
    const calls: string[] = [];
    const fetchImpl = async (_url: string, init: RequestInit) => {
      calls.push(init.method as string);
      return new Response(null, { status: 200 });
    };
    const row = await checkUrl('https://a.example/x', { fetchImpl });
    expect(row).toMatchObject({ url: 'https://a.example/x', method: 'HEAD', status: 200, ok: true });
    expect(calls).toEqual(['HEAD']);
  });

  it('falls back to GET when HEAD is refused and cancels the body', async () => {
    let cancelled = false;
    const fetchImpl = async (_url: string, init: RequestInit) => {
      if (init.method === 'HEAD') return new Response(null, { status: 405 });
      const body = new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024));
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(body, { status: 200 });
    };
    const row = await checkUrl('https://a.example/big.zip', { fetchImpl });
    expect(row).toMatchObject({ method: 'GET', status: 200, ok: true });
    expect(cancelled).toBe(true);
  });

  it('reports a network error as not ok with the message', async () => {
    const fetchImpl = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    const row = await checkUrl('https://nope.invalid/', { fetchImpl });
    expect(row.ok).toBe(false);
    expect(row.method).toBe('-');
    expect(row.error).toContain('ENOTFOUND');
  });
});

describe('findFillFields and renderTable', () => {
  it('lists every [[POPUNITI ...]] marker', () => {
    expect(findFillFields('a [[POPUNITI: OIB]] b [[POPUNITI: adresa]] c')).toEqual(['[[POPUNITI: OIB]]', '[[POPUNITI: adresa]]']);
    expect(findFillFields('clean')).toEqual([]);
  });
  it('renders one aligned line per URL', () => {
    const text = renderTable([
      { url: 'https://a.example/', method: 'HEAD', status: 200, ok: true, ms: 120 },
      { url: 'https://b.example/', method: '-', status: 0, ok: false, ms: 10000, error: 'timeout' },
    ]);
    const lines = text.split('\n');
    expect(lines[0]).toMatch(/^OK\s+STATUS\s+METHOD\s+MS\s+URL$/);
    expect(lines[1]).toMatch(/^ok\s+200\s+HEAD\s+120\s+https:\/\/a\.example\/$/);
    expect(lines[2]).toMatch(/^FAIL\s+0\s+-\s+10000\s+https:\/\/b\.example\/ {2}timeout$/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
npx vitest run --project unit test/scripts/check-plan-links.test.ts
```

Expected: `Failed to load url ../../scripts/check-plan-links.mjs`.

- [ ] **Step 3: Write the script**

Create `scripts/check-plan-links.mjs`:

```js
#!/usr/bin/env node
// Pre-filing check for the source register and the application text.
//   node scripts/check-plan-links.mjs            # every URL in docs/izvori.md answers; every ModuleId has a row
//   node scripts/check-plan-links.mjs --filing   # additionally: no [[POPUNITI ...]] field left in docs/prijava
// Prints a table and exits 1 on any failure. HEAD first, then GET with the body
// cancelled (the ZET static GTFS is 15 MB; we want its status, not its bytes).
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const USER_AGENT = 'vidikovac-link-check/0.1 (+https://zagreb.aningfilm.hr)';
const URL_RE = /https?:\/\/[^\s<>()\[\]"'`|]+/g;

/** Unique http(s) URLs in document order; trailing punctuation dropped; template URLs ({...}) skipped. */
export function extractUrls(markdown) {
  const out = [];
  const seen = new Set();
  for (const m of markdown.matchAll(URL_RE)) {
    let url = m[0].replace(/[.,;:!?]+$/, '');
    if (url.includes('{') || url.includes('}')) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function moduleIdsFromSchema(src) {
  const m = src.match(/export type ModuleId =([\s\S]*?);/);
  if (!m) throw new Error('ModuleId union not found');
  return [...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]);
}

/** Ids without a table row starting `| \`id\` |`. */
export function missingModuleIds(ids, markdown) {
  return ids.filter((id) => !new RegExp(`^\\| \`${id}\` \\|`, 'm').test(markdown));
}

export async function checkUrl(url, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const started = Date.now();
  const attempt = async (method) => {
    const res = await fetchImpl(url, {
      method,
      redirect: 'follow',
      headers: { 'user-agent': USER_AGENT, accept: '*/*' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.body) await res.body.cancel();
    return res;
  };
  try {
    let method = 'HEAD';
    let res = await attempt(method);
    if (res.status === 405 || res.status === 403 || res.status === 501 || res.status >= 500) {
      method = 'GET';
      res = await attempt(method);
    }
    return { url, method, status: res.status, ok: res.status >= 200 && res.status < 400, ms: Date.now() - started };
  } catch (err) {
    return { url, method: '-', status: 0, ok: false, ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
  }
}

export function findFillFields(text) {
  return [...text.matchAll(/\[\[POPUNITI[^\]]*\]\]/g)].map((m) => m[0]);
}

export function renderTable(rows) {
  const urlWidth = Math.max('URL'.length, ...rows.map((r) => r.url.length));
  const line = (ok, status, method, ms, url, error) =>
    `${ok.padEnd(4)}  ${String(status).padStart(6)}  ${method.padEnd(6)}  ${String(ms).padStart(5)}  ${url.padEnd(urlWidth)}${error ? `  ${error}` : ''}`.trimEnd();
  return [
    line('OK', 'STATUS', 'METHOD', 'MS', 'URL'),
    ...rows.map((r) => line(r.ok ? 'ok' : 'FAIL', r.status, r.method, r.ms, r.url, r.error)),
  ].join('\n');
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function main(argv = process.argv.slice(2), { cwd = process.cwd(), log = console.log, fetchImpl = fetch } = {}) {
  const filing = argv.includes('--filing');
  const izvoriPath = argv.find((a) => a.endsWith('.md')) ?? 'docs/izvori.md';
  const izvori = await readFile(resolve(cwd, izvoriPath), 'utf8');
  const schema = await readFile(resolve(cwd, 'worker/feed/schema.ts'), 'utf8');
  let failures = 0;

  const missing = missingModuleIds(moduleIdsFromSchema(schema), izvori);
  if (missing.length > 0) {
    log(`Modules without a row in ${izvoriPath}: ${missing.join(', ')}`);
    failures += missing.length;
  }

  const urls = extractUrls(izvori);
  const rows = await mapLimit(urls, 4, (u) => checkUrl(u, { fetchImpl }));
  log(renderTable(rows));
  failures += rows.filter((r) => !r.ok).length;

  if (filing) {
    const dir = resolve(cwd, 'docs/prijava');
    for (const name of (await readdir(dir)).filter((n) => n.endsWith('.md')).sort()) {
      const fields = findFillFields(await readFile(resolve(dir, name), 'utf8'));
      for (const f of fields) log(`POPUNITI  docs/prijava/${name}  ${f}`);
      failures += fields.length;
    }
  }

  log(failures === 0 ? `\nAll ${urls.length} URLs answer; every module documented${filing ? '; no fill-in fields left' : ''}.` : `\n${failures} problem(s).`);
  return failures === 0 ? 0 : 1;
}

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().then((code) => {
    process.exitCode = code;
  }, (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Run the unit test, then the script against the real register**

```
npx vitest run --project unit test/scripts/check-plan-links.test.ts
npm run check:izvori
npm run check:izvori -- --filing
```

Expected: the unit test reports `Tests 7 passed`. `npm run check:izvori` prints one `ok` line per URL in `docs/izvori.md` (about 30 rows; the ZET static GTFS row shows `GET` because zet.hr refuses HEAD) and ends with `All N URLs answer; every module documented.`, exit 0. With `--filing` it additionally lists the `[[POPUNITI: ...]]` fields still present in `docs/prijava/prijedlog-projekta.md` and exits 1; that is the expected state until Matija fills them on 16 September, after which the same command exits 0 and the application is ready to paste into Word.

- [ ] **Step 5: Commit**

```
git add scripts/check-plan-links.mjs test/scripts/check-plan-links.test.ts
git commit -m "Pre-filing check: every source URL answers, every module documented, no fill-in fields left" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Critical Files for Implementation

- `D:\scratch\vidikovac\e2e\pairing.spec.ts` (with `e2e\helpers.ts` and `playwright.config.ts`): the only automated proof of the mechanic; its data-testid, sessionStorage, bypass-header and 401 contracts bind Areas A, B and C.
- `D:\scratch\vidikovac\scripts\gtfs-routes.mjs`: produces `app\src\data\zet-routes.json` that the U pokretu layer needs to name ZET lines.
- `D:\scratch\vidikovac\docs\izvori.md`: the source register every attribution, `/izvori` page, `registry.ts` row and grant table must match; checked by `scripts\check-plan-links.mjs`.
- `D:\scratch\vidikovac\docs\prijava\prijedlog-projekta.md` (with `obrazac-3-financijski-plan.md`): the application text itself, structure and arithmetic guarded by `test\docs\prijava.test.ts`.
- `D:\scratch\vidikovac\worker\protocol.ts` and `D:\scratch\vidikovac\worker\feed\schema.ts`: read-only contracts whose names (`CreateBeaconResponse`, `ScanFail`, `CODE_ALPHABET`, `ModuleId`) the specs, helpers and doc tests import directly.
