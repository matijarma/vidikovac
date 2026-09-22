import { describe, expect, it, vi } from 'vitest';
import type { FeedItem, ModuleSnapshot } from '../../worker/feed/schema';
import {
  attributionBlock,
  canExportCalendarItem,
  copyWithAttribution,
  geojsonForClosures,
  icsFile,
  icsForItem,
  icsForItems,
  ICS_PRODID,
  itemExportSummary,
  itemExportText,
  printAct,
  shareLink,
} from '../../app/src/export';
import { parseHrDate } from '../../worker/feed/hr-date';
import { parseAkti } from '../../worker/feed/modules/glasnik';
import { parsePrometnice } from '../../worker/feed/modules/prometnice';

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
const EVENT: FeedItem = {
  id: 'kulturpunkt:1', module: 'dogadanja', kind: 'event', tier: 'session',
  title: 'Koncert', dateBasis: 'event', at: '2026-09-11T18:00:00Z',
  link: 'https://example.test/event/1',
  data: { source: 'kulturpunkt', precision: 'time' },
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
  it('does not invent a duration when the item has no end, and skips items with no start', () => {
    const open = icsForItems([{ ...CLOSURE, until: undefined }]);
    expect(open).toContain('BEGIN:VEVENT');
    expect(open).not.toContain('DURATION');
    expect(open).not.toContain('DTEND');
    expect(icsForItems([{ ...CLOSURE, at: undefined }])).not.toContain('BEGIN:VEVENT');
  });

  it.each(['unknown', 'published', 'updated', 'observed', undefined] as const)(
    'rejects an event-kind item with dateBasis %s even when it has a valid date',
    (dateBasis) => {
      const item = { ...EVENT, dateBasis };
      expect(canExportCalendarItem(item)).toBe(false);
      expect(icsForItem(item, ATTR)).toBeNull();
      expect(icsForItems([item], ATTR)).not.toContain('BEGIN:VEVENT');
    },
  );

  it.each(['unknown', 'published', 'updated', 'observed'] as const)(
    'does not override an explicit %s dateBasis on a closure',
    (dateBasis) => expect(canExportCalendarItem({ ...CLOSURE, dateBasis })).toBe(false),
  );

  it('requires event semantics for all sources, not just a familiar name or kind', () => {
    const notices: FeedItem[] = [
      { ...EVENT, dateBasis: undefined, data: { source: 'kvartovske', precision: 'day' } },
      { ...EVENT, dateBasis: 'unknown', at: undefined, data: { source: 'kvartovske' } },
      { ...EVENT, dateBasis: 'updated', data: { source: 'komunalne', precision: 'day' } },
      { ...EVENT, dateBasis: 'published', data: { source: 'zet-promet', precision: 'time' } },
      // @ts-expect-error a module and a kind outside the schema on purpose: the verdict must rest on dateBasis alone
      { ...EVENT, module: 'hrt-news', kind: 'news', dateBasis: 'published' },
      { ...EVENT, module: 'glasnik', kind: 'act', dateBasis: undefined },
      { ...EVENT, module: 'dhmz-now', kind: 'observation', dateBasis: 'observed' },
      { ...CLOSURE, module: 'dogadanja', dateBasis: undefined },
    ];
    expect(icsForItems(notices)).not.toContain('BEGIN:VEVENT');
    expect(icsForItems([...notices, EVENT]).match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it('preserves the verified legacy prometnice expected-start/end semantics', () => {
    const parsed = parsePrometnice([{
      street: 'Ilica', type: 'ROAD_CLOSED', polyline: '45.8 15.9 45.81 15.91',
      expectedStartTime: '2026-09-11T08:00:00+02:00',
      expectedEndTime: '2026-09-11T20:00:00+02:00',
    }]).items[0]!;
    const legacy: FeedItem = { ...parsed, module: 'prometnice', tier: 'open', dateBasis: undefined };
    expect(canExportCalendarItem(legacy)).toBe(true);
    expect(icsForItem(legacy)).toContain('DTSTART:20260911T060000Z');
    expect(icsForItem(legacy)).toContain('DTEND:20260911T180000Z');
  });

  it('exports a bare calendar date as all-day without an invented end', () => {
    const output = icsForItems([{ ...EVENT, at: '2026-09-11', data: { source: 'skupstina' } }]);
    expect(output).toContain('DTSTART;VALUE=DATE:20260911\r\n');
    expect(output).not.toContain('DTSTART:');
    expect(output).not.toContain('DTEND');
    expect(output).not.toContain('DURATION');
  });

  it.each([
    ['2026-09-10T22:00:00.000Z', '20260911'],
    ['2026-01-10T23:00:00.000Z', '20260111'],
    ['2026-03-28T23:00:00.000Z', '20260329'],
    ['2026-10-24T22:00:00.000Z', '20261025'],
  ])('restores the Zagreb day for day-precision timestamp %s', (at, day) => {
    const output = icsForItems([{ ...EVENT, at, data: { precision: 'day' } }]);
    expect(output).toContain(`DTSTART;VALUE=DATE:${day}\r\n`);
    expect(output).not.toContain('DTEND');
    expect(output).not.toContain('DURATION');
  });

  it('honours the real day-precision parser output', () => {
    const date = parseHrDate('11. rujna 2026.', new Date('2026-09-01T10:00:00Z'))!;
    expect(date.precision).toBe('day');
    expect(icsForItems([{ ...EVENT, at: date.startIso, data: { precision: date.precision } }]))
      .toContain('DTSTART;VALUE=DATE:20260911\r\n');
  });

  it('converts the real inclusive day-range parser output to an exclusive all-day DTEND', () => {
    const date = parseHrDate('od 22. do 29. rujna 2026.', new Date('2026-09-01T10:00:00Z'))!;
    expect(date.precision).toBe('range');
    const output = icsForItems([{
      ...EVENT, at: date.startIso, until: date.endIso, data: { precision: date.precision },
    }]);
    expect(output).toContain('DTSTART;VALUE=DATE:20260922\r\n');
    expect(output).toContain('DTEND;VALUE=DATE:20260930\r\n');
    expect(output).not.toContain('DURATION');
  });

  it.each([
    ['2026-03-28T23:00:00.000Z', '2026-03-29T21:59:00.000Z', '20260329', '20260330'],
    ['2026-10-24T22:00:00.000Z', '2026-10-25T22:59:00.000Z', '20261025', '20261026'],
    ['2026-12-31', '2026-12-31', '20261231', '20270101'],
    ['2028-02-28', '2028-02-29', '20280228', '20280301'],
  ])('uses calendar arithmetic for range %s through %s', (at, until, start, end) => {
    const output = icsForItems([{ ...EVENT, at, until, data: { precision: 'range' } }]);
    expect(output).toContain(`DTSTART;VALUE=DATE:${start}\r\n`);
    expect(output).toContain(`DTEND;VALUE=DATE:${end}\r\n`);
  });

  it('keeps explicit time precision and a supplied end without adding a duration', () => {
    const output = icsForItems([{
      ...EVENT, at: '2026-09-11T20:00:00+02:00', until: '2026-09-11T22:30:00+02:00',
    }]);
    expect(output).toContain('DTSTART:20260911T180000Z');
    expect(output).toContain('DTEND:20260911T203000Z');
    expect(output).not.toContain('VALUE=DATE');
    expect(output).not.toContain('DURATION');
  });

  it.each([
    undefined, '', 'not-a-date', '2026', '2026-02-30', '2026-13-01',
    '2026-02-30T10:00:00Z', '2026-09-11T24:00:00Z', '2026-09-11T18:60:00Z',
    '2026-09-11T18:00:60Z', '2026-09-11T18:00:00', 'September 11, 2026',
    {} as unknown as string,
  ])('rejects an invalid or ambiguous start %s without using snapshot/now time', (at) => {
    const item = { ...EVENT, at };
    expect(canExportCalendarItem(item)).toBe(false);
    expect(icsForItems([item], ATTR, { snapshot: SNAPSHOT, now: new Date('2026-09-11T12:32:00Z') }))
      .not.toContain('BEGIN:VEVENT');
  });

  it.each([
    undefined, 'bad', '2026-02-30T19:00:00Z', '2026-09-11T18:00:00Z', '2026-09-11T17:00:00Z',
    '2026-09-12', '2026-09-11T19:00:00',
  ])('omits an absent, invalid, nonpositive or date-only timed end %s', (until) => {
    const output = icsForItems([{ ...EVENT, until }]);
    expect(output).toContain('DTSTART:20260911T180000Z');
    expect(output).not.toContain('DTEND');
    expect(output).not.toContain('DURATION');
  });

  it('omits invalid and reversed all-day ends without losing a known start', () => {
    for (const until of ['invalid', '2026-09-10']) {
      const output = icsForItems([{ ...EVENT, at: '2026-09-11', until }]);
      expect(output).toContain('DTSTART;VALUE=DATE:20260911');
      expect(output).not.toContain('DTEND');
      expect(output).not.toContain('DURATION');
    }
  });

  it('retains per-item source URL, licence and filled attribution in all-day exports', async () => {
    const attribution = { ...ATTR, text: 'Izvor {naslov}, {vrijeme}' };
    const item = { ...EVENT, at: '2026-09-11' };
    const output = icsForItem(item, attribution, { snapshot: SNAPSHOT })!.replace(/\r\n /g, '');
    expect(output).toContain(`URL:${EVENT.link}`);
    expect(output).toContain('Izvor Koncert');
    expect(output).toContain(ATTR.url);
    expect(output).toContain(ATTR.licence);
    expect(output).not.toMatch(/\{naslov\}|\{vrijeme\}/);
    const file = icsFile([item], attribution, SNAPSHOT);
    expect(file.type).toBe('text/calendar;charset=utf-8');
    expect(await file.text()).toContain('DTSTART;VALUE=DATE:20260911');
  });

  it('exports summaries only as text and escapes bare CR and LF property injection', () => {
    const output = icsForItems([{
      ...EVENT, title: '<b>Koncert</b>\rLOCATION:injected',
      summary: '<p>Stvarni opis</p><script>fake()</script>\nDTEND:injected',
    }]).replace(/\r\n /g, '');
    expect(output).toContain('SUMMARY:Koncert\\nLOCATION:injected');
    expect(output).toContain('DESCRIPTION:Stvarni opis\\nDTEND:injected');
    expect(output).not.toMatch(/<(?:b|p|script)>|fake\(\)/);
    expect(output).not.toMatch(/\r\n(?:LOCATION|DTEND):/);
    const malformed = icsForItems([{ ...EVENT, summary: { '#text': 'raw XML' } as unknown as string }]);
    expect(malformed).not.toContain('DESCRIPTION');
    expect(malformed).not.toContain('[object Object]');
  });

  it('does not split multibyte characters when folding text', () => {
    const title = 'Ž🎻'.repeat(60);
    const output = icsForItems([{ ...EVENT, title }]);
    for (const line of output.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    expect(output.replace(/\r\n /g, '')).toContain(`SUMMARY:${title}`);
  });
});

describe('item text exports', () => {
  it('returns strings only and never converts objects or numbers into summaries', () => {
    for (const summary of [undefined, null, 42, false, { '#text': 'RSS' }, ['array']]) {
      const item = { ...EVENT, summary: summary as unknown as string };
      expect(itemExportSummary(item)).toBe('');
      expect(itemExportText(item)).toBe(`${EVENT.title}\n${EVENT.link}`);
    }
  });

  it('retains real summary text without HTML or script/style contents', () => {
    const item = {
      ...EVENT, summary: '<p>Stvarni <b>opis</b></p><!-- hidden --><style>body{}</style><script>fake()</script>',
    };
    expect(itemExportSummary(item)).toBe('Stvarni opis');
    expect(itemExportText(item)).toBe(`Koncert\nStvarni opis\n${EVENT.link}`);
  });

  it('does not fabricate gazette fulltext from title, issue metadata or publication date', () => {
    const parsed = parseAkti([{ id: '42', naziv: 'Odluka o izmjenama' }], {
      yearId: '2026', year: '2026', issueId: '9', issueNumber: 9, issueLabel: 'Broj 9',
      publishedAt: '2026-09-10T22:00:00.000Z',
    }).items[0]!;
    const act: FeedItem = { ...parsed, module: 'glasnik', tier: 'session' };
    expect(itemExportSummary(act)).toBe('');
    expect(itemExportText(act)).toBe(`${act.title}\n${act.link}`);
    expect(icsForItem(act)).toBeNull();
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
  it('keeps GeoJSON summaries plain strings and prevents source extras from replacing them', () => {
    const item = {
      ...CLOSURE, summary: '<p>Radovi</p>',
      data: { ...CLOSURE.data, summary: { nested: 'raw' }, other: { nested: 'raw' } } as unknown as FeedItem['data'],
    };
    const properties = geojsonForClosures({ ...SNAPSHOT, items: [item] }).features[0]!.properties;
    expect(properties.summary).toBe('Radovi');
    expect(properties).not.toHaveProperty('other');
    const malformed = { ...item, summary: { '#text': 'raw' } as unknown as string };
    expect(geojsonForClosures({ ...SNAPSHOT, items: [malformed] }).features[0]!.properties)
      .not.toHaveProperty('summary');
  });
});

describe('printAct', () => {
  it('calls print exactly once through the injected seam', () => {
    const print = vi.fn();
    printAct({ print });
    expect(print).toHaveBeenCalledTimes(1);
  });
});
