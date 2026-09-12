import { describe, expect, it } from 'vitest';
import { DATA_KEYS } from '../../worker/feed/schema';
import type { ItemKind, ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import { MODULES, MODULE_IDS } from '../../worker/feed/registry';
import { FIXTURE_CONTEXTS, FIXTURE_NOW } from './fixture-contexts';

const EXPECTED_KINDS: Record<ModuleId, ItemKind[]> = {
  'zet-rt': ['vehicle'],
  prometnice: ['closure'],
  'dhmz-now': ['observation'],
  'dhmz-forecast': ['forecast'],
  'dhmz-cap': ['warning'],
  emsc: ['quake'],
  'hrt-news': ['news'],
  glasnik: ['act'],
  'ckan-geo': ['poi'],
  dogadanja: ['event'],
};

describe.each(MODULE_IDS)('module %s against its real upstream sample', (id) => {
  let snapshot: Omit<ModuleSnapshot, 'status' | 'staleSince'>;

  it('produces at least one item through the registry fetcher', async () => {
    snapshot = await MODULES[id].fetcher(FIXTURE_CONTEXTS[id]);
    expect(snapshot.items.length).toBeGreaterThan(0);
  });

  it('stamps the registry identity on the snapshot and on every item', async () => {
    snapshot ??= await MODULES[id].fetcher(FIXTURE_CONTEXTS[id]);
    expect(snapshot.module).toBe(id);
    expect(snapshot.tier).toBe(MODULES[id].tier);
    expect(snapshot.attribution).toEqual(MODULES[id].attribution);
    expect(snapshot.fetchedAt).toBe(FIXTURE_NOW.toISOString());
    for (const item of snapshot.items) {
      expect(item.module, `module of ${item.id}`).toBe(id);
      expect(item.tier, `tier of ${item.id}`).toBe(MODULES[id].tier);
      expect(item.id).toBeTruthy();
      expect(item.title).toBeTruthy();
    }
  });

  it('uses only the kinds this module declares', async () => {
    snapshot ??= await MODULES[id].fetcher(FIXTURE_CONTEXTS[id]);
    const kinds = new Set(snapshot.items.map((item) => item.kind));
    for (const kind of kinds) expect(EXPECTED_KINDS[id]).toContain(kind);
  });

  it('writes every date as a round-trippable ISO 8601 instant', async () => {
    snapshot ??= await MODULES[id].fetcher(FIXTURE_CONTEXTS[id]);
    const dates = [
      snapshot.sourceUpdatedAt,
      ...snapshot.items.flatMap((item) => [item.at, item.until]),
    ].filter((value): value is string => value !== undefined);
    for (const date of dates) {
      expect(date, `not ISO 8601: ${date}`).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(date).toISOString()).toBe(date);
    }
  });

  it('keeps geometry in GeoJSON order and inside a plausible Zagreb window', async () => {
    snapshot ??= await MODULES[id].fetcher(FIXTURE_CONTEXTS[id]);
    for (const item of snapshot.items) {
      if (!item.geo) continue;
      const points = item.geo.type === 'Point' ? [item.geo.coordinates as number[]] : (item.geo.coordinates as number[][]);
      for (const [lon, lat] of points) {
        expect(Number.isFinite(lon) && Number.isFinite(lat), `bad point in ${item.id}`).toBe(true);
        expect(lon).toBeGreaterThan(10);
        expect(lon).toBeLessThan(22);
        expect(lat).toBeGreaterThan(40);
        expect(lat).toBeLessThan(50);
      }
    }
  });

  it('keeps item.data flat and free of undefined', async () => {
    snapshot ??= await MODULES[id].fetcher(FIXTURE_CONTEXTS[id]);
    for (const item of snapshot.items) {
      for (const [key, value] of Object.entries(item.data ?? {})) {
        expect(['string', 'number', 'boolean'], `${item.id}.${key}`).toContain(typeof value);
      }
    }
  });

  // The contract the dashboard reads through dataNumber/dataText (R-22, R-50).
  // Anything outside DATA_KEYS renders as a dash on the phone, so it fails here.
  it('emits only the data keys DATA_KEYS declares for the item kind', async () => {
    snapshot ??= await MODULES[id].fetcher(FIXTURE_CONTEXTS[id]);
    for (const item of snapshot.items) {
      for (const key of Object.keys(item.data ?? {})) {
        expect(DATA_KEYS[item.kind], `${id} ${item.kind} item ${item.id}`).toContain(key);
      }
    }
  });
});

describe('the open tier is exactly the safety tier', () => {
  it('never leaks a session module into an open snapshot', async () => {
    for (const id of MODULE_IDS) {
      const snapshot = await MODULES[id].fetcher(FIXTURE_CONTEXTS[id]);
      const tiers = new Set(snapshot.items.map((item) => item.tier));
      expect([...tiers]).toEqual(snapshot.items.length ? [MODULES[id].tier] : []);
    }
  });
});
