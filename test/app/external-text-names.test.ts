// @vitest-environment happy-dom
// W-C10 (review-d2 P2): real stop, street and schematic names pass the name
// check. In a name or an address a dotted token is register shorthand ("Muzej
// suv.umjetnosti", "Inst. R.Bošković", "N.S.knjižnica", "Stud.dom S.Radić")
// unless its last label is a top-level domain; www, http and @ stay refused.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { externalText, vetExternal, type ExternalTextKind } from '../../shared/kiosk/external-text';
import { TOP_LEVEL_DOMAINS } from '../../shared/kiosk/tlds';
import { kioskStrings } from '../../app/src/kiosk/strings';
import { mountPlaceField } from '../../app/src/kiosk/place-field';
import { previewText } from '../../app/src/kiosk/start';
import { screenStopGeoJson } from '../../app/src/map/external-features';

const ROOT = resolve(import.meta.dirname, '../..');
const json = <T>(path: string): T => JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as T;
const SURFACES = ['header', 'row'] as const;
const NAME_KINDS = ['name', 'address'] as const;

interface StopRow { id: string; name: string; lon: number; lat: number; routes: string[] }
const appStops = json<StopRow[]>('app/public/data/stops.json');
const workerStops = json<StopRow[]>('worker/data/zet-stops.json');
const geo = json<{ settlements: [string, string][]; streets: { name: string[] } }>('app/public/data/streets-geo.json');
const schema = json<{
  stops: { name: string; label: { text: string } | null }[];
  lines: { stops: { name: string }[] }[];
}>('app/public/data/zet-schema.json');

const unique = (values: readonly string[]): string[] => [...new Set(values)];
const stopNames = unique([...appStops, ...workerStops].map(stop => stop.name));
const streetNames = unique(geo.streets.name);
const settlements = unique(geo.settlements.map(([, name]) => name));
const schemaNames = unique([...schema.stops.map(stop => stop.name), ...schema.lines.flatMap(line => line.stops.map(stop => stop.name))]);
const schemaLabels = unique(schema.stops.flatMap(stop => stop.label ? [stop.label.text] : []));

function refusals(kind: ExternalTextKind, values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) for (const surface of SURFACES) {
    const verdict = externalText(kind, value, { surface });
    if (!verdict.ok) out.push(`${surface} ${verdict.reason}: ${value}`);
  }
  return out;
}

describe('every committed place name passes the name check on both surfaces', () => {
  it('pins the three tables', () => {
    expect(stopNames).toHaveLength(1_199);
    expect(unique(appStops.map(stop => stop.name))).toEqual(unique(workerStops.map(stop => stop.name)));
    expect(streetNames).toHaveLength(4_774);
    expect(schemaLabels).toHaveLength(118);
  });

  it('refuses none of the 1,199 stop names (the stop table of the phone and the Worker)', () => {
    expect(refusals('name', stopNames)).toEqual([]);
  }, 30_000);

  it('refuses none of the 4,774 street names, as a name or as an address, nor a settlement', () => {
    expect(refusals('name', streetNames)).toEqual([]);
    expect(refusals('address', streetNames)).toEqual([]);
    expect(refusals('name', settlements)).toEqual([]);
  }, 30_000);

  it('refuses none of the schematic stop names and labels, row by row and whole', () => {
    expect(refusals('name', schemaNames)).toEqual([]);
    // schema-paint.ts vets every label row and the joined label.
    const rows = schemaLabels.flatMap(label => [...label.split(/\r?\n/u), label.split(/\r?\n/u).join(' ')]);
    expect(refusals('name', rows)).toEqual([]);
  });

  it('keeps the named review-d2 examples', () => {
    for (const value of ['Muzej suv.umjetnosti', 'Inst. R.Bošković', 'Gimn.L.Vranjanin', 'N.S.knjižnica', 'I.Brlić Mažuranić',
      'Stud.dom S.Radić', 'Lukoranske ul.odv.', 'Podbrežje XII.A', 'Kod benzinske', 'Sopnička-kod 10D']) {
      expect([...stopNames, ...streetNames, ...schemaLabels.flatMap(label => label.split('\n').concat(label.replace('\n', ' ')))], value).toContain(value);
      for (const surface of SURFACES) expect(vetExternal('name', value, surface), `${surface}: ${value}`).toBe(value);
    }
  });
});

describe('a dotted token in a name is a link only with a top-level domain', () => {
  const PROBES = ['dr.ai', 'secure.cc', 'muzej.hr', 'kino.xyz', 'www.kino', 'kino@mail'];
  it.each(PROBES)('still refuses %s, alone and inside a real name', probe => {
    for (const kind of NAME_KINDS) for (const surface of SURFACES) {
      for (const value of [probe, probe.toUpperCase(), `Muzej suv.umjetnosti ${probe}`, `${probe} Inst. R.Bošković`]) {
        expect(externalText(kind, value, { surface }), `${kind}/${surface}: ${value}`).toEqual({ ok: false, reason: 'link' });
      }
    }
  });

  it('reads the last label after trimming hyphens, and IDN labels as domains', () => {
    for (const value of ['kino.shop', 'kino.shop-', 'Kino.Online', 'a.b.c.museum', 'kino.xn--p1ai', 'Ilica 1.hr']) {
      for (const kind of NAME_KINDS) expect(externalText(kind, value, { surface: 'row' }), value).toEqual({ ok: false, reason: 'link' });
    }
  });

  it('pins the data table: every ICANN country code and the generic names the old list had', () => {
    expect(TOP_LEVEL_DOMAINS.size).toBe(1_307);
    for (const tld of ['cc', 'ai', 'io', 'hr', 'com', 'net', 'org', 'eu', 'de', 'xyz', 'info', 'me', 'app', 'link', 'ly', 'dev',
      'site', 'online', 'zip', 'test', 'co', 'uk', 'ru', 'biz', 'store', 'museum', 'travel', 'gov', 'edu', 'shop', 'example']) {
      expect(TOP_LEVEL_DOMAINS.has(tld), tld).toBe(true);
    }
    expect([...TOP_LEVEL_DOMAINS].every(tld => /^[a-z]{2,}$/u.test(tld))).toBe(true);
  });

  it('keeps prose and headsigns on the letter-dot-letter refusal', () => {
    for (const kind of ['title', 'summary', 'register-text', 'headsign'] as const) {
      expect(externalText(kind, 'Muzej suv.umjetnosti', { surface: 'row' }), kind).toEqual({ ok: false, reason: 'link' });
    }
  });
});

describe('a dot inside a name never splits or hides a sensitive pair', () => {
  it.each(['pošalji.lozinku', 'Pošalji lo.zin.ku', 'P.o.š.a.l.j.i l.o.z.i.n.k.u', 'posalji.lo.zin.ku', 'kod.1234', 'lozinka.AB12',
    'Muzej suv.umjetnosti, pošalji.lozinku'])('refuses %j in a name and an address', value => {
    for (const kind of NAME_KINDS) for (const surface of SURFACES) {
      expect(externalText(kind, value, { surface }), `${kind}/${surface}`).toEqual({ ok: false, reason: 'instruction' });
    }
  });
});

describe('"kod" before a house number is a place only in a hyphenated stop name', () => {
  it('keeps the stop at Sopnička 10D in names and addresses', () => {
    for (const kind of NAME_KINDS) for (const surface of SURFACES) {
      expect(vetExternal(kind, 'Sopnička-kod 10D', surface)).toBe('Sopnička-kod 10D');
      expect(vetExternal(kind, 'Ilica · stajalište Sopnička-kod 10D', surface)).toBe('Ilica · stajalište Sopnička-kod 10D');
    }
  });
  it.each(['kod 10D', 'Sopnička kod 10D', 'Unesi kod 10D', 'PIN-kod 123', 'Pošalji-kod 123', 'lozinka-kod 123',
    'Sopnička-kod 10D, pošalji lozinku', 'Lozinka Sopnička-kod 123', 'Sopnička-kod ABC123'])('still refuses %j', value => {
    for (const kind of NAME_KINDS) for (const surface of SURFACES) {
      expect(externalText(kind, value, { surface }).ok, `${kind}/${surface}`).toBe(false);
    }
  });
  it('gives prose no house-number exemption', () => {
    for (const kind of ['title', 'summary', 'register-text'] as const) {
      expect(externalText(kind, 'Sopnička-kod 10D', { surface: 'row' }), kind).toEqual({ ok: false, reason: 'instruction' });
    }
  });
});

describe('the review-d2 consequences are gone for "Muzej suv.umjetnosti"', () => {
  const strings = kioskStrings('hr');
  const muzej = appStops.find(stop => stop.name === 'Muzej suv.umjetnosti')!;

  it('finds and picks the stop on the start screen', async () => {
    const host = document.createElement('div');
    const pending: (() => void)[] = [];
    const onChange = vi.fn();
    const field = mountPlaceField(host, { strings, locale: 'hr', loadStops: async () => [muzej], loadStreets: async () => [],
      isTram: () => true, onChange, setTimeout: fn => { pending.push(fn); return fn; }, clearTimeout: () => {} });
    const input = host.querySelector('input')!;
    input.value = 'Muzej suv';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await field.settle();
    for (const fn of pending) fn();
    const choices = host.querySelectorAll<HTMLElement>('[role=option]');
    expect(choices).toHaveLength(1);
    expect(host.textContent).not.toContain(strings.setup.noMatch);
    choices[0]!.click();
    expect(input.value).toBe('Muzej suv.umjetnosti');
    expect(field.value()?.name).toBe('Muzej suv.umjetnosti');
    field.destroy();
  });

  it('names the place in the setup line and on the map marker', () => {
    expect(previewText(strings, 'hr', { kind: 'tram', name: muzej.name, lon: muzej.lon, lat: muzej.lat, stopId: muzej.id }, ''))
      .toContain('Muzej suv.umjetnosti');
    expect(screenStopGeoJson({ id: muzej.id, name: muzej.name, lon: muzej.lon, lat: muzej.lat } as Parameters<typeof screenStopGeoJson>[0])
      .features).toMatchObject([{ properties: { name: 'Muzej suv.umjetnosti' } }]);
  });
});
