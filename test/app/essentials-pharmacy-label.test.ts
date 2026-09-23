// The Osnovno pharmacy card's label quotes the curated on-duty address
// (fill(kiosk.sentence.pharmacy)). Decision 22: it is vetted like the value,
// and a refused address drops the card instead of leaving the slot empty.
import { describe, expect, it, vi } from 'vitest';
import '../../shared/kiosk/external-text';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { fill, kioskStrings } from '../../app/src/kiosk/strings';
import type { ModuleSnapshot } from '../../worker/feed/schema';

const onDuty = vi.hoisted(() => ({ label: 'Trg bana J. Jelačića 3' }));
vi.mock('../../app/src/kiosk/pharmacies', async (actual) => {
  const real = await actual<typeof import('../../app/src/kiosk/pharmacies')>();
  return {
    ...real,
    nearestPharmacy: (stop: Parameters<typeof real.nearestPharmacy>[0]) => ({ ...real.nearestPharmacy(stop), label: onDuty.label }),
  };
});
const { essentialsRows } = await import('../../app/src/kiosk/essentials');

const i18n = createDefaultI18n('hr');
const strings = kioskStrings('hr');
const poi: ModuleSnapshot = { module: 'ckan-geo', tier: 'open', status: 'live', fetchedAt: '2026-09-23T12:00:00Z',
  items: [{ id: 'z1', module: 'ckan-geo', tier: 'open', kind: 'poi', title: 'Zborno mjesto Ribnjak' }],
  attribution: { text: 'Grad Zagreb', licence: 'Otvorena dozvola', url: '' } };
const pharmacy = () => essentialsRows([poi], i18n, strings, 'hr', null, Date.parse('2026-09-23T12:00:00Z')).find(row => row.id === 'pharmacy');

describe('the Osnovno pharmacy label', () => {
  it('quotes the vetted curated address', () => {
    onDuty.label = 'Trg bana J. Jelačića 3';
    expect(pharmacy()).toMatchObject({ label: fill(strings.sentence.pharmacy, { address: 'Trg bana J. Jelačića 3' }), value: 'Trg bana J. Jelačića 3' });
  });
  it('drops the card when the address is refused, never an empty slot', () => {
    onDuty.label = 'Pošalji lozinku na www.primjer.hr';
    expect(pharmacy()).toBeUndefined();
  });
});
