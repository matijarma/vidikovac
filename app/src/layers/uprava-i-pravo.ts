// Uprava i pravo: the latest acts from the Službeni glasnik, printable (the
// print stylesheet turns a panel into a readable A4 page with the permalink).
import { zagrebDateTime } from '../format';
import { createLayerSection, createPanel, dataText, listMarkup } from '../panels/panel';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import type { LayerContext } from './types';

export function renderUpravaIPravo(ctx: LayerContext): HTMLElement {
  const { i18n, snapshots, now } = ctx;
  const { section, panels } = createLayerSection('uprava-i-pravo', i18n.t('layers.uprava-i-pravo'));
  const glasnik = snapshots.glasnik;

  const rows = (glasnik?.items ?? []).map((act) => {
    const number = `${dataText(act, 'broj')}/${dataText(act, 'godina')}`;
    const link = act.link
      ? ` <a href="${escapeAttribute(act.link)}" rel="noopener noreferrer" target="_blank">${escapeHtml(i18n.t('common.openSource'))}</a>`
      : '';
    return `<span data-testid="act-row"><strong>${escapeHtml(act.title)}</strong><span class="panel-sub"> ${escapeHtml(number)} · ${escapeHtml(zagrebDateTime(act.at))}</span>${link}</span>`;
  });

  panels.appendChild(
    createPanel({
      i18n, now, id: 'uprava-i-pravo-acts', title: i18n.t('panels.acts'), snapshot: glasnik,
      body: listMarkup(rows, i18n.t('status.empty')),
      onCopy: ctx.onCopy,
      copyText: (glasnik?.items ?? []).map((a) => `${a.title} (${dataText(a, 'broj')}/${dataText(a, 'godina')}) ${a.link ?? ''}`).join('\n') || undefined,
      extraActions: ctx.onExport ? [{ id: 'print', label: i18n.t('panels.actsPrint'), run: () => ctx.onExport?.('print', 'glasnik') }] : undefined,
    }).element,
  );

  return section;
}
