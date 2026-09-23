// The kiosk frame: the safety strip (the verdict, the trail, the pharmacy,
// the /hitno pill). Pure builders over ModuleSnapshot[] -- no fetch, no DOM
// and no clock of their own -- mirroring
// kiosk/local.ts's split between "no snapshot yet" (loading), "the source is
// down" (unknown/down) and a true, confirmed answer, because a public screen
// that guesses for an outage is lying (PRODUCT.md, principle 4). kiosk.ts
// calls these from paintStrip. Nothing here counts down and nothing is a tile
// any more (R-KP11, R-KP23), and no fetch or confirmation time is printed
// (principle 5): the calm trail names its sources, never a moment. Weather is
// never a footer group: the header's middle carries the sentence instead.
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import type { ScreenStop } from '../core/contracts';
import { SAFETY_ICON, safetyState, type SafetyLevel } from '../experience/safety-state';
import type { I18n } from '../i18n/i18n';
import { escapeAttribute, escapeHtml } from '../ui/dom/escape';
import { iconMarkup } from '../ui/icons';
import { byModule, safetyStrip, type SafetyStrip } from './local';
import { fill, type KioskStrings } from './strings';
import { externalHtml } from './external';
import { vetExternal } from '../../../shared/kiosk/external-text-boundary';

// --- The safety strip: the verdict, the trail, the pharmacy -----------------

export interface FrameStrip {
  level: SafetyLevel;
  /** "hitno" / "mirno" / "nepotvrđeno": safetyState's level in words. */
  verdict: string;
  parts: SafetyStrip;
}

/** The on-duty mark beside the green cross: the owner's exact characters, the same in both languages. */
export const PHARMACY_HOURS = '24/7';

export function frameStrip(modules: readonly ModuleSnapshot[], stop: ScreenStop | null, i18n: I18n, strings: KioskStrings, now: number): FrameStrip {
  const parts = safetyStrip(modules, stop, i18n, strings, now);
  const state = safetyState(byModule(modules), now);
  return { level: state.level, verdict: strings.safety.verdict[state.level], parts };
}

/**
 * The strip in one row (kajimafix 03.5; the wall of 22 September): the shield
 * kicker; the verdict with its glyph, which is the button that opens Osnovno
 * while the invitation shows and a plain word while a session or the wizard
 * owns the screen; then the level's trail (the active or announced warning in
 * DHMZ's words, or the sources, "DHMZ · EMSC", without a time); the on-duty
 * pharmacy as the green cross, "24/7" and its short address (the cross carries
 * the pharmacy's name for a screen reader; the map drops its address label
 * when it sits on the screen's own stop, R-KP18); the /hitno pill. Closures
 * are said once, in the column's statement, never here.
 */
export function stripMarkup(strip: FrameStrip, strings: KioskStrings, opts: { noBasics: boolean; passive?: boolean }): string {
  const w = strip.parts.warning;
  const word = `${iconMarkup(SAFETY_ICON[strip.level], undefined, 'icon k-icon')}<span>${escapeHtml(strip.verdict)}</span>`;
  const verdict = opts.noBasics || opts.passive
    ? `<span class="k-strip-verdict" data-testid="strip-verdict" data-level="${strip.level}">${word}</span>`
    : `<button type="button" class="k-strip-verdict" data-testid="kiosk-essentials-open" data-level="${strip.level}" aria-label="${escapeAttribute(fill(strings.safety.openBasics, { verdict: strip.verdict }))}"><span data-testid="strip-verdict">${word}</span></button>`;
  const trail = w.state === 'none'
    ? `<span class="k-strip-item" data-testid="strip-sources">${escapeHtml(strings.safety.sources)}</span>`
    : `<span class="k-strip-item" data-testid="strip-warning" data-state="${w.state}"${w.severity ? ` data-severity="${escapeAttribute(w.severity)}"` : ''}>${externalHtml('summary', w.text)}</span>`;
  return `<span class="k-strip-label">${iconMarkup('shield', undefined, 'icon k-icon')}<span>${escapeHtml(strings.safety.label)}</span></span>
    ${verdict}
    <div class="k-strip-items" data-testid="strip-items">
    ${trail}
    ${pharmacyMarkup(strip, strings)}
    </div>
    ${opts.passive
      ? `<span class="k-strip-hitno">${escapeHtml(strings.safety.hitno)}</span>`
      : `<a class="k-strip-hitno" href="/hitno">${escapeHtml(strings.safety.hitno)}</a>`}`;
}

/** Green cross · 24/7 · the short address: `[data-symbol=pharmacy]` is the cross itself (the probe contract, §15.6). */
function pharmacyMarkup(strip: FrameStrip, strings: KioskStrings): string {
  const caption = fill(strings.sentence.pharmacy, { address: vetExternal('address', strip.parts.pharmacy.label, 'row') ?? '' });
  const cross = iconMarkup('cross', caption, 'icon k-icon k-cross').replace('<svg ', '<svg data-symbol="pharmacy" ');
  return `<span class="k-strip-item k-strip-pharmacy" data-testid="strip-pharmacy">${cross}<span class="k-247">${PHARMACY_HOURS}</span> <strong>${externalHtml('address', strip.parts.pharmacy.label)}</strong></span>`;
}
