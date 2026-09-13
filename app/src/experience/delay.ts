// Which tone a route's delay word may carry. Derived from the shared helper's
// own output, never from a threshold of this file's own: a word the helper
// renders as neither late, early nor on time (a median it declines to assert)
// gets no tone, so an implausible figure is never coloured as actionable.
import type { I18n } from '../i18n/i18n';
import { delayWord } from '../layers/shared';

export type DelayTone = 'late' | 'early' | 'ontime' | 'none';

export function delayTone(i18n: I18n, seconds: number | undefined): DelayTone {
  if (seconds === undefined || !Number.isFinite(seconds)) return 'none';
  const word = delayWord(i18n, seconds);
  if (word === i18n.t('panels.delayOnTime')) return 'ontime';
  const minutes = Math.max(1, Math.round(Math.abs(seconds) / 60));
  if (word === i18n.t('panels.delayLate', { minutes })) return 'late';
  if (word === i18n.t('panels.delayEarly', { minutes })) return 'early';
  return 'none';
}
