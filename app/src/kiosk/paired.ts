// The paired compositions: one glanceable screen per domain, read from
// several steps away, mirroring the layer and the public selection the
// driver's phone relayed. Not the phone's long page cropped into a kiosk:
// each domain has its own arrangement of two or three blocks, big figures
// first, lists bounded, every block naming its source and its own time.
import type { FeedItem, ModuleId, ModuleSnapshot } from '../../../worker/feed/schema';
import type { LayerId } from '../../../worker/protocol';
import { LJEKARNE_SOURCE } from '../../../worker/hitno/ljekarne';
import { fillAttribution } from '../attribution';
import { publicItemKey, type PublicSelection, type ScreenStop } from '../core/contracts';
import type { I18n } from '../i18n/i18n';
import { DOGADANJA_SOURCES, IZVORI } from '../izvori-render';
import { safetyState } from '../experience/safety-state';
import { delayWord } from '../layers/shared';
import { dataNumber, dataText } from '../panels/panel';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { clock, dayKey, dayTime, fmtAmount, fmtNumber, weekdayDayMonth, zagrebDayAfter } from './format';
import { kBadge, kicker, linesMarkup, weatherMarkup } from './markup';
import { activeWarnings, cityDateLine, cityKicker, cleanCondition, closuresByDistance, closuresNear, isLive, linesAtStop, pharmaciesByDistance, plausibleDelay, recentQuakes, sunToday, upcomingWarnings, weatherNow, type SunToday } from './local';
import { routeLongName, routeType, sortRouteIds, stopDistanceM } from './stops';
import { fill, plural, type KioskStrings } from './strings';

/** What the kiosk polls per mirrored layer: the layer's own modules plus
 *  the observation for the weather and safety screens, which read it. */
export const KIOSK_LAYER_MODULES: Record<LayerId, ModuleId[]> = {
  'grad-sada': ['dhmz-now', 'dhmz-forecast', 'dhmz-cap', 'zet-rt', 'prometnice'],
  'u-pokretu': ['zet-rt', 'prometnice'],
  'zrak-i-nebo': ['dhmz-now', 'dhmz-forecast', 'dhmz-cap', 'emsc'],
  sigurnost: ['dhmz-cap', 'emsc', 'prometnice', 'ckan-geo'],
  'uprava-i-pravo': ['glasnik', 'dogadanja'],
  kultura: ['dogadanja'],
};

export const PAIRED_MAP_LAYERS: ReadonlySet<LayerId> = new Set<LayerId>(['grad-sada', 'u-pokretu']);

export interface PairedContext {
  layer: LayerId;
  strings: KioskStrings;
  i18n: I18n;
  locale: string;
  snapshots: Partial<Record<ModuleId, ModuleSnapshot>>;
  now: number;
  stop: ScreenStop | null;
  selection: PublicSelection | null;
  lightweight: boolean;
  size: 'wide' | 'compact';
  /** The stop list once the controller has loaded it, so a stop selection can be named. */
  stops?: readonly ScreenStop[] | null;
}

export interface PairedDeps {
  strings: KioskStrings;
  i18n: I18n;
  locale: string;
  lightweight: boolean;
  /** Called after the shell was (re)built for a layer: the join QR needs painting again. */
  onShell?: () => void;
}

/** What one composition paints: the lines box over the map foot (map layers
 *  only), the main region (layers without a map) and the side column's blocks.
 *  The shell around them -- map host, join card -- is static per layer. */
export interface PairedMarkup { lines: string; main: string; side: string }

export interface PairedHandle {
  element: HTMLElement;
  /** The mounted composition's map host; null while the layer shows no map. */
  mapHost: HTMLElement | null;
  update(ctx: PairedContext): void;
  destroy(): void;
}

// --- Shared block helpers ---------------------------------------------------

/** "podaci od 14:32" / "zastarjelo · podaci od 14:02" / "Izvor trenutačno ne odgovara". */
export function statusLine(snapshot: ModuleSnapshot | undefined, s: KioskStrings): string {
  if (!snapshot) return '';
  if (snapshot.status === 'down') return s.paired.sourceDown;
  // Gazette rows carry their publication date. Midnight derived from a date
  // is not a useful "live data" clock in a block header.
  if (snapshot.module === 'glasnik') return snapshot.status === 'stale' ? s.paired.stale : '';
  const time = clock(snapshot.sourceUpdatedAt ?? snapshot.fetchedAt);
  const from = fill(snapshot.sourceUpdatedAt ? s.paired.dataFrom : s.paired.fetchedAt, { time });
  return snapshot.status === 'stale' ? `${s.paired.stale} · ${from}` : from;
}

/** Who publishes a module, as a credit line names it: the public body for the
 *  City's datasets (the Otvorena dozvola asks for it), the institute or the
 *  broadcaster otherwise. A module not listed reads its /izvori name. */
const PUBLISHER: Partial<Record<ModuleId, string>> = {
  prometnice: 'Grad Zagreb (data.zagreb.hr)',
  'ckan-geo': 'Grad Zagreb (data.zagreb.hr)',
  'dhmz-now': 'DHMZ',
  'dhmz-forecast': 'DHMZ',
  'dhmz-cap': 'DHMZ',
  emsc: 'EMSC, seismicportal.eu',
  glasnik: 'Službeni glasnik Grada Zagreba',
};
/** The dogadanja sources whose /izvori name does not already say who publishes them. */
const EVENT_PUBLISHER: Record<string, string> = {
  kvartovske: 'Grad Zagreb, kvartovske novosti',
  komunalne: 'Grad Zagreb, plan komunalnih aktivnosti',
  'zet-promet': 'ZET',
  'zet-novosti': 'ZET',
};

/** One block's credit, compact enough for a screen read from steps away: who
 *  published the rows on show, under which licence, and where the full
 *  attribution lives (/izvori). ZET's sentence is the one its licence mandates
 *  and stays verbatim. The dogadanja module credits each source actually on
 *  the screen by name and its own catalogued licence, never the six-source
 *  paragraph. A per-item template (an act's UUID) never prints. */
export function creditText(snapshot: ModuleSnapshot, items: readonly FeedItem[], s: KioskStrings): string {
  const licence = snapshot.attribution.licence;
  const licenceWords = licence === '' ? '' : `${s.paired.licence}: ${licence}`;
  if (snapshot.module === 'zet-rt') {
    const text = fillAttribution(snapshot.attribution, snapshot, items[0] ?? snapshot.items[0]);
    const named = licence !== '' && text.toLowerCase().includes(licence.toLowerCase().split(' (')[0]!);
    return [text, named ? '' : licenceWords, s.paired.fullSources].filter(Boolean).join(' · ');
  }
  if (snapshot.module === 'dogadanja') {
    const shown = new Set(items.map((item) => dataText(item, 'source')));
    const credits = [...new Set(DOGADANJA_SOURCES.filter((src) => shown.has(src.source)).map((src) => `${EVENT_PUBLISHER[src.source] ?? src.naziv} (${src.licence})`))];
    if (credits.length > 0) return `${credits.length > 1 ? s.paired.sourcesLabel : s.paired.sourceLabel}: ${credits.join(' · ')} · ${s.paired.fullSources}`;
  }
  const publisher = PUBLISHER[snapshot.module] ?? IZVORI.find((src) => src.module === snapshot.module)?.naziv ?? fillAttribution(snapshot.attribution, snapshot, items[0] ?? snapshot.items[0]);
  return [`${s.paired.sourceLabel}: ${publisher}`, licenceWords, s.paired.fullSources].filter(Boolean).join(' · ');
}

/** The credit line under a block; `items` are the rows on show, for a per-source credit. */
export function sourceLine(snapshot: ModuleSnapshot | undefined, items: readonly FeedItem[], s: KioskStrings, extraClass = ''): string {
  if (!snapshot) return '';
  return `<p class="k-meta k-source${extraClass ? ` ${extraClass}` : ''}">${escapeHtml(creditText(snapshot, items, s))}</p>`;
}

/** One credit for the blocks a single module feeds, spanning the main grid. */
function mainSource(snapshot: ModuleSnapshot | undefined, items: readonly FeedItem[], s: KioskStrings): string {
  return sourceLine(snapshot, items, s, 'k-main-source');
}

export interface BlockOptions {
  testid?: string;
  tone?: string;
  snapshot?: ModuleSnapshot;
  item?: FeedItem;
  /** The rows on show, when the credit should name their sources (dogadanja). */
  items?: readonly FeedItem[];
  grow?: boolean;
  /** Goes before the status in the kicker's right-hand text. */
  meta?: string;
  /** The source is stated once for the whole layer (mainSource), not under this block. */
  noSource?: boolean;
  /** A further class on the article: the departure board's five-row floor. */
  extraClass?: string;
  s: KioskStrings;
}

export function block(title: string, body: string, o: BlockOptions): string {
  const status = [o.meta ?? '', statusLine(o.snapshot, o.s)].filter(Boolean).join(' · ');
  const list = body.includes('class="k-rows"') ? ' k-block--list' : '';
  return `<article class="k-block${o.tone ? ` k-block--${escapeAttribute(o.tone)}` : ''}${o.grow ? ' k-block--grow' : ''}${list}${o.extraClass ? ` ${escapeAttribute(o.extraClass)}` : ''}"${o.testid ? ` data-testid="${escapeAttribute(o.testid)}"` : ''}${o.snapshot ? ` data-status="${o.snapshot.status}"` : ''}>
    ${kicker(title, status)}
    <div class="k-block-body">${body}</div>
    ${o.noSource ? '' : sourceLine(o.snapshot, o.items ?? (o.item ? [o.item] : []), o.s)}
  </article>`;
}

/** A list body, or the honest sentence for "down" and for a true empty.
 *  `total` is how many items the rows were cut from; the row fitter states
 *  "prikazano N od total" whenever fewer are on screen. */
export function listBody(snapshot: ModuleSnapshot | undefined, rows: readonly string[], emptyText: string, s: KioskStrings, total = rows.length): string {
  if (!snapshot) return `<p class="k-board-note">${escapeHtml(s.paired.noData)}</p>`;
  if (snapshot.status === 'down' && rows.length === 0) return `<p class="k-board-note" data-state="down">${escapeHtml(s.paired.sourceDown)}</p>`;
  // Only a live, successful, empty answer is a true empty; a stale empty copy is unconfirmed.
  if (snapshot.status === 'stale' && rows.length === 0) return `<p class="k-board-note" data-state="stale">${escapeHtml(s.paired.unconfirmed)}</p>`;
  if (rows.length === 0) return `<p class="k-board-note">${escapeHtml(emptyText)}</p>`;
  return `<ul class="k-rows"${total > rows.length ? ` data-total="${total}"` : ''}>${rows.map((row) => `<li class="k-row">${row}</li>`).join('')}</ul>`;
}

/** The aside (a time, a distance, a count) goes inside the title's box, first
 *  in the markup, so it floats at the right of the first line and the title
 *  flows whole around it; no title is ever clamped. */
export function row(main: string, sub = '', aside = '', attrs = ''): string {
  return `<span class="k-row-main"${attrs}>${aside ? `<span class="k-row-aside">${aside}</span>` : ''}${main}</span>${sub ? `<span class="k-row-sub">${sub}</span>` : ''}`;
}

/** A box and its content snap to whole pixels separately: a 159.4 px body reads
 *  clientHeight 159 against scrollHeight 160 with nothing cut (a block sized to
 *  its content, as under the portrait map), so an overflow counts from the
 *  second pixel. e2e/kiosk-layout.spec.ts allows the same pixel. */
const ROUNDING_PX = 1;

/** After a paint, trailing rows that do not fit their block are hidden and
 *  counted in one "prikazano N od M" line, so a block never shows half a row
 *  or runs into its own source line. A DOM without layout (tests) measures
 *  nothing and leaves every row in place; `measure` is injectable for that.
 *  The floor is zero, not one: a block whose own coverage line ("prikazano
 *  N od M") does not fit beside even a single row (a long street name in a
 *  cramped compact side column) drops the row rather than clip the line
 *  that discloses how many exist -- a bare "prikazano 0 od M" still tells
 *  the reader the truth, where a half-visible row or a silently cropped
 *  line would not. */
export function fitRows(
  root: ParentNode,
  coverage: string,
  measure: (el: HTMLElement) => { scroll: number; client: number } = (el) => ({ scroll: el.scrollHeight, client: el.clientHeight }),
): void {
  const bodies = [...root.querySelectorAll<HTMLElement>('.k-block-body')].filter((body) => body.querySelector('.k-rows'));
  const rowsOf = (body: HTMLElement): HTMLElement[] => Array.from(body.querySelector('.k-rows')?.children ?? []).filter((el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('k-row'));
  const totalOf = (body: HTMLElement): number => Number(body.querySelector<HTMLElement>('.k-rows')?.dataset.total) || rowsOf(body).length;
  const setNote = (body: HTMLElement, visible: number, total: number): void => {
    let note = body.querySelector<HTMLElement>('.k-row-more');
    if (visible >= total) { note?.remove(); return; }
    if (!note) {
      note = document.createElement('p');
      note.className = 'k-line-more k-row-more';
      body.appendChild(note);
    }
    // The departure board counts in lines (data-coverage); every other list uses the shared sentence.
    note.textContent = fill(body.querySelector<HTMLElement>('.k-rows')?.dataset.coverage ?? coverage, { shown: visible, total });
  };
  for (const body of bodies) {
    const rows = rowsOf(body);
    for (const r of rows) r.hidden = false;
    body.querySelector('.k-row-more')?.remove();
    setNote(body, rows.length, totalOf(body));
    let m = measure(body);
    if (m.client === 0 || m.scroll <= m.client + ROUNDING_PX) continue;
    let visible = rows.length;
    while (visible > 0 && m.scroll > m.client + ROUNDING_PX) {
      visible -= 1;
      rows[visible]!.hidden = true;
      setNote(body, visible, totalOf(body));
      m = measure(body);
    }
  }
  // Trimming one block hands its column-mates room back; a second pass lets
  // them show a row again while it still fits.
  for (const body of bodies) {
    const rows = rowsOf(body);
    let visible = rows.filter((r) => !r.hidden).length;
    while (visible < rows.length) {
      rows[visible]!.hidden = false;
      setNote(body, visible + 1, totalOf(body));
      const m = measure(body);
      if (m.client === 0 || m.scroll > m.client + ROUNDING_PX) {
        rows[visible]!.hidden = true;
        setNote(body, visible, totalOf(body));
        break;
      }
      visible += 1;
    }
  }
}

function modulesOf(ctx: PairedContext): ModuleSnapshot[] {
  return Object.values(ctx.snapshots).filter((m): m is ModuleSnapshot => m !== undefined);
}

/** The lines board over the map foot (filling the map column in lightweight mode). */
function linesBox(ctx: PairedContext): string {
  const cap = ctx.lightweight ? 10 : ctx.size === 'wide' ? 5 : 4;
  return linesMarkup(linesAtStop(modulesOf(ctx), ctx.stop, ctx.i18n, cap), ctx.stop, ctx.strings, ctx.locale);
}

/** The static shell of one layer: the map column (map layers) or the main
 *  region, the side column's block box, and the join card the controller
 *  paints the small QR into. Polls rewrite the boxes, never the shell, so
 *  the map container parked in the host is never torn out by a repaint. */
export function pairedShell(layer: LayerId, s: KioskStrings, lightweight: boolean): string {
  const left = PAIRED_MAP_LAYERS.has(layer)
    ? `<div class="k-map" data-testid="kiosk-live"><div class="k-map-host" data-testid="kiosk-map-host"${lightweight ? ' hidden' : ''}></div><div class="k-lines ${lightweight ? 'k-lines--board' : 'k-lines--overlay'}" data-testid="kiosk-lines"></div></div>`
    : `<div class="k-main" data-testid="kiosk-main"></div>`;
  return `${left}<aside class="k-side"><div class="k-side-blocks" data-testid="kiosk-side"></div>
    <article class="k-join" data-testid="kiosk-join"><div class="k-join-qr" data-testid="corner-qr"></div><div class="k-join-text"><p class="k-join-title">${escapeHtml(s.session.join)}</p><p class="k-join-code" data-testid="join-code"></p><p class="k-meta">${escapeHtml(s.session.joinHint)}</p></div></article></aside>`;
}

function warningRows(ctx: PairedContext): string[] {
  const cap = ctx.snapshots['dhmz-cap'];
  const rowOf = (w: FeedItem, upcoming: boolean): string => row(
    `<span class="badge k-badge" data-tone="${escapeAttribute(w.severity ?? 'info')}">${escapeHtml(ctx.i18n.t(`panels.severity.${w.severity ?? 'info'}`))}</span> ${escapeHtml(w.title)}`,
    [upcoming && w.at ? fill(ctx.strings.paired.upcomingFrom, { time: dayTime(w.at) }) : '', w.summary ?? '', w.until ? fill(ctx.strings.paired.untilTime, { time: dayTime(w.until) }) : ''].filter(Boolean).map(escapeHtml).join(' · '),
    '',
    ` data-severity="${escapeAttribute(w.severity ?? 'info')}" data-window="${upcoming ? 'upcoming' : 'active'}"`,
  );
  // Active warnings first, most severe on top; announced ones after, each saying from when. Ended ones are gone.
  return [...activeWarnings(cap, ctx.now).map((w) => rowOf(w, false)), ...upcomingWarnings(cap, ctx.now).map((w) => rowOf(w, true))];
}

function warningsBlock(ctx: PairedContext, grow = false): string {
  const cap = ctx.snapshots['dhmz-cap'];
  return block(ctx.strings.paired.warnings, listBody(cap, warningRows(ctx), ctx.strings.paired.warningsNone, ctx.strings), { s: ctx.strings, snapshot: cap, testid: 'k-warnings', tone: activeWarnings(cap, ctx.now).length > 0 ? 'rose' : '', grow });
}

/** The overview shows the warnings block when it says something the strip's
 *  one line does not: an active warning, or a source that is not answering.
 *  A live, confirmed "no warnings" is already on the strip. */
function warningsRelevant(ctx: PairedContext): boolean {
  const cap = ctx.snapshots['dhmz-cap'];
  return !cap || cap.status !== 'live' || activeWarnings(cap, ctx.now).length > 0 || upcomingWarnings(cap, ctx.now).length > 0;
}

function closureRows(ctx: PairedContext, limit: number): string[] {
  const { strings: s, i18n } = ctx;
  return closuresByDistance(ctx.snapshots.prometnice, ctx.stop, ctx.now).slice(0, limit).map(({ item, distanceM }) => {
    const type = i18n.t(`panels.closureType.${dataText(item, 'subtype') || 'ROAD_CLOSED'}`);
    const until = item.until ? fill(s.paired.untilTime, { time: dayTime(item.until) }) : '';
    return row(escapeHtml(item.title), [type, until].filter(Boolean).map(escapeHtml).join(' · '), distanceM === null ? '' : escapeHtml(fmtDistanceWord(ctx.locale, distanceM)));
  });
}

function fmtDistanceWord(locale: string, metres: number): string {
  return metres < 950 ? `${Math.max(10, Math.round(metres / 10) * 10)} m` : `${fmtNumber(locale, metres / 1000, 1)} km`;
}

function closuresBlock(ctx: PairedContext, limit: number, grow = false): string {
  const snap = ctx.snapshots.prometnice;
  const near = closuresNear(modulesOf(ctx), ctx.stop, ctx.now);
  const title = isLive(snap) && near.count > 0 ? `${ctx.strings.paired.closures} · ${near.count}` : ctx.strings.paired.closures;
  return block(title, listBody(snap, closureRows(ctx, limit), ctx.strings.paired.closuresNone, ctx.strings, near.count), { s: ctx.strings, snapshot: snap, testid: 'k-closures', grow });
}

function renderSada(ctx: PairedContext): PairedMarkup {
  // With a selection on show, the column gives its room to the selection; the strip still carries the warning state.
  // The weather is status in the frame's header (D11), never a block here. The column follows the strip's
  // verdict: on a calm day (green notices at most) the closures near the stop take the whole column; an
  // active warning of yellow or above, or a source that is not answering, brings the warnings block in
  // beside them at wide, and alone at compact, where two list blocks never both fit a row next to the join card.
  const selected = selectionCard(ctx);
  const warnings = !selected && warningsRelevant(ctx) && safetyState(ctx.snapshots, ctx.now).level !== 'calm';
  const side = selected ? `${selected}${closuresBlock(ctx, 2, true)}`
    : warnings && ctx.size === 'compact' ? warningsBlock(ctx, true)
    : `${warnings ? warningsBlock(ctx) : ''}${closuresBlock(ctx, ctx.size === 'wide' ? 3 : 2, true)}`;
  return { lines: linesBox(ctx), main: '', side };
}

/** The mode a route number is drawn in: tram, bus, or the plain badge for a route the table does not know. */
function kindOfRoute(routeId: string): 'tram' | 'bus' | 'other' {
  const type = routeType(routeId);
  return type === 0 ? 'tram' : type === 3 ? 'bus' : 'other';
}

interface RouteSummary { delay: number | null; count: number | null }

/** Every route the feed summarises: its median delay when plausible (a six-hour figure is a stale trip update, not a delay) and its vehicle count. */
function routeSummaries(zet: ModuleSnapshot | undefined): Map<string, RouteSummary> {
  const out = new Map<string, RouteSummary>();
  for (const item of zet?.items ?? []) {
    if (!item.id.startsWith('route:')) continue;
    const routeId = dataText(item, 'routeId');
    if (!routeId) continue;
    const delay = dataNumber(item, 'medianDelaySeconds');
    out.set(routeId, { delay: plausibleDelay(delay) ? delay : null, count: dataNumber(item, 'vehicles') });
  }
  return out;
}

/** One line of the departure board: the badge, the destination, the word for the state, the vehicles out. */
function boardRow(ctx: PairedContext, routeId: string, summary: RouteSummary | undefined, atStop: boolean): string {
  const count = summary?.count ?? null;
  const vehicles = count === null ? '' : `<span class="k-row-aside">${escapeHtml(plural(ctx.locale, ctx.strings.paired.routeVehicles, count))}</span>`;
  return `<li class="k-row k-row--line" data-route="${escapeAttribute(routeId)}"${atStop ? ' data-at-stop="1"' : ''}>${kBadge(routeId, kindOfRoute(routeId))}<span class="k-row-name">${escapeHtml(routeLongName(routeId))}</span><span class="k-row-word">${escapeHtml(delayWord(ctx.i18n, summary?.delay))}</span>${vehicles}</li>`;
}

/** The transport board: the stop's lines first, each with its delay word and
 *  vehicle count, then the five largest deviations elsewhere on the network,
 *  and "prikazano N od M linija" for the routes the feed knows. When the
 *  board leads the column it keeps five rows (k-block--board); under a
 *  selection card it takes the general floor, the selection being the subject. */
function delaysBoard(ctx: PairedContext, lead: boolean): string {
  const { strings: s } = ctx;
  const zet = ctx.snapshots['zet-rt'];
  const summaries = routeSummaries(zet);
  const atStop = ctx.stop ? sortRouteIds(ctx.stop.routes) : [];
  const stopSet = new Set(atStop);
  const deviations = [...summaries]
    .filter(([routeId, summary]) => !stopSet.has(routeId) && summary.delay !== null)
    .sort((a, b) => Math.abs(b[1].delay!) - Math.abs(a[1].delay!) || a[0].localeCompare(b[0], 'hr', { numeric: true }))
    .slice(0, 5)
    .map(([routeId]) => routeId);
  const known = [...summaries].filter(([, summary]) => summary.delay !== null).map(([routeId]) => routeId);
  const total = new Set([...atStop, ...known]).size;
  const rows = [...atStop.map((routeId) => boardRow(ctx, routeId, summaries.get(routeId), true)), ...deviations.map((routeId) => boardRow(ctx, routeId, summaries.get(routeId), false))];
  const body = rows.length === 0
    ? listBody(zet, [], s.paired.noData, s)
    : `<ul class="k-rows"${total > rows.length ? ` data-total="${total}"` : ''} data-coverage="${escapeAttribute(plural(ctx.locale, s.paired.coverageLines, total))}">${rows.join('')}</ul>`;
  return block(s.paired.delays, body, { s, snapshot: zet, testid: 'k-delays', grow: true, extraClass: lead ? 'k-block--board' : '' });
}

function renderPromet(ctx: PairedContext): PairedMarkup {
  // The board and the join card are the composition at both sizes: five rows,
  // their coverage line and ZET's mandated three-line credit fill what the
  // column has beside the join card (measured at 1920: 500 of 640 px), so no
  // second block fits. Closures stay on Sada and Sigurnost; ZET's own notices
  // are Događanja's undated notices (`k-notices`, see NOTICE_SOURCES).
  const selected = selectionCard(ctx);
  return { lines: linesBox(ctx), main: '', side: `${selected}${delaysBoard(ctx, !selected)}` };
}

// --- The public selection the phone relayed --------------------------------

function findItem(ctx: PairedContext, module: ModuleId, key: string): { item: FeedItem; snapshot: ModuleSnapshot } | null {
  const snapshot = ctx.snapshots[module];
  const item = snapshot?.items.find((candidate) => publicItemKey(module, candidate.id) === key);
  return snapshot && item ? { item, snapshot } : null;
}

/** One card naming what the driver's phone selected: a line with its delay
 *  and vehicle count, a stop with its lines, or one item by its public key.
 *  Nothing else the phone knows (filters, coordinates) ever reaches here. */
function selectionCard(ctx: PairedContext): string {
  const { strings: s, selection, i18n } = ctx;
  if (!selection) return '';
  // The selection is the column's subject: it takes the room the column has.
  const o = { s, testid: 'k-selection', tone: 'select', grow: true };
  if (selection.kind === 'route') {
    const zet = ctx.snapshots['zet-rt'];
    const summary = zet?.items.find((item) => item.id === `route:${selection.id}`);
    const median = dataNumber(summary, 'medianDelaySeconds');
    const delay = plausibleDelay(median) ? median : null;
    const count = dataNumber(summary, 'vehicles');
    const sub = [delay === null ? '' : delayWord(i18n, delay), count === null ? '' : plural(ctx.locale, s.paired.routeVehicles, count)].filter(Boolean).join(' · ');
    const body = `<p class="k-select-main">${kBadge(selection.id, kindOfRoute(selection.id))} ${escapeHtml(routeLongName(selection.id) || fill(s.session.selectedRoute, { route: selection.id }))}</p>${sub ? `<p class="k-select-sub">${escapeHtml(sub)}</p>` : ''}`;
    return block(s.session.selected, body, { ...o, snapshot: zet, item: summary });
  }
  if (selection.kind === 'stop') {
    const named = selection.id === ctx.stop?.id ? ctx.stop : ctx.stops?.find((stop) => stop.id === selection.id) ?? null;
    const routes = named ? sortRouteIds(named.routes).join(', ') : '';
    const body = `<p class="k-select-main">${escapeHtml(named ? named.name : fill(s.session.selectedStop, { stop: selection.id }))}</p>${routes ? `<p class="k-select-sub">${escapeHtml(`${s.paired.lineWord} ${routes}`)}</p>` : ''}`;
    return block(s.session.selected, body, o);
  }
  const found = findItem(ctx, selection.module, selection.id);
  if (!found) return '';
  const { item, snapshot } = found;
  const when = item.at && item.dateBasis !== 'unknown' ? dayTime(item.at) : '';
  const body = `<p class="k-select-main k-select-main--item">${escapeHtml(item.title)}</p>${item.summary ? `<p class="k-select-sub k-select-sub--long">${escapeHtml(item.summary)}</p>` : ''}${when ? `<p class="k-select-sub">${escapeHtml(when)}</p>` : ''}`;
  return block(s.session.selected, body, { ...o, snapshot, item });
}

// --- Vrijeme (zrak-i-nebo) --------------------------------------------------

function weatherHero(ctx: PairedContext): string {
  const snap = ctx.snapshots['dhmz-now'];
  return `<article class="k-block k-block--weather" data-testid="k-weather"${snap ? ` data-status="${snap.status}"` : ''}>${weatherMarkup(weatherNow(modulesOf(ctx), ctx.strings, ctx.locale), ctx.strings, ctx.size === 'wide' ? 3 : 2)}</article>`;
}

function forecastBlock(ctx: PairedContext): string {
  const { strings: s, locale } = ctx;
  const snap = ctx.snapshots['dhmz-forecast'];
  const today = snap?.items.find((item) => item.kind === 'forecast' && (!item.at || dayKey(item.at) === dayKey(ctx.now))) ?? snap?.items[0];
  let body: string;
  if (!snap) body = `<p class="k-board-note">${escapeHtml(s.paired.noData)}</p>`;
  else if (snap.status === 'down' && !today) body = `<p class="k-board-note" data-state="down">${escapeHtml(s.paired.sourceDown)}</p>`;
  else if (!today) body = `<p class="k-board-note">${escapeHtml(s.paired.rangeUnknown)}</p>`;
  else {
    const tmin = dataNumber(today, 'tmin');
    const tmax = dataNumber(today, 'tmax');
    const range = tmin !== null && tmax !== null ? fill(s.weather.range, { min: fmtNumber(locale, tmin, 0), max: fmtNumber(locale, tmax, 0) }) : s.paired.rangeUnknown;
    // DHMZ's forecast 'vrijeme' is sometimes a symbol code, never a word to print.
    const raw = dataText(today, 'weather');
    const word = /^\d+$/.test(raw) ? '' : cleanCondition(raw);
    body = `<p class="k-figure">${escapeHtml(range)}</p>${word ? `<p class="k-figure-sub">${escapeHtml(word)}</p>` : ''}${today.summary ? `<p class="k-text">${escapeHtml(today.summary)}</p>` : ''}`;
  }
  return block(s.paired.forecast, body, { s, snapshot: snap, item: today, testid: 'k-forecast' });
}

/** The day as an arc: sunrise left, sunset right, the sun where it is now; nothing drawn at night. */
function sunArc(sun: SunToday): string {
  const a = Math.PI * (1 - sun.progress);
  const x = (50 + 45 * Math.cos(a)).toFixed(1);
  const y = (52 - 45 * Math.sin(a)).toFixed(1);
  const day = sun.isDay ? `<path class="k-sunarc-done" d="M5 52 A45 45 0 0 1 ${x} ${y}"/><circle class="k-sunarc-sun" cx="${x}" cy="${y}" r="4.5"/>` : '';
  return `<svg class="k-sunarc" viewBox="0 0 100 56" aria-hidden="true" focusable="false"><path class="k-sunarc-track" d="M5 52 A45 45 0 0 1 95 52"/>${day}<line class="k-sunarc-horizon" x1="0" y1="52" x2="100" y2="52"/></svg>`;
}

/** Computed on the device, never fetched. */
function sunBlock(ctx: PairedContext): string {
  const { strings: s } = ctx;
  const sun = sunToday(ctx.now);
  const hours = Math.floor(sun.daylightMinutes / 60);
  const minutes = sun.daylightMinutes % 60;
  const text = `<div class="k-sun-text"><p class="k-figure">${escapeHtml(`${fill(s.weather.sunrise, { time: sun.sunrise })} · ${fill(s.weather.sunset, { time: sun.sunset })}`)}</p><p class="k-figure-sub">${escapeHtml(fill(s.weather.daylight, { hours, minutes }))}</p><p class="k-meta">${escapeHtml(ctx.i18n.t('panels.sunComputed'))}</p></div>`;
  return `<article class="k-block k-block--sun" data-testid="k-sun">${kicker(s.paired.sun)}<div class="k-block-body">${text}${sunArc(sun)}</div></article>`;
}

function quakeRows(ctx: PairedContext, limit: number): string[] {
  const emsc = ctx.snapshots.emsc;
  const { strings: s, locale } = ctx;
  // Only quakes inside the declared window and radius; a missing measure is said to be missing, never zero.
  return recentQuakes(emsc, ctx.now).slice(0, limit).map((q) => {
    const mag = dataNumber(q, 'mag');
    const depth = dataNumber(q, 'depth');
    return row(
      `<strong>${escapeHtml(mag === null ? s.paired.magUnknown : `M ${fmtNumber(locale, mag, 1)}`)}</strong> · ${escapeHtml(dataText(q, 'region') || q.title)}`,
      escapeHtml(depth === null ? s.paired.depthUnknown : fill(s.paired.depth, { depth: fmtNumber(locale, depth, 0) })),
      escapeHtml(dayTime(q.at)),
    );
  });
}

function quakesBlock(ctx: PairedContext, limit: number, grow = false): string {
  const emsc = ctx.snapshots.emsc;
  return block(ctx.strings.paired.quakes, listBody(emsc, quakeRows(ctx, limit), ctx.strings.paired.quakeNone, ctx.strings, quakeRows(ctx, Infinity).length), { s: ctx.strings, snapshot: emsc, testid: 'k-quakes', grow });
}

function renderVrijeme(ctx: PairedContext): PairedMarkup {
  const main = `${weatherHero(ctx)}${forecastBlock(ctx)}${sunBlock(ctx)}`;
  const selected = selectionCard(ctx);
  return { lines: '', main, side: `${selected}${warningsBlock(ctx, true)}${selected ? '' : quakesBlock(ctx, ctx.size === 'wide' ? 3 : 2)}` };
}

// --- Sigurnost ------------------------------------------------------------------

function pharmacyRows(ctx: PairedContext, limit: number): string[] {
  return pharmaciesByDistance(ctx.stop).slice(0, limit).map((p) => row(
    escapeHtml(p.label),
    escapeHtml([p.address, p.hours].filter(Boolean).join(' · ')),
    p.phoneDisplay ? escapeHtml(p.phoneDisplay) : '',
  ));
}

/** The curated on-duty list is real Grad Zagreb data with its own source line,
 *  ordered by distance from the screen's stop (the distance itself is not printed). */
function pharmaciesBlock(ctx: PairedContext, limit: number, grow = false): string {
  const { strings: s } = ctx;
  const body = `<ul class="k-rows">${pharmacyRows(ctx, limit).map((r) => `<li class="k-row">${r}</li>`).join('')}</ul>`;
  return `<article class="k-block${grow ? ' k-block--grow' : ''}" data-testid="k-pharmacies">${kicker(s.paired.pharmacies)}<div class="k-block-body">${body}</div><p class="k-meta k-source">${escapeHtml(LJEKARNE_SOURCE.text)}</p></article>`;
}

function assemblyRows(ctx: PairedContext, limit: number): string[] {
  const geo = ctx.snapshots['ckan-geo'];
  const points = (isLive(geo) ? geo.items : [])
    .filter((item) => item.kind === 'poi' && dataText(item, 'layer') === 'zborna-mjesta' && item.geo?.type === 'Point')
    .map((item) => {
      const [lon, lat] = item.geo!.coordinates as number[];
      const distanceM = ctx.stop && Number.isFinite(lon) && Number.isFinite(lat) ? stopDistanceM({ lon: lon!, lat: lat! }, ctx.stop) : null;
      return { item, distanceM };
    })
    .sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity))
    .slice(0, limit);
  return points.map(({ item, distanceM }) => row(escapeHtml(item.title), escapeHtml(item.summary ?? ''), distanceM === null ? '' : escapeHtml(fmtDistanceWord(ctx.locale, distanceM))));
}

function assemblyBlock(ctx: PairedContext, limit: number): string {
  const geo = ctx.snapshots['ckan-geo'];
  return block(ctx.strings.paired.assemblyPoints, listBody(geo, assemblyRows(ctx, limit), ctx.strings.paired.noData, ctx.strings, assemblyRows(ctx, Infinity).length), { s: ctx.strings, snapshot: geo, testid: 'k-assembly' });
}

function renderSigurnost(ctx: PairedContext): PairedMarkup {
  const wide = ctx.size === 'wide';
  const main = `${warningsBlock(ctx, true)}${closuresBlock(ctx, wide ? 6 : 4, true)}${quakesBlock(ctx, wide ? 3 : 2)}${assemblyBlock(ctx, wide ? 3 : 2)}`;
  return { lines: '', main, side: `${selectionCard(ctx)}${pharmaciesBlock(ctx, wide ? 3 : 2, true)}` };
}

// --- Grad (uprava-i-pravo) ------------------------------------------------------

function actRows(ctx: PairedContext, limit: number): string[] {
  const glasnik = ctx.snapshots.glasnik;
  return (isLive(glasnik) ? glasnik.items : []).slice(0, limit).map((act) => {
    const issue = dataText(act, 'broj') ? `${ctx.strings.paired.acts} ${dataText(act, 'broj')}/${dataText(act, 'godina')}` : '';
    const sub = [issue, dataText(act, 'category')].filter(Boolean).join(' · ');
    return row(escapeHtml(act.title), escapeHtml(sub), act.at ? escapeHtml(weekdayDayMonth(ctx.locale, act.at)) : '');
  });
}

function actsBlock(ctx: PairedContext, limit: number): string {
  const glasnik = ctx.snapshots.glasnik;
  return block(ctx.strings.paired.acts, listBody(glasnik, actRows(ctx, limit), ctx.strings.paired.actsNone, ctx.strings, actRows(ctx, Infinity).length), { s: ctx.strings, snapshot: glasnik, testid: 'k-acts', grow: true });
}

function citySource(item: FeedItem): string {
  return dataText(item, 'source');
}

function sessionRows(ctx: PairedContext, limit: number): string[] {
  const dog = ctx.snapshots.dogadanja;
  const upcoming = (isLive(dog) ? dog.items : [])
    .filter((item) => citySource(item) === 'skupstina' && item.at !== undefined && Date.parse(item.at) >= ctx.now - 86_400_000)
    .slice(0, limit);
  return upcoming.map((item) => row(
    escapeHtml(item.title),
    escapeHtml([dataText(item, 'organiser'), dataText(item, 'venue')].filter(Boolean).join(' · ')),
    escapeHtml(dataText(item, 'precision') === 'day' ? weekdayDayMonth(ctx.locale, item.at!) : `${weekdayDayMonth(ctx.locale, item.at!)} ${clock(item.at)}`),
  ));
}

function sessionsBlock(ctx: PairedContext, limit: number): string {
  const dog = ctx.snapshots.dogadanja;
  return block(ctx.strings.paired.sessions, listBody(dog, sessionRows(ctx, limit), ctx.strings.paired.sessionsNone, ctx.strings, sessionRows(ctx, Infinity).length), { s: ctx.strings, snapshot: dog, testid: 'k-sessions', noSource: true });
}

/** The register's phase and listed amount as stated, and its last-change
 *  stamp labelled as such -- never shown as a scheduled date. */
function worksRows(ctx: PairedContext, limit: number): string[] {
  const dog = ctx.snapshots.dogadanja;
  const { strings: s, locale } = ctx;
  return (isLive(dog) ? dog.items : []).filter((item) => citySource(item) === 'komunalne').slice(0, limit).map((item) => {
    const amount = dataNumber(item, 'amount');
    const phase = dataText(item, 'phase');
    const sub = [phase ? fill(s.paired.phase, { phase }) : '', amount === null ? '' : fill(s.paired.amount, { amount: fmtAmount(locale, amount) })].filter(Boolean).join(' · ');
    const changed = item.at ? fill(s.story.changed, { date: weekdayDayMonth(locale, item.at) }) : '';
    return row(escapeHtml(item.title), escapeHtml([sub, changed].filter(Boolean).join(' · ')));
  });
}

function worksBlock(ctx: PairedContext, limit: number): string {
  const dog = ctx.snapshots.dogadanja;
  return block(ctx.strings.paired.works, listBody(dog, worksRows(ctx, limit), ctx.strings.paired.worksNone, ctx.strings, worksRows(ctx, Infinity).length), { s: ctx.strings, snapshot: dog, testid: 'k-works', grow: true, noSource: true });
}

function renderGrad(ctx: PairedContext): PairedMarkup {
  const wide = ctx.size === 'wide';
  // Acts and sessions side by side; the works register takes the side column, so no column is starved.
  const dog = ctx.snapshots.dogadanja;
  // The one credit names the sources these blocks draw from: the Assembly's calendar and the works register.
  const cityItems = (isLive(dog) ? dog.items : []).filter((item) => citySource(item) === 'skupstina' || citySource(item) === 'komunalne');
  const main = `${actsBlock(ctx, wide ? 6 : 4)}${sessionsBlock(ctx, wide ? 5 : 3)}${mainSource(dog, cityItems, ctx.strings)}`;
  return { lines: '', main, side: `${selectionCard(ctx)}${worksBlock(ctx, wide ? 5 : 3)}` };
}

// --- Događanja (kultura) --------------------------------------------------------

/** Sources whose rows are notices, not dated events, when they state no date basis:
 *  the neighbourhood news and ZET's own notices (a detour, works on a line). ZET's
 *  notices live in this layer's `k-notices` block: Promet's column is the departure
 *  board alone (its five rows, coverage line and mandated credit fill it), and the
 *  unpaired invitation's story rotation carries them too. */
const NOTICE_SOURCES: ReadonlySet<string> = new Set(['kvartovske', 'zet-promet', 'zet-rss', 'zet-novosti']);

/** Rows the culture layer leaves to their own domain: the Assembly and the
 *  works register to Grad. */
const CULTURE_ELSEWHERE: ReadonlySet<string> = new Set(['skupstina', 'komunalne']);
/** A Zagreb screen lists Zagreb events; a venue naming another town is not one. */
const NON_ZAGREB_VENUE = /\b(Split|Hvar|Rijeka|Osijek|Zadar|Dubrovnik|Pula|Varaždin|Šibenik|Karlovac|Sisak|Vukovar|Bjelovar|Koprivnica|Čakovec|Poreč|Rovinj|Makarska|Trogir|Vinkovci|Požega|Opatija|Krk)\b/;

export interface EventGroups {
  today: FeedItem[];
  tomorrow: FeedItem[];
  later: FeedItem[];
  /** Began before today and still runs (an exhibition): shown with its end date, never as today's start. */
  ongoing: FeedItem[];
  notices: FeedItem[];
}

/** Dated events by Zagreb day; rows whose date is a publish or change stamp,
 *  or that state none, are notices (the neighbourhood news). */
export function eventGroups(items: readonly FeedItem[], now: number): EventGroups {
  const out: EventGroups = { today: [], tomorrow: [], later: [], ongoing: [], notices: [] };
  const today = dayKey(now);
  const tomorrow = zagrebDayAfter(now, 1);
  for (const item of items) {
    const source = dataText(item, 'source');
    if (CULTURE_ELSEWHERE.has(source) || NON_ZAGREB_VENUE.test(dataText(item, 'venue'))) continue;
    const basis = item.dateBasis;
    const dated = item.at !== undefined && basis !== 'unknown' && basis !== 'published' && basis !== 'updated' && !(basis === undefined && NOTICE_SOURCES.has(source));
    const start = dated ? Date.parse(item.at!) : NaN;
    if (!Number.isFinite(start)) { out.notices.push(item); continue; }
    const end = item.until ? Date.parse(item.until) : start;
    const key = dayKey(start);
    if (key !== today && start < now && end >= now) out.ongoing.push(item);
    else if (key === today) out.today.push(item);
    else if (start < now) continue;
    else if (key === tomorrow) out.tomorrow.push(item);
    else out.later.push(item);
  }
  const byStart = (a: FeedItem, b: FeedItem): number => Date.parse(a.at!) - Date.parse(b.at!);
  out.today.sort(byStart);
  out.tomorrow.sort(byStart);
  out.later.sort(byStart);
  out.ongoing.sort((a, b) => Date.parse(a.until ?? a.at!) - Date.parse(b.until ?? b.at!));
  return out;
}

function eventRow(item: FeedItem, ctx: PairedContext, withDay: boolean): string {
  const { strings: s, locale } = ctx;
  const allDay = dataText(item, 'precision') === 'day';
  const when = withDay
    ? (allDay ? weekdayDayMonth(locale, item.at!) : `${weekdayDayMonth(locale, item.at!)} ${clock(item.at)}`)
    : (allDay ? s.paired.allDay : clock(item.at));
  // A category slug is printed only as a word the catalogue knows; a raw slug never reaches the screen.
  const category = s.events[dataText(item, 'category')] ?? '';
  const sub = [category, dataText(item, 'venue') || dataText(item, 'organiser')].filter(Boolean).join(' · ');
  return row(escapeHtml(item.title), escapeHtml(sub), escapeHtml(when));
}

function eventsBlock(ctx: PairedContext, title: string, items: readonly FeedItem[], limit: number, testid: string, withDay: boolean): string {
  const dog = ctx.snapshots.dogadanja;
  const rows = items.slice(0, limit).map((item) => eventRow(item, ctx, withDay));
  return block(title, listBody(dog, rows, ctx.strings.paired.eventsNone, ctx.strings, items.length), { s: ctx.strings, snapshot: dog, testid, grow: true, noSource: true });
}

function noticeRows(ctx: PairedContext, items: readonly FeedItem[], limit: number): string[] {
  return items.slice(0, limit).map((item) => row(
    escapeHtml(item.title),
    escapeHtml([cityKicker(dataText(item, 'source'), ctx.strings), cityDateLine(item, ctx.strings, ctx.locale)].filter(Boolean).join(' · ')),
  ));
}

function ongoingRow(item: FeedItem, ctx: PairedContext): string {
  const { strings: s, locale } = ctx;
  const category = s.events[dataText(item, 'category')] ?? '';
  const sub = [s.paired.ongoingWord, category, dataText(item, 'venue') || dataText(item, 'organiser')].filter(Boolean).join(' · ');
  const until = item.until ? fill(s.paired.ongoingUntil, { date: weekdayDayMonth(locale, item.until) }) : '';
  return row(escapeHtml(item.title), escapeHtml(sub), escapeHtml(until));
}

function ongoingBlock(ctx: PairedContext, items: readonly FeedItem[], limit: number): string {
  const dog = ctx.snapshots.dogadanja;
  const rows = items.slice(0, limit).map((item) => ongoingRow(item, ctx));
  return block(ctx.strings.paired.ongoing, listBody(dog, rows, ctx.strings.paired.eventsNone, ctx.strings, items.length), { s: ctx.strings, snapshot: dog, testid: 'k-ongoing', grow: true, noSource: true });
}

function renderKultura(ctx: PairedContext): PairedMarkup {
  const { strings: s } = ctx;
  const dog = ctx.snapshots.dogadanja;
  const groups = eventGroups(isLive(dog) ? dog.items : [], ctx.now);
  const half = ctx.size === 'wide' ? 4 : 3;
  // One credit for the whole layer, naming the sources of the rows it can show -- the notices included, so no second copy sits under them.
  const shown = [...groups.today, ...groups.ongoing, ...groups.tomorrow, ...groups.later, ...groups.notices];
  const main = `<div class="k-stack">${eventsBlock(ctx, s.paired.today, groups.today, half, 'k-today', false)}${ongoingBlock(ctx, groups.ongoing, half)}</div><div class="k-stack">${eventsBlock(ctx, s.paired.tomorrow, groups.tomorrow, half, 'k-tomorrow', false)}${eventsBlock(ctx, s.paired.later, groups.later, half, 'k-later', true)}</div>${mainSource(dog, shown, s)}`;
  const notices = block(s.paired.notices, listBody(dog, noticeRows(ctx, groups.notices, ctx.size === 'wide' ? 4 : 3), s.paired.noData, s, groups.notices.length), { s, snapshot: dog, testid: 'k-notices', grow: true, noSource: true });
  return { lines: '', main, side: `${selectionCard(ctx)}${notices}` };
}

// --- Dispatch and mount ------------------------------------------------------------

export function pairedMarkup(ctx: PairedContext): PairedMarkup {
  switch (ctx.layer) {
    case 'u-pokretu': return renderPromet(ctx);
    case 'zrak-i-nebo': return renderVrijeme(ctx);
    case 'sigurnost': return renderSigurnost(ctx);
    case 'uprava-i-pravo': return renderGrad(ctx);
    case 'kultura': return renderKultura(ctx);
    default: return renderSada(ctx);
  }
}

/** Mounts the paired composition once; update() swaps the shell only when the
 *  layer changes and otherwise rewrites just the boxes whose markup differs,
 *  so a poll that brought the same data repaints nothing. */
export function mountPaired(host: HTMLElement, deps: PairedDeps): PairedHandle {
  const element = document.createElement('section');
  element.className = 'k-paired';
  element.dataset.testid = 'kiosk-layer';
  host.appendChild(element);
  let layer: LayerId | null = null;
  let last: PairedMarkup = { lines: '', main: '', side: '' };
  let linesEl: HTMLElement | null = null;
  let mainEl: HTMLElement | null = null;
  let sideEl: HTMLElement | null = null;
  const handle: PairedHandle = {
    element,
    mapHost: null,
    update(ctx) {
      if (ctx.layer !== layer) {
        layer = ctx.layer;
        element.dataset.layer = layer;
        element.innerHTML = pairedShell(layer, deps.strings, deps.lightweight);
        linesEl = element.querySelector<HTMLElement>('[data-testid=kiosk-lines]');
        mainEl = element.querySelector<HTMLElement>('[data-testid=kiosk-main]');
        sideEl = element.querySelector<HTMLElement>('[data-testid=kiosk-side]');
        handle.mapHost = element.querySelector<HTMLElement>('[data-testid=kiosk-map-host]');
        last = { lines: '', main: '', side: '' };
        deps.onShell?.();
      }
      const next = pairedMarkup(ctx);
      if (linesEl && next.lines !== last.lines) linesEl.innerHTML = next.lines;
      if (mainEl && next.main !== last.main) mainEl.innerHTML = next.main;
      if (sideEl && next.side !== last.side) sideEl.innerHTML = next.side;
      last = next;
    },
    destroy() {
      element.remove();
    },
  };
  return handle;
}
