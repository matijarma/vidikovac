// The small polling contract stays in the initial controller bundle.
// The presented-view renderer is loaded only after an explicit request.
import type { ModuleId } from '../../../worker/feed/schema';
import type { LayerId } from '../../../worker/protocol';

export const KIOSK_LAYER_MODULES: Record<LayerId, ModuleId[]> = {
  'grad-sada': ['dhmz-now', 'dhmz-forecast', 'dhmz-cap', 'zet-rt', 'prometnice', 'dogadanja', 'glasnik'],
  'u-pokretu': ['zet-rt', 'prometnice'],
  'zrak-i-nebo': ['dhmz-now', 'dhmz-forecast', 'dhmz-cap', 'emsc'],
  sigurnost: ['dhmz-cap', 'emsc', 'prometnice', 'ckan-geo'],
  'uprava-i-pravo': ['glasnik', 'dogadanja'],
  kultura: ['dogadanja'],
};
