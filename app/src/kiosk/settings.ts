// Postavke: the screen's own settings, an overlay over the stage like Osnovno
// (Escape, a close button, 90 s idle), never over a granted session. Four
// sections: the area the map frames, the stop it centres on, the theme, and
// the screen itself (when it expires, and the one way to forget it).
//
// The area and the stop are one saved pair: pressing Spremi sends a single
// `screen-set` frame over the beacon socket, and the DO's answer re-frames the
// wall through applyScreen() -- nothing here paints the map or the header
// itself. The theme is the header button's own cycle and applies at once.
import type { ScreenStop } from '../core/contracts';
import { CITY_AREA } from '../../../worker/pairing/areas';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import type { ThemePreference } from '../ui/theme';
import { DISTRICTS, districtBySlug } from './districts';
import { clock, fmtDistance } from './format';
import { rankStops, sortRouteIds, stopById, type RankedStop } from './stops';
import { fill, plural, type KioskStrings } from './strings';

/** Untouched for this long, the panel closes itself and the screen returns to the invitation. */
export const SETTINGS_IDLE_MS = 90_000;
/** Stops offered before a search narrows them, and after one. */
export const SETTINGS_STOP_LIMIT = 8;
export const SETTINGS_SEARCH_LIMIT = 12;
/** Trg bana Jelačića: where "nearest first" starts from when the area is the whole city. */
const CITY_CENTRE = { lon: 15.97726, lat: 45.81286 };

/** What the panel reads about the screen every time it opens or repaints. */
export interface SettingsScreen {
  /** The configured area slug, or null on a screen provisioned before areas reached the client. */
  area: string | null;
  stopId: string | null;
  /** Unix ms, or null for a screen that does not expire. */
  expiresAt: number | null;
}

export interface SettingsDeps {
  strings: KioskStrings;
  locale: string;
  loadStops: () => Promise<ScreenStop[]>;
  screen: () => SettingsScreen;
  themePreference: () => ThemePreference;
  cycleTheme: () => void;
  /** Sends the pair to the screen's beacon; false when the socket cannot carry it now. */
  save: (stopId: string | null, area: string) => boolean;
  /** Forget the screen and start over; the panel is closed by then. */
  forget: () => void;
  onOpen?: () => void;
  onClose?: (restoreFocus: boolean) => void;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface SettingsHandle {
  element: HTMLElement;
  open(): void;
  /** `restoreFocus` false is for a phase change, where the thing that opened the panel is going away. */
  close(restoreFocus?: boolean): void;
  isOpen(): boolean;
  /** Re-reads the screen and the theme; called when either changed elsewhere. */
  paint(): void;
  destroy(): void;
}

/** The whole city first, then the 17 četvrti; which one is chosen is set on
 *  the element (paint), never re-rendered, so the list is built once. */
function areaOptions(s: KioskStrings): string {
  const option = (slug: string, name: string): string => `<option value="${escapeAttribute(slug)}">${escapeHtml(name)}</option>`;
  return [option(CITY_AREA.slug, s.settings.areaWhole), ...DISTRICTS.map((d) => option(d.slug, d.name))].join('');
}

function settingsMarkup(s: KioskStrings): string {
  return `<header class="k-basics-head">
      <div>
        <h2 id="k-settings-title" class="k-basics-title" tabindex="-1">${escapeHtml(s.settings.title)}</h2>
        <p class="k-basics-hint">${escapeHtml(s.settings.hint)}</p>
      </div>
      <button type="button" class="k-btn k-btn--ghost" data-testid="kiosk-settings-close">${escapeHtml(s.settings.close)}</button>
    </header>
    <div class="k-settings-rows">
      <section class="k-settings-row" data-row="area">
        <h3 class="k-settings-label">${escapeHtml(s.settings.area)}</h3>
        <label class="k-district-pick"><span class="k-visually-hidden">${escapeHtml(s.settings.area)}</span><select data-testid="settings-area">${areaOptions(s)}</select></label>
        <p class="k-setup-hint">${escapeHtml(s.settings.areaHint)}</p>
      </section>
      <section class="k-settings-row" data-row="stop">
        <h3 class="k-settings-label">${escapeHtml(s.settings.stop)}</h3>
        <label class="k-search"><span class="k-search-label">${escapeHtml(s.setup.search)}</span><input type="search" class="k-search-input" data-testid="settings-search" autocomplete="off" spellcheck="false"></label>
        <div class="k-stop-list" data-testid="settings-stop-list" role="group" aria-label="${escapeAttribute(s.settings.stop)}"></div>
        <p class="k-setup-count" data-testid="settings-stop-count" aria-live="polite"></p>
        <p class="k-setup-hint">${escapeHtml(s.settings.stopHint)}</p>
      </section>
      <section class="k-settings-row" data-row="theme">
        <h3 class="k-settings-label">${escapeHtml(s.settings.theme)}</h3>
        <button type="button" class="k-btn k-btn--ghost" data-testid="settings-theme"></button>
      </section>
      <section class="k-settings-row" data-row="screen">
        <h3 class="k-settings-label">${escapeHtml(s.settings.screen)}</h3>
        <p class="k-setup-hint" data-testid="settings-expiry"></p>
        <button type="button" class="k-btn k-btn--ghost" data-testid="settings-forget">${escapeHtml(s.settings.forget)}</button>
        <div class="k-settings-confirm" data-testid="settings-forget-confirm" hidden>
          <p class="k-setup-hint">${escapeHtml(s.settings.forgetAsk)}</p>
          <button type="button" class="k-btn k-btn--ghost" data-testid="settings-forget-yes">${escapeHtml(s.settings.forgetYes)}</button>
          <button type="button" class="k-btn k-btn--ghost" data-testid="settings-forget-no">${escapeHtml(s.settings.forgetNo)}</button>
        </div>
      </section>
    </div>
    <p class="k-setup-error" role="alert" data-testid="settings-error" hidden></p>
    <div class="k-setup-actions">
      <button type="button" class="k-btn k-btn--primary" data-testid="settings-save">${escapeHtml(s.settings.save)}</button>
    </div>`;
}

function stopMarkup(s: KioskStrings, locale: string, stop: RankedStop, checked: boolean): string {
  const routes = sortRouteIds(stop.routes).join(', ');
  const meta = [fill(s.setup.routesAt, { routes }), stop.distanceM !== null ? fmtDistance(locale, stop.distanceM) : ''].filter(Boolean).join(' · ');
  return `<label class="k-choice k-choice--stop"><input type="radio" name="settings-stop" value="${escapeAttribute(stop.id)}"${checked ? ' checked' : ''}><span class="k-choice-text"><span class="k-stop-name">${escapeHtml(stop.name)}</span><span class="k-stop-meta">${escapeHtml(meta)}</span></span></label>`;
}

function noStopMarkup(s: KioskStrings, checked: boolean): string {
  return `<label class="k-choice k-choice--stop"><input type="radio" name="settings-stop" value=""${checked ? ' checked' : ''}><span class="k-choice-text"><span class="k-stop-name">${escapeHtml(s.settings.stopNone)}</span></span></label>`;
}

export function mountSettings(host: HTMLElement, deps: SettingsDeps): SettingsHandle {
  const { strings: s, locale } = deps;
  const element = document.createElement('section');
  element.className = 'k-basics k-settings';
  element.dataset.testid = 'kiosk-settings-panel';
  element.hidden = true;
  element.setAttribute('aria-labelledby', 'k-settings-title');
  element.innerHTML = settingsMarkup(s);
  host.appendChild(element);
  const q = <T extends HTMLElement>(selector: string): T => element.querySelector<T>(selector)!;
  const heading = q('#k-settings-title');
  const areaSelect = q<HTMLSelectElement>('[data-testid=settings-area]');
  const search = q<HTMLInputElement>('[data-testid=settings-search]');
  const list = q('[data-testid=settings-stop-list]');
  const countEl = q('[data-testid=settings-stop-count]');
  const themeBtn = q<HTMLButtonElement>('[data-testid=settings-theme]');
  const expiryEl = q('[data-testid=settings-expiry]');
  const forgetBtn = q<HTMLButtonElement>('[data-testid=settings-forget]');
  const confirmBox = q('[data-testid=settings-forget-confirm]');
  const errorEl = q('[data-testid=settings-error]');
  const saveBtn = q<HTMLButtonElement>('[data-testid=settings-save]');

  let stops: ScreenStop[] | null = null;
  let stopsFailed = false;
  /** null is "Bez stajališta"; the panel edits a copy until Spremi is pressed. */
  let selectedStopId: string | null = null;
  let destroyed = false;
  let idle: unknown = null;

  function showError(text: string): void { errorEl.textContent = text; errorEl.hidden = false; }
  function clearError(): void { errorEl.hidden = true; errorEl.textContent = ''; }

  function area(): string {
    return areaSelect.value || CITY_AREA.slug;
  }
  /** Nearest the chosen četvrt's seat, or the city centre for the whole city. */
  function near(): { lon: number; lat: number } {
    return districtBySlug(area())?.seat ?? CITY_CENTRE;
  }

  function renderStops(): void {
    if (!stops) {
      list.innerHTML = '';
      countEl.textContent = stopsFailed ? '' : s.setup.loadingStops;
      return;
    }
    const query = search.value.trim();
    let ranked = rankStops(stops, { query, near: near(), limit: query ? SETTINGS_SEARCH_LIMIT : SETTINGS_STOP_LIMIT, dedupeNames: true });
    // The stop the screen already carries stays visible and checked, however
    // far it is from the area now chosen: a list that quietly drops it would
    // read as if the screen had none.
    if (selectedStopId !== null && !ranked.some((r) => r.id === selectedStopId)) {
      const current = stopById(stops, selectedStopId);
      if (current) ranked = [{ ...current, distanceM: null }, ...ranked].slice(0, query ? SETTINGS_SEARCH_LIMIT : SETTINGS_STOP_LIMIT);
    }
    list.innerHTML = noStopMarkup(s, selectedStopId === null)
      + (ranked.length > 0
        ? ranked.map((r) => stopMarkup(s, locale, r, r.id === selectedStopId)).join('')
        : `<p class="k-setup-empty">${escapeHtml(s.setup.noResults)}</p>`);
    countEl.textContent = ranked.length > 0 ? plural(locale, s.setup.results, ranked.length) : '';
  }

  async function ensureStops(): Promise<void> {
    if (stops) return;
    renderStops();
    try {
      stops = await deps.loadStops();
      stopsFailed = false;
      if (!destroyed) { clearError(); renderStops(); }
    } catch {
      stopsFailed = true;
      if (!destroyed) { showError(s.setup.errorStops); renderStops(); }
    }
  }

  function paintTheme(): void {
    themeBtn.textContent = fill(s.header.theme, { pref: s.header.themeWord[deps.themePreference()] });
  }
  function paintScreenRow(): void {
    const { expiresAt } = deps.screen();
    expiryEl.textContent = expiresAt === null ? s.settings.expiryNone : fill(s.settings.expiry, { time: clock(expiresAt) });
  }
  function hideConfirm(): void {
    confirmBox.hidden = true;
    forgetBtn.hidden = false;
  }

  function paint(): void {
    const screen = deps.screen();
    // An area the list does not offer (a venue screen provisioned with one
    // that is neither a četvrt nor the city) leaves the select empty; area()
    // then reads the whole city, which is what such a panel can honestly say.
    areaSelect.value = screen.area ?? CITY_AREA.slug;
    selectedStopId = screen.stopId;
    search.value = '';
    paintTheme();
    paintScreenRow();
    renderStops();
  }

  function disarmIdle(): void {
    if (idle === null) return;
    deps.clearTimeout(idle);
    idle = null;
  }
  function armIdle(): void {
    disarmIdle();
    idle = deps.setTimeout(() => { idle = null; close(); }, SETTINGS_IDLE_MS);
  }

  function open(): void {
    if (!element.hidden) return;
    clearError();
    hideConfirm();
    paint();
    element.hidden = false;
    deps.onOpen?.();
    heading.focus();
    armIdle();
    void ensureStops();
  }
  function close(restoreFocus = true): void {
    disarmIdle();
    if (element.hidden) return;
    element.hidden = true;
    hideConfirm();
    deps.onClose?.(restoreFocus);
  }

  function save(): void {
    clearError();
    if (!deps.save(selectedStopId, area())) { showError(s.status.offline); return; }
    close();
  }

  areaSelect.addEventListener('change', () => { armIdle(); renderStops(); });
  search.addEventListener('input', () => { armIdle(); renderStops(); });
  search.addEventListener('keydown', (event) => { if (event.key === 'Enter') event.preventDefault(); });
  list.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name !== 'settings-stop') return;
    selectedStopId = input.value || null;
    armIdle();
  });
  themeBtn.addEventListener('click', () => { deps.cycleTheme(); paintTheme(); armIdle(); });
  saveBtn.addEventListener('click', save);
  // Forgetting a screen is two presses, never one: the confirmation stands in
  // place of the button that opened it.
  forgetBtn.addEventListener('click', () => { forgetBtn.hidden = true; confirmBox.hidden = false; armIdle(); });
  q('[data-testid=settings-forget-no]').addEventListener('click', () => { hideConfirm(); armIdle(); });
  q('[data-testid=settings-forget-yes]').addEventListener('click', () => { close(false); deps.forget(); });
  q('[data-testid=kiosk-settings-close]').addEventListener('click', () => close());
  element.addEventListener('pointerdown', armIdle);
  element.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Escape') { close(); return; }
    armIdle();
  });

  return {
    element,
    open,
    close,
    isOpen: () => !element.hidden,
    paint: () => { if (!element.hidden) { paintTheme(); paintScreenRow(); } },
    destroy() {
      destroyed = true;
      disarmIdle();
      element.remove();
    },
  };
}
