// The phone's place detail keeps its register notes (review of lane/c-A1, P2): §13 #12 and #13
// take the register sentence and the heritage site note off the WALL only (WP5 B1, steps 8-9),
// and the rail board keeps its timetable note. e2e/city.spec.ts reads the site note on the phone.
// The phone's renderers vet third-party text through the boundary, which refuses everything until the policy is installed: load it here as the page's chunks do.
import '../../shared/kiosk/external-text';
import { describe, expect, it } from 'vitest';
import en from '../../app/src/i18n/en.json';
import hr from '../../app/src/i18n/hr.json';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { departuresMarkup, placeDetail, streetDetail } from '../../app/src/city/markup';
import { emptyCity, type DepartureBoard, type Place, type StreetStory } from '../../shared/city/types';

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

// WP5 B1 (step 8): the wall's copy of the same detail (publicDisplay, kiosk/paired.ts) carries
// none of the phone's notes, no observation or register time and no control (§12 "Never", [O-43]).
describe('the wall place detail carries no note, time or control', () => {
  const i18n = createDefaultI18n('hr');
  const bike = (fresh: boolean): Place => ({
    id: 'bajs-1', category: 'cycle-parking', name: 'Trg bana Jelačića', sourceId: 'bajs', sourceRecord: 'b1', lon: 15.977, lat: 45.813,
    updatedAt: '2026-09-20T11:58:00.000Z', facts: { fresh, bikes: 4, docks: 6 },
  });
  const air: Place = { id: 'air-1', category: 'air', name: 'Zagreb-1', sourceId: 'air', sourceRecord: 'a1', lon: 15.97, lat: 45.8, updatedAt: '2026-09-20T11:00:00.000Z', facts: { index: 2 } };
  const street: StreetStory = { id: 's1', name: 'Tkalčićeva ulica', settlement: 'Zagreb', settlementId: 'z', description: 'Ulica je dobila ime po Ivanu Tkalčiću, povjesničaru.', updatedAt: '2026-09-01' };
  const CAVEAT = /Obuhvat zaštite|Podatak iz registra|Preliminarni indeks|Podatak od|nije potvrđeno|\d\d:\d\d|2026-09-\d\d|data-action/;
  it('heritage: no site note and no register sentence; the phone keeps both', () => {
    const wall = placeDetail(i18n, heritage, emptyCity(), [], false, true);
    expect(wall).toContain('Kamenita vrata');
    expect(wall).not.toMatch(CAVEAT);
    expect(placeDetail(i18n, heritage, emptyCity(), [])).toContain(hr.city.siteNote);
  });
  it('BAJS: the counts without their observation time; a count that is not fresh says the stale word', () => {
    const fresh = placeDetail(i18n, bike(true), emptyCity(), [], false, true);
    expect(fresh).toContain('city-bike-count');
    expect(fresh).not.toMatch(CAVEAT);
    const old = placeDetail(i18n, bike(false), emptyCity(), [], false, true);
    expect(old).not.toMatch(CAVEAT);
    expect(old).toContain(`<p class="city-meta">${hr.city.stale}</p>`);
    expect(placeDetail(i18n, bike(true), emptyCity(), [])).toMatch(/Podatak od · \d\d:\d\d/);
  });
  it('air: the index alone, without the station note or its time', () => {
    const wall = placeDetail(i18n, air, emptyCity(), [], false, true);
    expect(wall).toContain(hr.city.air);
    expect(wall).not.toMatch(CAVEAT);
    expect(wall).not.toContain('data-city-air');
    expect(placeDetail(i18n, air, emptyCity(), [])).toContain(hr.city.airNote);
  });
  it('street story: the credit without the register date and no back button; the phone keeps both', () => {
    const wall = streetDetail(i18n, street, true);
    expect(wall).toContain('Grad Zagreb · Registar naziva ulica · Otvorena dozvola');
    expect(wall).not.toMatch(CAVEAT);
    expect(wall).not.toContain('<button');
    const phone = streetDetail(i18n, street);
    expect(phone).toContain('Registar naziva ulica · 2026-09-01 · Otvorena dozvola');
    expect(phone).toContain('data-action="clear-selection"');
  });
});
