// The dossier of /snimka/: the four question chips of Ukratko, Brojke, Zaslon,
// Tijek, Zamjene, Što se vidjelo, Otvoreni podaci and I danas (plan section
// 4). Mounted once on the page (the entry passes document.body); it fills the
// slots the static HTML holds (data-sn="questions", data-sn-mount="brojke",
// "screen", "strip", "alternatives", "reckoning", "open", "live" and the
// five data-sn="kpi-*" tiles). Lane V5 owns this file; screen.ts is V4's,
// strip.ts V3's, both mounted here as in v1.
import { isScreenIndex, type ScreenIndex } from '../../../shared/snimka';
import { SnimkaError } from '../../../shared/snimka-codec';
import { mountAlternatives, showOnStage } from './alternatives';
import type { Mount, SnimkaContext } from './context';
import type { Subject } from './contracts';
import { mountLive } from './live';
import { mountOpen } from './open';
import { renderHero, renderReckoning, type ReckoningComparison } from './reckoning';
import { mountScreen } from './screen';
import { SN, fill } from './strings';
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

// ---- the four questions -----------------------------------------------------------------

export type QuestionId = 'q1' | 'q2' | 'q3' | 'q4';
export interface Question { id: QuestionId; chapter: string | null; subject: Subject | null; bikes: boolean; section: string }

/** The four entries of plan section 4: the chapter each opens, the subject and the layer it sets, the section that answers. */
export const QUESTIONS: readonly Question[] = [
  { id: 'q1', chapter: 'prvo-jutro', subject: null, bikes: true, section: 'zamjene' },
  { id: 'q2', chapter: 'trece-jutro', subject: { kind: 'route', id: '17' }, bikes: false, section: 'tijek' },
  { id: 'q3', chapter: 'stanje-usluge', subject: null, bikes: false, section: 'otvoreno' },
  { id: 'q4', chapter: null, subject: null, bikes: false, section: 'vidjelo' },
];

const SECTION_NAMES: Record<string, string> = { zamjene: SN.nav.alternatives, tijek: SN.nav.strip, otvoreno: SN.nav.open, vidjelo: SN.nav.reckoning };

/** What a chip does: pause; seek to its chapter; set its layer and subject; bring the instrument into view (q4 opens no
 *  chapter and goes to the section that answers it). Returns the chapter's instant (epoch seconds) or null. */
export function askQuestion(ctx: Pick<SnimkaContext, 'clock' | 'events' | 'layers' | 'view' | 'doc' | 'reducedMotion'>, q: Question): number | null {
  const chapter = q.chapter ? ctx.events.find((e) => e.id === q.chapter) ?? null : null;
  if (q.bikes) ctx.layers.set({ bikes: true });
  if (q.subject) ctx.view.set({ subject: q.subject }, 'user');
  if (q.chapter) {
    showOnStage(ctx, chapter ? chapter.atSec : null);
    return chapter ? chapter.atSec : null;
  }
  ctx.clock.pause();
  ctx.doc.getElementById(q.section)?.scrollIntoView?.({ block: 'start', behavior: ctx.reducedMotion ? 'auto' : 'smooth' });
  return null;
}

/** Turns the static chip links of Ukratko into buttons that act on the instrument, each with a link beside it to the
 *  section that answers (visually hidden until focused). Without JavaScript the links stay as they are. */
export function upgradeQuestions(ctx: SnimkaContext, root: ParentNode): () => void {
  const doc = ctx.doc;
  const nav = root.querySelector<HTMLElement>('[data-sn="questions"]');
  if (!nav) return () => {};
  const offs: (() => void)[] = [];
  for (const q of QUESTIONS) {
    const link = nav.querySelector<HTMLAnchorElement>(`a[data-sn-q="${q.id.slice(1)}"]`);
    if (!link) continue;
    const text = link.textContent?.trim() || SN.narration[q.id];
    const chapterTitle = q.chapter ? ctx.events.find((e) => e.id === q.chapter)?.title ?? null : null;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = link.className;
    for (const [k, v] of Object.entries(link.dataset)) if (v !== undefined) button.dataset[k] = v;
    button.textContent = text;
    const section = SECTION_NAMES[q.section] ?? q.section;
    const hints: HTMLElement[] = [];
    if (chapterTitle) {
      const hint = doc.createElement('span');
      hint.id = `sn-q-hint-${q.id}`;
      hint.className = 'visually-hidden';
      hint.textContent = fill(SN.questions.goes, { chapter: chapterTitle, section });
      button.setAttribute('aria-describedby', hint.id);
      hints.push(hint);
    }
    const onClick = (): void => { askQuestion(ctx, q); };
    button.addEventListener('click', onClick);
    const to = doc.createElement('a');
    to.className = 'sn-q-to';
    to.href = `#${q.section}`;
    to.dataset.snQTo = q.id;
    to.textContent = `${SN.questions.section} ${section}`;
    const item = doc.createElement('span');
    item.className = 'sn-q-item';
    item.append(button, ...hints, to);
    link.replaceWith(item);
    offs.push(() => button.removeEventListener('click', onClick));
  }
  nav.dataset.snQuestions = 'ready';
  return () => { for (const off of offs) off(); };
}

const decodeIndex = (raw: unknown): ScreenIndex => {
  if (!isScreenIndex(raw)) throw new SnimkaError('screen index: not a screen index');
  return raw;
};

export const mountReport: Mount = (ctx, root) => {
  const doc = ctx.doc;
  ensureTip(doc);
  const slot = (name: string): HTMLElement | null => root.querySelector<HTMLElement>(`[data-sn-mount="${name}"]`);
  const teardowns: (() => void)[] = [];
  teardowns.push(upgradeQuestions(ctx, root));

  // The Thursday is the normal day of the v1 cards; the Monday tile and the peak card read the weekday-matched days (S-12).
  const thursday = ctx.comparisons.find((c) => c.id === 'cet-0924') ?? ctx.comparisons[0] ?? null;
  const monday = ctx.comparisons.find((c) => c.weekday === 1) ?? null;
  const normals: ReckoningComparison[] = [...ctx.comparisons].sort((a, b) => a.fromSec - b.fromSec).map((c) => ({ id: c.id, fromSec: c.fromSec, series: c.series }));

  renderHero(doc, ctx.series, thursday?.series ?? null, monday ? { series: monday.series, fromSec: monday.fromSec } : null);
  slot('brojke')?.removeAttribute('aria-busy');

  const reckoningRoot = slot('reckoning');
  const reckoning = reckoningRoot ? renderReckoning(reckoningRoot, ctx.series, thursday?.series ?? null, { routes: ctx.routes, comparisons: normals }) : null;

  const stripRoot = slot('strip');
  if (stripRoot) teardowns.push(mountStrip(ctx, stripRoot));

  const screenRoot = slot('screen');
  if (screenRoot) teardowns.push(mountScreen(ctx, screenRoot, (index) => reckoning?.setIndex(index, index === null)));
  // The sentences card reads the index itself too (cached by path), so it does not depend on the screen's callback.
  let disposed = false;
  ctx.data.get(ctx.manifest.files.screenIndex, decodeIndex).then(
    (index) => { if (!disposed) reckoning?.setIndex(index, false); },
    () => { if (!disposed && !screenRoot) reckoning?.setIndex(null, true); },
  );

  for (const [name, mount] of [['alternatives', mountAlternatives], ['open', mountOpen]] as const) {
    const el = slot(name);
    if (el) teardowns.push(mount(ctx, el));
  }
  const liveRoot = slot('live');
  if (liveRoot) teardowns.push(mountLive(liveRoot));

  return () => {
    disposed = true;
    for (const off of teardowns.reverse()) off();
  };
};
