// One panel shape for every layer, on the phone, the desktop and the kiosk:
// title, freshness (word plus shape, never colour alone), body slot, and a
// footer that carries the source line verbatim, the licence, a link to the
// original and the export actions. Nothing here fetches or polls.
import type { Attribution, FeedItem, ModuleId, ModuleSnapshot } from '../../../worker/feed/schema';
import type { LayerId } from '../../../worker/protocol';
import { zagrebTime } from '../format';
import type { I18n } from '../i18n/i18n';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';

export type Freshness = 'zivo' | 'danas' | 'referenca';

/** Živo means the snapshot is younger than this and the source answered. */
export const ZIVO_MAX_MS = 5 * 60_000;

/** Modules that are reference material, not a reading of the city right now. */
export const REFERENCE_MODULES: readonly ModuleId[] = ['glasnik', 'ckan-geo'];

export function freshnessFor(snapshot: ModuleSnapshot, now: number): Freshness {
  if (REFERENCE_MODULES.includes(snapshot.module)) return 'referenca';
  const fetched = Date.parse(snapshot.fetchedAt);
  const fresh = Number.isFinite(fetched) && now - fetched < ZIVO_MAX_MS;
  return snapshot.status === 'live' && fresh ? 'zivo' : 'danas';
}

export function statusText(snapshot: ModuleSnapshot, i18n: I18n, _now: number): string {
  if (snapshot.status === 'down') return i18n.t('status.down');
  const time = zagrebTime(snapshot.sourceUpdatedAt ?? snapshot.fetchedAt);
  return i18n.t(snapshot.status === 'stale' ? 'status.stale' : 'status.live', { time });
}

export function attributionMarkup(attribution: Attribution, i18n: I18n): string {
  return `<p class="panel-attr" data-testid="panel-attr"><span class="panel-attr-text">${escapeHtml(attribution.text)}</span> <a class="panel-attr-link" href="${escapeAttribute(attribution.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(i18n.t('common.openSource'))}</a> <span class="panel-licence">${escapeHtml(i18n.t('attribution.licence'))}: ${escapeHtml(attribution.licence)}</span></p>`;
}

/** `rows` are markup fragments the layer has already escaped. */
export function listMarkup(rows: readonly string[], emptyText: string): string {
  if (rows.length === 0) return `<p class="panel-empty">${escapeHtml(emptyText)}</p>`;
  return `<ul class="panel-list">${rows.map((row) => `<li>${row}</li>`).join('')}</ul>`;
}

export function dataNumber(item: FeedItem | undefined, key: string): number | null {
  const value = item?.data?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function dataText(item: FeedItem | undefined, key: string): string {
  const value = item?.data?.[key];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

export interface PanelAction {
  /** Suffix of the button id, so the dashboard can restore focus after a refresh. */
  id: string;
  label: string;
  run(): void | Promise<void>;
}

export interface PanelOptions {
  i18n: I18n;
  now: number;
  title: string;
  /** Markup the layer escaped itself, or a ready element (the map). */
  body: string | HTMLElement;
  snapshot?: ModuleSnapshot;
  freshness?: Freshness;
  headingLevel?: 2 | 3;
  id?: string;
  copyText?: string;
  onCopy?: (text: string, attribution: Attribution) => void;
  shareUrl?: string;
  onShare?: (url: string, title: string) => void;
  extraActions?: PanelAction[];
}

export interface PanelHandle {
  element: HTMLElement;
  body: HTMLElement;
}

let uid = 0;

export function createPanel(options: PanelOptions): PanelHandle {
  const { i18n, now } = options;
  const id = options.id ?? `panel-${++uid}`;
  const safeId = escapeAttribute(id);
  const fresh = options.freshness ?? (options.snapshot ? freshnessFor(options.snapshot, now) : 'danas');
  const level = options.headingLevel ?? 3;

  const element = createElementFromHTML(
    `<section class="panel" data-testid="panel" data-freshness="${fresh}" aria-labelledby="${safeId}-title">
      <header class="panel-head">
        <h${level} class="panel-title" id="${safeId}-title">${escapeHtml(options.title)}</h${level}>
        <p class="panel-fresh" data-testid="panel-freshness"><span class="fresh-shape" aria-hidden="true"></span>${escapeHtml(i18n.t(`freshness.${fresh}`))}</p>
      </header>
      <div class="panel-body" data-testid="panel-body"></div>
      <footer class="panel-foot">
        ${options.snapshot ? `<p class="panel-status" data-testid="panel-status" data-status="${options.snapshot.status}">${escapeHtml(statusText(options.snapshot, i18n, now))}</p>` : ''}
        ${options.snapshot ? attributionMarkup(options.snapshot.attribution, i18n) : ''}
        <div class="panel-actions" data-testid="panel-actions"></div>
      </footer>
    </section>`,
  );

  const body = element.querySelector<HTMLElement>('[data-testid=panel-body]')!;
  if (typeof options.body === 'string') body.innerHTML = options.body;
  else body.appendChild(options.body);

  const actions: PanelAction[] = [];
  const { copyText, onCopy, snapshot, shareUrl, onShare } = options;
  if (copyText && onCopy && snapshot) {
    actions.push({ id: 'copy', label: i18n.t('common.copy'), run: () => onCopy(copyText, snapshot.attribution) });
  }
  if (shareUrl && onShare) {
    actions.push({ id: 'share', label: i18n.t('common.share'), run: () => onShare(shareUrl, options.title) });
  }
  actions.push(...(options.extraActions ?? []));

  const bar = element.querySelector<HTMLElement>('[data-testid=panel-actions]')!;
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn-ghost panel-action';
    button.id = `${id}-${action.id}`;
    button.dataset.action = action.id;
    button.textContent = action.label;
    button.addEventListener('click', () => {
      void action.run();
    });
    bar.appendChild(button);
  }

  return { element, body };
}

export function createLayerSection(
  layer: LayerId,
  title: string,
): { section: HTMLElement; heading: HTMLElement; panels: HTMLElement } {
  const section = createElementFromHTML(
    `<section class="layer" id="layer-${layer}" data-layer="${layer}" aria-labelledby="layer-title-${layer}">
      <h2 class="layer-title" id="layer-title-${layer}" tabindex="-1">${escapeHtml(title)}</h2>
      <div class="layer-panels" data-testid="layer-panels"></div>
    </section>`,
  );
  return {
    section,
    heading: section.querySelector<HTMLElement>('.layer-title')!,
    panels: section.querySelector<HTMLElement>('.layer-panels')!,
  };
}
