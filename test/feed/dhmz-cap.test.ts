import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAP_SEVERITY, CAP_URL, ZAGREB_EMMA_ID, fetchDhmzCap, parseDhmzCap } from '../../worker/feed/modules/dhmz-cap';

const xml = readFileSync(new URL('../fixtures/cap_hr_today.xml', import.meta.url), 'utf8');

describe('parseDhmzCap', () => {
  const payload = parseDhmzCap(xml);

  it('keeps only the Zagreb region blocks, one item per language', () => {
    expect(ZAGREB_EMMA_ID).toBe('HR002');
    expect(payload.items).toHaveLength(2);
    expect(payload.items.map((item) => item.id)).toEqual([
      '2.49.0.0.191.0.HR.260911082407.LDZM:hr:Žuto upozorenje za grmljavinsku oluju@2026-09-11T00:00:00+02:00',
      '2.49.0.0.191.0.HR.260911082407.LDZM:en:Yellow thunderstorm warning@2026-09-11T00:00:00+02:00',
    ]);
    expect(payload.items.every((item) => item.kind === 'warning')).toBe(true);
  });

  it('reads the Croatian block whole', () => {
    const hr = payload.items[0];
    expect(hr.title).toBe('Žuto upozorenje za grmljavinsku oluju');
    expect(hr.severity).toBe('moderate');
    expect(hr.at).toBe('2026-09-10T22:00:00.000Z'); // onset 2026-09-11T00:00+02:00
    expect(hr.until).toBe('2026-09-11T06:00:00.000Z'); // expires 2026-09-11T08:00+02:00
    expect(hr.summary).toContain('Lokalno obilniji pljuskovi');
    expect(hr.summary).toContain('BUDITE NA OPREZU');
    expect(hr.summary).not.toMatch(/\s{2,}/);
    expect(hr.data).toEqual({ language: 'hr', area: 'Zagrebačka regija', emmaId: 'HR002' });
  });

  it('publishes the alert timestamp as the source update time', () => {
    expect(payload.sourceUpdatedAt).toBe('2026-09-11T06:24:07.000Z');
  });

  it('maps every CAP severity word and falls back to info', () => {
    expect(CAP_SEVERITY).toEqual({ Minor: 'minor', Moderate: 'moderate', Severe: 'severe', Extreme: 'extreme' });
    const minimal = parseDhmzCap(
      `<alert><identifier>X</identifier><info><language>hr</language><event>Test</event>` +
        `<severity>Unknown</severity><area><areaDesc>Zagrebačka regija</areaDesc></area></info></alert>`,
    );
    expect(minimal.items[0].severity).toBe('info');
    expect(minimal.items[0].at).toBeUndefined();
    expect(minimal.items[0].data).toEqual({ language: 'hr', area: 'Zagrebačka regija' });
  });

  it('yields nothing when no block names Zagreb', () => {
    const other = parseDhmzCap(
      `<alert><identifier>Y</identifier><info><language>hr</language><event>Test</event>` +
        `<severity>Severe</severity><area><areaDesc>Osječka regija</areaDesc>` +
        `<geocode><valueName>EMMA_ID</valueName><value>HR005</value></geocode></area></info></alert>`,
    );
    expect(other.items).toEqual([]);
  });

  it('gives distinct ids to two concurrently active warning types both naming Zagreb', () => {
    // Same document identifier, same language, same region — only the hazard
    // (event/onset) differs, exactly the real shape DHMZ can publish (this
    // fixture already carries a thunderstorm warning and a rain warning as
    // separate <info> blocks, just not both for Zagreb in this instance).
    const both = parseDhmzCap(
      `<alert><identifier>Z</identifier>` +
        `<info><language>hr</language><event>Grmljavinska oluja</event><onset>2026-09-11T00:00:00+02:00</onset>` +
        `<severity>Moderate</severity><area><areaDesc>Zagrebačka regija</areaDesc>` +
        `<geocode><valueName>EMMA_ID</valueName><value>HR002</value></geocode></area></info>` +
        `<info><language>hr</language><event>Kiša</event><onset>2026-09-11T00:00:00+02:00</onset>` +
        `<severity>Moderate</severity><area><areaDesc>Zagrebačka regija</areaDesc>` +
        `<geocode><valueName>EMMA_ID</valueName><value>HR002</value></geocode></area></info></alert>`,
    );
    expect(both.items).toHaveLength(2);
    const ids = both.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual(['Z:hr:Grmljavinska oluja@2026-09-11T00:00:00+02:00', 'Z:hr:Kiša@2026-09-11T00:00:00+02:00']);
  });

  it('still yields unique ids when even event and onset coincide', () => {
    const identical = parseDhmzCap(
      `<alert><identifier>Z</identifier>` +
        `<info><language>hr</language><event>Grmljavinska oluja</event><onset>2026-09-11T00:00:00+02:00</onset>` +
        `<severity>Moderate</severity><area><areaDesc>Zagrebačka regija</areaDesc></area></info>` +
        `<info><language>hr</language><event>Grmljavinska oluja</event><onset>2026-09-11T00:00:00+02:00</onset>` +
        `<severity>Severe</severity><area><areaDesc>Zagrebačka regija</areaDesc></area></info></alert>`,
    );
    expect(identical.items).toHaveLength(2);
    const ids = identical.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toEqual([
      'Z:hr:Grmljavinska oluja@2026-09-11T00:00:00+02:00',
      'Z:hr:Grmljavinska oluja@2026-09-11T00:00:00+02:00#2',
    ]);
  });
});

describe('fetchDhmzCap', () => {
  it('asks DHMZ for today CAP file through the injected context', async () => {
    const asked: string[] = [];
    const payload = await fetchDhmzCap({
      now: () => new Date('2026-09-11T10:00:00.000Z'),
      fetch: async (url) => {
        asked.push(url);
        return new Response(xml);
      },
    });
    expect(asked).toEqual([CAP_URL]);
    expect(CAP_URL).toBe('https://meteo.hr/upozorenja/cap_hr_today.xml');
    expect(payload.items).toHaveLength(2);
  });
});
