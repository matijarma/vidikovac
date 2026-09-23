// @vitest-environment happy-dom
// The field's two probes on the map host (docs/companion-2026-09-22.md §15.6):
// `[data-testid=kiosk-map-host][data-frame][data-major-labels]`. The e2e
// (e2e/wall-map.spec.ts) reads them off the real wall; this pins who writes them.
import { afterEach, describe, expect, it } from 'vitest';
import { mountField } from '../../app/src/kiosk/field';

afterEach(() => { document.body.replaceChildren(); });

describe('the field writes the Kadar on its map host', () => {
  it('setFrame writes data-frame beside data-major-labels, and only on a change', () => {
    const field = mountField(document.body);
    const host = document.querySelector<HTMLElement>('[data-testid=kiosk-map-host]')!;
    expect(field.mapHost).toBe(host);
    expect(host.dataset.frame).toBeUndefined();
    field.setFrame(6);
    field.setMajorLabels(3);
    expect(host.dataset.frame).toBe('6');
    expect(host.dataset.majorLabels).toBe('3');
    const seen: string[] = [];
    new MutationObserver((records) => { for (const r of records) seen.push(r.attributeName ?? ''); }).observe(host, { attributes: true });
    field.setFrame(6);
    field.setFrame(8);
    return Promise.resolve().then(() => {
      expect(host.dataset.frame).toBe('8');
      expect(seen).toEqual(['data-frame']);
    });
  });

  it('under lagano the hidden host carries it too, so one selector reads both fields', () => {
    const field = mountField(document.body, { lightweight: true });
    const host = document.querySelector<HTMLElement>('[data-testid=kiosk-map-host]')!;
    expect(field.mapHost).toBeNull();
    expect(host.hidden).toBe(true);
    field.setFrame(4);
    expect(host.dataset.frame).toBe('4');
  });
});
