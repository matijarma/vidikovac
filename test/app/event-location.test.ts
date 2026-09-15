// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { renderKultura } from '../../app/src/layers/kultura';
import { renderGradSada } from '../../app/src/layers/grad-sada';
import { publicItemKey } from '../../app/src/core/contracts';
import type { ModuleSnapshot } from '../../worker/feed/schema';

const now = Date.parse('2026-09-13T09:00:00Z');
const snapshot: ModuleSnapshot = {
  module: 'dogadanja', tier: 'session', status: 'live', fetchedAt: new Date(now).toISOString(),
  attribution: { text: 'Kulturpunkt', url: 'https://example.test/event', licence: 'CC BY-SA 3.0 HR' },
  items: [{ id: 'test-event', module: 'dogadanja', tier: 'session', kind: 'event', title: 'Test event',
    at: '2026-09-14T18:00:00Z', dateBasis: 'event', data: { source: 'kulturpunkt', precision: 'time' } }],
};

// T1.4: a venue prints only when the source has one; an event without one
// shows its source alone, on every surface, never a placeholder sentence
// ("Lokacija nije navedena" / "Location not provided" never prints, and no
// "Mjesto"/"Venue" fact appears in the detail when there is nothing to show).
// The placeholder is pinned as a literal per locale: its key
// (events.venueUnknown) left the catalogue with T6.3, and i18n.t answers a
// missing leaf with the bare key, which no rendered text contains, so a pin
// through i18n.t would hold whatever the surfaces print.
describe('events without a venue show the source alone, never an unknown-location placeholder', () => {
  it.each([
    ['hr', 'Lokacija nije navedena'],
    ['en', 'Location not provided'],
  ] as const)('names no missing location in %s overview, agenda or detail; the source stands alone', (locale, missing) => {
    const i18n = createDefaultI18n(locale);
    const ctx = { i18n, now, snapshots: { dogadanja: snapshot } };
    const venueLabel = i18n.t('events.venue');
    const source = i18n.t('events.sources.kulturpunkt');
    const overview = renderGradSada(ctx).querySelector('.tb')!.textContent!;
    expect(overview).not.toContain(missing);
    expect(overview).toContain(source);
    const agenda = renderKultura(ctx).querySelector('[data-testid=agenda]')!.textContent!;
    expect(agenda).not.toContain(missing);
    expect(agenda).toContain(source);
    const detail = renderKultura({ ...ctx, view: { layer: 'kultura', filters: {}, selection: {
      kind: 'item', module: 'dogadanja', id: publicItemKey('dogadanja', 'test-event'),
    } } });
    const detailText = detail.querySelector('[data-testid=event-detail]')!.textContent!;
    expect(detailText).not.toContain(missing);
    expect(detailText).not.toContain(venueLabel);
  });
});
