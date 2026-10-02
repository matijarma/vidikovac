// The dossier of /snimka/ (plan v3): Što snimka pokazuje (the three tiles,
// the cards and the block "Čime se moglo umjesto tramvaja"), the band "I
// danas", Zaslon, Tijek and Podaci i izvori, in page order. Mounted once on
// the page (the entry passes document.body); it fills the slots the static
// HTML holds (data-sn-mount="brojke", "reckoning", "alternatives", "live",
// "screen", "strip", "open"). Lane W4b owns this file; reckoning.ts,
// alternatives.ts and strip.ts are W4a's, mounted here unchanged. The hero
// has no question chips in v3 (V3-19): seekAndShow is the one helper every
// "Pokaži u snimci" uses.
import { isScreenIndex, type ScreenIndex } from '../../../shared/snimka';
import { SnimkaError } from '../../../shared/snimka-codec';
import { mountAlternatives } from './alternatives';
import type { Layers, Mount, SnimkaContext } from './context';
import type { Subject } from './contracts';
import { mountLive } from './live';
import { mountOpen } from './open';
import { renderHero, renderReckoning, type ReckoningComparison } from './reckoning';
import { mountScreen } from './screen';
import { mountStrip } from './strip';
// The .line badge of the miniature's rows, as every other page that draws one loads it.
import '../ui/signage.css';

/** The charts' shared floating tip (statistika's showTip reads [data-st="tip"]); the page's HTML has none of its own. */
function ensureTip(doc: Document): void {
  if (doc.querySelector('[data-st="tip"]')) return;
  const tip = doc.createElement('div');
  tip.className = 'st-tip';
  tip.dataset.st = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  doc.body.append(tip);
}

// ---- the one seek helper ---------------------------------------------------------------

export interface SeekOptions {
  /** The subject to set (as the user), or null to clear it; left out, the subject stays. */
  subject?: Subject | null;
  /** Layers to switch, for instance { bikes: true }. */
  layers?: Partial<Layers>;
}

/** What every "Pokaži u snimci" of the dossier does (the tiles, the alternatives' rows): pause, seek to the instant
 *  (epoch seconds; null keeps the clock where it is), set the subject and the layers, and bring the instrument into
 *  view. The stage carries `scroll-margin-top`, so scrollIntoView lands it under the sticky bar, not behind it. */
export function seekAndShow(ctx: Pick<SnimkaContext, 'clock' | 'doc' | 'layers' | 'view' | 'reducedMotion'>, atSec: number | null, opts: SeekOptions = {}): void {
  ctx.clock.pause();
  if (atSec !== null) ctx.clock.seek(atSec * 1000);
  if (opts.layers) ctx.layers.set(opts.layers);
  if (opts.subject !== undefined) ctx.view.set({ subject: opts.subject }, 'user');
  const stage = ctx.doc.querySelector<HTMLElement>('[data-sn-stage]') ?? ctx.doc.getElementById('snimka');
  stage?.scrollIntoView?.({ block: 'start', behavior: ctx.reducedMotion ? 'auto' : 'smooth' });
}

/** The dossier's mounts in page order: Što snimka pokazuje (tiles, cards, alternatives), I danas, Zaslon, Tijek,
 *  Podaci i izvori. mountReport fills them in this order. */
export const REPORT_MOUNTS = ['brojke', 'reckoning', 'alternatives', 'live', 'screen', 'strip', 'open'] as const;

const decodeIndex = (raw: unknown): ScreenIndex => {
  if (!isScreenIndex(raw)) throw new SnimkaError('screen index: not a screen index');
  return raw;
};

export const mountReport: Mount = (ctx, root) => {
  const doc = ctx.doc;
  ensureTip(doc);
  const slot = (name: (typeof REPORT_MOUNTS)[number]): HTMLElement | null => root.querySelector<HTMLElement>(`[data-sn-mount="${name}"]`);
  const teardowns: (() => void)[] = [];

  // ---- Što snimka pokazuje -------------------------------------------------------------
  // The Thursday is the normal day of the v1 cards; the Monday tile and the peak card read the weekday-matched days (S-12).
  const thursday = ctx.comparisons.find((c) => c.id === 'cet-0924') ?? ctx.comparisons[0] ?? null;
  const monday = ctx.comparisons.find((c) => c.weekday === 1) ?? null;
  const normals: ReckoningComparison[] = [...ctx.comparisons].sort((a, b) => a.fromSec - b.fromSec).map((c) => ({ id: c.id, fromSec: c.fromSec, series: c.series }));

  renderHero(doc, ctx.series, thursday?.series ?? null, monday ? { series: monday.series, fromSec: monday.fromSec } : null);
  slot('brojke')?.removeAttribute('aria-busy');

  const reckoningRoot = slot('reckoning');
  const reckoning = reckoningRoot ? renderReckoning(reckoningRoot, ctx.series, thursday?.series ?? null, { routes: ctx.routes, comparisons: normals }) : null;

  const alternativesRoot = slot('alternatives');
  if (alternativesRoot) teardowns.push(mountAlternatives(ctx, alternativesRoot));

  // ---- I danas, right after Što snimka pokazuje ------------------------------------------
  const liveRoot = slot('live');
  if (liveRoot) teardowns.push(mountLive(liveRoot, ctx));

  // ---- Zaslon ---------------------------------------------------------------------------
  const screenRoot = slot('screen');
  if (screenRoot) teardowns.push(mountScreen(ctx, screenRoot, (index) => reckoning?.setIndex(index, index === null)));
  // The sentences card reads the index itself too (cached by path), so it does not depend on the screen's callback.
  let disposed = false;
  ctx.data.get(ctx.manifest.files.screenIndex, decodeIndex).then(
    (index) => { if (!disposed) reckoning?.setIndex(index, false); },
    () => { if (!disposed && !screenRoot) reckoning?.setIndex(null, true); },
  );

  // ---- Tijek, Podaci i izvori -----------------------------------------------------------
  const stripRoot = slot('strip');
  if (stripRoot) teardowns.push(mountStrip(ctx, stripRoot));
  const openRoot = slot('open');
  if (openRoot) teardowns.push(mountOpen(ctx, openRoot));

  return () => {
    disposed = true;
    for (const off of teardowns.reverse()) off();
  };
};
