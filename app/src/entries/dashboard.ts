// Page entry for /d/. With the theme module in <head> these are the page's
// only two scripts, both external. Reads the fragment /s/ navigated to, opens
// the room socket, mounts the dashboard on the real core stores, and wires
// the exports (clipboard, share sheet, calendar, GeoJSON, print) with the
// source line travelling in every one of them.
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import { fetchData } from '../api';
import { bootPage } from '../boot';
import { createMapModeStore } from '../core/map-mode-store';
import { mountDashboard, parseSessionHash, type DashboardHandle } from '../dashboard';
import { canExportCalendarItem, copyWithAttribution, geojsonFile, icsFile, icsForItem, itemExportText, printAct, shareLink } from '../export';
import { fillAttribution } from '../attribution';
import { wordmarkMarkup } from '../experience/chrome';
import { createMapRenderer } from '../map/renderers';
import { createSessionClient } from '../session';
import { repaintOn } from '../ui/canvas';
import { downloadFile } from '../ui/dom/download';
import { escapeHtml } from '../ui/dom/escape';
import { detectLagano, markLagano } from '../ui/lagano';
import '../ui/tokens.css';
import '../ui/base.css';
import '../ui/signage.css';
import '../ui/toast.css';
import '../ui/panel.css';
import '../ui/layers.css';
import '../ui/overview.css';
import '../ui/city.css';
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
// Shared with the dashboard so even an in-tab choice without writable storage
// can suppress a still-pending idle prefetch.
const mapMode = createMapModeStore({ storage: safeLocalStorage() });
// The one Manrope family never reaches the lightweight graph: a dynamic import
// makes Vite emit fonts.css as its own chunk, loaded only on the modern path.
if (!lightweight) void import('../ui/fonts.css');

if (!params) {
  // Reached with no room in the fragment (a bookmark, a stray share): the
  // composed page of the plan's "Entry", in the shell's own roles. The
  // wordmark with its one brand gesture, the title at display size, one
  // sentence, the primary way in and the open safety page; the same two
  // actions the landing leads with, from the same catalogue keys. It is the
  // page's one main landmark, and the target the skip link in d/index.html
  // names, so the no-room state is as reachable as a running session.
  const empty = document.createElement('main');
  empty.className = 'ki-empty';
  empty.id = 'ki-main';
  empty.tabIndex = -1;
  empty.innerHTML = `${wordmarkMarkup(i18n)}
<h1 class="ki-empty-title">${escapeHtml(i18n.t('shell.emptyTitle'))}</h1>
<p class="ki-empty-lead">${escapeHtml(i18n.t('shell.emptyLead'))}</p>
<div class="ki-empty-actions">
<a class="btn btn-primary" href="/s/">${escapeHtml(i18n.t('landing.actions.scan'))}</a>
<a class="btn-ghost" href="/hitno">${escapeHtml(i18n.t('landing.actions.safety'))}</a>
</div>`;
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
    mapFactory: createMapRenderer,
    mapMode,
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
  // Warm Promet's geographic renderer only while that is the device's choice;
  // this guard avoids an unnecessary transit prefetch, not every page's map load.
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  const prefetch = () => { if (mapMode.snapshot() === 'map') void import('../map/maplibre-entry'); };
  if (!lightweight && mapMode.snapshot() === 'map') {
    if (idle) idle(prefetch, { timeout: 4000 }); else setTimeout(prefetch, 2500);
  }
  session.connect();
}
