// The dossier of /snimka/: Brojke, Zaslon, Tijek, Zamjene, Što se vidjelo,
// Otvoreni podaci and I danas (plan section 4). Mounted once on the page
// (the entry passes document.body); it fills the slots the static HTML
// holds (data-sn-mount="brojke", "screen", "strip", "alternatives",
// "reckoning", "open", "live" and the five data-sn="kpi-*" tiles). Lane V5
// owns this file; V0 wires the v1 parts to the v2 context and the V5 stubs.
import { mountAlternatives } from './alternatives';
import type { Mount } from './context';
import { mountLive } from './live';
import { mountOpen } from './open';
import { renderHero, renderReckoning } from './reckoning';
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

export const mountReport: Mount = (ctx, root) => {
  const doc = ctx.doc;
  ensureTip(doc);
  const slot = (name: string): HTMLElement | null => root.querySelector<HTMLElement>(`[data-sn-mount="${name}"]`);
  const teardowns: (() => void)[] = [];
  // The v1 hero and reckoning read one normal day: the Thursday (V5 moves the Monday tile to Mon 21 Sep).
  const comparison = ctx.comparisons.find((c) => c.id === 'cet-0924')?.series ?? ctx.comparisons[0]?.series ?? null;

  renderHero(doc, ctx.series, comparison);
  slot('brojke')?.removeAttribute('aria-busy');

  const reckoningRoot = slot('reckoning');
  const reckoning = reckoningRoot ? renderReckoning(reckoningRoot, ctx.series, comparison) : null;

  const stripRoot = slot('strip');
  if (stripRoot) teardowns.push(mountStrip(ctx, stripRoot));

  const screenRoot = slot('screen');
  if (screenRoot) teardowns.push(mountScreen(ctx, screenRoot, (index) => reckoning?.setIndex(index, index === null)));
  else reckoning?.setIndex(null, true);

  for (const [name, mount] of [['alternatives', mountAlternatives], ['open', mountOpen], ['live', mountLive]] as const) {
    const el = slot(name);
    if (el) teardowns.push(mount(ctx, el));
  }

  return () => {
    for (const off of teardowns.reverse()) off();
  };
};
