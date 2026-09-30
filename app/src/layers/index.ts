// The six layers, by LayerId, plus the modules each one reads so the dashboard
// and the kiosk poll exactly what is on screen and nothing else.
import type { ModuleId } from '../../../worker/feed/schema';
import { LAYERS, type LayerId } from '../../../worker/protocol';
import { renderGradSada } from './grad-sada';
import { renderKultura } from './kultura';
import { renderSigurnost } from './sigurnost';
import type { LayerContext, LayerRenderer } from './types';
import { renderUPokretu } from './u-pokretu';
import { renderUpravaIPravo } from './uprava-i-pravo';
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
};

export const LAYER_MODULES: Record<LayerId, ModuleId[]> = {
  // The overview composes five domains: weather, safety, transit, the next
  // dated events and the gazette issue.
  // The five October 2026 modules (U3) are read by Sada's list beside the rest: the City's and the libraries' programmes,
  // DHMZ's hourly steps, HAK's road report and the planned power and water cuts.
  'grad-sada': ['dhmz-now', 'dhmz-forecast', 'dhmz-cap', 'zet-rt', 'prometnice', 'emsc', 'dogadanja', 'glasnik', 'kultura-zg', 'programi', 'dhmz-hourly', 'hak', 'prekidi'],
  // Transport notices (ZET's two feeds) ride in the dogadanja module.
  'u-pokretu': ['zet-rt', 'prometnice', 'dogadanja'],
  // DHMZ's hourly steps are Vrijeme's strip (R0).
  'zrak-i-nebo': ['dhmz-now', 'dhmz-forecast', 'dhmz-cap', 'emsc', 'dhmz-hourly'],
  // HAK's road states and the planned cuts are listed in Sigurnost (R0).
  sigurnost: ['dhmz-cap', 'emsc', 'prometnice', 'ckan-geo', 'hak', 'prekidi'],
  // dogadanja is one module, session tier, shared by both layers below: each
  // reads the same merged snapshot and filters to its own subset of the six
  // sources (kultura.ts, uprava-i-pravo.ts), so it is listed for both. Kultura
  // also lists the City's culture programme (kultura-zg) and the libraries'
  // programme (programi), whose every item is culture.
  'uprava-i-pravo': ['glasnik', 'dogadanja'],
  kultura: ['dogadanja', 'kultura-zg', 'programi'],
};

/** Every module any layer needs, once: what the wide grid polls. */
export const ALL_LAYER_MODULES: ModuleId[] = [...new Set(LAYERS.flatMap((layer) => LAYER_MODULES[layer]))];

export function renderLayer(layer: LayerId, ctx: LayerContext): HTMLElement {
  return LAYER_RENDERERS[layer](ctx);
}
