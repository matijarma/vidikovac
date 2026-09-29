// worker/feed/modules/dhmz-hourly.ts against the saved cut of DHMZ's hourly document (U3, M5):
// test/fixtures/dhmz-7d.xml (the head and the two Zagreb blocks of the 6.9 MB response of 29 Sep 2026; dry) and
// test/fixtures/dhmz-7d-rain.xml (the same with two Zagreb-Grič steps made wet, see test/fixtures/README-u3.md).
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_KEYS } from '../../worker/feed/schema';
import { parseXml } from '../../worker/feed/xml';
import {
  DHMZ_HOURLY_URL, HEAVY_RAIN_MM, RAIN_MM, fetchDhmzHourly, parseDhmzHourly, rainWord, updatedAt,
} from '../../worker/feed/modules/dhmz-hourly';
import { U3_FIXTURE_NOW } from './fixture-contexts';

// The parser is wrapped, not replaced, so a test can see what the module gave it.
vi.mock('../../worker/feed/xml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../worker/feed/xml')>();
  return { ...actual, parseXml: vi.fn(actual.parseXml) };
});

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const DRY = fixture('dhmz-7d.xml');
const RAIN = fixture('dhmz-7d-rain.xml');

beforeEach(() => {
  vi.mocked(parseXml).mockClear();
});

describe('dhmz-hourly on the saved cut', () => {
  it('gives 84 hourly steps for each of the two Zagreb points, in order of time', () => {
    const { items, sourceUpdatedAt } = parseDhmzHourly(DRY);
    expect(items).toHaveLength(168);
    const gric = items.filter((item) => item.data?.station === 'gric');
    const maksimir = items.filter((item) => item.data?.station === 'maksimir');
    expect(gric).toHaveLength(84);
    expect(maksimir).toHaveLength(84);
    for (const station of [gric, maksimir]) {
      const times = station.map((item) => Date.parse(item.at!));
      expect(times).toEqual([...times].sort((a, b) => a - b));
      // Hourly: every step ends where the next begins, an hour on.
      station.forEach((item, i) => {
        expect(Date.parse(item.until!) - Date.parse(item.at!)).toBe(3_600_000);
        if (station[i + 1]) expect(item.until).toBe(station[i + 1]!.at);
      });
    }
    // Leadtime 1 of the 06 run is sat 09 local: 07:00 UTC in summer time. The last hourly step is 84 hours on.
    expect(gric[0]).toMatchObject({
      id: 'dhmz-hourly:gric:2026-09-29T07:00:00.000Z', kind: 'forecast', title: 'Zagreb-Grič',
      at: '2026-09-29T07:00:00.000Z', until: '2026-09-29T08:00:00.000Z',
      geo: { type: 'Point', coordinates: [15.97, 45.81] },
      data: { station: 'gric', temp: 13.4, precip: 0, prob: 0 },
    });
    expect(gric.at(-1)!.at).toBe('2026-10-02T18:00:00.000Z');
    expect(maksimir[0]).toMatchObject({ title: 'Zagreb-Maksimir', geo: { coordinates: [16.034, 45.822] }, data: { station: 'maksimir', temp: 12.8 } });
    // The document's own "Zadnja izmjena 29.09.2026. u 11:22." in Zagreb time.
    expect(sourceUpdatedAt).toBe('2026-09-29T09:22:00.000Z');
    expect(updatedAt('<izmjena run="06">Zadnja izmjena 1.10.2026. u 7:05.</izmjena>')).toBe('2026-10-01T05:05:00.000Z');
    expect(updatedAt('nema')).toBeUndefined();
  });

  it('uses only the vocabulary the schema declares, and the dry cut has no wet step', () => {
    const { items } = parseDhmzHourly(DRY);
    for (const item of items) {
      for (const key of Object.keys(item.data!)) expect(DATA_KEYS.forecast, key).toContain(key);
      expect(item.data?.weather, item.id).toBeUndefined();
    }
    expect(new Set(items.map((item) => item.id)).size).toBe(168);
  });

  it('parses only the two station blocks: a document full of other stations is never parsed', () => {
    const junk = `\t<grad ime="ZAGREB-BLIZU" code="X">\n${'\t\t<dan datum="oštećeno" <<<\n'.repeat(40_000)}\t</grad>\n`;
    const bloated = DRY.replace('</sedamdana>', `${junk}</sedamdana>`).replace('\t<grad ime="ZAGREB-GRIČ"', `${junk}\t<grad ime="ZAGREB-GRIČ"`);
    expect(bloated.length).toBeGreaterThan(2_000_000);
    expect(parseDhmzHourly(bloated)).toEqual(parseDhmzHourly(DRY));
    const given = vi.mocked(parseXml).mock.calls.map(([xml]) => xml);
    // Two calls for the bloated document, two for the dry one: each is one block, a few tens of kilobytes.
    expect(given).toHaveLength(4);
    for (const xml of given) {
      expect(xml.length).toBeLessThan(30_000);
      expect(xml).toMatch(/^\t<grad ime="ZAGREB-(?:GRIČ|MAKSIMIR)"[\s\S]*<\/grad>$/);
      expect(xml).not.toContain('oštećeno');
    }
  });

  it('asks for the document once and nothing else', async () => {
    const requested: string[] = [];
    const payload = await fetchDhmzHourly({
      now: () => U3_FIXTURE_NOW,
      fetch: async (url) => {
        requested.push(url);
        return new Response(DRY);
      },
    });
    expect(requested).toEqual([DHMZ_HOURLY_URL]);
    expect(DHMZ_HOURLY_URL).toBe('https://meteo.hr/7d_graf_i_simboli.xml');
    expect(payload.items).toHaveLength(168);
  });

  it('refuses a document without the Zagreb blocks or with an empty one', () => {
    expect(() => parseDhmzHourly('<html><body>Održavanje</body></html>')).toThrow(/no block for Zagreb-Grič/);
    expect(() => parseDhmzHourly(DRY.replace('ZAGREB-MAKSIMIR', 'ZAGREB-MAKSIMIR-X'))).toThrow(/no block for Zagreb-Maksimir/);
    const noSteps = DRY.replace(/<dan [\s\S]*?<\/dan>\s*/g, '');
    expect(() => parseDhmzHourly(noSteps)).toThrow(/no hourly steps/);
  });
});

describe('the rain rules, on the doctored copy', () => {
  it('marks the two wet Grič steps by their amounts, and no other step', () => {
    const { items } = parseDhmzHourly(RAIN);
    const wet = items.filter((item) => item.data?.weather !== undefined);
    expect(wet.map((item) => [item.id, item.data])).toEqual([
      ['dhmz-hourly:gric:2026-09-29T11:00:00.000Z', { station: 'gric', temp: 21.9, precip: 0.6, prob: 70, weather: 'slaba kiša' }],
      ['dhmz-hourly:gric:2026-09-29T12:00:00.000Z', { station: 'gric', temp: 23.2, precip: 2.4, prob: 90, weather: 'kiša' }],
    ]);
    // Maksimir is untouched, and so is the step beside the wet ones.
    expect(items.filter((item) => item.data?.station === 'maksimir').every((item) => item.data?.weather === undefined)).toBe(true);
    const beside = items.find((item) => item.id === 'dhmz-hourly:gric:2026-09-29T13:00:00.000Z')!;
    expect(beside.data).toEqual({ station: 'gric', temp: 24.2, precip: 0, prob: 0 });
    // A leading comment says the copy is doctored, and the module reads past it.
    expect(RAIN.split('\n')[1]).toMatch(/^<!-- Doctored copy of dhmz-7d\.xml/);
  });

  it('calls a step wet from 0.2 mm or a probability of 60 %, and words the rain from the amount', () => {
    const step = (precip: string, prob: string, temp = '12.0') => DRY.replace(
      /(<dan datum="29\.09\.2026\." dtj="Utorak" sat="09" leadtime="1">\s*<t_2m>)13\.4(<\/t_2m>[\s\S]*?<oborina>)0\.0(<\/oborina>\s*<vjerojatnost>)0(<\/vjerojatnost>)/,
      `$1${temp}$2${precip}$3${prob}$4`,
    );
    const first = (xml: string) => parseDhmzHourly(xml).items[0]!.data;
    expect(first(step('0.1', '59'))?.weather).toBeUndefined();
    expect(first(step('0.2', '10'))?.weather).toBe('slaba kiša');
    expect(first(step('0.0', '60'))?.weather).toBe('slaba kiša');
    expect(first(step('0.9', '10'))?.weather).toBe('slaba kiša');
    expect(first(step('1.0', '10'))?.weather).toBe('kiša');
    expect(first(step('3.9', '90'))?.weather).toBe('kiša');
    expect(first(step('4.0', '90'))?.weather).toBe('jaka kiša');
    expect(first(step('12.5', '100'))?.weather).toBe('jaka kiša');
    // Near freezing a rain word may be false: the numbers stay, the word goes.
    expect(first(step('2.4', '90', '1.0'))).toEqual({ station: 'gric', temp: 1, precip: 2.4, prob: 90 });
    expect(first(step('2.4', '90', '-3.2'))?.weather).toBeUndefined();
    expect(first(step('2.4', '90', '1.1'))?.weather).toBe('kiša');
    expect([rainWord(RAIN_MM - 0.01, 10), rainWord(RAIN_MM, 10), rainWord(HEAVY_RAIN_MM - 0.01, 10), rainWord(HEAVY_RAIN_MM, 10)]).toEqual(['slaba kiša', 'kiša', 'kiša', 'jaka kiša']);
  });

  it('drops the steps past the hourly ones and keeps the hours right on the night the clocks go back', () => {
    // The last Zagreb-Grič step made a 3-hourly one (lead time 87): 83 hourly steps are left for that point.
    const late = DRY.replace('leadtime="84"', 'leadtime="87"');
    expect(parseDhmzHourly(late).items).toHaveLength(167);
    const night = `<sedamdana><izmjena run="00">Zadnja izmjena 24.10.2026. u 05:10.</izmjena>
\t<grad ime="ZAGREB-GRIČ" code="ZAGREB-GRIČ">
${[['01', 1], ['02', 2], ['02', 3], ['03', 4]].map(([sat, lead]) =>
    `\t\t<dan datum="25.10.2026." dtj="Nedjelja" sat="${sat}" leadtime="${lead}"><t_2m>9.0</t_2m><simbol>1</simbol><vjetar>C0</vjetar><oborina>0.0</oborina><vjerojatnost>0</vjerojatnost></dan>`).join('\n')}
\t</grad>
\t<grad ime="ZAGREB-MAKSIMIR" code="ZAGREB-MAKSIMIR">
\t\t<dan datum="25.10.2026." dtj="Nedjelja" sat="01" leadtime="1"><t_2m>8.0</t_2m><simbol>1</simbol><vjetar>C0</vjetar><oborina>0.0</oborina><vjerojatnost>0</vjerojatnost></dan>
\t</grad>
</sedamdana>`;
    const gric = parseDhmzHourly(night).items.filter((item) => item.data?.station === 'gric');
    // 02:00 twice is 00:00 and 01:00 UTC; 03:00 is 02:00 UTC. Every hour of the night, once.
    expect(gric.map((item) => item.at)).toEqual(['2026-10-24T23:00:00.000Z', '2026-10-25T00:00:00.000Z', '2026-10-25T01:00:00.000Z', '2026-10-25T02:00:00.000Z']);
    expect(new Set(gric.map((item) => item.id)).size).toBe(4);
  });
});
