// The transport workspace behind the U pokretu layer: one persistent
// controller per page. The dashboard rebuilds its layer section on every
// poll and hands the same context back; this element is moved into the new
// section, never rebuilt, so the search text, the focus, the sheet's state,
// the selection, the followed vehicle and the MapLibre camera (map-slots.ts
// keeps the map itself) all survive a poll. Content re-renders set innerHTML
// on two stable containers and restore focus by id; every interaction is one
// delegated listener on the root, so no handler ever sits on a node the next
// render discards. The toolbar's controls are built once and updated in place.
//
// Nothing here is an arrival time. The lists say which routes have vehicles
// moving now and which way a vehicle faces when the model knows (R-P2,
// decision 5), and the sheet says in one sentence that ZET publishes none.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { publicItemKey, type PublicSelection, type ScreenStop } from '../core/contracts';
import { loadStops } from '../core/screens';
import type { LayerContext } from '../layers/types';
import type { CityMapHandle, MapCamera, MapLine, MapPoint, MapSelection, MapStatus, VehicleInfo } from '../map/city-map';
import { routeDelayMap } from '../motion/fixes';
import type { Network } from '../motion/network';
import { ROUTE_TYPE_BUS, ROUTE_TYPE_TRAM } from '../motion/schematic';
import { statusText } from '../panels/panel';
import { escapeAttribute as attr } from '../ui/dom/escape';
import { routeCatalogue, routeEntry, routeStopSequence, stopGroupById, stopGroupsFromCatalogue, stopGroupsFromNetwork } from './catalogue';
import { closureItems, countByRoute, plausibleDelays, runningRoutes, vehicleDirection, vehiclesOfModes, vehiclesOnRoute, zetNotices } from './detail';
import { searchTransport, type StopGroup } from './search';
import { tr, trPlural } from './strings';
import { closureDetailMarkup, closuresMarkup, delaysMarkup, overviewMarkup, resultsMarkup, routeDetailMarkup, statusLine, stopDetailMarkup, vehicleDetailMarkup, vehicleTitle, type DelayRow } from './view';

/** The one map slot the layer uses: the same id means the same map for the page's life (map-slots.ts). */
export const MAP_SLOT_ID = 'u-pokretu-map';
/** Symbol size on a public screen read from across a room. */
export const KIOSK_SYMBOL_SCALE = 1.35;

export interface WorkspaceInput {
  ctx: LayerContext;
  /** This poll's vehicle reports (evidence for the map's model, R-P2) and closure lines. */
  points: MapPoint[];
  lines: MapLine[];
}

export interface WorkspaceDeps {
  /** The stop catalogue for search without the network artefact; defaults to core/screens.ts's loadStops. */
  loadStops?: () => Promise<ScreenStop[]>;
}

export interface TransportWorkspace {
  readonly element: HTMLElement;
  render(input: WorkspaceInput): void;
}

const registry = new WeakMap<object, TransportWorkspace>();

/** The page's workspace, keyed by its map slots (one per page, stable for its life); a context without slots gets its own. */
export function workspaceFor(ctx: LayerContext, deps: WorkspaceDeps = {}): TransportWorkspace {
  const key = ctx.maps;
  if (!key) return createTransportWorkspace(deps);
  let workspace = registry.get(key);
  if (!workspace) {
    workspace = createTransportWorkspace(deps);
    registry.set(key, workspace);
  }
  return workspace;
}

let uid = 0;
const ALL_MODES: readonly number[] = [ROUTE_TYPE_TRAM, ROUTE_TYPE_BUS];
const safeId = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, '_');

/** A vehicle the model has not placed (no map yet, or none at all): listed by route and type, with no position of any kind. */
function unplaced(p: MapPoint): VehicleInfo {
  const type = p.type ?? -1;
  const short = p.routeId === undefined ? '' : routeEntry(p.routeId).short;
  return { id: p.id, routeId: p.routeId, short, kind: type === ROUTE_TYPE_TRAM ? 'tram' : type === ROUTE_TYPE_BUS ? 'bus' : 'other', type, lon: Number.NaN, lat: Number.NaN, bearing: null, confidence: 0, held: false, onShape: null };
}

function toMapSelection(pub: { kind: string; id: string } | null | undefined, groups: readonly StopGroup[] | null): MapSelection | null {
  if (!pub) return null;
  if (pub.kind === 'route') return { kind: 'route', id: pub.id };
  if (pub.kind === 'stop') {
    const group = groups ? stopGroupById(groups, pub.id) : undefined;
    return { kind: 'stop', id: pub.id, ids: group?.ids };
  }
  return null;
}

/** The bounded public form of a selection (worker/public-selection.ts): route and stop by id, a vehicle or a closure by its public item key. */
export function toPublic(sel: MapSelection | null): PublicSelection | null {
  if (!sel) return null;
  if (sel.kind === 'route' || sel.kind === 'stop') return { kind: sel.kind, id: sel.id };
  const module = sel.kind === 'vehicle' ? 'zet-rt' : 'prometnice';
  return { kind: 'item', id: publicItemKey(module, sel.id), module };
}

/** The selection a public form names on this page, or null when nothing here matches it: the domain overview then stands. */
export function fromPublic(pub: PublicSelection | null, ids: { vehicles: readonly string[]; closures: readonly string[] }, groups: readonly StopGroup[] | null): MapSelection | null {
  if (!pub) return null;
  if (pub.kind !== 'item') return toMapSelection(pub, groups);
  const pool = pub.module === 'zet-rt' ? ids.vehicles : pub.module === 'prometnice' ? ids.closures : [];
  const id = pool.find((candidate) => publicItemKey(pub.module, candidate) === pub.id);
  if (id === undefined) return null;
  return pub.module === 'zet-rt' ? { kind: 'vehicle', id } : { kind: 'closure', id };
}

export function createTransportWorkspace(deps: WorkspaceDeps = {}): TransportWorkspace {
  const id = `t${++uid}`;
  const ids = {
    search: `${id}-search`,
    results: `${id}-results`,
    body: `${id}-body`,
    option: (kind: 'route' | 'stop', value: string): string => `${id}-opt-${kind}-${safeId(value)}`,
  };
  const element = document.createElement('div');
  element.className = 'transport';
  // A stable id: the layer's persist slot names it for the page's reconciler (ui/dom/reconcile.ts, data-persist-for).
  element.id = `${id}-root`;
  element.dataset.testid = 'transport-workspace';
  element.dataset.persist = 'u-pokretu';
  element.dataset.status = 'loading';
  element.dataset.sheet = 'peek';
  // Built once. The controls below are updated in place on every render;
  // only the sheet body is ever re-set, with its focus restored by id.
  element.innerHTML = `
    <div class="transport-toolbar" data-testid="transport-toolbar">
      <div class="t-search">
        <label class="visually-hidden" for="${ids.search}" data-ref="search-label"></label>
        <input id="${ids.search}" class="t-search-input" type="search" role="combobox" aria-expanded="false" aria-controls="${ids.results}" aria-autocomplete="list" aria-describedby="${id}-hint" autocomplete="off" spellcheck="false" data-testid="transport-search">
        <button type="button" class="t-search-clear" id="${id}-clear" data-action="clear-search" hidden>&#215;</button>
        <p class="visually-hidden" id="${id}-hint" data-ref="search-hint"></p>
      </div>
      <div class="t-modes" role="group" data-ref="modes">
        <button type="button" class="t-toggle" id="${id}-mode-tram" data-action="toggle-mode" data-mode="${ROUTE_TYPE_TRAM}" aria-pressed="true"></button>
        <button type="button" class="t-toggle" id="${id}-mode-bus" data-action="toggle-mode" data-mode="${ROUTE_TYPE_BUS}" aria-pressed="true"></button>
        <button type="button" class="t-toggle" id="${id}-closures" data-action="toggle-closures" aria-pressed="true"></button>
      </div>
    </div>
    <div class="transport-body">
      <div class="transport-map" id="u-pokretu-map" data-testid="transport-map">
        <p class="t-map-status" role="status" data-testid="map-status" hidden></p>
        <div class="t-map-tools" role="group" data-ref="tools">
          <button type="button" class="btn-ghost t-action" id="${id}-fit-city" data-action="fit-city"></button>
          <button type="button" class="btn-ghost t-action" id="u-pokretu-map-full" data-testid="map-full-toggle" data-action="toggle-full" hidden></button>
        </div>
      </div>
      <aside class="transport-sheet" data-testid="transport-sheet">
        <div class="t-sheet-head">
          <p class="t-peek" data-testid="transport-peek"></p>
          <button type="button" class="btn-ghost t-sheet-toggle" id="${id}-sheet" data-action="toggle-sheet" aria-expanded="false" aria-controls="${ids.body}"></button>
        </div>
        <div class="t-sheet-body" id="${ids.body}" data-testid="transport-detail"></div>
      </aside>
    </div>
    <p class="t-note" data-testid="transport-note"></p>`;
  const q = <T extends Element>(selector: string): T => element.querySelector<T>(selector)!;
  const toolbar = q<HTMLElement>('.transport-toolbar');
  const searchInput = q<HTMLInputElement>(`#${ids.search}`);
  const searchLabel = q<HTMLElement>('[data-ref=search-label]');
  const searchHint = q<HTMLElement>('[data-ref=search-hint]');
  const clearButton = q<HTMLButtonElement>(`#${id}-clear`);
  const modeButtons: Record<number, HTMLButtonElement> = { [ROUTE_TYPE_TRAM]: q(`#${id}-mode-tram`), [ROUTE_TYPE_BUS]: q(`#${id}-mode-bus`) };
  const modesGroup = q<HTMLElement>('[data-ref=modes]');
  const closuresButton = q<HTMLButtonElement>(`#${id}-closures`);
  const mapRegion = q<HTMLElement>('.transport-map');
  const statusEl = q<HTMLElement>('[data-testid=map-status]');
  const tools = q<HTMLElement>('[data-ref=tools]');
  const fitCityButton = q<HTMLButtonElement>(`#${id}-fit-city`);
  const fullButton = q<HTMLButtonElement>('#u-pokretu-map-full');
  const sheet = q<HTMLElement>('.transport-sheet');
  const peek = q<HTMLElement>('[data-testid=transport-peek]');
  const sheetToggle = q<HTMLButtonElement>(`#${id}-sheet`);
  const body = q<HTMLElement>(`#${ids.body}`);
  const note = q<HTMLElement>('[data-testid=transport-note]');

  // --- State that survives every poll -------------------------------------
  let input: WorkspaceInput | null = null;
  let query = '';
  let activeOption: string | null = null;
  let selection: MapSelection | null = null;
  let following: string | null = null;
  // Trams first, the approved opening focus (as the locked kiosk's R-P1); buses join with one toggle.
  const modes = new Set<number>([ROUTE_TYPE_TRAM]);
  let closuresVisible = true;
  let sheetOpen = false;
  let delaysOpen = false;
  let camera: MapCamera | null = null;
  let status: MapStatus = 'loading';
  let net: Network | null = null;
  let groups: StopGroup[] | null = null;
  let catalogueRequested = false;
  let handle: CityMapHandle | null = null;
  /** The public selection the page last reported (ctx.view) and the one this workspace last relayed: only a
   *  change the page made itself (history, a paired screen) is applied, and a page that never echoes the relay
   *  back (no view store, a unit context) can never clear a local selection on the next poll. */
  let viewKey = 'null';
  let relayedKey = 'null';

  // --- Derived, per render ----------------------------------------------------
  function ctx(): LayerContext {
    if (!input) throw new Error('transport workspace: render() first');
    return input.ctx;
  }
  const kiosk = (): boolean => ctx().kiosk === true;
  /** null while every mode is on: the map then also draws vehicles of a type nobody knows. */
  const modesArg = (): ReadonlySet<number> | null => (ALL_MODES.every((m) => modes.has(m)) ? null : new Set(modes));
  const delays = (): Map<string, number> => plausibleDelays(routeDelayMap(ctx().snapshots['zet-rt']));

  /** Every vehicle the model has placed, or, before that and without a map, the reports listed by route alone.
   *  The mode toggle filters what the overview counts and the map draws; a route or stop someone asks about
   *  answers for its own vehicles whatever the toggle says. */
  function vehiclesNow(): VehicleInfo[] {
    const placed = handle?.vehicles?.();
    const usePlaced = placed !== undefined && (placed.length > 0 || status !== 'loading');
    return usePlaced ? placed : (input?.points ?? []).filter((p) => p.at !== undefined).map(unplaced);
  }

  /** The stop catalogue for search when the network artefact is not in (yet, or at all); never on the lightweight path. */
  function ensureCatalogue(): void {
    if (groups || catalogueRequested || ctx().lightweight) return;
    catalogueRequested = true;
    (deps.loadStops ?? (() => loadStops()))().then(
      (stops) => {
        if (!groups) {
          groups = stopGroupsFromCatalogue(stops);
          renderSheet();
        }
      },
      () => {
        catalogueRequested = false;
      },
    );
  }

  const groupFor = (stopId: string): StopGroup | undefined => (groups ? stopGroupById(groups, stopId) : undefined);

  /** Route and stop reach the paired screen and the history (core/view-store.ts); a vehicle or a closure clears them there. */
  function relay(sel: MapSelection | null): void {
    const pub = toPublic(sel);
    const key = JSON.stringify(pub);
    if (key === relayedKey) return;
    relayedKey = key;
    ctx().navigate?.('u-pokretu', pub);
  }

  /** The one place the selection changes: state, the map, the paired screen, then the sheet. */
  function setSelection(next: MapSelection | null, opts: { fit?: boolean; relay?: boolean; open?: boolean } = {}): void {
    if (next?.kind === 'stop' && !next.ids) next = { ...next, ids: groupFor(next.id)?.ids };
    selection = next;
    if (next?.kind !== 'vehicle' && following) {
      following = null;
      handle?.follow?.(null);
    }
    handle?.select?.(next, { fit: opts.fit });
    if (opts.relay !== false) relay(next);
    if (opts.open) sheetOpen = true;
    if (query) {
      query = '';
      searchInput.value = '';
    }
    activeOption = null;
    renderSheet();
  }

  function setFollowing(vehicleId: string | null): void {
    following = vehicleId;
    if (vehicleId) {
      selection = { kind: 'vehicle', id: vehicleId };
      relay(selection);
    }
    handle?.follow?.(vehicleId);
    renderSheet();
  }

  // --- Rendering ---------------------------------------------------------------
  /** The controls' words and states, updated in place: the locale may have changed, the toggles may have. */
  function renderChrome(): void {
    const c = ctx();
    const i18n = c.i18n;
    const k = kiosk();
    element.dataset.kiosk = k ? 'true' : 'false';
    toolbar.hidden = k;
    searchLabel.textContent = tr(i18n, 'searchLabel');
    searchInput.placeholder = tr(i18n, 'search');
    searchHint.textContent = tr(i18n, 'searchHint');
    clearButton.setAttribute('aria-label', tr(i18n, 'clearSearch'));
    clearButton.hidden = query === '';
    modesGroup.setAttribute('aria-label', tr(i18n, 'modesLabel'));
    modeButtons[ROUTE_TYPE_TRAM].textContent = tr(i18n, 'trams');
    modeButtons[ROUTE_TYPE_BUS].textContent = tr(i18n, 'buses');
    for (const mode of ALL_MODES) modeButtons[mode].setAttribute('aria-pressed', modes.has(mode) ? 'true' : 'false');
    closuresButton.textContent = tr(i18n, 'showClosures');
    closuresButton.setAttribute('aria-pressed', closuresVisible ? 'true' : 'false');
    tools.setAttribute('aria-label', tr(i18n, 'toolsLabel'));
    tools.hidden = k;
    fitCityButton.textContent = tr(i18n, 'fitCity');
    const mapView = c.mapView;
    fullButton.hidden = !mapView || k;
    if (mapView) fullButton.textContent = i18n.t(mapView.full ? 'panels.mapCollapse' : 'panels.mapExpand');
    sheet.setAttribute('aria-label', tr(i18n, 'sheetLabel'));
    sheetToggle.hidden = k;
    sheetToggle.textContent = tr(i18n, sheetOpen ? 'collapse' : 'details');
    sheetToggle.setAttribute('aria-expanded', sheetOpen ? 'true' : 'false');
    element.dataset.sheet = sheetOpen || k ? 'open' : 'peek';
    note.textContent = i18n.t('motion.note');
  }

  function renderStatus(): void {
    const line = statusLine(ctx().i18n, status);
    element.dataset.status = status;
    statusEl.hidden = line === null;
    statusEl.textContent = line ?? '';
  }

  /** Sets the body, keeping focus on the control of the same id when the render replaced it. */
  function swapBody(html: string): void {
    const active = document.activeElement;
    const focusId = active instanceof HTMLElement && body.contains(active) ? active.id : '';
    body.innerHTML = html;
    if (focusId) document.getElementById(focusId)?.focus();
  }

  /** The sheet: search results while typing, the selection's detail, else the overview; and the peek line above it. */
  function renderSheet(): void {
    if (!input) return;
    const i18n = ctx().i18n;
    const vehicles = vehiclesNow();
    const shown = vehiclesOfModes(vehicles, modesArg());
    let html: string;
    let peekLine: string;
    if (query) {
      const results = searchTransport(query, routeCatalogue(), groups ?? []);
      const total = results.routes.length + results.stops.length;
      if (activeOption && !results.routes.some((r) => ids.option('route', r.id) === activeOption) && !results.stops.some((s) => ids.option('stop', s.id) === activeOption)) activeOption = null;
      html = resultsMarkup(i18n, { query, results, counts: countByRoute(vehicles), delays: delays(), routeOf: routeEntry, active: activeOption, ids: { list: ids.results, option: ids.option } });
      peekLine = trPlural(i18n, 'resultsCount', total);
      searchInput.setAttribute('aria-expanded', total > 0 ? 'true' : 'false');
    } else {
      searchInput.setAttribute('aria-expanded', 'false');
      if (selection?.kind === 'stop' && !groups) ensureCatalogue();
      const detail = selection ? detailMarkup(selection, vehicles) : null;
      if (selection && !detail) {
        // Gone between polls (an evicted vehicle, a lifted closure): the selection ends with it.
        selection = null;
        handle?.select?.(null);
        relay(null);
      }
      [html, peekLine] = detail ?? [overview(shown), overviewPeek(shown)];
    }
    if (query && activeOption) searchInput.setAttribute('aria-activedescendant', activeOption);
    else searchInput.removeAttribute('aria-activedescendant');
    peek.textContent = following && selection?.kind === 'vehicle' ? tr(i18n, 'peekFollowing', { title: peekLine }) : peekLine;
    swapBody(html);
    renderChrome();
  }

  function sourceLine(snapshot: ModuleSnapshot | undefined): string | null {
    const c = ctx();
    return snapshot && snapshot.status !== 'live' ? statusText(snapshot, c.i18n, c.now) : null;
  }

  function overview(vehicles: readonly VehicleInfo[]): string {
    const c = ctx();
    const zet = c.snapshots['zet-rt'];
    const closures = c.snapshots.prometnice;
    const screenStop = c.screen?.stop ?? null;
    const group = screenStop ? groupFor(screenStop.id) : undefined;
    const main = overviewMarkup(c.i18n, {
      routes: runningRoutes(vehicles, delays(), c.i18n),
      total: vehicles.length,
      loading: !zet,
      sourceStatus: sourceLine(zet),
      screenStop: screenStop ? { id: screenStop.id, name: screenStop.name, routes: group?.routes ?? screenStop.routes } : null,
      routeOf: routeEntry,
      kiosk: kiosk(),
    });
    const worstFirst: DelayRow[] = [...delays()]
      .map(([routeId, delay]) => ({ routeId, delay }))
      .sort((a, b) => Math.abs(b.delay) - Math.abs(a.delay) || a.routeId.localeCompare(b.routeId, 'hr', { numeric: true }));
    return main + delaysMarkup(c.i18n, worstFirst, routeEntry, delaysOpen) + closuresMarkup(c.i18n, closureItems(closures), zetNotices(c.snapshots.dogadanja), sourceLine(closures), null, !kiosk());
  }

  function overviewPeek(vehicles: readonly VehicleInfo[]): string {
    const c = ctx();
    if (!c.snapshots['zet-rt']) return tr(c.i18n, 'peekLoading');
    return vehicles.length > 0 ? trPlural(c.i18n, 'vehiclesNow', vehicles.length) : tr(c.i18n, 'noRunning');
  }

  /** The selection's detail and its one-line summary; null once the thing has gone. */
  function detailMarkup(sel: MapSelection, vehicles: readonly VehicleInfo[]): [string, string] | null {
    const c = ctx();
    const i18n = c.i18n;
    const k = kiosk();
    switch (sel.kind) {
      case 'route': {
        const route = routeEntry(sel.id);
        const onRoute = vehiclesOnRoute(vehicles, sel.id);
        const directions = new Map(onRoute.map((v): [string, string] => [v.id, vehicleDirection(i18n, net, v)]));
        const html = routeDetailMarkup(i18n, { route, vehicles: onRoute, directions, delay: delays().get(sel.id), stops: net ? routeStopSequence(net, sel.id) : [], hasNetwork: net !== null, kiosk: k });
        return [html, route.long ? `${route.short} · ${route.long}` : tr(i18n, 'routeTitle', { short: route.short })];
      }
      case 'stop': {
        const screen = c.screen?.stop;
        const group: StopGroup = groupFor(sel.id) ?? {
          id: sel.id,
          ids: sel.ids ? [...sel.ids] : [sel.id],
          name: screen?.id === sel.id ? screen.name : sel.id,
          lon: Number.NaN,
          lat: Number.NaN,
          routes: screen?.id === sel.id ? [...screen.routes] : [],
        };
        const html = stopDetailMarkup(i18n, { stop: group, routes: group.routes.map(routeEntry), counts: countByRoute(vehicles), delays: delays(), isScreenStop: screen !== undefined && group.ids.includes(screen.id), kiosk: k });
        return [html, `${tr(i18n, 'stop')} ${group.name}`];
      }
      case 'vehicle': {
        const v = vehicles.find((x) => x.id === sel.id);
        if (!v) return null;
        const direction = vehicleDirection(i18n, net, v);
        const html = vehicleDetailMarkup(i18n, {
          vehicle: v,
          route: v.routeId === undefined ? null : routeEntry(v.routeId),
          direction,
          delay: v.routeId === undefined ? undefined : delays().get(v.routeId),
          following: following === v.id,
          kiosk: k,
        });
        return [html, `${vehicleTitle(i18n, v)} · ${direction}`];
      }
      case 'closure': {
        const item = closureItems(c.snapshots.prometnice).find((x) => x.id === sel.id);
        if (!item) return null;
        return [closureDetailMarkup(i18n, item, k), item.title];
      }
    }
  }

  // --- Events: one delegated listener each, on stable nodes -----------------------
  const optionIds = (): string[] => [...body.querySelectorAll<HTMLElement>('[role=option]')].map((el) => el.id);

  /** After a choice the detail replaces the list under the finger or the caret: focus lands on its heading. */
  function focusDetail(): void {
    const heading = body.querySelector<HTMLElement>('h3');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus();
  }

  function choose(kind: string | undefined, value: string): void {
    if (kind === 'select-route') setSelection({ kind: 'route', id: value }, { fit: true, open: true });
    else if (kind === 'select-stop') setSelection({ kind: 'stop', id: value }, { fit: true, open: true });
    else if (kind === 'select-vehicle') setSelection({ kind: 'vehicle', id: value }, { fit: true, open: true });
    else if (kind === 'select-closure') setSelection({ kind: 'closure', id: value }, { fit: true, open: true });
    else return;
    focusDetail();
  }

  function clearSearch(): void {
    query = '';
    searchInput.value = '';
    activeOption = null;
    renderSheet();
  }

  element.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null;
    if (!target || !input) return;
    const action = target.dataset.action;
    const value = target.dataset.id ?? '';
    if (action?.startsWith('select-')) {
      choose(action, value);
      return;
    }
    switch (action) {
      case 'clear-selection':
        setSelection(null);
        break;
      case 'follow':
        setFollowing(value);
        break;
      case 'unfollow':
        setFollowing(null);
        break;
      case 'fit-selection':
        handle?.fit?.('selection');
        break;
      case 'fit-city':
        handle?.fit?.('city');
        break;
      case 'toggle-mode': {
        const mode = Number(target.dataset.mode);
        if (modes.has(mode)) {
          if (modes.size > 1) modes.delete(mode); // one mode always stays on: an empty map answers nothing
        } else modes.add(mode);
        handle?.setModes?.(modesArg());
        renderSheet();
        break;
      }
      case 'toggle-closures':
        closuresVisible = !closuresVisible;
        handle?.setClosuresVisible?.(closuresVisible);
        renderChrome();
        break;
      case 'toggle-sheet':
        sheetOpen = !sheetOpen;
        renderChrome();
        break;
      case 'toggle-delays':
        delaysOpen = !delaysOpen;
        renderSheet();
        break;
      case 'toggle-full':
        ctx().mapView?.toggle();
        break;
      case 'clear-search':
        clearSearch();
        searchInput.focus();
        break;
    }
  });

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    activeOption = null;
    if (query) {
      ensureCatalogue();
      sheetOpen = true;
    }
    renderSheet();
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const options = optionIds();
      if (options.length === 0) return;
      event.preventDefault();
      const index = activeOption ? options.indexOf(activeOption) : -1;
      const next = event.key === 'ArrowDown' ? (index + 1) % options.length : (index - 1 + options.length) % options.length;
      activeOption = options[next] ?? null;
      renderSheet();
    } else if (event.key === 'Enter') {
      const chosen = activeOption ?? optionIds()[0];
      const el = chosen ? document.getElementById(chosen) : null;
      if (!el) return;
      event.preventDefault();
      choose(el.dataset.action, el.dataset.id ?? '');
    } else if (event.key === 'Escape' && (query || selection)) {
      event.preventDefault();
      event.stopPropagation();
      if (query) clearSearch();
      else setSelection(null);
    }
  });

  // Escape anywhere in the sheet clears the selection; the map handles its own (city-map.ts) and reports through onSelect.
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.target === searchInput || !selection) return;
    if (event.target instanceof Node && mapRegion.contains(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    setSelection(null);
  });

  // --- The map slot -----------------------------------------------------------------
  /** Asks the page's slots for the one map, moves its container in and binds the handle they hand back (a new one after a kiosk's destroy()). */
  function syncMap(c: LayerContext, points: MapPoint[], lines: MapLine[]): void {
    const i18n = c.i18n;
    const reports = points.filter((p) => p.at !== undefined).length;
    const label = `${tr(i18n, 'mapRegion')}: ${i18n.t('panels.vehiclesCount', { count: reports })}, ${i18n.t('panels.closuresCount', { count: lines.length })}`;
    const canvas =
      c.maps?.slot({
        id: MAP_SLOT_ID,
        className: 'map-canvas t-map-canvas',
        testid: 'map-canvas',
        ariaLabel: label,
        points,
        lines,
        reducedMotion: c.reducedMotion,
        theme: c.screen?.theme,
        locale: i18n.getLocale(),
        stop: c.screen?.stop ?? null,
        selection,
        follow: following,
        modes: modesArg(),
        closures: closuresVisible,
        interactive: !kiosk(),
        symbolScale: kiosk() ? KIOSK_SYMBOL_SCALE : 1,
        center: camera?.center,
        zoom: camera?.zoom,
        onSelect: (sel) => setSelection(sel),
        onStatus: (next) => {
          status = next;
          renderStatus();
          renderSheet();
        },
        onNetwork: (network) => {
          net = network;
          if (network) groups = stopGroupsFromNetwork(network);
          renderSheet();
        },
        onUserMove: (cam) => {
          camera = cam;
          if (following) {
            following = null;
            renderSheet();
          }
        },
      }) ?? null;
    if (canvas) {
      if (canvas.parentElement !== mapRegion) mapRegion.insertBefore(canvas, mapRegion.firstChild);
      const next = c.maps?.handle(MAP_SLOT_ID) ?? null;
      if (next !== handle) {
        handle = next;
        status = handle?.status?.() ?? 'loading';
        const network = handle?.network?.() ?? null;
        if (network && network !== net) {
          net = network;
          groups = stopGroupsFromNetwork(network);
        }
      }
    } else {
      // No slot (no factory on this page, or a browser without a map): the route and stop alternative stands alone;
      // the stop catalogue is fetched on the first keystroke, never ahead of a search.
      handle = null;
      status = 'unavailable';
    }
    renderStatus();
  }

  function render(next: WorkspaceInput): void {
    input = next;
    const c = next.ctx;
    // A selection the page navigated to (history, a paired screen's relay): a
    // route or stop by id, a vehicle or closure by public item key, applied
    // once per change and fitted; one that names nothing on this page clears.
    const pub = c.view?.selection ?? null;
    const key = JSON.stringify(pub);
    let changed = false;
    if (key !== viewKey) {
      viewKey = key;
      // The page reports something new; unless it is the echo of this workspace's own relay, it is the person's
      // history or a paired screen speaking, and it wins.
      if (key !== relayedKey) {
        const vehicles = next.points.filter((p) => p.at !== undefined).map((p) => p.id);
        const closures = closureItems(c.snapshots.prometnice).map((item) => item.id);
        const incoming = fromPublic(pub, { vehicles, closures }, groups);
        if (incoming || selection) {
          selection = incoming;
          following = null;
          changed = true;
        }
        relayedKey = key;
      }
    }
    syncMap(c, next.points, next.lines);
    // An outage is no evidence of motion: the map holds every vehicle where it is until the feed is live again.
    handle?.setFeedState?.(c.snapshots['zet-rt']?.status ?? 'down');
    if (changed) handle?.select?.(selection, { fit: selection !== null });
    renderSheet();
  }

  return { element, render };
}
