import type { Attribution, ModuleId, ModuleSnapshot } from '../../../worker/feed/schema';
import type { MapFactory } from '../map/city-map';
import type { I18n } from '../i18n/i18n';

export type ExportKind = 'ics' | 'geojson' | 'print';

/** Everything a layer renderer is allowed to know. No fetching, no timers. */
export interface LayerContext {
  i18n: I18n;
  snapshots: Partial<Record<ModuleId, ModuleSnapshot>>;
  now: number;
  onCopy?: (text: string, attribution: Attribution) => void;
  onShare?: (url: string, title: string) => void;
  onExport?: (kind: ExportKind, module: ModuleId) => void;
  /**
   * Injected so unit tests never load MapLibre; the pages pass createCityMap.
   * Contract: until maplibre-gl is upgraded past 6.9.0 (tracked separately —
   * installed ^5 carries GHSA-jrc7-96c5-q579, a sanitizer XSS bypass), no
   * caller may pass feed-derived (external) text into a MapLibre Popup or
   * marker HTML reached through this factory; only static, hard-coded strings.
   */
  mapFactory?: MapFactory;
  reducedMotion?: boolean;
  /** Kiosk layout: bigger type, no action buttons (no touch). */
  kiosk?: boolean;
}

export type LayerRenderer = (ctx: LayerContext) => HTMLElement;
