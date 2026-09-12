import type { FeedItem, ModuleId, ModuleSnapshot } from '../../../worker/feed/schema';
import type { LayerId } from '../../../worker/protocol';
import type { PublicSelection } from '../../../worker/public-selection';
import type { LocaleCode } from '../i18n/i18n';
import type { ResolvedTheme, ThemePreference } from '../ui/theme';

export { publicItemKey, parseSelection, selectionParams } from '../../../worker/public-selection';
export type { PublicSelection } from '../../../worker/public-selection';

export interface ScreenStop {
  id: string;
  name: string;
  lon: number;
  lat: number;
  routes: string[];
}

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

/** Additive controller hooks used by all new surfaces; no global browser dependency. */
export interface ExperienceActions {
  view?: ViewState;
  screen?: ScreenContext;
  errors?: FeedErrors;
  navigate?: (layer: LayerId, selection?: PublicSelection | null) => void;
  setFilter?: (key: string, value: string) => void;
  onRetry?: (module: ModuleId) => void;
  onItemExport?: (kind: 'ics' | 'geojson' | 'print', item: FeedItem, snapshot: ModuleSnapshot) => void;
  onItemCopy?: (item: FeedItem, snapshot: ModuleSnapshot) => void;
  onItemShare?: (item: FeedItem, snapshot: ModuleSnapshot) => void;
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
