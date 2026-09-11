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
import { downloadFile } from '../ui/dom/download';
import '../ui/tokens.css';
import '../ui/base.css';
import '../ui/fonts.css';
import '../ui/toast.css';
import '../ui/panel.css';
import '../ui/layers.css';
import '../ui/dashboard.css';
import '../ui/print.css';

const { i18n, toasts } = bootPage({ page: 'dashboard' });
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
      void downloadFile(kind === 'ics' ? icsFile(snapshot.items, snapshot.attribution) : geojsonFile(snapshot));
      session.event('export', kind);
    },
  });
  session.connect();
  // The ticket is single-use; drop it from the address bar so a reload resumes.
  history.replaceState(null, '', `/d/#room=${encodeURIComponent(params.roomId)}`);
}
