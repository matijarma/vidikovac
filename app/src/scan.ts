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
  /** Drops the spent code from the address bar after a successful scan. */
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

export function confirmLabel(ok: ScanOk, i18n: I18n, now: number): string {
  const minutes = Math.max(1, Math.round((ok.expiresAt - now) / 60_000));
  const minutesText = i18n.t('common.minutes', { count: minutes });
  if (ok.beaconType === 'phone') return i18n.t('scan.confirmPhone', { minutes: minutesText });
  const venue = i18n.t(`scan.venue.${ok.venueType ?? 'ostalo'}`);
  const sentence = i18n.t('scan.confirmScreen', { venue, area: ok.area ?? '', minutes: minutesText });
  return sentence.replace(/,\s*,/g, ',').replace(/\s+/g, ' ').trim();
}

export function dashboardUrl(ok: ScanOk): string {
  const label = ok.screenLabel ?? (ok.beaconType === 'phone' ? 'phone' : ok.venueType ?? 'screen');
  return `/d/#room=${encodeURIComponent(ok.roomId)}&ticket=${encodeURIComponent(ok.ticket)}&label=${encodeURIComponent(label)}`;
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

  const element = createElementFromHTML(`
    <section class="scan">
      <h1 class="scan-title">${escapeHtml(i18n.t('scan.title'))}</h1>
      <p class="scan-intro">${escapeHtml(i18n.t('scan.intro'))}</p>
      <p class="scan-error" id="scan-error" role="alert" data-testid="scan-error" hidden></p>
      <section class="scan-confirm card" data-testid="confirm-card" role="group"
        aria-labelledby="scan-confirm-title" tabindex="-1" hidden></section>
      ${cameraOffered ? '<div class="scan-camera" id="scan-camera-region" data-testid="scan-camera-region" hidden></div>' : ''}
      <form class="scan-form" novalidate>
        <label class="scan-label" for="scan-code">${escapeHtml(i18n.t('scan.codeLabel'))}</label>
        <input id="scan-code" class="scan-input" data-testid="code-input" type="text" name="code"
          inputmode="text" autocomplete="one-time-code" autocapitalize="characters" autocorrect="off"
          spellcheck="false" maxlength="9" placeholder="ABCD-EFGH" aria-describedby="scan-hint">
        <p id="scan-hint" class="scan-hint">${escapeHtml(i18n.t('scan.codeHint'))}</p>
        <div class="scan-actions">
          <button type="submit" class="btn" data-testid="code-submit" disabled>${escapeHtml(i18n.t('scan.check'))}</button>
          ${cameraOffered ? `<button type="button" class="btn-ghost" data-testid="scan-camera" aria-expanded="false" aria-controls="scan-camera-region">${iconMarkup('qr-code')}<span>${escapeHtml(i18n.t('scan.scanButton'))}</span></button>` : ''}
        </div>
      </form>
      <p class="scan-status" role="status" data-testid="scan-status"></p>
    </section>`);
  root.appendChild(element);

  const errorBox = element.querySelector<HTMLElement>('[data-testid=scan-error]')!;
  const confirmBox = element.querySelector<HTMLElement>('[data-testid=confirm-card]')!;
  const form = element.querySelector<HTMLFormElement>('form')!;
  const input = element.querySelector<HTMLInputElement>('[data-testid=code-input]')!;
  const submitButton = element.querySelector<HTMLButtonElement>('[data-testid=code-submit]')!;
  const status = element.querySelector<HTMLElement>('[data-testid=scan-status]')!;

  let busy = false;
  let navigated = false;

  const cameraButton = element.querySelector<HTMLButtonElement>('[data-testid=scan-camera]');
  const cameraRegion = element.querySelector<HTMLElement>('[data-testid=scan-camera-region]');
  let scanner: QrScannerHandle | null = null;

  function hideConfirm(): void {
    confirmBox.hidden = true;
    confirmBox.replaceChildren();
  }

  /** One visible, announced message; the field carries the same error for AT. */
  function showMessage(message: string): void {
    errorBox.textContent = message;
    errorBox.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', 'scan-hint scan-error');
    hideConfirm();
  }

  /** Catalog first; the server sentence only when this build has no key for it. */
  function showError(key: string, fallback = ''): void {
    const message = i18n.t(key);
    showMessage(message === key ? fallback || i18n.t('scan.errors.bad-request') : message);
  }

  function clearError(): void {
    errorBox.hidden = true;
    errorBox.textContent = '';
    input.removeAttribute('aria-invalid');
    input.setAttribute('aria-describedby', 'scan-hint');
  }

  function renderConfirm(code: string, ok: ScanOk): void {
    confirmBox.innerHTML = `
      <h2 class="scan-confirm-title" id="scan-confirm-title">${escapeHtml(i18n.t('scan.confirmTitle'))}</h2>
      <p class="scan-confirm-code" data-testid="confirm-code" aria-label="${escapeAttribute(speakableCode(code))}">${escapeHtml(formatCode(code))}</p>
      <p class="scan-confirm-label" data-testid="confirm-label">${escapeHtml(confirmLabel(ok, i18n, now()))}</p>
      <p class="scan-confirm-hint">${escapeHtml(i18n.t('scan.confirmHint'))}</p>
      <div class="scan-confirm-actions">
        <button type="button" class="btn" data-testid="unlock">${escapeHtml(i18n.t('scan.unlock'))}</button>
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
    if (busy) return;
    const code = normalizeCode(raw);
    if (!isCompleteCode(code)) {
      showError('scan.errors.incomplete');
      input.focus();
      return;
    }
    busy = true;
    clearError();
    input.disabled = true;
    submitButton.disabled = true;
    status.textContent = i18n.t('scan.checking');

    let result: ScanOk | ScanFail;
    try {
      result = await post(code);
    } catch {
      result = { error: 'bad-request', message: 'network' };
    }

    busy = false;
    input.disabled = false;
    submitButton.disabled = !isCompleteCode(input.value);
    status.textContent = '';

    if ('error' in result) {
      const networkFailure = result.error === 'bad-request' && result.message === 'network';
      showError(networkFailure ? 'scan.errors.network' : `scan.errors.${result.error}`, result.message);
      input.focus();
      return;
    }
    // The code is spent the moment the Worker answers; a reload must not retry it.
    replaceUrl('/s/');
    renderConfirm(code, result);
  }

  input.addEventListener('input', () => {
    const formatted = formatCode(input.value);
    if (input.value !== formatted) input.value = formatted;
    submitButton.disabled = !isCompleteCode(input.value);
    clearError();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submitCode(input.value);
  });

  function closeScanner(): void {
    scanner?.destroy();
    scanner = null;
    if (cameraRegion) {
      cameraRegion.hidden = true;
      cameraRegion.replaceChildren();
    }
    cameraButton?.setAttribute('aria-expanded', 'false');
  }

  function acceptScanned(payload: string): void {
    const code = codeFromScan(payload);
    if (!code) {
      showError('scan.errors.notOurs');
      input.focus();
      return;
    }
    input.value = formatCode(code);
    submitButton.disabled = false;
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
    void handle.start();
  }

  cameraButton?.addEventListener('click', openScanner);

  const initial = codeFromHash(deps.hash);
  if (initial) {
    input.value = formatCode(initial);
    submitButton.disabled = false;
    void submitCode(initial);
  }

  return {
    element,
    submit: submitCode,
    destroy() {
      closeScanner();
      element.remove();
    },
  };
}
