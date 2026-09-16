// The kiosk frame: the header's weather group and the safety strip (the
// verdict, the trail, the pharmacy, the /hitno pill). Pure builders over
// ModuleSnapshot[] -- no fetch, no DOM, no clock of their own -- mirroring
// kiosk/local.ts's split between "no snapshot yet" (loading), "the source is
// down" (unknown/down) and a true, confirmed answer, because a public screen
// that guesses for an outage is lying (PRODUCT.md, principle 4). kiosk.ts
// calls these from paintWeather and paintStrip. Nothing here counts down and
// nothing is a tile any more (R-KP11, R-KP23): the stage is front.ts's panels.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import type { ScreenStop } from '../core/contracts';
import { SAFETY_ICON } from '../experience/producers/safety';
import { safetyState, type SafetyLevel } from '../experience/safety-state';
import { weatherIcon } from '../experience/weather-icon';
import type { I18n } from '../i18n/i18n';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup, type IconName } from '../ui/icons';
import { clock } from './format';
import { byModule, safetyStrip, sunToday, weatherNow, type SafetyStrip } from './local';
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

// --- The safety strip: the verdict, the trail, the pharmacy -----------------

export interface FrameStrip {
  level: SafetyLevel;
  /** "hitno" / "mirno" / "nepotvrđeno": safetyState's level in words. */
  verdict: string;
  parts: SafetyStrip;
  /** When the three safety sources last confirmed calm together (safetyState.confirmedAt); null unless every one answered. */
  confirmedAt: string | null;
}

export function frameStrip(modules: readonly ModuleSnapshot[], stop: ScreenStop | null, i18n: I18n, strings: KioskStrings, now: number): FrameStrip {
  const parts = safetyStrip(modules, stop, i18n, strings, now);
  const state = safetyState(byModule(modules), now);
  return { level: state.level, verdict: strings.safety.verdict[state.level], parts, confirmedAt: state.confirmedAt };
}

/**
 * The strip in one row (kajimafix 03.5): the shield kicker; the verdict with
 * its glyph, which is the button that opens Osnovno while the invitation
 * shows and a plain word while a session or the wizard owns the screen; then
 * the level's trail (the active or announced warning in DHMZ's words, or the
 * sources and the moment they last confirmed calm together); the on-duty
 * pharmacy, named in full (the map drops its address label when it sits on
 * the screen's own stop, R-KP18); the /hitno pill. Closures are said once,
 * in the column's statement, never here.
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
    <a class="k-strip-hitno" href="/hitno">${escapeHtml(strings.safety.hitno)}</a>`;
}
