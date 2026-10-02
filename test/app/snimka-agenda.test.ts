// The Poglavlja panel (app/src/snimka/agenda.ts): the face reads the current
// chapter and the next; the depth lists every chapter as a button with its
// time and title, the narration and the readouts at its minute, the current
// one aria-current="step"; arrows, Home and End move, Enter opens.
import { Window } from 'happy-dom';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SNIMKA_WINDOW } from '../../shared/snimka';
import { agendaKey, agendaPanel, chapterIndexAt, chaptersOf } from '../../app/src/snimka/agenda';
import { createReplayClock } from '../../app/src/snimka/clock';
import { createViewStore, type SnimkaContext } from '../../app/src/snimka/context';
import type { FrameLoop } from '../../app/src/snimka/frames';
import { zagrebDateTime } from '../../app/src/snimka/format';
import { buildEvents, buildRoutes, buildWindowSeries, MARKS } from '../../e2e/snimka-fixtures';

const events = buildEvents().events;
const chapters = chaptersOf(events);
let page: Window | null = null;
beforeAll(() => { page = new Window({ url: 'http://localhost/snimka/' }); });
afterAll(async () => { await page?.happyDOM.close(); });

function setup(at: number) {
  const subs = new Set<(t: number) => void>();
  const frames: FrameLoop = { subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; }, kick() {}, destroy() {} };
  const clock = createReplayClock({ start: SNIMKA_WINDOW.fromSec * 1000, end: SNIMKA_WINDOW.toSec * 1000, at: at * 1000, playing: false, now: () => 0 });
  const ctx = {
    events, series: buildWindowSeries(), routes: buildRoutes(), clock, frames, view: createViewStore(), doc: page!.document as unknown as Document,
    manifest: { serviceLiveFromSec: MARKS.serviceLive, files: {} },
    data: { get: async () => { throw new Error('none'); }, url: String },
  } as unknown as SnimkaContext;
  const opened: string[] = [];
  const spec = agendaPanel(ctx, (id) => opened.push(id));
  const emit = (t: number): void => { for (const fn of [...subs]) fn(t); };
  return { ctx, spec, opened, emit, clock };
}

describe('the chapters', () => {
  it('in time order, only chapters; the current one is the latest at or before the instant', () => {
    expect(chapters.every((c) => c.chapter)).toBe(true);
    expect(chapters.map((c) => c.id)).not.toContain('feed-stoji-pon');
    expect(chapterIndexAt(chapters, MARKS.windowStart)).toBe(0);
    expect(chapters[chapterIndexAt(chapters, MARKS.monday0745 + 60)]!.id).toBe('prvo-jutro');
    expect(chapterIndexAt(chapters, MARKS.windowStart - 1)).toBe(-1);
  });
  it('the keys: arrows step and stop at the ends, Home and End jump, others are not taken', () => {
    expect(agendaKey('ArrowDown', 0, 5)).toBe(1);
    expect(agendaKey('ArrowRight', 4, 5)).toBe(4);
    expect(agendaKey('ArrowUp', 0, 5)).toBe(0);
    expect(agendaKey('ArrowLeft', 3, 5)).toBe(2);
    expect(agendaKey('Home', 3, 5)).toBe(0);
    expect(agendaKey('End', 1, 5)).toBe(4);
    expect(agendaKey('Enter', 1, 5)).toBeNull();
    expect(agendaKey('ArrowDown', 0, 0)).toBeNull();
  });
});

describe('agendaPanel', () => {
  it('the face: the current chapter and the next with its time', () => {
    const { spec } = setup(MARKS.monday0745);
    expect(spec.id).toBe('poglavlja');
    expect(spec.title).toBe('Poglavlja');
    const face = page!.document.createElement('span') as unknown as HTMLElement;
    const update = spec.mountFace(face);
    update(MARKS.monday0745 * 1000 + 60_000);
    expect(face.querySelector('.sn-agenda-face-label')!.textContent).toBe('Trenutno poglavlje');
    expect(face.querySelector('.sn-agenda-face-title')!.textContent).toBe('Prvo jutro');
    const next = chapters[chapters.findIndex((c) => c.id === 'prvo-jutro') + 1]!;
    expect(face.querySelector('.sn-agenda-face-next')!.textContent).toBe(`${zagrebDateTime(next.atSec * 1000)} · ${next.title}`);
    expect(face.querySelector('.sn-agenda-face-next')!.textContent).toMatch(/^[a-zč]{3} \d+\. \d+\. u \d\d:\d\d · /);
    // Only spans: the face lives in the shell's button.
    expect([...face.querySelectorAll('*')].every((n) => n.tagName === 'SPAN')).toBe(true);
    update(SNIMKA_WINDOW.toSec * 1000);
    expect(face.querySelector<HTMLElement>('.sn-agenda-face-next')!.hidden).toBe(true);
  });
  it('the depth: one button per chapter with time and title, narration and readouts; the current marked; Enter opens', async () => {
    const { spec, opened, emit, clock } = setup(MARKS.monday0745 + 60);
    const depth = page!.document.createElement('div') as unknown as HTMLElement;
    page!.document.body.append(depth as never);
    const teardown = await spec.mountDepth(depth);
    const buttons = [...depth.querySelectorAll<HTMLButtonElement>('.sn-agenda-step')];
    expect(buttons.length).toBe(chapters.length);
    expect(depth.querySelector('.sn-agenda-list')!.getAttribute('aria-label')).toBe('Popis poglavlja');
    expect(depth.querySelector('.sn-agenda-keys')!.textContent).toBe('Strelice biraju poglavlje, Enter ga otvara.');
    const current = depth.querySelectorAll('[aria-current="step"]');
    expect(current.length).toBe(1);
    expect((current[0] as HTMLElement).dataset.chapter).toBe('prvo-jutro');
    expect(current[0]!.getAttribute('tabindex')).toBe('0');
    expect(depth.querySelectorAll('.sn-agenda-step[tabindex="0"]').length).toBe(1);
    const spremista = depth.querySelector('.sn-agenda-item[data-chapter="spremista"]')!;
    expect(spremista.querySelector('.sn-agenda-text')!.textContent).toBe('Manje od dvadeset vozila u pokretu.');
    expect(spremista.querySelector('.sn-agenda-chips')!.textContent).toMatch(/u pokretu \d+/);
    expect(spremista.querySelector('.sn-agenda-step .sn-agenda-time')!.textContent).toBe('pon 28. 9. u 00:00');
    // Arrows move the focus and the tab stop; Enter (a button's click) opens.
    const i = buttons.findIndex((b) => b.dataset.chapter === 'prvo-jutro');
    buttons[i]!.focus();
    buttons[i]!.dispatchEvent(new page!.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }) as unknown as Event);
    expect(page!.document.activeElement).toBe(buttons[i + 1]);
    expect(buttons[i + 1]!.tabIndex).toBe(0);
    expect(buttons[i]!.tabIndex).toBe(-1);
    buttons[i + 1]!.dispatchEvent(new page!.KeyboardEvent('keydown', { key: 'End', bubbles: true }) as unknown as Event);
    expect(page!.document.activeElement).toBe(buttons.at(-1));
    buttons.at(-1)!.click();
    expect(opened).toEqual([chapters.at(-1)!.id]);
    // The clock moves on: the mark follows.
    clock.seek(MARKS.thursday0745 * 1000);
    emit(clock.now());
    expect((depth.querySelector('[aria-current="step"]') as HTMLElement).dataset.chapter).toBe('cetvrto-jutro');
    (teardown as () => void)();
    expect(depth.children.length).toBe(0);
  });
});
