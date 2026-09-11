// Sigurnost inside a session shows exactly what /hitno shows to everyone, in the
// same order, and links to the untimed page (WCAG 2.2.1 alternative).
import { zagrebDateTime, zagrebTime } from '../format';
import { createLayerSection, createPanel, dataNumber, dataText, listMarkup } from '../panels/panel';
import { escapeHtml } from '../ui/dom/escape';
import type { LayerContext } from './types';

export function renderSigurnost(ctx: LayerContext): HTMLElement {
  const { i18n, snapshots, now } = ctx;
  const { section, panels } = createLayerSection('sigurnost', i18n.t('layers.sigurnost'));

  const note = document.createElement('p');
  note.className = 'layer-note';
  note.textContent = i18n.t('panels.safetyOpen');
  const link = document.createElement('a');
  link.href = '/hitno';
  link.dataset.testid = 'hitno-link';
  link.textContent = i18n.t('panels.safetyLink');
  note.append(' ', link);
  section.insertBefore(note, panels);

  const cap = snapshots['dhmz-cap'];
  panels.appendChild(
    createPanel({
      i18n, now, id: 'sigurnost-cap', title: i18n.t('panels.cap'), snapshot: cap,
      body: listMarkup(
        (cap?.items ?? []).map(
          (w) => `<strong>${escapeHtml(i18n.t(`panels.severity.${w.severity ?? 'info'}`))}</strong> · ${escapeHtml(w.title)}<br><span class="panel-sub">${escapeHtml(w.summary ?? '')} ${escapeHtml(i18n.t('panels.until', { time: zagrebTime(w.until) }))}</span>`,
        ),
        i18n.t('panels.capNone'),
      ),
      onCopy: ctx.onCopy,
      copyText: (cap?.items ?? []).map((w) => `${w.title}: ${w.summary ?? ''}`).join('\n') || undefined,
    }).element,
  );

  const emsc = snapshots.emsc;
  panels.appendChild(
    createPanel({
      i18n, now, id: 'sigurnost-quakes', title: i18n.t('panels.quakes'), snapshot: emsc,
      body: listMarkup(
        (emsc?.items ?? []).map(
          (q) => `<strong>${escapeHtml(i18n.t('panels.quakeMag', { mag: dataNumber(q, 'mag') ?? '–' }))}</strong> · ${escapeHtml(q.title)}<span class="panel-sub"> ${escapeHtml(i18n.t('panels.quakeDepth', { depth: dataNumber(q, 'depth') ?? '–' }))} · ${escapeHtml(zagrebDateTime(q.at))}</span>`,
        ),
        i18n.t('panels.quakeNone'),
      ),
    }).element,
  );

  const closures = snapshots.prometnice;
  panels.appendChild(
    createPanel({
      i18n, now, id: 'sigurnost-closures', title: i18n.t('panels.closures'), snapshot: closures,
      body: listMarkup(
        (closures?.items ?? []).map(
          (c) => `<strong>${escapeHtml(c.title)}</strong><span class="panel-sub"> ${escapeHtml(i18n.t(`panels.closureType.${dataText(c, 'subtype') || 'ROAD_CLOSED'}`))} · ${escapeHtml(i18n.t(`panels.direction.${dataText(c, 'direction') || 'BOTH_DIRECTIONS'}`))} · ${escapeHtml(i18n.t('panels.until', { time: zagrebDateTime(c.until) }))}</span>`,
        ),
        i18n.t('status.empty'),
      ),
      extraActions: ctx.onExport
        ? [
            { id: 'geojson', label: i18n.t('export.geojson'), run: () => ctx.onExport?.('geojson', 'prometnice') },
            { id: 'ics', label: i18n.t('export.ics'), run: () => ctx.onExport?.('ics', 'prometnice') },
          ]
        : undefined,
    }).element,
  );

  const poi = snapshots['ckan-geo'];
  panels.appendChild(
    createPanel({
      i18n, now, id: 'sigurnost-poi', title: i18n.t('panels.poi'), snapshot: poi,
      body: listMarkup(
        (poi?.items ?? []).map((p) => `${escapeHtml(p.title)}<span class="panel-sub"> ${escapeHtml(dataText(p, 'category'))}</span>`),
        i18n.t('status.empty'),
      ),
    }).element,
  );

  return section;
}
