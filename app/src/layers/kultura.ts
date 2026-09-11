// Kultura i sjećanje has no live source in stage 1. Rather than fake one, the
// layer states the plan and is marked Referenca.
import { createLayerSection, createPanel } from '../panels/panel';
import { escapeHtml } from '../ui/dom/escape';
import type { LayerContext } from './types';

export const EUROPEANA_URL = 'https://www.europeana.eu/hr';
export const NSK_URL = 'https://digitalna.nsk.hr/';

export function renderKultura(ctx: LayerContext): HTMLElement {
  const { i18n, now } = ctx;
  const { section, panels } = createLayerSection('kultura', i18n.t('layers.kultura'));
  panels.appendChild(
    createPanel({
      i18n, now, id: 'kultura-roadmap', title: i18n.t('panels.culture'), freshness: 'referenca',
      body: `<p>${escapeHtml(i18n.t('panels.cultureStage1'))}</p>
        <ul class="panel-facts">
          <li><a href="${EUROPEANA_URL}" rel="noopener noreferrer" target="_blank">${escapeHtml(i18n.t('panels.cultureEuropeana'))}</a></li>
          <li><a href="${NSK_URL}" rel="noopener noreferrer" target="_blank">${escapeHtml(i18n.t('panels.cultureNsk'))}</a></li>
        </ul>`,
    }).element,
  );
  return section;
}
