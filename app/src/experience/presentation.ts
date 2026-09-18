import { areaName, isAreaSlug } from '../../../worker/pairing/areas';
import type { PresentationState, PresentationTarget } from '../../../worker/presentation';
import { publicItemKey, type FeedSnapshots, type ScreenStop } from '../core/contracts';
import type { I18n } from '../i18n/i18n';
import { routeLongName } from '../kiosk/stops';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import type { CityState } from '../../../shared/city/types';
import { ct } from '../city/strings';

/** A title resolved from public data, never from text submitted by a client. */
export function presentationTargetLabel(
  i18n: I18n, target: PresentationTarget | null,
  snapshots: FeedSnapshots = {}, stops: readonly ScreenStop[] = [],
  city?:CityState,
): string {
  if (!target) return i18n.t('presentation.overview');
  let title = target.layer === 'kvart'
    ? isAreaSlug(target.district) ? areaName(target.district) : i18n.t('nav.kvart')
    : i18n.t(`layers.${target.layer}`);
  const selection = target.selection;
  if(selection?.kind==='place')title=city?.places.find(p=>p.id===selection.id)?.name??city?.live?.bikes.find(p=>`bajs-${p.id}`===selection.id)?.name??city?.live?.air.find(p=>`air-${p.id}`===selection.id)?.name??ct(i18n,'selected');
  else if(selection?.kind==='street')title=city?.streets.find(s=>s.id===selection.id)?.name??ct(i18n,'streets');
  else if (selection?.kind === 'route') title = `${selection.id} · ${routeLongName(selection.id)}`;
  else if (selection?.kind === 'stop') title = stops.find(s => s.id === selection.id)?.name ?? i18n.t('kiosk.session.selectedStop', { stop: selection.id });
  else if (selection?.kind === 'item') {
    const item = snapshots[selection.module]?.items.find(i => publicItemKey(selection.module, i.id) === selection.id);
    if (item) title = item.title;
  }
  const timeKey = { sada: 'sada', danas: 'today', veceras: 'tonight', sutra: 'tomorrow', tjedan: 'week' } as const;
  if (target.time && target.time !== 'sada') title += ` · ${i18n.t(`timeband.${timeKey[target.time]}`)}`;
  return title;
}

export interface PresentationPanelModel {
  open: boolean;
  state?: PresentationState;
  target: PresentationTarget;
  targetLabel: string;
  currentLabel: string;
  screenLabel: string;
  can: boolean;
  canStop?:boolean;
  confirming: boolean;
  pending: boolean;
  message: string;
}

export function presentationButton(i18n: I18n, open: boolean, state?: PresentationState): string {
  const active = state?.owner === 'self' && state.target !== null;
  return `<button class="ki-screen" type="button" data-key="screen" data-action="presentation" data-testid="screen-control" aria-expanded="${open}" aria-controls="presentation-panel" data-active="${active ? 'true' : 'false'}" title="${escapeAttribute(i18n.t(active ? 'presentation.self' : 'presentation.title'))}">${iconMarkup('cast')}<span>${escapeHtml(i18n.t('presentation.control'))}</span></button>`;
}

export function presentationPanel(i18n: I18n, m: PresentationPanelModel): string {
  if (!m.open) return '';
  const t = (key: string) => escapeHtml(i18n.t(`presentation.${key}`));
  const owner = m.state?.owner === 'self' ? 'self' : m.state?.owner === 'other' ? 'other' : 'ready';
  const submit = m.confirming
    ? `<div class="present-confirm" role="group" aria-label="${t('takeover')}"><p>${t('confirm')}</p><div class="present-actions"><button type="button" class="btn btn-primary" data-action="present-confirm">${t('takeover')}</button><button type="button" class="btn-quiet" data-action="present-cancel">${t('cancel')}</button></div></div>`
    : `<div class="present-actions"><button type="button" class="btn btn-primary" data-action="present-request" data-testid="present-view"${!m.can || m.pending ? ' disabled' : ''}>${iconMarkup('cast')}<span>${t('present')}</span></button>${m.state?.owner === 'self' ? `<button type="button" class="btn-ghost" data-action="present-stop" data-testid="stop-presentation"${!(m.canStop??m.can) || m.pending ? ' disabled' : ''}>${t('stop')}</button>` : ''}</div>`;
  return `<section class="present" id="presentation-panel" data-testid="presentation-panel" aria-labelledby="presentation-title">
    <header class="present-head"><div><h2 id="presentation-title">${t('title')}</h2><p>${escapeHtml(m.screenLabel)} · ${t(owner)}</p></div><button class="icon-btn btn-quiet" type="button" data-action="presentation-close" aria-label="${t('close')}">${iconMarkup('x')}</button></header>
    <div class="present-views"><div><p class="present-label">${t('current')}</p><p class="present-subject">${escapeHtml(m.currentLabel)}</p></div><div><p class="present-label">${t('next')}</p><p class="present-subject">${escapeHtml(m.targetLabel)}</p></div></div>
    ${submit}
    ${m.message ? `<p class="present-feedback" role="status" data-testid="presentation-feedback">${escapeHtml(m.message)}${m.message === i18n.t('presentation.notConfirmed') ? ` <button type="button" class="btn-quiet" data-action="present-retry">${t('retry')}</button>` : ''}</p>` : ''}
    <p class="present-private">${t('private')}</p>
  </section>`;
}
