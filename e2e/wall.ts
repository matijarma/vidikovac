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
  /** `li.nearby-row[data-id][data-kind][data-when=<ISO> | data-always="1"][data-live="1"?][data-source]` (WP1). */
  row: '[data-testid=nearby] .nearby-row',
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
  /** Operator chrome that must be gone from the wall (brief §15.6 retired names). */
  retiredChrome: '[data-testid=kiosk-settings], [data-testid=kiosk-theme], [data-action=pause-highlights], [data-testid=pair-copy], [data-testid=kiosk-stop-presentation]',
});

// --- the numbers the wall is held to (brief §10–§12, §16.3) --------------------------------
/** Header sentence ceiling (principle 4). */
export const SENTENCE_MAX_CHARS = 80;
/** Departure rows at most (principle 3); at least one in every sample ([O-65]: the whole-city screen has departures too). */
export const DEPARTURES_MIN = 1;
export const DEPARTURES_MAX = 3;
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
}
export interface WallSample {
  /** The page's own clock (the fake clock under test), epoch ms. */
  at: number;
  place: string;
  sentence: string;
  kicker: string | null;
  kickerText: string;
  validUntil: string | null;
  sentenceChars: number;
  sentenceOverflow: boolean;
  sentenceEllipsis: boolean;
  head: string;
  /** The rows a passer-by can see: shown, not transparent, wholly inside the viewport and inside the list's clipping box. */
  rows: WallRow[];
  /** `.nearby-row` elements in the DOM that are not on the wall (hidden, transparent, zero-size, offscreen or clipped). */
  hiddenRows: number;
  departures: number;
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
    };
  });

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
    sentenceChars: [...sentence].length,
    sentenceOverflow: overflows(textEl) || (textEl !== sentenceEl && overflows(sentenceEl)),
    sentenceEllipsis: ellipsis.test(sentence),
    head: words(q(p.nearbyHead)),
    rows,
    hiddenRows: allRows.length - visibleRows.length,
    departures: rows.filter((r) => r.kind === 'departure').length,
    solarRows: rows.filter((r) => r.kind === 'solar').length,
    liveRows: rows.filter((r) => r.live).length,
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

/** The ten-minute rotation: `steps` readings `stepMs` apart. */
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
      row = { ...(await wallSample(page)), n };
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
  /** Distinct rows (by id, else text) that ever read as a caveat. */
  caveatRows: number;
  distinctSentences: number;
  /** Sentence turns: a new `data-valid-until` or a new text. */
  sentenceTurns: number;
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
}

export function summariseRotation(rows: readonly (WallSample | WallSampleError)[]): RotationSummary {
  const valid = rows.filter((r): r is WallSample => !isSampleError(r));
  const caveats = new Set<string>();
  const kinds: Record<string, number> = {};
  const themes: Record<string, number> = {};
  const reentriesByKind: Record<string, number> = {};
  // Row presence by id: the index of the last reading an id was seen in, and whether it has already come back once.
  const lastSeen = new Map<string, number>();
  const reentered = new Set<string>();
  const texts: string[] = [];
  let turns = 0;
  let repeats = 0;
  let prevKey: string | null = null;
  let prevText: string | null = null;
  valid.forEach((s, i) => {
    for (const r of s.rows) if (r.caveat) caveats.add(r.id || r.text);
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
    if (s.sentence) {
      const key = s.validUntil ?? s.sentence;
      if (key !== prevKey || s.sentence !== prevText) {
        turns++;
        if (prevText !== null && s.validUntil !== null && s.sentence === prevText) repeats++;
        texts.push(s.sentence);
        prevKey = key;
        prevText = s.sentence;
      }
    }
  });
  const unlabelled = valid.map((s) => s.unlabelled).filter((n): n is number => n !== null);
  const max = (xs: number[]): number => (xs.length ? Math.max(...xs) : 0);
  const min = (xs: number[]): number => (xs.length ? Math.min(...xs) : 0);
  return {
    samples: valid.length,
    errors: rows.length - valid.length,
    departuresEverySample: valid.length > 0 && valid.every((s) => s.departures >= DEPARTURES_MIN),
    minDepartures: min(valid.map((s) => s.departures)),
    maxDepartures: max(valid.map((s) => s.departures)),
    caveatRows: caveats.size,
    distinctSentences: new Set(texts).size,
    sentenceTurns: turns,
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
  };
}

// --- verdicts, shared by the accept spec and the observer -----------------------------------------
/** One reading against §11/§16.3 (block B of the wall spec); `[]` means it holds. */
export function sampleFailures(s: WallSample): string[] {
  const out: string[] = [];
  if (!s.place) out.push(`the place (${WALL_PROBES.place}) is empty: the wall names a stop or street, "Zagreb" for the whole city`);
  if (s.sentenceChars < 1 || s.sentenceChars > SENTENCE_MAX_CHARS) out.push(`the sentence has ${s.sentenceChars} characters (target 1–${SENTENCE_MAX_CHARS}): "${s.sentence}"`);
  if (s.sentenceOverflow) out.push(`the sentence overflows its box: "${s.sentence}"`);
  if (s.sentenceEllipsis) out.push(`the sentence is cut with an ellipsis: "${s.sentence}"`);
  if (s.departures < DEPARTURES_MIN || s.departures > DEPARTURES_MAX) out.push(`${s.departures} departure rows (target ${DEPARTURES_MIN}–${DEPARTURES_MAX})`);
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
  if (targets.sentences === 'template-floor') {
    if (r.distinctSentences < DISTINCT_SENTENCES_MIN) out.push(`${r.distinctSentences} distinct sentence(s) in ten minutes (template floor ≥ ${DISTINCT_SENTENCES_MIN})`);
    if (r.consecutiveRepeats > 0) out.push(`${r.consecutiveRepeats} sentence turn(s) repeating the one before (target 0)`);
  } else if (r.distinctSentences !== r.sentenceTurns) {
    out.push(`${r.sentenceTurns} sentence turns but ${r.distinctSentences} distinct sentences: a sentence was repeated verbatim within ten minutes (§12)`);
  }
  return out;
}
