// The kiosk frame: the header's weather group, the safety strip (verdict,
// the three items, the rotation countdown) and the right column's two value
// tiles. Pure builders over ModuleSnapshot[] -- no fetch, no DOM, no clock of
// their own -- mirroring kiosk/local.ts's split between "no snapshot yet"
// (loading), "the source is down" (unknown/down) and a true, confirmed
// answer, because a public screen that guesses for an outage is lying
// (PRODUCT.md, principle 4). kiosk.ts calls these from paintWeather,
// paintStrip and paintCountdown; kiosk/invitation.ts (T2.10) calls valueTiles
// for the right column and frame.ts's own markup builders for the header and
// strip elements the shell already carries.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import type { ScreenStop } from '../core/contracts';
import { SAFETY_ICON } from '../experience/producers/safety';
import { safetyState, type SafetyLevel } from '../experience/safety-state';
import { weatherIcon } from '../experience/weather-icon';
import type { I18n } from '../i18n/i18n';
import { dataNumber } from '../panels/panel';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup, type IconName } from '../ui/icons';
import { clock, fmtDistance, fmtNumber } from './format';
import { byModule, closuresNear, NEARBY_CLOSURE_M, safetyStrip, sourceState, sunToday, weatherNow, type SafetyStrip, type SourceState } from './local';
import { fill, type KioskStrings } from './strings';

// --- Header weather: the group beside the clock, never a tile (D11) --------

export interface HeaderWeather {
  state: 'live' | 'stale';
  icon: IconName | null;
  /** A live observation with no numeric reading shows the glyph and the sun alone: never a dash. */
  temperature: string | null;
  sun: { kind: 'sunset' | 'sunrise'; time: string };
}

/** Null while `dhmz-now` is loading or down: the clock stands alone (D11). */
export function headerWeather(modules: readonly ModuleSnapshot[], strings: KioskStrings, locale: string, now: number): HeaderWeather | null {
  const weather = weatherNow(modules, strings, locale);
  if (weather.state === 'loading' || weather.state === 'down') return null;
  const sun = sunToday(now);
  // Before sunrise or after sunset the day's own arc is spent either way; the
  // group names whichever edge is still ahead -- today's sunrise before dawn,
  // tomorrow's once the sun has set.
  const sunInfo = sun.progress <= 0
    ? { kind: 'sunrise' as const, time: sun.sunrise }
    : sun.progress >= 1
      ? { kind: 'sunrise' as const, time: sunToday(now + 24 * 3_600_000).sunrise }
      : { kind: 'sunset' as const, time: sun.sunset };
  return { state: weather.state === 'stale' ? 'stale' : 'live', icon: weatherIcon(weather.condition), temperature: weather.temperature, sun: sunInfo };
}

/** The header's `.k-weather` inner markup; '' for null (the caller toggles `hidden`). */
export function weatherGroupMarkup(weather: HeaderWeather | null, strings: KioskStrings): string {
  if (!weather) return '';
  const icon = weather.icon ? iconMarkup(weather.icon, undefined, 'icon k-weather-icon') : '';
  const temp = weather.temperature === null ? '' : `<span class="k-temp" data-testid="kiosk-temp">${escapeHtml(weather.temperature)}</span>`;
  const stale = weather.state === 'stale' ? `<span class="k-chip k-chip--stale">${escapeHtml(strings.paired.stale)}</span>` : '';
  const sunWord = weather.sun.kind === 'sunset' ? strings.weather.sunset : strings.weather.sunrise;
  const sun = `<span class="k-sun" data-kind="${weather.sun.kind}">${iconMarkup(weather.sun.kind, undefined, 'icon k-icon')}<span class="k-visually-hidden">${escapeHtml(fill(sunWord, { time: weather.sun.time }))}</span><time aria-hidden="true">${escapeHtml(weather.sun.time)}</time></span>`;
  return `${icon}${temp}${stale}${sun}`;
}

// --- The safety strip: the verdict, the three items, the rotation countdown --

export interface FrameStrip {
  level: SafetyLevel;
  /** "hitno" / "mirno" / "nepotvrđeno": safetyState's level in words. */
  verdict: string;
  parts: SafetyStrip;
  /** Whole seconds to the next scene; null when the field is not rotating. */
  nextIn: number | null;
  /** When the three safety sources last confirmed calm together (safetyState.confirmedAt); null unless every one answered. */
  confirmedAt: string | null;
}

export interface RotationClock {
  rotating: boolean;
  lastRotateAt: number;
  period: number;
}

export function frameStrip(modules: readonly ModuleSnapshot[], stop: ScreenStop | null, i18n: I18n, strings: KioskStrings, now: number, rotation: RotationClock): FrameStrip {
  const parts = safetyStrip(modules, stop, i18n, strings, now);
  const state = safetyState(byModule(modules), now);
  const nextIn = rotation.rotating ? Math.max(0, Math.ceil((rotation.lastRotateAt + rotation.period - now) / 1000)) : null;
  return { level: state.level, verdict: strings.safety.verdict[state.level], parts, nextIn, confirmedAt: state.confirmedAt };
}

/** "sljedeći prizor za 15 s"; '' when the field is not rotating (the caller hides the element). */
export function countdownText(nextIn: number | null, strings: KioskStrings): string {
  return nextIn === null ? '' : fill(strings.safety.nextScene, { seconds: nextIn });
}

/**
 * The strip in one row (kajimafix 03.5): the shield kicker; the verdict with
 * its glyph, which is the button that opens Osnovno while the invitation
 * shows and a plain word while a session or the wizard owns the screen; then
 * the level's trail (the active or announced warning in DHMZ's words, or the
 * sources and the moment they last confirmed calm together); the on-duty
 * pharmacy; the rotation's countdown; the /hitno pill. Closures are said
 * once, on the right column's tile, never here.
 */
export function stripMarkup(strip: FrameStrip, strings: KioskStrings, opts: { noBasics: boolean }): string {
  const w = strip.parts.warning;
  const word = `${iconMarkup(SAFETY_ICON[strip.level], undefined, 'icon k-icon')}<span>${escapeHtml(strip.verdict)}</span>`;
  const verdict = opts.noBasics
    ? `<span class="k-strip-verdict" data-testid="strip-verdict" data-level="${strip.level}">${word}</span>`
    : `<button type="button" class="k-strip-verdict" data-testid="kiosk-essentials-open" data-level="${strip.level}" aria-label="${escapeAttribute(fill(strings.safety.openBasics, { verdict: strip.verdict }))}"><span data-testid="strip-verdict">${word}</span></button>`;
  const sources = strip.confirmedAt ? fill(strings.safety.confirmed, { time: clock(strip.confirmedAt) }) : strings.safety.sources;
  const trail = w.state === 'none'
    ? `<span class="k-strip-item" data-testid="strip-sources">${escapeHtml(sources)}</span>`
    : `<span class="k-strip-item" data-testid="strip-warning" data-state="${w.state}"${w.severity ? ` data-severity="${escapeAttribute(w.severity)}"` : ''}>${escapeHtml(w.text)}</span>`;
  return `<span class="k-strip-label">${iconMarkup('shield', undefined, 'icon k-icon')}<span>${escapeHtml(strings.safety.label)}</span></span>
    ${verdict}
    <div class="k-strip-items" data-testid="strip-items">
    ${trail}
    <span class="k-strip-item" data-testid="strip-pharmacy">${escapeHtml(strings.safety.pharmacy)}: <strong>${escapeHtml(strip.parts.pharmacy.label)}</strong></span>
    </div>
    <span class="k-strip-next" data-testid="strip-next"${strip.nextIn === null ? ' hidden' : ''}>${escapeHtml(countdownText(strip.nextIn, strings))}</span>
    <a class="k-strip-hitno" href="/hitno">${escapeHtml(strings.safety.hitno)}</a>`;
}

// --- The right column's two value tiles (D18, C.7): vehicles and closures ----

export interface ValueTile {
  id: 'vehicles' | 'closures';
  testid: 'tile-vehicles' | 'tile-closures';
  state: SourceState;
  label: string;
  value: string | null;
  glyph?: IconName;
  context: string;
}

/** Vehicles moving on the network (the `zet-rt` fleet count), then closures
 *  within the 1.5 km nearby radius (D18); the strip's closures cell drops the
 *  nearest street so it is said once, here. */
// `i18n` is unused today (every word here comes from `strings`) but kept in
// the signature: it is the documented C.2 contract kiosk/invitation.ts (T2.10)
// calls, matching valueTiles' siblings (frameStrip, closuresNear) which do
// need it, so a caller passes the same five arguments to either.
export function valueTiles(modules: readonly ModuleSnapshot[], stop: ScreenStop | null, i18n: I18n, strings: KioskStrings, locale: string, now: number): [ValueTile, ValueTile] {
  const zet = byModule(modules)['zet-rt'];
  const vehicleState = sourceState(zet);
  const vozila = zet?.items.find((item) => item.id === 'vozila');
  const vehicleCount = vozila ? dataNumber(vozila, 'vehicles') : null;
  const vehicleTime = clock(zet?.sourceUpdatedAt ?? zet?.fetchedAt);
  const vehicles: ValueTile = {
    id: 'vehicles',
    testid: 'tile-vehicles',
    state: vehicleState,
    label: strings.tiles.vehicles,
    value: vehicleCount === null ? null : fmtNumber(locale, vehicleCount, 0),
    glyph: 'tram-front',
    context: vehicleTime ? `ZET · ${fill(strings.paired.dataFrom, { time: vehicleTime })}` : '',
  };
  const near = closuresNear(modules, stop, now);
  const nearestKnown = near.nearbyCount > 0 && near.nearest;
  const closureContext = nearestKnown
    ? near.nearest!.distanceM === null
      ? fill(strings.safety.closuresNearest, { street: near.nearest!.title })
      : fill(strings.tiles.nearest, { street: near.nearest!.title, distance: fmtDistance(locale, near.nearest!.distanceM) })
    : fill(strings.tiles.radius, { radius: fmtDistance(locale, NEARBY_CLOSURE_M) });
  const closures: ValueTile = {
    id: 'closures',
    testid: 'tile-closures',
    state: near.state,
    label: strings.tiles.closures,
    value: String(near.nearbyCount),
    context: closureContext,
  };
  return [vehicles, closures];
}

export function tileMarkup(tile: ValueTile, strings: KioskStrings): string {
  if (tile.state === 'loading') {
    return `<div class="tl k-tile" data-testid="${tile.testid}" data-state="loading"><span class="sk tl-sk-label"></span><span class="sk tl-sk-value"></span><span class="sk tl-sk-context"></span></div>`;
  }
  if (tile.state === 'down') {
    // A hole in a fixed frame reads as a fault: the tile stays, its value the honest word (C.3).
    return `<div class="tl k-tile" data-testid="${tile.testid}" data-state="down"><p class="tl-label">${escapeHtml(tile.label)}</p><p class="tl-value">${escapeHtml(strings.paired.sourceDown)}</p></div>`;
  }
  const glyph = tile.glyph ? iconMarkup(tile.glyph, undefined, 'icon k-glyph') : '';
  const context = tile.state === 'stale'
    ? `<span class="badge" data-tone="stale">${escapeHtml(strings.paired.stale)}</span>`
    : `<p class="tl-context">${escapeHtml(tile.context)}</p>`;
  return `<div class="tl k-tile" data-testid="${tile.testid}" data-state="${tile.state}"><p class="tl-label">${escapeHtml(tile.label)}</p><p class="tl-value">${glyph}<span>${escapeHtml(tile.value ?? '')}</span></p>${context}</div>`;
}
