// The first-viewport inventory: what a person sees before scrolling, cut into
// units and sorted into classes, so "answer before inventory" (brief §10,
// principle 1) is a number and not an impression. Ported from the observed
// walkthroughs of 21 September (review.local/companion/walkthroughs/1720-mon:
// lib.mjs collectInventory, analyse.mjs classify/unionHeight/isUnit); the
// recorded verdicts of that slot are pinned in test/e2e/inventory.test.ts, so
// a rule added here for the new surfaces cannot move the old ones.
//
// Classes: ANSWER (an actionable fact with a place or a time) · CONTEXT (a
// place or time label) · INSTRUCTION (tells the person to configure) · COUNT
// (a number without a place) · NAV/CHROME · INVITE (QR, code, share) ·
// EMPTY/DISCLAIMER (empty sentences, freshness and attribution lines).
// UNCLASSIFIED is a review flag, never a result.
//
// One source, the pattern of e2e/geometry.ts: the collector runs inside the
// page and may reference nothing but its argument and the DOM (COLLECT_IN_PAGE
// receives COLLECT_SPEC), the classifier is pure and runs in Node. The accept
// specs (e2e/accept/*.spec.ts) and the read-only production observer
// (scripts/observe-production.mjs, through a throwaway Vite loader) import
// these names; neither keeps a copy of a rule or a selector.
import type { Page } from '@playwright/test';

/** Page access the inventory needs: one evaluate. Playwright's Page satisfies it. */
export type InventoryPage = Pick<Page, 'evaluate'>;

export const CLASSES = ['ANSWER', 'CONTEXT', 'INSTRUCTION', 'COUNT', 'NAV/CHROME', 'INVITE', 'EMPTY/DISCLAIMER', 'UNCLASSIFIED'] as const;
export type InventoryClass = (typeof CLASSES)[number];

// --- the text rules, verbatim from analyse.mjs:23-27 ------------------------------
/** Tells the person to do something before they get an answer. */
export const INSTR = /^(Odaberi|Spremi|Skeniraj|Upiši|Pokreni|Pretraži|Otvori|Dodirni|Povuci|Uključi|Postavi|Prijavi|Odaberi i spremi|Za javni zaslon|ili upiši)/i;
/** Empty sentences, freshness, source and caveat lines. */
export const DISCL = /nije provjera|Podatak iz registra|Obuhvat zaštite|ništa najavljeno|^Nema |^Čekamo|Procjena iz|po voznom redu|Izvori i licence|^Dohvaćeno|Zastarjelo|nepotvrđeno|nije potvrđen|Vozni red od|Zapis od|Podatak od|Kod i dalje otvara|nema novih|^Učitavamo|Kod stiže|^Procjena$|^Po rasporedu$|^po redu vožnje$|Nedostupni izvori|Izvor:|^ZET( ·|$)|^DHMZ( ·|$)|^Grad Zagreb( ·|$)|^Kulturpunkt$|^Etnografski muzej$|^Ministarstvo kulture|^Kulturne ustanove|Referenca|Model |Sve u redu|Bez upozorenja|potvrđeno \d|OpenStreetMap|^Protomaps$/i;
/** A number standing for a quantity, without a place or a time. */
export const COUNTRE = /^\+?\d+$|^\d+ ?(vozil|mjest|događanj|bicikl|peron|stajališt|linij|zatvoren|zatvaranj|upozorenj|potres|u tijeku|prikazan|rezultat|rad[a ]|radov)/i;
/** A time word standing alone. */
export const TIMELABEL = /^(danas|sutra|večeras|popodne|poslijepodne|cijeli dan|jutro|noć|tjedan|zatim|u tijeku)$/i;
/** A clock time or a weekday date standing alone. */
export const TIMEONLY = /^\d{1,2}:\d{2}$|^(pon|uto|sri|čet|pet|sub|ned)[a-z]*,? \d{1,2}\. ?\d{0,2}\.?/i;

// --- the phone's probe contract (brief §15.6), the one place its selectors live ---------------
/** What e2e/accept/phone.spec.ts and the observer select on for Sada, Karta, Još, the header and the end of a session (WP4). */
export const PHONE_PROBES = Object.freeze({
  sadaPlace: '[data-testid=sada-place]',
  /** `[data-kicker]` like the wall's sentence. */
  sadaSentence: '[data-testid=sada-sentence]',
  sadaMapBand: '[data-testid=sada-map-band]',
  /** The three departures at the chosen stop (`li.sada-departure[data-live]`). */
  sadaDepartures: '[data-testid=day-departures] > li.sada-departure',
  /** Every departure row, the Sada block and the shared timeline alike. */
  departureRows: '[data-kind=departure]',
  nearby: '[data-testid=nearby]',
  nearbyHead: '[data-testid=nearby-head]',
  nearbyRow: '.nearby-row',
  tab: '.ki-tab',
  kartaTab: '.ki-tab[data-layer=u-pokretu]',
  tabMore: '[data-testid=tab-more]',
  /** "Događanja ovaj tjedan" in Još, with its count line. */
  dirKultura: '[data-testid=dir-kultura]',
  eventCount: '[data-testid=ev-count]',
  shareCity: '[data-testid=share-city]',
  shareCode: '[data-testid=share-code]',
  mapCanvas: '[data-testid=map-canvas]',
  transportSearch: '[data-testid=transport-search]',
  selectStop: '[data-action=select-stop]',
  stopBoard: '[data-testid=stop-board]',
  /** After the ten minutes: the invitation to scan again and /hitno ([O-59]). */
  sessionEnded: '[data-testid=session-ended]',
  sessionEndedScan: '[data-testid=session-ended] a[href^="/s/"]',
  sessionEndedHitno: '[data-testid=session-ended] a[href="/hitno"]',
  /** The frozen-export contract [O-59] retired: none of these after expiry. */
  exportControls: '[data-action^=export], [data-action=copy], [data-action=print], [data-action=ics]',
  /** Karta's retired disclosures and group taxonomy. */
  kartaDisclosures: '.city-filter-disclosure, .t-map-menu, [data-testid=city-groups]',
  desktopSada: '#layer-grad-sada',
  desktopKarta: '[data-testid=transport-workspace]',
  /** The desktop's retired six-domain bar. */
  domains: '.ki-domains',
});
/** Departure rows fully inside the phone's first viewport (principle 3). */
export const PHONE_DEPARTURES = 3;
/** The tab labels, in order ("Sada · Karta · Još"). */
export const TAB_LABELS: readonly string[] = Object.freeze(['Sada', 'Karta', 'Još']);
/** The header button's label, byte-exact. */
export const SHARE_CITY_LABEL = 'Podijeli grad';
/** The Još row that folds the agenda, byte-exact. */
export const WEEK_EVENTS_LABEL = 'Događanja ovaj tjedan';
/** Copy the phone's first viewport must not carry (brief §13 out rows). */
export const PHONE_SLOP_RE = /Sada u gradu|Odaberi i spremi|Gradska referentna|Radovi u gradu · \d/;
/** Karta cold open: at least one vehicle pill within this long after data-map-status=ready, with no tap. */
export const KARTA_PILLS_WITHIN_MS = 2000;
/** Taps from the tab to a stop's board through the search field (tab, field, result). */
export const SEARCH_TAPS_MAX = 3;
/** What the stop search types: the start of Trg bana J. Jelačića, a stop every build carries. */
export const STOP_SEARCH_QUERY = 'Jela';

// --- the phone's verdicts, shared by the accept spec and the production observer ------------------
/** Every departure row of the Sada block and the shared timeline: `li.sada-departure` and `[data-kind=departure]`. */
export const PHONE_DEPARTURE_ROWS = `${PHONE_PROBES.sadaDepartures}, ${PHONE_PROBES.departureRows}`;

export interface PhoneDepartures { total: number; inFold: number; texts: string[] }
/** The visible departure rows and how many lie fully inside the viewport, across and down (a row pushed sideways is outside it). */
export function phoneDepartures(rows: readonly { text: string; top: number; bottom: number; left: number; right: number }[], viewport: { width: number; height: number }): PhoneDepartures {
  const inside = (r: { top: number; bottom: number; left: number; right: number }): boolean => r.top >= -1 && r.bottom <= viewport.height + 1 && r.left >= -1 && r.right <= viewport.width + 1;
  return { total: rows.length, inFold: rows.filter(inside).length, texts: rows.map((r) => r.text) };
}
export function phoneDepartureFailures(d: PhoneDepartures, where = 'Sada'): string[] {
  const out: string[] = [];
  if (d.inFold !== PHONE_DEPARTURES) out.push(`${where}: ${d.inFold} departure row(s) fully inside the first viewport (target exactly ${PHONE_DEPARTURES}): ${d.texts.map((t) => `"${t}"`).join(', ') || 'none'}`);
  if (d.total > PHONE_DEPARTURES) out.push(`${where}: ${d.total} departure rows in all (target ≤ ${PHONE_DEPARTURES}, never a board)`);
  return out;
}

/** Every row the phone shows content in: the "U blizini" rows, Sada's departures and every departure row. None outlives the session ([O-59]). */
export const PHONE_CONTENT_ROWS = `${PHONE_PROBES.nearbyRow}, ${PHONE_PROBES.sadaDepartures}, ${PHONE_PROBES.departureRows}`;
export interface ExpirySpec { ended: string; scan: string; hitno: string; rows: string; exports: string }
export const EXPIRY_SPEC: ExpirySpec = Object.freeze({
  ended: PHONE_PROBES.sessionEnded, scan: PHONE_PROBES.sessionEndedScan, hitno: PHONE_PROBES.sessionEndedHitno, rows: PHONE_CONTENT_ROWS, exports: PHONE_PROBES.exportControls,
});
export interface ExpiryReading {
  /** The session-ended block is in the page and not hidden. */
  ended: boolean;
  scanLinks: number;
  hitnoLinks: number;
  /** Content rows still in the DOM, shown or not: the content clears. */
  rows: number;
  rowTexts: string[];
  exportControls: number;
}
/** The phone once its session has ended, read in the page; references nothing but its argument and the DOM. */
export const EXPIRY_READ_IN_PAGE = (spec: ExpirySpec): ExpiryReading => {
  const ended = document.querySelector<HTMLElement>(spec.ended);
  const rows = Array.from(document.querySelectorAll(spec.rows));
  return {
    ended: Boolean(ended) && !ended!.hidden && !ended!.closest('[hidden]'),
    scanLinks: document.querySelectorAll(spec.scan).length,
    hitnoLinks: document.querySelectorAll(spec.hitno).length,
    rows: rows.length,
    rowTexts: rows.slice(0, 3).map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)),
    exportControls: document.querySelectorAll(spec.exports).length,
  };
};
/** The end of the ten minutes against §16.4; `requestsAfter` are the /api/data paths requested after it. `[]` means it holds. */
export function expiryFailures(r: ExpiryReading, requestsAfter: readonly string[] = []): string[] {
  const out: string[] = [];
  if (!r.ended) out.push(`no ${PHONE_PROBES.sessionEnded} once the session ended ([O-59])`);
  if (r.scanLinks < 1) out.push(`the ended session has no link to scan again (${PHONE_PROBES.sessionEndedScan})`);
  if (r.hitnoLinks < 1) out.push(`the ended session has no /hitno link (${PHONE_PROBES.sessionEndedHitno})`);
  if (r.rows > 0) out.push(`${r.rows} content row(s) kept after the session ended (${PHONE_CONTENT_ROWS}; target 0): ${r.rowTexts.map((t) => `"${t}"`).join(', ')}`);
  if (r.exportControls > 0) out.push(`${r.exportControls} export, copy, print or calendar control(s) after the session ended (${PHONE_PROBES.exportControls}; target 0)`);
  if (requestsAfter.length) out.push(`${requestsAfter.length} /api/data request(s) after the session ended: ${requestsAfter.slice(0, 5).join(', ')} (target none)`);
  return out;
}

// --- the raw inventory ------------------------------------------------------------
export interface InventoryRect { x: number; y: number; w: number; h: number }
export interface InventoryClip { top: number; bottom: number; h: number }
export interface InventoryElement {
  i: number;
  tag: string;
  testid: string | null;
  nearestTestid: string | null;
  classes: string;
  role: string | null;
  ariaLabel: string | null;
  /** The element's own text nodes, not its children's. */
  text: string;
  fullText: string;
  value?: string;
  href?: string | null;
  action: string | null;
  graphic: boolean;
  control: boolean;
  rect: InventoryRect;
  /** The vertical span inside the viewport. */
  clip: InventoryClip;
  /** `tag[testid].class1.class2` from body down to the element, joined by `>`. */
  path: string;
  fontSize: number;
  dataset: Record<string, string>;
  /** Names of the INVENTORY_MARKS the element is inside of (or is). Absent in inventories recorded before the marks existed. */
  within?: string[];
}
export interface InventoryMap {
  status?: string; zoom?: string; pills?: string; bodies?: string; frames?: string; feed?: string; markers?: string; unlabelled?: string;
}
/** What the page returns. */
export interface PageInventory {
  vw: number;
  vh: number;
  scrollY: number;
  /** location.href with room, ticket and label values replaced by '…'. */
  url: string;
  title: string;
  theme: string | null;
  map: InventoryMap | null;
  elements: InventoryElement[];
}
/** Labelled for a report: which surface, which scenario. */
export interface InventoryExtra {
  /** 'kiosk' and 'kiosk-portrait' draw the map as an answer; 'phone' and 'desktop' read it from the map probe. */
  surface?: string;
  scenario?: string;
  highlightId?: string;
  [key: string]: unknown;
}
export interface RawInventory extends PageInventory, InventoryExtra {
  label: string;
  at?: string;
  zagreb?: string;
}

/** Subtrees an element can sit in, by name: the classifier and the wall's aside check read `within` instead of guessing from class names. */
export const INVENTORY_MARKS: Readonly<Record<string, string>> = Object.freeze({
  aside: 'aside',
  nearby: '[data-testid=nearby]',
  nearbyRow: '.nearby-row',
  card: '[data-testid=kiosk-invite], [data-testid=kiosk-qr], .k-panel--card',
  footer: '[data-testid=safety-strip]',
  head: '.k-head',
  sentence: '[data-testid=kiosk-sentence], [data-testid=sada-sentence]',
  stopBoard: '[data-testid=stop-board]',
  sessionEnded: '[data-testid=session-ended]',
});

export interface CollectSpec {
  /** Tags never taken as a unit (the labelled control or the QR is the unit, not its paths). */
  skipTags: string[];
  /** An svg is a unit only inside one of these (the QR); every other svg is a decorative icon. */
  graphicScope: string;
  /** dataset keys copied onto each unit. */
  datasetKeys: string[];
  marks: Record<string, string>;
}

export const COLLECT_SPEC: CollectSpec = {
  skipTags: ['script', 'style', 'link', 'meta', 'noscript', 'template', 'path', 'g', 'rect', 'circle', 'line', 'polyline', 'polygon', 'defs', 'use', 'title', 'desc', 'clippath', 'lineargradient', 'stop', 'text', 'tspan'],
  graphicScope: '.qr, [data-testid=kiosk-qr]',
  datasetKeys: ['highlight', 'state', 'status', 'pills', 'bodies', 'mapStatus', 'cityGroup', 'sheet', 'col', 'kind', 'panel', 'layer', 'group', 'id', 'when', 'always', 'live', 'source', 'kicker', 'symbol'],
  marks: { ...INVENTORY_MARKS },
};

/**
 * The collector, run inside the page through `page.evaluate(COLLECT_IN_PAGE, COLLECT_SPEC)`:
 * every element whose own text (or QR/canvas/img graphic, or control) has a box
 * intersecting the viewport. It references nothing but its argument and the DOM.
 */
export const COLLECT_IN_PAGE = (spec: CollectSpec): PageInventory => {
  const vw = innerWidth;
  const vh = innerHeight;
  const out: InventoryElement[] = [];
  const skipTags = new Set(spec.skipTags);
  const keys = new Set(spec.datasetKeys);
  const marks = Object.entries(spec.marks);
  const ownText = (el: Element): string => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
  const classOf = (el: Element): string => (typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : '');
  const pathOf = (el: Element): string => {
    const parts: string[] = [];
    let e: Element | null = el;
    while (e && e !== document.body) {
      const id = (e as HTMLElement).dataset?.testid;
      const cls = classOf(e).split(/\s+/).filter(Boolean).slice(0, 2).join('.');
      parts.unshift(`${e.tagName.toLowerCase()}${id ? `[${id}]` : ''}${cls ? `.${cls}` : ''}`);
      e = e.parentElement;
    }
    return parts.join('>');
  };
  const nearestTestid = (el: Element): string | null => {
    let e: Element | null = el;
    while (e) {
      const id = (e as HTMLElement).dataset?.testid;
      if (id) return id;
      e = e.parentElement;
    }
    return null;
  };
  let i = 0;
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    if (skipTags.has(tag)) continue;
    if (tag === 'svg' && !el.closest(spec.graphicScope)) continue;
    if (tag === 'svg' && el.parentElement?.closest('svg')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || (cs.opacity !== '' && Number(cs.opacity) === 0)) continue;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw)) continue;
    const text = ownText(el);
    const graphic = tag === 'svg' || tag === 'canvas' || tag === 'img';
    const control = ['button', 'input', 'select', 'textarea', 'summary'].includes(tag) || (tag === 'a' && el.hasAttribute('href'));
    if (!text && !graphic && !control) continue;
    if (control && !text && !graphic && (el.textContent || '').trim() && !el.querySelector('svg')) continue;
    if (text && text.length <= 1 && !/[\p{L}\p{N}]/u.test(text) && !control) continue;
    const clipTop = Math.max(0, r.top);
    const clipBottom = Math.min(vh, r.bottom);
    const data = (el as HTMLElement).dataset ?? {};
    const dataset: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) if (keys.has(k) && typeof v === 'string') dataset[k] = v;
    const within = marks.filter(([, selector]) => el.closest(selector)).map(([name]) => name);
    out.push({
      i: i++,
      tag,
      testid: (el as HTMLElement).dataset?.testid || null,
      nearestTestid: nearestTestid(el),
      classes: classOf(el).trim().slice(0, 140),
      role: el.getAttribute('role'),
      ariaLabel: el.getAttribute('aria-label'),
      text: text.slice(0, 400),
      fullText: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240),
      value: tag === 'input' ? ((el as HTMLInputElement).value || (el as HTMLInputElement).placeholder || '') : undefined,
      href: tag === 'a' ? el.getAttribute('href') : undefined,
      action: (el as HTMLElement).dataset?.action || null,
      graphic,
      control,
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      clip: { top: Math.round(clipTop), bottom: Math.round(clipBottom), h: Math.round(clipBottom - clipTop) },
      path: pathOf(el),
      fontSize: parseFloat(cs.fontSize),
      dataset,
      within,
    });
  }
  const mapc = document.querySelector<HTMLElement>('[data-map-status]');
  const root = document.documentElement.dataset;
  return {
    vw,
    vh,
    scrollY,
    url: location.href.replace(/(room|ticket|label)=[^&]*/g, '$1=…'),
    title: document.title,
    theme: root.themeResolved || root.theme || null,
    map: mapc ? {
      status: mapc.dataset.mapStatus, zoom: mapc.dataset.zoom, pills: mapc.dataset.pills, bodies: mapc.dataset.bodies,
      frames: mapc.dataset.frames, feed: mapc.dataset.feed, markers: mapc.dataset.markers, unlabelled: mapc.dataset.unlabelled,
    } : null,
    elements: out,
  };
};

// --- the classifier (analyse.mjs:29-114, plus the companion surfaces) -------------
const has = (e: InventoryElement, re: RegExp): boolean => re.test(`${e.path} ${e.classes} ${e.testid || ''} ${e.nearestTestid || ''} ${e.action || ''}`);
const txt = (e: InventoryElement): string => (e.text || e.value || e.ariaLabel || '').trim();
/** Inside a named subtree: the recorded `within` when the collector wrote it, the path otherwise. */
const inside = (e: InventoryElement, mark: string, re: RegExp): boolean => (e.within ? e.within.includes(mark) : has(e, re));

/** The class of one unit. `inv` supplies the surface, the map probe and the current highlight. */
export function classify(e: InventoryElement, inv: Pick<RawInventory, 'elements' | 'surface' | 'map' | 'highlightId'>): InventoryClass {
  const t = txt(e);
  const hid = inv.highlightId || inv.elements.find((x) => x.dataset?.highlight)?.dataset.highlight || '';

  // Companion surfaces (brief §15.6). Ahead of the INVITE rule: "Podijeli grad" is header chrome, the code it opens is the invitation.
  if (has(e, /share-code/)) return 'INVITE';
  if (has(e, /share-city/)) return 'NAV/CHROME';

  if (has(e, /k-invite|k-qr|k-code|k-hint|k-progress|kiosk-qr|pair-code|code-a|code-b|pair-copy|share-city|k-handheld-info|(^|[ .>])qr([ .>]|$)/)) return 'INVITE';

  // Companion surfaces, ahead of the header and fallback rules they would otherwise fall into.
  if (inside(e, 'sessionEnded', /session-ended/)) return 'INVITE';
  if (inside(e, 'sentence', /kiosk-sentence|sada-sentence/)) return has(e, /sentence-kicker|kicker/) ? 'CONTEXT' : 'ANSWER';
  if (has(e, /sada-place/)) return 'CONTEXT';
  if (has(e, /nearby-head/)) return 'CONTEXT';
  if (has(e, /map-note/)) return 'EMPTY/DISCLAIMER';
  if (inside(e, 'nearbyRow', /(^|[ .>])nearby-row([ .>]|$)/) || inside(e, 'stopBoard', /stop-board/)) {
    if (DISCL.test(t)) return 'EMPTY/DISCLAIMER';
    if (e.tag === 'time' || has(e, /nearby-when/) || TIMEONLY.test(t) || TIMELABEL.test(t)) return 'CONTEXT';
    if (e.control && !t) return 'NAV/CHROME';
    return 'ANSWER';
  }

  // kiosk highlight block
  if (has(e, /k-highlight-credit/)) return 'EMPTY/DISCLAIMER';
  if (has(e, /k-highlight-kicker|k-highlight-pause/)) return 'NAV/CHROME';
  if (has(e, /k-highlight-where/)) return 'CONTEXT';
  if (has(e, /k-highlight-when/)) return /^(Do |U tijeku|Procjena|Po rasporedu|\d+ )/.test(t) ? 'ANSWER' : DISCL.test(t) ? 'EMPTY/DISCLAIMER' : 'CONTEXT';
  if (has(e, /k-highlight-content/)) {
    if (e.tag === 'h2') return hid.startsWith('record:') || /^Čekamo/.test(t) ? 'EMPTY/DISCLAIMER' : 'ANSWER';
    return 'EMPTY/DISCLAIMER';
  }
  // kiosk header / legend / weather / strip
  if (has(e, /kiosk-theme|kiosk-settings|k-theme|k-brand|kiosk-head-mid/)) return 'NAV/CHROME';
  if (has(e, /kiosk-date|kiosk-clock|k-clock|k-date|kiosk-context|k-context/)) return 'CONTEXT';
  if (has(e, /k-head/)) return 'NAV/CHROME';
  if (has(e, /maplibregl-ctrl-attrib|attrib/)) return 'EMPTY/DISCLAIMER';
  if (has(e, /k-map-legend|k-legend/)) return 'NAV/CHROME';
  if (has(e, /k-kicker|k-panel-kicker|k-panel-head/)) return 'NAV/CHROME';
  if (has(e, /k-meta|k-weather-note|k-board-note|k-panel-meta/)) return 'EMPTY/DISCLAIMER';
  if (has(e, /kiosk-panel-weather|k-weather|kiosk-temp|k-condition|k-forecast|k-panel\b/)) return DISCL.test(t) ? 'EMPTY/DISCLAIMER' : TIMELABEL.test(t) ? 'CONTEXT' : 'ANSWER';
  if (has(e, /safety-strip|k-strip/)) {
    if (has(e, /strip-sources|k-strip-trail|k-meta|strip-items/) || /DHMZ|EMSC/.test(t)) return 'EMPTY/DISCLAIMER';
    if (has(e, /strip-pharmacy/)) return /:$/.test(t) ? 'CONTEXT' : 'ANSWER';
    if (has(e, /strip-verdict|strip-warning|k-pharmacies|kiosk-essentials-open/)) return 'ANSWER';
    if (e.tag === 'a' || e.control || /^Sigurnost$/.test(t)) return 'NAV/CHROME';
    return 'ANSWER';
  }
  // The renderer's data-pills probe stayed empty in headless Chromium even where the captures show vehicle pills, so the
  // canvas class is decided per surface: kiosk map = vehicles + closures drawn (ANSWER); phone/desktop
  // Karta cold open = basemap + closures, no vehicles (CONTEXT) unless the probe says otherwise.
  if (e.tag === 'canvas') return inv.surface?.startsWith('kiosk') ? 'ANSWER' : inv.map && ((inv.map.pills || '').length > 0 || Number(inv.map.bodies || 0) > 0) ? 'ANSWER' : 'CONTEXT';
  if (e.tag === 'img') return 'NAV/CHROME';
  // phone / desktop shell
  if (has(e, /ki-session-sentence|ki-session-time|countdown|sheet-time|sheet-line/)) return 'CONTEXT';
  if (has(e, /ki-tabs|ki-status|ki-wordmark|ki-safety|ki-screen|ki-more|ki-domains|ki-tab\b|tab-more|status-more|safety-shortcut|screen-control|session-label|ki-session/)) return 'NAV/CHROME';
  if (has(e, /ki-weather|status-clock/)) return has(e, /ki-weather/) ? 'ANSWER' : 'CONTEXT';
  if (has(e, /banner/)) return DISCL.test(t) ? 'EMPTY/DISCLAIMER' : 'CONTEXT';
  // Sada
  if (has(e, /day-date|day-clock/)) return 'CONTEXT';
  if (has(e, /day-title|layer-title|day-section-head|section-head|t-block>h4|detail-title/)) return 'NAV/CHROME';
  if (has(e, /day-weather-source/)) return 'EMPTY/DISCLAIMER';
  if (has(e, /day-weather/)) return 'ANSWER';
  if (has(e, /location-context/)) return 'CONTEXT';
  if (has(e, /day-stop-prompt/)) return 'INSTRUCTION';
  if (has(e, /day-departures/)) {
    if (e.control && /^[↗→›>]?$/.test(t)) return 'NAV/CHROME';
    if (e.tag === 'h4' || has(e, /day-link/)) return 'CONTEXT';
    if (has(e, /city-meta/)) return DISCL.test(t) || /ZET/.test(t) ? 'EMPTY/DISCLAIMER' : 'CONTEXT';
    if (e.tag === 'small') return 'EMPTY/DISCLAIMER';
    if (DISCL.test(t)) return 'EMPTY/DISCLAIMER';
    return 'ANSWER';
  }
  if (has(e, /day-times|tb-seg|ev-days|day-time|city-times|city-filter\b|city-groups|city-group\b|ev-category|day-next-all/)) return 'NAV/CHROME';
  if (has(e, /day-more|tb-more/)) return /^\+\d+/.test(t) ? 'COUNT' : 'NAV/CHROME';
  if (has(e, /day-empty|t-empty|ev-empty|(^|[ .>])empty([ .>]|$)|laneEmpty/)) return 'EMPTY/DISCLAIMER';
  if (has(e, /day-period/) && e.tag === 'h4') return 'CONTEXT';
  if (has(e, /day-event-date|ev-day\b|agenda-day|day-head|ev-when/)) return 'CONTEXT';
  if (has(e, /provenance|attribution|sec-note|t-note|transport-note|arrivals-note|ev-attr|ev-foot|foot\b|tile-source|tile-meta|tile-foot|source/)) return 'EMPTY/DISCLAIMER';
  if (has(e, /day-facts|tile|day-event|day-opport|day-soft|city-row|agenda|ongoing|ev-row|arrival-rows|t-list|stop-routes|running-routes|route-vehicles|day-departure/)) {
    if (has(e, /city-kicker|tile-kicker|kicker|ev-kicker/)) return 'CONTEXT';
    if (TIMELABEL.test(t) || TIMEONLY.test(t) || /^Radovi u gradu$/.test(t)) return 'CONTEXT';
    if (/^(Nema|ništa|Bez )/i.test(t) || DISCL.test(t)) return 'EMPTY/DISCLAIMER';
    if (COUNTRE.test(t)) return 'COUNT';
    if (has(e, /city-meta/)) return /\d+ ?m\b|km\b/.test(t) ? 'CONTEXT' : DISCL.test(t) ? 'EMPTY/DISCLAIMER' : 'CONTEXT';
    if (e.tag === 'small') return 'EMPTY/DISCLAIMER';
    if (e.control && /^(Prikaži|Više|Još|Natrag|Ukloni|Spremi)/i.test(t)) return 'NAV/CHROME';
    return 'ANSWER';
  }
  if (has(e, /ev-count|chip-count|transport-total|stop-moving|stop-meta/)) return 'COUNT';
  if (has(e, /ev-summary|ev-outside/)) return 'NAV/CHROME';
  // Karta
  if (has(e, /transport-peek/)) return COUNTRE.test(t) || /\d+ (mjest|vozil)/.test(t) ? 'COUNT' : 'CONTEXT';
  if (has(e, /t-map-menu|map-controls|t-sheet-head|toggle-sheet|t-sheet-handle|transport-toolbar|t-search|city-filter-disclosure|transport-search|map-mode-toggle|fit-city|t-toggle|t-action/)) return 'NAV/CHROME';
  if (has(e, /map-status/)) return 'EMPTY/DISCLAIMER';
  if (has(e, /stop-title|route-title|vehicle-title|city-detail>h3|t-title/)) return 'CONTEXT';
  if (has(e, /city-legend|legend/) || /^Broj na ljubičastoj/.test(t)) return 'NAV/CHROME';
  if (has(e, /city-browse|t-sheet-content|transport-detail/)) {
    if (e.control) return INSTR.test(t) ? 'INSTRUCTION' : 'NAV/CHROME';
    if (e.tag === 'h3' || e.tag === 'h4') return 'NAV/CHROME';
    if (INSTR.test(t)) return 'INSTRUCTION';
    if (DISCL.test(t)) return 'EMPTY/DISCLAIMER';
    if (COUNTRE.test(t)) return 'COUNT';
    if (/^(Stajalište zaslona|Gradska referentna|Središte karte|Tvoja lokacija)/.test(t)) return 'CONTEXT';
    return 'ANSWER';
  }
  // fallbacks by text
  if (INSTR.test(t)) return 'INSTRUCTION';
  if (DISCL.test(t)) return 'EMPTY/DISCLAIMER';
  if (COUNTRE.test(t)) return 'COUNT';
  if (TIMEONLY.test(t) || TIMELABEL.test(t)) return 'CONTEXT';
  if (e.control || e.tag === 'summary' || e.tag === 'input' || e.tag === 'select') return 'NAV/CHROME';
  if (has(e, /visually-hidden|k-visually-hidden/)) return 'NAV/CHROME';
  return 'UNCLASSIFIED';
}

/** Units: drop 1-px visually hidden nodes (they occupy no viewport) and control wrappers whose text lives in children (the tab `<a>` around an icon and a label), so nothing is counted twice. */
export const isUnit = (e: InventoryElement): boolean => !(e.rect.h <= 1 || /visually-hidden/.test(e.classes)) && !(e.control && !e.text && e.fullText);

/** The height covered by a set of vertical spans, overlaps counted once. */
export function unionHeight(spans: readonly { top: number; bottom: number; h: number }[]): number {
  const s = spans.filter((x) => x.h > 0).sort((a, b) => a.top - b.top);
  let total = 0;
  let cur: { top: number; bottom: number } | null = null;
  for (const x of s) {
    if (!cur || x.top > cur.bottom) {
      if (cur) total += cur.bottom - cur.top;
      cur = { top: x.top, bottom: x.bottom };
    } else cur.bottom = Math.max(cur.bottom, x.bottom);
  }
  if (cur) total += cur.bottom - cur.top;
  return total;
}

export interface ClassifiedUnit extends InventoryElement { class: InventoryClass }
export interface ClassShare { count: number; viewportHeightShare: number; areaShare: number }
export interface InventorySummary {
  elementCount: number;
  perClass: Record<InventoryClass, ClassShare>;
  /** Share of the viewport height covered by any classified unit. */
  coveredHeightShare: number;
  /** `tag path "text"` of every UNCLASSIFIED unit: a review flag for a rule to add, never a result. */
  unclassified: string[];
}

/** Every unit of an inventory with its class. */
export function classifyInventory(inv: RawInventory): ClassifiedUnit[] {
  return inv.elements.filter(isUnit).map((e) => ({ ...e, class: classify(e, inv) }));
}

const round3 = (x: number): number => +x.toFixed(3);

/** Per class: unit count, the union of their vertical spans over the viewport height, their clipped area over the viewport area. */
export function summarise(inv: RawInventory, units: readonly ClassifiedUnit[] = classifyInventory(inv)): InventorySummary {
  const perClass = {} as Record<InventoryClass, ClassShare>;
  for (const c of CLASSES) {
    const mine = units.filter((e) => e.class === c);
    perClass[c] = {
      count: mine.length,
      viewportHeightShare: round3(unionHeight(mine.map((e) => e.clip)) / inv.vh),
      areaShare: round3(mine.reduce((s, e) => s + Math.min(e.rect.w, inv.vw) * e.clip.h, 0) / (inv.vw * inv.vh)),
    };
  }
  const content = units.filter((e) => e.class !== 'UNCLASSIFIED');
  return {
    elementCount: units.length,
    perClass,
    coveredHeightShare: round3(unionHeight(content.map((e) => e.clip)) / inv.vh),
    unclassified: units.filter((e) => e.class === 'UNCLASSIFIED').map((e) => `${e.tag} ${e.path} "${txt(e)}"`),
  };
}

// --- the wall's regions ---------------------------------------------------------------
const MARK_PATHS: Record<string, RegExp> = {
  aside: /(^|>)aside([[.>]|$)/,
  nearby: /\[nearby\]/,
  card: /\[kiosk-invite\]|\[kiosk-qr\]|k-panel--card/,
  footer: /\[safety-strip\]/,
};
/** The units inside any of the named regions (the collector's `within`, or the path for older recordings). */
export function unitsWithin(units: readonly ClassifiedUnit[], marks: readonly string[]): ClassifiedUnit[] {
  return units.filter((e) => marks.some((m) => inside(e, m, MARK_PATHS[m] ?? /$^/)));
}
/**
 * The wall's aside as principle 5 counts it: the "U blizini" list and the QR card.
 * The footer is a separate region: §11 keeps the verdict's credit ("DHMZ · EMSC")
 * there, and the footer's own rule is that it prints no clock time (wall.ts stripHasClock).
 */
export const WALL_ASIDE_MARKS: readonly string[] = ['aside', 'nearby', 'card'];
export const WALL_FOOTER_MARKS: readonly string[] = ['footer'];

// --- verdicts -------------------------------------------------------------------------
export interface FirstViewport {
  inventory: RawInventory;
  units: ClassifiedUnit[];
  summary: InventorySummary;
}

/** Principle 1 on any surface, plus principle 5 on the wall: the failures as sentences; `[]` means the first viewport holds. */
export function firstViewportFailures(view: FirstViewport, options: { wall?: boolean } = {}): string[] {
  const { summary, inventory, units } = view;
  const out: string[] = [];
  const list = (cls: InventoryClass, from: readonly ClassifiedUnit[] = units): string => from.filter((u) => u.class === cls).map((u) => `"${txt(u) || `<${u.tag}>`}"`).join(', ');
  for (const cls of ['INSTRUCTION', 'COUNT', 'UNCLASSIFIED'] as const) {
    const n = summary.perClass[cls].count;
    if (n > 0) out.push(`${inventory.label}: ${n} ${cls} unit${n === 1 ? '' : 's'} in the first viewport (target 0): ${list(cls)}`);
  }
  if (options.wall) {
    const aside = unitsWithin(units, WALL_ASIDE_MARKS);
    const n = aside.filter((u) => u.class === 'EMPTY/DISCLAIMER').length;
    if (n > 0) out.push(`${inventory.label}: ${n} EMPTY/DISCLAIMER unit${n === 1 ? '' : 's'} in the wall's aside (target 0): ${list('EMPTY/DISCLAIMER', aside)}`);
  }
  return out;
}

const zagrebClock = (d: Date): string => d.toLocaleTimeString('hr-HR', { timeZone: 'Europe/Zagreb', hour12: false });

/** The Playwright face: collect the first viewport, classify it, summarise it. */
export async function firstViewport(page: InventoryPage, label: string, extra: InventoryExtra = {}): Promise<FirstViewport> {
  const raw = await page.evaluate(COLLECT_IN_PAGE, COLLECT_SPEC);
  const now = new Date();
  const inventory: RawInventory = { label, at: now.toISOString(), zagreb: zagrebClock(now), ...extra, ...raw };
  const units = classifyInventory(inventory);
  return { inventory, units, summary: summarise(inventory, units) };
}
