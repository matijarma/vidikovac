// Page entry for /kiosk/. R-16: with the theme module in <head> these are the
// page's only two scripts, both external. R-37: an entry imports the shared
// stylesheets plus the component stylesheets its page actually uses -- the
// kiosk's compositions (app/src/kiosk.ts, app/src/kiosk/*) draw with
// kiosk.css and the QR plate alone. Reads the one-time provisioning fragment
// (or the stored credentials, or nothing: then the self-service setup shows),
// mounts the kiosk, and strips the secret from the address bar so a reload
// never re-provisions from history.
import { bootPage } from '../boot';
import { createMapModeStore } from '../core/map-mode-store';
import { mountKiosk } from '../kiosk';
import { parseKioskMapMode } from '../core/map-mode-store';
import { createMapRenderer } from '../map/renderers';
import { repaintOn } from '../ui/canvas';
import { detectLagano, markLagano } from '../ui/lagano';
import { THEME_STORAGE_KEY, type ThemePreference } from '../ui/theme';
import '../ui/tokens.css';
import '../ui/base.css';
import '../ui/signage.css';
import '../ui/qr.css';
import '../ui/kiosk.css';
import '../ui/city.css';
import '../ui/kiosk-city.css';

const { i18n, theme } = bootPage({ page: 'kiosk' });
const root = document.querySelector<HTMLElement>('#kiosk')!;
const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function safeLocalStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

// T5.3 (grant §1.2): dark after sunset, light by day -- a screen nobody has
// touched yet opens by the sun's own theme, never the OS guess auto would
// give it; the dashboard keeps auto (bootPage's own default, untouched here).
// ?tema=auto|svijetla|tamna|sunce always wins, once, over both the default
// and any preference already stored, so a screen nobody touches can still be
// set by hand from the URL that provisioned it.
const TEMA_WORD: Record<string, ThemePreference> = { auto: 'auto', svijetla: 'light', tamna: 'dark', sunce: 'solar' };
const temaParam = new URLSearchParams(location.search).get('tema');
const temaPreference = temaParam ? TEMA_WORD[temaParam] : undefined;
if (temaPreference) theme.setPreference(temaPreference);
else if (safeLocalStorage()?.getItem(THEME_STORAGE_KEY) == null) theme.setPreference('solar');

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

// The renderer override is independent of the device preference.
const mapOverride = parseKioskMapMode(location.search);
const mapMode = mapOverride ?? createMapModeStore({ storage: safeLocalStorage() }).snapshot();

mountKiosk(root, {
  i18n,
  hash: location.hash,
  theme,
  reducedMotion,
  lightweight,
  mapMode,
  onRepaint: repaintOn(theme),
  mapFactory: createMapRenderer,
});
// The secret is in localStorage now, and ?tema= only ever needed to land
// once: keep both out of the address bar and history, the same way as before.
// The renderer override must survive a reload without changing the preference.
if (location.hash || temaParam) {
  const kept = new URLSearchParams();
  if (mapOverride) kept.set('prikaz', mapOverride === 'schema' ? 'shema' : 'karta');
  const search = kept.toString();
  history.replaceState(null, '', `/kiosk/${search ? `?${search}` : ''}`);
}
