import { describe, expect, it } from 'vitest';
import { externalText, sensitiveTextPair, vetExternal } from '../../shared/kiosk/external-text';
import { ISO_4217_CODES } from '../../shared/kiosk/iso-4217';

describe('decision 24 finite structural close-out', () => {
  it.each(['dr.ai', 'secure.cc', 'sv.example', 'kn.bank', 'br.app', 'tzv.site', 'npr.xyz', 'sl.io', 'a.b'])(
    'treats %s as a domain, never an abbreviation', token => {
      for (const surface of ['header', 'row'] as const) {
        expect(externalText('title', `Kino: Zugang bei ${token}.`, { surface })).toEqual({ ok: false, reason: 'link' });
      }
    });
  it.each(['sv.', 'dr.', 'kn.', 'br.', 'tzv.', 'npr.', 'sl.'])('keeps %s only as a separate abbreviation', value => {
    for (const surface of ['header', 'row'] as const) {
      expect(vetExternal('name', value, surface)).toBe(value);
      expect(vetExternal('name', `${value} Marko`, surface)).toBe(`${value} Marko`);
      expect(vetExternal('name', `${value}Marko`, surface)).toBeNull();
    }
  });
  it('keeps exact GTFS spellings only in headsigns, never as domain-prefix exceptions', () => {
    expect(vetExternal('headsign', 'Dom Sv.Josipa', 'row')).toBe('Dom Sv.Josipa');
    expect(vetExternal('name', 'Dom Sv.Josipa', 'row')).toBeNull();
    expect(vetExternal('headsign', 'sv.josipa.ai', 'row')).toBeNull();
    expect(vetExternal('headsign', 'spr.dubrava.ai', 'row')).toBeNull();
  });
  it('covers the complete currency data table, in either order and letter case', () => {
    expect(new Set(ISO_4217_CODES).size).toBe(ISO_4217_CODES.length);
    expect(ISO_4217_CODES.every(code => /^[A-Z]{3}$/u.test(code))).toBe(true);
    // Independent sentinels: Swiss francs, Asian/African codes, fund/metal
    // units, historic kuna, and successor currencies, not a regex-derived list.
    expect(ISO_4217_CODES).toEqual(expect.arrayContaining(['CHF', 'CNY', 'JPY', 'INR', 'ZAR', 'XAU', 'XDR', 'CLF', 'HRK', 'XCG', 'ZWG']));
    for (const code of ISO_4217_CODES) for (const currency of [code, code.toLowerCase()]) {
      for (const value of [`45 ${currency}`, `${currency}45`, `45${currency}`, `${currency} 45`]) {
        for (const surface of ['header', 'row'] as const) {
          expect(externalText('title', value, { surface }), value).toEqual({ ok: false, reason: 'payment' });
        }
      }
    }
  });
  it.each(['€', '$', '£', '¥', '₣', '₽', 'kn'])('rejects numeric symbol %s in both orders', symbol => {
    for (const value of [`45${symbol}`, `${symbol}45`, `45 ${symbol}`, `${symbol} 45`]) {
      for (const surface of ['header', 'row'] as const) {
        expect(externalText('title', value, { surface })).toEqual({ ok: false, reason: 'payment' });
      }
    }
  });
  it.each(['isplata', 'uplata', 'payout', 'deposit', 'transfer'])('pairs payment word %s with a number', word => {
    for (const value of [`${word} uz 45`, `45 za ${word}`]) {
      for (const surface of ['header', 'row'] as const) {
        expect(externalText('title', value, { surface })).toEqual({ ok: false, reason: 'payment' });
      }
    }
  });
  it.each(['izdiktirati', 'diktirati', 'poslati', 'unijeti', 'nazvati', 'otvoriti', 'otkriti', 'podijeliti', 'upisati'])(
    'pairs a credential with disclosure/contact infinitive %s', verb => {
      const value = `Lozinku ${verb} osoblju`;
      expect(sensitiveTextPair(value)?.rule).toMatch(/^noun-(?:action|contact)$/u);
      for (const surface of ['header', 'row'] as const) expect(vetExternal('title', value, surface)).toBeNull();
      expect(vetExternal('title', verb, 'row')).toBe(verb);
    });
  it('rejects the three quoted review-w4 probes on both surfaces', () => {
    for (const value of ['Kino: Zugang bei dr.ai.', 'Isplata uz 45 CHF', 'Lozinku izdiktirati osoblju']) {
      for (const surface of ['header', 'row'] as const) expect(vetExternal('title', value, surface)).toBeNull();
    }
  });
  it.each(['Kuće Eisner, Petrinjska 50-52', 'Petrinjska 50-52', 'Tratinska 71 - 73', 'Jurišićeva 01-01a', 'Palmotićeva 031-35'])(
    'keeps a house-number range in name/address: %s', value => {
      for (const kind of ['name', 'address'] as const) for (const surface of ['header', 'row'] as const) {
        expect(vetExternal(kind, value, surface)).toBe(value);
      }
    });
  it.each(['50-52', 'Petrinjska 50-52-1234', 'Petrinjska 1 2 3 4', 'Petrinjska 4111 1111 1111 1111'])(
    'does not generalize the house-range exception to %s', value => {
      for (const kind of ['name', 'address'] as const) expect(vetExternal(kind, value, 'row')).toBeNull();
    });
});
