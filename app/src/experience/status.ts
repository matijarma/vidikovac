// Source truth for every domain: what a snapshot's status, its independent
// sub-sources and its coverage allow the screen to claim. Missing data is
// never zero; a failed request keeps the last good data and says so.
import type { ModuleId, ModuleSnapshot } from '../../../worker/feed/schema';
import { fillAttribution } from '../attribution';
import { zagrebTime } from '../format';
import type { I18n } from '../i18n/i18n';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';

export type SourceState = 'loading' | 'live' | 'stale' | 'down';

export function sourceState(snapshot: ModuleSnapshot | undefined): SourceState {
  if (!snapshot) return 'loading';
  return snapshot.status;
}

/** Names of sub-sources the module reports as down, when it reports them independently. */
export function downSources(snapshot: ModuleSnapshot | undefined): string[] {
  return Object.entries(snapshot?.sources ?? {})
    .filter(([, availability]) => availability.status === 'down')
    .map(([name]) => name);
}

/**
 * True when the source cannot vouch for the absence of anything right now:
 * no snapshot, a failed source, or last-good data kept through a failure. A
 * stale list still shows its items, marked stale, but an empty stale list is
 * never a current all-clear.
 */
export function unconfirmed(snapshot: ModuleSnapshot | undefined): boolean {
  return !snapshot || snapshot.status !== 'live';
}

/** True when there is nothing to show at all: no snapshot or a failed source. Last-good stale values are still usable, marked as such. */
export function unusable(snapshot: ModuleSnapshot | undefined): boolean {
  return !snapshot || snapshot.status === 'down';
}

export function dataTime(snapshot: ModuleSnapshot): string {
  return zagrebTime(snapshot.sourceUpdatedAt ?? snapshot.fetchedAt);
}

/** One line: the source's own data time (or, plainly, the fetch time) and whether the source is answering. */
export function statusLine(i18n: I18n, snapshot: ModuleSnapshot | undefined, error?: string): string {
  if (!snapshot) return error ? i18n.t('status.unknown') : i18n.t('status.loading');
  if (snapshot.status === 'down') return i18n.t('status.down');
  const time = dataTime(snapshot);
  const base = snapshot.status === 'stale'
    ? i18n.t('status.stale', { time })
    : snapshot.sourceUpdatedAt ? i18n.t('status.live', { time }) : i18n.t('status.fetched', { time });
  const down = downSources(snapshot);
  return down.length ? `${base} · ${i18n.t('status.sourcesDown', { list: down.join(', ') })}` : base;
}

export function coverageText(i18n: I18n, snapshot: ModuleSnapshot | undefined): string {
  const coverage = snapshot?.coverage;
  if (!coverage || !coverage.limited) return '';
  return coverage.total !== undefined
    ? i18n.t('status.coverage', { shown: coverage.shown, total: coverage.total })
    : i18n.t('status.coverageShown', { shown: coverage.shown });
}

export type StateKind = 'loading' | 'empty' | 'unknown' | 'down' | 'stale';

export interface StateOptions {
  /** Adds a retry action for this module. */
  retry?: ModuleId;
  testid?: string;
}

/** The one quiet block for loading, valid-empty, unknown and unavailable. */
export function stateBlock(i18n: I18n, kind: StateKind, message: string, options: StateOptions = {}): string {
  const retry = options.retry
    ? `<div class="state-actions"><button type="button" class="btn-ghost" data-action="retry" data-module="${escapeAttribute(options.retry)}">${iconMarkup('refresh-cw', undefined, 'icon icon-sm')}<span>${escapeHtml(i18n.t('status.retry'))}</span></button></div>`
    : '';
  const testid = options.testid ? ` data-testid="${escapeAttribute(options.testid)}"` : '';
  return `<div class="state" data-kind="${kind}"${testid} role="${kind === 'loading' ? 'status' : 'note'}"><p class="state-text">${escapeHtml(message)}</p>${retry}</div>`;
}

/** Loading, then unavailable-with-retry, then the honest empty sentence; '' when there are items. */
export function listState(
  i18n: I18n,
  snapshot: ModuleSnapshot | undefined,
  module: ModuleId,
  count: number,
  emptyText: string,
  error?: string,
): string {
  if (!snapshot) return error ? stateBlock(i18n, 'down', i18n.t('status.unknown'), { retry: module }) : stateBlock(i18n, 'loading', i18n.t('status.loading'));
  if (count > 0) return '';
  if (snapshot.status === 'down') return stateBlock(i18n, 'down', i18n.t('status.unknown'), { retry: module });
  if (snapshot.status === 'stale') return stateBlock(i18n, 'stale', `${i18n.t('status.unknown')} ${i18n.t('status.staleNote')}`, { retry: module });
  return stateBlock(i18n, 'empty', emptyText);
}

/** The compact source footer: filled attribution, licence and the link to the original. */
export function attributionFoot(i18n: I18n, snapshot: ModuleSnapshot | undefined, extra = ''): string {
  if (!snapshot) return '';
  const { attribution } = snapshot;
  const text = fillAttribution(attribution, snapshot, snapshot.items[0]);
  return `<footer class="source" data-testid="panel-attr"><p class="source-line"><span class="source-text">${escapeHtml(text)}</span> <span class="source-licence">${escapeHtml(i18n.t('attribution.licence'))}: ${escapeHtml(attribution.licence)}</span> <a class="source-link" href="${escapeAttribute(attribution.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(i18n.t('common.openSource'))}${iconMarkup('external-link', undefined, 'icon icon-sm')}</a></p>${extra}</footer>`;
}

/**
 * Source health as a word plus a shape, never colour alone. Live carries no
 * time: a successful fetch is not an observation or publication time, and each
 * domain states its real data time in its own words. Stale names the moment
 * the last good copy stopped being confirmed.
 */
export function statusBadge(i18n: I18n, snapshot: ModuleSnapshot | undefined, error?: string): string {
  const state = snapshot ? snapshot.status : error ? 'down' : 'loading';
  const word = !snapshot
    ? i18n.t(error ? 'status.unknown' : 'status.loading')
    : state === 'down'
      ? i18n.t('status.down')
      : state === 'stale'
        ? i18n.t('status.staleShort', { time: zagrebTime(snapshot.staleSince ?? snapshot.fetchedAt) })
        : i18n.t('freshness.zivo');
  return `<span class="badge status-badge" data-tone="${state === 'loading' ? 'info' : state}" data-testid="panel-status" data-status="${state}">${escapeHtml(word)}</span>`;
}
