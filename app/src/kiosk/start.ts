// The start screen: one field "Adresa ili stajalište", one line under it that
// says what the screen will show, and Pokreni (brief §11, Setup). The field is
// optional. Left empty, Pokreni makes one real POST /api/screens with an
// empty body, byte for byte what the one-button start sent, and the Worker
// answers with a whole-city screen whose place is Trg bana J. Jelačića. A
// picked stop or street posts `{ place, frame }` instead; the Worker resolves
// a stop's name and point from its own table (core/screens.ts, seam S1).
//
// The start screen never grants anything and never retries on its own: every
// error ends in a sentence and a button a person presses, and typed text that
// matches nothing is said to be so rather than quietly becoming the whole city.
import type { CreateBeaconResponse, ScreenStop } from '../../../worker/protocol';
import { DEFAULT_FRAME_STOPS, type FrameStops } from '../../../shared/city/frame';
import { PLACE_ADDRESS_MAX, PLACE_NAME_MAX, type ScreenPlace, type ScreenPlaceInput } from '../../../shared/city/place';
import { loadStops as loadStopsImpl, ScreenError, type CreateScreenInput } from '../core/screens';
import { escapeHtml } from '../ui/dom/escape';
import { vetExternal } from '../../../shared/kiosk/external-text';
import { mmss } from './format';
import { mountPlaceField } from './place-field';
import { placeInputOf, type StreetGeo } from './places';
import { routeType } from './stops';
import { fill, plural, type KioskStrings } from './strings';

/** What Pokreni posts: `{}` for an empty field, `{ place, frame }` for a picked place. */
export type StartScreenInput = CreateScreenInput & { place?: ScreenPlaceInput; frame?: FrameStops };

export interface StartDeps {
  strings: KioskStrings;
  /** The plural of the preview line; Croatian when absent. */
  locale?: string;
  createScreen: (input: StartScreenInput) => Promise<CreateBeaconResponse>;
  /** The stop table, fetched on the first touch of the field and never at mount; the lazy core loader by default. */
  loadStops?: () => Promise<readonly ScreenStop[]>;
  /** The offline street index; without it only stops are suggested. */
  loadStreets?: () => Promise<readonly StreetGeo[]>;
  /** Whether a route is a tram route (GTFS route_type 0 in the static table by default). */
  isTram?: (routeId: string) => boolean;
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
    ? fill(s.setup.errorInvalid, { field: vetExternal('name', c.field, 'row') ?? '' })
    : s.setup.errorInvalid.replace(/\s*\(\{field\}\)/, '');
  return c.kind === 'access' ? s.setup.errorAccess
    : c.kind === 'quota' ? s.setup.errorQuota
      : c.kind === 'invalid' ? invalid
        : c.kind === 'failed' ? s.setup.errorFailed : s.setup.errorNetwork;
}

/** The line under the field: what the screen will show once Pokreni is pressed. */
export function previewText(s: KioskStrings, locale: string, place: ScreenPlace | null, unresolved: string): string {
  if (place) return fill(plural(locale, s.setup.preview, DEFAULT_FRAME_STOPS), { place: vetExternal('name', place.name, 'row') ?? '' });
  return unresolved ? '' : s.setup.previewCity;
}

/** The place as the Worker accepts it: a typed address past the protocol's cap is dropped, a name past its cap cut. */
function postable(place: ScreenPlace): ScreenPlaceInput {
  const input = placeInputOf(place);
  if (input.address !== undefined && input.address.trim().length > PLACE_ADDRESS_MAX) delete input.address;
  if (input.kind === 'address' && input.name.trim().length > PLACE_NAME_MAX) input.name = input.name.trim().slice(0, PLACE_NAME_MAX).trimEnd();
  return input;
}

function startMarkup(s: KioskStrings): string {
  return `<form class="k-start-form" novalidate>
      <p class="k-kicker">${escapeHtml(s.appName)}</p>
      <h1 class="k-setup-title" id="k-setup-title">${escapeHtml(s.setup.title)}</h1>
      <div class="k-start-place"></div>
      <p class="k-setup-summary" data-testid="setup-preview" aria-live="polite"></p>
      <p class="k-setup-error" role="alert" data-testid="setup-error" hidden></p>
      <div class="k-setup-actions">
        <button type="submit" class="k-btn k-btn--primary k-start-btn" data-testid="setup-create">${escapeHtml(s.setup.create)}</button>
        <button type="button" class="k-btn k-btn--ghost" data-testid="setup-retry" hidden>${escapeHtml(s.setup.retry)}</button>
      </div>
    </form>`;
}

export function mountStart(host: HTMLElement, deps: StartDeps): StartHandle {
  const { strings: s } = deps;
  const locale = deps.locale ?? 'hr';
  const element = document.createElement('section');
  element.className = 'k-setup k-start';
  element.dataset.testid = 'kiosk-setup';
  element.setAttribute('aria-labelledby', 'k-setup-title');
  element.innerHTML = startMarkup(s);
  host.appendChild(element);
  const q = <T extends HTMLElement>(selector: string): T => element.querySelector<T>(selector)!;
  const form = q<HTMLFormElement>('form');
  const previewEl = q('[data-testid=setup-preview]');
  const errorEl = q('[data-testid=setup-error]');
  const startBtn = q<HTMLButtonElement>('[data-testid=setup-create]');
  const retryBtn = q<HTMLButtonElement>('[data-testid=setup-retry]');

  let busy = false;
  let destroyed = false;
  let countdown: unknown = null;
  let retryAt = 0;
  /** The error on show is the field's own (no match, no lists): the next keystroke takes it away. */
  let fieldError = false;

  const field = mountPlaceField(q('.k-start-place'), {
    strings: s,
    locale,
    loadStops: deps.loadStops ?? (() => loadStopsImpl()),
    loadStreets: deps.loadStreets ?? (async () => []),
    isTram: deps.isTram ?? ((routeId) => routeType(routeId) === 0),
    onChange: (place, unresolved) => {
      previewEl.textContent = previewText(s, locale, place, unresolved);
      if (fieldError) clearError();
    },
    setTimeout: deps.setTimeout,
    clearTimeout: deps.clearTimeout,
  });
  previewEl.textContent = previewText(s, locale, null, '');

  function showError(text: string, retryable: boolean): void {
    errorEl.textContent = text;
    errorEl.hidden = false;
    retryBtn.hidden = !retryable;
    retryBtn.disabled = false;
    retryBtn.textContent = s.setup.retry;
  }
  function clearError(): void {
    fieldError = false;
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

  /** One real creation per press. Typed text that is not a place stops here
   *  with a sentence; a failure of the Worker is a sentence and a button.
   *  Nothing retries by itself, so a quota or an Access refusal can never turn
   *  into a loop of requests. */
  async function create(): Promise<void> {
    if (busy) return;
    busy = true;
    clearError();
    startBtn.disabled = true;
    startBtn.textContent = s.setup.creating;
    try {
      const settled = field.unresolved() ? await field.settle() : 'ready';
      if (destroyed) return;
      const place = field.value();
      if (!place && field.unresolved()) {
        showError(settled === 'failed' ? s.setup.errorPlaces : settled === 'ambiguous' ? s.setup.ambiguous : s.setup.noMatch, false);
        fieldError = true;
        return;
      }
      const response = await deps.createScreen(place ? { place: postable(place), frame: DEFAULT_FRAME_STOPS } : {});
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
      field.destroy();
      element.remove();
    },
  };
}
