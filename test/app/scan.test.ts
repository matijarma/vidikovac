// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { ScanOk } from '../../worker/protocol';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { codeFromHash, confirmLabel, dashboardUrl } from '../../app/src/scan';

const NOW = Date.parse('2026-09-11T12:32:00Z'); // 14:32 in Zagreb
const KIOSK: ScanOk = {
  roomId: 'r1',
  ticket: 't1',
  beaconType: 'kiosk',
  venueType: 'kafic',
  area: 'Donji grad',
  expiresAt: NOW + 10 * 60_000,
  participants: 1,
  screenLabel: 'Kavana Velebit',
};
const PHONE: ScanOk = {
  roomId: 'r2',
  ticket: 't2',
  beaconType: 'phone',
  venueType: null,
  area: null,
  expiresAt: NOW + 5 * 60_000 - 400,
  participants: 1,
  screenLabel: null,
};

describe('codeFromHash', () => {
  it('reads our own QR fragment in both forms and refuses anything else', () => {
    expect(codeFromHash('#ABCD-EFGH')).toBe('ABCDEFGH');
    expect(codeFromHash('#abcdefgh')).toBe('ABCDEFGH');
    expect(codeFromHash('#code=abcd-efgh')).toBe('ABCDEFGH');
    expect(codeFromHash('#ilo1-abcd')).toBe('1101ABCD');
    expect(codeFromHash('#ABCU-EFGH')).toBeNull(); // U is not in the alphabet
    expect(codeFromHash('#room=r1&ticket=t1')).toBeNull();
    expect(codeFromHash('#ABCD')).toBeNull();
    expect(codeFromHash('#%E0%A4%A')).toBeNull();
    expect(codeFromHash('')).toBeNull();
  });
});

describe('confirmLabel', () => {
  it('names the kind of screen, the district and the minutes', () => {
    const i18n = createDefaultI18n('hr');
    expect(confirmLabel(KIOSK, i18n, NOW)).toBe('Zaslon: kafić, Donji grad, 10 minuta');
  });
  it('names the other person’s phone and its five minutes', () => {
    expect(confirmLabel(PHONE, createDefaultI18n('hr'), NOW)).toBe('Telefon druge osobe, 5 minuta');
  });
  it('drops the empty district instead of printing a dangling comma', () => {
    const i18n = createDefaultI18n('hr');
    expect(confirmLabel({ ...KIOSK, area: null }, i18n, NOW)).toBe('Zaslon: kafić, 10 minuta');
  });
  it('falls back to the neutral venue word for an unknown screen', () => {
    const i18n = createDefaultI18n('hr');
    expect(confirmLabel({ ...KIOSK, venueType: null }, i18n, NOW)).toBe('Zaslon: javni zaslon, Donji grad, 10 minuta');
  });
});

describe('dashboardUrl', () => {
  it('puts room, ticket and a label in the fragment, never in the query', () => {
    expect(dashboardUrl(KIOSK)).toBe('/d/#room=r1&ticket=t1&label=Kavana%20Velebit');
    expect(dashboardUrl(PHONE)).toBe('/d/#room=r2&ticket=t2&label=phone');
  });
});
