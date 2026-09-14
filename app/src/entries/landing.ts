// Page entry for the landing page (app/index.html). The static markup reads
// as a finished product on its own; this adds what it cannot do: the boot
// every surface shares (locale, theme, sprite, the language toggle in the
// header's slot, one translatePage pass), the live strip from the open teaser
// (weather now, the safety state, ZET vehicles moving) and the footer's source
// line. Every dependency is injected so test/app/landing.test.ts drives it
// without a network.
import type { TeaserResponse } from '../api';
import { fetchTeaser } from '../api';
import { bootPage } from '../boot';
import { zagrebTime } from '../format';
import { vehicleCount } from '../layers/shared';
import { conditionText } from '../experience/text';
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { detectLagano, markLagano } from '../ui/lagano';
// app/index.html links tokens.css, base.css and landing.css itself; the entry
// carries the signage sheet, which loads after them and gives the live strip
// the same badges, rows and bands as every other surface.
import '../ui/signage.css';

export interface StripLine { text: string; state: 'live' | 'unknown' | 'urgent' }
export interface StripTexts { weather: StripLine; safety: StripLine; transit: StripLine }

const UNKNOWN: StripLine = { text: 'trenutačno nedostupno', state: 'unknown' };

function usable(snapshot: ModuleSnapshot | undefined): snapshot is ModuleSnapshot {
  return Boolean(snapshot) && snapshot!.status !== 'down';
}

const hr = (n: number, digits = 1): string => n.toLocaleString('hr-HR', { maximumFractionDigits: digits });

/** Words for the strip from the teaser's modules; a missing source is unknown, never zero or all-clear. */
export function liveStripTexts(modules: readonly ModuleSnapshot[], now: number): StripTexts {
  const by = (id: ModuleSnapshot['module']): ModuleSnapshot | undefined => modules.find((m) => m.module === id);
  const obs = by('dhmz-now');
  const o = obs?.items[0];
  const temp = typeof o?.data?.temp === 'number' ? o.data.temp : null;
  const condition = typeof o?.data?.weather === 'string' ? conditionText(o.data.weather) : '';
  const weather: StripLine = usable(obs) && o && temp !== null
    ? { text: `${hr(temp)} °C${condition ? `, ${condition}` : ''}${o.at ? ` · izmjereno ${zagrebTime(o.at)}` : ''}`, state: 'live' }
    : UNKNOWN;
  const cap = by('dhmz-cap');
  const roads = by('prometnice');
  let safety: StripLine = UNKNOWN;
  if (usable(cap)) {
    const active = cap.items.filter((w) => (!w.at || Date.parse(w.at) <= now) && (!w.until || Date.parse(w.until) >= now));
    if (active.length) safety = { text: `${active.length} ${active.length === 1 ? 'upozorenje' : active.length < 5 ? 'upozorenja' : 'upozorenja'} DHMZ-a na snazi`, state: 'urgent' };
    else if (cap.status === 'live' || cap.items.length > 0) {
      const closures = usable(roads) ? roads.items.filter((c) => c.kind === 'closure').length : null;
      safety = { text: `Nema upozorenja DHMZ-a${closures === null ? '' : closures === 0 ? ', nema zatvorenih prometnica' : `, ${closures} ${closures === 1 ? 'zatvorena prometnica' : closures < 5 ? 'zatvorene prometnice' : 'zatvorenih prometnica'}`}`, state: 'live' };
    }
  }
  const zet = by('zet-rt');
  const count = usable(zet) ? vehicleCount(zet) : null;
  const transit: StripLine = count !== null
    ? { text: `${count} ${count === 1 ? 'vozilo' : 'vozila'} u pokretu${zet?.sourceUpdatedAt ? ` · ${zagrebTime(zet.sourceUpdatedAt)}` : ''}`, state: 'live' }
    : UNKNOWN;
  return { weather, safety, transit };
}

export interface LiveStripDeps {
  root: ParentNode | null;
  fetchTeaser: () => Promise<TeaserResponse>;
  now: () => number;
}

export async function paintLiveStrip(deps: LiveStripDeps): Promise<void> {
  if (!deps.root) return;
  let texts: StripTexts;
  try { texts = liveStripTexts((await deps.fetchTeaser()).modules, deps.now()); }
  catch { texts = { weather: UNKNOWN, safety: UNKNOWN, transit: UNKNOWN }; }
  for (const key of ['weather', 'safety', 'transit'] as const) {
    const el = deps.root.querySelector<HTMLElement>(`[data-live=${key}]`);
    if (!el) continue;
    el.textContent = texts[key].text;
    el.dataset.state = texts[key].state;
  }
}

export interface HealthPaintDeps {
  el: HTMLElement | null;
  fetchImpl: typeof fetch;
  now: () => number;
  /** The teaser the strip painted from: a source marked down denies the all-clear. */
  sources: () => Promise<readonly ModuleSnapshot[]>;
}

/** The footer's source line: "Izvori u redu · 14:42" from the Worker's clock,
 *  said only when the Worker answers and no source in the teaser is down;
 *  otherwise the count of sources not answering, or that the sources are
 *  unavailable when the teaser itself failed. Never an all-clear by default. */
export async function paintHealth(deps: HealthPaintDeps): Promise<void> {
  const { el, fetchImpl, now, sources } = deps;
  if (!el) return;
  let health: { ok?: boolean; time?: string };
  try {
    const r = await fetchImpl('/api/health', { cache: 'no-store' });
    health = (await r.json()) as { ok?: boolean; time?: string };
  } catch {
    el.textContent = 'Poslužitelj nije dostupan';
    return;
  }
  if (!health.ok) { el.textContent = 'Poslužitelj javlja grešku'; return; }
  const time = zagrebTime(health.time ?? now());
  let down: number | null;
  try { down = (await sources()).filter((m) => m.status === 'down').length; }
  catch { down = null; }
  const state = down === null ? 'Izvori trenutačno nedostupni'
    : down === 0 ? 'Izvori u redu'
    : `${down} ${down === 1 ? 'izvor ne odgovara' : down < 5 ? 'izvora ne odgovaraju' : 'izvora ne odgovara'}`;
  el.textContent = `${state} · ${time}`;
}

function safeLocalStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

function canWebgl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl'));
  } catch { return false; }
}

if (typeof document !== 'undefined' && document.querySelector('[data-testid=live-strip]')) {
  const lightweight = detectLagano({
    search: location.search,
    storage: safeLocalStorage(),
    navigator: { deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory },
    matchMedia: (query) => globalThis.matchMedia(query),
    canWebgl,
  });
  markLagano(document.documentElement, lightweight);
  // The Croatian in the HTML is the catalogue's own (test/app/landing.test.ts
  // holds the two together), so the first translatePage pass changes nothing a
  // Croatian reader sees; the toggle it mounts in the header's slot turns every
  // data-i18n node English. The strip's and the footer's sentences are painted
  // below in Croatian, as the teaser's words are.
  bootPage({ page: 'landing' });
  // The one Manrope family stays off the lightweight graph (R-F3).
  if (!lightweight) void import('../ui/fonts.css');
  // One teaser fetch feeds both the strip and the footer's verdict on the sources.
  const teaser = fetchTeaser();
  void paintLiveStrip({ root: document, fetchTeaser: () => teaser, now: () => Date.now() });
  void paintHealth({ el: document.getElementById('health'), fetchImpl: fetch, now: () => Date.now(), sources: () => teaser.then((t) => t.modules) });
}
