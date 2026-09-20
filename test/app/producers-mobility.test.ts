// Bikes, parking and waste (plan T3.2, D7): three producers behind
// FEED_BIKES / FEED_PARKING / FEED_WASTE, off until their upstream source is
// confirmed. `core/flags.ts`'s `FLAGS` is frozen in production, so this file
// replaces it with a plain, mutable stand-in it can flip per test -- the one
// way to exercise "the flag forced on" and "the flag off" in the same file.
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenStop } from '../../worker/protocol';
import bikesFixture from '../fixtures/bikes.json';
import parkingFixture from '../fixtures/parking.json';
import wasteFixture from '../fixtures/waste.json';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import type { LayerContext } from '../../app/src/layers/types';
import type { MobilitySnapshot, WasteSnapshot } from '../../app/src/core/mobility';
import { nearestStation } from '../../app/src/core/mobility';
import { walkMinutes } from '../../app/src/experience/text';
import { bikesProducer } from '../../app/src/experience/producers/bikes';
import { parkingProducer } from '../../app/src/experience/producers/parking';
import { wasteProducer } from '../../app/src/experience/producers/waste';
import { bucketOf, columnsFor, type ProduceOptions } from '../../app/src/experience/timeband';

vi.mock('../../app/src/core/flags', () => ({
  FLAGS: { FEED_BIKES: false, FEED_PARKING: false, FEED_WASTE: false, FEED_LASTRUN: false, PUSH: false },
}));

const hr = createDefaultI18n('hr');
const NOW = Date.parse('2026-09-11T12:32:00Z'); // Friday 14:32 in Zagreb (producers.test.ts's own NOW)

const BIKES = bikesFixture as unknown as MobilitySnapshot;
const PARKING = parkingFixture as unknown as MobilitySnapshot;
const WASTE = wasteFixture as unknown as WasteSnapshot;

const STOP: ScreenStop = { id: 'st1', name: 'Trg bana J. Jelačića', lon: 15.977, lat: 45.812, routes: [] };
// Sesvete: far enough from every bikes/parking fixture station that none is within 600 m.
const FAR_STOP: ScreenStop = { id: 'st2', name: 'Sesvete', lon: 16.14, lat: 45.876, routes: [] };
// Beside garage-far/bike-far (Trnje), the fixtures' other station in each module.
const TRNJE_STOP: ScreenStop = { id: 'st3', name: 'Trnjanski nasip', lon: 15.985, lat: 45.7965, routes: [] };

function ctx(over: Partial<LayerContext> = {}): LayerContext {
  return { i18n: hr, snapshots: {}, now: NOW, ...over };
}

function options(over: Partial<ProduceOptions> = {}, now = NOW): ProduceOptions {
  const columns = columnsFor(hr, now);
  return { columns, surface: 'desktop', bucket: (at, until, allDay) => bucketOf(now, columns, at, until, allDay), ...over };
}

async function setFlags(flags: Partial<{ FEED_BIKES: boolean; FEED_PARKING: boolean; FEED_WASTE: boolean }>): Promise<void> {
  const { FLAGS } = await import('../../app/src/core/flags');
  Object.assign(FLAGS, flags);
}

beforeEach(async () => {
  await setFlags({ FEED_BIKES: false, FEED_PARKING: false, FEED_WASTE: false });
});

// ---------------------------------------------------------------------------
// nearestStation (core/mobility.ts): the choice both bikes.ts and parking.ts share

describe('nearestStation', () => {
  it('picks the nearest station within 600 m of the stop over a farther one that is still within range', () => {
    expect(nearestStation(BIKES.stations, STOP)?.id).toBe('bike-near');
  });

  it('is null without a screen stop, or without one station within 600 m of it (no district fallback: D6 is removed)', () => {
    expect(nearestStation(BIKES.stations, undefined)).toBeNull();
    expect(nearestStation(BIKES.stations, FAR_STOP)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// bikesProducer

describe('bikesProducer', () => {
  it('is empty while FEED_BIKES is off, even with a live snapshot at hand', () => {
    const tiles = bikesProducer.produce(ctx({ bikes: BIKES, screen: screenWith(STOP) }), options());
    expect(tiles).toEqual([]);
  });

  it('is empty without ctx.bikes, flag or not', async () => {
    await setFlags({ FEED_BIKES: true });
    expect(bikesProducer.produce(ctx({ screen: screenWith(STOP) }), options())).toEqual([]);
  });

  it('is empty when the snapshot is down', async () => {
    await setFlags({ FEED_BIKES: true });
    const tiles = bikesProducer.produce(ctx({ bikes: { ...BIKES, status: 'down' }, screen: screenWith(STOP) }), options());
    expect(tiles).toEqual([]);
  });

  it('renders the nearest station as an xl value tile: free count, name, the walking glyph and minutes, no "pješice" word', async () => {
    await setFlags({ FEED_BIKES: true });
    const tiles = bikesProducer.produce(ctx({ bikes: BIKES, screen: screenWith(STOP) }), options());
    expect(tiles).toHaveLength(1);
    const tile = tiles[0]!;
    const minutes = walkMinutes(STOP, BIKES.stations[0]!); // bike-near
    const minutesText = hr.t('kvart.walkMinutes', { minutes });
    expect(tile).toMatchObject({
      key: 'bikes:bike-near', domain: 'mobility', variant: 'value', label: 'Bicikli', value: '4', valueSize: 'xl',
      context: 'Praška ulica', layer: 'u-pokretu', bucket: 'sada', testid: 'tile-bikes',
    });
    expect(tile.contextMarkup).toContain('icon-footprints');
    expect(tile.contextMarkup).toContain(minutesText);
    expect(tile.aria).toContain(minutesText);
    expect(tile.contextMarkup).not.toContain('pješice');
    expect(tile.aria).not.toContain('pješice');
    expect(tile.stale).toBeUndefined(); // a live snapshot carries no stale badge
  });

  it('is empty without a screen stop: no district fallback (D6 is removed), never a distant, misleading station', async () => {
    await setFlags({ FEED_BIKES: true });
    expect(bikesProducer.produce(ctx({ bikes: BIKES }), options())).toEqual([]);
  });

  it('is empty when the screen stop is too far from every station', async () => {
    await setFlags({ FEED_BIKES: true });
    expect(bikesProducer.produce(ctx({ bikes: BIKES, screen: screenWith(FAR_STOP) }), options())).toEqual([]);
  });

  it('a stale snapshot still renders the last known free count, badged rather than shown as live', async () => {
    await setFlags({ FEED_BIKES: true });
    const tiles = bikesProducer.produce(ctx({ bikes: { ...BIKES, status: 'stale' }, screen: screenWith(STOP) }), options());
    expect(tiles).toHaveLength(1);
    const tile = tiles[0]!;
    expect(tile.value).toBe('4'); // not hidden: down hides, stale does not (global constraints §1/§8)
    expect(tile.stale).toContain('data-status="stale"');
    expect(tile.stale).toContain('zastarjelo od 14:31'); // fetchedAt 2026-09-11T12:31Z in Zagreb time
  });
});

// ---------------------------------------------------------------------------
// parkingProducer (shares bikesProducer's station choice and tile shape)

describe('parkingProducer', () => {
  it('is empty while FEED_PARKING is off', () => {
    expect(parkingProducer.produce(ctx({ parking: PARKING, screen: screenWith(STOP) }), options())).toEqual([]);
  });

  it('renders the nearest garage, labelled Garaža', async () => {
    await setFlags({ FEED_PARKING: true });
    const tiles = parkingProducer.produce(ctx({ parking: PARKING, screen: screenWith(STOP) }), options());
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ key: 'parking:garage-near', domain: 'mobility', label: 'Garaža', value: '23', context: 'Importanne centar', testid: 'tile-parking' });
  });

  it('reads a station\'s zero free places as "0", never as missing data', async () => {
    await setFlags({ FEED_PARKING: true });
    const tiles = parkingProducer.produce(ctx({ parking: PARKING, screen: screenWith(TRNJE_STOP) }), options());
    expect(tiles[0]).toMatchObject({ key: 'parking:garage-far', value: '0' });
  });

  it('a stale snapshot still renders the last known free count, badged rather than shown as live', async () => {
    await setFlags({ FEED_PARKING: true });
    const tiles = parkingProducer.produce(ctx({ parking: { ...PARKING, status: 'stale' }, screen: screenWith(STOP) }), options());
    expect(tiles[0]).toMatchObject({ key: 'parking:garage-near', value: '23' });
    expect(tiles[0]!.stale).toContain('data-status="stale"');
  });
});

// ---------------------------------------------------------------------------
// wasteProducer

describe('wasteProducer', () => {
  it('is empty while FEED_WASTE is off', () => {
    expect(wasteProducer.produce(ctx({ waste: WASTE }), options())).toEqual([]);
  });

  it('is empty without ctx.waste', async () => {
    await setFlags({ FEED_WASTE: true });
    expect(wasteProducer.produce(ctx(), options())).toEqual([]);
  });

  it('is empty when the snapshot is down', async () => {
    await setFlags({ FEED_WASTE: true });
    expect(wasteProducer.produce(ctx({ waste: { ...WASTE, status: 'down' } }), options())).toEqual([]);
  });

  it('city-wide: every district\'s tomorrow and this-week pickups appear, titled by their own kind, today\'s left out, labelled "Cijeli grad" (D6 is removed: no district scoping)', async () => {
    await setFlags({ FEED_WASTE: true });
    const tiles = wasteProducer.produce(ctx({ waste: WASTE }), options());
    expect(tiles.map((t) => ({ title: t.title, bucket: t.bucket, context: t.context, domain: t.domain, variant: t.variant, testid: t.testid }))).toEqual([
      { title: 'Miješani otpad', bucket: 'sutra', context: 'Cijeli grad', domain: 'komunalno', variant: 'time', testid: 'tile-waste' },
      { title: 'Papir i karton', bucket: 'tjedan', context: 'Cijeli grad', domain: 'komunalno', variant: 'time', testid: 'tile-waste' },
      { title: 'Plastika', bucket: 'sutra', context: 'Cijeli grad', domain: 'komunalno', variant: 'time', testid: 'tile-waste' },
    ]);
    expect(tiles.every((t) => t.label === 'Odvoz')).toBe(true);
    expect(tiles.every((t) => t.stale === undefined)).toBe(true); // live snapshot: no stale badge
  });

  it('a stale snapshot still renders the last known pickups, every tile badged rather than shown as live', async () => {
    await setFlags({ FEED_WASTE: true });
    const tiles = wasteProducer.produce(ctx({ waste: { ...WASTE, status: 'stale' } }), options());
    expect(tiles).toHaveLength(3); // same pickups as the live case: stale is not hidden
    expect(tiles.every((t) => t.stale?.includes('data-status="stale"'))).toBe(true);
    expect(tiles[0]!.stale).toContain('zastarjelo od 14:00'); // fetchedAt 2026-09-11T12:00Z in Zagreb time
  });
});

function screenWith(stop: ScreenStop): LayerContext['screen'] {
  return { surface: 'desktop', locale: 'hr', theme: 'light', themePreference: 'light', lightweight: false, reducedMotion: false, stop };
}
