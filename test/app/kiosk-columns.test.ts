import { describe, expect, it } from 'vitest';
import { columnsFor, zagrebInstant } from '../../app/src/kiosk/columns';
import * as timeband from '../../app/src/experience/timeband';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';

// The time columns moved out of the phone's time band (WP4) so the paired
// wall keeps them when WP5 deletes experience/timeband.ts. The band's own
// tests (timeband.test.ts) pin every worked example through the re-export;
// these pin the module the wall now imports, so they outlive that file.

const hr = createDefaultI18n('hr');
const at = (iso: string): number => Date.parse(iso);

describe('kiosk/columns', () => {
  it('is what experience/timeband re-exports, one implementation', () => {
    expect(timeband.columnsFor).toBe(columnsFor);
    expect(timeband.zagrebInstant).toBe(zagrebInstant);
  });

  it('reads a Zagreb wall-clock hour on either side of the DST cuts', () => {
    expect(zagrebInstant('2026-09-11', 18)).toBe(at('2026-09-11T16:00:00Z'));
    expect(zagrebInstant('2026-10-25', 4)).toBe(at('2026-10-25T03:00:00Z'));
    expect(zagrebInstant('2026-03-29', 4)).toBe(at('2026-03-29T02:00:00Z'));
    expect(zagrebInstant('sutra', 4)).toBeNaN();
  });

  it('gives the day five columns and the evening four, with the windows the wall filters by', () => {
    const afternoon = at('2026-09-11T12:32:00Z'); // Fri 14:32
    const day = columnsFor(hr, afternoon);
    expect(day.map((c) => c.id)).toEqual(['sada', 'danas', 'veceras', 'sutra', 'tjedan']);
    expect(day.find((c) => c.id === 'veceras')).toMatchObject({ label: 'večeras', start: at('2026-09-11T16:00:00Z'), end: at('2026-09-12T02:00:00Z') });

    const evening = at('2026-09-11T17:40:00Z'); // Fri 19:40
    const night = columnsFor(hr, evening);
    expect(night.map((c) => c.id)).toEqual(['sada', 'veceras', 'sutra', 'tjedan']);
    expect(night[1]).toMatchObject({ label: 'noćas', head: 'do 04:00', start: evening, end: at('2026-09-12T02:00:00Z') });
  });
});
