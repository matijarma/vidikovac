// The Kvart panel (plan B.5, D6, D9): the phone's Kvart tab workspace and the
// desktop's sticky aside, built from the same body -- the map (or, lagano
// and before the worker ships districts, its text line), the saved chips,
// the walking row, the cast section, the notify row and the local note.
import type { FeedItem, ModuleId, ModuleSnapshot } from '../../../worker/feed/schema';
import type { AreaSlug } from '../../../worker/pairing/areas';
import type { CastState } from '../core/contracts';
import { kvartLabel } from '../core/kvart-store';
import { activeCount, NOTIFY_KEYS } from '../core/notify-store';
import type { SavedRef } from '../core/saved-store';
import type { I18n } from '../i18n/i18n';
import { districtBySlug } from '../kiosk/districts';
import type { LayerContext } from '../layers/types';
import { vehicleKind, ZAGREB_CENTER, type MapLine, type MapPoint } from '../map/city-map';
import { dataText } from '../panels/panel';
import { routeEntry } from '../transport/catalogue';
import { tr, trPlural } from '../transport/strings';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import { lineBadge } from './blocks';
import { kvartMenuMarkup } from './chrome';
import { distanceKm } from './text';
import { dynamicPlaces, sourceForPlaceId } from '../city/discovery';
import { ct } from '../city/strings';

export type KvartMode = 'workspace' | 'aside';

/** The cast state as the dashboard hands it over: `sentAt` marks the moment after a cast, while the button carries data-sent. */
type CastView = CastState & { sentAt?: number | null };

/** What the panel polls: works and closures for the kvart counts, plus the live delays when a route is saved (B.10). */
export function KVART_MODULES(saved: readonly SavedRef[]): ModuleId[] {
  const modules: ModuleId[] = ['prometnice', 'dogadanja'];
  if (saved.some((ref) => ref.kind === 'route')) modules.push('zet-rt');
  return modules;
}

/** Why "Prebaci na zaslon" cannot fire, in words (D5); shared with the transport detail head's ghost cast button. */
export function castReasonText(i18n: I18n, cast: CastView | undefined): string {
  if (!cast?.can) {
    switch (cast?.reason ?? 'connecting') {
      case 'no-screen': return i18n.t('cast.noScreen');
      case 'peer': return i18n.t('cast.peer');
      case 'frozen': return i18n.t('cast.frozen');
      case 'screen-offline': return i18n.t('presentation.offline');
      case 'unsupported': return i18n.t('presentation.unsupported');
      default: return i18n.t('cast.connecting');
    }
  }
  // The screen is named by its operator label, then its stop; a reloaded view without either says nothing extra.
  if (cast.screenLabel && cast.stopName) return i18n.t('cast.targetStop', { label: cast.screenLabel, stop: cast.stopName });
  const name = cast.screenLabel ?? cast.stopName;
  return name ? i18n.t('cast.target', { label: name }) : '';
}

/** The primary: "Prebaci na zaslon" (D5), disabled but readable with the reason when it cannot fire. */
function castSection(i18n: I18n, cast: CastView | undefined): string {
  const can = cast?.can ?? false;
  const why = castReasonText(i18n, cast);
  const disabled = can ? '' : ` aria-disabled="true" title="${escapeAttribute(why)}"`;
  const sent = cast?.sentAt != null ? ' data-sent="1"' : '';
  return `<div class="kv-sec kv-castsec" data-key="cast"><button type="button" class="btn btn-primary kv-cast" data-action="cast" data-testid="cast-screen" aria-describedby="kv-cast-why"${disabled}${sent}>${iconMarkup('cast')}<span>${escapeHtml(i18n.t('cast.toScreen'))}</span></button><p class="kv-cast-why" id="kv-cast-why" data-testid="cast-why">${escapeHtml(why)}</p></div>`;
}

function mapLink(i18n: I18n, ctx: LayerContext): string {
  const stop = ctx.screen?.stop;
  const selection = stop ? ` data-selection="${escapeAttribute(JSON.stringify({ kind: 'stop', id: stop.id }))}"` : '';
  return `<a class="kv-maplink" href="#layer=u-pokretu" data-action="nav" data-layer="u-pokretu"${selection} data-testid="kvart-map-link"><span>${escapeHtml(i18n.t('kvart.map'))}</span>${iconMarkup('arrow-up-right', undefined, 'icon icon-sm')}</a>`;
}

// --- Works and closures, scoped to a kvart (D6, D18) ------------------------

/** Komunalne items "u tijeku" (in progress), scoped to `kvart`; every one of them city-wide when it is null (the
 *  whole city, or before the worker ships `data.district` -- T2.1, D6). `district` is read defensively via
 *  `dataText` since it lands on the item's flat `data` bag additively and is not guaranteed present yet. */
export function worksInKvart(snapshot: ModuleSnapshot | undefined, kvart: AreaSlug | null): FeedItem[] {
  return (snapshot?.items ?? []).filter((item) =>
    item.kind === 'event' &&
    dataText(item, 'source') === 'komunalne' &&
    dataText(item, 'status') === 'U tijeku' &&
    (kvart === null || dataText(item, 'district') === kvart));
}

/** Closures scoped to `kvart` the same way; every one of them when it is null. */
export function closuresInKvart(snapshot: ModuleSnapshot | undefined, kvart: AreaSlug | null): FeedItem[] {
  return (snapshot?.items ?? []).filter((item) =>
    item.kind === 'closure' && (kvart === null || dataText(item, 'district') === kvart));
}

/** D16: straight-line distance over a fixed walking speed (1.2 m/s), rounded up -- never a route, always labelled an estimate. */
export function walkMinutes(from: { lon: number; lat: number }, to: { lon: number; lat: number }): number {
  const meters = distanceKm(from.lon, from.lat, to.lon, to.lat) * 1000;
  return Math.ceil(meters / 1.2 / 60);
}

function workPoint(item: FeedItem): MapPoint | null {
  if (item.geo?.type !== 'Point') return null;
  const [lon, lat] = item.geo.coordinates as [number, number];
  return { id: item.id, lon, lat, title: item.title };
}

function closurePoint(item: FeedItem): [number, number] | null {
  if (!item.geo) return null;
  return item.geo.type === 'Point' ? (item.geo.coordinates as [number, number]) : (item.geo.coordinates as [number, number][])[0] ?? null;
}

function closureLine(item: FeedItem): MapLine | null {
  return item.geo?.type === 'LineString' ? { id: item.id, title: item.title, coordinates: item.geo.coordinates as [number, number][] } : null;
}

/** The nearest closure's street, named in words when there is no map to show it on (the lagano/no-factory fallback). */
function nearestStreet(closures: readonly FeedItem[], ref: { lon: number; lat: number }): string {
  let best: { street: string; d: number } | null = null;
  for (const item of closures) {
    const street = dataText(item, 'street');
    const point = street ? closurePoint(item) : null;
    if (!point) continue;
    const d = distanceKm(ref.lon, ref.lat, point[0], point[1]);
    if (!best || d < best.d) best = { street, d };
  }
  return best?.street ?? '';
}

function countsText(i18n: I18n, works: number, closures: number): string {
  const parts = [works > 0 ? i18n.t('kvart.works', { count: works }) : '', closures > 0 ? trPlural(i18n, 'closuresNow', closures) : ''].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : i18n.t('kvart.nothingNow');
}

/** The caption under the thumbnail (kajimafix 01.8): the hard hat and the works count, the car and the closures count, glyphs for the eye and the whole sentence for a reader; the sentence alone when there is nothing to count. */
function countsCaption(works: number, closures: number, sentence: string): string {
  if (works === 0 && closures === 0) return escapeHtml(sentence);
  const cells = [
    works > 0 ? `${iconMarkup('hard-hat')}<span class="tabular">${works}</span>` : '',
    closures > 0 ? `${iconMarkup('car-front')}<span class="tabular">${closures}</span>` : '',
  ].filter(Boolean).join('<span class="kv-map-sep">·</span>');
  return `<span class="kv-map-glyphs" aria-hidden="true">${cells}</span><span class="visually-hidden">${escapeHtml(sentence)}</span>`;
}

/** The screen's stop, else the kvart's own seat, else the city -- the same point centres the map and names the nearest closure (D6, D18). */
export function referencePoint(ctx: LayerContext, kvart: AreaSlug | null): { lon: number; lat: number } {
  const stop = ctx.screen?.stop;
  if (stop) return { lon: stop.lon, lat: stop.lat };
  const seat = kvart ? districtBySlug(kvart)?.seat : null;
  if (seat) return { lon: seat.lon, lat: seat.lat };
  return { lon: ZAGREB_CENTER[0], lat: ZAGREB_CENTER[1] };
}

interface MapBuild {
  html: string;
  /** The live map container to mount into the placeholder `.kv-map` div once the section exists; null under
   *  lagano or without a map factory, where the whole figure became one text row instead. */
  canvas: HTMLElement | null;
}

/** The figure (a live thumbnail map) or, lagano and without a factory, the one text row naming the same counts
 *  plus the nearest closure's street -- the map itself would otherwise show where it is. */
function buildMapSection(ctx: LayerContext, kvart: AreaSlug | null, title: string): MapBuild {
  const { i18n } = ctx;
  const works = worksInKvart(ctx.snapshots.dogadanja, kvart);
  const closures = closuresInKvart(ctx.snapshots.prometnice, kvart);
  const counts = countsText(i18n, works.length, closures.length);
  const ariaLabel = i18n.t('kvart.mapLabel', { kvart: title });
  const ref = referencePoint(ctx, kvart);
  const points = works.map(workPoint).filter((p): p is MapPoint => p !== null);
  const lines = closures.map(closureLine).filter((l): l is MapLine => l !== null);
  // No city or region name on a kvart-sized thumbnail (kajimafix 01.8): at zoom 13 "Zagreb" covered the streets.
  const canvas = ctx.maps?.slot({
    id: 'kvart-map', ariaLabel, className: 'kv-map-canvas', testid: 'kvart-map-canvas',
    points, lines, interactive: false, symbolScale: 0.85, center: [ref.lon, ref.lat], zoom: 13, placeLabels: false,
  }) ?? null;
  if (!canvas) {
    const street = nearestStreet(closures, ref);
    const text = street ? `${counts} · ${i18n.t('kvart.nearestClosure', { street })}` : counts;
    return { html: `<p class="kv-map-text" data-key="map" data-testid="kvart-counts">${escapeHtml(text)}</p>`, canvas: null };
  }
  // A map container `ctx.maps.slot()` hands back keeps its identity across polls (map-slots.ts caches by
  // id); `data-persist` tells the reconciler to move it into place rather than diff into MapLibre's own DOM
  // (ui/dom/reconcile.ts) -- the map itself is `interactive: false` so nothing inside it ever holds focus.
  canvas.dataset.persist = 'kvart-map';
  return {
    html: `<figure class="kv-mapwrap" data-key="map"><div class="kv-map" data-testid="kvart-map" aria-label="${escapeAttribute(ariaLabel)}"></div><figcaption class="kv-map-cap" data-testid="kvart-counts">${countsCaption(works.length, closures.length, counts)}</figcaption></figure>`,
    canvas,
  };
}

// --- Saved chips (spec §4.9, B.3 saved-store) -------------------------------

function screenStopName(ctx: LayerContext, id: string): string {
  if (ctx.screen?.stop?.id === id) return ctx.screen.stop.name;
  return ctx.stops?.find((s) => s.id === id)?.name ?? id;
}

function routeChip(i18n: I18n, ref: SavedRef): string {
  const route = routeEntry(ref.id);
  const label = route.long || tr(i18n, 'routeTitle', { short: route.short });
  const removeLabel = i18n.t('kvart.removeRoute', { id: ref.id });
  const selection = escapeAttribute(JSON.stringify({ kind: 'route', id: ref.id }));
  return `<li data-key="route:${escapeAttribute(ref.id)}"><button type="button" class="kv-chip" data-action="nav" data-layer="u-pokretu" data-selection="${selection}" data-testid="saved-route-${escapeAttribute(ref.id)}">${lineBadge(route.short, vehicleKind(route.type), 'xs')}<span class="kv-chip-text">${escapeHtml(label)}</span></button><button type="button" class="kv-chip-x icon-btn btn-quiet" data-action="unsave" data-kind="route" data-id="${escapeAttribute(ref.id)}" aria-label="${escapeAttribute(removeLabel)}">${iconMarkup('x')}</button></li>`;
}

function stopChip(i18n: I18n, ctx: LayerContext, ref: SavedRef): string {
  const name = screenStopName(ctx, ref.id);
  const removeLabel = i18n.t('kvart.removeStop', { name });
  const selection = escapeAttribute(JSON.stringify({ kind: 'stop', id: ref.id }));
  return `<li data-key="stop:${escapeAttribute(ref.id)}"><button type="button" class="kv-chip" data-action="nav" data-layer="u-pokretu" data-selection="${selection}" data-testid="saved-stop-${escapeAttribute(ref.id)}">${iconMarkup('map-pin')}<span class="kv-chip-text">${escapeHtml(name)}</span></button><button type="button" class="kv-chip-x icon-btn btn-quiet" data-action="unsave" data-kind="stop" data-id="${escapeAttribute(ref.id)}" aria-label="${escapeAttribute(removeLabel)}">${iconMarkup('x')}</button></li>`;
}

function savedSection(i18n: I18n, ctx: LayerContext): string {
  const list = ctx.saved?.list() ?? [];
  const chips = list.map((ref) => {
    if(ref.kind==='route')return routeChip(i18n,ref);
    if(ref.kind==='stop')return stopChip(i18n,ctx,ref);
    const p=ctx.city?[...ctx.city.places,...dynamicPlaces(ctx.city,ctx.now)].find(p=>p.id===ref.id):null;
    const source=sourceForPlaceId(ref.id);
    if(!p&&source)ctx.ensureCity?.([source]);
    const name=p?.name??ct(i18n,ctx.city?.loading?'loading':'selected');
    return `<li data-key="place:${escapeAttribute(ref.id)}"><button class="kv-chip" data-action="nav" data-layer="u-pokretu" data-selection="${escapeAttribute(JSON.stringify(ref))}">${iconMarkup('map-pin')}<span>${escapeHtml(name)}</span></button><button class="kv-chip-x btn-quiet" data-action="unsave" data-kind="place" data-id="${escapeAttribute(ref.id)}" aria-label="${escapeAttribute(i18n.t('kvart.removeStop',{name}))}">${iconMarkup('x')}</button></li>`;
  }).join('');
  const add = `<li data-key="add"><button type="button" class="kv-chip kv-chip-add" data-action="search" data-testid="saved-add-stop">${escapeHtml(i18n.t('kvart.addStop'))}</button></li>`;
  const hint = list.length === 0 ? `<p class="kv-saved-hint" data-testid="saved-empty">${escapeHtml(i18n.t('kvart.savedEmpty'))}</p>` : '';
  return `<div class="kv-sec" data-key="saved"><p class="kicker">${escapeHtml(i18n.t('kvart.saved'))}</p><ul class="kv-saved" role="list">${chips}${add}</ul>${hint}</div>`;
}

// --- Walking minutes from the screen's stop (D16) ---------------------------

/** Only with a screen stop AND at least one saved stop the catalogue has resolved (the walking row's own
 *  target is never the screen stop itself -- that walk is always zero). '' when neither condition holds. */
function walkSection(i18n: I18n, ctx: LayerContext): string {
  const stop = ctx.screen?.stop;
  if (!stop) return '';
  const targets = (ctx.saved?.list() ?? []).filter((ref) => ref.kind === 'stop' && ref.id !== stop.id);
  const rows = targets
    .map((ref) => {
      const target = ctx.stops?.find((s) => s.id === ref.id);
      if (!target) return '';
      const minutes = walkMinutes(stop, target);
      return `<li data-key="${escapeAttribute(ref.id)}">${iconMarkup('footprints')}<span class="tabular">${escapeHtml(i18n.t('kvart.walkMinutes', { minutes }))}</span><span class="kv-walk-name">${escapeHtml(target.name)}</span></li>`;
    })
    .filter(Boolean)
    .join('');
  if (!rows) return '';
  return `<div class="kv-sec" data-key="walk"><p class="kicker">${escapeHtml(i18n.t('kvart.walkTitle'))}</p><ul class="kv-walk" role="list" aria-label="${escapeAttribute(i18n.t('kvart.walkLabel'))}">${rows}</ul></div>`;
}

// --- The bell row (spec §4.9, D7) -------------------------------------------

function notifyButton(i18n: I18n, ctx: LayerContext): string {
  const count = ctx.notify ? activeCount(ctx.notify, NOTIFY_KEYS) : 0;
  const countText = count > 0 ? i18n.t('kvart.notifyOn', { count }) : i18n.t('kvart.notifyOff');
  return `<button type="button" class="kv-notify" data-key="notify" data-action="notify" data-testid="kvart-notify" aria-haspopup="dialog">${iconMarkup('bell')}<span class="kv-notify-text">${escapeHtml(i18n.t('kvart.notify'))}</span><span class="kv-notify-count">${escapeHtml(countText)}</span>${iconMarkup('chevron-right', undefined, 'icon row-chevron')}</button>`;
}

/**
 * The phone workspace (`'workspace'`, reached by the Kvart tab) or the desktop
 * aside body (`'aside'`, without the selector row: the status line has it).
 */
export function renderKvart(ctx: LayerContext, mode: KvartMode): HTMLElement {
  const { i18n } = ctx;
  const kvart = ctx.kvart ?? null;
  const title = ctx.kvartLabel ?? kvartLabel(i18n, kvart);
  const cast = ctx.cast as CastView | undefined;
  const map = buildMapSection(ctx, kvart, title);
  const body = [map.html, savedSection(i18n, ctx), walkSection(i18n, ctx), notifyButton(i18n, ctx), `<p class="kv-note" data-key="note">${escapeHtml(i18n.t('kvart.localNote'))}</p>`].join('');
  const section = mode === 'aside'
    ? createElementFromHTML(`<section class="kv" data-testid="kvart-panel" data-reconcile aria-labelledby="kv-aside-title">
<header class="kv-head" data-key="head"><h2 class="kv-title" id="kv-aside-title">${escapeHtml(title)}</h2>${mapLink(i18n, ctx)}</header>
${body}
</section>`)
    : createElementFromHTML(`<section class="layer ws ws-kvart" id="layer-kvart" data-layer="kvart" data-reconcile aria-labelledby="layer-title-kvart" data-testid="kvart-panel">
<header class="ws-head kv-head" data-key="head"><h2 class="layer-title kv-title" id="layer-title-kvart" tabindex="-1">${escapeHtml(title)}</h2>${mapLink(i18n, ctx)}</header>
<div class="kv-pick" data-key="pick">${kvartMenuMarkup(i18n, { kvartChoice: ctx.kvartChoice ?? 'screen', kvartLabel: title, stopName: ctx.screen?.stop?.name ?? null }, { id: 'kv-kvart', className: 'kv-kvart-pick' })}</div>
${body}
</section>`);
  if (map.canvas) section.querySelector('.kv-map')?.appendChild(map.canvas);
  return section;
}
