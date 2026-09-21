// Postavke: the screen's own settings, an overlay over the stage like Osnovno
// (Escape, a close button, 90 s idle), never over a granted session. Four
// sections: the area the map frames, the stop it centres on, the theme, and
// the screen itself (when it expires, and the one way to forget it).
//
// The area and the stop are one saved pair: pressing Spremi sends a single
// `screen-set` frame over the beacon socket, and the DO's answer re-frames the
// wall through applyScreen() -- nothing here paints the map or the header
// itself. The panel waits for that answer: it closes when the screen it asked
// for arrives (applied), and stays open with a sentence when the DO refuses or
// drops the frame (refused). The theme is the header button's own cycle and
// applies at once.
import type { ScreenStop } from '../core/contracts';
import { CITY_AREA } from '../../../worker/pairing/areas';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import type { ThemePreference } from '../ui/theme';
import { DISTRICTS, districtBySlug } from './districts';
import { clock, fmtDistance, sameZagrebDay, weekdayDayMonth } from './format';
import { rankStops, sortRouteIds, stopById, type RankedStop } from './stops';
import { fill, plural, type KioskStrings } from './strings';

/** Untouched for this long, the panel closes itself and the screen returns to the invitation. */
export const SETTINGS_IDLE_MS = 90_000;
/** How long a save waits for the DO's answer before giving the button back:
 *  the same eight seconds the phone gives a presentation receipt
 *  (docs/kiosk.md). Nothing is re-sent and nothing is forgotten -- an answer
 *  that arrives after it is still the DO's truth. */
export const SAVE_TIMEOUT_MS = 8_000;
/** Stops offered before a search narrows them, and after one. */
const SETTINGS_STOP_LIMIT = 8;
const SETTINGS_SEARCH_LIMIT = 12;
/** Trg bana Jelačića: where "nearest first" starts from when the area is the whole city. */
const CITY_CENTRE = { lon: 15.97726, lat: 45.81286 };
/** The DO's answers to a `screen-set` (worker/do/beacon-do.ts setScreen); any
 *  other error word on the socket belongs to something else and is ignored. */
const SCREEN_SET_ERRORS = ['bad-area', 'bad-stop', 'screen-set-rate'] as const;

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
  /** The screen's own clock, so the expiry line can tell today from tomorrow. */
  now: () => number;
  cycleTheme: () => void;
  /** Sends the pair to the screen's beacon; false when the socket cannot carry it now. */
  save: (stopId: string | null, area: string) => boolean;
  /** Forget the screen and start over; the panel is closed by then. */
  forget: () => void;
  onOpen?: () => void;
  onClose?: (restoreFocus: boolean) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface SettingsHandle {
  element: HTMLElement;
  open(): void;
  /** `restoreFocus` false is for a phase change, where the thing that opened the panel is going away. */
  close(restoreFocus?: boolean): void;
  isOpen(): boolean;
  /** Re-reads the theme word and the expiry line while the panel is open;
   *  the area and the stop are the person's own unsaved edit and are read
   *  only when the panel opens. */
  paint(): void;
  /** A screen arrived from the DO: if it is the pair this panel asked for, the
   *  save landed and the panel is done -- late as well as in time, since the
   *  DO's answer is the truth whatever the panel already said. Any other
   *  screen is someone else's. */
  applied(): void;
  /** The DO answered the frame this panel sent with a refusal or a drop. */
  refused(error: string): void;
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
  /** The pair last sent to the DO; kept past a timeout so a late answer is still recognised as this panel's. */
  let requested: { stopId: string | null; area: string } | null = null;
  /** Whether that pair is still being waited for; one save is in flight at a time. */
  let pending = false;
  let saveTimer: unknown = null;
  let dirty = false;
  let drafted = false;

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
  /** A temporary screen is good for 24 hours, so the end of a screen made at
   *  23:40 is 23:40 TOMORROW -- and "Vrijedi do 23:43" on a panel opened at
   *  23:43 reads as "it is over now". A clock alone is only honest while the
   *  end falls on today; past midnight the day goes with it. */
  function paintScreenRow(): void {
    const { expiresAt } = deps.screen();
    if (expiresAt === null) { expiryEl.textContent = s.settings.expiryNone; return; }
    const time = clock(expiresAt);
    const when = sameZagrebDay(expiresAt, deps.now()) ? time : `${weekdayDayMonth(locale, expiresAt)} ${time}`;
    expiryEl.textContent = fill(s.settings.expiry, { time: when });
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
    if (!drafted || !dirty) {
      areaSelect.value = screen.area ?? CITY_AREA.slug;
      selectedStopId = screen.stopId;
      search.value = '';
      drafted = true;
    }
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
    endSave();
    hideConfirm();
    deps.onClose?.(restoreFocus);
  }

  /** Stop waiting: the button comes back, the pair does not go away. */
  function stopWaiting(): void {
    pending = false;
    if (saveTimer !== null) { deps.clearTimeout(saveTimer); saveTimer = null; }
    saveBtn.disabled = false;
    saveBtn.textContent = s.settings.save;
  }
  function endSave(): void {
    requested = null;
    stopWaiting();
  }
  function save(): void {
    if (pending) return;
    clearError();
    const next = { stopId: selectedStopId, area: area() };
    if (!deps.save(next.stopId, next.area)) { showError(s.settings.saveOffline); return; }
    requested = next;
    pending = true;
    saveBtn.disabled = true;
    saveBtn.textContent = s.settings.saving;
    // A screen whose socket died between the frame and the answer must not sit
    // on a disabled button until the idle close: past SAVE_TIMEOUT_MS the panel
    // says the change did not reach the server and lets it be pressed again.
    // The frame is never re-sent from here -- one press is one `screen-set`.
    saveTimer = deps.setTimeout(() => {
      saveTimer = null;
      if (!pending) return;
      stopWaiting();
      showError(s.settings.saveOffline);
    }, SAVE_TIMEOUT_MS);
  }
  function applied(): void {
    if (!requested) return;
    const current = deps.screen();
    if (current.area !== requested.area || current.stopId !== requested.stopId) return;
    dirty = false;
    endSave();
    close();
  }
  function refused(error: string): void {
    if (!pending || !(SCREEN_SET_ERRORS as readonly string[]).includes(error)) return;
    endSave();
    showError(error === 'screen-set-rate' ? s.settings.saveBusy : s.settings.saveRefused);
    armIdle();
  }

  areaSelect.addEventListener('change', () => { dirty=true; armIdle(); renderStops(); });
  search.addEventListener('input', () => { dirty=true; armIdle(); renderStops(); });
  search.addEventListener('keydown', (event) => { if (event.key === 'Enter') event.preventDefault(); });
  list.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name !== 'settings-stop') return;
    selectedStopId = input.value || null;
    dirty = true;
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
    if (event.key === 'Escape') { close(); return; }
    armIdle();
  });

  return {
    element,
    open,
    close,
    isOpen: () => !element.hidden,
    paint: () => { if (!element.hidden) { paintTheme(); paintScreenRow(); } },
    applied,
    refused,
    destroy() {
      destroyed = true;
      disarmIdle();
      if (saveTimer !== null) { deps.clearTimeout(saveTimer); saveTimer = null; }
      element.remove();
    },
  };
}
