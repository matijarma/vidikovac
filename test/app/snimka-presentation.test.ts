// Presentation mode (app/src/snimka/presentation.ts): the idle watch hides
// the controls after three quiet seconds with an injected clock, never while
// the focus is inside the controls, and wakes on a pointer or a key; the
// mode marks the stage presenting (fullscreen where the browser has it, the
// pinned layout where it has not), F toggles, the button says which way it
// goes, and nothing idles under reduced motion.
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindPresentation, createIdleTimer, IDLE_MS, type Timers } from '../../app/src/snimka/presentation';

function fakeTimers(): Timers & { advance(ms: number): void } {
  let now = 0;
  let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimeout: (fn, ms) => { const id = next++; pending.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => { pending.delete(id as number); },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, p]) => p.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = until;
    },
  };
}

describe('createIdleTimer', () => {
  it('goes idle after three seconds and wakes on a poke', () => {
    const timers = fakeTimers();
    const onChange = vi.fn();
    const idle = createIdleTimer({ timers, onChange });
    expect(IDLE_MS).toBe(3000);
    idle.arm(true);
    timers.advance(2999);
    expect(idle.idle()).toBe(false);
    timers.advance(1);
    expect(idle.idle()).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(true);
    idle.poke();
    expect(idle.idle()).toBe(false);
    timers.advance(2000);
    idle.poke();
    timers.advance(2000);
    expect(idle.idle()).toBe(false);
    timers.advance(1000);
    expect(idle.idle()).toBe(true);
  });
  it('never idles while the guard holds (focus inside the controls), and disarming wakes', () => {
    const timers = fakeTimers();
    let focusInside = true;
    const idle = createIdleTimer({ timers, guard: () => focusInside, onChange: () => {} });
    idle.arm(true);
    timers.advance(10_000);
    expect(idle.idle()).toBe(false);
    focusInside = false;
    timers.advance(3000);
    expect(idle.idle()).toBe(true);
    idle.arm(false);
    expect(idle.idle()).toBe(false);
    timers.advance(10_000);
    expect(idle.idle()).toBe(false);
  });
});

describe('bindPresentation', () => {
  afterEach(() => { document.body.replaceChildren(); });
  function page() {
    const section = document.createElement('section');
    const stage = document.createElement('div');
    const controls = document.createElement('div');
    const button = document.createElement('button');
    const words = document.createElement('span');
    words.dataset.snPresentText = '';
    words.textContent = 'Cijeli zaslon';
    button.append(words);
    controls.append(button);
    stage.append(controls);
    section.append(stage);
    document.body.append(section);
    return { section, stage, controls, button, words };
  }
  it('without element fullscreen pins the stage, says the way out, and F and Escape leave', () => {
    const { section, stage, controls, button, words } = page();
    Object.defineProperty(section, 'requestFullscreen', { value: undefined, configurable: true });
    const timers = fakeTimers();
    const onChange = vi.fn();
    const off = bindPresentation(stage, button, { reducedMotion: false, timers, controls: () => [controls], onChange });
    button.click();
    expect(stage.dataset.snPresenting).toBe('pinned');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(words.textContent).toBe('Izađi iz cijelog zaslona');
    expect(onChange).toHaveBeenLastCalledWith(true);
    // Idle after three seconds, unless the focus sits in the controls.
    timers.advance(3000);
    expect(stage.hasAttribute('data-sn-idle')).toBe(true);
    stage.dispatchEvent(new Event('pointermove', { bubbles: true }));
    expect(stage.hasAttribute('data-sn-idle')).toBe(false);
    button.focus();
    timers.advance(9000);
    expect(stage.hasAttribute('data-sn-idle')).toBe(false);
    button.blur();
    stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(stage.dataset.snPresenting).toBeUndefined();
    expect(words.textContent).toBe('Cijeli zaslon');
    stage.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true }));
    expect(stage.dataset.snPresenting).toBe('pinned');
    stage.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true }));
    expect(stage.dataset.snPresenting).toBeUndefined();
    off();
  });
  it('asks the section for fullscreen and follows fullscreenchange; reduced motion never idles', () => {
    const { section, stage, button } = page();
    let fs: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { get: () => fs, configurable: true });
    const request = vi.fn(() => { fs = section; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); });
    Object.defineProperty(section, 'requestFullscreen', { value: request, configurable: true });
    Object.defineProperty(document, 'exitFullscreen', { value: () => { fs = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); }, configurable: true });
    const timers = fakeTimers();
    const off = bindPresentation(stage, button, { reducedMotion: true, timers });
    button.click();
    expect(request).toHaveBeenCalledTimes(1);
    expect(stage.dataset.snPresenting).toBe('fullscreen');
    timers.advance(10_000);
    expect(stage.hasAttribute('data-sn-idle')).toBe(false);
    button.click();
    expect(stage.dataset.snPresenting).toBeUndefined();
    off();
  });
});
