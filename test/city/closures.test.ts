// U0 step 6 (docs/upgrade-2026-10-plan/U0.md, acceptance U0-4): rolling closure ends, on the two copies of the City's
// closures dataset a night apart (test/fixtures/prometnice-rolling/README.md), each read at its own fetch time.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { selectNearby } from '../../app/src/city/nearby';
import { sentenceFacts } from '../../app/src/city/sentence';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { CLOSURE_ROLLING_AGE_D, closureEndKnown } from '../../shared/city/closures';
import type { ScreenPlace } from '../../shared/city/place';
import { emptyCity } from '../../shared/city/types';
import { parsePrometnice } from '../../worker/feed/modules/prometnice';
import type { FeedItem, ModuleSnapshot } from '../../worker/feed/schema';

const DIR = join(import.meta.dirname, '..', 'fixtures', 'prometnice-rolling');
const COPIES = [
  { file: 'sun-2205Z.json', fetchedAt: '2026-09-27T22:05:01Z' },
  { file: 'mon-0800Z.json', fetchedAt: '2026-09-28T08:00:01Z' },
] as const;
const closures = (file: string): FeedItem[] => parsePrometnice(JSON.parse(readFileSync(join(DIR, file), 'utf8'))).items
  .map((item) => ({ ...item, module: 'prometnice' as const, tier: 'open' as const }));

describe('closureEndKnown on the two copies of the dataset', () => {
  it.each(COPIES)('$file at its fetch time: 38 of 39 ends are rolling placeholders, Jazbina\'s is known', ({ file, fetchedAt }) => {
    const now = Date.parse(fetchedAt);
    const items = closures(file);
    expect(items).toHaveLength(39);
    const known = items.filter((item) => closureEndKnown(item, now));
    expect(known.map((item) => item.title)).toEqual(['Jazbina']);
  });

  it('needs both an age over seven days and an end less than a day away; an unparsed window is known', () => {
    const now = Date.parse('2026-09-28T08:00:00Z');
    const day = 86_400_000;
    const at = (ms: number): string => new Date(ms).toISOString();
    expect(CLOSURE_ROLLING_AGE_D).toBe(7);
    expect(closureEndKnown({ at: at(now - 8 * day), until: at(now + 6 * 3_600_000) }, now)).toBe(false);
    expect(closureEndKnown({ at: at(now - 6 * day), until: at(now + 6 * 3_600_000) }, now)).toBe(true);
    expect(closureEndKnown({ at: at(now - 8 * day), until: at(now + day) }, now)).toBe(true);
    expect(closureEndKnown({ at: at(now - 8 * day), until: at(now - 1) }, now)).toBe(true);
    expect(closureEndKnown({ until: at(now + 3_600_000) }, now)).toBe(true);
  });
});

describe('the Monday copy on the wall at Trg bana J. Jelačića', () => {
  it('lists its closure rows with an unknown end and gives the header no closureUntil fact', () => {
    const now = Date.parse(COPIES[1].fetchedAt);
    const i18n = createDefaultI18n('hr');
    const place: ScreenPlace = { kind: 'tram', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, stopId: '106_1' };
    const prometnice: ModuleSnapshot = {
      module: 'prometnice', tier: 'open', status: 'live', fetchedAt: COPIES[1].fetchedAt,
      attribution: { text: 'Grad Zagreb', url: 'https://data.zagreb.hr', licence: 'Otvorena dozvola' }, items: closures('mon-0800Z.json'),
    };
    const input = { place, radiusM: 2200, now, boards: [], fixes: [], snapshots: { prometnice }, city: emptyCity(), lastRun: null, locale: 'hr', i18n };
    const rows = selectNearby(input).filter((row) => row.kind === 'closure');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.endKnown === false)).toBe(true);
    const facts = sentenceFacts({ place, radiusM: 2200, rows, snapshots: { prometnice }, city: emptyCity(), now, outage: false, locale: 'hr', i18n });
    expect(facts.filter((fact) => fact.id.startsWith('closure:'))).toEqual([]);
  });
});
