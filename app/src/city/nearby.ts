// Seam S5 (docs/companion-2026-09-22.md §15.2 and §12): the "U blizini"
// timeline's selection layer, shared by the wall (app/src/kiosk/timeline.ts)
// and the phone's Sada and Karta sheet (WP4). Owned by WP1, which fills
// selectNearby with the builders and bounds of §12 (at most three departures,
// one solar event, one last-departures row, the first tram from 22:00, one
// "uvijek" row, the pharmacy at night). Pure: no DOM, no fetch, no clock.
//
// The circle is measured per place [O-68]: the caller passes `radiusM` from
// shared/city/frame.ts frameRadiusM(place, stops, frame), never a Kadar.
import type { LiveVehicleRef } from '../../../shared/city/arrivals';
import { pillText } from '../../../shared/city/frame';
import type { ScreenPlace } from '../../../shared/city/place';
import type { CityState, DepartureBoard } from '../../../shared/city/types';
import type { FeedSnapshots, PublicSelection } from '../core/contracts';
import type { LastRunSnapshot } from '../core/lastrun';
import type { I18n } from '../i18n/i18n';
import type { MapHighlight } from '../map/city-map';

export type NearbyKind = 'departure' | 'closure' | 'event' | 'solar' | 'last' | 'first' | 'opening' | 'always' | 'pharmacy';

/** One row of the timeline; the markup (li.nearby-row[data-id][data-kind]…) is derived from it. */
export interface NearbyRow {
  /** Stable across ticks, so a row that stays keeps its DOM node ("dep:<tripId>", "closure:<id>", …). */
  id: string;
  kind: NearbyKind;
  /** When the row happens, epoch ms; null for an "uvijek" row. */
  atMs: number | null;
  /** True for the "uvijek" row (data-always="1"). */
  always: boolean;
  title: string;
  sub: string;
  /** A departure timed by a tracked vehicle (data-live="1"). */
  live: boolean;
  /** Where the row comes from (data-source): a feed module id or a static data set. */
  source: string;
  /** What the phone opens when the row is tapped. */
  selection?: PublicSelection;
  /** What the map highlights while the row is the subject. */
  map?: MapHighlight;
}

/** Everything the selection reads; the caller owns every clock and cache. */
export interface NearbyInput {
  /** Never null: a screen without an address takes Trg bana J. Jelačića [O-65]. */
  place: ScreenPlace;
  /** The measured circle, metres (frameRadiusM). */
  radiusM: number;
  now: number;
  /** Scheduled boards of the place's platforms (shared/city/arrivals.ts reads them). */
  boards: readonly DepartureBoard[];
  /** Live vehicles, so a departure with a tracked vehicle counts down. */
  fixes: readonly LiveVehicleRef[];
  snapshots: FeedSnapshots;
  city: CityState;
  lastRun: LastRunSnapshot | null;
  locale: string;
  i18n: I18n;
}

/** The rows for a place, in time order, within the bounds of §12. Stub until WP1 step 2: no rows. */
export function selectNearby(input: NearbyInput): NearbyRow[] {
  void input;
  return [];
}

/**
 * The timeline's head: "U blizini · " and the measured circle, "U blizini · 2 km · ~15 min".
 * The words are the owner's (byte-exact); WP1 moves them to kiosk.nearby.* when it adds
 * that key group, and the text stays the same.
 */
export function nearbyHead(i18n: I18n, radiusM: number): string {
  void i18n;
  return `U blizini · ${pillText(radiusM)}`;
}

/** The smallest and the largest timeline row. */
export const ROW_MIN_PX = 64;
export const ROW_MAX_PX = 92;

/**
 * How tall the rows are and how many whole rows fit: few rows grow up to 92 px, many
 * shrink to 64 px, and only whole rows show (600 px for 3 rows → 92 px, 6 fit; for 12
 * → 64 px, 9 fit). An unbounded box (Infinity, the handheld list) shows every row at 64 px.
 */
export function rowBudget(availablePx: number, count: number): { rowPx: number; rows: number } {
  if (availablePx === Number.POSITIVE_INFINITY) return { rowPx: ROW_MIN_PX, rows: Math.max(0, count) };
  if (!(availablePx > 0)) return { rowPx: ROW_MIN_PX, rows: 0 };
  const rowPx = Math.min(ROW_MAX_PX, Math.max(ROW_MIN_PX, Math.floor(availablePx / Math.max(count, 1))));
  return { rowPx, rows: Math.floor(availablePx / rowPx) };
}
