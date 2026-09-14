// The /s/ page: take a code from the URL fragment, the camera or the field,
// POST it, show the confirm card (the possession check the whole mechanic rests
// on), then hand the room and the ticket to /d/ in the fragment. Every browser
// global it needs is injected, so the flow is unit-tested under happy-dom with
// no camera, no network and no real location.
import type { ScanFail, ScanOk } from '../../worker/protocol';
import { scan as scanRequest } from './api';
import { codeFromScan, formatCode, isCompleteCode, normalizeCode, speakableCode } from './code';
import type { I18n } from './i18n/i18n';
import { createElementFromHTML, escapeAttribute, escapeHtml } from './ui/dom/escape';
import { iconMarkup } from './ui/icons';
import { createQrScanner, type QrScannerDeps, type QrScannerHandle } from './ui/qrScanner';

/** Shape of our own QR fragment: four plus four, one optional dash. Anything
 *  else in the fragment (a stray `#room=…`, a marketing tag) is not a code, and
 *  guessing at one would auto-submit garbage. */
const HASH_CODE = /^[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}$/;

/** How long the person waits after the Worker asked them to slow down: the
 *  status line counts it down from here to zero, then the check reopens. */
const WAIT_MS = 60_000;
/** Route short names on the confirm card's stop line; a hub stop serves more,
 *  the card names the first six and the session shows the rest. */
const STOP_ROUTES_SHOWN = 6;
/** The part separator of the confirm line, the same middle dot as the session label. */
const PART = ' · ';

/** One thing the person can do after each error, or nothing beyond the sentence.
 *  A Map, not an object: the code comes from the Worker's answer, and an
 *  unknown one must find nothing, not a prototype member. */
type Recovery = 'retype' | 'safety' | 'wait';
const RECOVERY = new Map<string, Recovery>([
  ['code-used', 'retype'],
  ['code-expired', 'retype'],
  ['code-unknown', 'retype'],
  ['screen-offline', 'safety'],
  ['revoked', 'safety'],
  ['slow-down', 'wait'],
  ['rate-limited', 'wait'],
]);

export interface ScanPageDeps {
  i18n: I18n;
  /** location.hash as the page was opened with. */
  hash: string;
  navigate: (url: string) => void;
  now?: () => number;
  scan?: (code: string) => Promise<ScanOk | ScanFail>;
  /** The entry passes isQrScanSupported(); false means no camera affordance at
   *  all, because a button that opens a camera which cannot decode is worse
   *  than no button. */
  scannerSupported?: boolean;
  createScanner?: (deps: QrScannerDeps) => QrScannerHandle;
  /** Drops the spent code from the address bar once the Worker has answered. */
  replaceUrl?: (url: string) => void;
}

export interface ScanPageHandle {
  readonly element: HTMLElement;
  /** Normalise, validate and POST one code; resolves when the UI has settled. */
  submit(code: string): Promise<void>;
  destroy(): void;
}

export function codeFromHash(hash: string): string | null {
  let value = hash.replace(/^#/, '').trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    // A malformed percent escape is not a code; keep the raw text and let the
    // shape test below reject it.
  }
  if (value.startsWith('code=')) value = value.slice('code='.length);
  if (!HASH_CODE.test(value)) return null;
  const code = normalizeCode(value);
  return isCompleteCode(code) ? code : null;
}

/** The venue word heads the confirm line when the operator gave the screen no
 *  label, so it takes the sentence case every line on the page has. */
function sentenceCase(word: string): string {
  return word.charAt(0).toLocaleUpperCase('hr-HR') + word.slice(1);
}

/** "Kavana Velebit · Donji grad · 10 minuta": the screen's label (its kind when
 *  the operator gave none), the district, the minutes; a peer's phone names
 *  itself. Assembled from parts, so an absent part leaves no hole behind. */
export function confirmLabel(ok: ScanOk, i18n: I18n, now: number): string {
  const minutes = Math.max(1, Math.round((ok.expiresAt - now) / 60_000));
  const minutesText = i18n.t('common.minutes', { count: minutes });
  const head =
    ok.beaconType === 'phone'
      ? i18n.t('scan.confirmPeer')
      : (ok.screenLabel ?? sentenceCase(i18n.t(`scan.venue.${ok.venueType ?? 'ostalo'}`)));
  return [head, ok.area, minutesText].filter(Boolean).join(PART);
}

/** "Stanica Trg bana J. Jelačića · linije 6, 11, 12, 13" when the screen stands
 *  at a stop; the stop alone when the data lists no lines for it; null otherwise. */
export function confirmStopLine(ok: ScanOk, i18n: I18n): string | null {
  const stop = ok.screen?.stop;
  if (!stop) return null;
  const routes = stop.routes.slice(0, STOP_ROUTES_SHOWN).join(', ');
  return routes
    ? i18n.t('scan.confirmStop', { stop: stop.name, routes })
    : i18n.t('scan.confirmStopOnly', { stop: stop.name });
}

export function dashboardUrl(ok: ScanOk): string {
  const label = ok.screenLabel ?? (ok.beaconType === 'phone' ? 'phone' : ok.venueType ?? 'screen');
  return `/d/#room=${encodeURIComponent(ok.roomId)}&ticket=${encodeURIComponent(ok.ticket)}&label=${encodeURIComponent(label)}`;
}

/** mm:ss for the wait countdown, rounded up so it never reads 00:00 while the check is still closed. */
function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function createScanPage(root: HTMLElement, deps: ScanPageDeps): ScanPageHandle {
  const { i18n } = deps;
  const now = deps.now ?? (() => Date.now());
  const post = deps.scan ?? ((code: string) => scanRequest(code));
  const makeScanner = deps.createScanner ?? createQrScanner;
  const cameraOffered = deps.scannerSupported === true;
  const replaceUrl =
    deps.replaceUrl ??
    ((url: string) => {
      globalThis.history.replaceState(null, '', url);
    });
  const initial = codeFromHash(deps.hash);

  // Order: the h1, then the field with everything that belongs to it (label,
  // input, the error line directly under it, hint, the primary check, "ili",
  // the camera), the status line, the intro last. The confirm card and the
  // viewfinder sit above the form and appear only when there is something to
  // show. `autofocus` only when nothing came in the fragment: a code that is
  // already being checked has no use for a keyboard.
  const element = createElementFromHTML(`
    <section class="scan">
      <h1 class="scan-title">${escapeHtml(i18n.t('scan.title'))}</h1>
      <section class="scan-confirm card" data-testid="confirm-card" role="group"
        aria-labelledby="scan-confirm-title" tabindex="-1" hidden></section>
      ${cameraOffered ? '<div class="scan-camera" id="scan-camera-region" data-testid="scan-camera-region" hidden></div>' : ''}
      <form class="scan-form" novalidate>
        <label class="scan-label" for="scan-code">${escapeHtml(i18n.t('scan.codeLabel'))}</label>
        <input id="scan-code" class="scan-input" data-testid="code-input" type="text" name="code"
          inputmode="text" autocomplete="off" autocapitalize="characters" autocorrect="off"
          spellcheck="false" enterkeyhint="go" maxlength="9" placeholder="ABCD-EFGH"
          aria-describedby="scan-hint"${initial ? '' : ' autofocus'}>
        <div class="scan-error" hidden>
          <p class="scan-error-text" id="scan-error" role="alert" data-testid="scan-error"></p>
        </div>
        <p id="scan-hint" class="scan-hint">${escapeHtml(i18n.t('scan.codeHint'))}</p>
        <div class="scan-actions">
          <button type="submit" class="btn btn-primary" data-testid="code-submit" disabled>${escapeHtml(i18n.t('scan.check'))}</button>
          ${cameraOffered ? `<span class="scan-or">${escapeHtml(i18n.t('scan.or'))}</span>` : ''}
          ${cameraOffered ? `<button type="button" class="btn-ghost" data-testid="scan-camera" aria-expanded="false" aria-controls="scan-camera-region">${iconMarkup('qr-code')}<span>${escapeHtml(i18n.t('scan.scanButton'))}</span></button>` : ''}
        </div>
      </form>
      <p class="scan-status" role="status" data-testid="scan-status"></p>
      <p class="scan-intro">${escapeHtml(i18n.t('scan.intro'))}</p>
    </section>`);
  root.appendChild(element);

  const errorBox = element.querySelector<HTMLElement>('.scan-error')!;
  const errorText = element.querySelector<HTMLElement>('[data-testid=scan-error]')!;
  const confirmBox = element.querySelector<HTMLElement>('[data-testid=confirm-card]')!;
  const form = element.querySelector<HTMLFormElement>('form')!;
  const input = element.querySelector<HTMLInputElement>('[data-testid=code-input]')!;
  const submitButton = element.querySelector<HTMLButtonElement>('[data-testid=code-submit]')!;
  const status = element.querySelector<HTMLElement>('[data-testid=scan-status]')!;

  let busy = false;
  let navigated = false;
  /** The slow-down wait: the check stays closed until the countdown reaches zero. */
  let waiting = false;
  let waitTimer: ReturnType<typeof setInterval> | null = null;
  /** The status line currently carries a camera word (cleared when the camera closes). */
  let cameraStatus = false;

  const cameraButton = element.querySelector<HTMLButtonElement>('[data-testid=scan-camera]');
  const cameraRegion = element.querySelector<HTMLElement>('[data-testid=scan-camera-region]');
  let scanner: QrScannerHandle | null = null;

  /** The check opens only for a complete code, outside a POST and outside a wait. */
  function syncSubmit(): void {
    submitButton.disabled = busy || waiting || !isCompleteCode(input.value);
  }

  function hideConfirm(): void {
    confirmBox.hidden = true;
    confirmBox.replaceChildren();
  }

  /** One visible, announced sentence with at most one action under it; the
   *  field carries the same error for AT. The box is shown before the text is
   *  written so the alert changes while it is rendered. */
  function showMessage(message: string, recovery: Recovery | null = null): void {
    hideConfirm();
    errorBox.querySelector('.scan-error-action')?.remove();
    errorBox.hidden = false;
    errorText.textContent = message;
    if (recovery === 'retype') {
      errorBox.insertAdjacentHTML(
        'beforeend',
        `<button type="button" class="btn-ghost scan-error-action" data-testid="scan-retype">${escapeHtml(i18n.t('scan.errors.actions.retype'))}</button>`,
      );
    } else if (recovery === 'safety') {
      errorBox.insertAdjacentHTML(
        'beforeend',
        `<a class="btn-ghost scan-error-action" href="/hitno" data-testid="scan-safety">${escapeHtml(i18n.t('scan.errors.actions.safety'))}</a>`,
      );
    }
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', 'scan-hint scan-error');
  }

  /** Catalog first; the server sentence only when this build has no key for
   *  it. The recovery follows the code, so an unknown code gets none. */
  function showError(code: string, fallback = ''): void {
    const key = `scan.errors.${code}`;
    const message = i18n.t(key);
    const recovery = RECOVERY.get(code) ?? null;
    showMessage(message === key ? fallback || i18n.t('scan.errors.bad-request') : message, recovery);
    if (recovery === 'wait') startWait();
  }

  function clearError(): void {
    errorBox.hidden = true;
    errorText.textContent = '';
    errorBox.querySelector('.scan-error-action')?.remove();
    input.removeAttribute('aria-invalid');
    input.setAttribute('aria-describedby', 'scan-hint');
  }

  function stopWait(): void {
    if (waitTimer !== null) clearInterval(waitTimer);
    waitTimer = null;
    if (!waiting) return;
    waiting = false;
    status.textContent = '';
    syncSubmit();
  }

  /** Counts the Worker's minute down in the status line from the clock, not
   *  from ticks, so a throttled background tab catches up the moment it returns. */
  function startWait(): void {
    stopWait();
    waiting = true;
    const until = now() + WAIT_MS;
    const tick = (): void => {
      const left = until - now();
      if (left <= 0) {
        stopWait();
        return;
      }
      status.textContent = i18n.t('scan.errors.actions.wait', { time: clock(left) });
    };
    tick();
    syncSubmit();
    waitTimer = setInterval(tick, 1000);
  }

  function renderConfirm(code: string, ok: ScanOk): void {
    const stopLine = confirmStopLine(ok, i18n);
    confirmBox.innerHTML = `
      <h2 class="scan-confirm-title" id="scan-confirm-title">${escapeHtml(i18n.t('scan.confirmTitle'))}</h2>
      <p class="scan-confirm-code" data-testid="confirm-code" aria-label="${escapeAttribute(speakableCode(code))}">${escapeHtml(formatCode(code))}</p>
      <p class="scan-confirm-label" data-testid="confirm-label">${escapeHtml(confirmLabel(ok, i18n, now()))}</p>
      ${stopLine ? `<p class="scan-confirm-stop" data-testid="confirm-stop">${escapeHtml(stopLine)}</p>` : ''}
      <p class="scan-confirm-hint">${escapeHtml(i18n.t('scan.confirmHint'))}</p>
      <div class="scan-confirm-actions">
        <button type="button" class="btn btn-primary" data-testid="unlock">${escapeHtml(i18n.t('scan.unlock'))}</button>
        <button type="button" class="btn-ghost" data-testid="confirm-cancel">${escapeHtml(i18n.t('scan.cancel'))}</button>
      </div>`;
    confirmBox.hidden = false;
    confirmBox.querySelector<HTMLButtonElement>('[data-testid=unlock]')!.addEventListener('click', () => {
      if (navigated) return;
      navigated = true;
      deps.navigate(dashboardUrl(ok));
    });
    confirmBox.querySelector<HTMLButtonElement>('[data-testid=confirm-cancel]')!.addEventListener('click', () => {
      hideConfirm();
      input.focus();
    });
    confirmBox.focus();
  }

  async function submitCode(raw: string): Promise<void> {
    if (busy || waiting) return;
    const code = normalizeCode(raw);
    if (!isCompleteCode(code)) {
      showError('incomplete');
      input.focus();
      return;
    }
    busy = true;
    clearError();
    // Read-only, never disabled: the keyboard and the caret stay where they
    // are, the field only stops taking edits until the Worker answers.
    input.readOnly = true;
    input.setAttribute('aria-busy', 'true');
    submitButton.disabled = true;
    submitButton.textContent = i18n.t('scan.checkingButton');
    if (cameraButton) cameraButton.disabled = true;
    status.textContent = i18n.t('scan.checking');

    let result: ScanOk | ScanFail;
    try {
      result = await post(code);
    } catch {
      result = { error: 'bad-request', message: 'network' };
    }

    busy = false;
    input.readOnly = false;
    input.removeAttribute('aria-busy');
    submitButton.textContent = i18n.t('scan.check');
    if (cameraButton) cameraButton.disabled = false;
    status.textContent = '';
    // The code is spent the moment the Worker answers, whichever way it
    // answers: a reload or a pull-to-refresh must not retry it.
    replaceUrl('/s/');

    if ('error' in result) {
      const networkFailure = result.error === 'bad-request' && result.message === 'network';
      showError(networkFailure ? 'network' : result.error, result.message);
      syncSubmit();
      input.focus();
      return;
    }
    syncSubmit();
    renderConfirm(code, result);
  }

  input.addEventListener('input', () => {
    const formatted = formatCode(input.value);
    if (input.value !== formatted) input.value = formatted;
    syncSubmit();
    clearError();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitCode(input.value);
  });

  // "Upiši novi kod": the spent code leaves the field, the sentence goes with it.
  errorBox.addEventListener('click', (event) => {
    if (!(event.target as Element).closest('[data-testid=scan-retype]')) return;
    input.value = '';
    clearError();
    syncSubmit();
    input.focus();
  });

  function setCameraStatus(message: string | null): void {
    cameraStatus = message !== null;
    status.textContent = message ?? '';
  }

  function closeScanner(): void {
    scanner?.destroy();
    scanner = null;
    if (cameraRegion) {
      cameraRegion.hidden = true;
      cameraRegion.replaceChildren();
    }
    cameraButton?.setAttribute('aria-expanded', 'false');
    if (cameraStatus) setCameraStatus(null);
  }

  function acceptScanned(payload: string): void {
    const code = codeFromScan(payload);
    if (!code) {
      showError('notOurs');
      input.focus();
      return;
    }
    input.value = formatCode(code);
    syncSubmit();
    void submitCode(code);
  }

  function openScanner(): void {
    if (!cameraButton || !cameraRegion || scanner) return;
    clearError();
    cameraRegion.hidden = false;
    cameraButton.setAttribute('aria-expanded', 'true');
    const handle = makeScanner({
      strings: {
        hint: i18n.t('scan.scanner.hint'),
        cancel: i18n.t('scan.scanner.cancel'),
        denied: i18n.t('scan.scanner.denied'),
        unavailable: i18n.t('scan.scanner.unavailable'),
        videoLabel: i18n.t('scan.scanner.videoLabel'),
        struggling: i18n.t('scan.scanner.struggling'),
        torch: i18n.t('scan.scanner.torch'),
      },
      onResult: (value) => {
        closeScanner();
        acceptScanned(value);
      },
      onCancel: () => {
        closeScanner();
        cameraButton.focus();
      },
      onError: (reason) => {
        // The scanner writes the reason into its own element, which we are about
        // to remove, so the same sentence is repeated in the page's alert line.
        closeScanner();
        showMessage(i18n.t(reason === 'denied' ? 'scan.scanner.denied' : 'scan.scanner.unavailable'));
        input.focus();
      },
    });
    scanner = handle;
    cameraRegion.appendChild(handle.element);
    // The viewfinder opens above the field: bring it into view, hand focus to
    // its Odustani, and let the status region say what the camera is doing
    // until the stream plays (start() resolves after play()).
    cameraRegion.scrollIntoView({ block: 'center' });
    handle.element.querySelector<HTMLElement>('[data-qr-scan-cancel]')?.focus();
    setCameraStatus(i18n.t('scan.scanner.opening'));
    void handle.start().then(() => {
      // start() also resolves after a failure, by which time onError has
      // closed this scanner; only a viewfinder that is still open is live.
      if (scanner === handle) setCameraStatus(i18n.t('scan.scanner.live'));
    });
  }

  cameraButton?.addEventListener('click', openScanner);

  if (initial) {
    input.value = formatCode(initial);
    syncSubmit();
    void submitCode(initial);
  }

  return {
    element,
    submit: submitCode,
    destroy() {
      stopWait();
      closeScanner();
      element.remove();
    },
  };
}
