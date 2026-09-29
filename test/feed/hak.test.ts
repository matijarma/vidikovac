// worker/feed/modules/hak against the saved road report of HAK (U3, M7): test/fixtures/hak-stanje.html, saved on
// 29 Sep 2026 at 17:43 Zagreb time with the server's CRLF line endings; ten sections, each with its own "Ažurirano".
// The module is the relay article 8 of HAK's terms allows: a closed selection of the lines about the Zagreb area
// that say when they end, verbatim, with the section's update time and the link.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DATA_KEYS } from '../../worker/feed/schema';
import {
  HAK_URL, ZAGREB_LINE, fetchHak, fnv1a, lineEnd, lineState, lineWindow, linesOf, parseHak, placeOf, sectionsOf, streetCandidates,
} from '../../worker/feed/modules/hak';
import { U3_FIXTURE_NOW } from './fixture-contexts';

const PAGE = readFileSync(new URL('../fixtures/hak-stanje.html', import.meta.url), 'utf8');
const NOW = U3_FIXTURE_NOW;
/** 00:30 on 30 September in Zagreb, the same page: the night closure between Lučko and Donja Zdenčina (00:00 to 05:00) is on. */
const TONIGHT = new Date('2026-09-30T00:30:00+02:00');

/** A section as the page writes one, for the cases the saved page does not hold. */
function section(title: string, stamp: string, lines: string[]): string {
  return `<div data-id="x" class="content-category"><div class="sidebar2-title"><h3 style="background-image: url(x.png)">\r\n ${title}\r\n </h3></div>\r\n<h4 class="timestamp">\r\n\r\n Ažurirano\r\n\r\n <strong>${stamp}</strong>\r\n </h4>\r\n<div class="stanje-tekst report"><ul>${lines.map((line) => `<li>${line}</li>`).join('')}</ul></div></div>`;
}
const page = (...sections: string[]) => `<html><body>${sections.join('\r\n')}</body></html>`;
const at = (iso: string) => ({ at: iso, day: { year: 2026, month: 9, day: 29 } });
/** The section time 17:39 on 29 Sep in Zagreb: 15:39 UTC. */
const EVENING = at('2026-09-29T15:39:00.000Z');

describe('hak on the saved page', () => {
  it('finds the ten sections by their "Ažurirano", with the title of each and the time in Zagreb time', () => {
    expect(PAGE).toContain('\r\n');
    const sections = sectionsOf(PAGE);
    expect(sections.map((s) => s.title)).toEqual([
      'Prohodnost cesta', 'Granični prijelazi', 'Pomorski promet', 'Željeznički promet', 'Ograničenja za teretna vozila',
      'Prometna prognoza', 'Vožnja po mokrim i skliskim kolnicima', 'Savjeti za sigurnu vožnju', 'Savjeti MUP-a i HAK-a motociklistima',
      'Vožnja ljeti pod velikim vrućinama',
    ]);
    // 17:39 five... four times, 17:09 once, 17:03 five times, as the site writes them, in summer time.
    expect(sections.map((s) => s.at.slice(11, 16))).toEqual(['15:39', '15:39', '15:39', '15:39', '15:09', '15:03', '15:03', '15:03', '15:03', '15:03']);
  });

  it('keeps three lines about the Zagreb area that are on at 17:45 and end within a week, each with a point, a time and a state', () => {
    const { items, sourceUpdatedAt, coverage } = parseHak(PAGE, NOW);
    expect(items).toHaveLength(3);
    expect(items.map((item) => [item.title, item.data?.state, item.until])).toEqual([
      ['Čvor Zagreb zapad', 'privremena regulacija', '2026-10-03T22:00:00.000Z'],
      ['Čvor Lučko', 'privremena regulacija', '2026-09-30T22:00:00.000Z'],
      ['Čvor Zagreb istok', 'privremena regulacija', '2026-10-01T22:00:00.000Z'],
    ]);
    for (const item of [...items, ...parseHak(PAGE, TONIGHT).items]) {
      expect(item.kind).toBe('road');
      expect(item.id).toMatch(/^hak:[0-9a-f]{8}$/);
      expect(item.geo?.type).toBe('Point');
      expect(item.at).toBe('2026-09-29T15:39:00.000Z');
      expect(item.dateBasis).toBe('updated');
      expect(Date.parse(item.until!)).toBeGreaterThan(NOW.getTime());
      expect(item.link).toBe(HAK_URL);
      expect(item.data).toMatchObject({ source: 'hak', section: 'Prohodnost cesta' });
      expect(item.data?.district, item.id).toBeTruthy();
      for (const key of Object.keys(item.data!)) expect(DATA_KEYS.road, key).toContain(key);
    }
    expect(new Set(items.map((item) => item.id)).size).toBe(3);
    // The credit names the update the lines stand on, and the read says it is a selection.
    expect(sourceUpdatedAt).toBe('2026-09-29T15:39:00.000Z');
    expect(coverage).toEqual({ shown: 3, limited: true });
  });

  it('leaves a window that has not begun out until its start: the night closure at Lučko is not the road at 17:45', () => {
    // Both lines say 00:00 to 05:00 tonight. At 17:45 the junction is open; printed then, "Čvor Lučko: zatvoreno za promet
    // do 30. 9." would be a closure that is not there. From 00:00 the page, unchanged, says it.
    const closure = (items: ReturnType<typeof parseHak>['items']) => items.filter((item) => item.until === '2026-09-30T03:00:00.000Z');
    expect(closure(parseHak(PAGE, NOW).items)).toEqual([]);
    expect(closure(parseHak(PAGE, new Date('2026-09-29T23:59:00+02:00')).items)).toEqual([]);
    for (const at of [new Date('2026-09-30T00:00:00+02:00'), TONIGHT]) {
      const { items } = parseHak(PAGE, at);
      expect(items).toHaveLength(5);
      expect(closure(items).map((item) => [item.title, item.data?.state, item.summary!.slice(0, 26)])).toEqual([
        ['Čvor Lučko', 'zatvoreno za promet', 'od 00:00 do 05:00 sati bit'],
        ['Čvor Lučko', 'zatvoreno za promet', '30. rujna od 00:00 do 05:0'],
      ]);
    }
    // Over at 05:00.
    expect(closure(parseHak(PAGE, new Date('2026-09-30T05:00:00+02:00')).items)).toEqual([]);
    // A line with only an end is on from the section's time, as before.
    expect(parseHak(PAGE, NOW).items.map((item) => item.summary!.slice(0, 20))).toEqual(['do 3. listopada zbog', 'do 30.rujna u noćnim', 'do 01. listopada izm']);
  });

  it('puts a junction on the ZET stop of its locality, the first one the line names', () => {
    const { items } = parseHak(PAGE, NOW);
    const at = (title: string) => items.find((item) => item.title === title)!.geo!.coordinates;
    expect(at('Čvor Lučko')).toEqual([15.88405, 45.76984]);
    // "između čvorova Sveta Nedelja i Zagreb zapad": Sveta Nedelja is no junction of the list, Zagreb zapad is.
    expect(at('Čvor Zagreb zapad')).toEqual([15.88049, 45.81158]);
    expect(at('Čvor Zagreb istok')).toEqual([16.11897, 45.79782]);
    expect(placeOf('kolona od čvora Sesvete do čvora Lučko')?.title).toBe('Čvor Sesvete');
    expect(placeOf('kolona od čvora Lučko do čvora Sesvete')?.title).toBe('Čvor Lučko');
    for (const [name, title, lon, lat] of [
      ['Jankomir', 'Čvor Zagreb zapad', 15.88049, 45.81158], ['Buzin', 'Čvor Buzin', 15.99181, 45.74871],
      ['Jakuševec', 'Čvor Jakuševec', 16.01581, 45.76052], ['Ivanja Reka', 'Čvor Zagreb istok', 16.11897, 45.79782],
      ['Kosnica', 'Čvor Kosnica', 16.08648, 45.75648], ['Sesvete', 'Čvor Sesvete', 16.10951, 45.82544],
    ] as const) expect(placeOf(`čvor ${name} zatvoren`)).toMatchObject({ title, lon, lat });
  });

  it('gives the line verbatim as the summary, without a word added or cut', () => {
    const { items } = parseHak(PAGE, TONIGHT);
    const lines = sectionsOf(PAGE).flatMap((s) => linesOf(s.html));
    for (const item of items) expect(lines, item.id).toContain(item.summary);
    expect(items[0]!.summary).toBe('od 00:00 do 05:00 sati bit će zatvorena autocesta A1 između čvorova Lučko i Donja Zdenčina u oba smjera. Obilazak: čvor Lučko (A1) - DC1 - DC543 - čvor Donja Zdenčina (A1) i obratno');
    expect(items[3]!.summary).toContain('Promet iz smjera čvora Lučko u smjeru Bregane preusmjeren je na zaustavni trak. U vrijeme kada');
    // The id is the FNV-1a of the line as it stands, lower case and one space between words.
    expect(items[0]!.id).toBe(`hak:${fnv1a(items[0]!.summary!.toLocaleLowerCase('hr'))}`);
  });

  it('drops the lines the Zagreb list does not name, however soon they end: the Gospić line "u smjeru Zagreba" is not Zagreb\'s', () => {
    const lines = sectionsOf(PAGE).flatMap((s) => linesOf(s.html));
    const gospic = lines.find((line) => line.includes('Gospić') && line.includes('u smjeru Zagreba'))!;
    expect(gospic).toBeDefined();
    // It ends on 2 October, well inside the week: it is the list, not the calendar, that leaves it out.
    expect(lineEnd(gospic, sectionsOf(PAGE)[0]!)).toBe('2026-10-02T22:00:00.000Z');
    expect(ZAGREB_LINE.test(gospic)).toBe(false);
    const { items } = parseHak(PAGE, NOW);
    expect(items.some((item) => item.summary!.includes('Gospić'))).toBe(false);
    // Nor do the motorways of other regions get in: nothing but the Zagreb junctions is ever a title.
    expect(items.every((item) => item.title.startsWith('Čvor '))).toBe(true);
  });

  it('drops the Zagreb lines that name no end within a week or have not begun, and says why for each of the eleven', () => {
    const section0 = sectionsOf(PAGE)[0]!;
    const zagreb = sectionsOf(PAGE).flatMap((s) => linesOf(s.html).filter((line) => ZAGREB_LINE.test(line)).map((line) => ({ s, line })));
    expect(zagreb).toHaveLength(14);
    const kept = new Set(parseHak(PAGE, NOW).items.map((item) => item.summary));
    const dropped = zagreb.filter(({ line }) => !kept.has(line));
    expect(dropped).toHaveLength(11);
    const noEnd = dropped.filter(({ s, line }) => lineEnd(line, s) === undefined);
    // No end at all: the two "zona radova" lines, the marathon, the four lists of lorry limits and the forecast.
    expect(noEnd).toHaveLength(8);
    // The ninth ends on 31 December.
    const late = dropped.find(({ line }) => line.startsWith('do 31. prosinca'))!;
    expect(lineEnd(late.line, section0)).toBe('2026-12-31T23:00:00.000Z');
    // The tenth and eleventh are tonight's closure at Lučko, from 00:00.
    const notBegun = dropped.filter(({ s, line }) => lineWindow(line, s)?.start !== undefined);
    expect(notBegun.map(({ s, line }) => lineWindow(line, s))).toEqual([
      { start: '2026-09-29T22:00:00.000Z', end: '2026-09-30T03:00:00.000Z' },
      { start: '2026-09-29T22:00:00.000Z', end: '2026-09-30T03:00:00.000Z' },
    ]);
  });

  it('reads the state of every Zagreb line as the road is now, not as it may become', () => {
    const zagreb = sectionsOf(PAGE).flatMap((s) => linesOf(s.html).filter((line) => ZAGREB_LINE.test(line)));
    expect(zagreb.map((line) => [line.slice(0, 24), lineState(line)])).toEqual([
      ['zagrebačkoj obilaznici (', 'radovi'],
      ['autocesti A4 Goričan-Zag', 'zastoj'],
      ['od 00:00 do 05:00 sati b', 'zatvoreno za promet'],
      ['30. rujna od 00:00 do 05', 'zatvoreno za promet'],
      // "zatvoren je kolnik u smjeru Lipovca - vozi se dvosmjerno ... po dva sužena prometna traka": open, on fewer lanes.
      ['do 3. listopada zbog rad', 'privremena regulacija'],
      ['do 30.rujna u noćnim ter', 'privremena regulacija'],
      ['do 31. prosinca zbog pro', 'privremena regulacija'],
      // "vozi se jednim trakom ... očekuje se stvaranje kolona vozila": one lane now, a queue only expected.
      ['do 01. listopada između ', 'privremena regulacija'],
      ['Privremeno zatvaranje pr', 'radovi'],
      ['A1 Zagreb (čvorište Lučk', 'radovi'],
      ['A2 G.P. Macelj (granica ', 'radovi'],
      ['A4 G.P. Goričan (granica', 'radovi'],
      ['A11 Zagreb (čvorište Jak', 'radovi'],
      // The forecast: "Gužve i zastoji očekuju se".
      ['Gužve i zastoji očekuju ', 'radovi'],
    ]);
  });

  it('reads the same page whatever its line endings', () => {
    expect(parseHak(PAGE.replace(/\r\n/g, '\n'), NOW)).toEqual(parseHak(PAGE, NOW));
  });

  it('asks for the one page', async () => {
    const requested: string[] = [];
    const payload = await fetchHak({ now: () => NOW, fetch: async (url) => (requested.push(url), new Response(PAGE)) });
    expect(requested).toEqual(['https://www.hak.hr/info/stanje-na-cestama/']);
    expect(payload.items).toHaveLength(3);
  });
});

describe('what counts as a line about Zagreb', () => {
  it.each([
    'zagrebačkoj obilaznici (A3) između čvorova', 'čvor Lučko', 'kod čvora Jankomir', 'čvorovi Zagreb zapad i Zagreb istok', 'čvor Ivanja Reka',
    'čvor Buzin', 'Jakuševec', 'čvor Kosnica', 'zaobilazak Sesvete', 'na cestama u Zagrebu', 'u smjeru Grada Zagreba', 'do Grada Zagreb', '34. Zagrebački Powerade maraton',
  ])('%s is', (line) => {
    expect(ZAGREB_LINE.test(line)).toBe(true);
  });
  it.each([
    'u smjeru Zagreba', 'A3 Bregana-Zagreb-Lipovac', 'A1 Zagreb-Split-Dubrovnik', 'autocesta Zagreb-Macelj', 'DC1 Macelj-Zagreb-Karlovac', 'Zagrebačka ulica, Čakovec',
  ])('%s is not', (line) => {
    expect(ZAGREB_LINE.test(line)).toBe(false);
  });
});

describe('when a line ends', () => {
  it('reads "do D. mjeseca" as the end of that day, with or without a space, and rolls into the next year', () => {
    expect(lineEnd('do 3. listopada zbog radova', EVENING)).toBe('2026-10-03T22:00:00.000Z');
    expect(lineEnd('do 30.rujna u noćnim terminima od 21:00 h do 05:00 h', EVENING)).toBe('2026-09-30T22:00:00.000Z');
    expect(lineEnd('do 01. listopada između 96.+100 km', EVENING)).toBe('2026-10-01T22:00:00.000Z');
    expect(lineEnd('do 8. studenoga vozi se', EVENING)).toBe('2026-11-08T23:00:00.000Z');
    expect(lineEnd('do 8. studenog vozi se', EVENING)).toBe('2026-11-08T23:00:00.000Z');
    const december = { at: '2026-12-30T15:00:00.000Z', day: { year: 2026, month: 12, day: 30 } };
    expect(lineEnd('do 2. siječnja radovi', december)).toBe('2027-01-02T23:00:00.000Z');
    // A kilometre mark is not a date.
    expect(lineEnd('zatvoren kolnik (od 12. km + 480 do 15. km + 300)', EVENING)).toBeUndefined();
  });

  it('reads "D. mjeseca od H:MM do H:MM" as that day\'s window', () => {
    expect(lineEnd('30. rujna od 00:00 do 05:00 sati bit će zatvorena dionica', EVENING)).toBe('2026-09-30T03:00:00.000Z');
    expect(lineEnd('1. listopada od 22:00 do 02:00 sati', EVENING)).toBe('2026-10-02T00:00:00.000Z');
  });

  it('reads "od H:MM do H:MM" as the window that is on now or the next one', () => {
    // 17:39: tonight's window from 00:00 is tomorrow's.
    expect(lineEnd('od 00:00 do 05:00 sati bit će zatvorena', EVENING)).toBe('2026-09-30T03:00:00.000Z');
    // A window that is on now ends today.
    expect(lineEnd('od 08:00 do 20:00 sati radovi', EVENING)).toBe('2026-09-29T18:00:00.000Z');
    // One that starts tonight and crosses midnight ends tomorrow.
    expect(lineEnd('od 22:00 do 05:00 sati radovi', EVENING)).toBe('2026-09-30T03:00:00.000Z');
    expect(lineEnd('od 21:00 h do 05:00 h radovi', EVENING)).toBe('2026-09-30T03:00:00.000Z');
    // At 03:00 the night window that began yesterday evening is still on.
    expect(lineEnd('od 20:00 do 05:00 sati radovi', at('2026-09-29T01:00:00.000Z'))).toBe('2026-09-29T03:00:00.000Z');
  });

  it('reads "do H:MM" as the next such instant after the section time', () => {
    expect(lineEnd('radovi do 22:00', EVENING)).toBe('2026-09-29T20:00:00.000Z');
    expect(lineEnd('radovi do 16:00', EVENING)).toBe('2026-09-30T14:00:00.000Z');
    expect(lineEnd('radovi do 22:00 sati', at('2026-09-29T20:00:00.000Z'))).toBe('2026-09-30T20:00:00.000Z');
  });

  it('names the start of a window, and none for a line with only an end', () => {
    expect(lineWindow('od 00:00 do 05:00 sati bit će zatvorena', EVENING)).toEqual({ start: '2026-09-29T22:00:00.000Z', end: '2026-09-30T03:00:00.000Z' });
    expect(lineWindow('od 08:00 do 20:00 sati radovi', EVENING)).toEqual({ start: '2026-09-29T06:00:00.000Z', end: '2026-09-29T18:00:00.000Z' });
    expect(lineWindow('1. listopada od 22:00 do 02:00 sati', EVENING)).toEqual({ start: '2026-10-01T20:00:00.000Z', end: '2026-10-02T00:00:00.000Z' });
    expect(lineWindow('do 3. listopada zbog radova', EVENING)).toEqual({ end: '2026-10-03T22:00:00.000Z' });
    expect(lineWindow('radovi do 22:00', EVENING)).toEqual({ end: '2026-09-29T20:00:00.000Z' });
    expect(lineWindow('vozi se jednim trakom', EVENING)).toBeUndefined();
  });

  it('has no end for a line that names none', () => {
    expect(lineEnd('vozi se jednim trakom uz ograničenje brzine', EVENING)).toBeUndefined();
    expect(lineEnd('očekuju se gužve u zonama radova', EVENING)).toBeUndefined();
  });
});

describe('the state of a line', () => {
  it.each([
    ['bit će zatvorena autocesta A1', 'zatvoreno za promet'],
    ['zatvoren je kolnik, moguće je stvaranje zastoja', 'zatvoreno za promet'],
    ['zatvorena je cesta, očekuju se gužve', 'zatvoreno za promet'],
    ['zatvorena je Ulica grada Vukovara, promet je preusmjeren', 'zatvoreno za promet'],
    ['zatvoren je kolnik u smjeru Lipovca - vozi se dvosmjerno, kolnikom u smjeru Bregane', 'privremena regulacija'],
    ['zatvoren je kolnik, po dva sužena prometna traka u oba smjera', 'privremena regulacija'],
    ['u kolonama uz kraće zastoje', 'zastoj'],
    ['kolona je oko 1 km', 'zastoj'],
    ['očekuju se gužve', 'radovi'],
    ['Gužve i zastoji očekuju se na gradskim prometnicama', 'radovi'],
    ['zbog opterećenja autoceste očekuje se stvaranje kolona vozila u zonama radova', 'radovi'],
    ['radovi na kolniku, moguće je stvaranje zastoja i kolona', 'radovi'],
    ['vozi se jednim trakom', 'privremena regulacija'],
    ['prometuje se jednim prometnim trakom', 'privremena regulacija'],
    ['u smjeru Lipovca po jednom traku', 'privremena regulacija'],
    ['promet je preusmjeren', 'privremena regulacija'],
    ['po dva sužena prometna traka', 'privremena regulacija'],
    ['zbog privremene regulacije prometa', 'privremena regulacija'],
    ['radovi na uklanjanju ograde', 'radovi'],
  ] as const)('%s is %s', (line, state) => {
    expect(lineState(line)).toBe(state);
  });
});

describe('a line without a junction', () => {
  it('is placed on the street of the index it names, or dropped', () => {
    const lines = [
      'do 5. listopada zatvorena je Ulica grada Vukovara u Zagrebu zbog radova',
      'do 5. listopada zbog radova u Zagrebu zatvoreno je Nepostojeće šetalište kod parka',
      'do 5. listopada promet u Zagrebu preusmjeren je Aleja Seljačke bune',
    ];
    const { items } = parseHak(page(section('Ostali događaji', '29.9.2026. 17:39', lines)), NOW);
    expect(items.map((item) => [item.title, item.data?.street, item.data?.state])).toEqual([
      ['Ulica grada Vukovara', 'Ulica grada Vukovara', 'zatvoreno za promet'],
    ]);
    expect(items[0]!.data?.district).toBe('trnje');
    expect(items[0]!.geo?.type).toBe('Point');
    expect(streetCandidates('zatvorena je Ulica grada Vukovara u Zagrebu')[0]).toBe('Ulica grada Vukovara u Zagrebu');
    expect(streetCandidates('zatvorena je Savska cesta u Zagrebu')).toContain('Savska cesta');
    expect(placeOf('nema ničega o cesti')).toBeUndefined();
  });
});

describe('the page as a whole', () => {
  it('keeps a line once, whichever section repeats it, and names the oldest update a shown line stands on', () => {
    const line = 'do 2. listopada zatvoren je čvor Buzin zbog radova';
    const twice = page(
      section('Prohodnost cesta', '29.9.2026. 17:39', [line, 'do 3. listopada čvor Lučko zatvoren']),
      section('Ostali događaji', '29.9.2026. 17:03', [line]),
    );
    const { items, sourceUpdatedAt } = parseHak(twice, NOW);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.at)).toEqual(['2026-09-29T15:39:00.000Z', '2026-09-29T15:39:00.000Z']);
    const older = page(section('Ostali događaji', '29.9.2026. 17:03', [line]), section('Prohodnost cesta', '29.9.2026. 17:39', ['do 3. listopada čvor Lučko zatvoren']));
    expect(parseHak(older, NOW).sourceUpdatedAt).toBe('2026-09-29T15:03:00.000Z');
    expect(sourceUpdatedAt).toBe('2026-09-29T15:39:00.000Z');
  });

  it('drops a line whose end has passed and one that ends beyond the week', () => {
    const lines = ['do 28. rujna zatvoren čvor Lučko', 'do 5. listopada zatvoren čvor Sesvete', 'do 6. listopada zatvoren čvor Buzin', 'do 7. listopada zatvoren čvor Kosnica'];
    const { items } = parseHak(page(section('Prohodnost cesta', '29.9.2026. 17:39', lines)), NOW);
    // 29 September 17:45 plus seven days is 6 October 17:45 in Zagreb: the end of the 5th (6 Oct 00:00) is in, the end of the
    // 6th (7 Oct 00:00) is out, and the 28th, over before the page was read, is out.
    expect(items.map((item) => item.title)).toEqual(['Čvor Sesvete']);
    expect(items.map((item) => item.until)).toEqual(['2026-10-05T22:00:00.000Z']);
  });

  it('is a page with no lines about Zagreb, not an error, when there are none; and an error when it is not the report', () => {
    const quiet = parseHak(page(section('Prohodnost cesta', '29.9.2026. 17:39', ['A1: radovi do 3. listopada'])), NOW);
    expect(quiet.items).toEqual([]);
    expect(quiet.sourceUpdatedAt).toBe('2026-09-29T15:39:00.000Z');
    expect(() => parseHak('<html><body>Stranica nije pronađena</body></html>', NOW)).toThrow(/no "Ažurirano" section/);
  });
});
