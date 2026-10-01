// @vitest-environment happy-dom
// The voice rules per state on the strike Monday wall at Jelačić (upgrade U2, S4 and S5): the committed
// wall fixture of 28 September 2026, 07:45 Zagreb (test/fixtures/wall/2026-09-28-0745/), read with the
// calls of the strike seed (review.local/strike/scratch/replay-nearby.ts): selectNearby, then
// sentenceFacts, at 05:47:00Z, with the twin's judgement (sources.zet.service) injected into the teaser.
// The rows never change; the header and the map note do, and never with a cause.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import '../../shared/kiosk/external-text';
import { selectNearby, type NearbyRow } from '../../app/src/city/nearby';
import { sentenceFacts, type CitySentenceFact } from '../../app/src/city/sentence';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { mountInvitation, wallMapNote } from '../../app/src/kiosk/invitation';
import { byModule } from '../../app/src/kiosk/local';
import { feedStateOf, vehiclePoints } from '../../app/src/kiosk/mapview';
import { kioskStrings } from '../../app/src/kiosk/strings';
import type { ScreenStop } from '../../app/src/core/contracts';
import { canonicalPlaces } from '../../shared/city/events';
import { DEFAULT_FRAME_STOPS } from '../../shared/city/frame';
import { placeFromStop } from '../../shared/city/place';
import type { ZetService } from '../../shared/city/service-wire';
import { emptyCity, type CityState, type DepartureBoard, type Place } from '../../shared/city/types';
import type { ModuleSnapshot } from '../../worker/feed/schema';

const ROOT = join(import.meta.dirname, '../fixtures/wall/2026-09-28-0745');
const read = <T>(file: string): T => JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as T;
const hr = createDefaultI18n('hr');
const strings = kioskStrings('hr');
const NOW = Date.parse('2026-09-28T05:47:00Z');
const stops = read<ScreenStop[]>('stops.json');
const city = { ...emptyCity(), places: canonicalPlaces(read<Place[]>('places.json')) } as CityState;
const boards = ['106_1', '106_2'].map((id) => `boards/${id}.json`).filter((file) => existsSync(join(ROOT, file))).map((file) => read<DepartureBoard>(file));
const recorded = read<{ modules: ModuleSnapshot[] }>('teaser.json').modules;
const place = placeFromStop(stops.find((stop) => stop.id === '106_1')!, (route) => Number(route) < 100);
const TIMETABLE_WORDINGS = ['departureIn', 'departureAt', 'busIn', 'busAt', 'lastTram', 'firstTram'];

/** The recorded teaser with the twin's judgement on sources.zet, as the twin of upgrade U2 publishes it. */
function withService(service: ZetService | undefined): ModuleSnapshot[] {
  return recorded.map((module) => module.module !== 'zet-rt' || !service ? module
    : { ...module, sources: { ...module.sources, zet: { ...module.sources!.zet!, service } } });
}
function judgement(over: Partial<ZetService>): ZetService {
  return {
    state: 'silent', since: '2026-09-28T05:40:54Z', observedAt: '2026-09-28T05:46:58Z', expected: 460, seen: 2, ratio: 0,
    confidence: 1, baseline: 'declared', byMode: { tram: [0, 140], bus: [2, 320] }, ...over,
  };
}
/** The wall at 05:47:00Z: the seed's selectNearby, then the header's facts from the very same rows. */
function wall(modules: ModuleSnapshot[]): { rows: NearbyRow[]; facts: CitySentenceFact[]; outage: boolean; snapshots: ReturnType<typeof byModule> } {
  const snapshots = byModule(modules);
  const outage = feedStateOf(snapshots['zet-rt']) === 'down';
  const rows = selectNearby({ place, radiusM: 2200, now: NOW, boards, fixes: outage ? [] : vehiclePoints(snapshots['zet-rt'], NOW),
    snapshots, city, lastRun: null, locale: 'hr', i18n: hr, stops });
  const facts = sentenceFacts({ place, radiusM: 2200, rows, snapshots, city, now: NOW, outage, locale: 'hr', i18n: hr }) as CitySentenceFact[];
  return { rows, facts, outage, snapshots };
}
const departures = (rows: readonly NearbyRow[]) => rows.filter((row) => row.kind === 'departure');
const timetableFacts = (facts: readonly CitySentenceFact[]) => facts.filter((fact) => TIMETABLE_WORDINGS.includes(fact.wording ?? ''));

describe('the strike Monday wall at Jelačić, 05:47:00Z', () => {
  const asRecorded = wall(recorded);

  it('as recorded (no judgement on the wire): today\'s facts, timetable departures included, and no map note', () => {
    expect(departures(asRecorded.rows).length).toBeGreaterThanOrEqual(2);
    expect(timetableFacts(asRecorded.facts).length).toBeGreaterThan(0);
    expect(asRecorded.facts.some((fact) => fact.id === 'service:zet')).toBe(false);
    expect(wallMapNote({ zet: asRecorded.snapshots['zet-rt'], now: NOW, outage: asRecorded.outage, strings, i18n: hr })).toBeNull();
  });

  it('silent: no timetable promise at all, the deviation said once with its numbers, and the silent note on the map', () => {
    const silent = wall(withService(judgement({ routes: { '6': [0, 9], '11': [0, 8], '12': [0, 8], '14': [0, 7], '17': [0, 6] } })));
    // The rows never change: the same departures, still grey clocks.
    expect(silent.rows.map((row) => row.id)).toEqual(asRecorded.rows.map((row) => row.id));
    expect(timetableFacts(silent.facts)).toEqual([]);
    expect(silent.facts.some((fact) => fact.id.startsWith('dep:'))).toBe(false);
    const service = silent.facts.filter((fact) => fact.id === 'service:zet');
    expect(service.map((fact) => fact.text)).toEqual(['ZET: u pokretu 2 vozila, po voznom redu oko 460.']);
    expect(silent.facts[0]!.id).toBe('service:zet');
    expect(service[0]).toMatchObject({ kind: 'promet', factKey: 'service:zet', wording: 'service' });
    expect(silent.facts.map((fact) => fact.text).join(' ')).not.toMatch(/štrajk|strike/iu);

    const note = wallMapNote({ zet: silent.snapshots['zet-rt'], now: NOW, outage: silent.outage, strings, i18n: hr });
    expect(note).toBe('ZET: u pokretu 2 vozila, po voznom redu oko 460. Polasci su iz voznog reda, bez potvrde vozila.');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const invitation = mountInvitation(host, { strings, i18n: hr, locale: 'hr', lightweight: false, reducedMotion: true });
    const mapNote = () => host.querySelector<HTMLElement>('[data-testid=map-note]')!;
    const model = { items: silent.rows, radiusM: 2200, frame: DEFAULT_FRAME_STOPS, modules: withService(judgement({})), stop: null, now: NOW, composition: 'wide' as const, reveal: null, next: [] };
    invitation.update({ ...model, note });
    expect(mapNote().hidden).toBe(false);
    expect(mapNote().textContent).toBe(note);
    invitation.update({ ...model, note: null });
    expect(mapNote().hidden).toBe(true);
    invitation.destroy();
    host.remove();
  });

  it('silent with no vehicle at all: the no-vehicle form', () => {
    const none = wall(withService(judgement({ seen: 0, byMode: { tram: [0, 140], bus: [0, 320] } })));
    expect(none.facts.filter((fact) => fact.id === 'service:zet').map((fact) => fact.text))
      .toEqual(['ZET: nijedno vozilo u pokretu, po voznom redu oko 460.']);
  });

  it('reduced: timetable facts only for the line the twin still sees running, and no map note', () => {
    const lead = departures(asRecorded.rows)[0]!.arrival!.routeId;
    const others = [...new Set(departures(asRecorded.rows).map((row) => row.arrival!.routeId))].filter((route) => route !== lead);
    expect(others.length).toBeGreaterThan(0);
    const reduced = wall(withService(judgement({ state: 'reduced', seen: 190, ratio: 0.41, byMode: { tram: [20, 140], bus: [170, 320] },
      routes: Object.fromEntries(others.map((route) => [route, [0, 6]])) })));
    expect(reduced.rows.map((row) => row.id)).toEqual(asRecorded.rows.map((row) => row.id));
    const said = timetableFacts(reduced.facts);
    expect(said.length).toBeGreaterThan(0);
    for (const fact of said) expect(fact.factKey, fact.text).toMatch(new RegExp(`^departure:${lead}:`));
    expect(reduced.facts.filter((fact) => fact.id === 'service:zet').map((fact) => fact.text))
      .toEqual(['ZET: u pokretu 190 vozila, po voznom redu oko 460.']);
    expect(wallMapNote({ zet: reduced.snapshots['zet-rt'], now: NOW, outage: reduced.outage, strings, i18n: hr })).toBeNull();
  });
});
