import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { firstSentence, parseBio } from '../../worker/feed/modules/dhmz-bio';

const SAVED = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'bio_novo.xml'), 'utf8');

const DAY_2 = 'U cijeloj će zemlji biometeorološke prilike i dalje biti povoljne. Boravak na otvorenom uz ugodne temperature zraka može povoljno djelovati na opće stanje meteoropata i kroničnih bolesnika, no tijekom svježijeg jutra, uz mogućnost lokalne magle, potrebna je dodatna zaštita i primjereno odijevanje.';
const DAY_3 = 'Stabilne vremenske prilike povoljno će djelovati na većinu ljudi pa ni meteoropati neće imati dodatnih tegoba sa zdravljem. Preporučuje se slojevito odijevanje, tijekom dana lagane aktivnosti na otvorenom, a ujutro za srčane i plućne bolesnike te astmatičare dodatna zaštita od hladnog zraka.';

const stations = (level: string) => ['istocna', 'sredisnja', 'gorska', 'sjevernijadran', 'juznijadran']
  .map((name) => `<station name="${name}">${level}</station>`).join('\n');

/**
 * The file of 30 September (R3 §0.5 P3), inline. Its forecast run (29.09 09:34) is the one the saved file of 1 October
 * still carries, so its second and third days are the saved file's texts; of the first day only the first sentence was
 * recorded on 30 September, and the copy holds just that sentence.
 */
const SEP_30 = `<?xml version="1.0" encoding="UTF-8"?>
<Bioprognoza>
<Prognozirano>29.09.2026 u 09:34</Prognozirano>
<Podaci><Datum>30.09.2026</Datum><Tekst>Nastavlja se razdoblje povoljnih biometeoroloških prilika.</Tekst>${stations('3')}</Podaci>
<Podaci><Datum>01.10.2026</Datum><Tekst>${DAY_2}</Tekst>${stations('3')}</Podaci>
<Podaci><Datum>02.10.2026</Datum><Tekst>${DAY_3}</Tekst>${stations('3')}</Podaci>
</Bioprognoza>`;

describe('dhmz-bio', () => {
  it('reads the file of 30 September into three days, DHMZ first sentence as the text', () => {
    const payload = parseBio(SEP_30, new Date('2026-09-30T08:00:00Z'));
    expect(payload.sourceUpdatedAt).toBe('2026-09-29T07:34:00.000Z');
    expect(payload.items.map((item) => item.id)).toEqual(['dhmz-bio:2026-09-30', 'dhmz-bio:2026-10-01', 'dhmz-bio:2026-10-02']);
    const [first, second, third] = payload.items;
    expect(first!.data).toEqual({ region: 'sredisnja', level: 3, text: 'Nastavlja se razdoblje povoljnih biometeoroloških prilika.' });
    expect(first!.at).toBe('2026-09-29T22:00:00.000Z');
    expect(first!.until).toBe('2026-09-30T22:00:00.000Z');
    expect(first!.kind).toBe('forecast');
    expect(first!.title).toBe('Biometeorološka prognoza');
    expect(first!.geo).toEqual({ type: 'Point', coordinates: [15.97, 45.81] });
    expect(second!.data!.text).toBe('U cijeloj će zemlji biometeorološke prilike i dalje biti povoljne.');
    // The third day's first sentence is 123 characters, over 120: the item keeps its level and its summary.
    expect(firstSentence(DAY_3)!.length).toBe(123);
    expect(third!.data).toEqual({ region: 'sredisnja', level: 3 });
    expect(third!.summary).toBe(DAY_3);
  });

  it('drops the days before today', () => {
    expect(parseBio(SEP_30, new Date('2026-10-01T10:00:00Z')).items.map((item) => item.id)).toEqual(['dhmz-bio:2026-10-01', 'dhmz-bio:2026-10-02']);
  });

  it('does not normalize an impossible source date or forecast clock into another instant', () => {
    const xml = SEP_30.replace('30.09.2026</Datum>', '31.09.2026</Datum>')
      .replace('29.09.2026 u 09:34', '29.09.2026 u 25:75');
    const payload = parseBio(xml, new Date('2026-09-30T08:00:00Z'));
    expect(payload.items.map(item => item.id)).toEqual(['dhmz-bio:2026-10-01', 'dhmz-bio:2026-10-02']);
    expect(payload.sourceUpdatedAt).toBeUndefined();
  });

  it('reads the saved file of 1 October', () => {
    const payload = parseBio(SAVED, new Date('2026-10-01T02:10:00Z'));
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0]!.data).toEqual({ region: 'sredisnja', level: 3, text: 'U cijeloj će zemlji biometeorološke prilike i dalje biti povoljne.' });
  });

  it('drops a day without a readable central number, and throws on a foreign document', () => {
    const broken = SEP_30.replace('<station name="sredisnja">3</station>', '<station name="sredisnja">-</station>');
    expect(parseBio(broken, new Date('2026-09-30T08:00:00Z')).items.map((item) => item.id)).toEqual(['dhmz-bio:2026-10-01', 'dhmz-bio:2026-10-02']);
    expect(() => parseBio('<?xml version="1.0"?><TriVis><section/></TriVis>', new Date())).toThrow(/Podaci/);
  });
});
