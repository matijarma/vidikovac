// Sigurnost's one band on the time band (plan A.6): urgent, calm or unknown,
// exactly as safetyState raises it. This producer is exempt from the normal
// skeleton/down/stale machinery (buildTimeband's `gated` check): the band's
// own words already are the state — "nije potvrđeno" when a source has not
// vouched, so there is nothing a skeleton or a retry block would add.
import { zagrebTime } from '../../format';
import type { I18n } from '../../i18n/i18n';
import type { IconName } from '../../ui/icons';
import { safetyState, type SafetyLevel, type SafetyState } from '../safety-state';
import type { TileProducer } from '../timeband';
import type { Tile } from '../tiles';

/**
 * The severities that make the city urgent, ranked. It is the same predicate
 * `safetyState` raises `urgent` from, so a warning may name the verdict only
 * when it is itself a reason for it; `minor` and `info` are real DHMZ
 * severities and neither is (moved verbatim from grad-sada.ts:162-177).
 */
const URGENT_RANK: Record<string, number> = { extreme: 3, severe: 2, moderate: 1 };
export const SAFETY_ICON: Record<SafetyLevel, IconName> = { calm: 'check-circle', urgent: 'triangle-alert', unknown: 'alert-circle' };

/** The safety verdict in the words the domain uses: the top warning when one is the reason, otherwise calm, unconfirmed, or the urgent word. */
export function safetyVerdict(i18n: I18n, state: SafetyState): string {
  if (state.level === 'calm') return i18n.t('safety.calm');
  if (state.level === 'unknown') return i18n.t('directory.safetySummaryUnknown');
  // Urgency can come from the quake instead. Then the band says so in the
  // domain's own word rather than borrowing the colour of a warning that is
  // not the reason ("zeleno" is never a level word anywhere, R-K1).
  const top = [...state.activeWarnings]
    .filter((w) => URGENT_RANK[w.severity ?? ''] !== undefined)
    .sort((a, b) => (URGENT_RANK[b.severity!] ?? 0) - (URGENT_RANK[a.severity!] ?? 0))[0];
  if (!top) return i18n.t('safety.urgent');
  return `${i18n.t(`panels.severity.${top.severity}`)}: ${top.title}`;
}

export const safetyProducer: TileProducer = {
  domain: 'safety',
  modules: ['dhmz-cap', 'emsc', 'prometnice'],
  layer: 'sigurnost',
  skeleton: null,
  produce(ctx): Tile[] {
    const { i18n } = ctx;
    const state = safetyState(ctx.snapshots, ctx.now);
    const verdict = safetyVerdict(i18n, state);
    const confirmed = state.level === 'calm' && state.confirmedAt;
    return [{
      key: 'safety',
      domain: 'safety',
      variant: 'band',
      tone: state.level,
      icon: SAFETY_ICON[state.level],
      label: i18n.t('layers.sigurnost'),
      title: verdict,
      value: confirmed ? i18n.t('overview.allClearConfirmed', { time: zagrebTime(state.confirmedAt!) }) : '',
      data: { level: state.level },
      layer: 'sigurnost',
      bucket: 'sada',
      testid: 'tile-safety',
    }];
  },
};
