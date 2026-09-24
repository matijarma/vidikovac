// /statistika/: the public report. The page's prose is static HTML; this
// entry fetches /api/statistika for the chosen window and draws the numbers
// into the slots. State lives in the address (?dani=, ?opseg=, the section
// hash), so a link shows exactly what its sender saw. ?ugradeno=1 is the
// framed view /prijava/ opens in a dialog: no page chrome, and every link
// that would leave the page opens a new tab instead of navigating the frame.
import { STATISTIKA_WINDOWS, statistikaWindow, type PublicStats, type StatistikaWindow } from '../../../shared/statistika';
import { detectLagano, markLagano } from '../ui/lagano';
import { createThemeController } from '../ui/theme';
import { defaultScope, renderAll, renderError, renderScope, renderUsage, renderValues, type ScopeName } from '../statistika/render';
import '../ui/page.css';
import '../ui/print.css';
import '../ui/statistika.css';

function safeLocalStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

const lightweight = detectLagano({
  search: location.search,
  storage: safeLocalStorage(),
  navigator: { deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory },
  matchMedia: (query) => globalThis.matchMedia(query),
  // No map library here: the only drawing is HTML and a small SVG, so no GPU probe.
  canWebgl: () => true,
});
markLagano(document.documentElement, lightweight);
createThemeController();
if (!lightweight) void import('../ui/fonts.css');

const params = new URLSearchParams(location.search);
const embedded = params.get('ugradeno') === '1';
if (embedded) {
  document.documentElement.dataset.embed = '1';
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (href.startsWith('#') || href.startsWith('?')) continue;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
}

const SCOPE_PARAM: Record<ScopeName, string> = { venue: 'lokacije', evaluation: 'privremeni' };
const scopeFromParam = (raw: string | null): ScopeName | null => (raw === 'lokacije' ? 'venue' : raw === 'privremeni' ? 'evaluation' : null);

let days: StatistikaWindow = statistikaWindow(params.get('dani'));
let scope: ScopeName | null = scopeFromParam(params.get('opseg'));
let current: PublicStats | null = null;
const cache = new Map<StatistikaWindow, Promise<PublicStats>>();

function writeAddress(): void {
  const q = new URLSearchParams(location.search);
  q.set('dani', String(days));
  if (scope) q.set('opseg', SCOPE_PARAM[scope]);
  history.replaceState(null, '', `${location.pathname}?${q.toString()}${location.hash}`);
}

function markRange(): void {
  const pick = document.querySelector<HTMLSelectElement>('[data-st="range-select"]');
  if (pick) pick.value = String(days);
  for (const a of document.querySelectorAll<HTMLAnchorElement>('[data-st="range"] [data-days]')) {
    const on = Number(a.dataset.days) === days;
    if (on) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
    const q = new URLSearchParams(location.search);
    q.set('dani', a.dataset.days ?? '30');
    a.href = `?${q.toString()}`;
  }
}

function load(window: StatistikaWindow): Promise<PublicStats> {
  let p = cache.get(window);
  if (!p) {
    p = fetch(`/api/statistika?dani=${window}`, { headers: { accept: 'application/json' } }).then(async (res) => {
      if (!res.ok) throw new Error(`statistika ${res.status}`);
      return (await res.json()) as PublicStats;
    });
    p.catch(() => cache.delete(window));
    cache.set(window, p);
  }
  return p;
}

function onScope(next: ScopeName): void {
  scope = next;
  writeAddress();
  if (!current) return;
  renderScope(current, next, onScope);
  renderUsage(current, next);
  renderValues(current, next);
  document.querySelector<HTMLButtonElement>(`[data-scope="${next}"]`)?.focus();
}

async function show(): Promise<void> {
  document.body.dataset.loading = '1';
  markRange();
  try {
    const stats = await load(days);
    const first = current === null;
    current = stats;
    renderAll(stats, scope ?? defaultScope(stats), onScope);
    // A link to a chart (#graf-cetvrti) names an element the numbers just drew.
    if (first && location.hash.length > 1) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  } catch {
    renderError(() => void show());
  } finally {
    delete document.body.dataset.loading;
  }
}

function choose(next: number): void {
  if (!(STATISTIKA_WINDOWS as readonly number[]).includes(next) || next === days) return;
  days = next as StatistikaWindow;
  writeAddress();
  void show();
}

document.querySelector('[data-st="range"]')?.addEventListener('click', (e) => {
  const a = (e.target as Element).closest<HTMLAnchorElement>('[data-days]');
  if (!a) return;
  e.preventDefault();
  choose(Number(a.dataset.days));
});
document.querySelector<HTMLSelectElement>('[data-st="range-select"]')?.addEventListener('change', (e) => choose(Number((e.target as HTMLSelectElement).value)));

// The section the reader is in, marked in the bar (and scrolled into view there on a phone).
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
          // Only the chip row moves, never the page: keep the marked chip inside it.
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

void show();
