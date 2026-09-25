// WP5 A1 (seam S8): every catalogue leaf is read. The other half of WP0's
// i18n-keys.test.ts (every key app/src names exists): the same scan
// (test/app/i18n-scan.ts), read the other way round, so the two can never
// disagree about what "referenced" means.
//
// A leaf counts as read when the scanner meets it (a literal key, a plural
// base, a group() list, a tr()/ct() argument with its ternaries, a data-i18n
// attribute, or a template literal under an allowed dynamic prefix), when
// app/src hands its full key on as a string literal (sourceStatusEmptyText's
// 'panels.eventsEmpty'), or when it is on READ_THROUGH below: the few keys a
// variable carries, each named with the line of code that reads it, reviewed
// by hand (WP5 A1). A line that goes takes its keys with it: the test fails
// until they are deleted too. OWNER_COPY is the one other way: owner-approved
// copy is kept even while nothing reads it (orchestrator decision 42).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import { PLACE_CATEGORIES } from '../../shared/city/types';
import { isReferenced, scanI18n, unknownDynamicPrefixes } from './i18n-scan';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

function leafKeys(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => leafKeys(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}
const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (key: string): string => key.replace(PLURAL, '');

/**
 * Owner-approved copy no screen reads today. Orchestrator decision 42 (23 Sep 2026): a hygiene
 * pass never deletes owner copy; it stays byte-exact (test/app/i18n.test.ts "carries the approved
 * copy verbatim") until the owner retires it or a screen reads it again.
 */
const OWNER_COPY: readonly string[] = ['kiosk.invitation'];

/** Keys a variable carries to i18n.t / tr / ct, with the code that reads them. */
const READ_THROUGH: ReadonlyArray<{ keys: readonly string[]; file: string; code: readonly string[] }> = [
  // placeCategory(): a place's category word, typed PlaceCategory ⊂ CityWord.
  { keys: PLACE_CATEGORIES.map((category) => `city.${category}`), file: 'app/src/city/markup.ts', code: ['ct(i18n,p.category)'] },
  // The Događanja day chips.
  { keys: ['city.today', 'city.tomorrow', 'city.week'], file: 'app/src/layers/kultura.ts', code: ["(['today','tomorrow','week'] as const).map(day=>", 'ct(i18n,day)'] },
  // The place card's copy status line.
  { keys: ['city.copied', 'city.copyFailed'], file: 'app/src/dashboard.ts', code: ["const say=(word:'copied'|'copyFailed')", 'status.textContent=ct(i18n,word)'] },
  // kindWord(): "tramvaj" / "autobus" for a GTFS route type (vehicleKind is 'tram' | 'bus' | 'other').
  { keys: ['transport.tram', 'transport.bus'], file: 'app/src/transport/view.ts', code: ['tr(i18n, kind)'] },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (name.endsWith('.ts')) out.push(rel);
  }
  return out;
}

/** Every string literal of app/src that is a whole catalogue key or plural base: a key handed on to a reader. */
function literalKeys(catalogueKeys: ReadonlySet<string>): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of walk('app/src')) {
    const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && catalogueKeys.has(node.text)) {
        const where = `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
        found.set(node.text, [...(found.get(node.text) ?? []), where]);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

describe('i18n orphans: every catalogue leaf is read (WP5 A1)', () => {
  const scan = scanI18n();
  const leaves = leafKeys(hr);
  const handedOn = literalKeys(new Set([...leaves, ...leaves.map(base)]));
  const readThrough = new Set([...READ_THROUGH.flatMap((entry) => entry.keys), ...OWNER_COPY]);

  it('the scan meets only allowed dynamic prefixes (notify., timeband., city.fact- …)', () => {
    expect(unknownDynamicPrefixes(scan)).toEqual([]);
  });

  it('each READ_THROUGH line is still in its file, and each of its keys is in the catalogue', () => {
    for (const entry of READ_THROUGH) {
      const source = read(entry.file);
      for (const code of entry.code) expect(source, `${entry.file} reads ${entry.keys.join(', ')} through ${code}`).toContain(code);
      for (const key of entry.keys) expect(leaves, key).toContain(key);
    }
  });

  it('OWNER_COPY lists only owner copy the scan finds unread (decision 42), each in both catalogues', () => {
    for (const key of OWNER_COPY) {
      expect(isReferenced(scan, key), `${key} has a reader again: take it off OWNER_COPY`).toBe(false);
      expect(leaves, `${key} (hr)`).toContain(key);
      expect(leafKeys(en), `${key} (en)`).toContain(key);
    }
  });

  it('no leaf of hr.json is left unread', () => {
    const unread = leaves.filter((key) => !isReferenced(scan, key) && !readThrough.has(key) && !handedOn.has(key) && !handedOn.has(base(key)));
    expect(unread, 'unread catalogue leaves: delete them (and their en.json twins), or give them a reader').toEqual([]);
  });

  it('the keys handed on as literals are the ones reviewed (a new one is a decision, not an accident)', () => {
    const onlyHandedOn = [...handedOn.keys()].filter((key) => !isReferenced(scan, key) && !(leaves.includes(`${key}_other`) && isReferenced(scan, `${key}_other`))).sort();
    expect(onlyHandedOn).toEqual(['panels.cityWorkEmpty', 'panels.eventsEmpty']);
  });

  it('the catalogue holds 1046 Croatian leaves and 1018 English ones', () => {
    // 1,056 flat hr leaves once lane P, A3, A6, A2 and A5 were merged (lane/c-A1 4a57a61; en 1,020).
    // A1: +56 city words moved out of app/src/city/strings.ts, +21 city.fact-* labels moved out
    // of app/src/city/markup.ts, +2 time.at / time.dateAt (the sentence's time label): 1,135; then
    // -61 unread leaves (test/app/i18n.test.ts DEAD_KEYS, "WP5 A1", 58 in en, which writes no _few
    // form): 1,074 hr, 1,041 en; +1 kiosk.invitation restored as owner copy (decision 42): 1,075 hr,
    // 1,042 en; +3 city.reference, city.siteNote, city.scheduleNote, the phone's register notes (the
    // review's P2: §13 #12/#13 are wall-only, B1): 1,078 hr, 1,045 en; B1 -4 wall notes nothing else
    // reads (kiosk.lines.modelNote, kiosk.paired.dataFrom/fetchedAt, panels.sunComputed): 1,074 hr,
    // 1,041 en; B1 -30 hr / -25 en words only the retired tiles, producers and time band read
    // (tiles.*, timeband.more*, overview.allClearConfirmed, transit.fromStop, kvart.wholeCity,
    // kvart.walkMinutes): 1,044 hr, 1,016 en; B1 review -1 kiosk.weather.observed ("opaženo {time}", the Vrijeme
    // card's observation clock): 1,043 hr, 1,015 en; A4 final -1 timeband.next ("Zatim", the retired
    // segment word): 1,042 hr, 1,014 en; +3 landing.purpose.countTitle/countBody and
    // landing.actions.stats, the landing's link to the public statistics: 1,045 hr, 1,017 en.
    // A new leaf changes this number on purpose, with its reader.
    expect(leaves.length).toBe(1046);
    expect(leafKeys(en).length).toBe(1018);
    expect(leafKeys(hr.city).length).toBe(93);
  });
});
