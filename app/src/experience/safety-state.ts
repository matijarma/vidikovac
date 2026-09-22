// The one answer every surface gives about safety: urgent, calm or unknown.
// Calm is claimed only when the warning, quake and closure sources all
// answered; a missing or failed source makes the state unknown, never clear.
// The level's glyph and its verdict in words live here too, so the wall's
// footer (kiosk/frame.ts) and the phone's safety band read one answer.
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import type { FeedSnapshots } from '../core/contracts';
import type { I18n } from '../i18n/i18n';
import type { IconName } from '../ui/icons';
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

/** The glyph each level carries, beside its word, on every surface that names the level. */
export const SAFETY_ICON: Record<SafetyLevel, IconName> = { calm: 'check-circle', urgent: 'triangle-alert', unknown: 'alert-circle' };

/**
 * The severities that make the city urgent, ranked. It is the same predicate
 * `safetyState` raises `urgent` from, so a warning may name the verdict only
 * when it is itself a reason for it; `minor` and `info` are real DHMZ
 * severities and neither is.
 */
const URGENT_RANK: Record<string, number> = { extreme: 3, severe: 2, moderate: 1 };

/** The safety verdict in the words the domain uses: the top warning when one is the reason, otherwise calm, unconfirmed, or the urgent word. */
export function safetyVerdict(i18n: I18n, state: SafetyState): string {
  if (state.level === 'calm') return i18n.t('safety.calm');
  if (state.level === 'unknown') return i18n.t('directory.safetySummaryUnknown');
  // Urgency can come from the quake instead. Then the band says so in the
  // domain's own word rather than borrowing the colour of a warning that is
  // not the reason ("zeleno" is never a level word anywhere, R-K1).
  const top = [...state.activeWarnings]
    .filter((w) => URGENT_RANK[w.severity ?? ''] !== undefined)
    .sort((a, b) => (URGENT_RANK[b.severity!] ?? 0) - (URGENT_RANK[a.severity!] ?? 0))[0];
  if (!top) return i18n.t('safety.urgent');
  return `${i18n.t(`panels.severity.${top.severity}`)}: ${top.title}`;
}
