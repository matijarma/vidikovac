// The transport workspace behind the U pokretu layer: one persistent
// controller per page. The dashboard rebuilds its layer section on every
// poll and hands the same context back; this element is moved into the new
// section, never rebuilt, so the search text, the focus, the sheet's detent,
// the selection, the followed vehicle and the MapLibre camera (map-slots.ts
// keeps the map itself) all survive a poll. Content re-renders set innerHTML
// on two stable containers and restore focus by id; every interaction is one
// delegated listener on the root, so no handler ever sits on a node the next
// render discards. The chrome (chips on the map, the sheet head, the search)
// is built once and updated in place.
//
// On the phone the workspace is a stage: the map fills it and the sheet
// floats over its lower part at one of three detents (transport/sheet.ts).
// The desk and the landscape phone show the sheet as a column with no
// detents; the kiosk contract (data-kiosk) keeps an open, still sheet.
//
// A tapped stop first says what comes next. Those times are estimates, not
// promises: a trip a tracked vehicle carries is timed from the schedule plus
// ZET's own reported delay, refined by the twin's next-stop ETA, and every
// other trip keeps its timetable moment. Each row says which of the two it
// is -- live or by the timetable -- and the arithmetic itself is
// shared/city/arrivals.ts's, never this file's.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { publicItemKey, type PublicSelection, type ScreenStop } from '../core/contracts';
import type { MapMode } from '../core/map-mode-store';
import { loadStops } from '../core/screens';
import type { LayerContext } from '../layers/types';
import type { CityMapHandle, FitPadding, MapCamera, MapLine, MapPoint, MapSelection, MapStatus, VehicleInfo } from '../map/city-map';
import { routeDelayMap } from '../motion/fixes';
import type { Network } from '../../../shared/motion/network';
import { ROUTE_TYPE_BUS, ROUTE_TYPE_TRAM } from '../motion/schematic';
import { statusText } from '../panels/panel';
import { escapeHtml as esc } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import { discover, dynamicPlaces, clusterPlaces, CATEGORY_SOURCE, GROUP_SOURCES, type CityGroup, type Discovery } from '../city/discovery';
import { ct, type CityWord } from '../city/strings';
import { searchCity, type CitySearchResult } from '../city/search';
import { placeCategory } from '../city/markup';
import { defaultLocation, locationLabel, type LocationContext } from '../city/location';
import { placeDetail, placesMarkup, streetDetail, departuresMarkup } from '../city/markup';
import { createBoardCache, type BoardCache, type BoardOperator } from '../city/boards';
import { arrivalsAt } from '../../../shared/city/arrivals';
import { emptyCity, type DepartureBoard } from '../../../shared/city/types';
import { locatedEvents, type ActivityWindow } from '../../../shared/city/events';
import { matchStreet } from '../../../shared/city/geo';
import { reconcile } from '../ui/dom/reconcile';
import { routeCatalogue, routeEntry, routeStopSequence, stopGroupById, stopGroupsFromCatalogue, stopGroupsFromNetwork } from './catalogue';
import { closureItems, countByRoute, plausibleDelays, runningRoutes, vehicleDirection, vehicleNextStop, vehiclesOfModes, vehiclesOnRoute, zetNotices } from './detail';
import type { StopGroup } from './search';
import { createSheet, type SheetController } from './sheet';
import { tr, trPlural } from './strings';
import {
  closureDetailMarkup, closuresMarkup, delaysMarkup, NOTICE_ROWS, overviewMarkup, PEEK_BADGES, peekMarkup, routeDetailMarkup, safeId, statusLine, stopDetailMarkup, vehicleDetailMarkup, vehicleTitle,
  type DelayRow, type Fold,
} from './view';

/** Separate slots let the page sweep the old renderer and release its resources after a swap. */
export const MAP_SLOT_ID = 'u-pokretu-map';
export const SCHEMA_MAP_SLOT_ID = 'u-pokretu-schema';
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
  /** How the scheduled boards are fetched and remembered; defaults to
   *  city/boards.ts's createBoardCache. The workspace owns what this makes and
   *  destroys it with itself. */
  createBoards?: () => BoardCache;
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

/** How the sheet sits: detents over the map on the portrait phone, a full-height column beside it otherwise. */
type StageMode = 'phone' | 'landscape' | 'desk';

interface MediaLike {
  matches: boolean;
  addEventListener?(type: 'change', listener: () => void): void;
  removeEventListener?(type:'change',listener:()=>void):void;
}
const media = (query: string): MediaLike | null => (typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(query) : null);
const DESK_QUERY = '(min-width: 60rem)';
const LANDSCAPE_QUERY = '(max-height: 30rem) and (orientation: landscape)';

/** A vehicle the model has not placed (no map yet, or none at all): listed by route and type, with no position of any kind. */
function unplaced(p: MapPoint): VehicleInfo {
  const type = p.type ?? -1;
  const short = p.routeId === undefined ? '' : routeEntry(p.routeId).short;
  return { id: p.id, routeId: p.routeId, tripId:p.tripId, delaySeconds:p.delaySeconds, nextStopId:p.nextStopId, nextStopEtaMs:p.nextStopEtaMs, short, kind: type === ROUTE_TYPE_TRAM ? 'tram' : type === ROUTE_TYPE_BUS ? 'bus' : 'other', type, lon: Number.NaN, lat: Number.NaN, bearing: null, confidence: 0, held: false, onShape: null };
}

function toMapSelection(pub: { kind: string; id: string } | null | undefined, groups: readonly StopGroup[] | null): MapSelection | null {
  if (!pub) return null;
  if (pub.kind === 'place' || pub.kind === 'street') return { kind: pub.kind, id: pub.id };
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
  if (sel.kind === 'place' || sel.kind === 'street') return { kind: sel.kind, id: sel.id };
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
    option: (kind: CitySearchResult['kind'], value: string): string => `${id}-opt-${kind}-${safeId(value)}`,
  };
  const element = document.createElement('div');
  element.className = 'transport';
  // A stable id: the layer's persist slot names it for the page's reconciler (ui/dom/reconcile.ts, data-persist-for).
  element.id = `${id}-root`;
  element.dataset.testid = 'transport-workspace';
  element.dataset.persist = 'u-pokretu';
  element.dataset.status = 'loading';
  element.dataset.sheet = 'peek';
  // Built once. The controls below are updated in place on every render; only
  // the sheet body's content is ever re-set, with its focus restored by id.
  // The mode chips and the tools float over the map; the search sits in the
  // sheet under its head; the honesty note is the body's stable foot.
  element.innerHTML = `
    <div class="transport-body">
      <div class="transport-map" id="u-pokretu-map" data-testid="transport-map">
        <details class="t-map-menu" data-testid="map-controls">
        <summary class="t-map-menu-trigger">${iconMarkup('sliders-horizontal')}<span data-ref="tools-title"></span></summary>
        <div class="t-map-menu-body">
        <div class="t-map-chips" role="group" data-ref="modes">
          <button type="button" class="t-toggle" id="${id}-mode-tram" data-action="toggle-mode" data-mode="${ROUTE_TYPE_TRAM}" aria-pressed="true"></button>
          <button type="button" class="t-toggle" id="${id}-mode-bus" data-action="toggle-mode" data-mode="${ROUTE_TYPE_BUS}" aria-pressed="true"></button>
          <button type="button" class="t-toggle" id="${id}-closures" data-action="toggle-closures" aria-pressed="true"></button>
          <span class="t-schema-legend" data-testid="schema-mode-legend" hidden></span>
        </div>
        <div class="t-map-tools" role="group" data-ref="tools">
          <button type="button" class="btn-ghost t-action" id="${id}-map-mode" data-testid="map-mode-toggle" data-action="toggle-map-mode" aria-pressed="false" hidden></button>
          <button type="button" class="btn-ghost t-action" id="${id}-fit-city" data-action="fit-city"></button>
          <button type="button" class="btn-ghost t-action" id="u-pokretu-map-full" data-testid="map-full-toggle" data-action="toggle-full" hidden></button>
        </div>
        </div></details>
        <p class="t-map-status" role="status" data-testid="map-status" hidden></p>
      </div>
      <aside class="transport-sheet" data-testid="transport-sheet">
        <div class="t-sheet-head" data-ref="sheet-head">
          <span class="t-sheet-handle" aria-hidden="true"></span>
          <div class="t-peek" data-testid="transport-peek"></div>
          <button type="button" class="btn-quiet icon-btn t-sheet-toggle" id="${id}-sheet" data-action="toggle-sheet" aria-expanded="false" aria-controls="${ids.body}">${iconMarkup('chevron-down')}</button>
        </div>
        <div class="transport-toolbar" data-testid="transport-toolbar">
          <div class="t-search">
            <label class="visually-hidden" for="${ids.search}" data-ref="search-label"></label>
            <input id="${ids.search}" class="t-search-input" type="search" role="combobox" aria-expanded="false" aria-controls="${ids.results}" aria-autocomplete="list" aria-describedby="${id}-hint" autocomplete="off" spellcheck="false" data-testid="transport-search">
            <button type="button" class="t-search-clear" id="${id}-clear" data-action="clear-search" hidden>&#215;</button>
            <p class="visually-hidden" id="${id}-hint" data-ref="search-hint"></p>
          </div>
          <details class="city-filter-disclosure">
            <summary data-ref="filter-label"></summary>
            <div class="city-groups" role="group" data-testid="city-groups"></div>
            <div class="city-filters" data-testid="city-filters"></div>
          </details>
        </div>
        <div class="t-sheet-body" id="${ids.body}" data-testid="transport-detail">
          <div class="t-sheet-content" data-ref="content"></div>
          <p class="t-sheet-note" data-testid="transport-note"></p>
        </div>
      </aside>
    </div>`;
  const q = <T extends Element>(selector: string): T => element.querySelector<T>(selector)!;
  const stage = q<HTMLElement>('.transport-body');
  const toolbar = q<HTMLElement>('.transport-toolbar');
  const searchInput = q<HTMLInputElement>(`#${ids.search}`);
  const searchLabel = q<HTMLElement>('[data-ref=search-label]');
  const searchHint = q<HTMLElement>('[data-ref=search-hint]');
  const clearButton = q<HTMLButtonElement>(`#${id}-clear`);
  const modeButtons: Record<number, HTMLButtonElement> = { [ROUTE_TYPE_TRAM]: q(`#${id}-mode-tram`), [ROUTE_TYPE_BUS]: q(`#${id}-mode-bus`) };
  const modesGroup = q<HTMLElement>('[data-ref=modes]');
  const closuresButton = q<HTMLButtonElement>(`#${id}-closures`);
  const schemaLegend = q<HTMLElement>('[data-testid=schema-mode-legend]');
  const mapRegion = q<HTMLElement>('.transport-map');
  const statusEl = q<HTMLElement>('[data-testid=map-status]');
  const tools = q<HTMLElement>('[data-ref=tools]');
  const mapModeButton = q<HTMLButtonElement>('[data-testid=map-mode-toggle]');
  const fitCityButton = q<HTMLButtonElement>(`#${id}-fit-city`);
  const fullButton = q<HTMLButtonElement>('#u-pokretu-map-full');
  const sheetEl = q<HTMLElement>('.transport-sheet');
  const sheetHead = q<HTMLElement>('[data-ref=sheet-head]');
  const peek = q<HTMLElement>('[data-testid=transport-peek]');
  const sheetToggle = q<HTMLButtonElement>(`#${id}-sheet`);
  const body = q<HTMLElement>(`#${ids.body}`);
  const content = q<HTMLElement>('[data-ref=content]');
  const note = q<HTMLElement>('[data-testid=transport-note]');
  const filtersDisclosure = q<HTMLDetailsElement>('.city-filter-disclosure');
  filtersDisclosure.addEventListener('toggle', () => {
    if (filtersDisclosure.open) sheet?.set('open', { animate: false });
    stage.scrollTop = 0;
  });

  // --- State that survives every poll -------------------------------------
  let input: WorkspaceInput | null = null;
  let query = '';
  let browseReturn: { query: string; scroll: number; group: CityGroup; category: string } | null = null;
  let stateRestored = false;
  let restoreSearchSheet = false;
  let activeOption: string | null = null;
  let selection: MapSelection | null = null;
  let following: string | null = null;
  // Trams and buses both on (the plan's opening focus on every surface but the
  // kiosk board, which keeps trams first, R-P1); the first render settles it.
  const modes = new Set<number>(ALL_MODES);
  let modesSettled = false;
  let closuresVisible = true;
  let delaysOpen = false;
  const folds = new Set<Fold>();
  let camera: MapCamera | null = null;
  let mapMode: MapMode = 'map';
  /** "Only this line on the map" for this workspace. The device store owns it
   *  wherever there is one (ctx.lineFocus); with none -- a unit context -- the
   *  choice holds for this tab alone, at the store's own default. */
  let lineFocus = true;
  let activeSlotId: string | null = null;
  let mapEpoch = 0;
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
  // The stage: which sheet the surface gets, the detent controller on the portrait phone, the page's view mode.
  const deskMedia = media(DESK_QUERY);
  const landscapeMedia = media(LANDSCAPE_QUERY);
  let mode: StageMode | null = null;
  let sheet: SheetController | null = null;
  let lastFull = false;
  let lastStageHeight = -1;
  let cityGroup: CityGroup = 'living';
  let cityCategory = '';
  let activityWindow: ActivityWindow = 'week';
  let cityCenter: {lon:number;lat:number}|null = null;
  let cityReferenceKind: 'area' | 'device' = 'area';
  const referenceLocation = (): LocationContext => cityCenter
    ? {...cityCenter,kind:cityReferenceKind,name:''}
    : ctx().location??defaultLocation(ctx().screen);
  /** The screen's stop centres the camera once, the first render only. */
  let stopCentered = false;
  let cityLimit = 20;
  let cityData: Discovery|null = null;
  let cityFilterKey = '';
  let bikeMode:'rent'|'return'='rent';
  let streetRequested=false;
  let disposed=false;
  let disposalRegistered=false;
  const pollutants=new Map<string,string>();
  const pollutantPending=new Set<string>();
  /** One request per platform per minute, answered to every reader that asked
   *  for it (city/boards.ts). This workspace's own, and destroyed with it. */
  const boards: BoardCache = (deps.createBoards ?? createBoardCache)();
  const cityState = () => ctx().city ?? emptyCity();
  function discovery(): Discovery {
    const c=ctx(),stop=c.screen?.stop;
    return discover(cityState(),c.snapshots.dogadanja?.items??[],{
      group:cityGroup,category:cityCategory,query,window:activityWindow,
      center:referenceLocation(),radius:5000,now:c.frozenAt??c.now,bikeMode});
  }
  function askCity():void {
    const c=ctx(); if(c.session?.frozen)return;
    c.ensureCity?.(cityCategory?CATEGORY_SOURCE[cityCategory]??[]:GROUP_SOURCES[cityGroup]);
    if(query)c.ensureCity?.(['culture','water','toilets','sport','dogs','markets','recycling','wifi','cycle-parking','garages','charging','heritage','streets','hz-schedule']);
  }
  function paintCityFilters():void {
    const i18n=ctx().i18n;
    const groups: [CityGroup,CityWord][]=[['living','all'],['culture','culture'],['transport','movement'],['useful','useful'],['heritage','heritage']];
    const g=q<HTMLElement>('[data-testid=city-groups]');
    const groupHtml=groups.map(([key,label])=>`<button type="button" class="city-group" data-action="city-group" data-group="${key}" aria-pressed="${cityGroup===key}">${esc(ct(i18n,label))}</button>`).join('');
    if(g.innerHTML!==groupHtml){const next=document.createElement('div');next.innerHTML=groupHtml;reconcile(g,next);}
    const category:CityWord[]=cityGroup==='useful'?['water','toilet','sport','dogs','recycling','market','wifi','cycle-parking','garage','charging']:
      cityGroup==='transport'?['network','bikes','rail','cycle-paths']:cityGroup==='heritage'?['heritage','streets']:cityGroup==='culture'?['activeVenues','allVenues']:[];
    const windows=cityGroup==='culture'||cityGroup==='living'?`<div class="city-times" role="group" aria-label="${esc(ct(i18n,'program'))}">${(['today','tomorrow','week'] as ActivityWindow[]).map(w=>`<button type="button" class="city-filter" data-action="city-window" data-window="${w}" aria-pressed="${activityWindow===w}">${ct(i18n,w)}</button>`).join('')}</div>`:'';
    const html=windows+category.map(k=>{const key=k==='network'||k==='activeVenues'?'':k==='allVenues'?'culture':k;return `<button type="button" class="city-filter" data-action="city-category" data-category="${key}" aria-pressed="${cityCategory===key}">${ct(i18n,k)}</button>`;}).join('')
      +(cityCategory==='bikes'?`<button class="city-filter" data-action="bike-mode" data-mode="rent" aria-pressed="${bikeMode==='rent'}">${ct(i18n,'rentMode')}</button><button class="city-filter" data-action="bike-mode" data-mode="return" aria-pressed="${bikeMode==='return'}">${ct(i18n,'returnMode')}</button>`:'');
    const f=q<HTMLElement>('[data-testid=city-filters]');if(f.innerHTML!==html){const next=document.createElement('div');next.innerHTML=html;reconcile(f,next);}
    g.setAttribute('aria-label',ct(i18n,'layers'));
  }
  function saveCityFilters():void {
    const category=cityCategory,group=cityGroup,window=activityWindow;
    ctx().setFilter?.('city-group',group);
    ctx().setFilter?.('city-category',category);
    ctx().setFilter?.('city-window',window);
    cityGroup=group;cityCategory=category;activityWindow=window;
  }
  function cityMapPoints():MapPoint[] {
    if(!input||!ctx().city)return [];
    cityData=discovery();
    const selected=selection?.kind==='place'?[...cityState().places,...dynamicPlaces(cityState(),ctx().now)].find(p=>p.id===selection!.id):null;
    // Keep the selected marker outside geographic clusters and outside filters.
    const extra=selected&&Number.isFinite(selected.lon)&&Number.isFinite(selected.lat)
      ?[cityData.points.find(p=>p.id===selected.id)??{id:selected.id,title:selected.name,lon:selected.lon!,lat:selected.lat!,place:'city' as const,props:{category:selected.category,eventCount:0,badge:'',priority:0}}]:[];
    return [...clusterPlaces(cityData.points.filter(p=>p.id!==selected?.id),camera?.zoom??14),...extra];
  }
  function updateCityMap():void {
    if(!input || !ctx().city)return;
    handle?.update([...input.points,...cityMapPoints()],input.lines);
    handle?.setModes?.(modesArg());
    const selected=selection?.kind==='place'?cityState().places.find(p=>p.id===selection!.id):null;
    handle?.setOutline?.(selected?.polygons?{id:selected.id,polygons:selected.polygons}:null);
    const paths=cityCategory==='cycle-paths'?cityState().paths.flatMap(p=>p.lines.map((coordinates,i)=>({id:`${p.id}-${i}`,title:p.name,coordinates}))):[];
    handle?.setCityPaths?.(paths);
  }
  /** One function, not one per render: the cache keeps its waiting callers in a
   *  Set, and a fresh closure each time would make a stop with eight platforms
   *  re-render 2^8 times as its boards landed one after another. */
  const onBoardSettled=():void=>{if(!disposed&&!ctx().session?.frozen)renderSheet();};
  /** The cache does the asking and the remembering; the gate is this
   *  workspace's, as it always was: a frozen session neither asks nor repaints. */
  function ensureBoards(operator:BoardOperator,stopIds:readonly string[]):void {
    if(disposed||ctx().session?.frozen)return;
    (ctx().boards??boards).ensure(operator,stopIds,onBoardSettled);
  }
  /** Every board this stop's platforms have answered with so far. An empty
   *  list is "nothing in hand yet", which arrivalsAt reads as 'none'. */
  function boardsFor(operator:BoardOperator,stopIds:readonly string[]):DepartureBoard[] {
    return stopIds.map(id=>(ctx().boards??boards).get(operator,id)).filter((board):board is DepartureBoard=>board!==undefined);
  }

  // --- Derived, per render ----------------------------------------------------
  function ctx(): LayerContext {
    if (!input) throw new Error('transport workspace: render() first');
    return input.ctx;
  }
  const kiosk = (): boolean => ctx().kiosk === true;
  /** The state the detail's line-focus switch shows, or null where there is no
   *  device store to write a change to and the switch is not offered at all
   *  (the lightweight path, a unit context) -- the map-mode button's own rule.
   *  The map still focuses there; only the control is withheld. */
  const lineFocusRow = (): boolean | null => (ctx().lineFocus ? lineFocus : null);
  /** null while every mode is on: the map then also draws vehicles of a type nobody knows. */
  const modesArg = (): ReadonlySet<number> | null => (
    ctx().city&&(cityGroup!=='transport'||cityCategory!=='') ? new Set() :
    mapMode === 'schema' ? new Set([ROUTE_TYPE_TRAM]) : ALL_MODES.every((m) => modes.has(m)) ? null : new Set(modes)
  );
  const delays = (): Map<string, number> => plausibleDelays(routeDelayMap(ctx().snapshots['zet-rt']));

  /** Every vehicle the model has placed, or, before that and without a map, the reports listed by route alone.
   *  The mode toggle filters what the overview counts and the map draws; a route or stop someone asks about
   *  answers for its own vehicles whatever the toggle says. */
  function vehiclesNow(): VehicleInfo[] {
    const placed = handle?.vehicles?.();
    const usePlaced = placed !== undefined && (placed.length > 0 || status !== 'loading');
    return usePlaced ? placed : (input?.points ?? []).filter((p) => p.at !== undefined).map(unplaced);
  }

  /** Small stop-name catalogue also supplies the lightweight list alternative. */
  function ensureCatalogue(): void {
    if (disposed || groups || catalogueRequested) return;
    catalogueRequested = true;
    (deps.loadStops ?? (() => loadStops()))().then(
      (stops) => {
        if (!disposed&&!groups) {
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

  /** The one place the selection changes: state, the sheet's detent, the map, the paired screen, then the sheet's content. A selection lifts the sheet to half, never leaves it at peek. */
  function setSelection(next: MapSelection | null, opts: { fit?: boolean; relay?: boolean } = {}): void {
    if(ctx().session?.frozen)return;
    if (next && query) {
      browseReturn = { query, scroll: body.scrollTop, group: cityGroup, category: cityCategory };
      ctx().setFilter?.('city-scroll',String(body.scrollTop));
    }
    if(next?.kind==='place'&&next.id.startsWith('cluster-')){
      const clusterId=next.id;
      const point=clusterPlaces(discovery().points,camera?.zoom??14).find(p=>p.id===clusterId);
      if(point){const zoom=Math.min((camera?.zoom??14)+1.5,18);camera={center:[point.lon,point.lat],zoom};handle?.setView?.({center:camera.center,zoom});updateCityMap();}return;
    }
    if(next?.kind==='place'||next?.kind==='street'){
      if(mapMode==='schema')ctx().mapMode?.set('map');
      askCity();
    }
    if(next&&['route','stop','vehicle','closure'].includes(next.kind)){cityGroup='transport';cityCategory='';}
    if (next?.kind === 'stop' && !next.ids) next = { ...next, ids: groupFor(next.id)?.ids };
    selection = next;
    updateCityMap();
    folds.delete('stops');
    if (next?.kind !== 'vehicle' && following) {
      following = null;
      handle?.follow?.(null);
    }
    // The sheet settles at half before the map moves, so the fit is padded for the detent the person will see;
    // padded for an open sheet, MapLibre has no room left and refuses the fit.
    if (next) sheet?.set('half');
    handle?.select?.(next, { fit: opts.fit });
    if (opts.relay !== false) relay(next);
    if (query) {
      query = '';
      searchInput.value = '';
    }
    activeOption = null;
    renderSheet();
    if (!next && browseReturn) {
      const back = browseReturn;
      browseReturn = null;
      query = back.query; searchInput.value = query;
      cityGroup = back.group; cityCategory = back.category;
      sheet?.set('open', { animate: false });
      renderSheet(); body.scrollTop = back.scroll;
      searchInput.focus({ preventScroll: true });
    }
  }

  /** The switch's one effect: the live map draws the one line or the whole
   *  network, and the sheet's own row says which. Idempotent, so the click and
   *  the store's own re-render can both call it. */
  function setLineFocus(on: boolean): void {
    if (on === lineFocus) return;
    lineFocus = on;
    handle?.setLineFocus?.(on);
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

  // --- The stage: detents on the portrait phone, a column elsewhere -----------------
  function stageMode(): StageMode {
    if (ctx().lightweight || kiosk() || deskMedia?.matches) return 'desk';
    if (landscapeMedia?.matches) return 'landscape';
    return 'phone';
  }

  /** The covered part of the map every fit keeps clear: the sheet's height under it, the column's width beside it. */
  function fitPadding(): FitPadding {
    if (mode === 'phone' && sheet) return { bottom: sheet.heightFor(sheet.detent()), right: 0 };
    if (mode === 'landscape') {
      const stageBox = stage.getBoundingClientRect();
      const column = sheetEl.getBoundingClientRect();
      return { bottom: 0, right: Math.max(0, Math.round(stageBox.right - column.left)) };
    }
    return { bottom: 0, right: 0 };
  }

  /** Tells the map what covers it now. */
  function syncFitPadding(): void {
    handle?.setFitPadding?.(fitPadding());
  }

  function onDetent(): void {
    const height = stage.clientHeight;
    if (height !== lastStageHeight) {
      lastStageHeight = height;
      handle?.resize?.();
    }
    syncFitPadding();
    stage.scrollTop = 0;
    if (input) renderSheetToggle();
  }

  function syncStage(): void {
    const next = stageMode();
    if (next === mode) return;
    mode = next;
    if (next === 'phone') {
      sheet ??= createSheet({ root: element, sheet: sheetEl, head: sheetHead, body, stage: () => stage, reducedMotion: ctx().reducedMotion === true, onChange: onDetent });
    } else {
      sheet?.destroy();
      sheet = null;
      element.dataset.sheet = next === 'desk' ? 'open' : 'half';
      syncFitPadding();
    }
  }
  const onMedia = (): void => {
    if (!input) return;
    syncStage();
    renderSheet();
  };
  deskMedia?.addEventListener?.('change', onMedia);
  landscapeMedia?.addEventListener?.('change', onMedia);

  // The column modes measure the sheet's box, which the first render cannot (the workspace renders before the
  // layer appends it, layers/u-pokretu.ts) and which follows the stage's width and the column's slide ("Proširi
  // kartu"): the stage's own observer reports it at the first layout and on every resize, the column's transition
  // at its end, and every render again. On the phone the detent controller owns it.
  const onStageBox = (): void => {
    if (!sheet) syncFitPadding();
  };
  const resizeObserver=typeof ResizeObserver==='function'?new ResizeObserver(onStageBox):null;
  if (resizeObserver) resizeObserver.observe(stage);
  else window.addEventListener('resize', onStageBox);
  sheetEl.addEventListener('transitionend', (event) => {
    if (event.target === sheetEl) onStageBox();
  });

  /** A peeking sheet rises to half; a higher one stays where it is. */
  function raise(): void {
    sheet?.set('open', { animate: false });
  }

  // --- Rendering ---------------------------------------------------------------
  /** The head's chevron: where the next step goes, and whether the body is on show. On the desk it only collapses or restores the board. */
  function renderSheetToggle(): void {
    const i18n = ctx().i18n;
    const full = ctx().mapView?.full === true;
    const detent = sheet?.detent();
    const expanded = sheet ? detent !== 'peek' : !full;
    const up = sheet ? detent !== 'open' : full;
    sheetToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    sheetToggle.dataset.next = up ? 'up' : 'down';
    sheetToggle.setAttribute('aria-label', tr(i18n, up ? 'details' : 'collapse'));
  }

  /** The controls' words and states, updated in place: the locale may have changed, the toggles may have. */
  function renderChrome(): void {
    const c = ctx();
    const i18n = c.i18n;
    const k = kiosk();
    const schema = mapMode === 'schema';
    const cityOnly=Boolean(c.city&&(cityGroup!=='transport'||cityCategory!==''));
    element.dataset.kiosk = k ? 'true' : 'false';
    element.dataset.mapMode = mapMode;
    element.dataset.cityGroup=cityGroup;
    toolbar.hidden = k;
    searchLabel.textContent = tr(i18n, 'searchLabel');
    searchInput.placeholder = ct(i18n, 'search');
    searchLabel.textContent = ct(i18n,'search');
    paintCityFilters();
    q<HTMLElement>('[data-ref=filter-label]').textContent = ct(i18n,'layers');
    searchHint.textContent = tr(i18n, 'searchHint');
    clearButton.setAttribute('aria-label', tr(i18n, 'clearSearch'));
    clearButton.hidden = query === '';
    modesGroup.setAttribute('aria-label', tr(i18n, 'modesLabel'));
    modesGroup.hidden = k;
    modeButtons[ROUTE_TYPE_TRAM].textContent = tr(i18n, 'trams');
    modeButtons[ROUTE_TYPE_BUS].textContent = tr(i18n, 'buses');
    for (const mode of ALL_MODES) modeButtons[mode].setAttribute('aria-pressed', (schema ? mode === ROUTE_TYPE_TRAM : modes.has(mode)) ? 'true' : 'false');
    modeButtons[ROUTE_TYPE_TRAM].hidden = cityOnly;
    modeButtons[ROUTE_TYPE_BUS].hidden = schema||cityOnly;
    closuresButton.textContent = tr(i18n, 'showClosures');
    closuresButton.setAttribute('aria-pressed', closuresVisible ? 'true' : 'false');
    closuresButton.hidden = schema;
    schemaLegend.hidden = !schema;
    schemaLegend.textContent = tr(i18n, 'schemaTramsOnly');
    tools.setAttribute('aria-label', tr(i18n, 'toolsLabel'));
    q<HTMLElement>('[data-ref=tools-title]').textContent = tr(i18n, 'toolsLabel');
    q<HTMLElement>('.t-map-menu-trigger').setAttribute('aria-label', tr(i18n, 'toolsLabel'));
    q<HTMLElement>('.t-map-menu').hidden = k;
    tools.hidden = k;
    mapModeButton.hidden = k || c.lightweight === true || !c.mapMode || !c.maps || cityOnly;
    const modeLabel = tr(i18n, schema ? 'mapModeMap' : 'mapModeSchema');
    mapModeButton.innerHTML = `${iconMarkup(schema ? 'map' : 'route')}<span>${esc(modeLabel)}</span>`;
    mapModeButton.setAttribute('aria-label', modeLabel);
    mapModeButton.setAttribute('aria-pressed', schema ? 'true' : 'false');
    const fitCity = tr(i18n, 'fitCity');
    fitCityButton.innerHTML = `${iconMarkup('map')}<span>${esc(fitCity)}</span>`;
    fitCityButton.setAttribute('aria-label', fitCity);
    const mapView = c.mapView;
    fullButton.hidden = !mapView || k;
    if (mapView) fullButton.textContent = i18n.t(mapView.full ? 'panels.mapCollapse' : 'panels.mapExpand');
    sheetEl.setAttribute('aria-label', tr(i18n, 'sheetLabel'));
    sheetToggle.hidden = k;
    renderSheetToggle();
    if (!sheet) element.dataset.sheet = mode === 'landscape' ? 'half' : 'open';
    note.textContent = i18n.t('motion.note');
    // The schema owns this note beside its canvas. Keep the sheet's copy only
    // for geography or a failed renderer, where that canvas note is absent.
    note.hidden = schema && status !== 'unavailable';
  }

  function renderStatus(): void {
    const line = statusLine(ctx().i18n, status);
    element.dataset.status = status;
    statusEl.hidden = line === null;
    statusEl.textContent = line ?? '';
  }

  /** Sets the body's content, keeping focus on the control of the same id when the render replaced it. */
  function swapBody(html: string): void {
    const active = document.activeElement;
    const focusId = active instanceof HTMLElement && content.contains(active) ? active.id : '';
    const next=document.createElement('div');next.innerHTML=html;
    const scroll = body.scrollTop;
    reconcile(content,next);
    body.scrollTop = scroll;
    if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
  }

  /** The sheet: search results while typing, the selection's detail, else the overview; and the peek line above it. */
  function renderSheet(): void {
    if (!input||disposed) return;
    const i18n = ctx().i18n;
    const vehicles = vehiclesNow();
    const shown = vehiclesOfModes(vehicles, modesArg());
    let html: string;
    let peekHtml: string;
    let peekText: string | null = null;
    cityData=discovery();
    if (query) {
      const results = searchCity(query, routeCatalogue(), groups ?? [], cityData.places, cityData.streets);
      const total = results.length;
      if (activeOption && !results.some(r => ids.option(r.kind, r.id) === activeOption)) activeOption = null;
      const label = (r: CitySearchResult) => r.kind === 'place' ? placeCategory(i18n,r.record) : r.kind === 'street' ? ct(i18n,'streets') : tr(i18n,r.kind === 'stop' ? 'stop' : 'route');
      html = `<div id="${ids.results}" role="listbox" aria-label="${esc(ct(i18n,'search'))}">${results.slice(0,cityLimit).map(r =>
        `<div class="city-row t-search-result" role="option" tabindex="-1" aria-selected="${ids.option(r.kind,r.id)===activeOption}" id="${ids.option(r.kind,r.id)}" data-action="select-${r.kind}" data-id="${esc(r.id)}"><span class="city-row-main"><span class="city-kicker">${esc(label(r))}</span><strong>${esc(r.name)}</strong><span class="city-meta">${esc(r.detail)}</span></span></div>`).join('')}</div>`;
      if(total>cityLimit)html+=`<button class="btn-quiet" data-action="city-more">${ct(i18n,'more')} (${total-cityLimit})</button>`;
      if(!total)html+=`<p role="status">${ct(i18n,cityState().loading?'loading':'noResults')}</p>`;
      else if(cityState().loading)html+=`<p class="city-meta" role="status">${ct(i18n,'partial')} ${ct(i18n,'loading')}</p>`;
      peekText = trPlural(i18n, 'resultsCount', total);
      peekHtml = esc(peekText);
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
      if (detail) {
        [html, peekText] = detail;
        peekHtml = esc(peekText);
      } else {
        const transport=cityGroup==='transport'&&!cityCategory;
        html = transport ? overview(shown) : `<section class="city-browse"><h3>${esc(ct(i18n,'list'))}</h3>
          <p class="city-meta" data-testid="location-context">${esc(locationLabel(i18n,referenceLocation()))}</p>
          <p class="city-meta">${esc(ct(i18n,'legend'))}</p>${cityState().loading?`<p role="status">${ct(i18n,'loading')}</p>`:''}
          ${cityCategory==='streets'?`<p class="city-meta">${ct(i18n,'streetBrowse')}</p>${cityData.streets.slice(0,cityLimit).map(s=>`<button type="button" class="city-row" data-action="select-street" data-id="${esc(s.id)}"><span><strong>${esc(s.name)}</strong><span class="city-meta">${esc(s.settlement)}</span></span></button>`).join('')}${cityData.streets.length>cityLimit?`<button class="btn-quiet" data-action="city-more">${ct(i18n,'more')}</button>`:''}`:
            cityCategory==='cycle-paths'?`<p>${cityState().paths.length} ${ct(i18n,'cycle-paths')}</p>${cityState().paths.slice(0,cityLimit).map(p=>`<p>${esc(p.name)}${p.surface?` · ${esc(p.surface)}`:''}</p>`).join('')}${cityState().paths.length>cityLimit?`<button class="btn-quiet" data-action="city-more">${ct(i18n,'more')}</button>`:''}`:
            cityData.places.length?placesMarkup(i18n,cityData.places,cityData.events,cityLimit,bikeMode,referenceLocation()):`<p>${ct(i18n,'noResults')}</p>`}
          ${cityState().errors.length?`<p class="city-meta" role="status">${ct(i18n,'unavailable')}</p>`:''}
          <button type="button" class="btn-quiet" data-action="city-area">${ct(i18n,'here')}</button>
          <button type="button" class="btn-quiet" data-action="city-locate">${ct(i18n,'locate')}</button></section>`;
        peekHtml = transport ? overviewPeek(shown) : `<strong>${esc(ct(i18n,'city'))}</strong><span class="city-meta">${cityData.count} ${ct(i18n,'venues')}</span>`;
      }
    }
    if (query && activeOption) searchInput.setAttribute('aria-activedescendant', activeOption);
    else searchInput.removeAttribute('aria-activedescendant');
    peek.innerHTML = following && selection?.kind === 'vehicle' && peekText !== null ? esc(tr(i18n, 'peekFollowing', { title: peekText })) : peekHtml;
    swapBody(html);
    if(activeOption)document.getElementById(activeOption)?.scrollIntoView?.({block:'nearest'});
    element.dataset.searching=String(Boolean(query));
    for(const slot of content.querySelectorAll<HTMLElement>('[data-city-air]')){
      const station=slot.dataset.cityAir!;
      if(pollutants.has(station))slot.innerHTML=pollutants.get(station)!;
      else if(!disposed&&!ctx().session?.frozen&&!pollutantPending.has(station)){
        pollutantPending.add(station);
        void fetch(`/api/city/air?station=${encodeURIComponent(station)}`,{signal:AbortSignal.timeout(12000)})
          .then(r=>{if(!r.ok)throw new Error('air-down');return r.json();})
          .then(result=>{if(disposed||ctx().session?.frozen)return;const rows=Array.isArray(result.pollutants)?result.pollutants:[];
            pollutants.set(station,`<dl class="city-facts">${rows.map((r:{name:string;value:number|null})=>`<div><dt>${esc(r.name)}</dt><dd>${r.value===null?ct(i18n,'unknown'):esc(String(r.value))+' µg/m³'}</dd></div>`).join('')}</dl>`);renderSheet();})
          .catch(()=>{pollutants.set(station,`<p class="city-meta">${ct(i18n,'unavailable')}</p>`);})
          .finally(()=>pollutantPending.delete(station));
      }
    }
    for(const slot of content.querySelectorAll<HTMLElement>('[data-city-departures]')){
      const operator=slot.dataset.cityDepartures as BoardOperator,stopId=slot.dataset.stop!;
      ensureBoards(operator,[stopId]);const board=(ctx().boards??boards).get(operator,stopId);
      slot.innerHTML=board?departuresMarkup(i18n,board,ctx().now):`<p>${ct(i18n,'loading')}</p>`;
    }
    renderChrome();
  }

  function sourceLine(snapshot: ModuleSnapshot | undefined): string | null {
    const c = ctx();
    return snapshot && snapshot.status !== 'live' ? statusText(snapshot, c.i18n, c.now) : null;
  }

  /** The screen's stop with the routes the artefact knows for it, else the session's own list. */
  function screenStopRoutes(): { id: string; name: string; routes: readonly string[] } | null {
    const screenStop = ctx().screen?.stop;
    if (!screenStop) return null;
    return { id: screenStop.id, name: screenStop.name, routes: groupFor(screenStop.id)?.routes ?? screenStop.routes };
  }

  function overview(vehicles: readonly VehicleInfo[]): string {
    const c = ctx();
    const zet = c.snapshots['zet-rt'];
    const closures = c.snapshots.prometnice;
    const main = overviewMarkup(c.i18n, {
      routes: runningRoutes(vehicles, delays(), c.i18n),
      total: vehicles.length,
      loading: !zet,
      sourceStatus: sourceLine(zet),
      screenStop: screenStopRoutes(),
      routeOf: routeEntry,
      kiosk: kiosk(),
      routesOpen: folds.has('routes'),
    });
    const worstFirst: DelayRow[] = [...delays()]
      .map(([routeId, delay]) => ({ routeId, delay }))
      .sort((a, b) => Math.abs(b.delay) - Math.abs(a.delay) || a.routeId.localeCompare(b.routeId, 'hr', { numeric: true }));
    return main + delaysMarkup(c.i18n, worstFirst, routeEntry, delaysOpen) + closuresMarkup(c.i18n, closureItems(closures), zetNotices(c.snapshots.dogadanja, NOTICE_ROWS), sourceLine(closures), null, !kiosk(), folds.has('closures'));
  }

  /** The collapsed sheet's line: this stop's lines (else the four busiest), then the two counts. */
  function overviewPeek(vehicles: readonly VehicleInfo[]): string {
    const c = ctx();
    if (!c.snapshots['zet-rt']) return esc(tr(c.i18n, 'peekLoading'));
    const stop = screenStopRoutes();
    const routeIds = stop ? [...stop.routes] : runningRoutes(vehicles, delays(), c.i18n).sort((a, b) => b.count - a.count).map((row) => row.routeId);
    return peekMarkup(c.i18n, {
      routes: routeIds.slice(0, PEEK_BADGES).map((routeId) => routeEntry(routeId)),
      more: Math.max(0, routeIds.length - PEEK_BADGES),
      vehicles: vehicles.length,
      closures: closureItems(c.snapshots.prometnice).length,
    });
  }

  /** The selection's detail and its one-line summary; null once the thing has gone. */
  function detailMarkup(sel: MapSelection, vehicles: readonly VehicleInfo[]): [string, string] | null {
    const c = ctx();
    const i18n = c.i18n;
    const k = kiosk();
    switch (sel.kind) {
      case 'place': {
        const p=[...cityState().places,...dynamicPlaces(cityState(),c.now)].find(p=>p.id===sel.id);
        if(!p){c.ensureCity?.(['culture','heritage','water','toilets','sport','dogs','recycling','markets','wifi','cycle-parking','garages','charging','hz-schedule']);return [`<article class="city-detail"><button class="btn-quiet" data-action="clear-selection">${ct(i18n,'back')}</button><p>${ct(i18n,cityState().loading?'loading':'notFound')}</p></article>`,ct(i18n,'selected')];}
        return [placeDetail(i18n,p,cityState(),locatedEvents(c.snapshots.dogadanja?.items??[],cityState().places,c.now,activityWindow),c.saved?.has('place',p.id),false,referenceLocation()),p.name];
      }
      case 'street': {
        const s=cityState().streets.find(s=>s.id===sel.id);
        if(!s){c.ensureCity?.(['streets','settlements']);return [`<article class="city-detail"><button class="btn-quiet" data-action="clear-selection">${ct(i18n,'back')}</button><p>${ct(i18n,cityState().loading?'loading':'notFound')}</p></article>`,ct(i18n,'streets')];}
        return [streetDetail(i18n,s),s.name];
      }
      case 'route': {
        const route = routeEntry(sel.id);
        const onRoute = vehiclesOnRoute(vehicles, sel.id);
        const directions = new Map(onRoute.map((v): [string, string] => [v.id, vehicleDirection(i18n, net, v)]));
        const html = routeDetailMarkup(i18n, { route, vehicles: onRoute, directions, delay: delays().get(sel.id), stops: net ? routeStopSequence(net, sel.id) : [], hasNetwork: net !== null, kiosk: k, stopsOpen: folds.has('stops'), lineFocus: lineFocusRow(), saved: c.saved?.has('route', route.id) ?? false, cast: c.cast });
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
        // Every platform of the named stop, not only the one that was tapped:
        // the 6 leaves from one side and the 11 from the other, and the rider
        // waiting here wants both. The merge itself is arrivalsAt's.
        ensureBoards('zet', group.ids);
        const next = arrivalsAt(boardsFor('zet', group.ids), vehicles, c.now, { stopIds: group.ids });
        const html = stopDetailMarkup(i18n, { stop: group, routes: group.routes.map(routeEntry), counts: countByRoute(vehicles), delays: delays(), isScreenStop: screen !== undefined && group.ids.includes(screen.id), kiosk: k, saved: c.saved?.has('stop', group.id) ?? false, cast: c.cast, arrivals: next.rows, arrivalsStatus: next.status, frozenAt: c.frozenAt });
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
          nextStop: vehicleNextStop(i18n, net, v),
          delay: v.routeId === undefined ? undefined : delays().get(v.routeId),
          following: following === v.id,
          kiosk: k,
          lineFocus: lineFocusRow(),
          cast: c.cast,
        });
        return [html, `${vehicleTitle(i18n, v)} · ${direction}`];
      }
      case 'closure': {
        const item = closureItems(c.snapshots.prometnice).find((x) => x.id === sel.id);
        if (!item) return null;
        return [closureDetailMarkup(i18n, item, k, c.cast), item.title];
      }
    }
  }

  // --- Events: one delegated listener each, on stable nodes -----------------------
  const optionIds = (): string[] => [...content.querySelectorAll<HTMLElement>('[role=option]')].map((el) => el.id);

  /** After a choice the detail replaces the list under the finger or the caret: focus lands on its heading. */
  function focusDetail(): void {
    const heading = content.querySelector<HTMLElement>('h3');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    body.scrollTop = 0;
    stage.scrollTop = 0;
  }

  function choose(kind: string | undefined, value: string): void {
    if (kind === 'select-route') setSelection({ kind: 'route', id: value }, { fit: true });
    else if (kind === 'select-stop') setSelection({ kind: 'stop', id: value }, { fit: true });
    else if (kind === 'select-vehicle') setSelection({ kind: 'vehicle', id: value }, { fit: true });
    else if (kind === 'select-closure') setSelection({ kind: 'closure', id: value }, { fit: true });
    else if (kind === 'select-place') setSelection({ kind:'place',id:value },{fit:true});
    else if (kind === 'select-street') setSelection({kind:'street',id:value});
    else return;
    focusDetail();
  }

  function clearSearch(): void {
    query = '';
    searchInput.value = '';
    activeOption = null;
    ctx().setFilter?.('city-query','');
    renderSheet();
  }

  element.addEventListener('click', (event) => {
    const origin = event.target instanceof Element ? event.target : null;
    const target = origin?.closest<HTMLElement>('[data-action]') ?? null;
    if (!input) return;
    if (!target) {
      // A tap on the peek row itself (not on its chevron) is the same step as the chevron on the phone.
      if (sheet && origin && sheetHead.contains(origin)) sheet.cycle();
      return;
    }
    const action = target.dataset.action;
    const value = target.dataset.id ?? '';
    if(ctx().session?.frozen)return;
    if (action?.startsWith('select-')) {
      choose(action, value);
      return;
    }
    switch (action) {
      case 'bike-mode':bikeMode=target.dataset.mode==='return'?'return':'rent';updateCityMap();renderSheet();break;
      case 'city-group':
        cityGroup=target.dataset.group as CityGroup;cityCategory='';cityLimit=20;selection=null;
        if(mapMode==='schema'&&cityGroup!=='transport')ctx().mapMode?.set('map');
        relay(null);saveCityFilters();askCity();updateCityMap();renderSheet();break;
      case 'city-category':
        cityCategory=target.dataset.category??'';cityLimit=20;selection=null;
        if(cityCategory==='cycle-paths')ctx().ensureCity?.(['cycle-paths']);
        saveCityFilters();askCity();updateCityMap();renderSheet();break;
      case 'city-window':
        activityWindow=target.dataset.window as ActivityWindow;saveCityFilters();updateCityMap();renderSheet();break;
      case 'city-more': cityLimit+=20;renderSheet();break;
      case 'city-area':
        if(camera){cityCenter={lon:camera.center[0],lat:camera.center[1]};cityReferenceKind='area';ctx().setLocation?.(referenceLocation());}
        updateCityMap();renderSheet();break;
      case 'city-locate':
        navigator.geolocation?.getCurrentPosition(p=>{
          if(disposed||ctx().session?.frozen)return;
          cityCenter={lon:p.coords.longitude,lat:p.coords.latitude};
          cityReferenceKind='device';
          ctx().setLocation?.(referenceLocation());
          handle?.setView?.({center:[cityCenter.lon,cityCenter.lat],zoom:15});
          updateCityMap();renderSheet();
        },
          ()=>{statusEl.hidden=false;statusEl.textContent=ct(ctx().i18n,'locationDenied');},{timeout:10000,maximumAge:60000});
        break;
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
        // Half first, as in setSelection: the fit is padded for the sheet the person will see.
        sheet?.set('half');
        handle?.fit?.('selection');
        break;
      case 'fit-city':
        handle?.fit?.('city');
        break;
      case 'toggle-map-mode':
        if (!kiosk() && !ctx().lightweight) ctx().mapMode?.set(mapMode === 'schema' ? 'map' : 'schema');
        break;
      case 'toggle-line-focus': {
        // The store, where there is one, brings the change back through the
        // page's own re-render; the second call is then the no-op.
        const next = !lineFocus;
        ctx().lineFocus?.set(next);
        setLineFocus(next);
        break;
      }
      case 'toggle-mode': {
        // The schema has one visible mode. Keep the geographic filters for the return to the city map.
        if (mapMode === 'schema') break;
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
        // The chevron: the next detent on the phone; on the desk the board column collapses or comes back.
        if (sheet) sheet.cycle();
        else ctx().mapView?.toggle();
        break;
      case 'toggle-delays':
        delaysOpen = !delaysOpen;
        renderSheet();
        break;
      case 'toggle-fold': {
        const fold = target.dataset.fold as Fold | undefined;
        if (!fold) break;
        if (folds.has(fold)) folds.delete(fold);
        else folds.add(fold);
        renderSheet();
        break;
      }
      case 'toggle-full': {
        // "Proširi kartu" collapses the sheet to its peek and asks the page for the map view; "Skupi kartu" returns to half.
        const view = ctx().mapView;
        if (!view) break;
        sheet?.set(view.full ? 'half' : 'peek');
        view.toggle();
        break;
      }
      case 'clear-search':
        clearSearch();
        searchInput.focus();
        break;
    }
  });

  searchInput.addEventListener('focus', () => {
    // Keyboard focus must be visible immediately, not after the sheet's
    // transition. Its taller summary must never travel under the tab bar.
    sheet?.set('open', { animate: false });
    q<HTMLDetailsElement>('.city-filter-disclosure').open = false;
  });
  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    browseReturn = null;
    ctx().setFilter?.('city-query',query);
    activeOption = null;
    if (query) {
      askCity();
      ensureCatalogue();
      raise();
    }
    renderSheet();
    updateCityMap();
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

  // Escape anywhere in the sheet clears the selection, else steps the sheet one detent down; the map handles its own
  // (city-map.ts) and reports through onSelect, and the page's full-map Escape (dashboard.ts) is left to bubble.
  element.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !input || event.target === searchInput) return;
    if (event.target instanceof Node && mapRegion.contains(event.target)) return;
    if (selection) {
      event.preventDefault();
      event.stopPropagation();
      setSelection(null);
      return;
    }
    if (sheet && ctx().mapView?.full !== true && sheet.detent() !== 'peek') {
      event.preventDefault();
      sheet.down();
    }
  });

  // --- The map slot -----------------------------------------------------------------
  /** Asks the page's slots for the one map, moves its container in and binds the handle they hand back (a new one after a kiosk's destroy()). */
  function syncMap(c: LayerContext, points: MapPoint[], lines: MapLine[]): void {
    const renderer = c.lightweight || (c.city&&(cityGroup!=='transport'||cityCategory!=='')) ? 'map' : c.mapMode?.snapshot() ?? 'map';
    const slotId = renderer === 'schema' ? SCHEMA_MAP_SLOT_ID : MAP_SLOT_ID;
    if (slotId !== activeSlotId || (c.maps?.handle(slotId) ?? null) !== handle) {
      // Fits and following can move the camera without onUserMove. Read it while the old map still exists.
      if (mapMode === 'map') camera = handle?.camera?.() ?? camera;
      activeSlotId = slotId;
      mapEpoch += 1;
      handle = null;
      status = 'loading';
    }
    mapMode = renderer;
    const epoch = mapEpoch;
    const i18n = c.i18n;
    const reports = points.filter((p) => p.at !== undefined).length;
    // The diagram omits buses, closures and unplaceable trams, so the geographic
    // report counts would overstate what a reader can find on that surface.
    const label = renderer === 'schema'
      ? `${tr(i18n, 'mapModeSchema')}: ${tr(i18n, 'schemaTramsOnly')}`
      : `${tr(i18n, 'mapRegion')}: ${i18n.t('panels.vehiclesCount', { count: reports })}, ${i18n.t('panels.closuresCount', { count: lines.length })}`;
    const canvas =
      c.maps?.slot({
        id: slotId,
        renderer,
        className: 'map-canvas t-map-canvas',
        testid: 'map-canvas',
        ariaLabel: label,
        points:[...points,...cityMapPoints()],
        lines,
        reducedMotion: c.reducedMotion,
        theme: c.screen?.theme,
        locale: i18n.getLocale(),
        stop: c.screen?.stop ?? null,
        selection,
        follow: following,
        modes: modesArg(),
        closures: renderer === 'map' && closuresVisible,
        interactive: !kiosk(),
        // The public screen keeps its own contract: the whole network, always.
        lineFocus: kiosk() ? undefined : lineFocus,
        symbolScale: kiosk() ? KIOSK_SYMBOL_SCALE : 1,
        presentationProfile: kiosk() ? 'public-display' : mode === 'desk' ? 'desktop' : 'handheld',
        hitTolerancePx: mode === 'desk' ? 8 : 22,
        // The compact credit on the phone stage, where the sheet leaves the map little room; the full line on the desk and the kiosk.
        attributionCompact: !kiosk(),
        fitPadding: fitPadding(),
        center: renderer === 'map' ? camera?.center : undefined,
        zoom: renderer === 'map' ? camera?.zoom : undefined,
        onSelect: (sel) => { if (epoch === mapEpoch) setSelection(sel); },
        resolveStreet:(name,point)=>matchStreet(name,point,cityState().streets,cityState().settlements)?.id??null,
        onStatus: (next) => {
          if (epoch !== mapEpoch) return;
          status = next;
          renderStatus();
          renderSheet();
        },
        onNetwork: (network) => {
          if (epoch !== mapEpoch) return;
          net = network;
          if (network) groups = stopGroupsFromNetwork(network);
          renderSheet();
        },
        onUserMove: (cam) => {
          if (epoch !== mapEpoch) return;
          if (cam !== null && renderer === 'map') camera = cam;
          if(cam){cityCenter={lon:cam.center[0],lat:cam.center[1]};cityReferenceKind='area';ctx().setLocation?.(referenceLocation());}
          updateCityMap();
          renderSheet();
          if (following) {
            following = null;
            handle?.follow?.(null);
            renderSheet();
          }
        },
      }) ?? null;
    if (canvas) {
      if (canvas.parentElement !== mapRegion) mapRegion.insertBefore(canvas, mapRegion.firstChild);
      const next = c.maps?.handle(slotId) ?? null;
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
    handle?.setPresentationProfile?.(kiosk()?'public-display':mode==='desk'?'desktop':'handheld');
  }

  function render(next: WorkspaceInput): void {
    if(disposed)return;
    input = next;
    const c = next.ctx;
    if (!stateRestored) {
      stateRestored = true;
      const remembered = c.view?.filters['city-query'] ?? '';
      if (c.view?.selection && remembered) browseReturn = {query:remembered,scroll:Number(c.view.filters['city-scroll'])||0,group:(c.view.filters['city-group'] as CityGroup)??'living',category:c.view.filters['city-category']??''};
      else { query=remembered; searchInput.value=query; restoreSearchSheet=Boolean(query); }
    }
    if(c.onDispose&&!disposalRegistered){
      disposalRegistered=true;c.onDispose(()=>{disposed=true;boards.destroy();sheet?.destroy();resizeObserver?.disconnect();window.removeEventListener('resize',onStageBox);deskMedia?.removeEventListener?.('change',onMedia);landscapeMedia?.removeEventListener?.('change',onMedia);});
    }
    if (!c.city) cityGroup = 'transport'; // legacy hosts retain their transport-only view
    if(!stopCentered){
      stopCentered=true;
      if(c.screen?.stop){camera={center:[c.screen.stop.lon,c.screen.stop.lat],zoom:14};handle?.setView?.({center:camera.center,zoom:camera.zoom});}
    }
    if(c.city&&!streetRequested&&!c.lightweight){streetRequested=true;c.ensureCity?.(['streets','settlements']);}
    const filterKey=JSON.stringify(c.view?.filters??{});
    if(filterKey!==cityFilterKey){
      cityFilterKey=filterKey;
      const group=c.view?.filters['city-group'];
      if(group&&group in GROUP_SOURCES)cityGroup=group as CityGroup;
      cityCategory=c.view?.filters['city-category']??cityCategory;
      const window=c.view?.filters['city-window'];if(['week','today','tomorrow'].includes(window??''))activityWindow=window as ActivityWindow;
    }
    askCity();
    if (!modesSettled) {
      modesSettled = true;
      if (kiosk()) modes.delete(ROUTE_TYPE_BUS);
    }
    syncStage();
    if(restoreSearchSheet){restoreSearchSheet=false;sheet?.set('open',{animate:false});ensureCatalogue();}
    // The device's own switch, changed here or anywhere else on the page.
    setLineFocus(c.lineFocus?.snapshot() ?? lineFocus);
    // The page's view mode changed elsewhere (its Escape, another domain): the detent follows it.
    const full = c.mapView?.full === true;
    if (full !== lastFull) {
      lastFull = full;
      sheet?.set(full ? 'peek' : 'half');
    }
    // A selection the page navigated to (history, a paired screen's relay): a
    // route or stop by id, a vehicle or closure by public item key, applied
    // once per change and fitted; one that names nothing on this page clears.
    const pub = c.view?.selection ?? null;
    const key = JSON.stringify(pub);
    let changed = false;
    let returnScroll: number | null = null;
    if (key !== viewKey) {
      viewKey = key;
      // The page reports something new; unless it is the echo of this workspace's own relay, it is the person's
      // history or a paired screen speaking, and it wins.
      if (key !== relayedKey) {
        const vehicles = next.points.filter((p) => p.at !== undefined).map((p) => p.id);
        const closures = closureItems(c.snapshots.prometnice).map((item) => item.id);
        const incoming = fromPublic(pub, { vehicles, closures }, groups);
        if (incoming || selection) {
          if(incoming?.kind==='route'||incoming?.kind==='stop'||incoming?.kind==='vehicle'||incoming?.kind==='closure'){cityGroup='transport';cityCategory='';}
          selection = incoming;
          following = null;
          changed = true;
          if(!incoming&&browseReturn){
            query=browseReturn.query;searchInput.value=query;
            cityGroup=browseReturn.group;cityCategory=browseReturn.category;
            returnScroll=browseReturn.scroll;browseReturn=null;
            sheet?.set('open',{animate:false});
          }
        }
        relayedKey = key;
      }
    }
    // A selection the page brought lifts the sheet to half like any other, before the map fits to it.
    if (changed && selection) sheet?.set('half');
    syncMap(c, next.points, next.lines);
    handle?.setModes?.(modesArg());
    if(c.city) {
      const selected=selection?.kind==='place'?cityState().places.find(p=>p.id===selection!.id):null;
      handle?.setOutline?.(selected?.polygons?{id:selected.id,polygons:selected.polygons}:null);
      const paths=cityCategory==='cycle-paths'?cityState().paths.flatMap(p=>p.lines.map((coordinates,i)=>({id:`${p.id}-${i}`,title:p.name,coordinates}))):[];
      handle?.setCityPaths?.(paths);
    }
    // Reference chunks are loaded on explicit discovery, never all on map boot.
    // An outage is no evidence of motion: the map holds every vehicle where it is until the feed is live again.
    handle?.setFeedState?.(c.snapshots['zet-rt']?.status ?? 'down');
    if (changed) handle?.select?.(selection, { fit: selection !== null });
    onStageBox();
    renderSheet();
    if(returnScroll!==null)body.scrollTop=returnScroll;
  }

  return { element, render };
}
