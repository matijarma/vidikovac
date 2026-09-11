// Page entry for /d/. R-16: with the theme module in <head> these are the
// page's only two scripts, both external. R-37: an entry imports the three
// shared stylesheets plus the component stylesheets its page actually uses.
// Reads the fragment C4 navigated to, opens the room socket, mounts the
// dashboard — the same bootPage(...) shape as every other surface.
import { fetchData } from '../api';
import { bootPage } from '../boot';
import { mountDashboard, parseSessionHash } from '../dashboard';
import { createCityMap } from '../map/city-map';
import { createSessionClient } from '../session';
import '../ui/tokens.css';
import '../ui/base.css';
import '../ui/fonts.css';
import '../ui/toast.css';
import '../ui/panel.css';
import '../ui/layers.css';
import '../ui/dashboard.css';

const { i18n } = bootPage({ page: 'dashboard' });
const root = document.querySelector<HTMLElement>('#dash')!;
const params = parseSessionHash(location.hash);

if (!params) {
  const p = document.createElement('p');
  p.className = 'dash-alert';
  p.setAttribute('role', 'alert');
  p.textContent = i18n.t('session.noRoom');
  root.appendChild(p);
} else {
  const session = createSessionClient({ roomId: params.roomId, ticket: params.ticket });
  const wide = globalThis.matchMedia?.('(min-width: 60rem)').matches ?? false;
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  mountDashboard(root, {
    i18n,
    session,
    label: params.label,
    wide,
    reducedMotion,
    mapFactory: createCityMap,
    fetchData: (module, token) => fetchData(module, token),
  });
  session.connect();
  // The ticket is single-use; drop it from the address bar so a reload resumes.
  history.replaceState(null, '', `/d/#room=${encodeURIComponent(params.roomId)}`);
}
