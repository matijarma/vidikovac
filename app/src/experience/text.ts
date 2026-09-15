// Words for times, days, directions and distances, in the active locale.
// Nothing here invents a value: an item without a date says so.
import type { FeedItem } from '../../../worker/feed/schema';
import { haversineKm, rad } from '../core/geo';
import { parseIso, zagrebDateTime, zagrebDayKey, zagrebTime, zagrebWeekdayDate, type TimeInput } from '../format';
import type { I18n } from '../i18n/i18n';

export const ZAGREB_LON_LAT: [number, number] = [15.98, 45.815];

export function intlLocale(i18n: I18n): string {
  return i18n.getLocale() === 'en' ? 'en-GB' : 'hr-HR';
}

export function numberText(i18n: I18n, value: number, digits = 0): string {
  return new Intl.NumberFormat(intlLocale(i18n), { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
}

/** Whole days between two Zagreb day keys ('YYYY-MM-DD'). */
export function dayOffset(dayKey: string, todayKey: string): number | null {
  const a = Date.parse(`${dayKey}T00:00:00Z`);
  const b = Date.parse(`${todayKey}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

/** 'danas', 'sutra', 'jučer' or the weekday date. */
export function dayLabel(i18n: I18n, value: TimeInput, now: number): string {
  const key = zagrebDayKey(value);
  if (!key) return i18n.t('time.unknown');
  const offset = dayOffset(key, zagrebDayKey(now));
  if (offset === 0) return i18n.t('time.today');
  if (offset === 1) return i18n.t('time.tomorrow');
  if (offset === -1) return i18n.t('time.yesterday');
  return zagrebWeekdayDate(value);
}

/** The same as dayLabel, capitalised for a group heading: 'Danas', 'Sutra', else the weekday date. */
export function dayHeading(i18n: I18n, value: TimeInput, now: number): string {
  const key = zagrebDayKey(value);
  if (!key) return i18n.t('time.unknown');
  const offset = dayOffset(key, zagrebDayKey(now));
  if (offset === 0) return i18n.t('events.today');
  if (offset === 1) return i18n.t('events.tomorrow');
  return zagrebWeekdayDate(value);
}

/** 'upravo sada', 'prije 5 minuta', 'prije 2 sata', else the date and time. */
export function relativeTime(i18n: I18n, value: TimeInput, now: number): string {
  const date = parseIso(value);
  if (!date) return i18n.t('time.unknown');
  const seconds = Math.round((now - date.getTime()) / 1000);
  if (seconds < 60 && seconds > -60) return i18n.t('time.justNow');
  if (seconds < 3600 && seconds > 0) return i18n.t('time.minutesAgo', { count: Math.floor(seconds / 60) });
  if (seconds < 86_400 && seconds > 0) return i18n.t('time.hoursAgo', { count: Math.floor(seconds / 3600) });
  const key = zagrebDayKey(date);
  const offset = dayOffset(key, zagrebDayKey(now));
  if (offset === 0) return i18n.t('time.todayAt', { time: zagrebTime(date) });
  if (offset === -1) return i18n.t('time.yesterdayAt', { time: zagrebTime(date) });
  if (offset === 1) return i18n.t('time.tomorrowAt', { time: zagrebTime(date) });
  return zagrebDateTime(date);
}

function isDayPrecision(item: FeedItem): boolean {
  const precision = item.data?.precision;
  return precision === 'day' || precision === 'range' || /^\d{4}-\d{2}-\d{2}$/.test(item.at ?? '');
}

/** When an event happens, in words that never claim a time the source did not give. */
export function eventWhen(i18n: I18n, item: FeedItem, now: number): string {
  if (!item.at || item.dateBasis === 'unknown') return i18n.t('time.unknown');
  const day = dayLabel(i18n, item.at, now);
  const endKey = item.until ? zagrebDayKey(item.until) : '';
  const multiDay = endKey !== '' && endKey !== zagrebDayKey(item.at);
  if (isDayPrecision(item)) {
    if (multiDay) return i18n.t('time.range', { from: day, to: zagrebWeekdayDate(item.until) });
    return `${day}, ${i18n.t('time.allDay')}`;
  }
  if (multiDay) return i18n.t('time.range', { from: `${day} ${zagrebTime(item.at)}`, to: zagrebWeekdayDate(item.until) });
  return `${day} ${zagrebTime(item.at)}`;
}

/** True when the event's own window includes the Zagreb calendar day of `now`. */
export function coversDay(item: FeedItem, now: number): boolean {
  if (!item.at || item.dateBasis === 'unknown') return false;
  const today = zagrebDayKey(now);
  const start = zagrebDayKey(item.at);
  const end = item.until ? zagrebDayKey(item.until) : start;
  return start <= today && today <= end;
}

/** Croatian points of the compass (S = sjever) to degrees. */
const WIND_HR: Record<string, number> = {
  S: 0, SSI: 22.5, SI: 45, ISI: 67.5, I: 90, IJI: 112.5, JI: 135, JJI: 157.5,
  J: 180, JJZ: 202.5, JZ: 225, ZJZ: 247.5, Z: 270, ZSZ: 292.5, SZ: 315, SSZ: 337.5,
};
/** English points, which is what DHMZ's own XML carries (e.g. NW). */
const WIND_EN: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
};

/** Wind direction text to compass degrees; null when calm, empty or not a known point. */
export function windBearing(dir: string): number | null {
  const key = dir.trim().toUpperCase();
  if (!key || key === 'C' || key === '-' || key === '–') return null;
  // Croatian points are the only ones that use I, J or Z; everything else reads as English.
  const table = /[IJZ]/.test(key) ? WIND_HR : WIND_EN;
  return key in table ? table[key]! : null;
}

/** A condition phrase worth showing; DHMZ writes a lone dash when it has none. */
export function conditionText(value: string): string {
  const text = value.trim();
  return /^[-–—]*$/.test(text) ? '' : text;
}

const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export function compassWord(i18n: I18n, bearing: number): string {
  const index = Math.round((((bearing % 360) + 360) % 360) / 45) % 8;
  return i18n.t(`motion.compass.${COMPASS8[index]}`);
}

// The haversine formula itself lives in `core/geo.ts` (fix round 1, T3.2
// review) so `core/mobility.ts`'s `nearestStation` can use the identical
// distance without `core/` reaching into `experience/`; every existing
// caller here keeps importing it from this file, under its long-standing name.
export const distanceKm = haversineKm;

/** Initial bearing from point 1 to point 2, compass degrees. */
export function bearingDeg(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function pointOf(item: FeedItem): [number, number] | null {
  if (item.geo?.type !== 'Point') return null;
  const [lon, lat] = item.geo.coordinates as number[];
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon!, lat!] : null;
}
