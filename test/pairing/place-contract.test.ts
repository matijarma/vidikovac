// Seam S1 (the screen protocol's place-v2 additions) and the WP3 step 0 stubs
// around seam S3: every named export imported, the trivial contract checked.
// Behaviour (validation, enrichment, suggestions) is WP3's and is tested
// where it lands; the DO's re-export of SCREEN_SET_MIN_MS is covered by
// test/pairing/beacon-do.workers.test.ts, which imports it from the DO.
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  BEACON_CAPABILITIES,
  SCREEN_SET_ERRORS,
  SCREEN_SET_MIN_MS,
  type BeaconCapability,
  type BeaconClientMessage,
  type CreateBeaconRequest,
  type FrameStops,
  type ScreenMetadata,
  type ScreenPlace,
  type ScreenPlaceInput,
  type ScreenSetError,
} from '../../worker/protocol';
import { enrichPlace, isTramRoute, parseFrame, parsePlaceInput, resolvePlace, type EnrichedPlace } from '../../worker/pairing/place';
import { anchorOf, placeInputOf, suggestPlaces, type PlaceSuggestion, type StreetGeo } from '../../app/src/kiosk/places';
import type { RankedStop } from '../../app/src/kiosk/stops';

const TRG: ScreenPlace = { kind: 'tram', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, stopId: '106_1' };

describe('S1: worker/protocol.ts place-v2', () => {
  it('moves the screen-set window here, five seconds as before', () => {
    expect(SCREEN_SET_MIN_MS).toBe(5_000);
  });

  it('whitelists the two kiosk capabilities', () => {
    expect(BEACON_CAPABILITIES).toEqual(['city-v1', 'place-v2']);
    expectTypeOf<BeaconCapability>().toEqualTypeOf<'city-v1' | 'place-v2'>();
  });

  it('names every word a screen-set can be refused with, bad-place and bad-frame included', () => {
    expect(SCREEN_SET_ERRORS).toEqual(['bad-area', 'bad-stop', 'bad-place', 'bad-frame', 'screen-set-rate']);
    expectTypeOf<ScreenSetError>().toEqualTypeOf<'bad-area' | 'bad-stop' | 'bad-place' | 'bad-frame' | 'screen-set-rate'>();
  });

  it('keeps screen-set version 1 beside version 2', () => {
    const v1: BeaconClientMessage = { t: 'screen-set', version: 1, stopId: '106_1', area: 'zagreb' };
    const v2stop: BeaconClientMessage = { t: 'screen-set', version: 2, place: { kind: 'stop', stopId: '236_2' }, frame: 8 };
    const v2city: BeaconClientMessage = { t: 'screen-set', version: 2, place: null, frame: 6 };
    const v2address: BeaconClientMessage = {
      t: 'screen-set', version: 2, place: { kind: 'address', name: 'Ilica', lon: 15.97, lat: 45.8135, address: 'Ilica 25' }, frame: 4,
    };
    for (const message of [v1, v2stop, v2city, v2address]) expect(JSON.parse(JSON.stringify(message))).toEqual(message);
    expectTypeOf<Extract<BeaconClientMessage, { t: 'screen-set'; version: 2 }>['frame']>().toEqualTypeOf<FrameStops>();
    expectTypeOf<Extract<BeaconClientMessage, { t: 'screen-set'; version: 2 }>['place']>().toEqualTypeOf<ScreenPlaceInput | null>();
  });

  it('carries place, placeSet and frame on the screen metadata, all optional', () => {
    const before: ScreenMetadata = { kind: 'temporary', expiresAt: null, stop: null, area: 'zagreb' };
    const chosen: ScreenMetadata = { ...before, place: TRG, placeSet: true, frame: 6 };
    const wholeCity: ScreenMetadata = { ...before, place: TRG, placeSet: false, frame: 6 };
    expect(before.place).toBeUndefined();
    expect(chosen.placeSet).toBe(true);
    expect(wholeCity.place?.stopId).toBe('106_1');
    expectTypeOf<ScreenMetadata['place']>().toEqualTypeOf<ScreenPlace | null | undefined>();
    expectTypeOf<ScreenMetadata['frame']>().toEqualTypeOf<FrameStops | undefined>();
  });

  it('lets the admin create request name a place and a frame', () => {
    const request: CreateBeaconRequest = { venueType: 'ostalo', area: 'zagreb', operatorLabel: 'x', place: { kind: 'stop', stopId: '106_1' }, frame: 6 };
    expect(request.place).toEqual({ kind: 'stop', stopId: '106_1' });
  });
});

describe('WP3 step 0: worker/pairing/place.ts', () => {
  it('knows a tram route from a bus route by the GTFS route type', () => {
    expect(isTramRoute('6')).toBe(true);
    expect(isTramRoute('34')).toBe(true);
    expect(isTramRoute('101')).toBe(false);
    expect(isTramRoute('no-such-route')).toBe(false);
  });

  it('accepts only the frames 4, 6 and 8', () => {
    expect([4, 6, 8].map(parseFrame)).toEqual([4, 6, 8]);
    expect([5, '6', null, undefined, 6.5].map(parseFrame)).toEqual([null, null, null, null, null]);
  });

  it('exposes the validation and enrichment signatures WP3 fills', () => {
    expect(typeof parsePlaceInput).toBe('function');
    expect(typeof resolvePlace).toBe('function');
    expect(typeof enrichPlace).toBe('function');
    expectTypeOf(parsePlaceInput).returns.toEqualTypeOf<ScreenPlaceInput | null>();
    expectTypeOf(resolvePlace).returns.toEqualTypeOf<ScreenPlace | null>();
    expectTypeOf(enrichPlace).returns.toEqualTypeOf<EnrichedPlace>();
  });
});

describe('WP3 step 0: app/src/kiosk/places.ts', () => {
  const stop: RankedStop = { id: '236_2', name: 'Kvaternikov trg', lon: 16.0, lat: 45.815, routes: ['4'], distanceM: 0 } as RankedStop;
  const ilica: StreetGeo = { name: 'Ilica', lon: 15.955, lat: 45.8125, bbox: [15.92, 45.80, 15.98, 45.82], lengthM: 5200, stops: ['105_1'] };

  it('anchors a stop, a street and a segment', () => {
    expect(anchorOf({ kind: 'stop', stop })).toEqual({ lon: 16.0, lat: 45.815, name: 'Kvaternikov trg' });
    expect(anchorOf({ kind: 'street', street: ilica, number: '25' })).toEqual({ lon: 15.955, lat: 45.8125, name: 'Ilica', address: 'Ilica 25' });
    expect(anchorOf({ kind: 'street', street: ilica })).toEqual({ lon: 15.955, lat: 45.8125, name: 'Ilica' });
    expect(anchorOf({ kind: 'segment', street: ilica, stop })).toEqual({ lon: 16.0, lat: 45.815, name: 'Ilica', address: 'Ilica · Kvaternikov trg' });
  });

  it('sends a stop by its id only and an address with its point', () => {
    expect(placeInputOf(TRG)).toEqual({ kind: 'stop', stopId: '106_1' });
    expect(placeInputOf({ ...TRG, address: 'Trg bana Josipa Jelačića 3' })).toEqual({ kind: 'stop', stopId: '106_1', address: 'Trg bana Josipa Jelačića 3' });
    expect(placeInputOf({ kind: 'address', name: 'Ilica', lon: 15.97, lat: 45.8135, address: 'Ilica 25' }))
      .toEqual({ kind: 'address', name: 'Ilica', lon: 15.97, lat: 45.8135, address: 'Ilica 25' });
  });

  it('answers suggestPlaces with a list (empty until WP3 step 2)', () => {
    const out: PlaceSuggestion[] = suggestPlaces('Kvatern', [stop], [ilica]);
    expect(Array.isArray(out)).toBe(true);
  });
});
