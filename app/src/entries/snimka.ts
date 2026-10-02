// /snimka/: the replay of the strike of 28 to 30 September 2026 and the
// normal days after it. The page's prose is static HTML; this entry loads
// the manifest and the first-paint set from /api/snimka/v2/ (the window
// series and routes, both comparison days, events, notices, news, places),
// builds the one replay clock, the one frame loop and the view store, and
// mounts the stage (app/src/snimka/stage.ts) and the dossier (report.ts) on
// the slots the HTML holds. State lives in the address (?t=, &brzina=,
// &usporedba=, &panel=, &linija=, &stanica=, &mreza=, &prati=), written by
// replaceState, so a link shows what its sender saw. The only live read of
// the page is the card "I danas" (app/src/snimka/live.ts, decision S-10);
// nothing here references the map library: the stage loads it on its own.
import {
  isEventsFile, isNewsFile, isNoticesFile, isPlacesFile, isRoutesFile, isSeriesFile, SNIMKA_COMPARISONS,
  type EventsFile, type NewsFile, type NoticesFile, type PlacesFile, type RoutesFile, type SeriesFile, type SnimkaManifest,
} from '../../../shared/snimka';
import { SnimkaError } from '../../../shared/snimka-codec';
import { detectLagano, markLagano } from '../ui/lagano';
import { createThemeController } from '../ui/theme';
import { readAddress, writeAddress } from '../snimka/address';
import { createReplayClock, DEFAULT_SPEED, type Chapter, type TickReason } from '../snimka/clock';
import { createLayerStore, createViewStore, type LoadedComparison, type SnimkaContext } from '../snimka/context';
import { createRefCache, loadManifest } from '../snimka/data';
import { parseZagrebLocal } from '../snimka/format';
import { createFrameLoop } from '../snimka/frames';
import { mountReport } from '../snimka/report';
import { mountStage } from '../snimka/stage';
import { SN, fill } from '../snimka/strings';
import '../ui/page.css';
import '../ui/print.css';

function safeLocalStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

// A WebGL context is the cheapest real probe for an old or weak GPU, which
// deviceMemory and prefers-reduced-data both miss on their own; the stage
// draws a map, so the probe matters here as it does on the wall.
function canWebgl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

const lightweight = detectLagano({
  search: location.search,
  storage: safeLocalStorage(),
  navigator: { deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory },
  matchMedia: (query) => globalThis.matchMedia(query),
  canWebgl,
});
markLagano(document.documentElement, lightweight);
const theme = createThemeController();
if (!lightweight) void import('../ui/fonts.css');

const reducedMotion = ((): boolean => {
  try { return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
})();
// The hero's instruction line: under reduced motion the replay does not start by itself (V3-19).
if (reducedMotion) { const howTo = document.querySelector('[data-sn="how-to"]'); if (howTo) howTo.textContent = SN.narration.howToReduced; }
const address = readAddress(location.search);
/** Without a time in the address the replay opens on the first morning (decisions S-4 and S-20). */
const OPENING_MS = parseZagrebLocal('2026-09-28T07:45')!;
/** The address follows a playing clock at most this often. */
const ADDRESS_EVERY_MS = 2000;
const USER_REASONS = new Set<TickReason>(['play', 'pause', 'seek', 'speed', 'end']);

const stageRoot = document.querySelector<HTMLElement>('[data-sn-mount="stage"]');
const attributionRoot = document.querySelector<HTMLElement>('[data-sn="attribution"]');

const guard = <T,>(ok: (raw: unknown) => raw is T, what: string) => (raw: unknown): T => {
  if (!ok(raw)) throw new SnimkaError(`${what}: not a ${what} file`);
  return raw;
};
const decodeSeries = guard<SeriesFile>(isSeriesFile, 'series');
const decodeRoutes = guard<RoutesFile>(isRoutesFile, 'routes');
const decodeEvents = guard<EventsFile>(isEventsFile, 'events');
const decodeNotices = guard<NoticesFile>(isNoticesFile, 'notices');
const decodeNews = guard<NewsFile>(isNewsFile, 'news');
const decodePlaces = guard<PlacesFile>(isPlacesFile, 'places');

function renderError(root: HTMLElement, retry: () => void): void {
  const card = document.createElement('p');
  card.className = 'state sn-error';
  card.dataset.kind = 'down';
  card.setAttribute('role', 'status');
  card.append(SN.error.load);
  const actions = document.createElement('span');
  actions.className = 'state-actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn-ghost sn-retry';
  button.textContent = SN.error.retry;
  button.addEventListener('click', retry);
  actions.append(button);
  card.append(actions);
  root.replaceChildren(card);
  root.removeAttribute('aria-busy');
}

function renderAttribution(root: HTMLElement, manifest: SnimkaManifest): void {
  const list = document.createElement('ul');
  list.className = 'sn-attribution';
  for (const a of manifest.attribution) {
    const li = document.createElement('li');
    li.dataset.source = a.id;
    if (a.url) {
      const link = document.createElement('a');
      link.href = a.url;
      link.rel = 'noopener noreferrer';
      link.textContent = a.text;
      li.append(link);
    } else li.append(a.text);
    li.append(` · ${a.licence}`);
    if (a.adaptation) {
      const adaptation = document.createElement('span');
      adaptation.className = 'sn-adaptation';
      adaptation.textContent = a.adaptation;
      li.append(' ', adaptation);
    }
    list.append(li);
  }
  root.replaceChildren(list);
  const notes = [...manifest.notes, ...manifest.comparisons.flatMap((c) => c.notes)];
  if (notes.length) {
    const h3 = document.createElement('h3');
    h3.className = 'sn-notes-title';
    h3.textContent = fill(SN.attribution.notes, { n: notes.length });
    const ul = document.createElement('ul');
    ul.className = 'sn-notes';
    for (const note of notes) {
      const li = document.createElement('li');
      li.textContent = note;
      ul.append(li);
    }
    root.append(h3, ul);
  }
  root.removeAttribute('aria-busy');
}

let teardown: (() => void) | null = null;

async function boot(): Promise<void> {
  if (!stageRoot) return;
  teardown?.();
  teardown = null;
  stageRoot.replaceChildren();
  stageRoot.setAttribute('aria-busy', 'true');

  let manifest: SnimkaManifest;
  let series: SeriesFile;
  let routes: RoutesFile;
  let comparisons: LoadedComparison[];
  let events: EventsFile;
  let notices: NoticesFile;
  let news: NewsFile;
  let places: PlacesFile;
  const data = createRefCache();
  try {
    manifest = await loadManifest();
    // The first-paint set, in parallel after the manifest.
    const loadedComparisons = Promise.all(manifest.comparisons.map(async (c) => {
      const constant = SNIMKA_COMPARISONS.find((k) => k.id === c.id)!;
      const [cs, cr] = await Promise.all([data.get(c.files.series, decodeSeries), data.get(c.files.routes, decodeRoutes)]);
      return { id: c.id, day: c.day, weekday: constant.weekday, fromSec: c.fromSec, series: cs, routes: cr } satisfies LoadedComparison;
    }));
    [series, routes, comparisons, events, notices, news, places] = await Promise.all([
      data.get(manifest.files.series, decodeSeries),
      data.get(manifest.files.routes, decodeRoutes),
      loadedComparisons,
      data.get(manifest.files.events, decodeEvents),
      data.get(manifest.files.notices, decodeNotices),
      data.get(manifest.files.news, decodeNews),
      data.get(manifest.files.places, decodePlaces),
    ]);
  } catch {
    renderError(stageRoot, () => void boot());
    return;
  }

  const chapters: Chapter[] = events.events.filter((e) => e.chapter).map((e) => ({ at: e.atSec * 1000, title: e.title, id: e.id }));
  const clock = createReplayClock({
    start: manifest.window.fromSec * 1000,
    end: manifest.window.toSec * 1000,
    at: address.t ?? OPENING_MS,
    speed: address.speed ?? DEFAULT_SPEED,
    playing: address.t === null && !reducedMotion,
    chapters,
  });
  const frames = createFrameLoop(clock, { reducedMotion });
  const layers = createLayerStore({ compare: address.compare, follow: address.following });
  const view = createViewStore({ panel: address.panel, subject: address.subject, following: address.following });
  const ctx: SnimkaContext = {
    manifest,
    series,
    routes,
    comparisons,
    events: events.events,
    notices,
    news,
    places,
    clock,
    frames,
    data,
    layers,
    view,
    lagano: lightweight,
    reducedMotion,
    theme: {
      resolved: () => theme.getResolvedTheme(),
      onChange: (fn) => theme.onChange((state) => fn(state.resolved)),
    },
    doc: document,
  };

  if (attributionRoot) renderAttribution(attributionRoot, manifest);
  const unmountStage = mountStage(ctx, stageRoot);
  const unmountReport = mountReport(ctx, document.body);

  // The address follows every user mutation at once and a playing clock every two seconds.
  const write = (): void => {
    const v = view.get();
    const l = layers.get();
    writeAddress({ t: clock.now(), speed: clock.speed(), compare: l.compare, panel: v.panel, subject: v.subject, following: v.following });
  };
  let lastWrite = 0;
  const offTick = clock.onTick((_, reason) => {
    if (USER_REASONS.has(reason)) { lastWrite = Date.now(); write(); }
  });
  const offLayers = layers.onChange((next, previous) => { if (next.compare !== previous.compare) write(); });
  const offView = view.onChange(() => { write(); });
  const offFrames = frames.subscribe(() => {
    if (!clock.playing()) return;
    const at = Date.now();
    if (at - lastWrite >= ADDRESS_EVERY_MS) { lastWrite = at; write(); }
  });
  // A hidden tab freezes the clock: the reader comes back to the minute they left.
  const onVisibility = (): void => { if (document.visibilityState === 'hidden') clock.suspend(); else clock.resume(); };
  document.addEventListener('visibilitychange', onVisibility);
  if (document.visibilityState === 'hidden') clock.suspend();

  teardown = (): void => {
    document.removeEventListener('visibilitychange', onVisibility);
    offFrames();
    offView();
    offLayers();
    offTick();
    unmountReport();
    unmountStage();
    frames.destroy();
    clock.destroy();
  };
}

// The section the reader is in, marked in the bar (and scrolled into view there on a phone), as on /statistika/.
const links = new Map<string, HTMLAnchorElement>();
for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-st="sections"] a[href^="#"]')) links.set(a.hash.slice(1), a);
if ('IntersectionObserver' in window) {
  const visible = new Map<string, number>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
      let best: string | null = null;
      let bestTop = Infinity;
      for (const id of links.keys()) {
        const el = document.getElementById(id);
        if (!el || !(visible.get(id) ?? 0)) continue;
        const top = Math.abs(el.getBoundingClientRect().top);
        if (top < bestTop) {
          bestTop = top;
          best = id;
        }
      }
      if (!best) return;
      for (const [id, a] of links) {
        if (id === best) {
          a.setAttribute('aria-current', 'location');
          const row = a.parentElement;
          if (row && row.scrollWidth > row.clientWidth) {
            const left = a.offsetLeft - row.offsetLeft;
            if (left < row.scrollLeft || left + a.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = left - 16;
          }
        } else a.removeAttribute('aria-current');
      }
    },
    { rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.01, 0.5] },
  );
  for (const id of links.keys()) {
    const el = document.getElementById(id);
    if (el) io.observe(el);
  }
}

void boot();
