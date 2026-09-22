import type { FeedItem, ModuleId, ModuleSnapshot } from '../../../worker/feed/schema';
import type { LayerId, ScreenStop } from '../../../worker/protocol';
import type { PublicSelection } from '../../../worker/public-selection';
import type { LocaleCode } from '../i18n/i18n';
import type { ResolvedTheme, ThemePreference } from '../ui/theme';
import type { MobilitySnapshot, WasteSnapshot } from './mobility';
import type { LastRunSnapshot } from './lastrun';
import type { NotifyFlags } from './notify-store';
import type { SavedStore } from './saved-store';
import type { CityState } from '../../../shared/city/types';
import type { LocationContext } from '../city/location';
import type { PlaceContext } from '../city/place';
import type { BoardCache } from '../city/boards';

export { publicItemKey, parseSelection, selectionParams } from '../../../worker/public-selection';
export type { PublicSelection } from '../../../worker/public-selection';

export type { ScreenStop } from '../../../worker/protocol';

export interface ViewState {
  layer: LayerId;
  selection: PublicSelection | null;
  filters: Readonly<Record<string, string>>;
}

export interface ScreenContext {
  surface: 'phone' | 'desktop' | 'kiosk';
  locale: LocaleCode;
  theme: ResolvedTheme;
  themePreference: ThemePreference;
  lightweight: boolean;
  reducedMotion: boolean;
  stop?: ScreenStop;
}

export type FeedSnapshots = Partial<Record<ModuleId, ModuleSnapshot>>;
export type FeedErrors = Partial<Record<ModuleId, string>>;

/** Why the cast button is disabled, when it is (D5): no screen on the session, a one-hop
 *  peer (never the driver), the session frozen, or the socket still connecting. */
export type CastReason = 'no-screen' | 'peer' | 'frozen' | 'connecting' | 'screen-offline' | 'unsupported';

/** The cast button's state, computed once by the dashboard and read by the presentation
 *  panel and the transport detail head alike (D5). */
export interface CastState {
  can: boolean;
  reason: CastReason | null;
  screenLabel: string | null;
  stopName: string | null;
}

/** Additive controller hooks used by all new surfaces; no global browser dependency. */
export interface ExperienceActions {
  location?: LocationContext;
  /** The phone's place (city/place.ts resolvePlace): the screen's place or stop, a saved stop, the stop
   *  nearest the reference, or Trg bana J. Jelačića; titles Sada and names the stop its departures come from. */
  place?: PlaceContext;
  setLocation?: (location: LocationContext) => void;
  boards?: BoardCache;
  onLocalData?: () => void;
  city?: CityState;
  ensureCity?: (ids: readonly string[]) => void;
  /** Disposes persistent workspace listeners when the owning surface ends. */
  onDispose?: (dispose:()=>void)=>void;
  view?: ViewState;
  screen?: ScreenContext;
  errors?: FeedErrors;
  navigate?: (layer: LayerId, selection?: PublicSelection | null) => void;
  setFilter?: (key: string, value: string) => void;
  onRetry?: (module: ModuleId) => void;
  onItemExport?: (kind: 'ics' | 'geojson' | 'print', item: FeedItem, snapshot: ModuleSnapshot) => void;
  onItemCopy?: (item: FeedItem, snapshot: ModuleSnapshot) => void;
  onItemShare?: (item: FeedItem, snapshot: ModuleSnapshot) => void;
  /** Local tile highlighting only, never a push (spec §4.9). */
  notify?: NotifyFlags;
  /** Read-only: a layer only checks and lists what is saved, it never mutates the store directly. */
  saved?: Pick<SavedStore, 'list' | 'has'>;
  cast?: CastState;
  /** The stop catalogue (`loadStops`), fetched once per session: the place and its departures stop are resolved from it (D16). */
  stops?: readonly ScreenStop[];
  /** The stop catalogue's last load failed (the page asks again a bounded number of times); absent or false while it loads or once it is in hand. */
  stopsDown?: boolean;
  /** The nearest bike-share and parking stations (plan T3.2, D7): undefined until
   *  FEED_BIKES / FEED_PARKING turn on with their worker module. */
  bikes?: MobilitySnapshot;
  parking?: MobilitySnapshot;
  /** The city's waste pickups (plan T3.2, D7): undefined until FEED_WASTE turns on. */
  waste?: WasteSnapshot;
  /** The screen stop's last scheduled departures per line (T3.1, behind FEED_LASTRUN): loaded once per
   *  session from GTFS static, null until it answers or without a stop; never read from zet-rt. */
  lastRun?: LastRunSnapshot | null;
}

/** Versioned regional basemap; hosting and source credits are not supplied by feeds. */
export const MAP_CONFIG = Object.freeze({
  version: 'zagreb-v1',
  tiles: '/maps/zagreb-v1/{z}/{x}/{y}.mvt',
  glyphs: '/maps/fonts/{fontstack}/{range}.pbf',
  sprite: '/maps/sprites/light',
  darkSprite: '/maps/sprites/dark',
  bounds: [15.70, 45.50, 16.30, 46.02] as [number, number, number, number],
  minzoom: 0,
  maxzoom: 14,
  attribution: '© OpenStreetMap contributors · Protomaps',
});
