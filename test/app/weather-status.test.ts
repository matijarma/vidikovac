import { describe, expect, it } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { weatherStatus, weatherStatusMarkup } from '../../app/src/experience/weather-status';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';

// Weather is status, not a tile (D11): one group of glyph · temperature ·
// sunset glyph + time that the phone's sada head, the desktop status line and
// the kiosk header all build from this one module. Without a usable
// observation the group is null and the clock stands alone: never a dash.

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb; the sun sets at 19:16
const hr = createDefaultI18n('hr');
const en = createDefaultI18n('en');

const attribution = { text: 'Izvor: DHMZ', url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' };
function observation(data: Record<string, string | number | boolean>, extra: Partial<ModuleSnapshot> = {}): ModuleSnapshot {
  return {
    module: 'dhmz-now', tier: 'open', status: 'live', fetchedAt: '2026-09-11T12:31:00Z', attribution,
    items: [{ id: 'o1', module: 'dhmz-now', kind: 'observation', tier: 'open', title: 'Maksimir', at: '2026-09-11T12:00:00Z', data }],
    ...extra,
  };
}
const CLEAR = observation({ temp: 21, humidity: 54, windDir: 'SZ', windSpeed: 2, weather: 'vedro' });

describe('weatherStatus', () => {
  it('reads a live observation into glyph, condition, temperature and today’s sunset, and words the aria in that order', () => {
    expect(weatherStatus(hr, { 'dhmz-now': CLEAR }, NOW)).toEqual({
      icon: 'sun', condition: 'vedro', temp: '21 °C', sunset: '19:16', stale: false, aria: 'vedro, 21 °C, zalazak 19:16',
    });
  });
  it('keeps one decimal like the kiosk header, in the reader’s locale', () => {
    const warm = observation({ temp: 21.4, weather: 'vedro' });
    expect(weatherStatus(hr, { 'dhmz-now': warm }, NOW)?.temp).toBe('21,4 °C');
    expect(weatherStatus(en, { 'dhmz-now': warm }, NOW)).toMatchObject({ temp: '21.4 °C', aria: 'vedro, 21.4 °C, sunset 19:16' });
  });
  it('marks a stale copy and says since when, in the same word the status badge uses', () => {
    const stale = observation({ temp: 21, weather: 'vedro' }, { status: 'stale', staleSince: '2026-09-11T12:00:00Z' });
    expect(weatherStatus(hr, { 'dhmz-now': stale }, NOW)).toMatchObject({ stale: true, temp: '21 °C', aria: 'vedro, 21 °C, zalazak 19:16, zastarjelo od 14:00' });
  });
  it('is null without an observation, with a down source, or without a numeric temperature: the clock stands alone', () => {
    expect(weatherStatus(hr, {}, NOW)).toBeNull();
    expect(weatherStatus(hr, { 'dhmz-now': { ...CLEAR, status: 'down' } }, NOW)).toBeNull();
    expect(weatherStatus(hr, { 'dhmz-now': { ...CLEAR, items: [] } }, NOW)).toBeNull();
    expect(weatherStatus(hr, { 'dhmz-now': observation({ humidity: 54, weather: 'vedro' }) }, NOW)).toBeNull();
    expect(weatherStatus(hr, { 'dhmz-now': observation({ temp: 'n/a', weather: 'vedro' }) }, NOW)).toBeNull();
  });
  it('drops DHMZ’s lone dash for a missing condition: no glyph, no word, the temperature and the sun still stand', () => {
    expect(weatherStatus(hr, { 'dhmz-now': observation({ temp: 19, weather: '-' }) }, NOW)).toEqual({
      icon: null, condition: '', temp: '19 °C', sunset: '19:16', stale: false, aria: '19 °C, zalazak 19:16',
    });
  });
  it('names the sky it cannot draw: an unknown condition keeps its word and gets no glyph', () => {
    expect(weatherStatus(hr, { 'dhmz-now': observation({ temp: 19, weather: 'lahor' }) }, NOW)).toMatchObject({ icon: null, condition: 'lahor', aria: 'lahor, 19 °C, zalazak 19:16' });
  });
  it('takes the Zagreb calendar day for the sunset, not the UTC one: after a Zagreb midnight it is already the new day’s', () => {
    const afterMidnight = Date.parse('2026-09-11T22:30:00Z'); // 00:30 on 12. 9. in Zagreb
    expect(weatherStatus(hr, { 'dhmz-now': CLEAR }, afterMidnight)?.sunset).toBe('19:15');
    expect(weatherStatus(hr, { 'dhmz-now': CLEAR }, Date.parse('2026-01-15T07:05:00Z'))?.sunset).toBe('16:36');
  });
});

describe('weatherStatusMarkup', () => {
  it('is glyph · temperature · sunset glyph + time, every glyph hidden from AT because the caller carries the aria', () => {
    const status = weatherStatus(hr, { 'dhmz-now': CLEAR }, NOW)!;
    expect(weatherStatusMarkup(status)).toBe(
      '<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-sun"></use></svg>'
      + '<span class="tb-temp">21 °C</span>'
      + '<svg class="icon icon-sm tb-sun" aria-hidden="true"><use href="#icon-sunset"></use></svg>'
      + '<span>19:16</span>',
    );
  });
  it('leaves the condition glyph out when the words name no sky, and never prints the word "zalazak"', () => {
    const status = weatherStatus(hr, { 'dhmz-now': observation({ temp: 19, weather: '-' }) }, NOW)!;
    const html = weatherStatusMarkup(status);
    expect(html.startsWith('<span class="tb-temp">19 °C</span>')).toBe(true);
    expect(html).not.toContain('#icon-sun"');
    expect(html).toContain('#icon-sunset');
    expect(html).not.toContain('zalazak');
    expect(weatherStatusMarkup(weatherStatus(hr, { 'dhmz-now': CLEAR }, NOW)!)).not.toContain('zalazak');
  });
  it('escapes the texts it prints', () => {
    expect(weatherStatusMarkup({ icon: null, condition: '', temp: '<b>', sunset: '"x"', stale: false, aria: '' })).toBe(
      '<span class="tb-temp">&lt;b&gt;</span><svg class="icon icon-sm tb-sun" aria-hidden="true"><use href="#icon-sunset"></use></svg><span>&quot;x&quot;</span>',
    );
  });
});
