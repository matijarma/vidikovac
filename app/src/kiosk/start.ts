// The start screen: a brand, one sentence and one button. Pressing it makes
// one real POST /api/screens (core/screens.ts) with an empty body -- no
// district, no stop, no URL parameter -- and the Worker answers with ordinary
// credentials for a whole-city screen. Whatever the screen should frame
// instead is chosen afterwards, on the screen itself (kiosk/settings.ts).
//
// The start screen never previews anything, never grants anything and never
// retries on its own: every error ends in a sentence and a button a person
// presses.
import type { CreateBeaconResponse } from '../../../worker/protocol';
import { ScreenError } from '../core/screens';
import { escapeHtml } from '../ui/dom/escape';
import { mmss } from './format';
import { fill, type KioskStrings } from './strings';

export interface StartDeps {
  strings: KioskStrings;
  createScreen: () => Promise<CreateBeaconResponse>;
  onCreated: (response: CreateBeaconResponse) => void;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface StartHandle {
  element: HTMLElement;
  destroy(): void;
}

export type SetupErrorKind = 'access' | 'quota' | 'network' | 'invalid' | 'failed';

/** ScreenError status -> the sentence the person reads. Anything that is
 *  not a ScreenError never reached the Worker: a network failure. */
export function classifySetupError(error: unknown): { kind: SetupErrorKind; retryAfter: number; field: string } {
  if (error instanceof ScreenError) {
    if (error.status === 403) return { kind: 'access', retryAfter: 0, field: '' };
    if (error.status === 429) return { kind: 'quota', retryAfter: Math.max(0, Math.round(error.retryAfter)), field: '' };
    if (error.status === 400) return { kind: 'invalid', retryAfter: 0, field: error.reason };
    return { kind: 'failed', retryAfter: 0, field: '' };
  }
  return { kind: 'network', retryAfter: 0, field: '' };
}

/** The sentence one refusal reads as; the field name is shown only when the
 *  Worker actually named one ('bad-request' is a reason, not a field). */
function setupErrorText(s: KioskStrings, c: { kind: SetupErrorKind; field: string }): string {
  const invalid = c.field && c.field !== 'bad-request'
    ? fill(s.setup.errorInvalid, { field: c.field })
    : s.setup.errorInvalid.replace(/\s*\(\{field\}\)/, '');
  return c.kind === 'access' ? s.setup.errorAccess
    : c.kind === 'quota' ? s.setup.errorQuota
      : c.kind === 'invalid' ? invalid
        : c.kind === 'failed' ? s.setup.errorFailed : s.setup.errorNetwork;
}

function startMarkup(s: KioskStrings): string {
  return `<form class="k-start-form" novalidate>
      <p class="k-kicker">${escapeHtml(s.appName)}</p>
      <h1 class="k-setup-title" id="k-setup-title">${escapeHtml(s.setup.title)}</h1>
      <p class="k-setup-intro">${escapeHtml(s.setup.intro)}</p>
      <p class="k-setup-error" role="alert" data-testid="setup-error" hidden></p>
      <div class="k-setup-actions">
        <button type="submit" class="k-btn k-btn--primary k-start-btn" data-testid="setup-create">${escapeHtml(s.setup.create)}</button>
        <button type="button" class="k-btn k-btn--ghost" data-testid="setup-retry" hidden>${escapeHtml(s.setup.retry)}</button>
      </div>
      <p class="k-setup-meta">${escapeHtml(s.setup.validity)}</p>
    </form>`;
}

export function mountStart(host: HTMLElement, deps: StartDeps): StartHandle {
  const { strings: s } = deps;
  const element = document.createElement('section');
  element.className = 'k-setup k-start';
  element.dataset.testid = 'kiosk-setup';
  element.setAttribute('aria-labelledby', 'k-setup-title');
  element.innerHTML = startMarkup(s);
  host.appendChild(element);
  const q = <T extends HTMLElement>(selector: string): T => element.querySelector<T>(selector)!;
  const form = q<HTMLFormElement>('form');
  const errorEl = q('[data-testid=setup-error]');
  const startBtn = q<HTMLButtonElement>('[data-testid=setup-create]');
  const retryBtn = q<HTMLButtonElement>('[data-testid=setup-retry]');

  let busy = false;
  let destroyed = false;
  let countdown: unknown = null;
  let retryAt = 0;

  function showError(text: string, retryable: boolean): void {
    errorEl.textContent = text;
    errorEl.hidden = false;
    retryBtn.hidden = !retryable;
    retryBtn.disabled = false;
    retryBtn.textContent = s.setup.retry;
  }
  function clearError(): void {
    errorEl.hidden = true;
    errorEl.textContent = '';
    retryBtn.hidden = true;
    if (countdown !== null) { deps.clearTimeout(countdown); countdown = null; }
  }

  /** A quota refusal names the second it lifts; the button counts it down and
   *  enables itself, and nothing retries in between. */
  function armCountdown(seconds: number): void {
    retryAt = deps.now() + seconds * 1000;
    retryBtn.disabled = true;
    tick();
  }
  function tick(): void {
    const left = Math.ceil((retryAt - deps.now()) / 1000);
    if (left <= 0) {
      retryBtn.disabled = false;
      retryBtn.textContent = s.setup.retry;
      countdown = null;
      return;
    }
    retryBtn.textContent = fill(s.setup.retryIn, { time: mmss(left) });
    countdown = deps.setTimeout(tick, 1000);
  }

  /** One real creation per press. A failure is a sentence and a button;
   *  nothing here retries by itself, so a quota or an Access refusal can
   *  never turn into a loop of requests. */
  async function create(): Promise<void> {
    if (busy) return;
    busy = true;
    clearError();
    startBtn.disabled = true;
    startBtn.textContent = s.setup.creating;
    try {
      const response = await deps.createScreen();
      if (destroyed) return;
      deps.onCreated(response);
    } catch (error) {
      if (destroyed) return;
      const c = classifySetupError(error);
      showError(setupErrorText(s, c), c.kind !== 'access' && c.kind !== 'invalid');
      if (c.kind === 'quota' && c.retryAfter > 0) armCountdown(c.retryAfter);
    } finally {
      busy = false;
      startBtn.disabled = false;
      startBtn.textContent = s.setup.create;
    }
  }

  form.addEventListener('submit', (event) => { event.preventDefault(); void create(); });
  retryBtn.addEventListener('click', () => { void create(); });

  return {
    element,
    destroy() {
      destroyed = true;
      if (countdown !== null) deps.clearTimeout(countdown);
      element.remove();
    },
  };
}
