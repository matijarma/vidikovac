// The kiosk frame: the safety strip (the verdict, the trail, the pharmacy,
// the /hitno pill). Pure builders over ModuleSnapshot[] -- no fetch, no DOM
// and no clock of their own -- mirroring
// kiosk/local.ts's split between "no snapshot yet" (loading), "the source is
// down" (unknown/down) and a true, confirmed answer, because a public screen
// that guesses for an outage is lying (PRODUCT.md, principle 4). kiosk.ts
// calls these from paintStrip. Nothing here counts down and nothing is a tile
// any more (R-KP11, R-KP23): the stage is front.ts's panels. Weather is the
// front page's own card now (kiosk/front.ts weatherPanel), never a header
// group: the header's middle carries the ticker instead.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import type { ScreenStop } from '../core/contracts';
import { SAFETY_ICON } from '../experience/producers/safety';
import { safetyState, type SafetyLevel } from '../experience/safety-state';
import type { I18n } from '../i18n/i18n';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import { clock } from './format';
import { byModule, safetyStrip, type SafetyStrip } from './local';
import { fill, type KioskStrings } from './strings';

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
