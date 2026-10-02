// The Poglavlja panel (plan sections 3.2 and 3.4). The face reads the current
// chapter and the next one; the depth is the agenda: an ordered list of the
// chapters, each a button with its time and title, under it the narration and
// the readouts at the chapter's minute. The current chapter carries
// aria-current="step"; the arrow keys, Home and End move between the
// chapters (one tab stop for the whole list), Enter or a click opens one
// through `open(id)`, which the shell implements (pause, seek, subject,
// scroll the instrument into view) and the hero's question chips reuse.
import type { SnimkaEvent } from '../../../shared/snimka';
import type { AgendaPanel } from './contracts';
import type { SnimkaContext } from './context';
import { chipsLabel, factChips } from './facts';
import { formatZagrebLocal, zagrebDateTime } from './format';
import { SN } from './strings';

/** The chapters of the recording in time order. */
export function chaptersOf(events: readonly SnimkaEvent[]): SnimkaEvent[] {
  return events.filter((e) => e.chapter).sort((a, b) => a.atSec - b.atSec);
}

/** The index of the latest chapter at or before the instant (seconds), or -1. */
export function chapterIndexAt(chapters: readonly Pick<SnimkaEvent, 'atSec'>[], atSec: number): number {
  let found = -1;
  for (let i = 0; i < chapters.length; i++) if (chapters[i]!.atSec <= atSec) found = i;
  return found;
}

/** Which chapter button a key moves to from `i` among `n`, or null for a key the list does not take. */
export function agendaKey(key: string, i: number, n: number): number | null {
  if (n <= 0) return null;
  if (key === 'ArrowDown' || key === 'ArrowRight') return Math.min(n - 1, i + 1);
  if (key === 'ArrowUp' || key === 'ArrowLeft') return Math.max(0, i - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return null;
}

export const agendaPanel: AgendaPanel = (ctx: SnimkaContext, open) => {
  const chapters = chaptersOf(ctx.events);
  const doc = (): Document => ctx.doc ?? document;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
    const node = doc().createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const A = SN.agenda;

  return {
    id: 'poglavlja',
    title: SN.panel.agenda,
    mountFace(face) {
      // Spans only: the shell's face is a button.
      const label = el('span', 'sn-agenda-face-label', A.current);
      const title = el('span', 'sn-agenda-face-title');
      const next = el('span', 'sn-agenda-face-next');
      face.append(label, title, next);
      let shown = -2;
      return (t) => {
        const i = chapterIndexAt(chapters, Math.floor(t / 1000));
        if (i === shown) return;
        shown = i;
        title.textContent = i >= 0 ? chapters[i]!.title : '';
        const after = chapters[i + 1];
        next.textContent = after ? `${zagrebDateTime(after.atSec * 1000)} · ${after.title}` : '';
        next.hidden = !after;
      };
    },
    mountDepth(depth) {
      const keysId = `sn-agenda-keys-${Math.floor(ctx.clock.start / 1000)}`;
      const lede = el('p', 'sn-agenda-lede', A.lede);
      const keys = el('p', 'sn-agenda-keys', A.keys);
      keys.id = keysId;
      const list = el('ol', 'sn-agenda-list');
      list.setAttribute('aria-label', SN.timeline.chapterList);
      const buttons: HTMLButtonElement[] = chapters.map((chapter) => {
        const li = el('li', 'sn-agenda-item');
        li.dataset.chapter = chapter.id;
        const button = el('button', 'sn-agenda-step');
        button.type = 'button';
        button.dataset.chapter = chapter.id;
        button.setAttribute('aria-describedby', keysId);
        const time = el('time', 'sn-agenda-time', zagrebDateTime(chapter.atSec * 1000));
        time.dateTime = `${formatZagrebLocal(chapter.atSec * 1000)}+02:00`;
        button.append(time, ' ', el('span', 'sn-agenda-title', chapter.title));
        button.addEventListener('click', () => open(chapter.id));
        li.append(button);
        if (chapter.text) li.append(el('p', 'sn-agenda-text', chapter.text));
        const values = factChips(chapter.facts, ctx, chapter.atSec);
        if (values.length) {
          const chips = el('p', 'sn-agenda-chips');
          chips.setAttribute('aria-label', chipsLabel());
          for (const c of values) {
            const chip = el('span', 'sn-fact-chip', c.text);
            if (c.missing) chip.dataset.missing = 'true';
            if (c.retro) {
              chip.dataset.retro = 'true';
              chip.append(' ', el('span', 'sn-fact-retro', SN.badge.retroShort));
            }
            chips.append(chip, ' ');
          }
          li.append(chips);
        }
        list.append(li);
        return button;
      });
      list.addEventListener('keydown', (e) => {
        const i = buttons.indexOf(e.target as HTMLButtonElement);
        if (i < 0) return;
        const to = agendaKey(e.key, i, buttons.length);
        if (to === null) return;
        e.preventDefault();
        roving(to);
        buttons[to]!.focus();
      });
      depth.append(lede, keys, list);

      let tabStop = -1;
      const roving = (i: number): void => {
        if (i === tabStop) return;
        buttons.forEach((b, k) => { b.tabIndex = k === i ? 0 : -1; });
        tabStop = i;
      };
      let current = -2;
      const mark = (t: number): void => {
        const i = chapterIndexAt(chapters, Math.floor(t / 1000));
        if (i === current) return;
        if (current >= 0) buttons[current]?.removeAttribute('aria-current');
        if (i >= 0) buttons[i]!.setAttribute('aria-current', 'step');
        current = i;
        // The tab stop follows the clock unless the reader is moving through the list.
        if (!list.contains(doc().activeElement)) roving(Math.max(0, i));
      };
      mark(ctx.clock.now());
      const off = ctx.frames.subscribe(mark);
      return () => { off(); depth.replaceChildren(); };
    },
  };
};
