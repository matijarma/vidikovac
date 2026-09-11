// Sunrise and sunset from the standard "sunrise equation" (mean anomaly,
// equation of centre, ecliptic longitude, declination, hour angle at -0.833°
// for refraction and the solar disc). Accurate to a few minutes, which is all
// the solar theme needs. Pure: no Date.now(), no DOM.

export const ZAGREB = { lat: 45.815, lon: 15.98 } as const;

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
  transit: Date;
  /** 'day' when the sun never sets on that date, 'night' when it never rises. */
  polar: 'none' | 'day' | 'night';
}

const DEG = Math.PI / 180;
const J2000 = 2451545.0;
const UNIX_EPOCH_JD = 2440587.5;
const MS_PER_DAY = 86_400_000;

const sinD = (d: number): number => Math.sin(d * DEG);
const cosD = (d: number): number => Math.cos(d * DEG);
const mod360 = (x: number): number => ((x % 360) + 360) % 360;
const toJulian = (ms: number): number => ms / MS_PER_DAY + UNIX_EPOCH_JD;
const fromJulian = (j: number): Date => new Date(Math.round((j - UNIX_EPOCH_JD) * MS_PER_DAY));

export function sunTimes(date: Date, lat: number = ZAGREB.lat, lon: number = ZAGREB.lon): SunTimes {
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const n = Math.ceil(toJulian(dayStart) - J2000 + 0.0008);
  const meanSolarTime = n - lon / 360; // east longitude positive: solar noon earlier in UTC
  const meanAnomaly = mod360(357.5291 + 0.98560028 * meanSolarTime);
  const centre =
    1.9148 * sinD(meanAnomaly) + 0.02 * sinD(2 * meanAnomaly) + 0.0003 * sinD(3 * meanAnomaly);
  const eclipticLongitude = mod360(meanAnomaly + centre + 180 + 102.9372);
  const transitJ =
    J2000 + meanSolarTime + 0.0053 * sinD(meanAnomaly) - 0.0069 * sinD(2 * eclipticLongitude);
  const declination = Math.asin(sinD(eclipticLongitude) * sinD(23.4397)) / DEG;
  const cosHourAngle =
    (sinD(-0.833) - sinD(lat) * sinD(declination)) / (cosD(lat) * cosD(declination));
  const transit = fromJulian(transitJ);
  if (cosHourAngle >= 1) return { sunrise: transit, sunset: transit, transit, polar: 'night' };
  if (cosHourAngle <= -1) {
    return { sunrise: fromJulian(transitJ - 0.5), sunset: fromJulian(transitJ + 0.5), transit, polar: 'day' };
  }
  const hourAngle = Math.acos(cosHourAngle) / DEG;
  return {
    sunrise: fromJulian(transitJ - hourAngle / 360),
    sunset: fromJulian(transitJ + hourAngle / 360),
    transit,
    polar: 'none',
  };
}

export function isDaylight(at: Date, lat: number = ZAGREB.lat, lon: number = ZAGREB.lon): boolean {
  const t = sunTimes(at, lat, lon);
  if (t.polar === 'day') return true;
  if (t.polar === 'night') return false;
  return at.getTime() >= t.sunrise.getTime() && at.getTime() < t.sunset.getTime();
}
