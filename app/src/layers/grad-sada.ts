// Sada, the ten-minute visit (companion WP4 step 3, §11 "Phone, ten-minute
// visit"): the answer before any explanation. In reading order: the place as
// the title [O-31]; one sentence with its coloured kicker; on the phone a
// 112 px map band around the place that opens Karta; three departures at the
// stop the place boards (city/next-departures.ts); then "U blizini · 2 km ·
// ~15 min", the wall's own list continuing after those departures
// (city/feed.ts, city/nearby-markup.ts); last, below the fold, the sources,
// crediting ZET for every blue time. No generic heading sentence, no date
// line, no instruction, no counts [O-12]; a desk shows the same feed without
// the band (Karta stands beside it there).
//
// The root is reconciled in place, so a poll swaps only the values that
// changed, and the band's live map is kept where it stands (u-pokretu.ts
// persistSlot), never detached by a redraw.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import type { SentenceKicker, WrittenSentence } from '../../../shared/kiosk/sentence';
import { emptyCity } from '../../../shared/city/types';
import { vetExternal } from '../../../shared/kiosk/external-text-boundary';
import { CURATED_WALL, curatedCityPoints } from '../city/curated';
import { feedPlace, feedRadiusM, nearbyHeld, nearbyInput, nearbyPlace, NEARBY_DESK_ROWS, NEARBY_PHONE_ROWS, sadaFeed } from '../city/feed';
import { departuresBlock } from '../city/next-departures';
import type { PlaceContext } from '../city/place';
import { provenanceBlock } from '../experience/status';
import type { CityMapHandle } from '../map/city-map';
import { frameView } from '../map/frame';
import { createElementFromHTML, escapeAttribute as a, escapeHtml as e } from '../ui/dom/escape';
import type { LayerContext } from './types';
import { closureLines, persistSlot, vehiclePoints } from './u-pokretu';

/** The band's map slot, kept by the page across polls (map/map-slots.ts). */
export const SADA_MAP_SLOT_ID = 'grad-sada-map';
/** The band as the phone lays it out (mock v2, [O-31]): the frame is fitted to this box. */
export const SADA_MAP_BAND = Object.freeze({ width: 390, height: 112 });

/** The camera each band map was last given, so a redraw moves it only when the place moves. */
const cameras = new WeakMap<CityMapHandle, string>();

/** The kicker's word, one literal key each, as the wall reads them (kiosk.sentence.kicker.*, seam S9). */
function kickerWord(ctx: LayerContext, kicker: SentenceKicker): string {
  switch (kicker) {
    case 'promet': return ctx.i18n.t('kiosk.sentence.kicker.promet');
    case 'kultura': return ctx.i18n.t('kiosk.sentence.kicker.kultura');
    case 'vrijeme': return ctx.i18n.t('kiosk.sentence.kicker.vrijeme');
    case 'bicikli': return ctx.i18n.t('kiosk.sentence.kicker.bicikli');
    case 'nocas': return ctx.i18n.t('kiosk.sentence.kicker.nocas');
    case 'radovi': return ctx.i18n.t('kiosk.sentence.kicker.radovi');
  }
}

/** One sentence and its kicker ("Vrijeme"), coloured by data-kicker; a busy card holds its height while the sentence is on its way. */
function sentenceMarkup(ctx: LayerContext, sentence: WrittenSentence | 'busy' | null): string {
  if (sentence === null) return '';
  if (sentence === 'busy') {
    return '<article class="sada-sentence" data-testid="sada-sentence" data-key="sada-sentence" aria-busy="true"><span class="skeleton" aria-hidden="true"></span></article>';
  }
  return `<article class="sada-sentence" data-testid="sada-sentence" data-key="sada-sentence" data-kicker="${a(sentence.kicker)}">`
    + `<span class="sada-kicker">${e(kickerWord(ctx, sentence.kicker))}</span><p class="sada-sentence-text">${e(sentence.text)}</p></article>`;
}

/** The list's place while its chunk is on its way: the head's title and the rows it will fill, reserved (the
 *  same room the held list keeps, city/nearby-markup.ts RESERVED_NEARBY_ROW, written here so the chunk stays lazy). */
function nearbyBusy(ctx: LayerContext, rows: number): string {
  return `<section class="nearby" data-testid="nearby" data-key="nearby" aria-busy="true"><h3 class="nearby-head" data-testid="nearby-head"><span class="nearby-head-title">${e(ctx.i18n.t('kiosk.nearby.title'))}</span></h3>`
    + `<ol class="nearby-rows" data-testid="nearby-rows">${'<li class="nearby-row-empty" aria-hidden="true"><span class="skeleton"></span></li>'.repeat(rows)}</ol></section>`;
}

/**
 * The phone's map band: vehicles, the curated city points the wall shows
 * (city/curated.ts, WP2) and the closures, framed on the place
 * (map/frame.ts frameView over the measured circle), still, and a link over
 * it that opens Karta. Null on a desk, in lagano and without a map.
 */
/** Whether this draw has a band at all: the phone with a map, not lagano. */
const bandWanted = (ctx: LayerContext): boolean => ctx.screen?.surface === 'phone' && !ctx.lightweight && Boolean(ctx.maps);

function mapBand(ctx: LayerContext, place: PlaceContext, radiusM: number): HTMLElement | null {
  if (!bandWanted(ctx) || !ctx.maps || !ctx.screen) return null;
  const now = ctx.frozenAt ?? ctx.now;
  const camera = frameView(place, radiusM, SADA_MAP_BAND.width, SADA_MAP_BAND.height);
  const container = ctx.maps.slot({
    id: SADA_MAP_SLOT_ID,
    renderer: 'map',
    className: 'map-canvas sada-map-canvas',
    testid: 'sada-map-canvas',
    ariaLabel: ctx.i18n.t('sada.mapBand', { place: vetExternal('name', place.name, 'row') ?? '' }),
    points: [
      ...vehiclePoints(ctx.snapshots['zet-rt'], now),
      ...curatedCityPoints(ctx.city ?? emptyCity(), ctx.snapshots.dogadanja?.items ?? [], now, CURATED_WALL),
    ],
    lines: closureLines(ctx.snapshots.prometnice),
    center: camera.center,
    zoom: camera.zoom,
    stop: place.stop ?? place.departuresStop,
    interactive: false,
    attributionCompact: true,
    presentationProfile: 'handheld',
    cityLabels: 'venues',
    reducedMotion: ctx.reducedMotion,
    theme: ctx.screen.theme,
    locale: ctx.i18n.getLocale(),
  });
  if (!container) return null;
  // The slot takes its camera when it is made; a place that moves later (the catalogue arrived) moves it here.
  const handle = ctx.maps.handle(SADA_MAP_SLOT_ID);
  const view = `${camera.center.join(',')}@${camera.zoom}`;
  if (handle && cameras.get(handle) !== view) {
    if (cameras.has(handle)) handle.setView?.({ center: camera.center, zoom: camera.zoom });
    cameras.set(handle, view);
  }
  container.id ||= `${SADA_MAP_SLOT_ID}-canvas`;
  return persistSlot(container);
}

export function renderGradSada(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  const place = feedPlace(ctx);
  const now = ctx.frozenAt ?? ctx.now;
  const desk = ctx.screen?.surface === 'desktop';
  const feed = sadaFeed(ctx.onLocalData);
  const input = typeof feed === 'object' ? nearbyInput(ctx, place) : null;
  const rows = typeof feed === 'object' ? feed.selectNearby(input!) : null;
  // Until the list's sources have answered it keeps its head and its reserved rows, and the band's live map waits
  // with it: MapLibre is not evaluated in front of the first answer, and Karta loads it at once if asked first.
  const held = typeof feed === 'object' && nearbyHeld(ctx);
  const cap = desk ? NEARBY_DESK_ROWS : NEARBY_PHONE_ROWS;
  // The page's own sentence when it gives one (null: none), else the writer's first from these facts.
  const sentence: WrittenSentence | 'busy' | null = ctx.sentence !== undefined ? ctx.sentence
    : typeof feed === 'object' ? feed.sadaSentences(input!, rows!)[0] ?? null
    : feed === 'loading' ? 'busy' : null;
  // The departures block shows the departures; the list continues with what comes after them.
  const nearby = typeof feed === 'object'
    ? feed.nearbySectionMarkup(i18n, held ? [] : rows!.filter((row) => row.kind !== 'departure'), input!.radiusM, now,
      { cap, id: 'sada', ...(held ? { reserve: cap } : {}) })
    : feed === 'loading' ? nearbyBusy(ctx, cap) : '';
  // The band's box stands from the first draw (112 px, its link to Karta); the map inside it once Sada has settled
  // (the list's chunk in hand and its hold over).
  const settling = held || feed === 'loading';
  const band = settling ? null : mapBand(ctx, place, input?.radiusM ?? feedRadiusM(ctx, nearbyPlace(place)));
  const bandBox = band !== null || (settling && bandWanted(ctx));
  // The place's name is the catalogue's or the operator's text: the title carries it only once the row check passes
  // (the boundary refuses everything until the policy chunk, this feed's own, is in hand).
  const name = vetExternal('name', place.name, 'row') ?? '';
  const section = createElementFromHTML(`<section class="layer ws ws-sada" id="layer-grad-sada" data-layer="grad-sada" data-reconcile aria-labelledby="layer-title-grad-sada">`
    + `<h2 class="layer-title sada-place" id="layer-title-grad-sada" tabindex="-1" data-testid="sada-place">${e(name)}</h2>`
    + sentenceMarkup(ctx, sentence)
    + (bandBox ? `<div class="sada-map" data-testid="sada-map-band" data-key="sada-map"><a class="sada-map-open" href="#layer=u-pokretu" data-action="nav" data-layer="u-pokretu" aria-label="${a(i18n.t('sada.mapBand', { place: name }))}"></a></div>` : '')
    + departuresBlock(ctx, place, { heading: true })
    + nearby
    + provenanceBlock(i18n, Object.values(ctx.snapshots) as (ModuleSnapshot | undefined)[])
    + '</section>');
  if (band) section.querySelector('.sada-map')!.prepend(band);
  return section;
}
