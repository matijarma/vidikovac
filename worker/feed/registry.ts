import type { Attribution, FetchContext, ModuleId, ModuleSpec, Tier } from './schema';
import type { FeedPayload } from './payload';

// The registry is the single source of truth for tier, refresh windows and
// attribution. Module files know only how to parse their own source.

export const OPEN_LICENCE = 'Otvorena dozvola (NN 67/17)';
export const EMSC_LICENCE = 'EMSC terms';
export const HRT_LICENCE = 'HRT uvjeti korištenja, tekst uz navođenje izvora i poveznicu';

// Controller ruling R-08 fixes these strings. Braces are templates filled at
// render time from the snapshot (sourceUpdatedAt, item title, act number); the
// registry stores the template verbatim and never substitutes.
export const ATTRIBUTION: Record<ModuleId, Attribution> = {
  'zet-rt': {
    text: 'Public dataset by ZET provided under Open license, dataset source http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669',
    url: 'http://www.zet.hr/odredbe/datoteke-u-gtfs-formatu/669',
    licence: OPEN_LICENCE,
  },
  prometnice: {
    text: "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup 'Zatvaranje prometnica na području Grada Zagreba', posljednja izmjena {datum}",
    url: 'https://data.zagreb.hr/dataset/prometnice',
    licence: OPEN_LICENCE,
  },
  'dhmz-now': {
    text: 'Izvor: DHMZ, Otvorena dozvola, {vrijeme}',
    url: 'https://meteo.hr/proizvodi.php?section=podaci&param=xml_korisnici',
    licence: OPEN_LICENCE,
  },
  'dhmz-forecast': {
    text: 'Izvor: DHMZ, Otvorena dozvola, {vrijeme}',
    url: 'https://meteo.hr/proizvodi.php?section=podaci&param=xml_korisnici',
    licence: OPEN_LICENCE,
  },
  'dhmz-cap': {
    text: 'Izvor: DHMZ, Otvorena dozvola, {vrijeme}',
    url: 'https://meteo.hr/proizvodi.php?section=podaci&param=xml_korisnici',
    licence: OPEN_LICENCE,
  },
  emsc: {
    text: 'Izvor: EMSC, seismicportal.eu',
    url: 'https://www.seismicportal.eu/',
    licence: EMSC_LICENCE,
  },
  'hrt-news': {
    text: 'Izvor: HRT, {naslov}, poveznica na izvornik',
    url: 'https://feed.hrt.hr/vijesti/page.xml',
    licence: HRT_LICENCE,
  },
  glasnik: {
    text: 'Izvor: Službeni glasnik Grada Zagreba, {broj}/{godina}, akt {id}',
    url: 'https://www1.zagreb.hr/sluzbeni-glasnik/',
    licence: OPEN_LICENCE,
  },
  'ckan-geo': {
    text: "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup '{naziv}', posljednja izmjena {datum}",
    url: 'https://data.zagreb.hr/',
    licence: OPEN_LICENCE,
  },
};

interface ModuleDefinition {
  id: ModuleId;
  tier: Tier;
  /** Seconds a live snapshot is served from the Cache API before refetching. */
  ttl: number;
  /** Seconds a KV last-good copy may still be served as 'stale'. */
  maxStale: number;
  load: (ctx: FetchContext) => Promise<FeedPayload>;
}

function defineModule(def: ModuleDefinition): ModuleSpec {
  const attribution = ATTRIBUTION[def.id];
  return {
    id: def.id,
    tier: def.tier,
    ttl: def.ttl,
    maxStale: def.maxStale,
    attribution,
    fetcher: async (ctx) => {
      const payload = await def.load(ctx);
      return {
        module: def.id,
        tier: def.tier,
        fetchedAt: ctx.now().toISOString(),
        ...(payload.sourceUpdatedAt ? { sourceUpdatedAt: payload.sourceUpdatedAt } : {}),
        attribution,
        items: payload.items.map((item) => ({ ...item, module: def.id, tier: def.tier })),
      };
    },
  };
}

/** Placeholder loader: tasks A4-A11 replace these one module at a time. */
function notImplemented(id: ModuleId): () => Promise<FeedPayload> {
  return async () => {
    throw new Error(`feed module ${id} not implemented`);
  };
}

export const MODULES: Record<ModuleId, ModuleSpec> = {
  'zet-rt': defineModule({ id: 'zet-rt', tier: 'session', ttl: 30, maxStale: 300, load: notImplemented('zet-rt') }),
  prometnice: defineModule({ id: 'prometnice', tier: 'open', ttl: 180, maxStale: 1800, load: notImplemented('prometnice') }),
  'dhmz-now': defineModule({ id: 'dhmz-now', tier: 'session', ttl: 600, maxStale: 7200, load: notImplemented('dhmz-now') }),
  'dhmz-forecast': defineModule({ id: 'dhmz-forecast', tier: 'session', ttl: 1800, maxStale: 86400, load: notImplemented('dhmz-forecast') }),
  'dhmz-cap': defineModule({ id: 'dhmz-cap', tier: 'open', ttl: 300, maxStale: 7200, load: notImplemented('dhmz-cap') }),
  emsc: defineModule({ id: 'emsc', tier: 'open', ttl: 60, maxStale: 3600, load: notImplemented('emsc') }),
  'hrt-news': defineModule({ id: 'hrt-news', tier: 'session', ttl: 300, maxStale: 7200, load: notImplemented('hrt-news') }),
  glasnik: defineModule({ id: 'glasnik', tier: 'session', ttl: 3600, maxStale: 604800, load: notImplemented('glasnik') }),
  'ckan-geo': defineModule({ id: 'ckan-geo', tier: 'open', ttl: 86400, maxStale: 2592000, load: notImplemented('ckan-geo') }),
};

export const MODULE_IDS = Object.keys(MODULES) as ModuleId[];

export function isModuleId(value: string): value is ModuleId {
  return Object.prototype.hasOwnProperty.call(MODULES, value);
}

/** Readable without a session: the safety tier and the kiosk teaser. */
export const OPEN_MODULES: ModuleId[] = MODULE_IDS.filter((id) => MODULES[id].tier === 'open');

/** Refreshed by the five-minute cron; faster modules are refreshed on demand. */
export const WARM_MODULES: ModuleId[] = MODULE_IDS.filter((id) => MODULES[id].ttl >= 300);

const FETCHER_OVERRIDES = new Map<ModuleId, ModuleSpec['fetcher']>();

/** Every read of a spec goes through here, so tests can stand in for an upstream. */
export function moduleSpec(id: ModuleId): ModuleSpec {
  const spec = MODULES[id];
  if (!spec) throw new Error(`unknown feed module: ${id}`);
  const override = FETCHER_OVERRIDES.get(id);
  return override ? { ...spec, fetcher: override } : spec;
}

/** Test seam. Production code never calls this; `null` removes the override. */
export function setFetcherForTest(id: ModuleId, fetcher: ModuleSpec['fetcher'] | null): void {
  if (fetcher) FETCHER_OVERRIDES.set(id, fetcher);
  else FETCHER_OVERRIDES.delete(id);
}

export function clearFetcherOverrides(): void {
  FETCHER_OVERRIDES.clear();
}
