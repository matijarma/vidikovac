// Page entry for /d/. With the theme module in <head> these are the page's
// only two scripts, both external. Reads the fragment /s/ navigated to, opens
// the room socket, mounts the dashboard on the real core stores, and wires
// the exports (clipboard, share sheet, calendar, GeoJSON, print) with the
// source line travelling in every one of them.
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import { fetchData } from '../api';
import { bootPage } from '../boot';
import { mountDashboard, parseSessionHash, type DashboardHandle } from '../dashboard';
import { canExportCalendarItem, copyWithAttribution, geojsonFile, icsFile, icsForItem, itemExportText, printAct, shareLink } from '../export';
import { fillAttribution } from '../attribution';
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

// Collapsed on screen, complete on paper: native printing (including Ctrl+P)
// must retain attribution and licence text, not only the disclosure heading.
let printDetails: HTMLDetailsElement[] = [];
window.addEventListener('beforeprint', () => {
  printDetails = [...document.querySelectorAll<HTMLDetailsElement>('details.provenance:not([open])')];
  for (const details of printDetails) details.open = true;
});
window.addEventListener('afterprint', () => {
  for (const details of printDetails) details.open = false;
  printDetails = [];
});

function safeLocalStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

// A WebGL context is the cheapest real probe for an old or weak GPU, which
// deviceMemory and prefers-reduced-data both miss on their own.
function canWebgl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl'));
  } catch { return false; }
}

// Decided once, here, and passed down as a dependency exactly like reducedMotion.
const lightweight = detectLagano({
  search: location.search,
  storage: safeLocalStorage(),
  navigator: { deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory },
  matchMedia: (query) => globalThis.matchMedia(query),
  canWebgl,
});
markLagano(document.documentElement, lightweight);
// The one Manrope family never reaches the lightweight graph: a dynamic import
// makes Vite emit fonts.css as its own chunk, loaded only on the modern path.
if (!lightweight) void import('../ui/fonts.css');

if (!params) {
  // Reached with no room in the fragment (a bookmark, a stray share): a
  // composed empty state with the two real ways in and the open safety page.
  // The page's one main landmark, and the target the skip link in d/index.html
  // names, so the no-room state is as reachable as a running session.
  const empty = document.createElement('main');
  empty.className = 'ki-empty';
  empty.id = 'ki-main';
  empty.tabIndex = -1;
  const wordmark = document.createElement('a');
  wordmark.className = 'ki-wordmark';
  wordmark.href = '/';
  wordmark.setAttribute('aria-label', i18n.t('shell.wordmarkLabel'));
  const wordmarkText = document.createElement('span');
  wordmarkText.className = 'ki-wordmark-text';
  wordmarkText.textContent = i18n.t('common.appName');
  wordmark.appendChild(wordmarkText);
  const heading = document.createElement('h1');
  heading.className = 'ki-empty-title';
  heading.textContent = i18n.t('session.noRoom');
  heading.setAttribute('role', 'alert');
  const hint = document.createElement('p');
  hint.className = 'meta';
  hint.textContent = i18n.t('shell.footerNote');
  const actions = document.createElement('div');
  actions.className = 'actions';
  for (const [href, key, cls] of [['/s/', 'common.links.scan', 'btn btn-primary'], ['/kiosk/', 'common.links.kiosk', 'btn-ghost'], ['/hitno', 'common.links.hitno', 'btn-quiet']] as const) {
    const link = document.createElement('a');
    link.className = cls;
    link.href = href;
    link.textContent = i18n.t(key);
    actions.appendChild(link);
  }
  empty.appendChild(wordmark);
  empty.appendChild(heading);
  empty.appendChild(hint);
  empty.appendChild(actions);
  root.appendChild(empty);
} else {
  const session = createSessionClient({ roomId: params.roomId, ticket: params.ticket });
  const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const snapshots = new Map<string, ModuleSnapshot>();
  const toast = (key: string, variant: 'info' | 'success' | 'danger' = 'success'): void => {
    toasts.push({ message: i18n.t(key), variant, dismissLabel: i18n.t('common.dismiss') });
  };
  const filled = (snapshot: ModuleSnapshot, item?: FeedItem) => ({ ...snapshot.attribution, text: fillAttribution(snapshot.attribution, snapshot, item ?? snapshot.items[0]) });

  // The ticket is single-use and the label is the screen's: drop only those
  // from the address bar, so a reload resumes and a shared link keeps its
  // layer and public selection.
  const kept = new URLSearchParams(location.hash.replace(/^#/, ''));
  kept.delete('ticket');
  kept.delete('label');
  kept.set('room', params.roomId);
  history.replaceState(null, '', `${location.pathname}${location.search}#${kept.toString()}`);
  // Export metrics carry `<layer>/<kind>`, the room's own dimension.
  let dash: DashboardHandle | null = null;
  const exportDim = (kind: string): string => `${dash?.activeLayer() ?? 'grad-sada'}/${kind}`;

  dash = mountDashboard(root, {
    i18n,
    session,
    theme,
    label: params.label,
    reducedMotion,
    lightweight,
    onRepaint: repaintOn(theme),
    mapFactory: createCityMap,
    location,
    history,
    matchMedia: (query) => globalThis.matchMedia(query),
    fetchData: async (module, token) => {
      const snapshot = await fetchData(module, token);
      snapshots.set(module, snapshot);
      return snapshot;
    },
    onCopy: (text, attribution) => {
      void copyWithAttribution(text, attribution).then((ok) => {
        toast(ok ? 'export.copied' : 'export.copyFailed', ok ? 'success' : 'danger');
        session.event('export', exportDim('copy'));
      });
    },
    onShare: (url, title) => {
      void shareLink(url, title).then((outcome) => {
        toast(outcome === 'shared' ? 'export.shared' : outcome === 'copied' ? 'export.shareCopied' : 'export.shareFailed', outcome === 'failed' ? 'danger' : 'success');
        session.event('export', exportDim('share'));
      });
    },
    onItemCopy: (item, snapshot) => {
      void copyWithAttribution(itemExportText(item), filled(snapshot, item)).then((ok) => {
        toast(ok ? 'export.copied' : 'export.copyFailed', ok ? 'success' : 'danger');
        session.event('export', exportDim('copy'));
      });
    },
    onItemShare: (item, snapshot) => {
      if (!item.link) return;
      void shareLink(item.link, item.title).then((outcome) => {
        toast(outcome === 'shared' ? 'export.shared' : outcome === 'copied' ? 'export.shareCopied' : 'export.shareFailed', outcome === 'failed' ? 'danger' : 'success');
        session.event('export', exportDim('share'));
      });
      void snapshot;
    },
    onItemExport: (kind, item, snapshot) => {
      if (kind === 'print') { printAct(); session.event('export', exportDim('print')); return; }
      if (kind === 'ics') {
        const ics = canExportCalendarItem(item) ? icsForItem(item, filled(snapshot, item), { snapshot }) : null;
        if (!ics) { toast('events.noCalendar', 'info'); return; }
        void downloadFile(new File([ics], 'kaj-ima.ics', { type: 'text/calendar;charset=utf-8' })).then(() => toast('export.downloaded'));
        session.event('export', exportDim('ics'));
        return;
      }
      void downloadFile(geojsonFile(snapshot)).then(() => toast('export.downloaded'));
      session.event('export', exportDim('geojson'));
    },
    onExport: (kind, module) => {
      if (kind === 'print') { printAct(); session.event('export', exportDim('print')); return; }
      const snapshot = snapshots.get(module);
      if (!snapshot) { toast('export.nothingToExport', 'info'); return; }
      void downloadFile(kind === 'ics' ? icsFile(snapshot.items, snapshot.attribution, snapshot) : geojsonFile(snapshot)).then(() => toast('export.downloaded'));
      session.event('export', exportDim(kind));
    },
  });
  // Sada links to Promet, and Promet's map is real MapLibre the moment it opens
  // (map-slots.ts still creates it lazily): on a modern phone, the library and
  // its worker are worth fetching into the cache while the device is idle, so
  // the tab switch itself never pays for the download. Never on the lightweight
  // path (R-L2), which must not reach for this chunk at all (test/app/budget.test.ts).
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  const prefetch = () => { void import('../map/maplibre-entry'); };
  if (!lightweight) {
    if (idle) idle(prefetch, { timeout: 4000 }); else setTimeout(prefetch, 2500);
  }
  session.connect();
}
