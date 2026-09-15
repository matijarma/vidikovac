// The Kvart panel (plan B.5, D6, D9): the phone's Kvart tab workspace and the
// desktop's sticky aside, built from the same body. This file is the T2.6
// signature stub: the head with the map link, the selector row (phone only)
// and the cast section with its reason line. T2.7 fills in the map figure,
// the saved chips, the walking row, the bell row and the local note.
import type { ModuleId } from '../../../worker/feed/schema';
import type { CastState } from '../core/contracts';
import { kvartLabel } from '../core/kvart-store';
import type { SavedRef } from '../core/saved-store';
import type { I18n } from '../i18n/i18n';
import type { LayerContext } from '../layers/types';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import { kvartMenuMarkup } from './chrome';

export type KvartMode = 'workspace' | 'aside';

/** The cast state as the dashboard hands it over: `sentAt` marks the moment after a cast, while the button carries data-sent. */
type CastView = CastState & { sentAt?: number | null };

/** What the panel polls: works and closures for the kvart counts, plus the live delays when a route is saved (B.10). */
export function KVART_MODULES(saved: readonly SavedRef[]): ModuleId[] {
  const modules: ModuleId[] = ['prometnice', 'dogadanja'];
  if (saved.some((ref) => ref.kind === 'route')) modules.push('zet-rt');
  return modules;
}

function castReasonText(i18n: I18n, cast: CastView | undefined): string {
  if (!cast?.can) {
    switch (cast?.reason ?? 'connecting') {
      case 'no-screen': return i18n.t('cast.noScreen');
      case 'peer': return i18n.t('cast.peer');
      case 'frozen': return i18n.t('cast.frozen');
      default: return i18n.t('cast.connecting');
    }
  }
  // The screen is named by its operator label, then its stop; a reloaded view without either says nothing extra.
  if (cast.screenLabel && cast.stopName) return i18n.t('cast.targetStop', { label: cast.screenLabel, stop: cast.stopName });
  const name = cast.screenLabel ?? cast.stopName;
  return name ? i18n.t('cast.target', { label: name }) : '';
}

/** The primary: "Prebaci na zaslon" (D5), disabled but readable with the reason when it cannot fire. */
function castSection(i18n: I18n, cast: CastView | undefined): string {
  const can = cast?.can ?? false;
  const why = castReasonText(i18n, cast);
  const disabled = can ? '' : ` aria-disabled="true" title="${escapeAttribute(why)}"`;
  const sent = cast?.sentAt != null ? ' data-sent="1"' : '';
  return `<div class="kv-sec kv-castsec" data-key="cast"><button type="button" class="btn btn-primary kv-cast" data-action="cast" data-testid="cast-screen" aria-describedby="kv-cast-why"${disabled}${sent}>${iconMarkup('cast')}<span>${escapeHtml(i18n.t('cast.toScreen'))}</span></button><p class="kv-cast-why" id="kv-cast-why" data-testid="cast-why">${escapeHtml(why)}</p></div>`;
}

function mapLink(i18n: I18n, ctx: LayerContext): string {
  const stop = ctx.screen?.stop;
  const selection = stop ? ` data-selection="${escapeAttribute(JSON.stringify({ kind: 'stop', id: stop.id }))}"` : '';
  return `<a class="kv-maplink" href="#layer=u-pokretu" data-action="nav" data-layer="u-pokretu"${selection} data-testid="kvart-map-link"><span>${escapeHtml(i18n.t('kvart.map'))}</span>${iconMarkup('arrow-up-right', undefined, 'icon icon-sm')}</a>`;
}

/**
 * The phone workspace (`'workspace'`, reached by the Kvart tab) or the desktop
 * aside body (`'aside'`, without the selector row: the status line has it).
 */
export function renderKvart(ctx: LayerContext, mode: KvartMode): HTMLElement {
  const { i18n } = ctx;
  const title = ctx.kvartLabel ?? kvartLabel(i18n, ctx.kvart ?? null);
  const cast = ctx.cast as CastView | undefined;
  const body = castSection(i18n, cast);
  if (mode === 'aside') {
    return createElementFromHTML(`<section class="kv" data-testid="kvart-panel" data-reconcile aria-labelledby="kv-aside-title">
<header class="kv-head" data-key="head"><h2 class="kv-title" id="kv-aside-title">${escapeHtml(title)}</h2>${mapLink(i18n, ctx)}</header>
${body}
</section>`);
  }
  const pick = kvartMenuMarkup(i18n, { kvartChoice: ctx.kvartChoice ?? 'screen', kvartLabel: title, stopName: ctx.screen?.stop?.name ?? null }, { id: 'kv-kvart', className: 'kv-kvart-pick' });
  return createElementFromHTML(`<section class="layer ws ws-kvart" id="layer-kvart" data-layer="kvart" data-reconcile aria-labelledby="layer-title-kvart" data-testid="kvart-panel">
<header class="ws-head kv-head" data-key="head"><h2 class="layer-title kv-title" id="layer-title-kvart" tabindex="-1">${escapeHtml(title)}</h2>${mapLink(i18n, ctx)}</header>
<div class="kv-pick" data-key="pick">${pick}</div>
${body}
</section>`);
}
