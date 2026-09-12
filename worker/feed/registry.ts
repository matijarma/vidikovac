import type { Attribution, FeedItem, FetchContext, ModuleId, ModuleSnapshot, ModuleSpec, Tier } from './schema';
import type { FeedPayload } from './payload';
import { fetchCkanGeo } from './modules/ckan-geo';
import { fetchDhmzCap } from './modules/dhmz-cap';
import { fetchDhmzForecast } from './modules/dhmz-forecast';
import { fetchDhmzNow } from './modules/dhmz-now';
import { fetchEmsc } from './modules/emsc';
import { fetchGlasnik } from './modules/glasnik';
import { fetchHrtNews } from './modules/hrt-news';
import { fetchPrometnice } from './modules/prometnice';
import { fetchZetRt } from './modules/zet-rt';
import { DOGADANJA_ATTRIBUTION, fetchDogadanja } from './modules/dogadanja';
import { KOMUNALNE_URL } from './modules/dogadanja/komunalne';
import { openLicenceEvents } from './modules/dogadanja/licence';

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
  // Blends two licences (CC BY-SA 3.0 HR for Kulturpunkt, Otvorena dozvola for
  // the other five) -- see dogadanja/index.ts's own header for why this one
  // row can't state a single licence the way every other module's row does.
  dogadanja: DOGADANJA_ATTRIBUTION,
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

export const MODULES: Record<ModuleId, ModuleSpec> = {
  'zet-rt': defineModule({ id: 'zet-rt', tier: 'session', ttl: 30, maxStale: 300, load: fetchZetRt }),
  prometnice: defineModule({ id: 'prometnice', tier: 'open', ttl: 180, maxStale: 1800, load: fetchPrometnice }),
  'dhmz-now': defineModule({ id: 'dhmz-now', tier: 'session', ttl: 600, maxStale: 7200, load: fetchDhmzNow }),
  'dhmz-forecast': defineModule({ id: 'dhmz-forecast', tier: 'session', ttl: 1800, maxStale: 86400, load: fetchDhmzForecast }),
  'dhmz-cap': defineModule({ id: 'dhmz-cap', tier: 'open', ttl: 300, maxStale: 7200, load: fetchDhmzCap }),
  emsc: defineModule({ id: 'emsc', tier: 'open', ttl: 60, maxStale: 3600, load: fetchEmsc }),
  'hrt-news': defineModule({ id: 'hrt-news', tier: 'session', ttl: 300, maxStale: 7200, load: fetchHrtNews }),
  glasnik: defineModule({ id: 'glasnik', tier: 'session', ttl: 3600, maxStale: 604800, load: fetchGlasnik }),
  'ckan-geo': defineModule({ id: 'ckan-geo', tier: 'open', ttl: 86400, maxStale: 2592000, load: fetchCkanGeo }),
  // Not built through defineModule: its own fetcher already returns the
  // complete snapshot (module/tier/fetchedAt/attribution/items stamped
  // itself), plus `sourceCounts`, which defineModule's generic wrapper would
  // silently drop (it constructs a fresh object literal from a plain
  // FeedPayload and never spreads one through). See dogadanja/index.ts.
  dogadanja: {
    id: 'dogadanja',
    tier: 'session',
    ttl: 900,
    maxStale: 86400,
    attribution: DOGADANJA_ATTRIBUTION,
    fetcher: fetchDogadanja,
  },
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

// The kiosk shows a reduced view of four session modules before anyone scans:
// enough to be useful standing in a cafe, not enough to replace the session.
// dogadanja is reduced by licence first and only then by size (teaserSubset below).
export const TEASER_MODULES: readonly ModuleId[] = ['dhmz-now', 'zet-rt', 'hrt-news', 'dogadanja'];
export const TEASER_NEWS_LIMIT = 3;
export const TEASER_EMSC_LIMIT = 10;
// The kiosk shows one city row per card; ten leaves room for the card to grow
// without shipping the whole register (40 komunalne rows with their activity
// text) to every screen every 30 s.
export const TEASER_EVENTS_LIMIT = 10;

function vozila(count: number): string {
  return count % 10 === 1 && count % 100 !== 11 ? `${count} vozilo` : `${count} vozila`;
}

// What the open tier may say about dogadanja: the merged module's own
// attribution (DOGADANJA_ATTRIBUTION) names all six sources and two licences,
// which is right on a session panel and wrong on a public screen that carries
// only the Otvorena dozvola rows. The url is the one open dataset the reduced
// copy always draws on; every item still carries its own link.
export const DOGADANJA_OPEN_ATTRIBUTION: Attribution = {
  text:
    'Izvor: Grad Zagreb (Skupština Grada Zagreba, kvartovske novosti, plan komunalnih aktivnosti s data.zagreb.hr) i ZET, ' +
    'Otvorena dozvola; poveznica uz svaku stavku',
  url: KOMUNALNE_URL,
  licence: OPEN_LICENCE,
};

export function teaserSubset(snapshot: ModuleSnapshot): ModuleSnapshot {
  switch (snapshot.module) {
    case 'dhmz-now':
      return snapshot;
    case 'zet-rt': {
      const vehicles = snapshot.items.filter((item) => item.id.startsWith('vehicle:')).length;
      const delays = snapshot.items.filter((item) => item.id.startsWith('route:'));
      const count: FeedItem = {
        id: 'vozila',
        module: 'zet-rt',
        kind: 'vehicle',
        tier: snapshot.tier,
        title: `${vozila(vehicles)} u pokretu`,
        data: { vehicles },
      };
      return { ...snapshot, items: [count, ...delays] };
    }
    case 'hrt-news':
      return { ...snapshot, items: snapshot.items.slice(0, TEASER_NEWS_LIMIT) };
    case 'dogadanja':
      // The licence boundary (modules/dogadanja/licence.ts): Kulturpunkt
      // (CC BY-SA 3.0 HR) and Etnografski rows never leave the session tier.
      // Filtered first, then cut, so the cap never eats the open rows.
      // `sourceCounts`, the module's own extra property, is deliberately not
      // carried: the open copy states nothing about the sources it may not show.
      return {
        module: snapshot.module,
        tier: snapshot.tier,
        status: snapshot.status,
        fetchedAt: snapshot.fetchedAt,
        ...(snapshot.staleSince ? { staleSince: snapshot.staleSince } : {}),
        ...(snapshot.sourceUpdatedAt ? { sourceUpdatedAt: snapshot.sourceUpdatedAt } : {}),
        attribution: DOGADANJA_OPEN_ATTRIBUTION,
        items: openLicenceEvents(snapshot.items).slice(0, TEASER_EVENTS_LIMIT),
      };
    case 'emsc': {
      const newestFirst = [...snapshot.items].sort((a, b) => Date.parse(b.at ?? '') - Date.parse(a.at ?? ''));
      return { ...snapshot, items: newestFirst.slice(0, TEASER_EMSC_LIMIT) };
    }
    default:
      return snapshot;
  }
}
