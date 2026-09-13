// The one answer every surface gives about safety: urgent, calm or unknown.
// Calm is claimed only when the warning, quake and closure sources all
// answered; a missing or failed source makes the state unknown, never clear.
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import type { FeedSnapshots } from '../core/contracts';
import { unconfirmed } from './status';

export const QUAKE_WINDOW_MS = 72 * 60 * 60 * 1000;
/** A quake stamped slightly in the future (clock skew at the source) still counts. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const URGENT_QUAKE_MAGNITUDE = 3;

export type SafetyLevel = 'urgent' | 'calm' | 'unknown';

export interface SafetyState {
  level: SafetyLevel;
  warnings: FeedItem[];
  activeWarnings: FeedItem[];
  quakes72h: FeedItem[];
  activeClosures: FeedItem[];
  /** The oldest confirmation time among the three sources, when all answered. */
  confirmedAt: string | null;
  unknownSources: string[];
}

export function isActiveWarning(item: FeedItem, now: number): boolean {
  const start = item.at ? Date.parse(item.at) : NaN;
  const end = item.until ? Date.parse(item.until) : NaN;
  if (Number.isFinite(start) && start > now) return false;
  if (Number.isFinite(end) && end < now) return false;
  return true;
}

export function recentQuakes(snapshot: ModuleSnapshot | undefined, now: number): FeedItem[] {
  return (snapshot?.items ?? []).filter((q) => {
    const at = q.at ? Date.parse(q.at) : NaN;
    return Number.isFinite(at) && now - at <= QUAKE_WINDOW_MS && at - now <= FUTURE_TOLERANCE_MS;
  });
}

/** Closures whose own window includes now; a closure without an end is still open. */
export function activeClosures(snapshot: ModuleSnapshot | undefined, now: number): FeedItem[] {
  return (snapshot?.items ?? []).filter((c) => {
    if (c.kind !== 'closure') return false;
    const start = c.at ? Date.parse(c.at) : NaN;
    const end = c.until ? Date.parse(c.until) : NaN;
    if (Number.isFinite(start) && start > now) return false;
    if (Number.isFinite(end) && end < now) return false;
    return true;
  });
}

function magnitude(item: FeedItem): number {
  const value = item.data?.mag;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function safetyState(snapshots: FeedSnapshots, now: number): SafetyState {
  const cap = snapshots['dhmz-cap'];
  const emsc = snapshots.emsc;
  const roads = snapshots.prometnice;
  const warnings = cap?.items ?? [];
  const activeWarnings = warnings.filter((w) => isActiveWarning(w, now));
  const quakes72h = recentQuakes(emsc, now);
  const closures = activeClosures(roads, now);
  const unknownSources: string[] = [];
  if (unconfirmed(cap)) unknownSources.push('dhmz-cap');
  if (unconfirmed(emsc)) unknownSources.push('emsc');
  if (unconfirmed(roads)) unknownSources.push('prometnice');
  const urgent =
    activeWarnings.some((w) => w.severity === 'severe' || w.severity === 'extreme' || w.severity === 'moderate') ||
    quakes72h.some((q) => magnitude(q) >= URGENT_QUAKE_MAGNITUDE);
  const times = [cap, emsc, roads].map((s) => s?.fetchedAt).filter((t): t is string => Boolean(t)).sort();
  return {
    level: urgent ? 'urgent' : unknownSources.length ? 'unknown' : 'calm',
    warnings,
    activeWarnings,
    quakes72h,
    activeClosures: closures,
    confirmedAt: unknownSources.length === 0 && times.length === 3 ? times[0]! : null,
    unknownSources,
  };
}
