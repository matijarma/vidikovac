// The phone's place detail keeps its register notes (review of lane/c-A1, P2): §13 #12 and #13
// take the register sentence and the heritage site note off the WALL only (WP5 B1, steps 8-9),
// and the rail board keeps its timetable note. e2e/city.spec.ts reads the site note on the phone.
// The phone's renderers vet third-party text through the boundary, which refuses everything until the policy is installed: load it here as the page's chunks do.
import '../../shared/kiosk/external-text';
import { describe, expect, it } from 'vitest';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { departuresMarkup, placeDetail } from '../../app/src/city/markup';
import { emptyCity, type DepartureBoard, type Place } from '../../shared/city/types';

const NOW = Date.parse('2026-09-20T12:00:00Z');
const heritage: Place = {
  id: 'heritage-a', category: 'heritage', name: 'Kamenita vrata', address: 'Kamenita ulica', sourceId: 'heritage',
  sourceRecord: 'Z-1', lon: 15.975, lat: 45.815, updatedAt: '2026-09-10T11:22:12.000Z',
};
const board: DepartureBoard = {
  operator: 'hz', stopId: 'a', stopName: 'Zagreb GK', status: 'live', generatedAt: new Date(NOW).toISOString(),
  departures: [{ operator: 'hz', tripId: 't', routeId: 'r', routeName: 'r', headsign: 'Sesvete', at: new Date(NOW + 600_000).toISOString() }],
};

describe('the phone place detail keeps its register notes', () => {
  it.each([['hr', hr], ['en', en]] as const)('%s: the heritage site note and the register sentence with its date', (locale, catalogue) => {
    const html = placeDetail(createDefaultI18n(locale), heritage, emptyCity(), []);
    expect(catalogue.city.siteNote.length).toBeGreaterThan(0);
    expect(html).toContain(catalogue.city.siteNote);
    expect(html).toContain(`${catalogue.city.reference} · 2026-09-10`);
  });
  it('says the Croatian notes as they were written', () => {
    expect(hr.city.siteNote).toBe('Obuhvat zaštite, ne ulaz. Pristup javnosti nije potvrđen.');
    expect(hr.city.reference).toBe('Podatak iz registra, nije provjera uživo.');
    expect(hr.city.scheduleNote).toBe('Vozni red, ne procjena dolaska. Kašnjenje linije ne mijenja ove satnice.');
  });
  it('the rail board ends with its timetable note', () => {
    expect(departuresMarkup(createDefaultI18n('hr'), board, NOW)).toContain(`<p class="city-meta">${hr.city.scheduleNote}</p></section>`);
    expect(departuresMarkup(createDefaultI18n('en'), board, NOW)).toContain(en.city.scheduleNote);
  });
});
