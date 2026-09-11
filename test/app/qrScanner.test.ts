// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createQrScanner, isQrScanSupported, type QrDecoder } from '../../app/src/ui/qrScanner';

const STRINGS = { hint: 'Usmjeri kameru prema QR kodu.', cancel: 'Odustani', denied: 'Kamera odbijena.', unavailable: 'Kamera nije dostupna.', videoLabel: 'Slika s kamere', struggling: 'Drži mirno.', torch: 'Svjetlo' };

function fakeStream() {
  const tracks = [{ stopped: false, stop() { this.stopped = true; } }];
  return { stream: { getTracks: () => tracks } as unknown as MediaStream, allStopped: () => tracks.every((t) => t.stopped) };
}
function manualTimer() {
  let fn: (() => void) | null = null;
  return {
    setInterval: (f: () => void) => { fn = f; return 1; },
    clearInterval: () => { fn = null; },
    async tick() { fn?.(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); },
  };
}
function mount(decoder: QrDecoder, getUserMedia?: () => Promise<MediaStream>) {
  const cam = fakeStream();
  const timer = manualTimer();
  const onResult = vi.fn(); const onError = vi.fn(); const onCancel = vi.fn();
  const handle = createQrScanner({
    strings: STRINGS, onResult, onError, onCancel,
    getUserMedia: getUserMedia ?? (async () => cam.stream),
    createDecoder: () => decoder, setInterval: timer.setInterval, clearInterval: timer.clearInterval,
  });
  document.body.appendChild(handle.element);
  return { handle, cam, timer, onResult, onError, onCancel };
}

describe('isQrScanSupported', () => {
  it('needs both BarcodeDetector and getUserMedia', () => {
    expect(isQrScanSupported({})).toBe(false);
    expect(isQrScanSupported({ BarcodeDetector: function () {} as never })).toBe(false);
    expect(isQrScanSupported({ BarcodeDetector: function () {} as never, navigator: { mediaDevices: { getUserMedia: () => {} } } })).toBe(true);
  });
});

describe('createQrScanner', () => {
  it('reports the first decoded payload once and stops the camera', async () => {
    const m = mount({ detect: async () => ['https://zagreb.aningfilm.hr/s#ABCD-EFGH'] });
    await m.handle.start();
    await m.timer.tick();
    await m.timer.tick();
    expect(m.onResult).toHaveBeenCalledTimes(1);
    expect(m.onResult).toHaveBeenCalledWith('https://zagreb.aningfilm.hr/s#ABCD-EFGH');
    expect(m.cam.allStopped()).toBe(true);
    expect(m.handle.element.dataset.state).toBe('done');
  });
  it('maps NotAllowedError to denied and everything else to unavailable, camera stopped either way', async () => {
    const denied = mount({ detect: async () => [] }, async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); });
    await denied.handle.start();
    expect(denied.onError).toHaveBeenCalledWith('denied');
    expect(denied.handle.element.querySelector('.qr-scanner-hint')?.textContent).toBe(STRINGS.denied);
    const busy = mount({ detect: async () => [] }, async () => { throw Object.assign(new Error('no'), { name: 'NotReadableError' }); });
    await busy.handle.start();
    expect(busy.onError).toHaveBeenCalledWith('unavailable');
  });
  it('cancel stops the camera and fires onCancel', async () => {
    const m = mount({ detect: async () => [] });
    await m.handle.start();
    (m.handle.element.querySelector('[data-qr-scan-cancel]') as HTMLButtonElement).click();
    expect(m.onCancel).toHaveBeenCalledTimes(1);
    expect(m.cam.allStopped()).toBe(true);
  });
  it('shows the struggling hint after 15 empty frames and withdraws it when a code appears', async () => {
    let frames: string[] = [];
    const m = mount({ detect: async () => frames });
    await m.handle.start();
    for (let i = 0; i < 15; i += 1) await m.timer.tick();
    expect(m.handle.element.querySelector('.qr-scanner-hint')?.textContent).toBe(STRINGS.struggling);
    frames = [''];
    await m.timer.tick();
    expect(m.handle.element.querySelector('.qr-scanner-hint')?.textContent).toBe(STRINGS.hint);
  });
});
