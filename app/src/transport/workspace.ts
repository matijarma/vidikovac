// The transport workspace behind the U pokretu layer: one persistent
// controller per page. The dashboard rebuilds its layer section on every
// poll and hands the same context back; this element is moved into the new
// section, never rebuilt, so the search text, the focus, the sheet's detent,
// the selection, the followed vehicle and the MapLibre camera (map-slots.ts
// keeps the map itself) all survive a poll. Content re-renders set innerHTML
// on two stable containers and restore focus by id; every interaction is one
// delegated listener on the root, so no handler ever sits on a node the next
// render discards. The chrome (the sheet head with its map/schema switch, the
// search) is built once and updated in place.
//
// Karta is the timeline's map [O-50]: it opens framed on the place (the same
// place Sada is titled with, city/place.ts), with every vehicle drawn at once
// and the city's curated marks (city/curated.ts: BAJS discs with their counts,
// the venues with a programme tonight), and its sheet opens on the place's
// "U blizini" rows (ctx.nearby, the page's). There is no group, no category and
// no tools menu: one search field reaches routes, stops, places and streets,
// and a category (a toilet, water, a market) is a search, drawn on the map
// only while it is one. The one control over the map is the switch between
// the city map and the schema in the sheet's head [O-72].
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
import { publicItemKey, type PublicSelection, type ScreenStop } from '../core/contracts';
import type { MapMode } from '../core/map-mode-store';
import { loadStops } from '../core/screens';
import type { LayerContext } from '../layers/types';
import type { CityMapHandle, FitPadding, MapCamera, MapLine, MapPoint, MapSelection, MapStatus, VehicleInfo } from '../map/city-map';
import { routeDelayMap } from '../motion/fixes';
import type { Network } from '../../../shared/motion/network';
import { ROUTE_TYPE_BUS, ROUTE_TYPE_TRAM } from '../motion/schematic';
import { escapeHtml as esc } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import { discover, dynamicPlaces, type Discovery } from '../city/discovery';
import { CURATED_WALL, curatedCityPoints } from '../city/curated';
import { resolvePlace, type PlaceContext } from '../city/place';
import { ct } from '../city/strings';
import { searchCity, type CitySearchResult } from '../city/search';
import { placeCategory } from '../city/markup';
import { defaultLocation, type LocationContext } from '../city/location';
import { placeDetail, streetDetail, departuresMarkup } from '../city/markup';
import { createBoardCache, type BoardCache, type BoardOperator } from '../city/boards';
import { arrivalsAt } from '../../../shared/city/arrivals';
import { emptyCity, type DepartureBoard } from '../../../shared/city/types';
import { locatedEvents, type ActivityWindow } from '../../../shared/city/events';
import { DEFAULT_FRAME_STOPS, frameLinesOf, frameRadiusM, frameStopsFrom, type FrameStop } from '../../../shared/city/frame';
import { matchStreet } from '../../../shared/city/geo';
import { routeType } from '../kiosk/stops';
import { frameView } from '../map/frame';
import { reconcile } from '../ui/dom/reconcile';
import { routeCatalogue, routeEntry, routeStopSequence, stopGroupById, stopGroupsFromCatalogue, stopGroupsFromNetwork } from './catalogue';
import { externalTextReady, feedLive } from '../city/feed';
import { vetExternal } from '../../../shared/kiosk/external-text-boundary';
import type { ExternalTextKind } from '../../../shared/kiosk/external-text';
import { closureItems, countByRoute, plausibleDelays, vehicleDirection, vehicleNextStop, vehiclesOnRoute } from './detail';
import type { StopGroup } from './search';
import { createSheet, type SheetController } from './sheet';
import { tr, trPlural } from './strings';
import {
  closureDetailMarkup, routeDetailMarkup, safeId, statusLine, STOP_ARRIVAL_ROWS, stopDetailMarkup, vehicleDetailMarkup, vehicleTitle, type Fold,
} from './view';

/** Separate slots let the page sweep the old renderer and release its resources after a swap. */
export const MAP_SLOT_ID = 'u-pokretu-map';
export const SCHEMA_MAP_SLOT_ID = 'u-pokretu-schema';
/** Symbol size on a public screen read from across a room. */
export const KIOSK_SYMBOL_SCALE = 1.35;
/** "U blizini" rows the Karta sheet shows under the place, as many as Sada's phone list. */
export const KARTA_NEARBY_ROWS = 8;
/** The programme a place's detail lists: its week. */
const PROGRAMME_WINDOW: ActivityWindow = 'week';
/** The stage a first frame fits into before the page has laid the workspace out: a 390 x 600 phone stage. */
const FRAME_FALLBACK_BOX = { width: 390, height: 600 } as const;
/** A tram line is route type 0 (kiosk/stops.ts routeType), the frame's measure (shared/city/frame.ts). */
const isTram = (routeId: string): boolean => routeType(routeId) === ROUTE_TYPE_TRAM;

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

/** The selection a public form names on this page, or null when nothing here matches it: the sheet then shows the place and what is near it. */
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
  // Nothing floats over the map but its own status line; the map/schema
  // switch sits in the sheet's head beside the peek, where every detent keeps
  // it in reach; the search sits under the head; the honesty note is the
  // body's stable foot.
  element.innerHTML = `
    <div class="transport-body">
      <div class="transport-map" id="u-pokretu-map" data-testid="transport-map">
        <p class="t-map-status" role="status" data-testid="map-status" hidden></p>
      </div>
      <aside class="transport-sheet" data-testid="transport-sheet">
        <div class="t-sheet-head" data-ref="sheet-head">
          <span class="t-sheet-handle" aria-hidden="true"></span>
          <div class="t-peek" data-testid="transport-peek"></div>
          <button type="button" class="btn-ghost t-mode" id="${id}-map-mode" data-testid="map-mode-toggle" data-action="toggle-map-mode" hidden></button>
          <button type="button" class="btn-quiet icon-btn t-sheet-toggle" id="${id}-sheet" data-action="toggle-sheet" aria-expanded="false" aria-controls="${ids.body}">${iconMarkup('chevron-down')}</button>
        </div>
        <div class="transport-toolbar" data-testid="transport-toolbar">
          <div class="t-search">
            <label class="visually-hidden" for="${ids.search}" data-ref="search-label"></label>
            <input id="${ids.search}" class="t-search-input" type="search" role="combobox" aria-expanded="false" aria-controls="${ids.results}" aria-autocomplete="list" aria-describedby="${id}-hint" autocomplete="off" spellcheck="false" data-testid="transport-search">
            <button type="button" class="t-search-clear" id="${id}-clear" data-action="clear-search" hidden>&#215;</button>
            <p class="visually-hidden" id="${id}-hint" data-ref="search-hint"></p>
          </div>
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
  const mapRegion = q<HTMLElement>('.transport-map');
  const statusEl = q<HTMLElement>('[data-testid=map-status]');
  const mapModeButton = q<HTMLButtonElement>('[data-testid=map-mode-toggle]');
  const sheetEl = q<HTMLElement>('.transport-sheet');
  const sheetHead = q<HTMLElement>('[data-ref=sheet-head]');
  const peek = q<HTMLElement>('[data-testid=transport-peek]');
  const sheetToggle = q<HTMLButtonElement>(`#${id}-sheet`);
  const body = q<HTMLElement>(`#${ids.body}`);
  const content = q<HTMLElement>('[data-ref=content]');
  const note = q<HTMLElement>('[data-testid=transport-note]');

  // --- State that survives every poll -------------------------------------
  let input: WorkspaceInput | null = null;
  let query = '';
  let browseReturn: { query: string; scroll: number } | null = null;
  let stateRestored = false;
  let restoreSearchSheet = false;
  let activeOption: string | null = null;
  let selection: MapSelection | null = null;
  let following: string | null = null;
  // Every mode is drawn at once on every personal surface [O-50]; only the
  // kiosk board keeps trams first (R-P1), which the first render settles.
  const modes = new Set<number>(ALL_MODES);
  let modesSettled = false;
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
  /** The centre of the map the person last moved to: the reference a search's distances are measured from. */
  let cityCenter: {lon:number;lat:number}|null = null;
  const referenceLocation = (): LocationContext => cityCenter
    ? {...cityCenter,kind:'area',name:''}
    : ctx().location??defaultLocation(ctx().screen);
  /** The frame the camera last took (the place, its circle and the stage's size), and whether the person has moved the map since. */
  let framedKey: string | null = null;
  let movedSinceFrame = false;
  /** The stop table the circle is measured over, rebuilt only when the catalogue or the network changes. */
  let frameTable: { stops: readonly ScreenStop[]; net: Network | null; table: FrameStop[] } | null = null;
  /** The page's nearby list for this render, asked once however often the sheet paints before the next one. */
  let nearbyMemo: { ctx: LayerContext; list: ReturnType<NonNullable<LayerContext['nearby']>> } | null = null;
  let cityLimit = 20;
  let cityData: Discovery|null = null;
  let streetRequested=false;
  let disposed=false;
  let disposalRegistered=false;
  const pollutants=new Map<string,string>();
  const pollutantPending=new Set<string>();
  /** One request per platform per minute, answered to every reader that asked
   *  for it (city/boards.ts). This workspace's own, and destroyed with it. */
  const boards: BoardCache = (deps.createBoards ?? createBoardCache)();
  const cityState = () => ctx().city ?? emptyCity();
  /** What the search finds among the city's places and streets; asked only while something is typed. Category
   *  words ("wc", "voda", "tržnica") still reach their places (city/discovery.ts CATEGORY_TERMS): a category is a
   *  search result, never a filter. */
  function discovery(): Discovery {
    const c=ctx();
    return discover(cityState(),c.snapshots.dogadanja?.items??[],{
      group:'living',category:'',query,window:'today',
      center:referenceLocation(),radius:5000,now:c.frozenAt??c.now});
  }
  function askCity():void {
    const c=ctx(); if(c.session?.frozen)return;
    // The venues with a programme tonight are on the map from the first render; the BAJS stations come with the
    // city's live file (core/city-store.ts start()).
    c.ensureCity?.(['culture']);
    if(query)c.ensureCity?.(['culture','water','toilets','sport','dogs','markets','recycling','wifi','cycle-parking','garages','charging','heritage','streets','hz-schedule']);
  }
  /** The place Karta is framed on and its sheet is titled with: the page's (city/place.ts, the one Sada is
   *  titled with), else resolved here from what this context knows (a kiosk board, a unit context). */
  function placeNow(): PlaceContext {
    const c=ctx();
    return c.place ?? resolvePlace({ screen: c.screen, saved: c.saved, stops: c.stops, location: c.location });
  }
  /** The page's "U blizini" list (ctx.nearby), asked once per render however often the sheet paints. */
  function nearbyList(): ReturnType<NonNullable<LayerContext['nearby']>> {
    const c=ctx();
    if(nearbyMemo?.ctx!==c) nearbyMemo={ctx:c,list:c.nearby?.(KARTA_NEARBY_ROWS)??null};
    return nearbyMemo.list;
  }
  /** The circle the frame fits: the list's own when the page has one, else measured here the same way
   *  (shared/city/frame.ts frameRadiusM over the stop table and, once the map has it, the network's tram lines),
   *  else the six-stop fallback. */
  function frameRadius(place: PlaceContext): number {
    const listed = nearbyList();
    if (listed) return listed.radiusM;
    const stops = ctx().stops ?? [];
    if (!frameTable || frameTable.stops !== stops || frameTable.net !== net) {
      frameTable = { stops, net, table: frameStopsFrom(stops, isTram, net ? frameLinesOf(net) : []) };
    }
    return frameRadiusM(place, frameTable.table, DEFAULT_FRAME_STOPS);
  }
  /** The frame [O-50]: the place at the centre and its measured circle across the stage's shorter side
   *  (map/frame.ts frameView, the wall's own arithmetic). Taken on the first render and again when the place or
   *  its circle changes (a saved stop, the catalogue arriving), but never over a map the person has moved, an
   *  open selection or a followed vehicle. */
  function frameCamera(): void {
    const place = placeNow();
    const radiusM = frameRadius(place);
    // Before the page lays the stage out (the first render happens off the document) a phone's stage stands in;
    // the stage's own first layout frames again at its real size.
    const laidOut = stage.clientWidth > 0 && stage.clientHeight > 0;
    const width = laidOut ? stage.clientWidth : FRAME_FALLBACK_BOX.width;
    const height = laidOut ? stage.clientHeight : FRAME_FALLBACK_BOX.height;
    const key = `${place.lon.toFixed(5)},${place.lat.toFixed(5)}|${Math.round(radiusM / 10)}|${Math.round(width / 40)}x${Math.round(height / 40)}`;
    if (key === framedKey) return;
    if (framedKey !== null && (movedSinceFrame || selection || following || query)) return;
    framedKey = key;
    movedSinceFrame = false;
    camera = frameView(place, radiusM, width, height);
    if (mapMode === 'map') handle?.setView?.({ center: camera.center, zoom: camera.zoom });
  }
  /** The city's own marks: the curated set the wall draws (city/curated.ts, CURATED_WALL: every BAJS station as
   *  a disc with its count, the venues with a programme tonight, never a "+N" bubble), the places a search finds
   *  while it is typed, and the selected place, which stays on the map whatever the search says. */
  function cityMapPoints():MapPoint[] {
    if(!input||!ctx().city)return [];
    const c=ctx(),now=c.frozenAt??c.now;
    const curated=curatedCityPoints(cityState(),c.snapshots.dogadanja?.items??[],now,CURATED_WALL);
    const searched=query?(cityData=discovery()).points:[];
    const selected=selection?.kind==='place'?[...cityState().places,...dynamicPlaces(cityState(),now)].find(p=>p.id===selection!.id):null;
    const seen=new Set<string>(),points:MapPoint[]=[];
    for(const point of [...curated,...searched]){
      if(point.id===selected?.id||seen.has(point.id))continue;
      seen.add(point.id);points.push(point);
    }
    if(selected&&Number.isFinite(selected.lon)&&Number.isFinite(selected.lat)){
      points.push(curated.find(p=>p.id===selected.id)??searched.find(p=>p.id===selected.id)
        ??{id:selected.id,title:selected.name,lon:selected.lon!,lat:selected.lat!,place:'city' as const,props:{category:selected.category,eventCount:0,badge:'',priority:0}});
    }
    return points;
  }
  function updateCityMap():void {
    if(!input || !ctx().city)return;
    handle?.update([...input.points,...cityMapPoints()],input.lines);
    handle?.setModes?.(modesArg());
    const selected=selection?.kind==='place'?cityState().places.find(p=>p.id===selection!.id):null;
    handle?.setOutline?.(selected?.polygons?{id:selected.id,polygons:selected.polygons}:null);
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
  /** null, every mode, on every personal surface: the map then also draws vehicles of a type nobody knows. The
   *  schema has trams alone, and the kiosk board keeps trams first (R-P1). */
  const modesArg = (): ReadonlySet<number> | null => (
    kiosk() ? new Set(modes) : mapMode === 'schema' ? new Set([ROUTE_TYPE_TRAM]) : null
  );
  const delays = (): Map<string, number> => plausibleDelays(routeDelayMap(ctx().snapshots['zet-rt']));

  /** Every vehicle the model has placed, or, before that and without a map, the reports listed by route alone.
   *  A route or stop someone asks about answers for its own vehicles whatever the map draws. */
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

  /** The one place the selection changes: state, the sheet's detent, the map, the paired screen, then the sheet's content.
   *  A selection lifts the sheet to half, never leaves it at peek; a stop opens it, so its three departures and "Vozni red"
   *  are in the viewport at once (§11, §16.4): the board is the answer, the map is one chevron away. */
  function setSelection(next: MapSelection | null, opts: { fit?: boolean; relay?: boolean } = {}): void {
    if(ctx().session?.frozen)return;
    if (next && query) {
      browseReturn = { query, scroll: body.scrollTop };
      ctx().setFilter?.('city-scroll',String(body.scrollTop));
    }
    if(next?.kind==='place'||next?.kind==='street'){
      if(mapMode==='schema')ctx().mapMode?.set('map');
      askCity();
    }
    if (next?.kind === 'stop' && !next.ids) next = { ...next, ids: groupFor(next.id)?.ids };
    selection = next;
    updateCityMap();
    folds.delete('stops');
    if (next?.kind !== 'vehicle' && following) {
      following = null;
      handle?.follow?.(null);
    }
    // The sheet settles at its detent before the map moves, so the fit is padded for the detent the person will see;
    // padded for an open sheet MapLibre has no room left and refuses the fit, so a stop's board opens without one
    // ("Prikaži na karti" in the board brings the map to the stop when the person wants it).
    const opens = next?.kind === 'stop' && mode === 'phone';
    if (next) sheet?.set(opens ? 'open' : 'half');
    handle?.select?.(next, { fit: opens ? false : opts.fit });
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
  // layer appends it, layers/u-pokretu.ts) and which follows the stage's width and the column's slide (the page's
  // map view): the stage's own observer reports it at the first layout and on every resize, the column's transition
  // at its end, and every render again. On the phone the detent controller owns it. The same first layout frames
  // the camera at the stage's real size (frameCamera).
  const onStageBox = (): void => {
    if (!sheet) syncFitPadding();
    if (input && !disposed) frameCamera();
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

  /** The controls' words and states, updated in place: the locale may have changed, the map mode may have. */
  function renderChrome(): void {
    const c = ctx();
    const i18n = c.i18n;
    const k = kiosk();
    const schema = mapMode === 'schema';
    element.dataset.kiosk = k ? 'true' : 'false';
    element.dataset.mapMode = mapMode;
    toolbar.hidden = k;
    // One name for the one field, and the same words as its placeholder: it finds places, streets, lines and stops.
    searchLabel.textContent = ct(i18n, 'search');
    searchInput.placeholder = ct(i18n, 'search');
    searchHint.textContent = tr(i18n, 'searchHint');
    clearButton.setAttribute('aria-label', tr(i18n, 'clearSearch'));
    clearButton.hidden = query === '';
    // The map/schema switch [O-72]: one small control that names where it goes ("Shema" on the map, "Karta" on the
    // schema), its accessible name the longer form of the same words. Offered only where the device store can keep
    // the answer and there is a map to switch: not on a public screen, not on the lightweight path.
    mapModeButton.hidden = k || c.lightweight === true || !c.mapMode || !c.maps;
    mapModeButton.dataset.mode = mapMode;
    mapModeButton.innerHTML = `${iconMarkup(schema ? 'map' : 'route')}<span>${esc(i18n.t(schema ? 'sada.viewMap' : 'sada.viewSchema'))}</span>`;
    mapModeButton.setAttribute('aria-label', tr(i18n, schema ? 'mapModeMap' : 'mapModeSchema'));
    sheetEl.setAttribute('aria-label', tr(i18n, 'sheetLabel'));
    sheetToggle.hidden = k;
    renderSheetToggle();
    if (!sheet) element.dataset.sheet = mode === 'landscape' ? 'half' : 'open';
    // A public display prints no caveat (companion brief §12 "Never"). On the
    // phone the schema owns this note beside its canvas; the sheet keeps its
    // copy only for geography or a failed renderer, where that note is absent.
    note.textContent = k ? '' : i18n.t('motion.note');
    note.hidden = k || (schema && status !== 'unavailable');
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

  /** The sheet: search results while typing, the selection's detail, else the place and what is near it; and the peek line above it. */
  function renderSheet(): void {
    if (!input||disposed) return;
    const i18n = ctx().i18n;
    const vehicles = vehiclesNow();
    let html: string;
    let peekHtml: string;
    let peekText: string | null = null;
    /** The peek line's text kind: the detail's own (a name, or a title for a vehicle's composed line), fixed copy otherwise. */
    let peekKind: ExternalTextKind = 'title';
    if (query) {
      cityData=discovery();
      // Every result's name and detail are third-party text (GTFS, the registers): vetted by kind before the row is drawn,
      // and a result whose name fails the row rule is not offered at all.
      const results = searchCity(query, routeCatalogue(), groups ?? [], cityData.places, cityData.streets)
        .map((r) => ({ r, texts: resultTexts(r) })).filter(({ texts }) => texts.name !== '');
      const total = results.length;
      if (activeOption && !results.some(({ r }) => ids.option(r.kind, r.id) === activeOption)) activeOption = null;
      const label = (r: CitySearchResult) => r.kind === 'place' ? placeCategory(i18n,r.record) : r.kind === 'street' ? ct(i18n,'streets') : tr(i18n,r.kind === 'stop' ? 'stop' : 'route');
      html = `<div id="${ids.results}" role="listbox" data-testid="transport-results" aria-label="${esc(ct(i18n,'search'))}">${results.slice(0,cityLimit).map(({ r, texts }) =>
        `<div class="city-row t-search-result" role="option" tabindex="-1" aria-selected="${ids.option(r.kind,r.id)===activeOption}" id="${ids.option(r.kind,r.id)}" data-action="select-${r.kind}" data-id="${esc(r.id)}"><span class="city-row-main"><span class="city-kicker">${esc(label(r))}</span><strong>${esc(texts.name)}</strong><span class="city-meta">${esc(texts.detail)}</span></span></div>`).join('')}</div>`;
      if(total>cityLimit)html+=`<button class="btn-quiet" data-action="city-more">${ct(i18n,'more')} (${total-cityLimit})</button>`;
      // Until the text policy is in hand (the feed chunk, requested at mount) every name is refused: the list is loading, not empty.
      if(!total)html+=`<p role="status">${ct(i18n,cityState().loading||!externalTextReady()?'loading':'noResults')}</p>`;
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
        [html, peekText, peekKind] = detail;
        // The peek repeats the detail's third-party text (a place's or street's name, a route's long name, a stop's
        // name, a vehicle's headsign, a closure's street): vetted once here under the detail's kind, on the row surface,
        // so a string the rule refuses leaves the peek empty rather than printed above the sheet.
        peekText = vetExternal(peekKind, peekText, 'row') ?? '';
        peekHtml = esc(peekText);
      } else {
        [html, peekHtml] = nearbySheet();
      }
    }
    if (query && activeOption) searchInput.setAttribute('aria-activedescendant', activeOption);
    else searchInput.removeAttribute('aria-activedescendant');
    peek.innerHTML = following && selection?.kind === 'vehicle' && peekText ? esc(tr(i18n, 'peekFollowing', { title: peekText })) : peekHtml;
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

  /** Nothing typed and nothing selected: the place as the peek's title with the list's circle beside it, and the
   *  place's "U blizini" rows as the body -- the page's list (ctx.nearby), the same rows Sada shows, so the sheet
   *  answers what is near before it explains anything. No fleet count, no line-by-line delays, no notices: those
   *  left the phone with the overview (WP4). */
  function nearbySheet(): [string, string] {
    const c = ctx();
    const list = nearbyList();
    // The place's name is the catalogue's or the operator's text: vetted before the peek says it.
    const peekHtml = `<strong>${esc(vetExternal('name', placeNow().name, 'row') ?? '')}</strong>${list ? `<span class="t-peek-pill">${esc(list.pill)}</span>` : ''}`;
    if (list) return [list.html, peekHtml];
    // The page has a list but not its rows yet (the selection code loads with its own chunk): one quiet line.
    return [c.nearby ? `<p class="t-empty" role="status" aria-busy="true" data-testid="nearby-pending">${esc(c.i18n.t('status.loading'))}</p>` : '', peekHtml];
  }

  /** A search result's name and detail as the row prints them: each field under its own kind (a route's number and
   *  long name, a stop's name and its lines, a place's name and address, a street's name and settlement), '' when it fails. */
  function resultTexts(r: CitySearchResult): { name: string; detail: string } {
    const vet = (kind: ExternalTextKind, value: string | undefined): string => vetExternal(kind, value ?? '', 'row') ?? '';
    switch (r.kind) {
      case 'route': return { name: vet('headsign', r.record.short), detail: vet('name', r.record.long) };
      case 'stop': return { name: vet('name', r.record.name), detail: r.record.routes.map((id) => vet('headsign', id)).filter(Boolean).join(', ') };
      case 'place': return { name: vet('name', r.record.name), detail: vet('address', r.record.address) };
      case 'street': return { name: vet('name', r.record.name), detail: vet('name', r.record.settlement) };
    }
  }

  /** The selection's detail, its one-line summary and the summary's text kind (renderSheet vets it); null once the thing has gone. */
  function detailMarkup(sel: MapSelection, vehicles: readonly VehicleInfo[]): [string, string, ExternalTextKind] | null {
    const c = ctx();
    const i18n = c.i18n;
    const k = kiosk();
    switch (sel.kind) {
      case 'place': {
        const p=[...cityState().places,...dynamicPlaces(cityState(),c.now)].find(p=>p.id===sel.id);
        if(!p){c.ensureCity?.(['culture','heritage','water','toilets','sport','dogs','recycling','markets','wifi','cycle-parking','garages','charging','hz-schedule']);return [`<article class="city-detail"><button class="btn-quiet" data-action="clear-selection">${ct(i18n,'back')}</button><p>${ct(i18n,cityState().loading?'loading':'notFound')}</p></article>`,ct(i18n,'selected'),'title'];}
        return [placeDetail(i18n,p,cityState(),locatedEvents(c.snapshots.dogadanja?.items??[],cityState().places,c.now,PROGRAMME_WINDOW),c.saved?.has('place',p.id),false,referenceLocation()),p.name,'name'];
      }
      case 'street': {
        const s=cityState().streets.find(s=>s.id===sel.id);
        if(!s){c.ensureCity?.(['streets','settlements']);return [`<article class="city-detail"><button class="btn-quiet" data-action="clear-selection">${ct(i18n,'back')}</button><p>${ct(i18n,cityState().loading?'loading':'notFound')}</p></article>`,ct(i18n,'streets'),'title'];}
        return [streetDetail(i18n,s),s.name,'name'];
      }
      case 'route': {
        const route = routeEntry(sel.id);
        const onRoute = vehiclesOnRoute(vehicles, sel.id);
        const directions = new Map(onRoute.map((v): [string, string] => [v.id, vehicleDirection(i18n, net, v)]));
        const html = routeDetailMarkup(i18n, { route, vehicles: onRoute, directions, delay: delays().get(sel.id), stops: net ? routeStopSequence(net, sel.id) : [], hasNetwork: net !== null, kiosk: k, stopsOpen: folds.has('stops'), lineFocus: lineFocusRow(), saved: c.saved?.has('route', route.id) ?? false, cast: c.cast });
        return [html, route.long ? `${route.short} · ${route.long}` : tr(i18n, 'routeTitle', { short: route.short }), 'name'];
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
        const held = boardsFor('zet', group.ids);
        // Live only while the feed is (city/feed.ts feedLive, the wall's rule): no live time during an outage or once
        // the feed's last word is older than the twin keeps a fix.
        const live = feedLive(c.snapshots['zet-rt'], c.now) ? vehicles : [];
        const next = arrivalsAt(held, live, c.now, { stopIds: group.ids, rows: STOP_ARRIVAL_ROWS });
        // "Vozni red" is the timetable: the same boards read without the fleet.
        const timetable = arrivalsAt(held, [], c.now, { stopIds: group.ids, rows: STOP_ARRIVAL_ROWS }).rows;
        // One frozen moment for the sheet: the shell's own, else now when only the session flag says so.
        const frozenAt = c.frozenAt ?? (c.session?.frozen ? c.now : undefined);
        const html = stopDetailMarkup(i18n, { stop: group, routes: group.routes.map(routeEntry), counts: countByRoute(vehicles), delays: delays(), isScreenStop: screen !== undefined && group.ids.includes(screen.id), kiosk: k, saved: c.saved?.has('stop', group.id) ?? false, cast: c.cast, arrivals: next.rows, timetable, arrivalsStatus: next.status, frozenAt });
        return [html, `${tr(i18n, 'stop')} ${group.name}`, 'name'];
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
        return [html, `${vehicleTitle(i18n, v)} · ${direction}`, 'title'];
      }
      case 'closure': {
        const item = closureItems(c.snapshots.prometnice).find((x) => x.id === sel.id);
        if (!item) return null;
        return [closureDetailMarkup(i18n, item, k, c.cast), item.title, 'name'];
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
    // The places the search drew leave the map with it.
    updateCityMap();
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
      case 'city-more': cityLimit+=20;renderSheet();break;
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
      case 'toggle-sheet':
        // The chevron: the next detent on the phone; on the desk the board column collapses or comes back.
        if (sheet) sheet.cycle();
        else ctx().mapView?.toggle();
        break;
      case 'toggle-fold': {
        const fold = target.dataset.fold as Fold | undefined;
        if (!fold) break;
        if (folds.has(fold)) folds.delete(fold);
        else folds.add(fold);
        renderSheet();
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
    const renderer = c.lightweight ? 'map' : c.mapMode?.snapshot() ?? 'map';
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
        // The map's own stop, the ring it draws largest: the screen's, else the place's departures stop (Sada's band
        // does the same), so a screenless session's place still carries its ring on Karta.
        stop: c.screen?.stop ?? placeNow().departuresStop ?? null,
        selection,
        follow: following,
        modes: modesArg(),
        closures: renderer === 'map',
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
          if (cam !== null && renderer === 'map') { camera = cam; movedSinceFrame = true; }
          if(cam){cityCenter={lon:cam.center[0],lat:cam.center[1]};ctx().setLocation?.(referenceLocation());}
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
    // The page's list is asked for afresh on every render (the context may be the same object with new rows).
    nearbyMemo = null;
    const c = next.ctx;
    if (!stateRestored) {
      stateRestored = true;
      const remembered = c.view?.filters['city-query'] ?? '';
      if (c.view?.selection && remembered) browseReturn = {query:remembered,scroll:Number(c.view.filters['city-scroll'])||0};
      else { query=remembered; searchInput.value=query; restoreSearchSheet=Boolean(query); }
    }
    if(c.onDispose&&!disposalRegistered){
      disposalRegistered=true;c.onDispose(()=>{disposed=true;boards.destroy();sheet?.destroy();resizeObserver?.disconnect();window.removeEventListener('resize',onStageBox);deskMedia?.removeEventListener?.('change',onMedia);landscapeMedia?.removeEventListener?.('change',onMedia);});
    }
    if(c.city&&!streetRequested&&!c.lightweight){streetRequested=true;c.ensureCity?.(['streets','settlements']);}
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
          selection = incoming;
          following = null;
          changed = true;
          if(!incoming&&browseReturn){
            query=browseReturn.query;searchInput.value=query;
            returnScroll=browseReturn.scroll;browseReturn=null;
            sheet?.set('open',{animate:false});
          }
        }
        relayedKey = key;
      }
    }
    // A selection the page brought lifts the sheet to half like any other, before the map fits to it.
    if (changed && selection) sheet?.set('half');
    // The frame first, so a map made on this render opens on it.
    frameCamera();
    syncMap(c, next.points, next.lines);
    handle?.setModes?.(modesArg());
    if(c.city) {
      const selected=selection?.kind==='place'?cityState().places.find(p=>p.id===selection!.id):null;
      handle?.setOutline?.(selected?.polygons?{id:selected.id,polygons:selected.polygons}:null);
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
