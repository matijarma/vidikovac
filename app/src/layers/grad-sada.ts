// Sada: the whole city on one time axis (newdesignsystem.md §4.2, plan A.4).
// The workspace is the band and nothing else. First the phone's segmented
// control (sticky under the header; a desk hides it by CSS and reads the five
// heads instead), then the band itself: the heads, the axis and the lanes in
// time order, sada · poslijepodne · večeras · sutra · tjedan, then one line of
// provenance. Every fact on the page is a tile a producer described
// (experience/producers) and buildTimeband placed, capped and marked, so a
// finger, a Tab key and a screen reader travel one order on every surface and
// this file composes without a block builder of its own. Weather is status in
// the sada head on the phone (D4, D11), never a tile; the desktop's status
// line carries it instead. The root is reconciled in place, so a poll swaps
// only the values that changed.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { provenanceBlock } from '../experience/status';
import { buildTimeband, renderTimeband, renderTimebandSeg } from '../experience/timeband';
import { createElementFromHTML, escapeHtml } from '../ui/dom/escape';
import type { LayerContext } from './types';

export function renderGradSada(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  const model = buildTimeband(ctx);
  return createElementFromHTML(`<section class="layer ws ws-overview" id="layer-grad-sada" data-layer="grad-sada" data-reconcile aria-labelledby="layer-title-grad-sada">
<h2 class="layer-title visually-hidden" id="layer-title-grad-sada" tabindex="-1">${escapeHtml(i18n.t('layers.grad-sada'))}</h2>
${renderTimebandSeg(i18n, model)}
${renderTimeband(i18n, model)}
${provenanceBlock(i18n, Object.values(ctx.snapshots) as (ModuleSnapshot | undefined)[])}
</section>`);
}
