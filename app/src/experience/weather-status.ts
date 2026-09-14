// Weather is status, not a tile (plan D11): one group of condition glyph ·
// temperature · sunset glyph + time, shared by the phone's sada head beside
// the clock, the desktop status line and the kiosk header. Built once here so
// there is no second builder and no second wording. Without an observation,
// with a down source or without a numeric temperature the group is null and
// the clock stands alone: never a dash, never a zero.
import type { FeedSnapshots } from '../core/contracts';
import { zagrebDayKey, zagrebTime } from '../format';
import type { I18n } from '../i18n/i18n';
import { dataNumber, dataText } from '../panels/panel';
import { escapeHtml } from '../ui/dom/escape';
import { iconMarkup, type IconName } from '../ui/icons';
import { sunTimes } from '../ui/solar';
import { conditionText, numberText } from './text';
import { weatherIcon } from './weather-icon';

export interface WeatherStatus {
  /** The sky as a symbol; null when DHMZ's words name none (the word still stands in the aria). */
  icon: IconName | null;
  /** DHMZ's own condition phrase, '' for its lone dash. */
  condition: string;
  /** '21,4 °C' in the reader's locale, one decimal at most, like the kiosk header. */
  temp: string;
  /** Today's sunset in Zagreb, 'HH:MM'. */
  sunset: string;
  /** The last good copy is shown: the source stopped answering. */
  stale: boolean;
  /** condition, temperature, "zalazak HH:MM" and, when stale, the badge's word: the label the caller puts on the link. */
  aria: string;
}

export function weatherStatus(i18n: I18n, snapshots: FeedSnapshots, now: number): WeatherStatus | null {
  const snapshot = snapshots['dhmz-now'];
  if (!snapshot || snapshot.status === 'down') return null;
  const observation = snapshot.items[0];
  const temp = dataNumber(observation, 'temp');
  if (temp === null) return null;
  const condition = conditionText(dataText(observation, 'weather'));
  const tempText = i18n.t('panels.temperature', { value: numberText(i18n, temp, 1) });
  // The Zagreb calendar day, not the UTC one: after a Zagreb midnight the sunset shown is already the new day's.
  const sunset = zagrebTime(sunTimes(new Date(`${zagrebDayKey(now)}T12:00:00Z`)).sunset);
  const stale = snapshot.status === 'stale';
  const parts = [condition, tempText, i18n.t('weatherStatus.sunset', { time: sunset })];
  if (stale) parts.push(i18n.t('status.staleShort', { time: zagrebTime(snapshot.staleSince ?? snapshot.fetchedAt) }));
  return { icon: weatherIcon(condition), condition, temp: tempText, sunset, stale, aria: parts.filter(Boolean).join(', ') };
}

/** glyph · temperature · sunset glyph + time; the caller wraps it in the link that carries `status.aria`. */
export function weatherStatusMarkup(status: WeatherStatus): string {
  const glyph = status.icon ? iconMarkup(status.icon, undefined, 'icon icon-sm') : '';
  return `${glyph}<span class="tb-temp">${escapeHtml(status.temp)}</span>${iconMarkup('sunset', undefined, 'icon icon-sm tb-sun')}<span>${escapeHtml(status.sunset)}</span>`;
}
