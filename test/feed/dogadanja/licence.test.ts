import { describe, expect, it } from 'vitest';
import type { FeedItem } from '../../../worker/feed/schema';
import { OPEN_LICENCE_EVENT_SOURCES, isOpenLicenceEvent, openLicenceEvents } from '../../../worker/feed/modules/dogadanja/licence';

const item = (source: string | undefined): FeedItem => ({
  id: `x:${source ?? 'none'}`,
  module: 'dogadanja',
  kind: 'event',
  tier: 'session',
  title: 'Stavka',
  ...(source ? { data: { source } } : {}),
});

describe('the dogadanja licence boundary', () => {
  it('names exactly the five data.source values published under the Otvorena dozvola: the City (Skupština, mjesna samouprava, data.zagreb.hr) and ZET', () => {
    expect([...OPEN_LICENCE_EVENT_SOURCES].sort()).toEqual(['komunalne', 'kvartovske', 'skupstina', 'zet-novosti', 'zet-promet']);
  });

  it('keeps Kulturpunkt (CC BY-SA 3.0 HR) and the Etnografski muzej (no explicit licence) out of the open tier', () => {
    expect(isOpenLicenceEvent(item('kulturpunkt'))).toBe(false);
    expect(isOpenLicenceEvent(item('etnografski'))).toBe(false);
    for (const source of OPEN_LICENCE_EVENT_SOURCES) expect(isOpenLicenceEvent(item(source)), source).toBe(true);
  });

  it('treats an item with no source as not open: the boundary fails closed', () => {
    expect(isOpenLicenceEvent(item(undefined))).toBe(false);
    expect(isOpenLicenceEvent({ ...item('skupstina'), data: { source: 42 } })).toBe(false);
  });

  it('filters a merged list in its original order', () => {
    const rows = [item('kulturpunkt'), item('skupstina'), item('etnografski'), item('zet-promet'), item('komunalne')];
    expect(openLicenceEvents(rows).map((r) => r.id)).toEqual(['x:skupstina', 'x:zet-promet', 'x:komunalne']);
  });
});
