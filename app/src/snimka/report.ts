// The report of /snimka/: the hero numbers (Ukratko), Zaslon, Tijek and Što
// se vidjelo. Mounted once on the page (the entry passes document.body); it
// fills the slots the static HTML holds (data-sn-mount="screen", "strip",
// "reckoning" and the four data-sn="kpi-*" tiles). The hero, the strip and
// the reckoning come from the series the entry already loaded; the screen
// loads its own index, runs and board, and hands the index on to the
// reckoning's screen card.
import type { Mount } from './context';
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

  renderHero(doc, ctx.series, ctx.comparison);

  const reckoningRoot = slot('reckoning');
  const reckoning = reckoningRoot ? renderReckoning(reckoningRoot, ctx.series, ctx.comparison) : null;

  const stripRoot = slot('strip');
  if (stripRoot) teardowns.push(mountStrip(ctx, stripRoot));

  const screenRoot = slot('screen');
  if (screenRoot) teardowns.push(mountScreen(ctx, screenRoot, (index) => reckoning?.setIndex(index, index === null)));
  else reckoning?.setIndex(null, true);

  return () => {
    for (const off of teardowns.reverse()) off();
  };
};
