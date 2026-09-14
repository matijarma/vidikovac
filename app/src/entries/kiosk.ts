// Page entry for /kiosk/. R-16: with the theme module in <head> these are the
// page's only two scripts, both external. R-37: an entry imports the shared
// stylesheets plus the component stylesheets its page actually uses -- the
// kiosk's compositions (app/src/kiosk.ts, app/src/kiosk/*) draw with
// kiosk.css and the QR plate alone. Reads the one-time provisioning fragment
// (or the stored credentials, or nothing: then the self-service setup shows),
// mounts the kiosk, and strips the secret from the address bar so a reload
// never re-provisions from history.
import { bootPage } from '../boot';
import { mountKiosk } from '../kiosk';
import { createCityMap } from '../map/city-map';
import { repaintOn } from '../ui/canvas';
import { detectLagano, markLagano } from '../ui/lagano';
import '../ui/tokens.css';
import '../ui/base.css';
import '../ui/signage.css';
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
// R-F3: the web fonts are the modern path's typography and never reach the
// lightweight graph -- Croatian text pulls latin and latin-ext of every face,
// more than the whole 200 kB promise (§1.10) on their own. A dynamic import
// makes Vite emit fonts.css as its own chunk, loaded here only when the entry
// has decided against the light path; the lightweight screen keeps the system
// stack kiosk.css already names.
if (!lightweight) void import('../ui/fonts.css');

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
