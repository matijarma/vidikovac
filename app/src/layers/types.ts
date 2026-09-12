import type { Attribution, ModuleId, ModuleSnapshot } from '../../../worker/feed/schema';
import type { MapSlots } from '../map/map-slots';
import type { SchematicHost } from '../motion/schematic-host';
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
   * One live map per panel, owned by the page and reused across renders, so a
   * poll never re-creates a map (R-54). Absent in unit tests and on a browser
   * with no map, and the layer then renders its list-only fallback.
   *
   * Contract: until maplibre-gl is upgraded past 6.9.0 (tracked separately —
   * installed ^5 carries GHSA-jrc7-96c5-q579, a sanitizer XSS bypass), no
   * caller may pass feed-derived (external) text into a MapLibre Popup or
   * marker HTML reached through these maps; only static, hard-coded strings.
   */
  maps?: MapSlots;
  /**
   * The page's one schematic (T9, motion/schematic-host.ts), owned by the
   * page and reused across renders exactly like `maps`, so a poll never
   * throws away the motion model's fix history. Absent in unit tests and on
   * the kiosk's essentials view; the U pokretu layer then renders no
   * schematic panel.
   */
  schematic?: SchematicHost;
  reducedMotion?: boolean;
  /** R-L1: decided once at the entry and passed down, exactly like `reducedMotion`. */
  lightweight?: boolean;
  /** Kiosk layout: bigger type, no action buttons (no touch). */
  kiosk?: boolean;
}

export type LayerRenderer = (ctx: LayerContext) => HTMLElement;
