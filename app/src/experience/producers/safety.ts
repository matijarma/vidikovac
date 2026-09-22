// Sigurnost's one band on the time band (plan A.6): urgent, calm or unknown,
// exactly as safetyState raises it. This producer is exempt from the normal
// skeleton/down/stale machinery (buildTimeband's `gated` check): the band's
// own words already are the state — "nije potvrđeno" when a source has not
// vouched, so there is nothing a skeleton or a retry block would add.
import { zagrebTime } from '../../format';
import { SAFETY_ICON, safetyState, safetyVerdict } from '../safety-state';
import type { TileProducer } from '../timeband';
import type { Tile } from '../tiles';

// The level's glyph and verdict moved to experience/safety-state.ts, beside
// the level itself, so the wall's footer reads them without the time band.
export { SAFETY_ICON, safetyVerdict } from '../safety-state';

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
