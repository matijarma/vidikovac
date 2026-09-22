// The one field "Adresa ili stajalište" (brief §11, Setup): the start screen
// (kiosk/start.ts) and the settings' Mjesto row share it. Typing suggests tram
// and bus stops and streets (kiosk/places.ts over the stop table and the
// offline street index); picking a row turns it into the screen's place --
// a stop is the place as picked, a street goes through the derivation rule of
// seam S3 (the nearest tram stop within 400 m, else a bus stop within 300 m,
// else the street itself).
//
// Nothing is fetched when the field is mounted: the two lists load on the
// first focus or keystroke, so a start screen nobody touches costs nothing.
// Every delay goes through the injected setTimeout, so the kiosk's one timer
// seam (and a test's tick) drives it. The field never posts anything; its
// owner reads value() and unresolved() and decides.
import type { ScreenStop } from '../../../worker/protocol';
import { normalName } from '../../../shared/city/geo';
import { derivePlace, placeFromStop, type ScreenPlace } from '../../../shared/city/place';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { fmtDistance } from './format';
import { anchorOf, suggestPlaces, type PlaceSuggestion, type StreetGeo } from './places';
import { sortRouteIds } from './stops';
import { fill, type KioskStrings } from './strings';

/** Typing has to rest this long before the suggestions are worked out again. */
export const PLACE_DEBOUNCE_MS = 120;
/** Fewer characters than this suggest nothing. */
export const PLACE_MIN_QUERY = 2;
/** At most this many rows per query; the list shows six at a time and scrolls by whole rows. */
export const PLACE_SUGGESTION_LIMIT = 8;

export interface PlaceFieldDeps {
  strings: KioskStrings;
  locale: string;
  /** The stop table (core/screens.ts loadStops); called on the first focus or keystroke, never at mount. */
  loadStops: () => Promise<readonly ScreenStop[]>;
  /** The offline street index; a failure leaves the stops alone to suggest from. */
  loadStreets: () => Promise<readonly StreetGeo[]>;
  isTram: (routeId: string) => boolean;
  /** Rank nearest this point first and print each stop's distance from it (the settings' current place). */
  near?: { lon: number; lat: number };
  /** The place the field starts with (the settings' current place); none on the start screen. */
  initial?: ScreenPlace | null;
  /** Every change: the picked place, or null with whatever typed text has not become one ('' = empty field). */
  onChange: (place: ScreenPlace | null, unresolvedText: string) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface PlaceFieldHandle {
  element: HTMLElement;
  /** The picked place, or null for an empty field or text that matched nothing yet. */
  value(): ScreenPlace | null;
  /** Typed text that is not a place ('' when the field is empty or a place is picked). */
  unresolved(): string;
  /**
   * Waits for the lists and gives typed text one last chance: a full name that is exactly a
   * stop's or a street's (letter case and diacritics aside) becomes that place. False when the
   * lists could not be loaded, so nothing could be matched.
   */
  settle(): Promise<boolean>;
  focus(): void;
  destroy(): void;
}

let fieldCount = 0;

/** What a row reads as, and what the field says once the row is picked. */
function rowLabel(s: KioskStrings, row: PlaceSuggestion): string {
  switch (row.kind) {
    case 'stop': return row.stop.name;
    case 'street': return row.number ? `${row.street.name} ${row.number}` : row.street.name;
    case 'segment': return fill(s.setup.streetNear, { street: row.street.name, stop: row.stop.name });
  }
}

function routesText(s: KioskStrings, routes: readonly string[]): string {
  return routes.length > 0 ? fill(s.setup.routesAt, { routes: sortRouteIds(routes).join(', ') }) : '';
}

export function mountPlaceField(host: HTMLElement, deps: PlaceFieldDeps): PlaceFieldHandle {
  const { strings: s } = deps;
  const listId = `k-place-list-${++fieldCount}`;
  const element = document.createElement('div');
  element.className = 'k-place';
  element.innerHTML = `<label class="k-search">
      <span class="k-search-label">${escapeHtml(s.setup.place)}</span>
      <input type="search" class="k-search-input" data-testid="setup-place" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${escapeAttribute(listId)}" autocomplete="off" spellcheck="false">
    </label>
    <div class="k-suggest-box" hidden>
      <ul class="k-suggest" id="${escapeAttribute(listId)}" role="listbox" aria-label="${escapeAttribute(s.setup.place)}" data-testid="setup-suggestions" hidden></ul>
      <p class="k-suggest-status" role="status" hidden></p>
    </div>`;
  host.appendChild(element);
  const input = element.querySelector<HTMLInputElement>('input')!;
  const box = element.querySelector<HTMLElement>('.k-suggest-box')!;
  const list = element.querySelector<HTMLUListElement>('.k-suggest')!;
  const statusEl = element.querySelector<HTMLElement>('.k-suggest-status')!;

  let stops: readonly ScreenStop[] | null = null;
  let streets: readonly StreetGeo[] = [];
  let loading: Promise<boolean> | null = null;
  let failed = false;
  let place: ScreenPlace | null = deps.initial ?? null;
  /** The text a pick wrote into the field; editing it away from this undoes the pick. */
  let pickedText = '';
  let rows: PlaceSuggestion[] = [];
  let active = -1;
  let timer: unknown = null;
  let destroyed = false;

  if (place) {
    input.value = place.address ?? place.name;
    pickedText = input.value.trim();
  }

  const text = (): string => input.value.trim();
  const wantsList = (): boolean => !place && text().length >= PLACE_MIN_QUERY;
  const emit = (): void => deps.onChange(place, place ? '' : text());

  function showStatus(message: string): void {
    statusEl.textContent = message;
    statusEl.hidden = message === '';
    box.hidden = list.hidden && statusEl.hidden;
  }
  function close(): void {
    rows = [];
    active = -1;
    list.innerHTML = '';
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    showStatus('');
  }

  function rowMarkup(row: PlaceSuggestion, index: number): string {
    const meta = row.kind === 'stop'
      ? [routesText(s, row.stop.routes), deps.near && row.stop.distanceM !== null ? fmtDistance(deps.locale, row.stop.distanceM) : ''].filter(Boolean).join(' · ')
      : row.kind === 'segment' ? routesText(s, row.stop.routes) : '';
    return `<li class="k-suggest-row" id="${escapeAttribute(`${listId}-${index}`)}" role="option" aria-selected="false" data-testid="setup-suggestion" data-kind="${row.kind}" data-index="${index}">`
      + `<span class="k-suggest-name">${escapeHtml(rowLabel(s, row))}</span>`
      + (meta ? `<span class="k-suggest-meta">${escapeHtml(meta)}</span>` : '')
      + '</li>';
  }
  function render(next: PlaceSuggestion[]): void {
    rows = next;
    active = -1;
    list.innerHTML = next.map(rowMarkup).join('');
    list.hidden = next.length === 0;
    input.setAttribute('aria-expanded', next.length > 0 ? 'true' : 'false');
    input.removeAttribute('aria-activedescendant');
    showStatus(next.length > 0 ? '' : s.setup.noMatch);
  }

  /** The lists, once; a failed attempt is tried again on the next focus or keystroke, never by itself. */
  function ensureLoaded(): Promise<boolean> {
    if (stops) return Promise.resolve(true);
    if (loading) return loading;
    const attempt = (async (): Promise<boolean> => {
      try {
        const [loadedStops, loadedStreets] = await Promise.all([
          deps.loadStops(),
          deps.loadStreets().catch((): readonly StreetGeo[] => []),
        ]);
        stops = loadedStops;
        streets = loadedStreets;
        failed = false;
        return true;
      } catch {
        failed = true;
        return false;
      } finally {
        loading = null;
      }
    })();
    loading = attempt;
    void attempt.then(() => { if (!destroyed && wantsList()) refresh(); });
    return attempt;
  }

  function refresh(): void {
    if (!wantsList()) { close(); return; }
    if (!stops) {
      list.hidden = true;
      showStatus(failed && !loading ? s.setup.errorPlaces : s.setup.loadingPlaces);
      return;
    }
    render(suggestPlaces(text(), stops, streets, deps.near, PLACE_SUGGESTION_LIMIT));
  }
  function schedule(): void {
    if (timer !== null) deps.clearTimeout(timer);
    timer = deps.setTimeout(() => { timer = null; if (!destroyed) refresh(); }, PLACE_DEBOUNCE_MS);
  }

  function setActive(index: number): void {
    const options = [...list.querySelectorAll<HTMLElement>('[role=option]')];
    if (options.length === 0) return;
    active = (index + options.length) % options.length;
    options.forEach((option, i) => option.setAttribute('aria-selected', i === active ? 'true' : 'false'));
    input.setAttribute('aria-activedescendant', options[active].id);
    options[active].scrollIntoView?.({ block: 'nearest' });
  }

  /** A stop is the place as picked; a street or a stretch of one goes through the derivation rule. */
  function placeOf(row: PlaceSuggestion): ScreenPlace {
    return row.kind === 'stop' ? placeFromStop(row.stop, deps.isTram) : derivePlace(anchorOf(row), stops ?? [], deps.isTram);
  }
  function choose(next: ScreenPlace, label: string): void {
    place = next;
    input.value = label;
    pickedText = label.trim();
    close();
    emit();
  }
  function pick(index: number): void {
    const row = rows[index];
    if (row) choose(placeOf(row), rowLabel(s, row));
  }

  /** Typed text that is exactly one name: first among the suggestions, then the whole stop table and street index. */
  function exactMatch(): boolean {
    if (!stops) return false;
    const typed = text();
    const key = normalName(typed);
    if (!key) return false;
    const offered = suggestPlaces(typed, stops, streets, deps.near, PLACE_SUGGESTION_LIMIT);
    const row = offered.find((r) => normalName(rowLabel(s, r)) === key);
    if (row) { choose(placeOf(row), rowLabel(s, row)); return true; }
    const named = stops.filter((stop) => normalName(stop.name) === key);
    const stop = named.find((candidate) => candidate.routes.some(deps.isTram)) ?? named[0];
    if (stop) { choose(placeFromStop(stop, deps.isTram), stop.name); return true; }
    const street = streets.filter((candidate) => normalName(candidate.name) === key);
    if (street.length === 1) {
      const only: PlaceSuggestion = { kind: 'street', street: street[0] };
      choose(placeOf(only), rowLabel(s, only));
      return true;
    }
    return false;
  }

  async function settle(): Promise<boolean> {
    if (place || !text()) return true;
    const ok = await ensureLoaded();
    if (destroyed || !ok) return ok;
    if (place || !text()) return true;
    if (timer !== null) { deps.clearTimeout(timer); timer = null; }
    exactMatch();
    return true;
  }

  input.addEventListener('focus', () => { void ensureLoaded(); });
  input.addEventListener('input', () => {
    if (place && text() !== pickedText) place = null;
    emit();
    if (!text()) { if (timer !== null) { deps.clearTimeout(timer); timer = null; } close(); return; }
    void ensureLoaded();
    schedule();
  });
  input.addEventListener('keydown', (event) => {
    const open = !list.hidden && rows.length > 0;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!open) return;
      event.preventDefault();
      setActive(event.key === 'ArrowDown' ? active + 1 : active < 0 ? rows.length - 1 : active - 1);
    } else if (event.key === 'Enter') {
      // A highlighted row is picked here; otherwise Enter goes on to the form, whose
      // owner settles the field (an exact name still becomes its place).
      if (open && active >= 0) { event.preventDefault(); pick(active); } else if (!place && text()) { void settle(); }
    } else if (event.key === 'Escape') {
      if (!box.hidden) { event.preventDefault(); event.stopPropagation(); close(); }
    }
  });
  // A press on a row must not take the focus out of the field before the click lands.
  list.addEventListener('pointerdown', (event) => { event.preventDefault(); });
  list.addEventListener('mousedown', (event) => { event.preventDefault(); });
  list.addEventListener('click', (event) => {
    const option = (event.target as Element | null)?.closest<HTMLElement>('[role=option]');
    if (option) pick(Number(option.dataset.index));
  });
  element.addEventListener('focusout', (event) => {
    const next = (event as FocusEvent).relatedTarget as Node | null;
    if (!next || !element.contains(next)) close();
  });

  return {
    element,
    value: () => place,
    unresolved: () => (place ? '' : text()),
    settle,
    focus: () => input.focus(),
    destroy() {
      destroyed = true;
      if (timer !== null) deps.clearTimeout(timer);
      timer = null;
      element.remove();
    },
  };
}
