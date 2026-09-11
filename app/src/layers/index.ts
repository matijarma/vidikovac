// The seven layers, by LayerId, plus the modules each one reads so the dashboard
// and the kiosk poll exactly what is on screen and nothing else.
import type { ModuleId } from '../../../worker/feed/schema';
import { LAYERS, type LayerId } from '../../../worker/protocol';
import { renderGradSada } from './grad-sada';
import { renderKultura } from './kultura';
import { renderSigurnost } from './sigurnost';
import type { LayerContext, LayerRenderer } from './types';
import { renderUPokretu } from './u-pokretu';
import { renderUpravaIPravo } from './uprava-i-pravo';
import { renderVijesti } from './vijesti';
import { renderZrakINebo } from './zrak-i-nebo';

export type { ExportKind, LayerContext, LayerRenderer } from './types';
export { routeDelays } from './u-pokretu';

export const LAYER_RENDERERS: Record<LayerId, LayerRenderer> = {
  'grad-sada': renderGradSada,
  'u-pokretu': renderUPokretu,
  'zrak-i-nebo': renderZrakINebo,
  sigurnost: renderSigurnost,
  'uprava-i-pravo': renderUpravaIPravo,
  kultura: renderKultura,
  vijesti: renderVijesti,
};

export const LAYER_MODULES: Record<LayerId, ModuleId[]> = {
  'grad-sada': ['dhmz-now', 'dhmz-forecast', 'dhmz-cap', 'zet-rt', 'prometnice'],
  'u-pokretu': ['zet-rt', 'prometnice'],
  'zrak-i-nebo': ['emsc', 'dhmz-cap', 'dhmz-forecast'],
  sigurnost: ['dhmz-cap', 'emsc', 'prometnice', 'ckan-geo'],
  'uprava-i-pravo': ['glasnik'],
  kultura: [],
  vijesti: ['hrt-news'],
};

/** Every module any layer needs, once: what the wide grid polls. */
export const ALL_LAYER_MODULES: ModuleId[] = [...new Set(LAYERS.flatMap((layer) => LAYER_MODULES[layer]))];

export function renderLayer(layer: LayerId, ctx: LayerContext): HTMLElement {
  return LAYER_RENDERERS[layer](ctx);
}
