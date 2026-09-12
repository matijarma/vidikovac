// Page entry for the landing page (app/index.html). No i18n and no theme
// controller here on purpose: the landing page ships with no language
// toggle, must read as a finished product before any script runs, and this
// entry only adds what the static markup cannot do on its own — the
// panorama's live vehicle count (design.md §3.1, the same figure the kiosk
// and /d headers carry) and the Worker health line the old health.ts used to
// own. R-L1: `lightweight` is decided once, here, exactly like every other
// entry; on that path this module never reaches the panorama's canvas at
// all (R-L2's "no canvas"), so nothing here fetches `/api/teaser` either —
// the canvas stays the plain box it already is and the legend keeps the
// words already baked into `app/index.html`. `paintPanoramaTeaser` and
// `paintHealth` take every dependency as an argument (fetch, the paint call,
// the clock) so test/app/landing.test.ts can drive both without a real
// <canvas> 2D context or a real network call.
import type { TeaserResponse } from '../api';
import { fetchTeaser } from '../api';
import { zagrebTime } from '../format';
import { vehicleCount } from '../layers/shared';
import { tone } from '../ui/canvas';
import { detectLagano, markLagano } from '../ui/lagano';
import { paintPanorama } from '../ui/panorama';

export interface PanoramaTeaserDeps {
  panorama: HTMLCanvasElement | null;
  legend: HTMLElement | null;
  fetchTeaser: () => Promise<TeaserResponse>;
  paint: (canvas: HTMLCanvasElement, o: { fg: string; count: number }) => void;
  fg: (canvas: HTMLCanvasElement) => string;
  time: () => string;
}

/** Paints the hero panorama with the live ZET vehicle count. A failed fetch
 *  (or a teaser with no usable zet-rt count) still paints an honest zero
 *  rather than a stale or fabricated number, but it never overwrites a
 *  legend it could not confirm — the loading text baked into the HTML
 *  already reads correctly on its own. */
export async function paintPanoramaTeaser(deps: PanoramaTeaserDeps): Promise<void> {
  const { panorama, legend, fetchTeaser: fetchTeaserImpl, paint, fg, time } = deps;
  if (!panorama) return;
  try {
    const { modules } = await fetchTeaserImpl();
    const count = vehicleCount(modules.find((m) => m.module === 'zet-rt'));
    if (count === null) {
      paint(panorama, { fg: fg(panorama), count: 0 });
      return;
    }
    const text = `SL. 1 — ZAGREBAČKA PANORAMA: MEDVEDNICA I GRAD · NA PRUZI JEDNA TOČKA = JEDNO VOZILO ZET-a · ${count} U POKRETU, ${time()}`;
    if (legend) legend.textContent = text;
    panorama.setAttribute('aria-label', text);
    paint(panorama, { fg: fg(panorama), count });
  } catch {
    paint(panorama, { fg: fg(panorama), count: 0 });
  }
}

export interface HealthPaintDeps {
  el: HTMLElement | null;
  fetchImpl: typeof fetch;
  now: () => number;
}

/** The status line in the footer: the Worker's own version and clock, moved
 *  here unchanged from the old health.ts. */
export async function paintHealth(deps: HealthPaintDeps): Promise<void> {
  const { el, fetchImpl, now } = deps;
  if (!el) return;
  try {
    const r = await fetchImpl('/api/health', { cache: 'no-store' });
    const j = (await r.json()) as { ok?: boolean; version?: string; time?: string };
    el.textContent = j.ok
      ? `worker ${j.version} · ${new Date(j.time ?? now()).toLocaleTimeString('hr-HR')}`
      : 'greška';
  } catch {
    el.textContent = 'nedostupno';
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

// A WebGL context is the cheapest real probe for "old/weak GPU or driver",
// which deviceMemory and prefers-reduced-data both miss on their own (R-L1),
// exactly the same probe entries/kiosk.ts uses.
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
// R-F3: the three Modrotisak faces are the modern path's typography and
// never reach the lightweight graph -- Croatian text pulls latin and latin-ext
// of every face, more than the whole 200 kB promise (§1.10) on their own. A
// dynamic import makes Vite emit fonts.css as its own chunk, loaded here only
// when the entry has decided against the light path; the lightweight screen
// keeps the system stack tokens.css already names, the same honest degrade as
// the canvas-free panorama (R-L2).
if (!lightweight) void import('../ui/fonts.css');

if (!lightweight) {
  const panorama = document.querySelector<HTMLCanvasElement>('[data-testid=panorama]');
  const legend = document.querySelector<HTMLElement>('[data-testid=panorama-legend]');
  void paintPanoramaTeaser({
    panorama,
    legend,
    fetchTeaser,
    paint: paintPanorama,
    // This page never imports tokens.css (no theme toggle, no data-theme):
    // its own inline stylesheet already flips `--fg` with the plain
    // `prefers-color-scheme` query, so that is the ink colour to read here,
    // not the shared `--tone-text-primary` the rest of the app uses.
    fg: (canvas) => tone(canvas, '--fg', '#f2ead8'),
    time: () => zagrebTime(Date.now()),
  });
}

void paintHealth({ el: document.getElementById('health'), fetchImpl: fetch, now: () => Date.now() });
