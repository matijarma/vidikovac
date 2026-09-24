// The copy rules of the overhaul, checked against the files that carry copy:
// the two catalogues, the two no-JS worker pages, every static HTML entry,
// the worker's string literals, and the delay words that stand beside a
// `.line` badge. Canonical sentences live under `shared.*`; the dashboard
// keys that say the same thing are pinned equal to them so they cannot drift.
// The phone's renderers vet third-party text through the boundary, which refuses everything until the policy is installed: load it here as the page's chunks do.
import '../../shared/kiosk/external-text';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import type { ArrivalRow } from '../../shared/city/arrivals';
import { stopDetailMarkup } from '../../app/src/transport/view';
import * as sentenceModule from '../../app/src/city/sentence';
import { acceptSentence } from '../../shared/kiosk/sentence';
import { fill, kioskStrings } from '../../app/src/kiosk/strings';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

type Catalogue = Record<string, unknown>;
const HR = hr as unknown as Catalogue;
const EN = en as unknown as Catalogue;

function leaf(catalogue: Catalogue, key: string): string | undefined {
  const node = key.split('.').reduce<unknown>((acc, part) => (acc && typeof acc === 'object' ? (acc as Catalogue)[part] : undefined), catalogue);
  return typeof node === 'string' ? node : undefined;
}
function leafKeys(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  if (node && typeof node === 'object') return Object.entries(node as Catalogue).flatMap(([k, v]) => leafKeys(v, prefix ? `${prefix}.${k}` : k));
  return [];
}

// The static entries Vite serves: the HTML files directly under app/ and every app/<dir>/index.html
// (app/dist is the build's output, not a source).
function staticHtml(): string[] {
  const out = readdirSync(join(ROOT, 'app')).filter((name) => name.endsWith('.html')).map((name) => `app/${name}`);
  for (const dir of readdirSync(join(ROOT, 'app'))) {
    if (dir === 'dist') continue;
    if (statSync(join(ROOT, 'app', dir)).isDirectory() && readdirSync(join(ROOT, 'app', dir)).includes('index.html')) out.push(`app/${dir}/index.html`);
  }
  return out.sort();
}
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (name.endsWith('.ts')) out.push(rel);
  }
  return out;
}
/** Every quoted string and template literal in a TypeScript source, comments left out. */
function literals(source: string): string[] {
  return source.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
}

const PUNCTUATION_FILES = ['app/src/i18n/hr.json', 'app/src/i18n/en.json', 'worker/hitno/render.ts', 'worker/open/index-page.ts', ...staticHtml()];
// Word boundaries that know Croatian letters: JavaScript's \b is ASCII-only, so "Više" would read as "Vi" + "še".
const VI = /(?<![\p{L}\p{N}_])(?:Vi|Vam)(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])Vaš|Skenirajte|Kopirajte|Podijelite|Plaćate/u;

describe('punctuation: no em dash and no double hyphen in copy', () => {
  it('covers the catalogues, the two worker pages and every static HTML entry', () => {
    expect(staticHtml()).toEqual(['app/d/index.html', 'app/index.html', 'app/izvori/index.html', 'app/kiosk/index.html', 'app/prijava/index.html', 'app/pristupacnost/index.html', 'app/privatnost/index.html', 'app/s/index.html', 'app/statistika/index.html']);
  });
  it.each(PUNCTUATION_FILES)('%s carries no U+2014 and no " -- "', (file) => {
    const text = read(file);
    expect(text, 'U+2014').not.toContain('—');
    expect(text, '" -- "').not.toContain(' -- ');
  });
});

describe('address: one person, informal, never Vi', () => {
  it('the Croatian catalogue never addresses the reader as Vi', () => {
    expect(JSON.stringify(hr)).not.toMatch(VI);
  });
  it('no string literal anywhere under worker/ addresses the reader as Vi', () => {
    for (const file of walk('worker')) {
      for (const literal of literals(read(file))) expect(literal, file).not.toMatch(VI);
    }
  });
});

describe('one name per concept: the transport surface (slop #11, [O-51])', () => {
  // "Karta" is the destination's one word and "Promet" only the subject word of a kicker. WP4
  // renamed the tab (layers.u-pokretu); WP5 gave the map region, the sheet and the paired
  // presentation the same word. The two retired synonyms of app/src/city/strings.ts
  // (`movement`, `network`) never enter the catalogue while WP5 moves that file's words into it.
  const TRANSPORT_TAB_WORD = 'Karta';
  it('no hr.json value is "Kretanje" or "Prijevoz i raspored"', () => {
    const synonyms = leafKeys(HR).filter((key) => ['Kretanje', 'Prijevoz i raspored'].includes(leaf(HR, key)!.trim()));
    expect(synonyms).toEqual([]);
  });
  it('app/src/city/strings.ts is the adapter over city.*: no movement or network word, no own copy', () => {
    expect(Object.keys(hr.city)).not.toContain('movement');
    expect(Object.keys(hr.city)).not.toContain('network');
    const adapter = read('app/src/city/strings.ts');
    expect(adapter).not.toMatch(/Kretanje|Prijevoz i raspored|Getting around|Transport and timetable/);
    expect(adapter).not.toMatch(/[čćžšđ]/iu);
  });
  it('the tab, the map region and the landing line say "Karta"; the sheet says "Detalji"', () => {
    expect(hr.layers['u-pokretu']).toBe(TRANSPORT_TAB_WORD);
    expect(hr.transport.mapRegion).toBe(TRANSPORT_TAB_WORD);
    expect(hr.transport.sheetLabel).toBe('Detalji');
    expect(hr.kiosk.paired.overviewTransport).toBe(`${TRANSPORT_TAB_WORD} oko stajališta`);
    expect(hr.landing.evidence.domains).toBe(`Sada · ${TRANSPORT_TAB_WORD} · Vrijeme · Sigurnost · Grad · Događanja`);
    expect(read('app/index.html')).toContain(`>${hr.landing.evidence.domains}<`);
    expect(read('app/src/izvori-render.ts')).toContain('<a href="#izvor-zet-rt">Promet</a>');
    expect(JSON.stringify(hr)).not.toMatch(/Karta prometa|Detalji prometa|Promet oko/);
  });
});

describe('one catalogue: no inline Croatian/English pair outside app/src/i18n (WP5 step 2)', () => {
  // A word picked by `en ? 'English' : 'Hrvatski'` is copy the catalogue cannot see: the parity
  // test, the orphan test and the owner's read-through all miss it. Locale-dependent formatting goes
  // through intlLocale() or catalogueLocale(), copy through i18n.t / tr / ct.
  const PAIR = [/(?:\ben|english|isEn)\s*\?\s*['"`]/, /getLocale\(\)\.startsWith\('en'\)\s*\?\s*['"`]/];
  it('no .ts under app/src outside app/src/i18n chooses a string by locale inline', () => {
    const hits = walk('app/src').filter((file) => !file.startsWith('app/src/i18n/')).flatMap((file) =>
      read(file).split('\n').flatMap((line, i) => (PAIR.some((re) => re.test(line)) ? [`${file}:${i + 1}`] : [])));
    expect(hits).toEqual([]);
  });
  it('the guard sees the forms it bans', () => {
    for (const line of ["x = en ? 'Map' : 'Karta';", 'y = english ? `at` : `u`;', "z = i18n.getLocale().startsWith('en') ? 'en-GB' : 'hr-HR';"]) {
      expect(PAIR.some((re) => re.test(line)), line).toBe(true);
    }
    expect(PAIR.some((re) => re.test("const code = catalogueLocale(i18n.getLocale());"))).toBe(false);
  });
});

describe('one word per concept: "Sada" is now and "vozni red" the timetable (WP5 step 6)', () => {
  it('the timetable word is "vozni red" wherever a time is not tracked', () => {
    expect(hr.arrivals.scheduled).toBe('vozni red');
    // tiles.scheduled, its twin, went with the phone's tiles (WP5 B1): one key says it.
    expect(JSON.stringify(hr).split('"vozni red"').length - 1).toBe(1);
    expect(JSON.stringify(hr)).not.toMatch(/po redu vožnje|po rasporedu|ZET GTFS/);
  });
  it('the weather now is "Sada"', () => {
    expect(hr.weather.now).toBe('Sada');
    expect(JSON.stringify(hr)).not.toMatch(/"Trenutno"/);
  });
});

describe('one word per concept: a tram or bus stop is "stajalište" (WP5 step 6)', () => {
  // "Stanica" is BAJS's word for a bike station and "postaja" DHMZ's for a measuring station.
  // A leaf may say "stanica" only when its key is on this list, and the list takes BAJS keys
  // under city.* only. None needs the word today: city.* says "BAJS" and the counts.
  const BAJS_STANICA_KEYS: readonly string[] = [];
  it('no hr.json leaf outside the BAJS allowlist says "stanica"', () => {
    for (const key of BAJS_STANICA_KEYS) expect(key, 'BAJS keys live under city.*').toMatch(/^city\./);
    const stanica = leafKeys(HR).filter((key) => /(?<![\p{L}\p{N}_])[Ss]tanic/u.test(leaf(HR, key)!));
    expect(stanica.filter((key) => !BAJS_STANICA_KEYS.includes(key))).toEqual([]);
  });
});

describe('the word "zid": never the screen, while a proper name keeps it [O-66]', () => {
  // The header's register family ("{name}: {text}") keeps the slop register; the street
  // "Pod zidom" is data, so a register sentence that names it may stand in the header.
  const NOW = Date.parse('2026-09-22T12:10:00+02:00');
  const header = (text: string) => acceptSentence(text, { facts: [{ id: 'always:heritage:kolmar', kind: 'kultura', text, validUntil: NOW + 600_000 }], now: NOW });
  it('takes a register sentence that names the street Pod zidom', () => {
    expect(header('Kuća Kolmar: servisni ulaz s ulice Pod zidom.')).toEqual({ ok: true });
  });
  it('still refuses every other "zid", the common noun included', () => {
    for (const text of [
      'Kuća Kolmar: slika na zidu u prizemlju.',
      'Kuća Kolmar: ulaz je pod zidom.',
      'Kuća Kolmar: servisni ulaz s ulice POD ZIDOM.',
      'Pod zidom: ulica podno negdašnjeg obrambenog zida Kaptola.',
    ]) expect(header(text), text).toEqual({ ok: false, reason: 'forbidden-copy' });
  });
});

describe('canonical sentences', () => {
  const SHARED_HR = {
    closuresNone: 'Nema zatvorenih prometnica.',
    warningsNone: 'Nema upozorenja DHMZ-a za Zagreb.',
    unlockedUntil: 'Otključano do {time}',
    safetyPage: 'Sigurnost',
  };
  /** Dashboard keys read by call sites that do not change; each says exactly what its shared sentence says. */
  const TWINS: Record<keyof typeof SHARED_HR, string[]> = {
    closuresNone: ['safety.closuresNone'],
    warningsNone: ['weather.warningsNone'],
    unlockedUntil: ['session.unlockedAnnounce', 'session.sheetTitle'],
    safetyPage: ['layers.sigurnost', 'nav.safety'],
  };
  it('shared.* carries the four canonical Croatian sentences', () => {
    expect(hr.shared).toEqual(SHARED_HR);
  });
  it.each(Object.entries(TWINS))('every twin of shared.%s says the same sentence in both languages', (key, twins) => {
    for (const twin of twins) {
      expect(leaf(HR, twin), `${twin} (hr)`).toBe(leaf(HR, `shared.${key}`));
      expect(leaf(EN, twin), `${twin} (en)`).toBe(leaf(EN, `shared.${key}`));
    }
  });
  it('the /hitno link says one label everywhere it stands (common.links.hitno is canonical)', () => {
    // shared.safetyOpen had no reader and is gone (WP5 A1); the labels it pinned still agree.
    // landing.pages.hitno ("Sigurnost, otvorena svima") is a page description in a list of them, not this label.
    expect(hr.common.links.hitno).toBe('Sigurnost, bez skeniranja');
    for (const twin of ['landing.actions.safety', 'scan.errors.actions.safety']) {
      expect(leaf(HR, twin), `${twin} (hr)`).toBe(hr.common.links.hitno);
      expect(leaf(EN, twin), `${twin} (en)`).toBe(en.common.links.hitno);
    }
  });
  it('the kiosk reads the shared sentences for the same concepts', () => {
    expect(leaf(HR, 'kiosk.paired.closuresNone')).toBeUndefined();
    expect(leaf(HR, 'kiosk.paired.warningsNone')).toBeUndefined();
    expect(leaf(HR, 'kiosk.header.unlockedUntil')).toBeUndefined();
    expect(leaf(HR, 'kiosk.safety.hitno')).toBeUndefined();
  });
  // §13 #13: the register caveat is said once, on /izvori, never on the wall [O-27]; the owner's words, byte-exact (WP5 B1).
  it('/izvori says the city catalogue\'s register sentence once, in the owner\'s words, and no other page or catalogue repeats it', () => {
    const REGISTER = 'Podaci gradskog kataloga (kultura, baština, voda, WC, tržnice …) su iz registara, ne provjera uživo; obuhvat zaštite baštine označava zaštićeno područje, ne ulaz.';
    const page = read('app/izvori/index.html');
    expect(page.split(`<p>${REGISTER}</p>`).length - 1).toBe(1);
    // After the page's own intro, before the generated source list.
    expect(page.indexOf(REGISTER)).toBeGreaterThan(page.indexOf('u trenutku prikaza.</p>'));
    expect(page.indexOf(REGISTER)).toBeLessThan(page.indexOf('<!--IZVORI-->'));
    for (const file of [...staticHtml().filter((f) => f !== 'app/izvori/index.html'), 'app/src/i18n/hr.json', 'app/src/i18n/en.json']) {
      expect(read(file), file).not.toContain('Podaci gradskog kataloga');
    }
  });
  it('the Još heading is "Još" and the safety verdict has one calm sentence', () => {
    expect(hr.nav.moreTitle).toBe('Još');
    expect(hr.directory.safetySummaryCalm).toBe(hr.safety.calm);
  });
});

describe('severity words follow the DHMZ colour convention (R-K1)', () => {
  it('names the five levels in Croatian and never "zeleno"', () => {
    expect(hr.panels.severity).toEqual({ info: 'obavijest', minor: 'manje upozorenje', moderate: 'žuto upozorenje', severe: 'narančasto upozorenje', extreme: 'crveno upozorenje' });
    expect(en.panels.severity).toEqual({ info: 'notice', minor: 'minor warning', moderate: 'yellow warning', severe: 'orange warning', extreme: 'red warning' });
    expect(JSON.stringify(hr)).not.toMatch(/\bzeleno\b/);
    expect(JSON.stringify(en)).not.toMatch(/"green"/);
  });
  it('matches the words /hitno prints', () => {
    const select = read('worker/hitno/select.ts');
    for (const word of Object.values(hr.panels.severity)) expect(select).toContain(`'${word}'`);
  });
});

describe('quake window and radius', () => {
  it('says 72 hours on the safety surfaces, 7 days on Vrijeme, 150 km everywhere a radius is named', () => {
    expect(hr.safety.quakes).toContain('72 sata');
    expect(hr.safety.quakesNone).toContain('72 sata');
    expect(hr.kiosk.paired.quakes).toContain('72 sata');
    expect(hr.kiosk.paired.quakes).toContain('150 km');
    expect(hr.kiosk.paired.quakeNone).toContain('72 sata');
    expect(hr.weather.quakes).toContain('7 dana');
    expect(hr.weather.quakes).toContain('150 km');
    expect(hr.weather.quakesNone).toContain('7 dana');
    expect(read('worker/hitno/render.ts')).toContain('72 sata');
  });
});

describe('theme words', () => {
  it('are sentence case and agree with "tema" in Croatian; the kiosk keeps its lower-case mid-sentence words', () => {
    expect(hr.common.theme).toEqual({ label: 'Tema', auto: 'Automatski', light: 'Svijetla', dark: 'Tamna', solar: 'Po suncu' });
    expect(hr.kiosk.header.themeWord).toEqual({ auto: 'automatski', light: 'svijetla', dark: 'tamna', solar: 'po suncu' });
  });
});

// The wall map's legend (WP2 step 6, kiosk.legend.*): three plain items, and
// no caveat of the "? nepotvrđeno" kind the old hard-coded legend carried. A
// BAJS disc whose count is unknown is grey and blank on the map, so the legend
// never needs to explain a question mark.
describe('the wall legend kiosk.legend.* (WP2)', () => {
  it('names the three items in both languages', () => {
    // Round 2, F9 (owner, 24 Sep): the legend describes what is drawn: a numbered disc is the free bikes, a dot an
    // empty station, and on the whole-city window a dot is a station.
    expect(hr.kiosk.legend).toEqual({ tram: 'Tramvajska linija', bikes: 'BAJS: slobodni bicikli', bikesEmpty: 'BAJS: prazna stanica', bikesFar: 'BAJS stanica', culture: 'Kultura večeras' });
    expect(en.kiosk.legend).toEqual({ tram: 'Tram route', bikes: 'BAJS: bikes available', bikesEmpty: 'BAJS: empty station', bikesFar: 'BAJS station', culture: 'Culture tonight' });
  });
  it.each([['hr', hr], ['en', en]] as const)('%s: no question mark, no caveat, no ellipsis, never "zid"', (name, catalogue) => {
    for (const [key, value] of Object.entries(catalogue.kiosk.legend)) {
      expect(value, `kiosk.legend.${key} (${name})`).not.toMatch(/\?|nepotvrđen|unconfirmed|…|\.\.\./);
      expect(value, `kiosk.legend.${key} (${name})`).not.toMatch(/(?<![\p{L}\p{N}_])zid/iu);
    }
  });
  it('the kiosk adapter reads the legend from the catalogue', () => {
    expect(kioskStrings('hr').legend).toEqual(hr.kiosk.legend);
    expect(kioskStrings('en').legend).toEqual(en.kiosk.legend);
  });
  it('the invitation reads the legend from the catalogue, not from literals of its own', () => {
    const own = literals(read('app/src/kiosk/invitation.ts')).join('\n');
    for (const word of ['Tramvajska linija', 'Tram route', 'nepotvrđeno', 'unconfirmed', 'Događanja ovaj tjedan', 'Events this week']) expect(own, word).not.toContain(word);
  });
});

describe('hostname', () => {
  it('never appears in a catalogue; the share sentence and the kiosk hint carry a {host} slot', () => {
    expect(JSON.stringify(hr)).not.toContain('zagreb.aningfilm.hr');
    expect(JSON.stringify(en)).not.toContain('zagreb.aningfilm.hr');
    expect(hr.session.shareBody).toContain('{host}/s');
    expect(en.session.shareBody).toContain('{host}/s');
    expect(hr.kiosk.invite.typeCode).toContain('{host}');
    expect(en.kiosk.invite.typeCode).toContain('{host}');
  });
});

describe('no copy promises an evaluation login (public since 14 September)', () => {
  it('neither catalogue mentions Cloudflare Access, signing in or an evaluator identity', () => {
    for (const [name, catalogue] of [['hr', hr], ['en', en]] as const) {
      expect(JSON.stringify(catalogue), name).not.toMatch(/Cloudflare Access|Prijavi se|Sign in|zaštićeni pristup|protected access|po ocjenjivaču|per evaluator/);
    }
  });
});

describe('delay words beside a .line badge', () => {
  it('every key delayWord() and delayTone() read exists in both languages', () => {
    const keys = new Set<string>();
    for (const file of ['app/src/layers/shared.ts', 'app/src/experience/delay.ts']) {
      for (const match of read(file).matchAll(/i18n\.t\('([\w.-]+)'/g)) keys.add(match[1]);
    }
    expect([...keys].sort()).toEqual(['panels.delayEarly', 'panels.delayLate', 'panels.delayOnTime', 'panels.until', 'transit.noDelayData']);
    for (const key of keys) {
      expect(leaf(HR, key), `${key} (hr)`).toBeTypeOf('string');
      expect(leaf(EN, key), `${key} (en)`).toBeTypeOf('string');
    }
  });
});

describe('an arrival time is never bare (WP5)', () => {
  // The owner reversed the "no inferred ETA" rule: the sheet may now say when a
  // tram comes. The price of that is that no arrival time may stand unlabelled
  // -- a reader has to be able to see, per row, whether a figure came off a
  // tracked vehicle or straight off the timetable -- and that the sentence
  // naming the estimate's source is on the surface that shows the rows.
  const STOP = { id: '106', ids: ['106_1'], name: 'Kvaternikov trg', lon: 15.99, lat: 45.81, routes: ['11'] };
  const NOW = Date.parse('2026-09-19T10:00:00Z');
  /** Every shape a row can take: tracked and untracked, counting down and on the clock. */
  const ROWS: ArrivalRow[] = [
    { tripId: 'a', routeId: '11', routeName: '11', headsign: 'Dubec', atMs: NOW + 3 * 60_000, live: true, minutes: 3 },
    { tripId: 'b', routeId: '11', routeName: '11', headsign: 'Dubec', atMs: NOW + 4 * 60_000, live: false, minutes: 4 },
    { tripId: 'c', routeId: '11', routeName: '11', headsign: 'Dubec', atMs: NOW + 14 * 60_000, live: true, minutes: null },
    { tripId: 'd', routeId: '11', routeName: '11', headsign: 'Dubec', atMs: NOW + 18 * 60_000, live: false, minutes: null },
  ];
  const sheet = (locale: 'hr' | 'en', frozenAt?: number): string => stopDetailMarkup(createDefaultI18n(locale), {
    stop: STOP, routes: [{ id: '11', short: '11', long: 'Črnomerec - Dubec', type: 0 }], counts: new Map(), delays: new Map(),
    isScreenStop: false, kiosk: false, arrivals: ROWS, arrivalsStatus: 'live', frozenAt,
  });
  /** Every row of the stop's list: its first three (arrival-rows), then the rest under "Vozni red" (timetable-rows). */
  const arrivalRows = (html: string): string[] => {
    const list = (testid: string): string => html.split(`data-testid="${testid}"`)[1]?.split('</ul>')[0] ?? '';
    expect(html).toContain('data-testid="arrival-rows"');
    return (list('arrival-rows') + list('timetable-rows')).split('<li ').slice(1).map((row) => row.split('</li>')[0]!);
  };

  it.each(['hr', 'en'] as const)('%s: a live row carries the dot and data-live, a timetable row a plain clock and neither; the note names the source once', (locale) => {
    const catalogue = locale === 'hr' ? HR : EN;
    const html = sheet(locale);
    const rows = arrivalRows(html);
    expect(rows).toHaveLength(ROWS.length);
    rows.forEach((row, i) => {
      const live = ROWS[i]!.live;
      expect(row.includes('class="t-live"'), row).toBe(live);
      expect(row.includes('data-live="true"'), row).toBe(live);
      if (!live) expect(row, row).toContain('<time');
      // No word per row [O-27]: the form carries it and the note says it once. Read the row's text, not its
      // markup: the rows name their kind for the probe in an attribute (data-kind="timetable", lane/d3-copy2),
      // and the English catalogue word for the form is "timetable" too.
      const text = `<li ${row}`.replace(/<[^>]*>/g, ' ');
      expect(text, row).not.toContain(leaf(catalogue, 'arrivals.scheduled')!);
      expect(text, row).not.toMatch(/Procjena|Estimate/);
    });
    expect(html.split(leaf(catalogue, 'arrivals.note')!).length - 1).toBe(1);
    // The live word names the dot for a screen reader; it is never text on the sheet.
    expect(html.replace(/<[^>]*>/g, ' ')).not.toContain(leaf(catalogue, 'arrivals.live')!);
  });

  it('a frozen sheet keeps the marker but never says the live word', () => {
    const html = sheet('hr', Date.parse('2026-09-19T10:02:00Z'));
    arrivalRows(html).forEach((row, i) => {
      expect(row.includes('class="t-live"'), row).toBe(ROWS[i]!.live);
      expect(row, row).not.toContain('data-live="true"');
    });
    expect(html).not.toContain(leaf(HR, 'arrivals.live'));
    expect(html).toContain(leaf(HR, 'session.snapshotAt')!.replace('{time}', '12:02'));
  });

  it('neither catalogue still says ZET publishes no arrivals', () => {
    for (const [name, catalogue] of [['hr', hr], ['en', en]] as const) {
      expect(JSON.stringify(catalogue), name).not.toMatch(/ne objavljuje dolaske|publishes no arrival/);
    }
  });
});

describe('the end of a session clears the content (WP4 step 11, D3 read-through)', () => {
  it('the landing story and the expired capture never promise a snapshot that stays', () => {
    for (const [name, catalogue, promise] of [['hr', HR, /snimk|zamrz|izvoz/i], ['en', EN, /snapshot|frozen|export/i]] as const) {
      for (const key of ['landing.story.leaveBody', 'landing.alt.frozen']) expect(leaf(catalogue, key), `${key} (${name})`).not.toMatch(promise);
    }
    const html = read('app/index.html');
    expect(html).not.toContain('označena snimka');
    expect(html).toContain(`alt="${leaf(HR, 'landing.alt.frozen')}" data-capture-alt="frozen"`);
  });
});

describe('leaves', () => {
  it('no leaf is empty in either catalogue and no leaf keeps a raw dotted key as its text', () => {
    for (const [name, catalogue] of [['hr', HR], ['en', EN]] as const) {
      for (const key of leafKeys(catalogue)) {
        const value = leaf(catalogue, key)!;
        expect(value.trim().length, `${key} (${name})`).toBeGreaterThan(0);
        expect(value, `${key} (${name})`).not.toMatch(/^[a-z]+(\.[\w-]+)+$/);
      }
    }
  });
  it('no leaf in either catalogue ends or breaks off in an ellipsis: a status is a whole phrase (WP5)', () => {
    for (const [name, catalogue] of [['hr', HR], ['en', EN]] as const) {
      expect(leafKeys(catalogue).filter((key) => /…|\.\.\./u.test(leaf(catalogue, key)!)), name).toEqual([]);
    }
  });
});

// The wall of 22 September (WP1) owns three key groups; these rules are theirs.
// The ellipsis ban holds for every leaf ("leaves" above).
describe('the wall groups kiosk.nearby.*, kiosk.sentence.*, kiosk.handheld.* (WP1)', () => {
  const GROUPS = ['nearby', 'sentence', 'handheld'] as const;
  const values = (catalogue: Catalogue): (readonly [string, string])[] =>
    GROUPS.flatMap((group) => leafKeys((catalogue.kiosk as Catalogue)[group], `kiosk.${group}`).map((key) => [key, leaf(catalogue, key)!] as const));
  const slots = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

  it('carries the owner\'s strings byte-exact', () => {
    expect(hr.kiosk.nearby.title).toBe('U blizini');
    expect(hr.kiosk.nearby.pill).toBe('{km} km · ~{min} min');
    expect(en.kiosk.nearby.pill).toBe('{km} km · ~{min} min');
    expect(hr.kiosk.nearby.always).toBe('uvijek');
    expect(hr.kiosk.nearby.outageNote).toBe('ZET trenutačno ne šalje položaje vozila; polasci su po voznom redu.');
    expect(hr.kiosk.sentence.kicker).toEqual({ promet: 'Promet', kultura: 'Kultura', vrijeme: 'Vrijeme', bicikli: 'Bicikli', nocas: 'Noćas', radovi: 'Radovi' });
    expect(hr.kiosk.sentence.pharmacy).toContain('24/7');
    expect(hr.kiosk.handheld.info).toBe('Za javni zaslon otvori /kiosk/ na tom uređaju i odaberi Pokreni. Ovaj kod otvara osobnu sesiju; skeniranje ne mijenja javni prikaz.');
  });

  it.each([['hr', HR], ['en', EN]] as const)('%s: no ellipsis, never "unavailable" as a headline, never "zid"', (name, catalogue) => {
    const all = values(catalogue);
    expect(all.length, name).toBeGreaterThanOrEqual(30);
    for (const [key, value] of all) {
      expect(value, `${key} (${name})`).not.toMatch(/…|\.\.\./);
      expect(value, `${key} (${name})`).not.toMatch(/nedostupn|unavailable/i);
      expect(value, `${key} (${name})`).not.toMatch(/(?<![\p{L}\p{N}_])zid/iu);
    }
  });

  it('every template names the same slots in both languages', () => {
    for (const [key, value] of values(HR)) expect(slots(leaf(EN, key)!), key).toEqual(slots(value));
  });
});

// The header sentence's templates are Section C's reviewed copy (orchestrator
// decision 9): every source name (a destination, a street, a place, a title, a
// venue, a station, an address) sits in an envelope that needs no case or
// gender agreement, so a masculine or plural name reads as correctly as a
// feminine one. Pinned here; once app/src/city/sentence.ts exports its own
// defaults (SENTENCE_COPY_HR / SENTENCE_COPY_EN), the catalogue must equal them.
describe('the header sentence templates are name-safe and match the sentence client (WP1)', () => {
  const HR_TEMPLATES = {
    departureIn: 'Tramvaj {route}, smjer {to}, polazi za {n} min.',
    departureAt: 'Tramvaj {route}, smjer {to}, polazi u {time}.',
    busIn: 'Autobus {route}, smjer {to}, polazi za {n} min.',
    busAt: 'Autobus {route}, smjer {to}, polazi u {time}.',
    closureUntil: '{street}: zatvoreno za promet do {until}.',
    weather: '{temp}, {condition}; danas do {max} °C.',
    weatherNoRange: '{temp}, {condition}.',
    weatherTemperature: 'Temperatura u Zagrebu je {temp}.',
    bikes: 'BAJS {station}: {bikes}.',
    sunset: 'Sunce zalazi u {time}.',
    sunsetAt: 'Zalazak sunca je u {time}.',
    sunsetTime: 'U {time} zalazi sunce.',
    sunrise: 'Sunce izlazi u {time}.',
    sunriseAt: 'Izlazak sunca je u {time}.',
    sunriseTime: 'U {time} izlazi sunce.',
    lastTram: 'Zadnji tramvaj {route} polazi {time}.',
    firstTram: 'Prvi tramvaj {route} polazi {time}.',
    event: '{time} počinje događanje „{title}” ({venue}).',
    opening: '{name}: rad počinje {time}.',
    pharmacy: 'Dežurna ljekarna 24/7: {address}.',
    always: '{name}: {text}',
    outage: 'ZET ne šalje položaje vozila; polasci su po voznom redu.',
  };
  const EN_TEMPLATES: Record<keyof typeof HR_TEMPLATES, string> = {
    departureIn: 'Tram {route} towards {to} leaves in {n} min.',
    departureAt: 'Tram {route} towards {to} leaves at {time}.',
    busIn: 'Bus {route} towards {to} leaves in {n} min.',
    busAt: 'Bus {route} towards {to} leaves at {time}.',
    closureUntil: '{street} is closed to traffic until {until}.',
    weather: '{temp}, {condition}; up to {max} °C today.',
    weatherNoRange: '{temp}, {condition}.',
    weatherTemperature: 'The temperature in Zagreb is {temp}.',
    bikes: 'BAJS {station}: {bikes}.',
    sunset: 'The sun sets at {time}.',
    sunsetAt: 'Sunset is at {time}.',
    sunsetTime: 'At {time} the sun sets.',
    sunrise: 'The sun rises at {time}.',
    sunriseAt: 'Sunrise is at {time}.',
    sunriseTime: 'At {time} the sun rises.',
    lastTram: 'The last tram {route} leaves {time}.',
    firstTram: 'The first tram {route} leaves {time}.',
    event: '{title} starts {time}, {venue}.',
    opening: '{name} opens {time}.',
    pharmacy: '24/7 duty pharmacy: {address}.',
    always: '{name}: {text}',
    outage: 'ZET is not sending vehicle positions; departures follow the timetable.',
  };
  const templates = (sentence: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(sentence).filter(([key]) => key !== 'kicker'));

  it('the catalogues carry the reviewed templates byte-exact, in both languages', () => {
    expect(templates(hr.kiosk.sentence)).toEqual(HR_TEMPLATES);
    expect(templates(en.kiosk.sentence)).toEqual(EN_TEMPLATES);
  });

  it('equal the sentence client\'s own defaults wherever that module exports them', () => {
    const exported = sentenceModule as Record<string, unknown>;
    if (exported.SENTENCE_COPY_HR !== undefined) expect(templates(hr.kiosk.sentence)).toEqual(exported.SENTENCE_COPY_HR);
    if (exported.SENTENCE_COPY_EN !== undefined) expect(templates(en.kiosk.sentence)).toEqual(exported.SENTENCE_COPY_EN);
  });

  it('puts every Croatian name slot in an envelope that needs no case or gender agreement', () => {
    const envelopes: Record<string, RegExp> = {
      to: /, smjer \{to\}, /,
      street: /^\{street\}: /,
      name: /^\{name\}: /,
      title: /„\{title\}”/,
      venue: /\(\{venue\}\)/,
      station: /^BAJS \{station\}: /,
      address: /: \{address\}\.$/,
    };
    for (const [key, template] of Object.entries(HR_TEMPLATES)) {
      for (const [slot, envelope] of Object.entries(envelopes)) {
        if (template.includes(`{${slot}}`)) expect(template, `${key} {${slot}}`).toMatch(envelope);
      }
    }
  });

  it('reads correctly with masculine and plural names, not only feminine ones', () => {
    const s = hr.kiosk.sentence;
    expect(fill(s.departureIn, { route: 6, to: 'Črnomerec', n: 3 })).toBe('Tramvaj 6, smjer Črnomerec, polazi za 3 min.');
    expect(fill(s.busAt, { route: 109, to: 'Dugave', time: '12:33' })).toBe('Autobus 109, smjer Dugave, polazi u 12:33.');
    expect(fill(s.closureUntil, { street: 'Trg bana Josipa Jelačića', until: '18:00' })).toBe('Trg bana Josipa Jelačića: zatvoreno za promet do 18:00.');
    expect(fill(s.closureUntil, { street: 'Vukovarska avenija', until: '18:00' })).toBe('Vukovarska avenija: zatvoreno za promet do 18:00.');
    expect(fill(s.opening, { name: 'Klovićevi dvori', time: 'sutra u 10:00' })).toBe('Klovićevi dvori: rad počinje sutra u 10:00.');
    expect(fill(s.event, { time: 'U 19:30', title: 'Intersonus', venue: 'Kino Europa' })).toBe('U 19:30 počinje događanje „Intersonus” (Kino Europa).');
    expect(fill(s.lastTram, { route: 6, time: 'u 23:52' })).toBe('Zadnji tramvaj 6 polazi u 23:52.');
    expect(fill(s.firstTram, { route: 6, time: 'sutra u 04:16' })).toBe('Prvi tramvaj 6 polazi sutra u 04:16.');
  });
});
