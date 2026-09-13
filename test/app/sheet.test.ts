// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSheet, type Detent } from '../../app/src/transport/sheet';

// The phone stage is 740 px tall at 390×844 (844 minus the 48 px header and the
// 56 px tab bar): peek 5rem = 80, half 370, open 740 - 2.5rem = 700.
const STAGE = 740;

interface MountOptions { stageHeight?: number; reducedMotion?: boolean; onChange?: (d: Detent, h: number) => void; now?: () => number }

function mount(o: MountOptions = {}) {
  const root = document.createElement('div');
  root.className = 'transport';
  const stage = document.createElement('div');
  stage.className = 'transport-body';
  let height = o.stageHeight ?? STAGE;
  Object.defineProperty(stage, 'clientHeight', { get: () => height, configurable: true });
  const sheet = document.createElement('aside');
  const head = document.createElement('div');
  const body = document.createElement('div');
  let scrollTop = 0;
  Object.defineProperty(body, 'scrollTop', { get: () => scrollTop, set: (v: number) => { scrollTop = v; }, configurable: true });
  sheet.append(head, body);
  stage.appendChild(sheet);
  root.appendChild(stage);
  document.body.appendChild(root);
  const controller = createSheet({ root, sheet, head, body, stage: () => stage, onChange: o.onChange, reducedMotion: o.reducedMotion, now: o.now });
  return { root, stage, sheet, head, body, controller, resize: (h: number) => { height = h; } };
}

const pointer = (el: Element, type: string, clientY: number): void => {
  el.dispatchEvent(new PointerEvent(type, { clientY, clientX: 120, pointerId: 7, bubbles: true, cancelable: true }));
};
/** A drag as a finger makes it: down, a few moves with the clock advancing, up. */
function drag(el: Element, from: number, to: number, clock: { t: number }, stepMs: number, steps = 4): void {
  pointer(el, 'pointerdown', from);
  for (let i = 1; i <= steps; i += 1) {
    clock.t += stepMs;
    pointer(el, 'pointermove', from + ((to - from) * i) / steps);
  }
  clock.t += stepMs;
  pointer(el, 'pointerup', to);
}
const sheetH = (root: HTMLElement): number => Number.parseFloat(root.style.getPropertyValue('--sheet-h'));

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('detent heights from the stage', () => {
  it('peek is 5rem, half is half the stage, open leaves 2.5rem of map; the controller starts at half and writes both custom properties', () => {
    const changes: [Detent, number][] = [];
    const { root, controller } = mount({ onChange: (d, h) => changes.push([d, h]) });
    expect(controller.heightFor('peek')).toBe(80);
    expect(controller.heightFor('half')).toBe(370);
    expect(controller.heightFor('open')).toBe(700);
    expect(controller.detent()).toBe('half');
    expect(root.dataset.sheet).toBe('half');
    expect(root.style.getPropertyValue('--sheet-h')).toBe('370px');
    expect(root.style.getPropertyValue('--sheet-open-h')).toBe('700px');
    expect(changes).toEqual([['half', 370]]);
  });

  it('set() writes data-sheet and --sheet-h and reports the change; the body says whether it is scrolled to its top', () => {
    const changes: [Detent, number][] = [];
    const { root, body, controller } = mount({ onChange: (d, h) => changes.push([d, h]) });
    controller.set('open');
    expect(root.dataset.sheet).toBe('open');
    expect(root.style.getPropertyValue('--sheet-h')).toBe('700px');
    expect(changes.at(-1)).toEqual(['open', 700]);
    controller.set('peek');
    expect(root.dataset.sheet).toBe('peek');
    expect(sheetH(root)).toBe(80);
    expect(body.dataset.atTop).toBe('true');
    body.scrollTop = 40;
    body.dispatchEvent(new Event('scroll'));
    expect(body.dataset.atTop).toBe('false');
  });

  it('cycle() runs peek → half → open → peek; down() steps one detent towards peek and stops there', () => {
    const { controller } = mount();
    controller.set('peek');
    controller.cycle();
    expect(controller.detent()).toBe('half');
    controller.cycle();
    expect(controller.detent()).toBe('open');
    controller.cycle();
    expect(controller.detent()).toBe('peek');
    controller.set('open');
    controller.down();
    expect(controller.detent()).toBe('half');
    controller.down();
    expect(controller.detent()).toBe('peek');
    controller.down();
    expect(controller.detent()).toBe('peek');
  });

  it('a stage that changes height (a banner in flow) keeps the named detent and recomputes its height without a transition', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const changes: [Detent, number][] = [];
    const { root, controller, resize } = mount({ onChange: (d, h) => changes.push([d, h]) });
    resize(640);
    window.dispatchEvent(new Event('resize'));
    expect(controller.detent()).toBe('half');
    expect(sheetH(root)).toBe(320);
    expect(root.style.getPropertyValue('--sheet-open-h')).toBe('600px');
    expect(changes.at(-1)).toEqual(['half', 320]);
    expect(root.dataset.dragging).toBeUndefined();
  });

  it('reduced motion marks the root so the stylesheet drops the transition', () => {
    expect(mount({ reducedMotion: true }).root.dataset.sheetMotion).toBe('none');
    expect(mount().root.dataset.sheetMotion).toBeUndefined();
  });
});

describe('pointer drags', () => {
  it('a drag on the head from half upward by 200 px ends open, with no transition while the finger is down', () => {
    const clock = { t: 0 };
    const { root, head, controller } = mount({ now: () => clock.t });
    pointer(head, 'pointerdown', 500);
    clock.t += 50;
    pointer(head, 'pointermove', 400);
    expect(root.dataset.dragging).toBe('true');
    expect(sheetH(root)).toBe(470);
    clock.t += 50;
    pointer(head, 'pointermove', 300);
    expect(sheetH(root)).toBe(570);
    clock.t += 50;
    pointer(head, 'pointerup', 300);
    expect(root.dataset.dragging).toBeUndefined();
    expect(controller.detent()).toBe('open');
    expect(sheetH(root)).toBe(700);
  });

  it('a slow release snaps to the nearest detent; a flick above 0.3 px/ms goes one detent further in its direction', () => {
    const clock = { t: 0 };
    const { head, controller } = mount({ now: () => clock.t });
    // 100 px down over 400 ms (0.25 px/ms): 270 px is nearer half (370) than peek (80).
    drag(head, 400, 500, clock, 100);
    expect(controller.detent()).toBe('half');
    // The same 100 px in 40 ms (2.5 px/ms): a flick downward, so the next detent down.
    drag(head, 400, 500, clock, 10);
    expect(controller.detent()).toBe('peek');
    // From peek, a 60 px flick upward lands on half, not open: one detent per flick.
    drag(head, 600, 540, clock, 10);
    expect(controller.detent()).toBe('half');
  });

  it('a body drag moves the sheet only from the top of its scroll and only downward; a scrolled body or an upward first move is left to the browser', () => {
    const clock = { t: 0 };
    const { root, body, controller } = mount({ now: () => clock.t });
    body.scrollTop = 40;
    drag(body, 300, 500, clock, 100);
    expect(controller.detent()).toBe('half');
    expect(root.dataset.dragging).toBeUndefined();
    body.scrollTop = 0;
    body.dispatchEvent(new Event('scroll'));
    drag(body, 500, 300, clock, 100); // upward: the list scrolls, the sheet stays
    expect(controller.detent()).toBe('half');
    drag(body, 300, 500, clock, 100); // downward at the top, slowly: 170 px is nearer peek
    expect(controller.detent()).toBe('peek');
  });

  it('a tap on the head starts no drag, and the click after a real drag is swallowed so a row under the lifted finger never opens', () => {
    const clock = { t: 0 };
    const { root, head, body, controller } = mount({ now: () => clock.t });
    const clicks = vi.fn();
    root.addEventListener('click', clicks);
    pointer(head, 'pointerdown', 500);
    clock.t += 30;
    pointer(head, 'pointerup', 502);
    head.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(controller.detent()).toBe('half');
    expect(clicks).toHaveBeenCalledTimes(1);
    drag(head, 500, 200, clock, 20);
    expect(controller.detent()).toBe('open');
    body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(clicks).toHaveBeenCalledTimes(1);
    clock.t += 1000;
    body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(clicks).toHaveBeenCalledTimes(2);
  });

  it('destroy() removes every listener and its custom properties', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const clock = { t: 0 };
    const changes = vi.fn();
    const { root, head, body, controller, resize } = mount({ now: () => clock.t, onChange: changes });
    controller.destroy();
    changes.mockClear();
    drag(head, 500, 200, clock, 20);
    resize(600);
    window.dispatchEvent(new Event('resize'));
    body.scrollTop = 10;
    body.dispatchEvent(new Event('scroll'));
    expect(changes).not.toHaveBeenCalled();
    expect(root.style.getPropertyValue('--sheet-h')).toBe('');
    expect(root.style.getPropertyValue('--sheet-open-h')).toBe('');
    expect(root.dataset.dragging).toBeUndefined();
    expect(body.dataset.atTop).toBeUndefined();
  });
});
