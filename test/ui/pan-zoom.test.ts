// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { createPanZoom } from '../../app/src/ui/pan-zoom';

it('anchors pinch/wheel/tap zoom, captures clamped drags, preserves selection keys and tears down without inertia', () => {
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({ left: 20, top: 30, width: 400, height: 300 }) as DOMRect;
  const capture = vi.fn();
  const release = vi.fn();
  canvas.setPointerCapture = capture;
  canvas.releasePointerCapture = release;
  canvas.style.touchAction = 'pan-y';
  document.body.appendChild(canvas);
  const changes = vi.fn();
  const userMoves = vi.fn();
  const taps = vi.fn();
  let now = 0;
  const pan = createPanZoom(canvas, {
    box: [200, 100], width: 400, height: 300, padding: { top: 20, bottom: 80, left: 20, right: 20 },
    document, now: () => now, reducedMotion: true, onChange: changes, onUserMove: userMoves, onTap: taps,
  });
  const pointer = (type: string, id: number, x: number, y: number, target: EventTarget = canvas): void => {
    target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x + 20, clientY: y + 30, button: 0, bubbles: true, cancelable: true }));
  };
  const key = (value: string, shiftKey = false, target: EventTarget = canvas, ctrlKey = false): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key: value, shiftKey, ctrlKey, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  };
  const tap = (id: number, x = 200, y = 120): void => {
    pointer('pointerdown', id, x, y);
    now += 30;
    pointer('pointerup', id, x, y);
  };
  const anchored = (world: { x: number; y: number }, screen: { x: number; y: number }): void => {
    expect(pan.toScreen(world).x).toBeCloseTo(screen.x);
    expect(pan.toScreen(world).y).toBeCloseTo(screen.y);
  };
  try {
    expect(canvas.style.touchAction).toBe('none');
    expect(pan.snapshot()).toEqual({ x: 20, y: 30, scale: 1.8, fit: 1.8, width: 400, height: 300 });
    const midpoint = { x: 200, y: 120 };
    const centre = pan.toWorld(midpoint);
    pointer('pointerdown', 1, 150, 120);
    pointer('pointerdown', 2, 250, 120);
    expect(capture).toHaveBeenCalledWith(1);
    expect(capture).toHaveBeenCalledWith(2);
    pointer('pointermove', 1, 100, 140, document.body);
    pointer('pointermove', 2, 300, 140, document.body);
    expect(pan.snapshot().scale).toBeCloseTo(3.6);
    anchored(centre, { x: 200, y: 140 }); // pinch midpoint translates too
    pointer('pointerup', 2, 300, 140, document.body);
    const beforeDrag = pan.snapshot();
    pointer('pointermove', 1, 120, 150, document.body);
    expect(pan.snapshot().x).toBeCloseTo(beforeDrag.x + 20);
    expect(pan.snapshot().y).toBeCloseTo(beforeDrag.y + 10);
    pointer('pointerup', 1, 120, 150, document.body);
    expect(release).toHaveBeenCalledWith(1);
    expect(taps).not.toHaveBeenCalled();
    const afterDrag = pan.snapshot();
    now += 1000;
    expect(pan.snapshot()).toEqual(afterDrag); // no queued inertia

    const cursor = { x: 220, y: 130 };
    const underCursor = pan.toWorld(cursor);
    // happy-dom's WheelEvent extends UIEvent, not MouseEvent, and drops the
    // cursor coordinates. Give the test the actual browser event shape.
    const wheel = new MouseEvent('wheel', { clientX: 240, clientY: 160, bubbles: true, cancelable: true });
    Object.defineProperties(wheel, { deltaY: { value: -120 }, deltaMode: { value: 0 } });
    canvas.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(pan.snapshot().scale).toBeGreaterThan(afterDrag.scale);
    anchored(underCursor, cursor);
    pan.zoomBy(1e6, cursor);
    expect(pan.snapshot().scale).toBeCloseTo(8 * pan.snapshot().fit);
    pan.panBy(1e6, 1e6);
    expect(pan.snapshot()).toMatchObject({ x: 20, y: 20 });
    pan.panBy(-1e6, -1e6);
    expect(pan.snapshot().x).toBeCloseTo(380 - 200 * pan.snapshot().scale);
    expect(pan.snapshot().y).toBeCloseTo(220 - 100 * pan.snapshot().scale);
    pan.zoomBy(1e-6);
    expect(pan.snapshot()).toMatchObject({ x: 20, y: 30, scale: 1.8 });

    pointer('pointerdown', 20, 150, 120);
    pointer('pointerdown', 21, 250, 120);
    pointer('pointermove', 20, -10_000, 120, document.body);
    pointer('pointermove', 21, 10_000, 120, document.body);
    expect(pan.snapshot().scale).toBeCloseTo(8 * pan.snapshot().fit);
    pointer('pointermove', 20, 199.9, 120, document.body);
    pointer('pointermove', 21, 200.1, 120, document.body);
    expect(pan.snapshot().scale).toBe(pan.snapshot().fit);
    pointer('pointerup', 20, 199.9, 120, document.body);
    pointer('pointerup', 21, 200.1, 120, document.body);
    pan.fit();

    now += 1000;
    tap(3);
    expect(taps).toHaveBeenCalledWith(midpoint);
    const firstTap = pan.snapshot();
    now += 100;
    tap(4);
    expect(pan.snapshot().scale).toBeCloseTo(firstTap.scale * 2);
    anchored(centre, midpoint);
    expect(taps).toHaveBeenCalledTimes(1); // second tap is zoom, not selection
    const nativeClick = new MouseEvent('click', { detail: 1, bubbles: true, cancelable: true });
    canvas.dispatchEvent(nativeClick);
    expect(nativeClick.defaultPrevented).toBe(true);
    const afterDoubleTap = pan.snapshot();
    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 220, clientY: 150, bubbles: true, cancelable: true }));
    expect(pan.snapshot()).toEqual(afterDoubleTap); // no second zoom from compatibility events

    const selectionKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    const selectionView = pan.snapshot();
    for (const value of selectionKeys) expect(key(value).defaultPrevented).toBe(false);
    expect(pan.snapshot()).toEqual(selectionView);
    expect(key('ArrowRight', true).defaultPrevented).toBe(true);
    expect(pan.snapshot().x).toBeLessThan(selectionView.x);
    expect(userMoves).toHaveBeenCalled();
    expect(key('+').defaultPrevented).toBe(true);
    expect(pan.snapshot().scale).toBeGreaterThan(selectionView.scale);
    expect(key('-').defaultPrevented).toBe(true);
    expect(key('0').defaultPrevented).toBe(true);
    expect(pan.snapshot().scale).toBe(pan.snapshot().fit);
    expect(key('+', false, canvas, true).defaultPrevented).toBe(false); // browser zoom stays native

    const input = document.createElement('input');
    canvas.appendChild(input);
    expect(key('+', false, input).defaultPrevented).toBe(false);
    pan.centreOn({ x: 80, y: 40 }, 4);
    anchored({ x: 80, y: 40 }, midpoint);
    pan.setPadding({ left: 20, right: 20, top: 20, bottom: 180 });
    pan.fit();
    expect(pan.snapshot()).toMatchObject({ x: 100, y: 20, fit: 1, scale: 1 });
    pan.resize(600, 400);
    expect(pan.snapshot()).toMatchObject({ x: 100, y: 20, fit: 2, scale: 2, width: 600, height: 400 });
    // A detent bigger than the host cannot make fit or translation NaN.
    pan.setPadding({ top: 10_000, bottom: 10_000, left: 10_000, right: 10_000 });
    expect(Object.values(pan.snapshot()).every(Number.isFinite)).toBe(true);
    expect(pan.snapshot().fit).toBeGreaterThan(0);

    pan.setPadding({});
    pan.fit();
    pointer('pointerdown', 5, 100, 100);
    pointer('pointermove', 5, 130, 100);
    pointer('pointercancel', 5, 0, 0, document.body);
    const cancelled = pan.snapshot();
    pointer('pointermove', 5, 250, 250, document.body);
    expect(pan.snapshot()).toEqual(cancelled);
    pointer('pointerdown', 6, 100, 100);
    pointer('lostpointercapture', 6, 0, 0);
    pointer('pointermove', 6, 250, 250, document.body);
    expect(pan.snapshot()).toEqual(cancelled);
    pointer('pointerdown', 7, 100, 100);
    pan.destroy();
    changes.mockClear();
    userMoves.mockClear();
    pointer('pointermove', 7, 250, 250, document.body);
    pointer('pointerup', 7, 250, 250, document.body);
    canvas.dispatchEvent(wheel);
    key('+');
    pan.resize(400, 200);
    pan.fit();
    expect(changes).not.toHaveBeenCalled();
    expect(userMoves).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(7);
    expect(canvas.style.touchAction).toBe('pan-y');

    const kiosk = createPanZoom(canvas, { box: [200, 100], width: 400, height: 300, interactive: false });
    const fixed = kiosk.snapshot();
    pointer('pointerdown', 8, 100, 100);
    pointer('pointermove', 8, 200, 200);
    pointer('pointerup', 8, 200, 200);
    expect(key('+').defaultPrevented).toBe(false);
    expect(kiosk.snapshot()).toEqual(fixed);
    expect(canvas.style.touchAction).toBe('pan-y');
    kiosk.centreOn({ x: 100, y: 50 }, 4);
    expect(kiosk.snapshot().scale).toBe(4); // programmatic kiosk crop still works
    kiosk.destroy();
  } finally {
    pan.destroy();
    canvas.remove();
  }
});
