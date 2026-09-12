// Page entry for /d/. R-16: with the theme module in <head> these are the
// page's only two scripts, both external. R-37: an entry imports the three
// shared stylesheets plus the component stylesheets its page actually uses.
// Reads the fragment C4 navigated to, opens the room socket, mounts the
// dashboard — the same bootPage(...) shape as every other surface.
import type { ModuleId, ModuleSnapshot } from '../../../worker/feed/schema';
import { fetchData } from '../api';
import { bootPage } from '../boot';
import { mountDashboard, parseSessionHash } from '../dashboard';
import { copyWithAttribution, geojsonFile, icsFile, printAct, shareLink } from '../export';
import { createCityMap } from '../map/city-map';
import { createSessionClient } from '../session';
import { repaintOn } from '../ui/canvas';
import { downloadFile } from '../ui/dom/download';
import { detectLagano, markLagano } from '../ui/lagano';
import '../ui/tokens.css';
import '../ui/base.css';
import '../ui/toast.css';
import '../ui/panel.css';
import '../ui/layers.css';
import '../ui/dashboard.css';
import '../ui/dialog.css';
import '../ui/qr.css';
import '../ui/print.css';
import '../motion/schematic.css';
import '../ui/map.css';

const { i18n, theme, toasts } = bootPage({ page: 'dashboard' });
const root = document.querySelector<HTMLElement>('#dash')!;
const params = parseSessionHash(location.hash);

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
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
// reducedMotion below — mountDashboard never reads navigator/matchMedia itself.
const lightweight = detectLagano({
  search: location.search,
  storage: safeLocalStorage(),
  navigator: { deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory },
  matchMedia: (query) => globalThis.matchMedia(query),
  canWebgl,
});
markLagano(document.documentElement, lightweight);
// R-F3: the three Modrotisak faces are the modern path's typography and
// never reach the lightweight graph -- Croatian text pulls latin and latin-ext
// of every face, more than the whole 200 kB promise (§1.10) on their own. A
// dynamic import makes Vite emit fonts.css as its own chunk, loaded here only
// when the entry has decided against the light path; the lightweight screen
// keeps the system stack tokens.css already names, the same honest degrade as
// the canvas-free panorama (R-L2).
if (!lightweight) void import('../ui/fonts.css');

if (!params) {
  // Reached with no room in the fragment (a bookmark, a stray share): the
  // dashboard proper never mounts, so this terminal state needs its own h1
  // (R-M1's axe sweep expects exactly one per page, including this one).
  const heading = document.createElement('h1');
  heading.className = 'visually-hidden';
  heading.textContent = i18n.t('common.appName');
  const p = document.createElement('p');
  p.className = 'dash-alert';
  p.setAttribute('role', 'alert');
  p.textContent = i18n.t('session.noRoom');
  root.append(heading, p);
} else {
  const session = createSessionClient({ roomId: params.roomId, ticket: params.ticket });
  const wide = globalThis.matchMedia?.('(min-width: 60rem)').matches ?? false;
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const snapshots = new Map<ModuleId, ModuleSnapshot>();

  const toast = (key: string, variant: 'info' | 'success' | 'danger' = 'success'): void => {
    toasts.push({ message: i18n.t(key), variant, dismissLabel: i18n.t('common.dismiss') });
  };

  mountDashboard(root, {
    i18n,
    session,
    label: params.label,
    wide,
    reducedMotion,
    lightweight,
    onRepaint: repaintOn(theme),
    mapFactory: createCityMap,
    fetchData: async (module, token) => {
      const snapshot = await fetchData(module, token);
      snapshots.set(module, snapshot);
      return snapshot;
    },
    onCopy: (text, attribution) => {
      void copyWithAttribution(text, attribution).then((ok) => {
        toast(ok ? 'export.copied' : 'export.copyFailed', ok ? 'success' : 'danger');
        session.event('export', 'copy');
      });
    },
    onShare: (url, title) => {
      void shareLink(url, title).then((outcome) => {
        toast(
          outcome === 'shared' ? 'export.shared' : outcome === 'copied' ? 'export.shareCopied' : 'export.shareFailed',
          outcome === 'failed' ? 'danger' : 'success',
        );
        session.event('export', 'share');
      });
    },
    onExport: (kind, module) => {
      if (kind === 'print') {
        printAct();
        session.event('export', 'print');
        return;
      }
      const snapshot = snapshots.get(module);
      if (!snapshot) {
        toast('status.loading', 'info');
        return;
      }
      void downloadFile(
        kind === 'ics' ? icsFile(snapshot.items, snapshot.attribution, snapshot) : geojsonFile(snapshot),
      );
      session.event('export', kind);
    },
  });
  session.connect();
  // The ticket is single-use; drop it from the address bar so a reload resumes.
  history.replaceState(null, '', `/d/#room=${encodeURIComponent(params.roomId)}`);
}
