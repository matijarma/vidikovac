import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DHMZ_NOW_URL, ZAGREB_STATION, fetchDhmzNow, parseDhmzNow } from '../../worker/feed/modules/dhmz-now';
import { DHMZ_FORECAST_URL, fetchDhmzForecast, parseDhmzForecast } from '../../worker/feed/modules/dhmz-forecast';

const nowXml = readFileSync(new URL('../fixtures/hrvatska1_n.xml', import.meta.url), 'utf8');
const forecastXml = readFileSync(new URL('../fixtures/prognoza_danas.xml', import.meta.url), 'utf8');

describe('parseDhmzNow', () => {
  const payload = parseDhmzNow(nowXml);

  it('takes exactly the Zagreb-Maksimir row', () => {
    expect(ZAGREB_STATION).toBe('Zagreb-Maksimir');
    expect(payload.items).toHaveLength(1);
    const item = payload.items[0];
    expect(item.id).toBe('zagreb-maksimir');
    expect(item.kind).toBe('observation');
    expect(item.title).toBe('Zagreb-Maksimir');
    expect(item.geo).toEqual({ type: 'Point', coordinates: [16.034, 45.822] });
  });

  it('reads the measurements and says them in Croatian', () => {
    const item = payload.items[0];
    expect(item.data).toEqual({
      temperatureC: 15.2,
      humidityPercent: 90,
      pressureHpa: 1018.3,
      windDirection: 'NW',
      windSpeedMs: 1.2,
      conditions: 'slaba kiša',
    });
    expect(item.summary).toBe('slaba kiša, 15,2 °C, vlaga 90 %, vjetar NW 1,2 m/s');
  });

  it('dates the term in Zagreb local time', () => {
    // <Datum>11.09.2026</Datum><Termin>12</Termin> is 12:00 CEST = 10:00 UTC.
    expect(payload.items[0].at).toBe('2026-09-11T10:00:00.000Z');
    expect(payload.sourceUpdatedAt).toBe('2026-09-11T10:00:00.000Z');
  });

  it('returns nothing when the station is absent', () => {
    expect(parseDhmzNow('<Hrvatska><Grad><GradIme>Split</GradIme></Grad></Hrvatska>').items).toEqual([]);
  });
});

describe('parseDhmzForecast', () => {
  const payload = parseDhmzForecast(forecastXml);

  it('builds one forecast item for Zagreb with the narrative', () => {
    expect(payload.items).toHaveLength(1);
    const item = payload.items[0];
    expect(item.kind).toBe('forecast');
    expect(item.id).toBe('zagreb:2026-09-11');
    expect(item.title).toBe('Prognoza za Zagreb');
    expect(item.summary).toBe(
      'Pretežno oblačno, na širem području grada moguće je malo kiše. Vjetar slab do umjeren sjeverni i sjeveroistočni. Najviša temperatura zraka oko 19 °C.',
    );
    expect(item.geo).toEqual({ type: 'Point', coordinates: [16.03, 45.82] });
    expect(item.data).toEqual({ minC: 14, maxC: 19, weatherCode: '6', windCode: '1' });
  });

  it('covers the whole Zagreb day', () => {
    expect(payload.items[0].at).toBe('2026-09-10T22:00:00.000Z');
    expect(payload.items[0].until).toBe('2026-09-11T22:00:00.000Z');
    expect(payload.sourceUpdatedAt).toBe('2026-09-10T22:00:00.000Z');
  });

  it('returns nothing when the Zagreb station is absent', () => {
    expect(parseDhmzForecast('<VW><section name="All"></section></VW>').items).toEqual([]);
  });
});

describe('the two DHMZ fetchers', () => {
  it('read the documented endpoints', async () => {
    const askedNow: string[] = [];
    await fetchDhmzNow({
      now: () => new Date('2026-09-11T10:00:00.000Z'),
      fetch: async (url) => {
        askedNow.push(url);
        return new Response(nowXml);
      },
    });
    expect(askedNow).toEqual([DHMZ_NOW_URL]);
    expect(DHMZ_NOW_URL).toBe('https://vrijeme.hr/hrvatska1_n.xml');

    const askedForecast: string[] = [];
    await fetchDhmzForecast({
      now: () => new Date('2026-09-11T10:00:00.000Z'),
      fetch: async (url) => {
        askedForecast.push(url);
        return new Response(forecastXml);
      },
    });
    expect(askedForecast).toEqual([DHMZ_FORECAST_URL]);
    expect(DHMZ_FORECAST_URL).toBe('https://prognoza.hr/prognoza_danas.xml');
  });
});
