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

describe('events without a venue are explicitly unlocated', () => {
  it.each(['hr', 'en'])('names the missing location in %s overview, agenda and detail', (locale) => {
    const i18n = createDefaultI18n(locale);
    const ctx = { i18n, now, snapshots: { dogadanja: snapshot } };
    const missing = i18n.t('events.venueUnknown');
    expect(renderGradSada(ctx).querySelector('#ov-agenda')!.textContent).toContain(missing);
    expect(renderKultura(ctx).querySelector('[data-testid=agenda]')!.textContent).toContain(missing);
    const detail = renderKultura({ ...ctx, view: { layer: 'kultura', filters: {}, selection: {
      kind: 'item', module: 'dogadanja', id: publicItemKey('dogadanja', 'test-event'),
    } } });
    expect(detail.querySelector('[data-testid=event-detail]')!.textContent).toContain(missing);
  });
});
