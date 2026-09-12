// Camera QR scanning — the decode half of `qr.ts`, which only ever generated.
//
// Before this, joining a mesh meant reading a 14-character token off one screen
// and typing it into another, or getting the invite link into the second device's
// clipboard somehow. On a phone that is the worst possible interaction, and the
// QR code we were already rendering was decorative unless the user happened to
// open a separate camera app.
//
// --- Why there is no native plugin ------------------------------------------
// The Android side needs no Java at all. Capacitor 8's BridgeWebChromeClient
// already implements `onPermissionRequest`, mapping the WebView's
// `android.webkit.resource.VIDEO_CAPTURE` request onto a runtime
// `Manifest.permission.CAMERA` prompt (verified in
// @capacitor/android@8.4.2 BridgeWebChromeClient.java:102-124). So plain
// `getUserMedia` inside the WebView triggers the real Android permission dialog
// and returns a real camera stream, provided CAMERA is declared in the manifest.
// One code path serves the PWA and the APK.
//
// --- Decoder support --------------------------------------------------------
// Prefer the platform decoder. On Safari/Firefox and other engines without it,
// load jsQR only after the user opens the camera. Typed entry remains available.
import { escapeAttribute, escapeHtml, createElementFromHTML } from './dom/escape';
import { iconMarkup } from './icons';

export interface QrScannerStrings {
  /** Instruction shown under the viewfinder. */
  hint: string;
  /** Cancel/close button. */
  cancel: string;
  /** Camera permission was refused. */
  denied: string;
  /** No camera on this device, or it is already in use. */
  unavailable: string;
  /** Accessible name for the live video region. */
  videoLabel: string;
  /** Shown after a few seconds of decoding nothing — "hold steady, move closer". Optional
   *  so an existing caller keeps compiling; omitted means the hint never changes, which is
   *  the old behaviour. */
  struggling?: string;
  /** Label for the torch toggle. Optional, and the button stays hidden without it — a
   *  light with no name is not an affordance. */
  torch?: string;
}

/** CONSECUTIVE decode attempts that saw nothing before the hint changes to "hold steady".
 *  At the default 200ms poll that is ~3 seconds: long enough not to nag someone who is
 *  still lining the code up, short enough to arrive before they give up.
 *
 *  Consecutive, not cumulative: the counter resets the moment a frame sees a code, so the
 *  hint tracks what is happening NOW rather than latching for the life of the scanner. */
const STRUGGLING_AFTER_MISSES = 15;

/** `focusMode` and `torch` are real, widely-shipped constrainable properties that the
 *  TypeScript DOM lib does not model — `MediaTrackConstraintSet` has neither. Widening it
 *  here keeps the whole file free of `any` and keeps the two spellings (the one asked for
 *  at `getUserMedia` time and the one asked for at `applyConstraints` time) identical. */
type CameraConstraintSet = MediaTrackConstraintSet & { focusMode?: string; torch?: boolean };

/** The one thing this component asks the camera for beyond a frame size. Declared once and
 *  used in BOTH places it is requested, so the two can never drift. */
const CONTINUOUS_FOCUS: CameraConstraintSet = { focusMode: 'continuous' };

/** The one operation this component needs from a decoder. Kept this narrow so a
 *  `BarcodeDetector`, a WASM decoder, or a test fake are interchangeable. */
export interface QrDecoder {
  /** Resolves to every QR payload visible in `source`, or `[]`. */
  detect(source: CanvasImageSource): Promise<string[]>;
}

export interface QrScannerDeps {
  strings: QrScannerStrings;
  /** Called with the decoded payload. The scanner has already stopped the camera
   *  by the time this runs, so the handler is free to navigate or re-render. */
  onResult: (value: string) => void;
  /** The user pressed Cancel. The camera is already stopped. */
  onCancel?: () => void;
  /** Reported once per failure, after the camera is stopped. */
  onError?: (reason: QrScanFailure) => void;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createDecoder?: () => QrDecoder | null;
  /** Poll interval for a decode attempt, ms. Default 200 (~5/s) — fast enough to
   *  feel instant, slow enough not to pin a phone CPU at 100%. */
  intervalMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

export type QrScanFailure = 'denied' | 'unavailable' | 'unsupported';

export interface QrScannerHandle {
  readonly element: HTMLElement;
  /** Opens the camera and begins decoding. Safe to call twice (second is a no-op). */
  start(): Promise<void>;
  /** Stops decoding and releases the camera. Idempotent. */
  stop(): void;
  /** `stop()` plus detach. Idempotent. */
  destroy(): void;
}

/** Whether a Scan affordance should be offered at all.
 *
 *  Both halves are required and neither implies the other: a browser can expose
 *  `BarcodeDetector` with no camera attached, and every browser with a camera
 *  can lack the decoder. Checked synchronously so the caller can decide whether
 *  to render the button, without opening anything. */
export function isQrScanSupported(
  scope: {
    BarcodeDetector?: unknown;
    navigator?: { mediaDevices?: { getUserMedia?: unknown } };
  } = globalThis as never,
): boolean {
  const hasCamera = typeof scope.navigator?.mediaDevices?.getUserMedia === 'function';
  return hasCamera;
}

/** No decoder library or camera canvas is loaded before a scan is requested. */
export function createJsQrDecoder(doc: Document = document): QrDecoder {
  let canvas: HTMLCanvasElement | null = null;
  let library: Promise<typeof import('jsqr')> | null = null;
  return {
    async detect(source) {
      const frame = source as { videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
      const width = frame.videoWidth || frame.naturalWidth || frame.width || 0;
      const height = frame.videoHeight || frame.naturalHeight || frame.height || 0;
      if (!width || !height) return [];
      canvas ??= doc.createElement('canvas');
      const scale = Math.min(1, 960 / Math.max(width, height));
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return [];
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      library ??= import('jsqr');
      const jsQR = (await library).default;
      const result = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
      return result?.data ? [result.data] : [];
    },
  };
}

export function createDefaultQrDecoder(): QrDecoder {
  const native = createBarcodeDetectorDecoder();
  let fallback: QrDecoder | null = null;
  return {
    async detect(source) {
      if (native) {
        try { return await native.detect(source); } catch { /* unavailable native format */ }
      }
      fallback ??= createJsQrDecoder();
      return fallback.detect(source);
    },
  };
}

/** Wraps the platform `BarcodeDetector`, restricted to QR. Returns null when the
 *  API is absent so callers can fall back without a try/catch. */
export function createBarcodeDetectorDecoder(
  scope: {
    BarcodeDetector?: new (init?: { formats?: string[] }) => {
      detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
    };
  } = globalThis as never,
): QrDecoder | null {
  const Ctor = scope.BarcodeDetector;
  if (typeof Ctor !== 'function') return null;
  let detector: { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
  try {
    detector = new Ctor({ formats: ['qr_code'] });
  } catch {
    // Thrown when the engine has the constructor but not the qr_code format.
    return null;
  }
  return {
    async detect(source) {
      const found = await detector.detect(source);
      return found.map((b) => b.rawValue).filter((v) => typeof v === 'string' && v.length > 0);
    },
  };
}

export function createQrScanner(deps: QrScannerDeps): QrScannerHandle {
  const { strings } = deps;
  const getUserMedia =
    deps.getUserMedia ??
    ((constraints) => navigator.mediaDevices.getUserMedia(constraints) as Promise<MediaStream>);
  const createDecoder = deps.createDecoder ?? createDefaultQrDecoder;
  const intervalMs = deps.intervalMs ?? 200;
  const setTimer = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearTimer = deps.clearInterval ?? ((h) => globalThis.clearInterval(h as never));

  const element = createElementFromHTML(
    `<div class="qr-scanner" data-state="idle">
      <div class="qr-scanner-stage">
        <video class="qr-scanner-video" playsinline muted
          aria-label="${escapeAttribute(strings.videoLabel)}"></video>
        <div class="qr-scanner-reticle" aria-hidden="true"></div>
      </div>
      <p class="qr-scanner-hint" role="status">${escapeHtml(strings.hint)}</p>
      <div class="qr-scanner-actions">
        <button type="button" class="btn-ghost qr-scanner-cancel" data-qr-scan-cancel>
          ${iconMarkup('x')}<span>${escapeHtml(strings.cancel)}</span>
        </button>
        <!-- Hidden until the camera reports it HAS a torch. Offering a light that does
             nothing is worse than not offering one, and most laptop webcams have none. -->
        <button type="button" class="btn-ghost qr-scanner-torch" data-qr-scan-torch hidden>
          ${iconMarkup('zap')}<span>${escapeHtml(strings.torch ?? '')}</span>
        </button>
      </div>
    </div>`,
  );

  const video = element.querySelector('video') as HTMLVideoElement;
  const hint = element.querySelector('.qr-scanner-hint') as HTMLElement;
  const torchButton = element.querySelector('[data-qr-scan-torch]') as HTMLButtonElement;

  let stream: MediaStream | null = null;
  let timer: unknown = null;
  let decoder: QrDecoder | null = null;
  let running = false;
  // Guards the decode loop against re-entering while an `await detect()` is in
  // flight. Without it a slow decode on a cheap phone queues up behind itself
  // and the loop falls further behind on every tick.
  let decoding = false;
  // A QR fills a large part of the frame, so consecutive frames decode to the
  // same payload. Latching means `onResult` fires exactly once even though a
  // detect() already in flight may still resolve after `stop()`.
  let settled = false;
  /** Consecutive decode attempts that found nothing. Drives the "hold steady" hint. */
  let missedFrames = 0;
  let torchOn = false;

  function releaseCamera(): void {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
    // Stopping every track is what actually turns the camera indicator off. A
    // dropped reference does not: the track keeps the device open until GC, and
    // on Android that leaves the privacy dot lit after the user has moved on.
    for (const track of stream?.getTracks() ?? []) {
      try {
        track.stop();
      } catch {
        /* already ended */
      }
    }
    stream = null;
    try {
      video.pause();
      // `srcObject = null` is required as well as stopping the tracks; leaving
      // the element bound to an ended stream keeps a frozen last frame on screen.
      video.srcObject = null;
    } catch {
      /* detached or unsupported */
    }
    running = false;
  }

  /**
   * Puts the hint into (or back out of) the "hold steady, move closer" state.
   *
   * DERIVED from `missedFrames` every tick rather than assigned once at a boundary. The
   * previous version fired on `missedFrames === STRUGGLING_AFTER_MISSES` — an exact
   * equality against a counter that only ever went up — so the struggling copy appeared on
   * the 15th empty frame and then stayed for the life of the scanner no matter what the
   * camera did afterwards. Advice that cannot be withdrawn is worse than no advice: it
   * tells someone who has just framed the code correctly to move.
   *
   * Writes only on a CHANGE. `hint` is `role="status"`, i.e. a live region, and the decode
   * loop runs five times a second — re-assigning identical text re-announces it to a screen
   * reader on every tick.
   */
  function setStruggling(struggling: boolean): void {
    const next = struggling && strings.struggling ? strings.struggling : strings.hint;
    if (hint.textContent !== next) hint.textContent = next;
  }

  function fail(reason: QrScanFailure, message: string): void {
    releaseCamera();
    element.dataset.state = reason;
    hint.textContent = message;
    deps.onError?.(reason);
  }

  async function start(): Promise<void> {
    if (running || settled) return;
    running = true;

    decoder = createDecoder();
    if (!decoder) {
      fail('unsupported', strings.unavailable);
      return;
    }

    try {
      // `facingMode: 'environment'` is a request, not a guarantee — a laptop with
      // only a front camera still resolves, which is correct: scanning with the
      // user-facing camera works, it is just mirrored.
      //
      // The RESOLUTION is new and it matters more than anything else here. The whole
      // constraint set used to be `{ facingMode: 'environment' }`, which lets the browser
      // hand back whatever default it likes — often 640x480. A QR held at arm's length
      // occupies a few dozen pixels of that, below what any detector can resolve, so
      // scanning only worked at one distance. `ideal` rather than `exact` so a camera that
      // cannot do 720p still starts instead of throwing OverconstrainedError.
      //
      // FOCUS IS REQUESTED HERE, not only afterwards. The previous fix called
      // `applyConstraints` once `getUserMedia` resolved and only when `getCapabilities()`
      // already listed `continuous` — but capabilities are read before the track is
      // attached and playing, which is exactly the window in which Android reports an
      // empty or partial set. So on most devices nothing was ever applied and the track
      // kept the fixed focus it started in: the reported "scanning only works at one
      // distance". Asking in the INITIAL constraints is what actually reaches the camera
      // at open time, and `advanced` is the reason it is safe to ask blind — an advanced
      // constraint set the browser cannot satisfy is DROPPED, not rejected, so a camera
      // with no focus control still returns a stream. `applyCameraTuning()` then asks
      // again after `play()`, when capabilities are real.
      stream = await getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          advanced: [CONTINUOUS_FOCUS],
        },
        audio: false,
      });
    } catch (error) {
      const name = (error as { name?: string } | null)?.name ?? '';
      // NotAllowedError is a refusal (or an insecure context); everything else —
      // NotFoundError, NotReadableError, OverconstrainedError — means the camera
      // exists but cannot be used right now. Those need different copy: one is
      // "you said no", the other is "it is busy or missing".
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        fail('denied', strings.denied);
      } else {
        fail('unavailable', strings.unavailable);
      }
      return;
    }

    // The dialog can be dismissed while `getUserMedia` is still resolving; the
    // permission prompt makes that window seconds long, not milliseconds. Without
    // this check the stream arrives after `stop()` and the camera stays on.
    if (!running) {
      releaseCamera();
      return;
    }

    element.dataset.state = 'scanning';
    hint.textContent = strings.hint;
    try {
      video.srcObject = stream;
      await video.play();
    } catch {
      /* Autoplay rejection still leaves decodable frames on Android; and a
         missing play() in a test DOM must not abort the scan. */
    }

    // AFTER play(), deliberately. This used to run the instant `getUserMedia` resolved,
    // before the track was attached to the video and delivering frames — the exact window
    // in which Android's `getCapabilities()` answers with an empty or partial set. Reading
    // capabilities there and gating on them is why the previous focus fix was a no-op on
    // most devices. A stopped scanner (cancel during the permission prompt) has nothing to
    // tune, and the torch listener below must not be attached to a dead track.
    if (running) applyCameraTuning();

    timer = setTimer(() => void tick(), intervalMs);
  }

  /**
   * The SECOND attempt at continuous autofocus, and a torch button when the camera has one.
   *
   * THE reported bug: "the camera during in-app qr scanning seems to have a locked focus so
   * scanning is only possible from a specific distance".
   *
   * The two halves are gated differently ON PURPOSE, and that asymmetry is the fix:
   *
   *   - FOCUS is attempted unconditionally. It was previously gated on
   *     `getCapabilities().focusMode?.includes('continuous')`, and an absent capability was
   *     read as "do not try". That is the wrong reading twice over: capabilities are read
   *     from a track that may not have started delivering frames yet (Android answers `{}`
   *     there), and `advanced` constraint sets exist precisely so that a request the camera
   *     cannot honour is dropped instead of failing the call. Treating "the camera did not
   *     tell me" as "the camera cannot" is what made the earlier fix a no-op in the field.
   *     Attempt, and catch — that is what `advanced` is for.
   *
   *   - TORCH stays capability-gated, because it renders a BUTTON. A control that does
   *     nothing is worse than no control, and most laptop webcams have no light at all.
   *     An unanswered `applyConstraints` is invisible; an inert button is not.
   *
   * Every failure is swallowed either way. `focusMode` and `torch` are not in the
   * TypeScript DOM lib and not implemented everywhere; a browser that rejects them must
   * leave a working scanner behind, just without the improvement.
   */
  function applyCameraTuning(): void {
    // Both accessors optional. This whole function is best-effort, so requiring a
    // particular MediaStream method would contradict that — and it would throw on any
    // minimal stream (every test fake here provides `getTracks` only).
    const tracks =
      stream?.getVideoTracks?.() ??
      stream?.getTracks?.().filter((candidate) => candidate.kind === 'video') ??
      [];
    const track = tracks[0];
    if (!track) return;
    // `torch` ONLY. The real object also carries `focusMode`, and this used to read it —
    // narrowing the type to what is actually consumed is what stops the next reader
    // assuming the focus request below still consults it. It does not, deliberately.
    type Tunable = MediaStreamTrack & {
      getCapabilities?: () => { torch?: boolean };
      applyConstraints?: (constraints: unknown) => Promise<void>;
    };
    const tunable = track as Tunable;
    let capabilities: { torch?: boolean } = {};
    try {
      // Through `unknown`: `torch` is a real, widely-shipped capability that the
      // TypeScript DOM lib does not model, so `MediaTrackCapabilities` has no overlap
      // with the shape actually returned.
      capabilities = (tunable.getCapabilities?.() ?? {}) as unknown as typeof capabilities;
    } catch {
      /* not implemented: the torch button stays hidden */
    }

    // Unconditional — see this function's doc. `advanced` so a browser that does not
    // understand the key ignores it rather than failing the whole call and leaving the
    // track untouched, and `.catch` for the ones that reject anyway.
    void tunable.applyConstraints?.({ advanced: [CONTINUOUS_FOCUS] }).catch(() => {});

    if (capabilities.torch === true && strings.torch) {
      torchButton.hidden = false;
      torchButton.addEventListener('click', () => {
        torchOn = !torchOn;
        torchButton.setAttribute('aria-pressed', String(torchOn));
        void tunable.applyConstraints?.({ advanced: [{ torch: torchOn }] }).catch(() => {
          // The camera refused. Reflect that rather than leaving the button lit for a
          // light that is off.
          torchOn = false;
          torchButton.setAttribute('aria-pressed', 'false');
        });
      });
    }
  }

  async function tick(): Promise<void> {
    if (!running || settled || decoding || !decoder) return;
    decoding = true;
    try {
      const values = await decoder.detect(video);
      const value = values.find((v) => v.trim().length > 0);
      // Say something after a few seconds of finding nothing. Frame failures were swallowed
      // entirely, so a scanner that could not read the code looked identical to one that
      // was about to — and there was never a "move closer" hint at all.
      //
      // The reset is keyed on `values.length`, NOT on `value`. A frame in which the decoder
      // located a code but handed back a payload that trims to nothing is a code that IS
      // lined up and simply has not read cleanly yet — the marginal case the hint exists
      // for, and the one where "move a little closer" is actively wrong advice. Counting it
      // as a miss is what made the struggling copy stick once shown.
      missedFrames = values.length > 0 ? 0 : missedFrames + 1;
      setStruggling(missedFrames >= STRUGGLING_AFTER_MISSES);
      if (!value || settled || !running) return;
      settled = true;
      releaseCamera();
      element.dataset.state = 'done';
      deps.onResult(value.trim());
    } catch {
      // A single failed frame is normal (nothing in view, video not ready yet).
      // Only a permanent failure matters, and that surfaces via getUserMedia.
    } finally {
      decoding = false;
    }
  }

  element
    .querySelector('[data-qr-scan-cancel]')
    ?.addEventListener('click', (event: Event): void => {
      event.preventDefault();
      settled = true;
      releaseCamera();
      deps.onCancel?.();
    });

  return {
    element,
    start,
    stop(): void {
      releaseCamera();
    },
    destroy(): void {
      settled = true;
      releaseCamera();
      element.remove();
    },
  };
}
