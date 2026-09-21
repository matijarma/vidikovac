// Sigurnost: the same content /hitno shows everyone without a script, inside
// the session and in the order a person in trouble needs it. The verdict is
// one band and the first thing on the page; the numbers are the only tiles;
// warnings and quakes are the rows Vrijeme uses; five closures point at the
// map in Promet; the six on-duty pharmacies stand nearest this screen first;
// the assembly points group by gradska četvrt when the source names one and
// page when it does not (R-K4). An unavailable source is unknown, never
// all-clear, and `safetyState` is the one source of the verdict.
import type { FeedItem, ModuleSnapshot } from '../../../worker/feed/schema';
import { EMERGENCY_NUMBERS, EMERGENCY_NUMBERS_SOURCE } from '../../../worker/hitno/brojevi';
import { LJEKARNE, LJEKARNE_CHECKED_ON, LJEKARNE_SOURCE, type Pharmacy } from '../../../worker/hitno/ljekarne';
import { actionButton, externalLink, navLink, searchField, section, sectionHead, signRow, type Tone } from '../experience/blocks';
import { safetyState, type SafetyState } from '../experience/safety-state';
import { coverageText, listState, provenanceBlock, stateBlock } from '../experience/status';
import { numberText, pointOf, relativeTime } from '../experience/text';
import { zagrebDateTime, zagrebTime, zagrebWeekdayDate } from '../format';
import type { I18n } from '../i18n/i18n';
import { DISTRICTS, type District } from '../kiosk/districts';
import { pharmaciesByDistance } from '../kiosk/local';
import { dataText } from '../panels/panel';
import { createElementFromHTML, escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import type { LayerContext } from './types';
import { placeQuakes, quakeRow, warningRow, warningWindow } from './zrak-i-nebo';

export const ASSEMBLY_LAYER = 'zborna-mjesta';
/** Twelve rows, then 24 more at a time: a list, not the whole register (R-K4). */
const ASSEMBLY_PAGE = 12;
const ASSEMBLY_STEP = 24;
/** Five closures here; every one of them is on the map in Promet. */
const CLOSURES_SHOWN = 5;
/** Five quakes of the 72 hours; the week with its figure is Vrijeme's. */
const QUAKES_SHOWN = 5;
/** A view filter key is at most 32 characters (view-store.ts); the prefix leaves a district slug 28. */
const DISTRICT_FILTER_PREFIX = 'zm-';
const DISTRICT_SLUG_MAX = 28;
/** The paging key of the flat list, when no point names its district. */
const ASSEMBLY_FILTER = 'assembly';

/** A flat safety section: a hairline and air above it, no card (layers.css `.sf-sec`). */
function sfSection(o: { id: string; tone: Tone; wide?: boolean; body: string }): string {
  return section({ id: o.id, tone: o.tone, className: `sf-sec${o.wide ? ' sf-wide' : ''}`, testid: o.id, body: o.body });
}

function sourceFoot(text: string, url: string, i18n: I18n): string {
  return `<footer class="source"><p class="source-line"><span class="source-text">${escapeHtml(text)}</span> ${externalLink(url, i18n.t('common.openSource'), 'source-link')}</p></footer>`;
}

// --- The verdict ------------------------------------------------------------

/**
 * The severities that make the city urgent, ranked: the same predicate
 * `safetyState` raises `urgent` from, so a warning names the verdict only when
 * it is itself a reason for it. `minor` and `info` are real DHMZ severities
 * and neither is; "zeleno" is never a level word (R-K1).
 */
const URGENT_RANK: Record<string, number> = { extreme: 3, severe: 2, moderate: 1 };

function topWarning(state: SafetyState): FeedItem | undefined {
  return [...state.activeWarnings]
    .filter((w) => URGENT_RANK[w.severity ?? ''] !== undefined)
    .sort((a, b) => URGENT_RANK[b.severity!]! - URGENT_RANK[a.severity!]!)[0];
}

/**
 * "Žuto upozorenje: grmljavinsko nevrijeme". The colour word opens the
 * sentence, so it is capitalised; the event follows a colon as the common noun
 * DHMZ names it with, so its first letter drops to lower case, unless the word
 * is written in capitals (an acronym keeps its case).
 */
function verdictSentence(level: string, event: string): string {
  const head = level.charAt(0).toLocaleUpperCase('hr') + level.slice(1);
  const acronym = event.length > 1 && event.charAt(1) !== event.charAt(1).toLocaleLowerCase('hr');
  const tail = acronym ? event : event.charAt(0).toLocaleLowerCase('hr') + event.slice(1);
  return `${head}: ${tail}`;
}

interface Verdict { title: string; note: string }

/** The verdict in the domain's words and the one line under it: the window of the warning, the quake that is the reason, or the confirmation. */
function verdict(i18n: I18n, state: SafetyState, now: number): Verdict {
  if (state.level === 'calm') {
    return { title: i18n.t('safety.calm'), note: state.confirmedAt ? i18n.t('safety.calmNote', { time: zagrebTime(state.confirmedAt) }) : '' };
  }
  if (state.level === 'unknown') return { title: i18n.t('directory.safetySummaryUnknown'), note: i18n.t('safety.unknownNote') };
  const top = topWarning(state);
  if (top) return { title: verdictSentence(i18n.t(`panels.severity.${top.severity}`), dataText(top, 'event') || top.title), note: warningWindow(i18n, top, now) };
  // The quake is the reason: the strongest of the window, placed by its own distance.
  const quake = placeQuakes(state.quakes72h).sort((a, b) => (b.mag ?? 0) - (a.mag ?? 0))[0];
  const note = quake
    ? [
      quake.mag === null ? '' : i18n.t('weather.magnitude', { mag: numberText(i18n, quake.mag, 1) }),
      quake.km === null ? dataText(quake.q, 'region') || quake.q.title : i18n.t('weather.quakeDistance', { km: Math.round(quake.km) }),
      relativeTime(i18n, quake.q.at, now),
    ].filter(Boolean).join(' · ')
    : '';
  return { title: i18n.t('safety.urgent'), note };
}

/** The band (signage.css `.band`, one tint on the page) and, under it, the way to the same content with no scan. */
function verdictBand(i18n: I18n, state: SafetyState, now: number): string {
  const v = verdict(i18n, state, now);
  const note = v.note ? `<span class="sf-verdict-note">${escapeHtml(v.note)}</span>` : '';
  return `<div class="sf-verdict" data-key="sf-verdict"><div class="band sf-level" data-level="${state.level}" data-testid="safety-level" role="status">${iconMarkup('shield')}<span class="sf-verdict-text"><span class="band-title">${escapeHtml(v.title)}</span>${note}</span></div><a class="link-arrow sf-hitno" href="/hitno" data-testid="hitno-link"><span>${escapeHtml(i18n.t('safety.hitnoSame'))}</span>${iconMarkup('arrow-up-right', undefined, 'icon icon-sm')}</a></div>`;
}

// --- Numbers ----------------------------------------------------------------

/** The tiles are the allowed boxes here (R-D3): objects a finger presses. 112 is inverted and twice as wide; its name is what is printed on it. */
function numbersSection(i18n: I18n): string {
  const tiles = EMERGENCY_NUMBERS.map((n, index) =>
    `<li><a class="tile sf-number${index === 0 ? ' tile-primary sf-number-primary' : ''}" href="tel:${escapeAttribute(n.number)}"><span class="tile-value">${escapeHtml(n.number)}</span><span class="tile-label">${escapeHtml(n.label)}</span></a></li>`).join('');
  return sfSection({
    id: 'sf-numbers', tone: 'urgency', wide: true,
    body: sectionHead(i18n, { title: i18n.t('safety.numbers'), id: 'sf-numbers-title', noStatus: true }) + `<ul class="sf-numbers" role="list">${tiles}</ul>` + sourceFoot(EMERGENCY_NUMBERS_SOURCE.text, EMERGENCY_NUMBERS_SOURCE.url, i18n),
  });
}

// --- Warnings ---------------------------------------------------------------

function warningsSection(i18n: I18n, ctx: LayerContext, state: SafetyState): string {
  const cap = ctx.snapshots['dhmz-cap'];
  const error = ctx.errors?.['dhmz-cap'];
  // As on Vrijeme: a warning whose window has closed is over; the ones in force or still to come are warnings.
  const items = state.warnings.filter((w) => !w.until || Date.parse(w.until) >= ctx.now);
  const list = listState(i18n, cap, 'dhmz-cap', items.length, i18n.t('weather.warningsNone'), error)
    || `<ul class="wx-warnings" role="list" data-testid="safety-warnings">${items.map((w) => warningRow(i18n, w, ctx.now)).join('')}</ul>`;
  return sfSection({
    id: 'sf-warnings', tone: 'urgency',
    body: sectionHead(i18n, { title: i18n.t('safety.warnings'), snapshot: cap, error, id: 'sf-warnings-title' }) + list,
  });
}

// --- Closures ---------------------------------------------------------------

/** The closure mark leads, the street is the title, one line says what kind, which way and until when. */
function closureRow(i18n: I18n, c: FeedItem): string {
  const type = i18n.t(`panels.closureType.${dataText(c, 'subtype') || 'ROAD_CLOSED'}`);
  const direction = i18n.t(`panels.direction.${dataText(c, 'direction') || 'BOTH_DIRECTIONS'}`);
  const end = c.until ? i18n.t('panels.until', { time: zagrebDateTime(c.until) }) : i18n.t('safety.noEnd');
  return signRow({ lead: '<span class="mark-closure"></span>', title: c.title, sub: `${type} · ${direction} · ${end}`, key: c.id, attrs: { 'data-testid': 'closure-row' } });
}

function closuresSection(i18n: I18n, ctx: LayerContext, state: SafetyState): string {
  const roads = ctx.snapshots.prometnice;
  const error = ctx.errors?.prometnice;
  const items = state.activeClosures;
  // The public selection names one route, stop or item, never "closures on"; Promet shows closures by default, so the link is plain.
  const all = navLink('u-pokretu', i18n.t('safety.allClosures', { count: items.length }), { className: 'link-arrow sf-all' });
  const list = listState(i18n, roads, 'prometnice', items.length, i18n.t('safety.closuresNone'), error)
    || `<ul class="rows sf-rows" role="list" data-testid="safety-closures">${items.slice(0, CLOSURES_SHOWN).map((c) => closureRow(i18n, c)).join('')}</ul>${all}`;
  return sfSection({
    id: 'sf-closures', tone: 'urgency',
    body: sectionHead(i18n, { title: i18n.t('safety.closures'), snapshot: roads, error, id: 'sf-closures-title' }) + list,
  });
}

// --- Pharmacies -------------------------------------------------------------

/** The name in bold, the address and the hours under it, the call as a 48 px button named with the number it dials. */
function pharmacyRow(i18n: I18n, p: Pharmacy, nearest: boolean): string {
  const badge = nearest ? `<span class="badge">${escapeHtml(i18n.t('safety.nearestScreen'))}</span>` : '';
  const call = p.phoneE164 && p.phoneDisplay
    ? `<a class="btn-ghost sf-call" href="tel:${escapeAttribute(p.phoneE164)}" aria-label="${escapeAttribute(i18n.t('safety.call', { number: p.phoneDisplay }))}">${iconMarkup('phone')}<span>${escapeHtml(i18n.t('safety.callShort'))}</span></a>`
    : `<span class="row-sub sf-no-phone">${escapeHtml(i18n.t('safety.noPhone'))}</span>`;
  return `<li class="row sf-pharmacy" data-key="${escapeAttribute(p.label)}" data-testid="pharmacy"><span class="row-main"><span class="row-title"><span class="sf-pharmacy-name">${escapeHtml(p.label)}</span>${badge}</span><span class="row-sub">${escapeHtml(p.address)}</span><span class="row-sub">${escapeHtml(p.hours)}</span></span>${call}</li>`;
}

/**
 * All six, nearest this screen's stop first (kiosk/local.ts ranks them by
 * approximate geocodes, so the nearest is badged and no distance is printed);
 * the source's order when the page has no stop. The list is hand-maintained,
 * so it carries the "provjeriti" mark and the date it was last checked.
 */
function pharmaciesSection(i18n: I18n, ctx: LayerContext): string {
  const stop = ctx.screen?.stop ?? null;
  const byLabel = new Map(LJEKARNE.map((p) => [p.label, p]));
  const rows = pharmaciesByDistance(stop).map((ranked, index) => {
    // The ranking is built from LJEKARNE itself, so every label is in the map.
    const p = byLabel.get(ranked.label)!;
    return pharmacyRow(i18n, p, index === 0 && ranked.distanceM !== null);
  }).join('');
  const checked = zagrebWeekdayDate(`${LJEKARNE_CHECKED_ON}T12:00:00Z`);
  const mark = `<span class="badge" data-tone="stale">${escapeHtml(i18n.t('safety.verify'))}</span>`;
  return sfSection({
    id: 'sf-pharmacies', tone: 'action',
    body: sectionHead(i18n, { title: i18n.t('safety.pharmacies'), id: 'sf-pharmacies-title', noStatus: true, aside: mark }) +
      `<p class="sec-note">${escapeHtml(i18n.t('safety.pharmaciesNote', { date: checked }))}</p><ul class="rows sf-rows" role="list">${rows}</ul>` +
      sourceFoot(LJEKARNE_SOURCE.text, LJEKARNE_SOURCE.url, i18n),
  });
}

// --- Quakes -----------------------------------------------------------------

function quakesSection(i18n: I18n, ctx: LayerContext, state: SafetyState): string {
  const emsc = ctx.snapshots.emsc;
  const error = ctx.errors?.emsc;
  const placed = placeQuakes(state.quakes72h);
  let body = listState(i18n, emsc, 'emsc', placed.length, i18n.t('safety.quakesNone'), error);
  if (!body) {
    const shown = placed.slice(0, QUAKES_SHOWN);
    const count = shown.length < placed.length ? `<p class="sec-note">${escapeHtml(i18n.t('status.coverage', { shown: shown.length, total: placed.length }))}</p>` : '';
    body = `<ul class="rows sf-rows" role="list" data-testid="safety-quakes">${shown.map((p) => quakeRow(i18n, p)).join('')}</ul>${count}`;
  }
  return sfSection({
    id: 'sf-quakes', tone: 'urgency',
    body: sectionHead(i18n, { title: i18n.t('safety.quakes'), snapshot: emsc, error, id: 'sf-quakes-title' }) + body,
  });
}

// --- Assembly points --------------------------------------------------------

function normalise(value: string): string {
  return value.toLocaleLowerCase('hr').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** A district as a key: case, diacritics and the dash between its halves do not count ("Gornji Grad-Medveščak" is "Gornji grad – Medveščak"). */
function districtKey(value: string): string {
  return normalise(value).replace(/[-–—]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A filter-key slug for a district the table does not know, within the key's length. */
function districtSlug(value: string): string {
  return districtKey(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, DISTRICT_SLUG_MAX);
}

const KNOWN_DISTRICTS = new Map<string, District>(DISTRICTS.map((d) => [districtKey(d.name), d]));

export function assemblyPoints(snapshot: ModuleSnapshot | undefined): FeedItem[] {
  return (snapshot?.items ?? []).filter((item) => dataText(item, 'layer') === ASSEMBLY_LAYER);
}

function osmLink(item: FeedItem): string | null {
  const point = pointOf(item);
  return point ? `https://www.openstreetmap.org/?mlat=${point[1]}&mlon=${point[0]}#map=17/${point[1]}/${point[0]}` : null;
}

/** The place as the title, the source's summary as the second line, the map as a 44 px link at the end; a dense row. */
function pointRow(i18n: I18n, p: FeedItem): string {
  const osm = osmLink(p);
  return signRow({
    lead: '',
    title: p.title,
    sub: p.summary,
    trail: osm ? externalLink(osm, i18n.t('safety.mapLink')) : '',
    key: p.id,
    attrs: { 'data-testid': 'assembly-point', class: 'row-dense' },
  });
}

/** Twelve rows and a "Prikaži još" that adds 24 (T1.4): the shape of every paged list here. */
function pagedRows(i18n: I18n, ctx: LayerContext, points: readonly FeedItem[], filterKey: string, testid?: string): string {
  const shownCount = Math.min(points.length, Number(ctx.view?.filters[filterKey]) || ASSEMBLY_PAGE);
  const more = shownCount < points.length
    ? actionButton('filter', i18n.t('common.showMore', { count: Math.min(ASSEMBLY_STEP, points.length - shownCount) }), { className: 'btn-ghost sf-more', extra: { 'filter-key': filterKey, 'filter-value': shownCount + ASSEMBLY_STEP } })
    : '';
  const id = testid ? ` data-testid="${escapeAttribute(testid)}"` : '';
  return `<ul class="rows sf-rows" role="list"${id}>${points.slice(0, shownCount).map((p) => pointRow(i18n, p)).join('')}</ul>${more}`;
}

interface DistrictGroup { label: string; slug: string; order: number; points: FeedItem[] }

/** Groups in the order of kiosk/districts.ts; a district the table does not know follows in first-seen order; points without one come last. */
function groupByDistrict(i18n: I18n, points: readonly FeedItem[]): DistrictGroup[] {
  const groups = new Map<string, DistrictGroup>();
  let unknownOrder = DISTRICTS.length;
  for (const p of points) {
    const raw = dataText(p, 'district');
    const known = raw ? KNOWN_DISTRICTS.get(districtKey(raw)) : undefined;
    const key = known ? known.slug : raw ? districtKey(raw) : '';
    let group = groups.get(key);
    if (!group) {
      group = known
        ? { label: known.name, slug: known.slug, order: DISTRICTS.indexOf(known), points: [] }
        : raw
          ? { label: raw, slug: districtSlug(raw), order: unknownOrder++, points: [] }
          : { label: i18n.t('safety.districtUnknown'), slug: 'bez-cetvrti', order: Number.MAX_SAFE_INTEGER, points: [] };
      groups.set(key, group);
    }
    group.points.push(p);
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}

/**
 * One `<details>` per district, closed: its name and count on a 44 px summary,
 * its rows paged inside like the flat list, so the page never carries the
 * whole register. The reconciler keeps `open` as the reader's own state.
 */
function districtGroup(i18n: I18n, ctx: LayerContext, g: DistrictGroup): string {
  const filterKey = `${DISTRICT_FILTER_PREFIX}${g.slug}`;
  const count = i18n.t('safety.places', { count: g.points.length });
  return `<details class="sf-district" data-key="${escapeAttribute(filterKey)}"><summary class="sf-district-head"><span class="sf-district-name">${escapeHtml(g.label)}</span> <span class="sf-district-count">· ${escapeHtml(count)}</span>${iconMarkup('chevron-down')}</summary>${pagedRows(i18n, ctx, g.points, filterKey)}</details>`;
}

function assemblySection(i18n: I18n, ctx: LayerContext): string {
  const geo = ctx.snapshots['ckan-geo'];
  const error = ctx.errors?.['ckan-geo'];
  const all = assemblyPoints(geo);
  const rawQuery = ctx.view?.filters.zborna ?? '';
  const query = rawQuery.trim();
  const down = geo?.sources?.[ASSEMBLY_LAYER]?.status === 'down';
  let body = down
    ? stateBlock(i18n, 'down', i18n.t('safety.assemblyUnknown'), { retry: 'ckan-geo', testid: 'assembly-unknown' })
    : listState(i18n, geo, 'ckan-geo', all.length, i18n.t('safety.assemblyUnknown'), error);
  if (!body) {
    // The sentence names the register's true size. ckan-geo serves two layers in one module, so the module's
    // coverage.total counts the districts too; the assembly source's own totalItems is the number before its cap.
    const total = geo?.sources?.[ASSEMBLY_LAYER]?.totalItems ?? all.length;
    const intro = `<p class="sf-intro">${escapeHtml(i18n.t('safety.assemblyIntro', { count: total }))}</p>`;
    const search = searchField({ id: 'assembly-search', key: 'zborna', label: i18n.t('safety.assemblySearch'), placeholder: i18n.t('safety.assemblySearch'), value: rawQuery });
    let list: string;
    if (query) {
      // A search filters every point and shows every match as one list: the one list here that is never paged (T1.4).
      const needle = normalise(query);
      const matches = all.filter((p) => normalise(`${p.title} ${p.summary ?? ''} ${dataText(p, 'district')}`).includes(needle));
      list = matches.length
        ? `<ul class="rows sf-rows" role="list" data-testid="assembly-points">${matches.map((p) => pointRow(i18n, p)).join('')}</ul>`
        : stateBlock(i18n, 'empty', i18n.t('safety.assemblyNone'));
    } else if (all.some((p) => dataText(p, 'district'))) {
      list = `<div class="sf-districts" role="group" aria-label="${escapeAttribute(i18n.t('safety.districts'))}">${groupByDistrict(i18n, all).map((g) => districtGroup(i18n, ctx, g)).join('')}</div>`;
    } else {
      list = pagedRows(i18n, ctx, all, ASSEMBLY_FILTER, 'assembly-points');
    }
    const coverage = coverageText(i18n, geo);
    body = `${intro}${search}${list}${coverage ? `<p class="sec-note">${escapeHtml(coverage)}</p>` : ''}`;
  }
  return sfSection({
    id: 'sf-assembly', tone: 'action', wide: true,
    body: sectionHead(i18n, { title: i18n.t('safety.assembly'), snapshot: geo, error, id: 'sf-assembly-title' }) + body,
  });
}

export function renderSigurnost(ctx: LayerContext): HTMLElement {
  const { i18n } = ctx;
  const state = safetyState(ctx.snapshots, ctx.now);
  // The layer title is for readers of the tree on a phone, where the verdict is the head; a desk shows it (layers.css `.sf-head`).
  return createElementFromHTML(`<section class="layer ws ws-safety" id="layer-sigurnost" data-layer="sigurnost" data-reconcile aria-labelledby="layer-title-sigurnost" data-level="${state.level}">
<header class="ws-head sf-head"><h2 class="layer-title" id="layer-title-sigurnost" tabindex="-1">${escapeHtml(i18n.t('layers.sigurnost'))}</h2></header>
${verdictBand(i18n, state, ctx.now)}
<div class="sf-grid">${numbersSection(i18n)}${warningsSection(i18n, ctx, state)}${pharmaciesSection(i18n, ctx)}${closuresSection(i18n, ctx, state)}${quakesSection(i18n, ctx, state)}${assemblySection(i18n, ctx)}</div>
${provenanceBlock(i18n, [ctx.snapshots['dhmz-cap'], ctx.snapshots.prometnice, ctx.snapshots.emsc, ctx.snapshots['ckan-geo']])}
</section>`);
}
