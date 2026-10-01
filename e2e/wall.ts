// The wall sampler: one reading of the passive wall (header, "U blizini" list,
// map probes, QR card, footer, the controls a passer-by could press) and the
// ten-minute rotation made of 300 such readings, summarised into the numbers
// the brief's principles are tested by (§10: bounded departures, one sentence
// within 80 characters, honesty by selection, calm motion, no operator chrome;
// §12: the fallback ladder). Ported from the walkthroughs of 21 September
// (review.local/companion/walkthroughs/1720-mon/lib.mjs kioskSample,
// startKioskLog, summariseRotation) onto the probe contract of brief §15.6.
//
// One source for the wall's selectors: WALL_PROBES below is the only place the
// accept specs, the production observer and the unit tier read them from, so a
// probe renamed by WP1–WP3 is renamed here once. The page-side reading
// (WALL_SAMPLE_IN_PAGE) receives the selectors and the patterns in its
// argument and references nothing else, the rule of e2e/geometry.ts.
import type { Page } from '@playwright/test';
import { DISCL } from './inventory';

/** Page access the sampler needs; Playwright's Page satisfies it. */
export type WallPage = Pick<Page, 'evaluate' | 'waitForTimeout'> & { clock: Pick<Page['clock'], 'runFor'> };

// --- the probe contract (brief §15.6), the one place the wall's selectors live ----------------
export const WALL_PROBES = Object.freeze({
  /** The place: stop or street, "Zagreb" for the whole city (the existing kiosk-context, WP3). */
  place: '[data-testid=kiosk-context]',
  /** `[data-kicker=promet|kultura|vrijeme|bicikli|nocas|radovi][data-valid-until]` (WP1). */
  sentence: '[data-testid=kiosk-sentence]',
  sentenceKicker: '[data-testid=kiosk-sentence-kicker]',
  sentenceText: '[data-testid=kiosk-sentence-text]',
  /** The long-press target for the settings (WP3). */
  brand: '[data-testid=kiosk-brand]',
  head: '.k-head',
  date: '[data-testid=kiosk-date]',
  clock: '[data-testid=kiosk-clock]',
  nearby: '[data-testid=nearby]',
  nearbyHead: '[data-testid=nearby-head]',
  nearbyRows: '[data-testid=nearby-rows]',
  /** `li.nearby-row[data-id][data-kind][data-when=<ISO> | data-always="1"][data-live="1"?][data-source]` (WP1); the
   *  departures line (R1) is one of them, `[data-kind=departures][data-cells=N]`, its departures its cells (depCell). */
  row: '[data-testid=nearby] .nearby-row',
  /** The wall's one departures row (R1, docs/reveal-2026-10-plan/R1.md §0.2(d)). */
  depLine: '[data-testid=nearby] .nearby-row[data-kind="departures"]',
  /** `span.k-dep-cell[data-id][data-cell=1..3][data-when][data-live="1"?][data-route][data-source][data-headsign="0"?]`. */
  depCell: '[data-testid=nearby] .nearby-row[data-kind="departures"] [data-cell]',
  /** The kiosk root: `data-rhythm` (Ritam, seconds) among its attributes (R2 reads it for the beat). */
  kioskRoot: '[data-testid=kiosk]',
  rowTitle: '.nearby-title',
  rowWhen: '.nearby-when',
  rowSub: '.nearby-sub',
  rowTime: 'time',
  /** The wall map container: data-map-status, data-zoom, data-pills, data-bodies, data-feed, data-markers, data-unlabelled (WP2). */
  map: '[data-testid=kiosk-map]',
  /** `[data-frame=4|6|8][data-major-labels]` (WP2). */
  mapHost: '[data-testid=kiosk-map-host]',
  /** The one quiet outage note on the map (WP1). */
  mapNote: '[data-testid=map-note]',
  legend: '.k-map-legend',
  invitation: '[data-testid=kiosk-invitation]',
  qr: '[data-testid=kiosk-qr]',
  qrSvg: '[data-testid=kiosk-qr] svg',
  /** `kiosk-code` is the contract's name (§15.6); `pair-code` is the element's name on b300af3. */
  code: '[data-testid=kiosk-code], [data-testid=pair-code]',
  /** "Skeniraj za 10 minuta grada." */
  lead: '.k-lead',
  /** The card hint ("ili upiši kod na …") and the typed address inside it. */
  hint: '.k-hint',
  address: '.k-hint-host',
  strip: '[data-testid=safety-strip]',
  stripVerdict: '[data-testid=strip-verdict]',
  stripPharmacy: '[data-testid=strip-pharmacy]',
  pharmacySymbol: '[data-testid=strip-pharmacy] [data-symbol=pharmacy]',
  stripSources: '[data-testid=strip-sources]',
  settingsPanel: '[data-testid=kiosk-settings-panel]',
  togglePlace: '[data-testid=toggle-place]',
  toggleFrame: '[data-testid=toggle-frame]',
  toggleView: '[data-testid=toggle-view]',
  toggleTheme: '[data-testid=toggle-theme]',
  toggleRhythm: '[data-testid=toggle-rhythm]',
  /** Read-only touch: a stop ring opens its departures for 60 s (WP2, D3). */
  stopBoard: '[data-testid=stop-board]',
  /** What a finger can press. */
  controls: 'button, a[href], input, select, summary',
  /** Where a passer-by must find none (principle 8). */
  controlScopes: '[data-testid=kiosk-invitation], .k-head',
  /** Not counted: the QR itself, and the brand, whose only behaviour is the long press to the settings (principle 8's named path). */
  controlExempt: '[data-testid=kiosk-qr], [data-testid=kiosk-brand]',
  /** What a person reads as a headline: during an outage none says "unavailable" (principle 9). */
  headings: 'h1, h2',
  /** Operator chrome that must be gone from the wall (brief §15.6 retired names). */
  retiredChrome: '[data-testid=kiosk-settings], [data-testid=kiosk-theme], [data-action=pause-highlights], [data-testid=pair-copy], [data-testid=kiosk-stop-presentation]',
});

// --- the numbers the wall is held to (brief §10–§12, §16.3) --------------------------------
/** Header sentence ceiling (principle 4). */
export const SENTENCE_MAX_CHARS = 80;
/** Departure rows at most (principle 3); at least one in every sample ([O-65]: the whole-city screen has departures too). */
export const DEPARTURES_MIN = 1;
export const DEPARTURES_MAX = 3;
/**
 * The fitted count (upgrade U4): of the departures the list offered, the fit keeps at least this many. September's
 * measurements at 1920×1080 and 1366×768 (smoke run 3, review-iter4-kiosk.md): three by day, two at night beside the
 * reserved first and last rows; U1's reserved notice row costs the third at 1366×768.
 */
export const DEPARTURES_FIT_FULL = 3;
export const DEPARTURES_FIT_RESERVED = 2;
/** The row kinds the fit never drops; any of them on the wall lowers the floor to DEPARTURES_FIT_RESERVED. */
export const FIT_RESERVED_KINDS: readonly string[] = ['first', 'last', 'notice'];
/**
 * Beside a reserved row the fit keeps fewer than DEPARTURES_FIT_RESERVED only where the list is full: the painted rows
 * leave less than DEPARTURE_ROW_MIN_PX of its box, and every row beside the departures is one the fit keeps before a
 * second departure (app/src/kiosk/timeline.ts dropCandidate): a reserved kind, a closure, the one timeless row.
 * Measured on the integrated tree (lastTrams2240 at 22:49 Zagreb, 1920×1080, a 459 px list): the 22:50 tram
 * "1 Zapadni kolodvor" takes two title lines (109 px) beside the last and first trams and the pharmacy (89 px each)
 * and the Gundulićeva closure (64 px), 439 px, and a second departure needs 64; September's "two at night" was measured
 * with one-line departure titles.
 */
export const FIT_FULL_KEEPS_KINDS: readonly string[] = [...FIT_RESERVED_KINDS, 'closure'];
/** A departure row's least height on the wall (app/src/city/nearby.ts ROW_MIN_PX, pinned by test/e2e/wall.test.ts); the
 *  departures line's least height is one row too (R1). It serves the path without the line (a handheld, older readings). */
export const DEPARTURE_ROW_MIN_PX = 64;
/**
 * The trains the response policy puts before the departures (U2.md §0.1 railPolicy: at most three in silent, two in
 * reduced, `data-kind="rail"` above the first departure row). They fill the departures' place: the fit keeps them before
 * a second or third departure (app/src/kiosk/timeline.ts breadthRow, dropCandidate), so like a reserved row each lowers
 * the floor, by one, never under DEPARTURES_MIN, and a full list may hold them beside its departures.
 */
export const FIT_RAIL_FIRST_KIND = 'rail';
/**
 * A tram or bus family sentence says a departure ("polazi", on the English wall "leaves"): none may stand while ZET's fleet
 * is judged silent (upgrade U2).
 */
export const DEPARTURE_SENTENCE_RE = /\b(?:polazi|leaves)\b/i;
/** Only the trainAt envelope is exempt: a quoted event title such as "Vlak" can still promise a last tram. */
export const RAIL_SENTENCE_RE = /^.+: (?:vlak, smjer .+, polazi u|train towards .+ leaves at) \d{2}:\d{2}\.$/i;
/** The QR SVG's minimum side in CSS px. */
export const QR_MIN_PX = 240;
/** Only the next solar event, never both (§12). */
export const SOLAR_ROWS_MAX = 1;
/** Hold on the brand that opens the settings: WP3's LONG_PRESS_MS is 800, the harness holds 900. */
export const SETTINGS_HOLD_MS = 900;
/** The ten-minute rotation: 300 readings, 2 s apart. */
export const ROTATION_STEPS = 300;
export const ROTATION_STEP_MS = 2000;
/** Real time left to rAF work after each fake-clock step: MapLibre and the motion loop do not run on the fake clock. */
export const ROTATION_SETTLE_MS = 30;
/** One bounded reread after a departure enters (timeline ENTER_CLEAR_MS, pinned in the unit tier). */
export const DEPARTURE_ENTRY_SETTLE_MS = 260;
/** Decision 29: a header sentence dwells at least this long unless its own fact expires (app SENTENCE_HOLD_MS). */
export const SENTENCE_DWELL_MIN_MS = 20_000;
/** §12: no wording is shown again verbatim within ten minutes. */
export const SENTENCE_NO_REPEAT_MS = 600_000;
/** The wrangler-dev floor with the deterministic template sentences (the production observer applies §12's no verbatim repeat within ten minutes instead). */
export const DISTINCT_SENTENCES_MIN = 3;
/** "U blizini · {km} km · ~{min} min", the radius measured per place [O-68]. */
export const NEARBY_HEAD_RE = /^U blizini · \d+(,\d)? km · ~\d+ min$/;
/** The head when the fixture place measures 2.0 km. */
export const NEARBY_HEAD_2KM = 'U blizini · 2 km · ~15 min';
/** The QR card's lead, byte-exact. */
export const LEAD_TEXT = 'Skeniraj za 10 minuta grada.';
/** A clock time: the footer prints none. */
export const CLOCK_RE = /\b\d{1,2}:\d{2}\b/;
/** A sentence cut short. */
export const ELLIPSIS_RE = /…|\.\.\.$/;
/** A "+N" fold in a vehicle pill (principle 6, public-service credibility). */
export const PLUS_PILL_RE = /\+\d/;
/** The pharmacy's hours on its row and in the footer (owner string, §11). */
export const PHARMACY_HOURS = '24/7';
/**
 * The old caption, a label before its colon ("Dežurna ljekarna:", "On-duty pharmacy:"), gone from the wall
 * (slop #29, [O-39]). WP1's full caption "Dežurna ljekarna 24/7: {address}" is not one: its colon follows the hours.
 */
export const PHARMACY_LABEL_RE = /(Dežurna ljekarna|On-duty pharmacy)\s*:/i;

// --- one reading -------------------------------------------------------------------------------
export interface WallRow {
  id: string | null;
  kind: string | null;
  /** `data-when` (ISO), null for an always row. */
  when: string | null;
  always: boolean;
  live: boolean;
  source: string | null;
  title: string;
  whenText: string;
  sub: string;
  /** The row carries a `<time>` element. */
  hasTime: boolean;
  text: string;
  /** Any part of the row reads as a caveat (inventory DISCL). */
  caveat: boolean;
  /**
   * The departures line's cells on the wall (R1), in order, each one a passer-by can see; present on the line's row
   * only: the cell's row id, its route (`data-route`), live, the words of its time, whether that is a `<time>`, and
   * its destination ('' where it prints none).
   */
  cells?: { id: string | null; route: string | null; live: boolean; whenText: string; hasTime: boolean; headsign: string }[];
}
export interface WallSample {
  /** The page's own clock (the fake clock under test), epoch ms. */
  at: number;
  place: string;
  sentence: string;
  kicker: string | null;
  kickerText: string;
  validUntil: string | null;
  /**
   * `data-fact` on the sentence: the fact the sentence says, in its template family (decision 29). Rewordings of
   * one fact ("za 2 min" to "za 1 min") keep it; a new fact changes it. Absent on a wall before the attribute.
   */
  fact?: string | null;
  sentenceChars: number;
  sentenceOverflow: boolean;
  sentenceEllipsis: boolean;
  head: string;
  /** The rows a passer-by can see: shown, not transparent, wholly inside the viewport and inside the list's clipping box. */
  rows: WallRow[];
  /** `.nearby-row` elements in the DOM that are not on the wall (hidden, transparent, zero-size, offscreen or clipped). */
  hiddenRows: number;
  /** The departures a passer-by can see: the cells of the departures line (R1), plus any row of kind `departure` (a
   *  handheld, or a reading recorded before DR1). */
  departures: number;
  /** The departures line's `data-cells`: the cells it drew; null without a line (absent in a reading recorded before DR1). */
  departuresOffered?: number | null;
  /** A departure cell is in its short entrance fade; never makes an invisible cell count as visible. */
  departuresEntering?: boolean;
  /**
   * R2: the reveal drawn, `page:<beat>` as the list's `data-reveal` and `advance:<beat>` as the departures line's
   * (docs/reveal-2026-10-plan/R2.md §0.2); null without one, absent in a reading recorded before R2.
   */
  reveal?: { list: string | null; line: string | null };
  /** R2: the wall's Ritam in seconds (the kiosk root's data-rhythm); null without the probe, absent before R2. */
  rhythm?: number | null;
  /**
   * `data-fit-dropped` on the list: the kinds of the vetted rows the list did not paint, in list order; `[]` when it
   * dropped none, null when the probe is missing (a wall before it, or a reading recorded earlier).
   */
  fitDropped: string[] | null;
  /** `data-fit-overflow` on the list: the fit found no room even after dropping (`1`); null when the probe is missing. */
  fitOverflow: boolean | null;
  /**
   * The height the painted rows leave free in the list's box (`[data-testid=nearby-rows]`, px): its content height less
   * the stretch from its content top to the lowest row on the wall; null without the list or a row on the wall, absent
   * in a reading recorded before it (fitPlan's full-list exception then never applies).
   */
  listRoom?: number | null;
  solarRows: number;
  liveRows: number;
  pills: string | null;
  bodies: number | null;
  zoom: string | null;
  feed: string | null;
  mapStatus: string | null;
  /** `data-unlabelled`; null when the probe is missing. */
  unlabelled: number | null;
  markers: number | null;
  frame: string | null;
  mapNotes: number;
  theme: string | null;
  code: string;
  codeState: string | null;
  qr: { w: number; h: number } | null;
  lead: string;
  strip: string;
  /** Any HH:MM anywhere in the footer (§16.3: footer without HH:MM), not only in its sources. */
  stripHasClock: boolean;
  pharmacy: string;
  pharmacySymbols: number;
  controls: number;
  /** `tag "words"` of each counted control, so a red row names them. */
  controlNames: string[];
  retiredChrome: number;
  settingsOpen: boolean;
  stopBoardOpen: boolean;
  /** Visible h1 and h2 texts (the accept spec's HEADINGS_IN_PAGE filter): an outage never headlines "unavailable". */
  headings: string[];
}

export type WallProbes = typeof WALL_PROBES;
/** What the browser receives: every selector and pattern, as plain data. */
export interface WallSampleSpec {
  probes: WallProbes;
  discl: { source: string; flags: string };
  clock: { source: string; flags: string };
  ellipsis: { source: string; flags: string };
}
const shipped = (re: RegExp): { source: string; flags: string } => ({ source: re.source, flags: re.flags });
export const WALL_SAMPLE_SPEC: WallSampleSpec = { probes: WALL_PROBES, discl: shipped(DISCL), clock: shipped(CLOCK_RE), ellipsis: shipped(ELLIPSIS_RE) };

/**
 * `data-fit-dropped` as a list of kinds: the list's own encoding is space-separated kinds in list order (U0's fitter);
 * a comma is tolerated and anything from a colon on (an id after the kind) is ignored. Empty means none dropped, undefined
 * means the list carries no probe. WALL_SAMPLE_IN_PAGE holds a copy of this parser, since it may reference nothing else.
 */
export function fitDroppedOf(value: string | undefined): string[] | null {
  if (value === undefined) return null;
  return value.split(/[\s,]+/).map((part) => part.split(':')[0]).filter(Boolean);
}

/**
 * One reading of the wall, run inside the page through `page.evaluate(WALL_SAMPLE_IN_PAGE, WALL_SAMPLE_SPEC)`.
 * It references nothing but its argument and the DOM. A missing element reads as empty, never as an error,
 * so a wall that lacks a probe fails on the assertion that names it.
 */
export const WALL_SAMPLE_IN_PAGE = (spec: WallSampleSpec): WallSample => {
  const p = spec.probes;
  const discl = new RegExp(spec.discl.source, spec.discl.flags);
  const clockRe = new RegExp(spec.clock.source, spec.clock.flags);
  const ellipsis = new RegExp(spec.ellipsis.source, spec.ellipsis.flags);
  const q = (s: string, root: Element | Document = document): HTMLElement | null => root.querySelector<HTMLElement>(s);
  const words = (el: Element | null): string => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  /** The element's text with a space at every text-node boundary, so adjacent spans never run together ("17:30" + "24/7"). */
  const phrases = (el: Element | null): string => {
    if (!el) return '';
    const parts: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.textContent ?? '');
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  };
  const num = (v: string | undefined): number | null => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  // A copy of fitDroppedOf (this function may reference nothing outside its argument and the DOM).
  const fitDroppedIn = (v: string | undefined): string[] | null => (v === undefined ? null : v.split(/[\s,]+/).map((part) => part.split(':')[0]).filter(Boolean));
  const shown = (el: Element): boolean => {
    if ((el as HTMLElement).hidden || el.closest('[hidden]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  };

  const sentenceEl = q(p.sentence);
  const textEl = q(p.sentenceText) ?? sentenceEl;
  const sentence = words(textEl);
  const overflows = (el: HTMLElement | null): boolean => Boolean(el && el.scrollWidth > el.clientWidth + 1);

  // A row counts only when a passer-by can see all of it: shown with a box, not transparent, wholly inside the
  // viewport and inside every ancestor that clips its overflow (the list's own box: whole rows only, §11).
  // Rows in the DOM but not on the wall are counted apart, so a hidden departure can never satisfy "a departure
  // in every reading". Transparency and invisibility are read on the row itself and on every ancestor up to the
  // root (an empty computed opacity, as happy-dom reports it, is opaque).
  const within = (r: DOMRect, c: DOMRect): boolean => r.top >= c.top - 1 && r.bottom <= c.bottom + 1 && r.left >= c.left - 1 && r.right <= c.right + 1;
  const clips = (value: string): boolean => value !== '' && value !== 'visible';
  const transparent = (cs: CSSStyleDeclaration): boolean => cs.opacity !== '' && Number(cs.opacity) === 0;
  const onWall = (el: Element): boolean => {
    if (!shown(el)) return false;
    const r = el.getBoundingClientRect();
    if (!(r.top >= -1 && r.left >= -1 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1)) return false;
    for (let a: Element | null = el; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'none' || cs.visibility === 'hidden' || transparent(cs)) return false;
      const root = a === el || a === document.body || a === document.documentElement;
      if (!root && (clips(cs.overflowX) || clips(cs.overflowY) || clips(cs.overflow)) && !within(r, a.getBoundingClientRect())) return false;
    }
    return true;
  };
  const allRows = Array.from(document.querySelectorAll<HTMLElement>(p.row));
  const visibleRows = allRows.filter(onWall);
  const rows = visibleRows.map((li) => {
    const title = words(q(p.rowTitle, li));
    const whenText = words(q(p.rowWhen, li) ?? q(p.rowTime, li));
    const sub = words(q(p.rowSub, li));
    const text = words(li);
    return {
      id: li.dataset.id ?? null,
      kind: li.dataset.kind ?? null,
      when: li.dataset.when ?? null,
      always: li.dataset.always === '1',
      live: li.dataset.live === '1',
      source: li.dataset.source ?? null,
      title, whenText, sub,
      hasTime: Boolean(q(p.rowTime, li)),
      text,
      caveat: [title, whenText, sub, text].some((part) => part !== '' && discl.test(part)),
      ...(li.dataset.kind === 'departures' ? {
        cells: Array.from(li.querySelectorAll<HTMLElement>('[data-cell]')).filter(onWall).map((cell) => ({
          id: cell.dataset.id ?? null,
          route: cell.dataset.route ?? null,
          live: cell.dataset.live === '1',
          whenText: words(q(p.rowWhen, cell)),
          hasTime: Boolean(q(p.rowTime, cell)),
          headsign: words(q('.k-dep-headsign', cell)),
        })),
      } : {}),
    };
  });
  const lineEl = q(p.depLine);
  const offered = lineEl ? num(lineEl.dataset.cells) : null;

  const fit = q(p.nearby)?.dataset;
  const listEl = q(p.nearbyRows);
  const listRoom = ((): number | null => {
    if (!listEl || visibleRows.length === 0) return null;
    const cs = getComputedStyle(listEl);
    const padTop = parseFloat(cs.paddingTop) || 0;
    const top = listEl.getBoundingClientRect().top + listEl.clientTop + padTop;
    const inner = listEl.clientHeight - padTop - (parseFloat(cs.paddingBottom) || 0);
    const used = Math.max(...visibleRows.map((li) => li.getBoundingClientRect().bottom)) - top;
    return Math.round((inner - used) * 10) / 10;
  })();
  const mapc = q(p.map);
  const qrEl = q(p.qrSvg);
  const qb = qrEl ? qrEl.getBoundingClientRect() : null;
  const codeEl = q(p.code);
  const exempt = (el: Element): boolean => Boolean(el.closest(p.controlExempt));
  const controls = Array.from(document.querySelectorAll(p.controlScopes))
    .flatMap((scope) => Array.from(scope.querySelectorAll(p.controls)))
    .filter((el, i, all) => all.indexOf(el) === i && !exempt(el) && shown(el));
  const settings = q(p.settingsPanel);
  const board = q(p.stopBoard);

  return {
    at: Date.now(),
    place: words(q(p.place)),
    sentence,
    kicker: sentenceEl?.dataset.kicker ?? null,
    kickerText: words(q(p.sentenceKicker)),
    validUntil: sentenceEl?.dataset.validUntil ?? null,
    fact: sentenceEl?.dataset.fact ?? null,
    sentenceChars: [...sentence].length,
    sentenceOverflow: overflows(textEl) || (textEl !== sentenceEl && overflows(sentenceEl)),
    sentenceEllipsis: ellipsis.test(sentence),
    head: words(q(p.nearbyHead)),
    rows,
    hiddenRows: allRows.length - visibleRows.length,
    departures: rows.reduce((n, r) => n + (r.cells ? r.cells.length : r.kind === 'departure' ? 1 : 0), 0),
    departuresOffered: offered,
    departuresEntering: Boolean(lineEl?.querySelector('[data-cell][data-enter="1"]')),
    reveal: { list: listEl?.dataset.reveal ?? null, line: lineEl?.dataset.reveal ?? null },
    rhythm: Number(q(p.kioskRoot)?.dataset.rhythm) || null,
    fitDropped: fitDroppedIn(fit?.fitDropped),
    fitOverflow: fit?.fitOverflow === '1' ? true : fit?.fitOverflow === '0' ? false : null,
    listRoom,
    solarRows: rows.filter((r) => r.kind === 'solar').length,
    liveRows: rows.reduce((n, r) => n + (r.cells ? r.cells.filter((c) => c.live).length : r.live ? 1 : 0), 0),
    pills: mapc?.dataset.pills ?? null,
    bodies: num(mapc?.dataset.bodies),
    zoom: mapc?.dataset.zoom ?? null,
    feed: mapc?.dataset.feed ?? null,
    mapStatus: mapc?.dataset.mapStatus ?? null,
    unlabelled: num(mapc?.dataset.unlabelled),
    markers: num(mapc?.dataset.markers),
    frame: q(p.mapHost)?.dataset.frame ?? null,
    mapNotes: Array.from(document.querySelectorAll(p.mapNote)).filter(shown).length,
    theme: document.documentElement.dataset.themeResolved ?? null,
    code: words(codeEl),
    codeState: codeEl?.dataset.state ?? null,
    qr: qb ? { w: Math.round(qb.width), h: Math.round(qb.height) } : null,
    lead: words(q(p.lead)),
    strip: phrases(q(p.strip)),
    // Every element of the footer on its own text, so a clock split across elements (<b>17</b>:30) is read whole
    // and a clock beside another item ("17:30" then "24/7") is not run into it.
    stripHasClock: ((strip) => Boolean(strip) && [strip!, ...Array.from(strip!.querySelectorAll('*'))].some((el) => clockRe.test(phrases(el)) || clockRe.test(words(el))))(q(p.strip)),
    pharmacy: words(q(p.stripPharmacy)),
    pharmacySymbols: document.querySelectorAll(p.pharmacySymbol).length,
    controls: controls.length,
    controlNames: controls.map((el) => `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || words(el)).slice(0, 40)}"`),
    retiredChrome: document.querySelectorAll(p.retiredChrome).length,
    settingsOpen: Boolean(settings && shown(settings)),
    stopBoardOpen: Boolean(board && shown(board)),
    headings: Array.from(document.querySelectorAll<HTMLElement>(p.headings))
      .filter((el) => !el.hidden && !el.closest('[hidden]') && el.getBoundingClientRect().height > 1)
      .map((el) => words(el))
      .filter(Boolean),
  };
};

/** One reading of the wall (the Playwright face). */
export function wallSample(page: Pick<Page, 'evaluate'>): Promise<WallSample> {
  return page.evaluate(WALL_SAMPLE_IN_PAGE, WALL_SAMPLE_SPEC);
}

/** A reading that threw (the page navigated, the context closed): kept, counted, never silently dropped. */
export interface WallSampleError { at: number; error: string }
export type RotationRow = (WallSample | WallSampleError) & { n: number };
export const isSampleError = (row: WallSample | WallSampleError): row is WallSampleError => 'error' in row;

export interface RotationOptions {
  steps?: number;
  stepMs?: number;
  /** 'fake': advance the page's fake clock by stepMs, then give rAF work ROTATION_SETTLE_MS of real time (the accept specs). 'real': wait stepMs of real time (the production observer). */
  clock?: 'fake' | 'real';
  settleMs?: number;
  /** Called after every reading, e.g. to append rotation.jsonl as the observer goes. */
  onSample?: (row: RotationRow) => void | Promise<void>;
}

/** The ten-minute rotation: `steps` readings `stepMs` apart, allowing one bounded departure-entry settle. */
export async function sampleRotation(page: WallPage, options: RotationOptions = {}): Promise<RotationRow[]> {
  const steps = options.steps ?? ROTATION_STEPS;
  const stepMs = options.stepMs ?? ROTATION_STEP_MS;
  const settle = options.settleMs ?? ROTATION_SETTLE_MS;
  const rows: RotationRow[] = [];
  for (let n = 0; n < steps; n++) {
    if ((options.clock ?? 'fake') === 'fake') {
      await page.clock.runFor(stepMs);
      await page.waitForTimeout(settle);
    } else {
      await page.waitForTimeout(stepMs);
    }
    let row: RotationRow;
    try {
      let reading = await wallSample(page);
      // DR1 n186 landed on the zero-opacity start of a 220 ms cell entrance.
      // Read after that transition once, without accepting hidden/clipped cells
      // or retrying a persistent deficit. Keep the reread's actual timestamp.
      if (reading.departuresEntering && reading.departuresOffered != null
        && reading.departures < reading.departuresOffered) {
        if ((options.clock ?? 'fake') === 'fake') {
          await page.clock.runFor(DEPARTURE_ENTRY_SETTLE_MS);
          await page.waitForTimeout(settle);
        } else {
          await page.waitForTimeout(DEPARTURE_ENTRY_SETTLE_MS);
        }
        reading = await wallSample(page);
      }
      row = { ...reading, n };
    } catch (error) {
      row = { at: Date.now(), error: String(error).slice(0, 200), n };
    }
    rows.push(row);
    await options.onSample?.(row);
  }
  return rows;
}

// --- the rotation in numbers ------------------------------------------------------------------
export interface RotationSummary {
  samples: number;
  errors: number;
  /** Every reading shows at least one departure (and there was a reading). */
  departuresEverySample: boolean;
  minDepartures: number;
  maxDepartures: number;
  /** Readings whose departure rows fall short of the fitted count, or that carry no data-fit-dropped probe (departureFailures). */
  departuresUnderFit: number;
  /** The rows the fit left out over the rotation, by kind (each reading counts its own), and the readings with data-fit-overflow=1. */
  fitDroppedByKind: Record<string, number>;
  fitOverflowReadings: number;
  /** Distinct rows (by id, else text) that ever read as a caveat. */
  caveatRows: number;
  distinctSentences: number;
  /** Sentence turns, per fact (sentenceTurns): a new `data-fact`; before the attribute, new words or a new `data-valid-until`. */
  sentenceTurns: number;
  /** Same-fact rewordings inside a turn (a countdown's next minute, a restated end): not turns. */
  sentenceRefreshes: number;
  /** Turns shorter than SENTENCE_DWELL_MIN_MS whose own fact had not expired (the first and the open last turn are not judged). */
  shortSentenceTurns: number;
  /** The longest gap between two consecutive readings, ms (2 s planned; more under load); null under two readings. */
  readingGapMaxMs: number | null;
  /** Shortest and longest judged dwell (point reading), ms; null when no turn was judged. */
  sentenceDwellMinMs: number | null;
  sentenceDwellMaxMs: number | null;
  /** Wordings shown again verbatim by a later turn within SENTENCE_NO_REPEAT_MS of their earlier showing (§12). */
  verbatimRepeats: number;
  /** The per-fact reading itself, for the artefact and the failure text. */
  turns: SentenceTurns;
  /** Turns whose text equals the turn before (detectable only through `data-valid-until`). */
  consecutiveRepeats: number;
  sentenceOverflows: number;
  sentenceEllipses: number;
  sentenceCharsMax: number;
  /** Readings whose sentence is longer than SENTENCE_MAX_CHARS. */
  longSentences: number;
  /** Readings with an empty sentence. */
  emptySentences: number;
  /** Closure rows whose id leaves the list and comes back. */
  closureReentries: number;
  /** The same, for every kind. */
  reentriesByKind: Record<string, number>;
  /** Readings whose vehicle pills carry a "+N" fold. */
  plusPills: number;
  /** Largest data-unlabelled seen; null when the probe never appeared. */
  unlabelledMax: number | null;
  controlsMax: number;
  solarRowsMin: number;
  solarRowsMax: number;
  liveRowsMax: number;
  /** Readings with a `last` row whose data-when is before the reading's own clock. */
  pastLastRows: number;
  /** Rows (reading × row) with neither data-when nor data-always. */
  rowsWithoutTime: number;
  /** Readings in which each kind appears. */
  kinds: Record<string, number>;
  themes: Record<string, number>;
  emptyPlaceSamples: number;
  /** R2: the reveal cadence over the rotation (revealCadenceFailures); [] before the probe existed. */
  revealFailures: string[];
  /** R2: the reveal episodes seen, by kind. */
  reveals: { page: number; advance: number };
}

// --- the reveals (R2, docs/reveal-2026-10-plan/R2.md step 9) ------------------------------------------------
/** One reveal as the readings saw it: consecutive readings carrying the same `data-reveal` value in one region. */
export interface RevealEpisode {
  region: 'list' | 'line';
  kind: 'page' | 'advance';
  /** The beat index the value names (`page:<beat>`, `advance:<beat>`). */
  beat: number;
  /** The page clock of the first and last reading that carried it. */
  firstAt: number;
  lastAt: number;
  /** The real gap to the reading before the first and after the last (0 at the rotation's ends). */
  gapBeforeMs: number;
  gapAfterMs: number;
  /** The rhythm the first reading reported, ms (20 s where the reading carries none). */
  rhythmMs: number;
  /** The episode touches the rotation's first or last reading: its length is not judged. */
  truncated: boolean;
}

const REVEAL_VALUE_RE = /^(page|advance):(\d+)$/;
const DEFAULT_RHYTHM_MS = 20_000;

/** The reveal a reading carries, the list's first: its region and value, or null. */
function revealOf(s: Pick<WallSample, 'reveal'>): { region: 'list' | 'line'; value: string } | null {
  if (s.reveal?.list) return { region: 'list', value: s.reveal.list };
  if (s.reveal?.line) return { region: 'line', value: s.reveal.line };
  return null;
}

/** The reveal episodes of a rotation: consecutive readings with the same non-null value in one region. */
export function revealEpisodes(samples: readonly Pick<WallSample, 'at' | 'reveal' | 'rhythm'>[]): RevealEpisode[] {
  const out: RevealEpisode[] = [];
  let open: { region: 'list' | 'line'; value: string; first: number; last: number; rhythmMs: number } | null = null;
  const close = (i: number): void => {
    if (!open) return;
    const m = REVEAL_VALUE_RE.exec(open.value);
    if (m && Number.isSafeInteger(Number(m[2]))) {
      out.push({
        region: open.region, kind: m[1] as 'page' | 'advance', beat: Number(m[2]),
        firstAt: samples[open.first]!.at, lastAt: samples[open.last]!.at,
        gapBeforeMs: open.first > 0 ? samples[open.first]!.at - samples[open.first - 1]!.at : 0,
        gapAfterMs: i < samples.length ? samples[i]!.at - samples[open.last]!.at : 0,
        rhythmMs: open.rhythmMs, truncated: open.first === 0 || open.last === samples.length - 1,
      });
    }
    open = null;
  };
  samples.forEach((s, i) => {
    const r = revealOf(s);
    if (open && (!r || r.region !== open.region || r.value !== open.value)) close(i);
    if (r && !open) open = { region: r.region, value: r.value, first: i, last: i, rhythmMs: (s.rhythm ?? 0) > 0 ? s.rhythm! * 1000 : DEFAULT_RHYTHM_MS };
    if (r && open) open.last = i;
  });
  close(samples.length);
  return out;
}

const atIso = (ms: number): string => new Date(ms).toISOString().slice(11, 19);

/**
 * The reveal cadence of a rotation against brief §3 and D2 (the observer's `reveal-cadence` row and the accept
 * scenes): one region per reading; a page value only on the list and an advance only on the line; consecutive
 * episodes at least REVEAL_GAP_BEATS apart; a judged episode standing at least one beat (its upper bound, as the
 * sentence-dwell rule reads it) and ending by the second (its lower bound); a value whose beat is the reading's own
 * or the one before. `[]` means it holds, and `[]` where no reading carries the probe.
 */
export function revealCadenceFailures(samples: readonly Pick<WallSample, 'at' | 'reveal' | 'rhythm'>[]): string[] {
  const out: string[] = [];
  for (const s of samples) {
    if (!s.reveal) continue;
    for (const region of ['list', 'line'] as const) {
      const value = s.reveal[region];
      if (!value) continue;
      const match = REVEAL_VALUE_RE.exec(value);
      if (!match || !Number.isSafeInteger(Number(match[2]))) {
        out.push(`reading at ${atIso(s.at)}: malformed reveal value on ${region} (${value}; target page:<beat> or advance:<beat>)`);
      }
    }
    if (s.reveal.list && s.reveal.line) out.push(`reading at ${atIso(s.at)}: both regions carry a reveal (list ${s.reveal.list}, line ${s.reveal.line}; target one region per beat)`);
    if (s.reveal.list?.startsWith('advance:')) out.push(`reading at ${atIso(s.at)}: an advance value on the list (${s.reveal.list})`);
    if (s.reveal.line?.startsWith('page:')) out.push(`reading at ${atIso(s.at)}: a page value on the line (${s.reveal.line})`);
  }
  const episodes = revealEpisodes(samples);
  episodes.forEach((e, i) => {
    const name = `reveal ${e.kind}:${e.beat} at ${atIso(e.firstAt)}`;
    const previous = episodes[i - 1];
    if (previous && e.beat - previous.beat < REVEAL_GAP_BEATS) out.push(`${name} started ${e.beat - previous.beat} beat(s) after ${previous.kind}:${previous.beat} (target ≥ ${REVEAL_GAP_BEATS} beats)`);
    if (!e.truncated) {
      const upper = e.lastAt - e.firstAt + e.gapBeforeMs + e.gapAfterMs;
      const lower = e.lastAt - e.firstAt;
      if (upper < e.rhythmMs) out.push(`${name} stood at most ${(upper / 1000).toFixed(1)} s (target ≥ one beat, ${(e.rhythmMs / 1000).toFixed(0)} s)`);
      if (lower > 2 * e.rhythmMs) out.push(`${name} stood at least ${(lower / 1000).toFixed(1)} s (target: ends by the second beat, ${((2 * e.rhythmMs) / 1000).toFixed(0)} s)`);
    }
    const b = Math.floor(e.firstAt / e.rhythmMs);
    if (b - e.beat !== 0 && b - e.beat !== 1) out.push(`${name} carries beat ${e.beat} while its first reading falls in beat ${b} (target 0 or 1 apart: a stale value)`);
  });
  return out;
}

/** One sentence turn: one fact on the header from its first reading to the next fact's. */
export interface SentenceTurn {
  /** Epoch ms of the turn's first reading. */
  at: number;
  /** Epoch ms of the next turn's first reading; null for the open last turn. */
  end: number | null;
  /** The fact identity: `data-fact`, or the inferred key on a wall before the attribute. */
  fact: string;
  /** The wordings in order, the first one and each refresh. */
  texts: string[];
  /** When each wording first showed. */
  textsAt: number[];
  refreshes: number;
  /** Epoch ms of the turn's last reading. */
  lastAt: number;
  /** end − at, the point reading; null for the open last turn. */
  dwellMs: number | null;
  /** Gap from the reading before the turn's first one to that first one (the start lies inside it); null for none. */
  gapBeforeMs: number | null;
  /** Gap from the turn's last reading to the reading after it (the end lies inside it); null for none. */
  gapAfterMs: number | null;
  /** Lower bound on the dwell: last reading − first reading. */
  dwellMinMs: number;
  /** Upper bound: the lower bound plus both adjacent gaps (reading after the last − reading before the first); null for a truncated turn. */
  dwellMaxMs: number | null;
  /** The latest data-valid-until read in the turn, epoch ms; null when none parsed. */
  validUntil: number | null;
  /** Its own deadline fell no later than the reading after its last one: the fact may have expired, an early end is allowed. */
  expired: boolean;
  /** The first turn (the observation began mid-dwell) or the open last one: its dwell is not judged. */
  truncated: boolean;
  /** Judged, not expired, and even the upper bound (dwellMaxMs) is under SENTENCE_DWELL_MIN_MS. */
  short: boolean;
}
export interface SentenceTurns {
  turns: SentenceTurn[];
  refreshes: number;
  shortTurns: SentenceTurn[];
  /** A wording a later turn showed again within the window of its earlier showing (§12), `at` as HH:MM:SS UTC. */
  verbatimRepeats: { at: string; afterMs: number; sentence: string }[];
  /** 'attribute' when every reading carried data-fact, 'inferred' when none did, 'mixed' otherwise. */
  factSource: 'attribute' | 'inferred' | 'mixed' | 'none';
}
export interface SentenceTurnOptions {
  windowMs?: number;
  minDwellMs?: number;
}
const deadlineOf = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};
/** Before data-fact: the words with their numbers masked, so a countdown's next minute or a moved end is the same fact. */
const inferredFact = (text: string): string => text.replace(/\d+/g, '#');

/**
 * The header's sentence turns per fact (decision 29). A turn ends only when the sentence's fact changes: its
 * `data-fact`, or on a wall before the attribute its words with the numbers masked (and, as before, the same
 * words under a new `data-valid-until`). A rewording of the same fact is a refresh inside the turn, so a
 * countdown shown 15.6 s as "za 2 min" and 4.4 s as "za 1 min" is one turn of 20.0 s with one refresh.
 * Readings without a sentence are skipped.
 */
export function sentenceTurns(readings: readonly Pick<WallSample, 'at' | 'sentence' | 'validUntil' | 'fact'>[], options: SentenceTurnOptions = {}): SentenceTurns {
  const windowMs = options.windowMs ?? SENTENCE_NO_REPEAT_MS;
  const minDwellMs = options.minDwellMs ?? SENTENCE_DWELL_MIN_MS;
  const turns: SentenceTurn[] = [];
  let withFact = 0;
  let without = 0;
  let prevValid: string | null = null;
  // Every reading's clock, with or without a sentence: the gaps that bound each turn are the actual ones (3.1 s under load).
  const clock = readings.map((s) => s.at);
  const firstIndex: number[] = [];
  const lastIndex: number[] = [];
  readings.forEach((s, index) => {
    if (!s.sentence) return;
    const attr = s.fact ?? null;
    if (attr) withFact++; else without++;
    const fact = attr ?? inferredFact(s.sentence);
    const last = turns[turns.length - 1];
    const text = last?.texts[last.texts.length - 1];
    const same = last !== undefined && last.fact === fact
      // Before the attribute: the same words under a new deadline stay a turn (a consecutive repeat, e2e rule of D5.3).
      && (attr !== null || s.sentence !== text || (s.validUntil ?? null) === prevValid);
    if (same) {
      if (s.sentence !== text) { last.texts.push(s.sentence); last.textsAt.push(s.at); last.refreshes++; }
    } else {
      if (last) last.end = s.at;
      turns.push({ at: s.at, end: null, fact, texts: [s.sentence], textsAt: [s.at], refreshes: 0, lastAt: s.at, dwellMs: null,
        gapBeforeMs: null, gapAfterMs: null, dwellMinMs: 0, dwellMaxMs: null, validUntil: null, expired: false, truncated: false, short: false });
      firstIndex.push(index);
    }
    const turn = turns[turns.length - 1];
    turn.lastAt = s.at;
    lastIndex[turns.length - 1] = index;
    const until = deadlineOf(s.validUntil);
    if (until !== null) turn.validUntil = Math.max(turn.validUntil ?? -Infinity, until);
    prevValid = s.validUntil ?? null;
  });
  turns.forEach((t, i) => {
    const before = firstIndex[i] > 0 ? clock[firstIndex[i] - 1] : null;
    const after = lastIndex[i] < clock.length - 1 ? clock[lastIndex[i] + 1] : null;
    t.dwellMs = t.end === null ? null : t.end - t.at;
    t.gapBeforeMs = before === null ? null : t.at - before;
    t.gapAfterMs = after === null ? null : after - t.lastAt;
    t.dwellMinMs = t.lastAt - t.at;
    t.dwellMaxMs = before === null || after === null ? null : after - before;
    t.truncated = i === 0 || t.end === null || t.dwellMaxMs === null;
    // The end lies before the reading after the last one; a deadline up to there may be the fact's own expiry.
    t.expired = after !== null && t.validUntil !== null && t.validUntil <= after;
    t.short = !t.truncated && !t.expired && t.dwellMaxMs !== null && t.dwellMaxMs < minDwellMs;
  });
  const verbatimRepeats: SentenceTurns['verbatimRepeats'] = [];
  turns.forEach((t, i) => t.texts.forEach((text, j) => {
    const at = t.textsAt[j];
    let earlier: number | null = null;
    for (const u of turns.slice(0, i)) u.texts.forEach((x, k) => { if (x === text) earlier = Math.max(earlier ?? -Infinity, u.textsAt[k]); });
    if (earlier !== null && at - earlier < windowMs) verbatimRepeats.push({ at: new Date(at).toISOString().slice(11, 19), afterMs: at - earlier, sentence: text });
  }));
  return {
    turns,
    refreshes: turns.reduce((n, t) => n + t.refreshes, 0),
    shortTurns: turns.filter((t) => t.short),
    verbatimRepeats,
    factSource: withFact && without ? 'mixed' : withFact ? 'attribute' : without ? 'inferred' : 'none',
  };
}

export function summariseRotation(rows: readonly (WallSample | WallSampleError)[], options: SentenceTurnOptions = {}): RotationSummary {
  const valid = rows.filter((r): r is WallSample => !isSampleError(r));
  const caveats = new Set<string>();
  const kinds: Record<string, number> = {};
  const themes: Record<string, number> = {};
  const reentriesByKind: Record<string, number> = {};
  const fitDroppedByKind: Record<string, number> = {};
  // Row presence by id: the index of the last reading an id was seen in, and whether it has already come back once.
  const lastSeen = new Map<string, number>();
  const reentered = new Set<string>();
  valid.forEach((s, i) => {
    for (const r of s.rows) if (r.caveat) caveats.add(r.id || r.text);
    for (const kind of s.fitDropped ?? []) fitDroppedByKind[kind] = (fitDroppedByKind[kind] ?? 0) + 1;
    for (const k of new Set(s.rows.map((r) => r.kind ?? 'none'))) kinds[k] = (kinds[k] ?? 0) + 1;
    themes[String(s.theme)] = (themes[String(s.theme)] ?? 0) + 1;
    for (const r of s.rows) {
      if (!r.id) continue;
      const key = `${r.kind}|${r.id}`;
      const seen = lastSeen.get(key);
      if (seen !== undefined && seen < i - 1 && !reentered.has(key)) {
        reentered.add(key);
        const kind = r.kind ?? 'none';
        reentriesByKind[kind] = (reentriesByKind[kind] ?? 0) + 1;
      }
      lastSeen.set(key, i);
    }
  });
  const turns = sentenceTurns(valid, options);
  const judged = turns.turns.filter((t) => !t.truncated && t.dwellMs !== null).map((t) => t.dwellMs as number);
  // A turn repeating the one before: its first words are the last words of the turn before.
  const repeats = turns.turns.filter((t, i) => i > 0 && t.texts[0] === turns.turns[i - 1].texts[turns.turns[i - 1].texts.length - 1]).length;
  const unlabelled = valid.map((s) => s.unlabelled).filter((n): n is number => n !== null);
  const max = (xs: number[]): number => (xs.length ? Math.max(...xs) : 0);
  const min = (xs: number[]): number => (xs.length ? Math.min(...xs) : 0);
  const episodes = revealEpisodes(valid);
  return {
    samples: valid.length,
    errors: rows.length - valid.length,
    departuresEverySample: valid.length > 0 && valid.every((s) => s.departures >= DEPARTURES_MIN),
    minDepartures: min(valid.map((s) => s.departures)),
    maxDepartures: max(valid.map((s) => s.departures)),
    departuresUnderFit: valid.filter(underFit).length,
    fitDroppedByKind,
    fitOverflowReadings: valid.filter((s) => s.fitOverflow === true).length,
    caveatRows: caveats.size,
    distinctSentences: new Set(turns.turns.map((t) => t.fact)).size,
    sentenceTurns: turns.turns.length,
    sentenceRefreshes: turns.refreshes,
    shortSentenceTurns: turns.shortTurns.length,
    readingGapMaxMs: valid.length > 1 ? Math.max(...valid.slice(1).map((s, i) => s.at - valid[i].at)) : null,
    sentenceDwellMinMs: judged.length ? Math.min(...judged) : null,
    sentenceDwellMaxMs: judged.length ? Math.max(...judged) : null,
    verbatimRepeats: turns.verbatimRepeats.length,
    turns,
    consecutiveRepeats: repeats,
    sentenceOverflows: valid.filter((s) => s.sentenceOverflow).length,
    sentenceEllipses: valid.filter((s) => s.sentenceEllipsis).length,
    sentenceCharsMax: max(valid.map((s) => s.sentenceChars)),
    longSentences: valid.filter((s) => s.sentenceChars > SENTENCE_MAX_CHARS).length,
    emptySentences: valid.filter((s) => !s.sentence).length,
    closureReentries: reentriesByKind.closure ?? 0,
    reentriesByKind,
    plusPills: valid.filter((s) => PLUS_PILL_RE.test(s.pills ?? '')).length,
    unlabelledMax: unlabelled.length ? Math.max(...unlabelled) : null,
    controlsMax: max(valid.map((s) => s.controls)),
    solarRowsMin: min(valid.map((s) => s.solarRows)),
    solarRowsMax: max(valid.map((s) => s.solarRows)),
    liveRowsMax: max(valid.map((s) => s.liveRows)),
    pastLastRows: valid.filter((s) => s.rows.some((r) => r.kind === 'last' && r.when !== null && Date.parse(r.when) < s.at)).length,
    rowsWithoutTime: valid.reduce((n, s) => n + s.rows.filter((r) => r.when === null && !r.always).length, 0),
    kinds,
    themes,
    emptyPlaceSamples: valid.filter((s) => !s.place).length,
    revealFailures: revealCadenceFailures(valid),
    reveals: { page: episodes.filter((e) => e.kind === 'page').length, advance: episodes.filter((e) => e.kind === 'advance').length },
  };
}

// --- verdicts, shared by the accept spec and the observer -----------------------------------------
/** What the fitted count reads of a reading; the list's room and hidden rows are absent in readings recorded before them,
 *  the line's offer (departuresOffered) in readings recorded before DR1. */
export type FitReading = Pick<WallSample, 'departures' | 'rows' | 'fitDropped'> & Partial<Pick<WallSample, 'listRoom' | 'hiddenRows' | 'departuresOffered'>>;

/** The departures line's row of a reading (R1), if the wall drew one. */
const lineRow = (rows: readonly WallRow[]): WallRow | undefined => rows.find((r) => r.kind === 'departures');

/**
 * The departures of one reading as a passer-by reads them, in order: the cells of the departures line, and any row of
 * kind `departure` (a handheld, a reading recorded before DR1). Every "each departure a clock time" check reads it.
 */
export function departureReads(rows: readonly WallRow[]): { whenText: string; hasTime: boolean; live: boolean }[] {
  return rows.flatMap((r) => (r.cells ? r.cells.map((c) => ({ whenText: c.whenText, hasTime: c.hasTime, live: c.live }))
    : r.kind === 'departure' ? [{ whenText: r.whenText, hasTime: r.hasTime, live: r.live }] : []));
}

const timelessRow = (r: WallRow): boolean => r.always || r.when === null;

/** The train rows above the first departure row (FIT_RAIL_FIRST_KIND); none without a departure row, as in timeline.ts. */
export function railsFirst(rows: readonly WallRow[]): WallRow[] {
  const first = rows.findIndex((r) => r.kind === 'departure' || r.kind === 'departures');
  return first < 0 ? [] : rows.slice(0, first).filter((r) => r.kind === FIT_RAIL_FIRST_KIND);
}

/**
 * The list is full beside its departures (FIT_FULL_KEEPS_KINDS): every row on the wall is whole, the rows leave less
 * than DEPARTURE_ROW_MIN_PX of the box, and each row beside the departures is a reserved kind, a closure, a train placed
 * before the departures or the one timeless row, all of which the fit keeps before a second departure.
 */
function fullBesideKeptRows(s: FitReading, rails: readonly WallRow[]): boolean {
  if (typeof s.listRoom !== 'number' || !(s.listRoom < DEPARTURE_ROW_MIN_PX) || (s.hiddenRows ?? 0) > 0) return false;
  const beside = s.rows.filter((r) => r.kind !== 'departure');
  return beside.filter(timelessRow).length <= 1 && beside.every((r) => timelessRow(r) || rails.includes(r) || (r.kind !== null && FIT_FULL_KEEPS_KINDS.includes(r.kind)));
}

/**
 * The departures the fit must keep, of those the list offered: null without the `data-fit-dropped` probe. The offer is
 * the visible departures plus the departures the fit left out (never more than DEPARTURES_MAX); the floor is
 * DEPARTURES_FIT_FULL, or DEPARTURES_FIT_RESERVED while a row of a FIT_RESERVED_KINDS kind is on the wall, one fewer
 * for each train placed before the departures (railsFirst, never under DEPARTURES_MIN), and beside such a row or train
 * the departures a full list holds (fullBesideKeptRows, at least DEPARTURES_MIN) where that is fewer.
 */
export function fitPlan(s: FitReading): { offered: number; expected: number; full: boolean } | null {
  if (s.fitDropped == null) return null;
  const offered = Math.min(DEPARTURES_MAX, s.departures + s.fitDropped.filter((kind) => kind === 'departure').length);
  const reserved = s.rows.some((r) => r.kind !== null && FIT_RESERVED_KINDS.includes(r.kind));
  const rails = railsFirst(s.rows);
  const base = Math.min(offered, reserved ? DEPARTURES_FIT_RESERVED : DEPARTURES_FIT_FULL);
  const floor = Math.max(Math.min(base, DEPARTURES_MIN), base - rails.length);
  const full = (reserved || rails.length > 0) && s.departures >= DEPARTURES_MIN && s.departures < floor && fullBesideKeptRows(s, rails);
  return { offered, expected: full ? s.departures : floor, full };
}
export const fittedDepartures = (s: FitReading): number | null => fitPlan(s)?.expected ?? null;

/**
 * The departures of one reading: 1 to 3; with the departures line (R1) every cell it drew on the wall (the fit never
 * drops a cell, so the fitted-count plan is not consulted) and no departure row beside it; without it (a handheld, a
 * reading recorded before DR1) at least the fitted count of those the list offered. `[]` means it holds.
 */
export function departureFailures(s: FitReading): string[] {
  const out: string[] = [];
  const line = lineRow(s.rows);
  if (line) {
    if (s.departures < DEPARTURES_MIN || s.departures > DEPARTURES_MAX) out.push(`${s.departures} departures in the line (target ${DEPARTURES_MIN}–${DEPARTURES_MAX})`);
    if (s.departuresOffered != null && s.departures !== s.departuresOffered) out.push(`${s.departures} of the line's ${s.departuresOffered} cells on the wall (target: every cell the line drew)`);
    const rows = s.rows.filter((r) => r.kind === 'departure').length;
    if (rows > 0) out.push(`${rows} departure row(s) beside the departures line (target 0: the wall's departures are the line's cells)`);
    return out;
  }
  if (s.departures < DEPARTURES_MIN || s.departures > DEPARTURES_MAX) out.push(`${s.departures} departure rows (target ${DEPARTURES_MIN}–${DEPARTURES_MAX})`);
  const plan = fitPlan(s);
  if (!plan) out.push('the list carries no data-fit-dropped probe (the fitted departure count cannot be judged)');
  else if (s.departures < plan.expected) out.push(`${s.departures} departure rows where the list offered ${plan.offered} and the fit keeps ${plan.expected} (left out: ${(s.fitDropped ?? []).join(' ') || 'nothing'})`);
  return out;
}

/** A reading whose departures fall short: of the line's cells (R1), or of the fitted count, or without the probe. */
function underFit(s: FitReading): boolean {
  if (lineRow(s.rows)) return s.departuresOffered != null && s.departures < s.departuresOffered;
  const plan = fitPlan(s);
  return !plan || s.departures < plan.expected;
}

/** One reading against §11/§16.3 (block B of the wall spec); `[]` means it holds. */
export function sampleFailures(s: WallSample): string[] {
  const out: string[] = [];
  if (!s.place) out.push(`the place (${WALL_PROBES.place}) is empty: the wall names a stop or street, "Zagreb" for the whole city`);
  if (s.sentenceChars < 1 || s.sentenceChars > SENTENCE_MAX_CHARS) out.push(`the sentence has ${s.sentenceChars} characters (target 1–${SENTENCE_MAX_CHARS}): "${s.sentence}"`);
  if (s.sentenceOverflow) out.push(`the sentence overflows its box: "${s.sentence}"`);
  if (s.sentenceEllipsis) out.push(`the sentence is cut with an ellipsis: "${s.sentence}"`);
  out.push(...departureFailures(s));
  const untimed = s.rows.filter((r) => r.when === null && !r.always);
  if (untimed.length) out.push(`${untimed.length} row(s) with neither data-when nor data-always="1": ${untimed.map((r) => `"${r.text}"`).join(', ')}`);
  if (s.controls > 0) out.push(`${s.controls} control(s) a passer-by can press (target 0): ${s.controlNames.join(', ')}`);
  if (s.retiredChrome > 0) out.push(`${s.retiredChrome} retired operator control(s) still in the DOM (${WALL_PROBES.retiredChrome})`);
  if (s.unlabelled !== 0) out.push(s.unlabelled === null ? `the map has no data-unlabelled probe (${WALL_PROBES.map})` : `${s.unlabelled} map marker(s) without a label or count (target 0)`);
  if (!s.qr || s.qr.w < QR_MIN_PX || s.qr.h < QR_MIN_PX) out.push(`the QR SVG is ${s.qr ? `${s.qr.w} × ${s.qr.h}` : 'missing'} (target ≥ ${QR_MIN_PX} × ${QR_MIN_PX} px)`);
  if (s.stripHasClock) out.push(`the footer prints a clock time: "${s.strip}"`);
  if (s.solarRows > SOLAR_ROWS_MAX) out.push(`${s.solarRows} solar rows (only the next solar event, at most ${SOLAR_ROWS_MAX})`);
  return out;
}

// --- calm motion (principle 7), shared by the accept spec and the production observer ----------------
/** One idle minute of calm motion, stepped like the rotation. */
export const IDLE_MINUTE_MS = 60_000;
/** Structural mutations allowed in that minute: a departure leaving at the top and one row entering (principle 7). */
export const IDLE_MUTATIONS_MAX = 2;
/**
 * The same minute where the departure's leaving gives a row the fit had left out its room back (U0 step 7: a dropped row
 * returns once a later change leaves room): the departure leaving, the next departure entering and that one row, all
 * three between the same two readings (calmRestoreBeat). Measured on the integrated tree (lastTrams2240, 22:51:00 Zagreb):
 * the two-line 22:50 "1 Zapadni kolodvor" left, and the 22:54 "1 Borongaj" and the 22:57 "13 Kvaternikov trg" the fit
 * had dropped beside it entered, two departures again beside the reserved rows and the closure.
 */
export const IDLE_MUTATIONS_RESTORE_MAX = 3;
/** R2 (brief §3): the structural records a reading pair across a reveal's start or return may hold: a page turn of two
 *  rows is four, the line's label and a changed cell count the rest; never a rebuilt row. */
export const REVEAL_MUTATIONS_MAX = 6;
/** R2: a mirror of shared/kiosk/takt.ts REVEAL_GAP_BEATS (test/scripts/observe-production.test.ts pins them equal). */
export const REVEAL_GAP_BEATS = 3;

export interface CalmMotionSpec {
  /** The subtree watched for structural mutations. */
  root: string;
  /** The rows that must keep their node. */
  row: string;
  /** The list and the departures line, whose `data-reveal` marks a reveal pair (R2). */
  list: string;
  line: string;
  /** The window and element property the watcher uses. */
  key: string;
  /** How many records the detail keeps (CALM_DETAIL_RECORDS_MAX). */
  detailMax: number;
}

export interface CalmMotionReading {
  /** The watched subtree existed when the minute started. */
  rootFound: boolean;
  before: number;
  after: number;
  /** childList records that add or remove an element. */
  mutations: number;
  /**
   * Rows that entered or left between two consecutive readings (a keyed row on one of the pair only: a departure,
   * the sunset row at its hour, the "uvijek" row alternating every twenty minutes, a closure ending), each excusing
   * at most one record that adds it and one that removes it within that pair: the sum over the pairs of
   * max(entering, leaving) so excused. The pairs are the window's first and last readings and every
   * CALM_MOTION_MARK_IN_PAGE between them (the observer marks at each rotation reading, D5.20: three trips
   * through one slot inside a minute are three turnovers, not churn).
   */
  turnovers: number;
  /** Readings that bounded the pairs, the first and last included (absent in a reading recorded before the marks). */
  marks?: number;
  /**
   * `mutations` less the records the turnovers account for: a staying row re-created, a node moved, a row that came
   * and went inside the minute, any other element added or removed. The production observer's budget.
   */
  churn: number;
  /** R2: the records and the churn per reading pair, so a reveal pair (detail.marks[].reveal differing across it) is judged apart. Absent before the probe. */
  recordsBySeg?: number[];
  churnBySeg?: number[];
  /** childList records that only swap text nodes (a countdown's digits): content, not structure. */
  textSwaps: number;
  /** Rows whose `kind|id` was on the list before and after, on the same node. */
  kept: number;
  /** Rows whose `kind|id` was on the list before and after, on a new node. */
  rebuilt: string[];
  left: string[];
  entered: string[];
  /** Rows without a data-id: their node cannot be followed. */
  untracked: number;
  /**
   * The evidence behind the counts, so a failing minute can be read afterwards (lane v-observe6): the row keys at
   * every reading that bounded a pair, and every structural record with its nodes' keys and what each node did.
   * Informational only: no rule reads it. Absent in a reading recorded before it existed.
   */
  detail?: CalmMotionDetail;
}

/**
 * What one node of a record did. `add`: a node not seen before, whose key was not on the list at the previous
 * reading (a row entering, or any other element); `remove`: a node taken out for good, no row with its key left on
 * the list; `move`: a node already seen, put back (an add) or taken out and put back in the same batch (a remove);
 * `re-create`: a new node for a key that was on the list at the previous reading (an add), or a node taken out while
 * another node with its key stands (a remove).
 */
export type CalmMutationKind = 'add' | 'remove' | 'move' | 're-create';
export interface CalmMutationNode { key: string | null; tag: string; kind: CalmMutationKind }
export interface CalmMutationRecord {
  /** Page clock (Date.now()) when the observer callback saw the record. */
  at: number;
  /** The reading pair it fell in: 0 between the window's start and its first mark, and so on. */
  seg: number;
  adds: CalmMutationNode[];
  removes: CalmMutationNode[];
}
export interface CalmMotionDetail {
  /**
   * The row keys at each reading that bounded a pair (the start, every mark, the read), with the page clock and the
   * timeline's `data-fit-dropped` then (null without the probe; absent in a reading recorded before it).
   */
  marks: { at: number; keys: string[]; fitDropped?: string | null; reveal?: string }[];
  /** The structural records in order; at most CALM_DETAIL_RECORDS_MAX, `dropped` counts the rest. */
  records: CalmMutationRecord[];
  dropped: number;
}
/** A runaway minute (a list rebuilt every frame) keeps its first records only: enough to read, never a huge file. */
export const CALM_DETAIL_RECORDS_MAX = 400;
/** The rows and the departures line's cells (R1): a cell leaving and one entering are a turnover, not churn, and a
 *  staying cell re-created is caught. A cell has no data-kind, so its key is `|<id>`. */
export const CALM_MOTION_SPEC: CalmMotionSpec = Object.freeze({ root: WALL_PROBES.nearby, row: `${WALL_PROBES.row}, ${WALL_PROBES.depCell}`, list: WALL_PROBES.nearbyRows, line: WALL_PROBES.depLine, key: '__acceptCalmMotion', detailMax: CALM_DETAIL_RECORDS_MAX });

/** Tag every row and start counting mutations under the root. Returns the number of rows tagged. */
export const CALM_MOTION_START_IN_PAGE = (spec: CalmMotionSpec): number => {
  const w = window as unknown as Record<string, unknown>;
  const root = document.querySelector(spec.root);
  const rows = Array.from(document.querySelectorAll<HTMLElement>(spec.row));
  const keyOf = (el: HTMLElement): string | null => (el.dataset.id ? `${el.dataset.kind ?? ''}|${el.dataset.id}` : null);
  // A record's element nodes by their row key (null: not a keyed row), so a turnover can be told from churn.
  const nodeKey = (n: Node): string | null => ((n as HTMLElement).dataset ? keyOf(n as HTMLElement) : null);
  rows.forEach((el, i) => { (el as unknown as Record<string, unknown>)[spec.key] = i; });
  // Every element node this window has seen under the root, so an add can tell a node put back (a move) from a new one.
  const seen = new WeakSet<Node>(root ? [root, ...Array.from(root.querySelectorAll('*'))] : []);
  const tagOf = (n: Node): string => ((n as Element).tagName || '').toLowerCase();
  const standing = (key: string): boolean => Array.from(document.querySelectorAll<HTMLElement>(spec.row)).some((el) => keyOf(el) === key);
  /** The reveal drawn now (R2): the list's data-reveal and the line's, "" each where none. */
  const revealNow = (): string => `${document.querySelector<HTMLElement>(spec.list)?.dataset?.reveal ?? ''}|${document.querySelector<HTMLElement>(spec.line)?.dataset?.reveal ?? ''}`;
  const state = {
    rootFound: Boolean(root),
    before: rows.map((el, i) => ({ key: keyOf(el), tag: i })),
    mutations: 0,
    textSwaps: 0,
    records: [] as { adds: (string | null)[]; removes: (string | null)[]; seg: number }[],
    /** The row keys at each reading: the window's start, every mark, and the read. */
    marks: [rows.map(keyOf).filter((k): k is string => k !== null)] as string[][],
    markTimes: [Date.now()] as number[],
    /** The timeline's data-fit-dropped at each reading (calmRestoreBeat reads it). */
    markDrops: [(root as HTMLElement | null)?.dataset?.fitDropped ?? null] as (string | null)[],
    /** The reveal drawn at each reading (R2): a pair across which it changes is a reveal pair. */
    markReveals: [revealNow()] as string[],
    /** The same records with what each node did (CalmMotionDetail), capped. */
    log: [] as { at: number; seg: number; adds: { key: string | null; tag: string; kind: string }[]; removes: { key: string | null; tag: string; kind: string }[] }[],
    dropped: 0,
    observer: null as MutationObserver | null,
    mark(): void {
      if (state.observer) state.count(state.observer.takeRecords());
      state.marks.push(Array.from(document.querySelectorAll<HTMLElement>(spec.row)).map(keyOf).filter((k): k is string => k !== null));
      state.markTimes.push(Date.now());
      state.markDrops.push(document.querySelector<HTMLElement>(spec.root)?.dataset?.fitDropped ?? null);
      state.markReveals.push(revealNow());
    },
    count(records: MutationRecord[]): void {
      for (const m of records) {
        if (m.type !== 'childList') continue;
        const adds = Array.from(m.addedNodes).filter((n) => n.nodeType === 1);
        const removes = Array.from(m.removedNodes).filter((n) => n.nodeType === 1);
        if (adds.length || removes.length) {
          state.mutations++;
          const seg = state.marks.length - 1;
          state.records.push({ adds: adds.map(nodeKey), removes: removes.map(nodeKey), seg });
          const previous = state.marks[seg] ?? [];
          const added = adds.map((n) => {
            const key = nodeKey(n);
            const kind = seen.has(n) ? 'move' : key !== null && previous.includes(key) ? 're-create' : 'add';
            seen.add(n);
            if ((n as Element).querySelectorAll) for (const d of Array.from((n as Element).querySelectorAll('*'))) seen.add(d);
            return { key, tag: tagOf(n), kind };
          });
          const removed = removes.map((n) => {
            const key = nodeKey(n);
            const kind = n.isConnected ? 'move' : key !== null && standing(key) ? 're-create' : 'remove';
            return { key, tag: tagOf(n), kind };
          });
          if (state.log.length < spec.detailMax) state.log.push({ at: Date.now(), seg, adds: added, removes: removed });
          else state.dropped++;
        } else if (m.addedNodes.length || m.removedNodes.length) state.textSwaps++;
      }
    },
  };
  if (root) {
    state.observer = new MutationObserver((records) => state.count(records));
    state.observer.observe(root, { childList: true, subtree: true });
  }
  w[spec.key] = state;
  return rows.length;
};

/** A reading inside an open calm-motion window: the row keys now, so turnovers are credited per reading pair. */
export const CALM_MOTION_MARK_IN_PAGE = (spec: CalmMotionSpec): boolean => {
  const state = (window as unknown as Record<string, unknown>)[spec.key] as { mark?: () => void } | undefined;
  if (!state?.mark) return false;
  state.mark();
  return true;
};

/** Stop counting and compare the rows with the tagged ones. */
export const CALM_MOTION_READ_IN_PAGE = (spec: CalmMotionSpec): CalmMotionReading => {
  const w = window as unknown as Record<string, unknown>;
  const state = w[spec.key] as {
    rootFound: boolean; before: { key: string | null; tag: number }[]; mutations: number; textSwaps: number;
    records: { adds: (string | null)[]; removes: (string | null)[]; seg?: number }[]; marks?: string[][];
    markTimes?: number[]; markDrops?: (string | null)[]; markReveals?: string[]; log?: CalmMutationRecord[]; dropped?: number;
    observer: MutationObserver | null; count: (r: MutationRecord[]) => void; mark?: () => void;
  } | undefined;
  if (!state) return { rootFound: false, before: 0, after: 0, mutations: 0, turnovers: 0, marks: 0, churn: 0, textSwaps: 0, kept: 0, rebuilt: [], left: [], entered: [], untracked: 0 };
  if (state.mark) state.mark();
  else if (state.observer) state.count(state.observer.takeRecords());
  if (state.observer) state.observer.disconnect();
  const rows = Array.from(document.querySelectorAll<HTMLElement>(spec.row));
  const keyOf = (el: HTMLElement): string | null => (el.dataset.id ? `${el.dataset.kind ?? ''}|${el.dataset.id}` : null);
  const beforeByKey = new Map(state.before.filter((b) => b.key !== null).map((b) => [b.key as string, b.tag]));
  const afterKeys = new Set<string>();
  let kept = 0;
  let untracked = 0;
  const rebuilt: string[] = [];
  const entered: string[] = [];
  for (const el of rows) {
    const key = keyOf(el);
    if (key === null) { untracked++; continue; }
    afterKeys.add(key);
    if (!beforeByKey.has(key)) { entered.push(key); continue; }
    if ((el as unknown as Record<string, unknown>)[spec.key] === beforeByKey.get(key)) kept++;
    else rebuilt.push(key);
  }
  const left = [...beforeByKey.keys()].filter((k) => !afterKeys.has(k));
  // A record is a turnover's when every element it adds is a row that entered and every element it removes a row
  // that left between the two readings around it, each row excusing one add and one remove at most in that pair;
  // every other record is churn: a node moved, a staying row re-created, a row that came and went between two
  // readings (D5.8 observer: the story row alternating and the sunset row entering were three records of content,
  // not churn; the sunset row leaving and returning within a poll was churn and a re-created row). Per pair, not
  // per window (D5.20: 6_13004 → 6_13037 → 12_12084 → 14_12602 in one slot inside a minute, six records, was
  // "churn 4" when only the window's ends were compared).
  const marks = state.marks ?? [state.before.map((b) => b.key).filter((k): k is string => k !== null), rows.map(keyOf).filter((k): k is string => k !== null)];
  const free = (keys: (string | null)[], pool: Set<string>, taken: Set<string>): boolean =>
    keys.every((k) => k !== null && pool.has(k) && !taken.has(k)) && new Set(keys).size === keys.length;
  let excused = 0;
  let turnovers = 0;
  const recordsBySeg: number[] = [];
  const churnBySeg: number[] = [];
  for (let seg = 0; seg + 1 < marks.length; seg++) {
    const a = new Set(marks[seg]);
    const b = new Set(marks[seg + 1]);
    const entering = new Set([...b].filter((k) => !a.has(k)));
    const leaving = new Set([...a].filter((k) => !b.has(k)));
    const addsTaken = new Set<string>();
    const removesTaken = new Set<string>();
    let inSeg = 0;
    let excusedInSeg = 0;
    for (const r of state.records ?? []) {
      if ((r.seg ?? 0) !== seg) continue;
      inSeg++;
      if (!free(r.adds, entering, addsTaken) || !free(r.removes, leaving, removesTaken)) continue;
      for (const k of r.adds) addsTaken.add(k as string);
      for (const k of r.removes) removesTaken.add(k as string);
      excusedInSeg++;
    }
    excused += excusedInSeg;
    recordsBySeg.push(inSeg);
    churnBySeg.push(inSeg - excusedInSeg);
    turnovers += Math.max(addsTaken.size, removesTaken.size);
  }
  delete w[spec.key];
  const times = state.markTimes ?? [];
  const drops = state.markDrops;
  const reveals = state.markReveals;
  return {
    rootFound: state.rootFound, before: state.before.length, after: rows.length, mutations: state.mutations,
    turnovers, marks: marks.length, churn: state.mutations - excused,
    ...(reveals ? { recordsBySeg, churnBySeg } : {}),
    textSwaps: state.textSwaps, kept, rebuilt, left, entered, untracked,
    ...(state.log ? { detail: { marks: marks.map((keys, i) => ({ at: times[i] ?? 0, keys, ...(drops ? { fitDropped: drops[i] ?? null } : {}), ...(reveals ? { reveal: reveals[i] ?? '' } : {}) })), records: state.log, dropped: state.dropped ?? 0 } } : {}),
  };
};

/**
 * The reading pairs across which the drawn reveal changed (R2): a reveal's start or its return, each allowed
 * REVEAL_MUTATIONS_MAX records; [] in a reading recorded before the probe, which is judged as before.
 */
export function revealPairs(r: CalmMotionReading): number[] {
  const marks = r.detail?.marks ?? [];
  if (marks.length < 2 || marks.some((m) => m.reveal === undefined) || !r.recordsBySeg || !r.churnBySeg) return [];
  const out: number[] = [];
  for (let seg = 0; seg + 1 < marks.length; seg++) if (marks[seg]!.reveal !== marks[seg + 1]!.reveal) out.push(seg);
  return out;
}

/** The records of a reveal pair over its budget, as one message each; the budget's name is the beat's. */
function revealPairFailures(r: CalmMotionReading, pairs: readonly number[], counts: readonly number[], what: string): string[] {
  const marks = r.detail!.marks;
  return pairs.filter((seg) => counts[seg]! > REVEAL_MUTATIONS_MAX)
    .map((seg) => `${counts[seg]} ${what} under the timeline across the reveal at reading pair ${seg} (${marks[seg]!.reveal || 'none'} to ${marks[seg + 1]!.reveal || 'none'}; target ≤ ${REVEAL_MUTATIONS_MAX} on a beat that carries a reveal)`);
}

/** What makes a calm-motion reading unmeasurable, or a staying row that lost its node: shared by both rules below. */
function calmMotionBasics(r: CalmMotionReading): { unmeasurable: string | null; rebuilt: string | null } {
  if (!r.rootFound) return { unmeasurable: `the timeline (${CALM_MOTION_SPEC.root}) is missing, so calm motion cannot be measured`, rebuilt: null };
  if (r.before === 0) return { unmeasurable: `the timeline had no rows (${CALM_MOTION_SPEC.row}) to follow through the idle minute`, rebuilt: null };
  return { unmeasurable: null, rebuilt: r.rebuilt.length ? `${r.rebuilt.length} row(s) stayed on the list but were re-created: ${r.rebuilt.join(', ')} (target 0, a row keeps its node)` : null };
}

const kindOfKey = (key: string | null): string => (key ?? '').split('|')[0] ?? '';
/** A departure's key: a row of kind departure, or a cell of the departures line (R1: a cell carries no kind, `|<id>`). */
const departureKey = (key: string | null): boolean => kindOfKey(key) === 'departure' || (key !== null && key.startsWith('|'));
const kindCount = (fitDropped: string | null | undefined, kind: string): number => (fitDroppedOf(fitDropped ?? undefined) ?? []).filter((k) => k === kind).length;

/**
 * The idle minute is one departure's beat with a restored row (IDLE_MUTATIONS_RESTORE_MAX): exactly three records, no
 * churn, all between the same two readings, one removing the departure that left and two each adding one row that
 * entered, one of them a departure (the next); and one of the two a row the fit had left out, its kind in the list's
 * data-fit-dropped at the first reading and fewer of it there at the second. Anything else keeps IDLE_MUTATIONS_MAX.
 */
export function calmRestoreBeat(r: CalmMotionReading): boolean {
  const d = r.detail;
  if (!d || d.dropped > 0 || r.mutations !== IDLE_MUTATIONS_RESTORE_MAX || r.churn !== 0 || r.rebuilt.length > 0 || d.records.length !== r.mutations) return false;
  const seg = d.records[0]!.seg;
  if (d.records.some((x) => x.seg !== seg) || !d.marks[seg] || !d.marks[seg + 1]) return false;
  const [from, to] = [d.marks[seg]!, d.marks[seg + 1]!];
  const removes = d.records.filter((x) => x.removes.length > 0);
  const adds = d.records.filter((x) => x.adds.length > 0);
  if (removes.length !== 1 || adds.length !== 2 || removes.some((x) => x.adds.length > 0 || x.removes.length !== 1) || adds.some((x) => x.removes.length > 0 || x.adds.length !== 1)) return false;
  const left = removes[0]!.removes[0]!;
  if (left.kind !== 'remove' || !departureKey(left.key) || !from.keys.includes(left.key ?? '') || to.keys.includes(left.key ?? '')) return false;
  const entered = adds.map((x) => x.adds[0]!);
  if (entered.some((n) => n.kind !== 'add' || n.key === null || from.keys.includes(n.key) || !to.keys.includes(n.key)) || entered[0]!.key === entered[1]!.key) return false;
  if (!entered.some((n) => departureKey(n.key))) return false;
  return entered.some((n) => {
    const kind = kindOfKey(n.key);
    return kindCount(from.fitDropped, kind) > 0 && kindCount(to.fitDropped, kind) < kindCount(from.fitDropped, kind);
  });
}

/** The accept spec's idle minute (fake clock, no service change): every structural record counts. */
export function calmMotionFailures(r: CalmMotionReading): string[] {
  const b = calmMotionBasics(r);
  if (b.unmeasurable) return [b.unmeasurable];
  const out: string[] = [];
  const pairs = revealPairs(r);
  if (pairs.length) {
    // R2: a reveal's start or return may spend REVEAL_MUTATIONS_MAX records; the rest of the minute keeps its two.
    out.push(...revealPairFailures(r, pairs, r.recordsBySeg!, 'structural mutations'));
    const inPairs = new Set(pairs);
    const rest = r.mutations - pairs.reduce((n, seg) => n + r.recordsBySeg![seg]!, 0);
    const outside: CalmMotionReading = {
      ...r, mutations: rest,
      churn: r.churn - pairs.reduce((n, seg) => n + r.churnBySeg![seg]!, 0),
      detail: { ...r.detail!, records: r.detail!.records.filter((x) => !inPairs.has(x.seg)) },
    };
    if (rest > IDLE_MUTATIONS_MAX && !calmRestoreBeat(outside)) out.push(`${rest} structural mutations under the timeline in an idle minute outside its ${pairs.length} reveal pair(s) (target ≤ ${IDLE_MUTATIONS_MAX}: a departure leaving and one row entering; left ${r.left.length}, entered ${r.entered.length})`);
  } else if (r.mutations > IDLE_MUTATIONS_MAX && !calmRestoreBeat(r)) out.push(`${r.mutations} structural mutations under the timeline in an idle minute (target ≤ ${IDLE_MUTATIONS_MAX}: a departure leaving and one row entering; left ${r.left.length}, entered ${r.entered.length})`);
  if (b.rebuilt) out.push(b.rebuilt);
  return out;
}

/**
 * The production observer's real minute: rows entering and leaving are the content itself (three first trams within
 * 70 s at the start of service are six records, lane-w-fix9; the story row alternating and the sunset row entering
 * are three, lane-w-fix10), so they are counted apart as `turnovers` and the budget reads `churn`, the records
 * nothing entering or leaving accounts for. A staying row keeps its node, strictly.
 */
export function calmChurnFailures(r: CalmMotionReading): string[] {
  const b = calmMotionBasics(r);
  if (b.unmeasurable) return [b.unmeasurable];
  const out: string[] = [];
  const pairs = revealPairs(r);
  if (pairs.length) {
    out.push(...revealPairFailures(r, pairs, r.churnBySeg!, 'structural mutations beyond row turnovers'));
    const rest = r.churn - pairs.reduce((n, seg) => n + r.churnBySeg![seg]!, 0);
    if (rest > IDLE_MUTATIONS_MAX) out.push(`${rest} structural mutations under the timeline beyond ${r.turnovers} row turnover(s) in a minute outside its ${pairs.length} reveal pair(s) (target ≤ ${IDLE_MUTATIONS_MAX}; ${r.mutations} records in all, left ${r.left.length}, entered ${r.entered.length})`);
  } else if (r.churn > IDLE_MUTATIONS_MAX) out.push(`${r.churn} structural mutations under the timeline beyond ${r.turnovers} row turnover(s) in a minute (target ≤ ${IDLE_MUTATIONS_MAX}; ${r.mutations} records in all, left ${r.left.length}, entered ${r.entered.length})`);
  if (b.rebuilt) out.push(b.rebuilt);
  return out;
}

/** The labels of a data-pills census ("6|11|12"). */
export const pillLabels = (pills: string | null): string[] => (pills ?? '').split('|').map((label) => label.trim()).filter(Boolean);
/** Vehicle pills drawn, and no label folded into "+N" (principle 6); `[]` means the census holds. */
export function pillFailures(pills: string | null): string[] {
  const labels = pillLabels(pills);
  if (!labels.length) return [`no vehicle pill drawn (data-pills ${JSON.stringify(pills)})`];
  const folded = labels.filter((label) => PLUS_PILL_RE.test(label));
  return folded.length ? [`${folded.length} vehicle pill(s) folded into "+N": ${folded.map((label) => `"${label}"`).join(', ')} (target none: ${String(PLUS_PILL_RE)} on every label)`] : [];
}

/** What the footer's pharmacy is read as: its `[data-symbol=pharmacy]` crosses and its text. */
export interface PharmacyReading { symbols: number; text: string }
/**
 * The footer's pharmacy against the rule of test/accept/trust.test.ts and the wall spec alike: one cross, "24/7"
 * and one of `addresses`, and not the bare label. `[]` means it holds; each entry is a short issue.
 */
export function pharmacyFailures(p: PharmacyReading, addresses: readonly string[]): string[] {
  const text = p.text.replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  if (p.symbols !== 1) out.push(`${p.symbols} [data-symbol=pharmacy], not 1`);
  if (!text.includes(PHARMACY_HOURS)) out.push(`no "${PHARMACY_HOURS}"`);
  if (!addresses.some((address) => text.includes(address))) out.push('no address');
  if (PHARMACY_LABEL_RE.test(text)) out.push('the label "Dežurna ljekarna:"');
  return out;
}

export interface RotationTargets {
  /** The accept spec's local floor (wrangler dev, template sentences) or the observer's §12 rule (no verbatim repeat within ten minutes). */
  sentences: 'template-floor' | 'no-repeat';
  /** 1 where the next solar event falls inside the shown horizon, else 0. */
  solarMin?: number;
}

/** The rotation against §16.3 (block C of the wall spec); `[]` means it holds. */
export function rotationFailures(r: RotationSummary, targets: RotationTargets = { sentences: 'template-floor' }): string[] {
  const out: string[] = [];
  if (r.errors > 0) out.push(`${r.errors} of ${r.samples + r.errors} readings failed`);
  if (!r.departuresEverySample) out.push(`a reading without a departure row (min ${r.minDepartures} over ${r.samples} readings; target ≥ ${DEPARTURES_MIN} in every one)`);
  if (r.maxDepartures > DEPARTURES_MAX) out.push(`${r.maxDepartures} departure rows at most (target ≤ ${DEPARTURES_MAX})`);
  if (r.departuresUnderFit > 0) out.push(`${r.departuresUnderFit} reading(s) with fewer departure rows than the fit keeps of those the list offered, or without the data-fit-dropped probe (target 0: ${DEPARTURES_FIT_FULL}, or ${DEPARTURES_FIT_RESERVED} beside a first, last or notice row, one fewer for each train placed before the departures, never under ${DEPARTURES_MIN}; fewer only as many as a full list holds beside reserved rows, trains placed first, closures and one timeless row)`);
  if (r.caveatRows > 0) out.push(`${r.caveatRows} row(s) read as a caveat (target 0)`);
  if (r.closureReentries > 0) out.push(`${r.closureReentries} closure row(s) left the list and came back (target 0)`);
  if (r.plusPills > 0) out.push(`${r.plusPills} reading(s) with a "+N" vehicle pill (target 0)`);
  if (r.emptySentences > 0) out.push(`${r.emptySentences} reading(s) with an empty sentence (target 1–${SENTENCE_MAX_CHARS} characters in every reading)`);
  if (r.longSentences > 0) out.push(`${r.longSentences} reading(s) with a sentence over ${SENTENCE_MAX_CHARS} characters (longest ${r.sentenceCharsMax})`);
  if (r.rowsWithoutTime > 0) out.push(`${r.rowsWithoutTime} row reading(s) with neither data-when nor data-always="1" (target 0: every row has a time or "uvijek")`);
  if (r.sentenceOverflows > 0) out.push(`${r.sentenceOverflows} reading(s) with an overflowing sentence (target 0)`);
  if (r.sentenceEllipses > 0) out.push(`${r.sentenceEllipses} reading(s) with a sentence cut by an ellipsis (target 0)`);
  if (r.controlsMax > 0) out.push(`up to ${r.controlsMax} control(s) a passer-by can press (target 0)`);
  if (r.unlabelledMax !== 0) out.push(r.unlabelledMax === null ? 'the map never carried a data-unlabelled probe' : `up to ${r.unlabelledMax} unlabelled map marker(s) (target 0)`);
  if (r.solarRowsMax > SOLAR_ROWS_MAX) out.push(`up to ${r.solarRowsMax} solar rows in a reading (target ≤ ${SOLAR_ROWS_MAX})`);
  if (targets.solarMin && r.solarRowsMin < targets.solarMin) out.push(`a reading without the solar row (target ≥ ${targets.solarMin}: the next solar event is inside the shown horizon)`);
  if (r.pastLastRows > 0) out.push(`${r.pastLastRows} reading(s) with a last-departure row whose time has passed (target 0)`);
  if (r.shortSentenceTurns > 0) {
    const named = r.turns.shortTurns.slice(0, 3).map((t) => `${t.texts[t.texts.length - 1]} ${((t.dwellMs ?? 0) / 1000).toFixed(1)} s, at most ${((t.dwellMaxMs ?? 0) / 1000).toFixed(1)} s between readings`).join('; ');
    out.push(`${r.shortSentenceTurns} sentence turn(s) under ${SENTENCE_DWELL_MIN_MS / 1000} s whose own fact had not expired (target 0; ${named})`);
  }
  if (targets.sentences === 'template-floor') {
    if (r.distinctSentences < DISTINCT_SENTENCES_MIN) out.push(`${r.distinctSentences} distinct sentence(s) in ten minutes (template floor ≥ ${DISTINCT_SENTENCES_MIN})`);
    if (r.consecutiveRepeats > 0) out.push(`${r.consecutiveRepeats} sentence turn(s) repeating the one before (target 0)`);
  } else if (r.verbatimRepeats > 0) {
    out.push(`${r.verbatimRepeats} sentence wording(s) shown again verbatim within ten minutes (§12): ${[...new Set(r.turns.verbatimRepeats.map((x) => x.sentence))].slice(0, 3).join(', ')}`);
  }
  // R2: the reveal cadence over the same ten minutes (one region per beat, the gap, a beat's dwell).
  out.push(...r.revealFailures);
  return out;
}
