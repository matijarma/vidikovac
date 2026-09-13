// Row markup shared by more than one layer, factored out so a future change to
// the CAP-warning or closure line shape only has to happen once: grad-sada,
// sigurnost and zrak-i-nebo all show a warning line; sigurnost and u-pokretu
// both show a closure line, sigurnost's alone adding the traffic direction.
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import { zagrebDateTime, zagrebTime } from '../format';
import type { I18n } from '../i18n/i18n';
import { dataNumber, dataText } from '../panels/panel';
import { escapeHtml } from '../ui/dom/escape';

export interface CapWarningRowOptions {
  /** sigurnost's fuller card: the summary line and a line break before "until", instead of a plain separator. */
  withSummary?: boolean;
}

/** One CAP warning row: severity label, title and the time it holds until. */
export function capWarningRow(w: FeedItem, i18n: I18n, options: CapWarningRowOptions = {}): string {
  const label = `<strong>${escapeHtml(i18n.t(`panels.severity.${w.severity ?? 'info'}`))}</strong> · ${escapeHtml(w.title)}`;
  const until = escapeHtml(i18n.t('panels.until', { time: zagrebTime(w.until) }));
  return options.withSummary
    ? `${label}<br><span class="panel-sub">${escapeHtml(w.summary ?? '')} ${until}</span>`
    : `${label}<span class="panel-sub"> ${until}</span>`;
}

export interface ClosureRowOptions {
  /** sigurnost also states the traffic direction; u-pokretu's map already shows it. */
  withDirection?: boolean;
}

/** One street-closure row: title, closure type, optionally direction, and the time it holds until. */
export function closureRow(c: FeedItem, i18n: I18n, options: ClosureRowOptions = {}): string {
  const type = escapeHtml(i18n.t(`panels.closureType.${dataText(c, 'subtype') || 'ROAD_CLOSED'}`));
  const direction = options.withDirection
    ? ` · ${escapeHtml(i18n.t(`panels.direction.${dataText(c, 'direction') || 'BOTH_DIRECTIONS'}`))}`
    : '';
  const until = escapeHtml(i18n.t('panels.until', { time: zagrebDateTime(c.until) }));
  return `<strong>${escapeHtml(c.title)}</strong><span class="panel-sub"> ${type}${direction} · ${until}</span>`;
}

/**
 * Vehicles moving now, from either shape of a zet-rt snapshot: the teaser's
 * reduced shape (one summary item, id 'vozila', carrying the count in
 * data.vehicles) or the full session shape (one pin per moving vehicle, id
 * prefixed 'vehicle:', counted directly). `null` when there is no snapshot
 * yet — distinct from the panorama's honest zero.
 */
export function vehicleCount(snapshot: ModuleSnapshot | undefined): number | null {
  if (!snapshot) return null;
  const teaser = snapshot.items.find((item) => item.id === 'vozila');
  if (teaser) return dataNumber(teaser, 'vehicles');
  return snapshot.items.filter((item) => item.id.startsWith('vehicle:')).length;
}

/**
 * `panels.delayLate`/`delayEarly`/`delayOnTime` in words, for a route's
 * `medianDelaySeconds` (or an equivalent per-route delay figure): the single
 * ±15 s on-time band every surface that shows a route's delay must agree on
 * — u-pokretu.ts's delay panel, kiosk.ts's essentials row and the schematic's
 * lightweight route list all call this instead of each carrying their own
 * copy of the threshold, so a future change to the band changes all three
 * at once instead of risking three answers to "is this route on time?".
 *
 * R-F8 / R-P7: raw seconds never appear on a screen -- a rider reads "kasni
 * 2 min", never "+120 s". Minutes are rounded to the nearest and floored at
 * one once a route is off the band at all, so "kasni 0 min" (16 s late)
 * never prints a claim of punctuality the band itself already denied.
 */
/** Presentation bound, not a correction to the upstream data. Very large
 * medians cannot be interpreted as a useful current route delay. Keep the
 * raw source value intact and report the reading as unconfirmed instead. */
export const MAX_ROUTE_DELAY_SECONDS = 90 * 60;

export function plausibleRouteDelay(seconds: number | null | undefined): seconds is number {
  return typeof seconds === 'number' && Number.isFinite(seconds) && Math.abs(seconds) <= MAX_ROUTE_DELAY_SECONDS;
}

export function delayWord(i18n: I18n, seconds: number | null | undefined): string {
  if (!plausibleRouteDelay(seconds)) return i18n.t('transit.noDelayData');
  const minutes = Math.max(1, Math.round(Math.abs(seconds) / 60));
  if (seconds > 15) return i18n.t('panels.delayLate', { minutes });
  if (seconds < -15) return i18n.t('panels.delayEarly', { minutes });
  return i18n.t('panels.delayOnTime');
}
