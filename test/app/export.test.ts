import { describe, expect, it, vi } from 'vitest';
import type { FeedItem, ModuleSnapshot } from '../../worker/feed/schema';
import {
  attributionBlock,
  copyWithAttribution,
  geojsonForClosures,
  icsForItems,
  ICS_PRODID,
  printAct,
  shareLink,
} from '../../app/src/export';

const ATTR = {
  text: "Sadrži informacije Grada Zagreba (data.zagreb.hr) u skladu s Otvorenom dozvolom; skup 'Zatvaranje prometnica na području Grada Zagreba', posljednja izmjena 11. 9. 2026.",
  url: 'https://data.zagreb.hr/dataset/prometnice',
  licence: 'Otvorena dozvola (NN 67/17)',
};
const CLOSURE: FeedItem = {
  id: 'c1', module: 'prometnice', kind: 'closure', tier: 'open',
  title: 'Grada Vukovara', summary: 'Radovi; promet preusmjeren',
  at: '2026-09-11T05:00:00Z', until: '2026-09-11T20:00:00Z',
  geo: { type: 'LineString', coordinates: [[15.9599, 45.7993], [15.9573, 45.7993]] },
  data: { type: 'ROAD_CLOSED', subtype: 'ROAD_CLOSED_CONSTRUCTION', direction: 'ONE_DIRECTION' },
};
const SNAPSHOT: ModuleSnapshot = {
  module: 'prometnice', tier: 'open', status: 'live',
  fetchedAt: '2026-09-11T12:30:00Z', attribution: ATTR, items: [CLOSURE],
};

describe('copyWithAttribution', () => {
  it('appends the source line, the link and the licence, and reports success', async () => {
    const writeText = vi.fn(async () => {});
    expect(await copyWithAttribution('Grada Vukovara: zatvoreno', ATTR, { clipboard: { writeText } })).toBe(true);
    expect(writeText).toHaveBeenCalledWith(`Grada Vukovara: zatvoreno\n\n${ATTR.text}\n${ATTR.url}\n${ATTR.licence}`);
    expect(attributionBlock(ATTR)).toBe(`${ATTR.text}\n${ATTR.url}\n${ATTR.licence}`);
  });
  it('reports failure instead of throwing when the clipboard refuses or is absent', async () => {
    expect(await copyWithAttribution('x', ATTR, { clipboard: { writeText: async () => { throw new Error('denied'); } } })).toBe(false);
    expect(await copyWithAttribution('x', ATTR, { clipboard: undefined })).toBe(false);
  });
});

describe('shareLink', () => {
  it('uses the native share sheet when there is one', async () => {
    const share = vi.fn(async () => {});
    expect(await shareLink('https://zagreb.aningfilm.hr/', 'Vidikovac', { share })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'Vidikovac', url: 'https://zagreb.aningfilm.hr/' });
  });
  it('falls back to the clipboard, and says so', async () => {
    const writeText = vi.fn(async () => {});
    expect(await shareLink('https://x.test/', 'T', { clipboard: { writeText } })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('https://x.test/');
  });
  it('a cancelled share is not an error and is not silently copied', async () => {
    const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
    const writeText = vi.fn(async () => {});
    expect(await shareLink('https://x.test/', 'T', { share: async () => { throw abort; }, clipboard: { writeText } })).toBe('failed');
    expect(writeText).not.toHaveBeenCalled();
  });
  it('a failed share falls back to the clipboard', async () => {
    const writeText = vi.fn(async () => {});
    expect(await shareLink('https://x.test/', 'T', { share: async () => { throw new Error('no'); }, clipboard: { writeText } })).toBe('copied');
  });
});

describe('icsForItems', () => {
  const ics = icsForItems([CLOSURE], ATTR, { now: new Date('2026-09-11T12:32:00Z') });
  it('is a valid single-event calendar with CRLF line endings', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain(`PRODID:${ICS_PRODID}`);
    expect(ics).toContain('VERSION:2.0');
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
    expect(ics).toContain('UID:c1@zagreb.aningfilm.hr');
    expect(ics).toContain('DTSTAMP:20260911T123200Z');
  });
  it('takes DTSTART from at and DTEND from until', () => {
    expect(ics).toContain('DTSTART:20260911T050000Z');
    expect(ics).toContain('DTEND:20260911T200000Z');
  });
  it('carries the title in SUMMARY and the attribution in DESCRIPTION', () => {
    expect(ics).toContain('SUMMARY:Grada Vukovara');
    expect(ics.replace(/\r\n /g, '')).toContain('Radovi\\; promet preusmjeren');
    expect(ics.replace(/\r\n /g, '')).toContain('Otvorena dozvola (NN 67/17)');
  });
  it('folds long lines at 75 octets and escapes commas and semicolons', () => {
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
    const comma = icsForItems([{ ...CLOSURE, title: 'Ilica, Frankopanska' }]);
    expect(comma).toContain('SUMMARY:Ilica\\, Frankopanska');
  });
  it('uses a one-hour duration when the item has no end, and skips items with no start', () => {
    const open = icsForItems([{ ...CLOSURE, until: undefined }]);
    expect(open).toContain('DURATION:PT1H');
    expect(open).not.toContain('DTEND');
    expect(icsForItems([{ ...CLOSURE, at: undefined }])).not.toContain('BEGIN:VEVENT');
  });
});

describe('geojsonForClosures', () => {
  const fc = geojsonForClosures(SNAPSHOT);
  it('marks the data as adapted at both levels and carries the attribution', () => {
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.adapted).toBe(true);
    expect(fc.attribution).toEqual(ATTR);
    expect(fc.features[0]!.properties.adapted).toBe(true);
    expect(fc.features[0]!.properties.attribution).toBe(ATTR.text);
    expect(fc.features[0]!.properties.licence).toBe(ATTR.licence);
  });
  it('keeps the geometry and the closure fields', () => {
    expect(fc.features[0]!.geometry).toEqual({ type: 'LineString', coordinates: [[15.9599, 45.7993], [15.9573, 45.7993]] });
    expect(fc.features[0]!.properties).toMatchObject({ id: 'c1', title: 'Grada Vukovara', type: 'ROAD_CLOSED', subtype: 'ROAD_CLOSED_CONSTRUCTION', direction: 'ONE_DIRECTION' });
    expect(JSON.parse(JSON.stringify(fc))).toEqual(fc);
  });
  it('drops items without geometry rather than emitting null geometries', () => {
    expect(geojsonForClosures({ ...SNAPSHOT, items: [{ ...CLOSURE, geo: undefined }] }).features).toHaveLength(0);
  });
});

describe('printAct', () => {
  it('calls print exactly once through the injected seam', () => {
    const print = vi.fn();
    printAct({ print });
    expect(print).toHaveBeenCalledTimes(1);
  });
});
