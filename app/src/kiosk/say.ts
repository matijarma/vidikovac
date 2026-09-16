// The column's statements: what the public screen says in words beside the
// picture (plan "The column: statements", rulings R-KP5, R-KP9, R-KP12,
// R-KP14; global constraints, contracts 4 and 5). Eight small pure
// candidates read the kiosk's own readers (kiosk/local.ts) -- never
// experience/producers/* (that graph needs a dashboard LayerContext, emits
// phone-link tiles and carries different stale/down semantics) -- rank
// themselves by weight with hysteresis so slots do not churn between polls,
// and print as the same markup contract 4 fixes so P3 can style and mount it
// without ever reading a Statement's fields itself. Honest data throughout:
// a candidate returns null rather than print a zero it has not observed
// (transit while zet-rt is still loading, lastrun once its table is down or
// has run out, a quake below R-KP9's threshold) -- the column simply shows
// fewer statements, never a fabricated one.
import { isOpenLicenceEvent } from '../../../worker/feed/modules/dogadanja/licence';
import { delayTone } from '../experience/delay';
import type { I18n } from '../i18n/i18n';
import { delayWord } from '../layers/shared';
import { dataNumber, dataText } from '../panels/panel';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { clock, dayKey, fmtDistance, fmtNumber, sameZagrebDay, weekdayDayMonth, zagrebDayAfter } from './format';
import { kBadge } from './markup';
import {
  byModule, closuresByDistance, isLive, kioskQuakes, lastDeparturesAhead, NEARBY_CLOSURE_M, nearbyVehicleCount, nextSession,
  routeDelays, sourceState, worksInKvart,
} from './local';
import { routeType, sortRouteIds } from './stops';
import { fill, plural, type KioskStrings } from './strings';
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import type { ScreenStop } from '../core/contracts';
import type { LastRunSnapshot } from '../core/lastrun';

export type SayDomain = 'transit' | 'komunalno' | 'civic' | 'events' | 'safety' | 'mobility';
export type SayKind = 'transit' | 'quake' | 'closure' | 'lastrun' | 'zet' | 'assembly' | 'works' | 'kvart';
export type SayTone = 'late' | 'early' | 'ontime' | 'unknown' | 'komunalno' | 'events' | 'urgent' | 'calm';

export interface Statement {
  /** Reconciler identity: `say:<kind>`, one per kind, so a changed value keeps its slot. */
  key: string;
  domain: SayDomain;
  say: SayKind;
  /** The ranker's relevance; the plan's table gives each kind its weight. */
  weight: number;
  /** The kicker, stored in sentence case (CSS uppercases it). */
  label: string;
  /** Trusted markup: the line badges after the kicker (the transit statement). */
  badgesMarkup?: string;
  /** The plain value text, also the crossfade signature; never truncated by CSS. */
  value: string;
  /** Trusted markup standing in for the value (last-departure pairs). */
  valueMarkup?: string;
  context?: string;
  tone?: SayTone;
  state?: 'stale' | 'down';
  /** The whole statement read aloud: label, value, context joined by ", ". */
  aria: string;
}

export interface Slot { key: string; statement: Statement }

export interface SayInput {
  modules: readonly ModuleSnapshot[];
  stop: ScreenStop | null;
  now: number;
  lastRun: LastRunSnapshot | null;
  strings: KioskStrings;
  i18n: I18n;
  locale: string;
  /** How many statements the composition shows: wide 3, compact 2, portrait 3, handheld every candidate. */
  slots: number;
  /** Line badges before "+N": wide 12, compact 6, portrait 8, handheld 6. */
  badgeCap: number;
  /** A title's shortening budget in characters (cut at a word boundary with "…"): wide 56, compact 44, portrait 48, handheld 40. */
  valueChars: number;
}

export interface SayMarkupContext { strings: KioskStrings; locale: string; loading: boolean }

/** Hysteresis: a shown statement keeps its slot unless a newcomer outweighs it by this much. */
export const SAY_HYSTERESIS = 15;

/** A route's delay row beyond this reads as a real deviation worth naming in
 *  the headline (the plan's own figure); a smaller one is still on time for
 *  the column's purposes even if delayWord's own +-15 s band would say so
 *  more finely elsewhere. */
const TRANSIT_HEADLINE_DELAY_S = 120;
/** At most this many deviating lines lead the transit value (plan: "the
 *  worst two"); a third line would not fit the value's own line budget. */
const TRANSIT_HEADLINE_LINES = 2;
/** A closure this close reads as "on this street" (the same distance the
 *  frame's nearby tile reasons in metres); further out it is still worth
 *  naming but ranks below the Assembly and the last departures. */
const CLOSURE_STREET_M = 500;
/** Institution names the app never translates (matches kiosk/local.ts's own
 *  CITY_SOURCE/CITY_KICKER precedent for "Skupština Grada Zagreba" and
 *  "Grad Zagreb": proper names of the two publishers behind every open-tier
 *  city row). */
const ASSEMBLY_SOURCE = 'Skupština Grada Zagreba';
const CITY_SOURCE = 'Grad Zagreb';
/** The Assembly still leads at 60 within a day; a session further out than
 *  two days is not worth a slot at all (plan: "60 within 24 h, 35 within 48 h"). */
const ASSEMBLY_SOON_MS = 24 * 3_600_000;
const ASSEMBLY_LATER_MS = 48 * 3_600_000;
/** A ZET notice is news only while it is fresh (R-KP9's quake window, reused
 *  for the same reason: a day-old notice is no longer "just in"). */
const ZET_NOTICE_WINDOW_MS = 24 * 3_600_000;

// --- Shortening (plan: "the composer shortens by rule") ---------------------

/** `text` unchanged under `chars`; otherwise cut at the last space at or
 *  before `chars - 1` and closed with an ellipsis (U+2026) -- never mid-word.
 *  A title with no space that early is cut hard as a last resort. */
export function shorten(text: string, chars: number): string {
  if (text.length <= chars) return text;
  const cut = text.lastIndexOf(' ', chars - 1);
  return `${text.slice(0, cut > 0 ? cut : chars - 1)}…`;
}

// --- Small shared helpers -----------------------------------------------------

function routeKind(routeId: string): 'tram' | 'bus' | 'other' {
  const type = routeType(routeId);
  return type === 0 ? 'tram' : type === 3 ? 'bus' : 'other';
}

function routeAria(routeId: string, strings: KioskStrings): string {
  const kind = routeKind(routeId);
  const word = kind === 'tram' ? strings.lines.tram : kind === 'bus' ? strings.lines.bus : '';
  return `${word} ${routeId}`.trim();
}

/** Trams first (route type via ZET_ROUTES), each group in rider order; the
 *  line badges after the kicker, capped, the rest folded into "+N". */
function transitBadges(routes: readonly string[], cap: number, strings: KioskStrings): string {
  const ordered = [...sortRouteIds(routes.filter((id) => routeType(id) === 0)), ...sortRouteIds(routes.filter((id) => routeType(id) !== 0))];
  const shown = ordered.slice(0, cap);
  const rest = ordered.length - shown.length;
  const badges = shown.map((id) => kBadge(id, routeKind(id), routeAria(id, strings))).join('');
  return rest > 0 ? `${badges}<span class="k-say-more">+${rest}</span>` : badges;
}

const aria = (...parts: (string | undefined)[]): string => parts.filter((part): part is string => Boolean(part)).join(', ');

// --- Candidates (plan "The column: statements" table) -----------------------

/** transit, weight 100, always (while zet-rt has answered at least once: a
 *  module still loading has nothing honest to say yet, not even "no data"). */
function transitCandidate(input: SayInput): Statement | null {
  const { stop, strings: s } = input;
  if (!stop) return null;
  const zet = byModule(input.modules)['zet-rt'];
  const state = sourceState(zet);
  if (state === 'loading') return null;
  const delays = routeDelays(zet);
  const badgesMarkup = transitBadges(stop.routes, input.badgeCap, s);

  let value: string;
  if (state === 'down') {
    value = s.paired.sourceDown;
  } else {
    const worst = stop.routes
      .map((id) => ({ id, delay: delays.get(id) }))
      .filter((row): row is { id: string; delay: number } => row.delay !== undefined && Math.abs(row.delay) >= TRANSIT_HEADLINE_DELAY_S)
      .sort((a, b) => Math.abs(b.delay) - Math.abs(a.delay))
      .slice(0, TRANSIT_HEADLINE_LINES);
    if (worst.length > 0) value = worst.map((row) => `${row.id} ${delayWord(input.i18n, row.delay)}`).join(' · ');
    else if (stop.routes.some((id) => delays.has(id))) value = s.say.transitRegular;
    else value = s.say.transitNoData;
  }

  const withDelay = stop.routes.map((id) => delays.get(id)).filter((d): d is number => d !== undefined);
  const worstDelay = withDelay.length > 0 ? withDelay.reduce((worst, d) => (Math.abs(d) > Math.abs(worst) ? d : worst)) : undefined;
  const toneRaw = delayTone(input.i18n, worstDelay);
  const tone: SayTone = toneRaw === 'none' ? 'unknown' : toneRaw;

  // Honest data: a down zet-rt carries no live pins and no real observation
  // time, so the context (the count-and-timestamp line) is omitted rather
  // than computed over the down snapshot's own empty items -- printing
  // "nema vozila u blizini" or a stale clock beside the honest down word in
  // `value` would read as a confirmed zero the source never reported.
  let context: string | undefined;
  if (state !== 'down') {
    const nearby = nearbyVehicleCount(zet, stop);
    const nearbyText = nearby === 0 ? s.say.nearbyNone : plural(input.locale, s.say.nearby, nearby);
    const time = clock(zet?.sourceUpdatedAt ?? zet?.fetchedAt);
    context = time ? `${nearbyText} · ZET ${time}` : nearbyText;
  }

  return {
    key: 'say:transit', domain: 'transit', say: 'transit', weight: 100,
    label: s.say.transit, badgesMarkup, value, context, tone,
    ...(state === 'down' || state === 'stale' ? { state } : {}),
    aria: aria(s.say.transit, value, context),
  };
}

/** quake, weight 95: kioskQuakes' newest (R-KP9: mag >= 3.0, <= 24 h). */
function quakeCandidate(input: SayInput): Statement | null {
  const emsc = byModule(input.modules).emsc;
  const quake = kioskQuakes(emsc, input.now)[0];
  if (!quake) return null;
  const s = input.strings;
  const mag = dataNumber(quake, 'mag');
  const depth = dataNumber(quake, 'depth');
  const region = dataText(quake, 'region') || quake.title;
  // story.quakeBody's own three " · "-joined segments (magnitude, region,
  // depth), split rather than duplicated as new keys: a translator who edits
  // quakeBody edits both surfaces at once and the two locales can never
  // drift the way two independently-typed templates could.
  const [magTemplate, , depthTemplate] = s.story.quakeBody.split(' · ');
  const magPart = mag === null ? s.paired.magUnknown : fill(magTemplate!, { mag: fmtNumber(input.locale, mag, 1) });
  const value = `${magPart} · ${region}`;
  const depthPart = depth === null ? '' : fill(depthTemplate!, { depth: fmtNumber(input.locale, depth, 1) });
  const context = ['EMSC', clock(quake.at), depthPart].filter(Boolean).join(' · ');
  return {
    key: 'say:quake', domain: 'safety', say: 'quake', weight: 95,
    label: s.say.quake, value, context,
    aria: aria(s.say.quake, value, context),
  };
}

/** closure, weight 90 within 500 m else 70: the nearest active closure
 *  within NEARBY_CLOSURE_M (local.ts's closuresByDistance -- the same reader
 *  closuresNear and closuresNearby are themselves built from). */
function closureCandidate(input: SayInput): Statement | null {
  const nearest = closuresByDistance(byModule(input.modules).prometnice, input.stop, input.now)[0];
  if (!nearest) return null;
  const within = input.stop === null || (nearest.distanceM !== null && nearest.distanceM <= NEARBY_CLOSURE_M);
  if (!within) return null;
  const { item, distanceM } = nearest;
  const s = input.strings;
  const untilMs = item.until ? Date.parse(item.until) : NaN;
  const untilText = Number.isFinite(untilMs)
    ? (sameZagrebDay(untilMs, input.now) ? fill(s.paired.untilTime, { time: clock(untilMs) }) : weekdayDayMonth(input.locale, untilMs))
    : '';
  const context = [distanceM === null ? '' : fmtDistance(input.locale, distanceM), item.summary ?? '', untilText].filter(Boolean).join(' · ');
  const value = item.title;
  const weight = distanceM !== null && distanceM <= CLOSURE_STREET_M ? 90 : 70;
  return {
    key: 'say:closure', domain: 'mobility', say: 'closure', weight,
    label: s.say.closure, value, context, tone: 'komunalno',
    aria: aria(s.say.closure, value, context),
  };
}

/** lastrun, weight 85: lastDeparturesAhead's own window (R-KP6); a down or
 *  expired table, or nothing within the evening window, is honest absence. */
function lastrunCandidate(input: SayInput): Statement | null {
  const departures = lastDeparturesAhead(input.lastRun, input.stop, input.now);
  if (departures.length === 0) return null;
  const label = input.i18n.t('tiles.lastRun');
  const context = input.i18n.t('tiles.scheduled');
  const pairs = departures.map((d) => ({ routeId: d.routeId, time: clock(d.at), iso: new Date(d.at).toISOString() }));
  const value = pairs.map((p) => `${p.routeId} ${p.time}`).join(' · ');
  const valueMarkup = pairs
    .map((p) => `<span class="k-say-pair">${kBadge(p.routeId, routeKind(p.routeId), routeAria(p.routeId, input.strings))}<time datetime="${escapeAttribute(p.iso)}">${escapeHtml(p.time)}</time></span>`)
    .join(' · ');
  return {
    key: 'say:lastrun', domain: 'transit', say: 'lastrun', weight: 85,
    label, valueMarkup, value, context,
    aria: aria(label, value, context),
  };
}

/** zet, weight 80: the newest zet-promet row published within the last 24 h. */
function zetCandidate(input: SayInput): Statement | null {
  const dogadanja = byModule(input.modules).dogadanja;
  if (!isLive(dogadanja)) return null;
  const notice = dogadanja.items
    .filter((item) => isOpenLicenceEvent(item) && dataText(item, 'source') === 'zet-promet')
    .filter((item) => {
      const at = item.at ? Date.parse(item.at) : NaN;
      return Number.isFinite(at) && at <= input.now && input.now - at <= ZET_NOTICE_WINDOW_MS;
    })
    .sort((a, b) => Date.parse(b.at!) - Date.parse(a.at!))[0];
  if (!notice) return null;
  const s = input.strings;
  const value = shorten(notice.title, input.valueChars);
  const context = `ZET · ${clock(notice.at)}`;
  return {
    key: 'say:zet', domain: 'transit', say: 'zet', weight: 80,
    label: s.say.zet, value, context,
    aria: aria(s.say.zet, value, context),
  };
}

/** assembly, weight 60 within 24 h else 35 within 48 h else none: nextSession. */
function assemblyCandidate(input: SayInput): Statement | null {
  const session = nextSession(input.modules, input.now);
  if (!session?.at) return null;
  const at = Date.parse(session.at);
  if (!Number.isFinite(at)) return null;
  const ahead = at - input.now;
  const weight = ahead <= ASSEMBLY_SOON_MS ? 60 : ahead <= ASSEMBLY_LATER_MS ? 35 : null;
  if (weight === null) return null;
  const s = input.strings;
  const dayWord = sameZagrebDay(at, input.now) ? s.say.today : dayKey(at) === zagrebDayAfter(input.now, 1) ? s.say.tomorrow : weekdayDayMonth(input.locale, at);
  const timeWord = dataText(session, 'precision') === 'time' ? clock(at) : s.paired.allDay;
  const value = shorten(session.title, input.valueChars);
  const context = `${dayWord} ${timeWord} · ${ASSEMBLY_SOURCE}`;
  return {
    key: 'say:assembly', domain: 'civic', say: 'assembly', weight,
    label: s.story.assembly, value, context,
    aria: aria(s.story.assembly, value, context),
  };
}

/** works, weight 40: worksInKvart, count > 0, source live or stale (a down
 *  register has nothing honest to count). */
function worksCandidate(input: SayInput): Statement | null {
  const works = worksInKvart(input.modules, input.stop, input.now);
  if (works.count === 0 || (works.state !== 'live' && works.state !== 'stale')) return null;
  const s = input.strings;
  const label = works.scope === 'kvart' ? s.say.worksKvart : s.say.worksCity;
  const countWord = plural(input.locale, s.say.works, works.count);
  const value = works.nearest ? shorten(works.nearest.title, input.valueChars) : countWord;
  const context = `${countWord} · ${CITY_SOURCE}`;
  return {
    key: 'say:works', domain: 'komunalno', say: 'works', weight: 40,
    label, value, context, tone: 'komunalno',
    ...(works.state === 'stale' ? { state: 'stale' as const } : {}),
    aria: aria(label, value, context),
  };
}

/** kvart, weight 20: the newest kvartovske story (undated notices keep the
 *  feed's own order -- there is no `at` worth sorting by). */
function kvartCandidate(input: SayInput): Statement | null {
  const dogadanja = byModule(input.modules).dogadanja;
  if (!isLive(dogadanja)) return null;
  const row = dogadanja.items.find((item) => isOpenLicenceEvent(item) && dataText(item, 'source') === 'kvartovske');
  if (!row) return null;
  const s = input.strings;
  const value = shorten(row.title, input.valueChars);
  return {
    key: 'say:kvart', domain: 'civic', say: 'kvart', weight: 20,
    label: s.say.kvart, value, context: CITY_SOURCE,
    aria: aria(s.say.kvart, value, CITY_SOURCE),
  };
}

const CANDIDATES: readonly ((input: SayInput) => Statement | null)[] = [
  transitCandidate, quakeCandidate, closureCandidate, lastrunCandidate, zetCandidate, assemblyCandidate, worksCandidate, kvartCandidate,
];

/**
 * The ranked statements for this moment: build every candidate, drop the
 * honest nulls, sort by weight descending (ties keep the table order above,
 * which never actually happens with these eight fixed weights but costs
 * nothing to guarantee), take `input.slots`. Hysteresis then defends a slot
 * a previous tick was already showing: a previously-shown statement that
 * fell out of the natural cut stays unless every candidate now occupying a
 * slot that was NOT itself shown before outweighs it by SAY_HYSTERESIS or
 * more -- so a value flickering by a few points of weight never bounces a
 * statement in and out of the column, while a genuinely bigger story still
 * displaces it. Pure: no Date.now(), no DOM.
 */
export function rankStatements(input: SayInput, previous: readonly Slot[]): Slot[] {
  const candidates = CANDIDATES.map((build) => build(input)).filter((statement): statement is Statement => statement !== null);
  const byKey = new Map(candidates.map((statement) => [statement.key, statement] as const));
  const prevKeys = new Set(previous.map((slot) => slot.key));

  const ranked = [...candidates].sort((a, b) => b.weight - a.weight);
  const chosen = ranked.slice(0, Math.max(0, input.slots));
  const chosenKeys = new Set(chosen.map((statement) => statement.key));

  for (const slot of previous) {
    if (chosenKeys.has(slot.key)) continue; // already shown this tick
    const incumbent = byKey.get(slot.key);
    if (!incumbent) continue; // no longer a candidate at all: honest absence
    // The weakest statement now holding a slot that was not itself shown
    // before: the one the incumbent would have to unseat to keep its place.
    let weakestNewcomerIndex = -1;
    for (let i = chosen.length - 1; i >= 0; i -= 1) {
      if (!prevKeys.has(chosen[i]!.key)) { weakestNewcomerIndex = i; break; }
    }
    if (weakestNewcomerIndex === -1) continue; // every current slot defends its own incumbent
    const newcomer = chosen[weakestNewcomerIndex]!;
    if (newcomer.weight - incumbent.weight >= SAY_HYSTERESIS) continue; // fairly outweighed: the incumbent yields
    chosenKeys.delete(newcomer.key);
    chosen[weakestNewcomerIndex] = incumbent;
    chosenKeys.add(incumbent.key);
  }

  chosen.sort((a, b) => b.weight - a.weight);
  return chosen.map((statement) => ({ key: statement.key, statement }));
}

// --- Markup (contract 4, verbatim) -------------------------------------------

const SKELETON = '<article class="k-say" data-skeleton aria-hidden="true"><span class="sk k-say-sk-label"></span><span class="sk k-say-sk-value"></span><span class="sk k-say-sk-context"></span></article>';

function statementMarkup(statement: Statement): string {
  const domain = ` data-domain="${escapeAttribute(statement.domain)}"`;
  const tone = statement.tone ? ` data-tone="${escapeAttribute(statement.tone)}"` : '';
  const state = statement.state ? ` data-state="${escapeAttribute(statement.state)}"` : '';
  const badges = statement.badgesMarkup ? `<span class="k-say-badges" data-testid="kiosk-lines">${statement.badgesMarkup}</span>` : '';
  const label = `<p class="k-say-label"><span class="k-say-kicker">${escapeHtml(statement.label)}</span>${badges}</p>`;
  const value = `<p class="k-say-value" data-replace data-sig="${escapeAttribute(statement.value)}">${statement.valueMarkup ?? escapeHtml(statement.value)}</p>`;
  const context = statement.context ? `<p class="k-say-context">${escapeHtml(statement.context)}</p>` : '';
  return `<article class="k-say" data-key="${escapeAttribute(statement.key)}"${domain}${tone}${state} data-testid="kiosk-say" data-say="${escapeAttribute(statement.say)}" aria-label="${escapeAttribute(statement.aria)}">${label}${value}${context}</article>`;
}

/** The column's markup for the slots (contract 4): a loading column with no
 *  slot yet renders one skeleton; every text value is escaped, `valueMarkup`
 *  is the trusted markup a candidate itself built (kBadge/time pairs). */
export function sayMarkup(slots: readonly Slot[], ctx: SayMarkupContext): string {
  if (ctx.loading && slots.length === 0) return SKELETON;
  return slots.map((slot) => statementMarkup(slot.statement)).join('');
}
