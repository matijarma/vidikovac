// Two-step self-service setup: a district, then a stop, then one real
// POST /api/screens (core/screens.ts) that returns ordinary credentials. The
// wizard never previews anything, never grants anything and never retries
// on its own: every error ends in a sentence and a button a person presses.
import type { CreateBeaconResponse } from '../../../worker/protocol';
import type { ScreenStop } from '../core/contracts';
import { ScreenError } from '../core/screens';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { DEFAULT_DISTRICT_SLUG, DISTRICTS, districtBySlug, type District } from './districts';
import { fmtDistance, mmss } from './format';
import { DEFAULT_STOP_ID, rankStops, sortRouteIds, stopById, type RankedStop } from './stops';
import { fill, plural, type KioskStrings } from './strings';

/** Stops listed per district before a search narrows them. */
export const SETUP_STOP_LIMIT = 8;
export const SETUP_SEARCH_LIMIT = 12;

export interface SetupDeps {
  strings: KioskStrings;
  locale: string;
  loadStops: () => Promise<ScreenStop[]>;
  createScreen: (input: { area: string; stopId: string }) => Promise<CreateBeaconResponse>;
  onCreated: (response: CreateBeaconResponse) => void;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  initialDistrict?: string;
  initialStopId?: string;
}

export interface SetupHandle {
  element: HTMLElement;
  destroy(): void;
}

export type SetupErrorKind = 'access' | 'quota' | 'network' | 'invalid' | 'failed' | 'stops';

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

function districtMarkup(district: District, checked: boolean): string {
  return `<option value="${escapeAttribute(district.slug)}"${checked ? ' selected' : ''}>${escapeHtml(district.name)}</option>`;
}

function setupMarkup(s: KioskStrings, initialDistrict: string): string {
  return `<header class="k-setup-head">
      <h1 class="k-setup-title" id="k-setup-title">${escapeHtml(s.setup.title)}</h1>
      <p class="k-setup-intro">${escapeHtml(s.setup.intro)}</p>
    </header>
    <form class="k-setup-form" novalidate>
      <fieldset class="k-setup-step-box" data-testid="setup-districts">
        <legend class="k-setup-legend">${escapeHtml(s.setup.districtLegend)}</legend>
        <label class="k-district-pick"><span class="k-visually-hidden">${escapeHtml(s.setup.districtLegend)}</span><select name="district" data-testid="setup-district">${DISTRICTS.map((d) => districtMarkup(d, d.slug === initialDistrict)).join('')}</select></label>
      </fieldset>
      <fieldset class="k-setup-step-box" data-testid="setup-stops">
        <legend class="k-setup-legend">${escapeHtml(s.setup.stopLegend)}</legend>
        <label class="k-search"><span class="k-search-label">${escapeHtml(s.setup.search)}</span><input type="search" class="k-search-input" data-testid="setup-search" autocomplete="off" spellcheck="false"></label>
        <p class="k-setup-hint" data-testid="setup-stop-hint">${escapeHtml(s.setup.searchHint)}</p>
        <div class="k-stop-list" data-testid="setup-stop-list" role="group" aria-label="${escapeAttribute(s.setup.stopLegend)}"></div>
        <p class="k-setup-count" data-testid="setup-stop-count" aria-live="polite"></p>
      </fieldset>
      <p class="k-setup-error" role="alert" data-testid="setup-error" hidden></p>
      <div class="k-setup-actions">
        <button type="submit" class="k-btn k-btn--primary" data-testid="setup-create" disabled>${escapeHtml(s.setup.create)}</button>
        <button type="button" class="k-btn k-btn--ghost" data-testid="setup-retry" hidden>${escapeHtml(s.setup.retry)}</button>
      </div>
      <p class="k-setup-summary" data-testid="setup-summary"></p>
      <p class="k-setup-meta">${escapeHtml(s.setup.validity)}</p>
      <p class="k-setup-meta">${escapeHtml(s.setup.provisionHint)}</p>
    </form>`;
}

export function mountSetup(host: HTMLElement, deps: SetupDeps): SetupHandle {
  const { strings: s, locale } = deps;
  const element = document.createElement('section');
  element.className = 'k-setup';
  element.dataset.testid = 'kiosk-setup';
  element.setAttribute('aria-labelledby', 'k-setup-title');
  element.innerHTML = setupMarkup(s, districtBySlug(deps.initialDistrict)?.slug ?? DEFAULT_DISTRICT_SLUG);
  host.appendChild(element);
  const q = <T extends HTMLElement>(selector: string): T => element.querySelector<T>(selector)!;
  const form = q<HTMLFormElement>('form');
  const districtsBox = q('[data-testid=setup-districts]');
  const stopsBox = q('[data-testid=setup-stops]');
  const search = q<HTMLInputElement>('[data-testid=setup-search]');
  const list = q('[data-testid=setup-stop-list]');
  const countEl = q('[data-testid=setup-stop-count]');
  const errorEl = q('[data-testid=setup-error]');
  const createBtn = q<HTMLButtonElement>('[data-testid=setup-create]');
  const retryBtn = q<HTMLButtonElement>('[data-testid=setup-retry]');
  const summaryEl = q('[data-testid=setup-summary]');

  let stops: ScreenStop[] | null = null;
  let selectedStopId: string | null = deps.initialStopId ?? null;
  let busy = false;
  let destroyed = false;
  let countdown: unknown = null;
  let retryAt = 0;
  let lastAction: 'load' | 'create' = 'load';

  const district = (): District =>
    districtBySlug(element.querySelector<HTMLSelectElement>('select[name=district]')?.value) ?? DISTRICTS[0]!;

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

  function stopMarkup(stop: RankedStop, checked: boolean): string {
    const routes = sortRouteIds(stop.routes).join(', ');
    const meta = [fill(s.setup.routesAt, { routes }), stop.distanceM !== null ? fmtDistance(locale, stop.distanceM) : ''].filter(Boolean).join(' · ');
    return `<label class="k-choice k-choice--stop"><input type="radio" name="stop" value="${escapeAttribute(stop.id)}"${checked ? ' checked' : ''}><span class="k-choice-text"><span class="k-stop-name">${escapeHtml(stop.name)}</span><span class="k-stop-meta">${escapeHtml(meta)}</span></span></label>`;
  }

  function paintSummary(): void {
    const stop = stops && selectedStopId ? stopById(stops, selectedStopId) : null;
    summaryEl.textContent = stop ? fill(s.setup.summary, { stop: stop.name, district: district().name }) : '';
    createBtn.disabled = busy || !stop;
  }

  /** Nearest the district's seat first; a typed name searches the whole city. */
  function renderStops(): void {
    if (!stops) return;
    const d = district();
    const query = search.value.trim();
    let ranked = rankStops(stops, { query, near: d.seat, limit: query ? SETUP_SEARCH_LIMIT : SETUP_STOP_LIMIT, dedupeNames: true });
    if (!query && d.slug === DEFAULT_DISTRICT_SLUG && !ranked.some((r) => r.id === DEFAULT_STOP_ID)) {
      const fallback = stopById(stops, DEFAULT_STOP_ID);
      if (fallback) ranked = [{ ...fallback, distanceM: null }, ...ranked].slice(0, SETUP_STOP_LIMIT);
    }
    if (!ranked.some((r) => r.id === selectedStopId)) {
      selectedStopId = d.slug === DEFAULT_DISTRICT_SLUG && ranked.some((r) => r.id === DEFAULT_STOP_ID) ? DEFAULT_STOP_ID : (ranked[0]?.id ?? null);
    }
    list.innerHTML = ranked.length > 0
      ? ranked.map((r) => stopMarkup(r, r.id === selectedStopId)).join('')
      : `<p class="k-setup-empty">${escapeHtml(s.setup.noResults)}</p>`;
    countEl.textContent = ranked.length > 0 ? `${plural(locale, s.setup.results, ranked.length)}${query ? '' : ` · ${s.setup.nearest}`}` : '';
    paintSummary();
  }

  async function ensureStops(): Promise<boolean> {
    if (stops) return true;
    lastAction = 'load';
    countEl.textContent = s.setup.loadingStops;
    try {
      stops = await deps.loadStops();
      if (!destroyed) clearError();
      return true;
    } catch {
      if (!destroyed) showError(s.setup.errorStops, true);
      return false;
    }
  }

  async function goNext(): Promise<void> {
    clearError();
    if (!(await ensureStops()) || destroyed) return;
    renderStops();
  }

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
    const stop = stops && selectedStopId ? stopById(stops, selectedStopId) : null;
    if (!stop) return;
    busy = true;
    lastAction = 'create';
    clearError();
    createBtn.disabled = true;
    createBtn.textContent = s.setup.creating;
    try {
      const response = await deps.createScreen({ area: district().slug, stopId: stop.id });
      if (destroyed) return;
      deps.onCreated(response);
    } catch (error) {
      if (destroyed) return;
      const c = classifySetupError(error);
      // The Worker names the refused field only sometimes; a bare 'bad-request'
      // reason is not a field name and is not shown as one.
      const invalid = c.field && c.field !== 'bad-request' ? fill(s.setup.errorInvalid, { field: c.field }) : s.setup.errorInvalid.replace(/\s*\(\{field\}\)/, '');
      const text = c.kind === 'access' ? s.setup.errorAccess
        : c.kind === 'quota' ? s.setup.errorQuota
          : c.kind === 'invalid' ? invalid
            : c.kind === 'failed' ? s.setup.errorFailed : s.setup.errorNetwork;
      showError(text, c.kind !== 'access' && c.kind !== 'invalid');
      if (c.kind === 'quota' && c.retryAfter > 0) armCountdown(c.retryAfter);
    } finally {
      busy = false;
      createBtn.textContent = s.setup.create;
      paintSummary();
    }
  }

  form.addEventListener('submit', (event) => { event.preventDefault(); if (!createBtn.hidden) void create(); });
  retryBtn.addEventListener('click', () => { if (lastAction === 'load') void goNext(); else void create(); });
  search.addEventListener('input', renderStops);
  search.addEventListener('keydown', (event) => { if (event.key === 'Enter') event.preventDefault(); });
  list.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name === 'stop') { selectedStopId = input.value; paintSummary(); }
  });
  districtsBox.addEventListener('change', () => { selectedStopId = null; search.value = ''; renderStops(); });

  void goNext();
  return {
    element,
    destroy() {
      destroyed = true;
      if (countdown !== null) deps.clearTimeout(countdown);
      element.remove();
    },
  };
}
