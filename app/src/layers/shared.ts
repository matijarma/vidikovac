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
