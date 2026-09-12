// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { applyScale, DENSITY, prepareCanvas, repaintOn, tone } from '../../app/src/ui/canvas';

describe('prepareCanvas', () => {
  it('returns null under happy-dom without throwing (no layout box)', () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    expect(() => prepareCanvas(canvas)).not.toThrow();
    expect(prepareCanvas(canvas)).toBeNull();
  });

  it('sizes the backing store at density x the CSS box (happy-dom has no 2D context, so the result is still null)', () => {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ width: 100, height: 40 }) as DOMRect;
    const sized = prepareCanvas(canvas);
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(80);
    expect(sized).toBeNull();
  });

  it('honours a custom density and falls back to clientWidth/clientHeight when getBoundingClientRect is absent', () => {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getBoundingClientRect', { value: undefined });
    Object.defineProperty(canvas, 'clientWidth', { value: 50, configurable: true });
    Object.defineProperty(canvas, 'clientHeight', { value: 20, configurable: true });
    prepareCanvas(canvas, 3);
    expect(canvas.width).toBe(150);
    expect(canvas.height).toBe(60);
  });

  it('returns a SizedCanvas when a 2D context is available', () => {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ width: 10, height: 10 }) as DOMRect;
    canvas.getContext = (() => ({ fillRect: () => {} })) as unknown as HTMLCanvasElement['getContext'];
    const sized = prepareCanvas(canvas);
    expect(sized).toEqual({ ctx: expect.anything(), w: 20, h: 20 });
    expect(typeof sized!.ctx.fillRect).toBe('function');
  });

  it('returns null instead of throwing when getContext itself throws', () => {
    const canvas = document.createElement('canvas');
    canvas.getBoundingClientRect = () => ({ width: 10, height: 10 }) as DOMRect;
    canvas.getContext = (() => { throw new Error('no canvas support'); }) as unknown as HTMLCanvasElement['getContext'];
    expect(() => prepareCanvas(canvas)).not.toThrow();
    expect(prepareCanvas(canvas)).toBeNull();
  });

  it('DENSITY defaults to 2', () => {
    expect(DENSITY).toBe(2);
  });
});

describe('tone', () => {
  it('reads a custom property off computed style', () => {
    const el = document.createElement('div');
    el.style.setProperty('--tone-text-primary', '#f2ead8');
    document.body.appendChild(el);
    expect(tone(el, '--tone-text-primary', '#000')).toBe('#f2ead8');
  });

  it('falls back when the property is unset', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(tone(el, '--tone-nope', '#fallback')).toBe('#fallback');
  });

  it('falls back instead of throwing when getComputedStyle itself throws', () => {
    const el = { } as unknown as Element;
    expect(tone(el, '--x', '#fallback')).toBe('#fallback');
  });
});

function fakeTheme() {
  const listeners = new Set<() => void>();
  return {
    fire: () => listeners.forEach((l) => l()),
    onChange: vi.fn((listener: () => void) => {
      listeners.add(listener);
      listener(); // real theme.onChange fires once immediately: first paint
      return () => listeners.delete(listener);
    }),
  };
}

function fakeView() {
  const resize = new Set<() => void>();
  let raf: (() => void) | null = null;
  return {
    addEventListener: vi.fn((type: string, l: () => void) => { if (type === 'resize') resize.add(l); }),
    removeEventListener: vi.fn((type: string, l: () => void) => { if (type === 'resize') resize.delete(l); }),
    requestAnimationFrame: vi.fn((cb: () => void) => { raf = cb; return 1; }),
    triggerResize: () => resize.forEach((l) => l()),
    runFrame: () => { raf?.(); raf = null; },
  };
}

describe('repaintOn', () => {
  it('fires once on subscribe (theme.onChange fires immediately)', () => {
    const theme = fakeTheme();
    const view = fakeView();
    const listener = vi.fn();
    repaintOn(theme, view)(listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('fires once per resize after a frame, coalescing bursts into one frame', () => {
    const theme = fakeTheme();
    const view = fakeView();
    const listener = vi.fn();
    repaintOn(theme, view)(listener);
    listener.mockClear();
    view.triggerResize();
    view.triggerResize(); // still queued: only one rAF scheduled
    expect(listener).not.toHaveBeenCalled();
    view.runFrame();
    expect(listener).toHaveBeenCalledTimes(1);
    view.triggerResize();
    view.runFrame();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes both the theme listener and the resize listener', () => {
    const theme = fakeTheme();
    const view = fakeView();
    const listener = vi.fn();
    const off = repaintOn(theme, view)(listener);
    off();
    listener.mockClear();
    theme.fire();
    view.triggerResize();
    view.runFrame();
    expect(listener).not.toHaveBeenCalled();
  });

  it('defaults view to globalThis when omitted', () => {
    const theme = fakeTheme();
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 1);
    const listener = vi.fn();
    const off = repaintOn(theme)(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    raf.mockRestore();
  });
});

describe('applyScale', () => {
  it('writes --kiosk-scale as width / designWidth, rounded to 3 decimals', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ width: 720 }) as DOMRect;
    const scale = applyScale(el, 1080);
    expect(scale).toBeCloseTo(2 / 3);
    expect(el.style.getPropertyValue('--kiosk-scale')).toBe('0.667');
  });

  it('falls back to designWidth (scale 1) when there is no layout box', () => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'getBoundingClientRect', { value: undefined });
    Object.defineProperty(el, 'clientWidth', { value: 0, configurable: true });
    const scale = applyScale(el, 1080);
    expect(scale).toBe(1);
    expect(el.style.getPropertyValue('--kiosk-scale')).toBe('1');
  });
});
