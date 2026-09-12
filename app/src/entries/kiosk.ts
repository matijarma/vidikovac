// Page entry for /kiosk/. R-16: with the theme module in <head> these are the
// page's only two scripts, both external. R-37: an entry imports the three
// shared stylesheets plus the component stylesheets its page actually uses.
// Reads the one-time provisioning fragment (or the stored credentials), mounts
// the kiosk, and strips the secret from the address bar so a reload never
// re-provisions from history.
import { bootPage } from '../boot';
import { mountKiosk } from '../kiosk';
import { createCityMap } from '../map/city-map';
import { repaintOn } from '../ui/canvas';
import { detectLagano, markLagano } from '../ui/lagano';
import '../ui/tokens.css';
import '../ui/base.css';
import '../ui/fonts.css';
import '../ui/panel.css';
import '../ui/layers.css';
import '../ui/qr.css';
import '../ui/kiosk.css';

const { i18n, theme } = bootPage({ page: 'kiosk' });
const root = document.querySelector<HTMLElement>('#kiosk')!;
const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function safeLocalStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

// A WebGL context is the cheapest real probe for "old/weak GPU or driver",
// which deviceMemory and prefers-reduced-data both miss on their own (R-L1).
function canWebgl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

// R-L1: decided once, here, and passed down as a dependency exactly like
// reducedMotion above — mountKiosk never reads navigator/matchMedia itself.
const lightweight = detectLagano({
  search: location.search,
  storage: safeLocalStorage(),
  navigator: { deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory },
  matchMedia: (query) => globalThis.matchMedia(query),
  canWebgl,
});
markLagano(document.documentElement, lightweight);

mountKiosk(root, {
  i18n,
  hash: location.hash,
  reducedMotion,
  lightweight,
  onRepaint: repaintOn(theme),
  mapFactory: createCityMap,
});
// The secret is in localStorage now; keep it out of the address bar and history.
if (location.hash) history.replaceState(null, '', '/kiosk/');
