// Page entry for /kiosk/. R-16: with the theme module in <head> these are the
// page's only two scripts, both external. R-37: an entry imports the three
// shared stylesheets plus the component stylesheets its page actually uses.
// Reads the one-time provisioning fragment (or the stored credentials), mounts
// the kiosk, and strips the secret from the address bar so a reload never
// re-provisions from history.
import { bootPage } from '../boot';
import { mountKiosk } from '../kiosk';
import { createCityMap } from '../map/city-map';
import '../ui/tokens.css';
import '../ui/base.css';
import '../ui/fonts.css';
import '../ui/panel.css';
import '../ui/layers.css';
import '../ui/qr.css';
import '../ui/kiosk.css';

const { i18n } = bootPage({ page: 'kiosk' });
const root = document.querySelector<HTMLElement>('#kiosk')!;
const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

mountKiosk(root, { i18n, hash: location.hash, reducedMotion, mapFactory: createCityMap });
// The secret is in localStorage now; keep it out of the address bar and history.
if (location.hash) history.replaceState(null, '', '/kiosk/');
