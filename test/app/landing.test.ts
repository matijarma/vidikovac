// @vitest-environment happy-dom
// Tests the landing page's own entry (app/src/entries/landing.ts): the
// pieces static markup cannot do on its own — the live vehicle count on the
// hero panorama (design.md §3.1) and the Worker health line it inherits from
// the old health.ts. `paintPanoramaTeaser` and `paintHealth` are exported
// precisely so this file never has to construct a real <canvas> 2D context
// or a real network call — every dependency is injected, exactly as
// mountKiosk's are (app/src/kiosk.ts).
import { describe, expect, it, vi } from 'vitest';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { paintHealth, paintPanoramaTeaser } from '../../app/src/entries/landing';

const attr = { text: 'Izvor: zet-rt', url: 'https://example.test/', licence: 'Otvorena dozvola (NN 67/17)' };
const zetRt = (vehicles: number): ModuleSnapshot => ({
  module: 'zet-rt',
  tier: 'open',
  status: 'live',
  fetchedAt: '2026-09-12T17:32:00.000Z',
  attribution: attr,
  items: [{ id: 'vozila', module: 'zet-rt', kind: 'vehicle', tier: 'open', title: '214 vozila u pokretu', data: { vehicles } }],
});

describe('paintPanoramaTeaser', () => {
  it('does nothing when there is no panorama canvas in the page', async () => {
    const paint = vi.fn();
    await paintPanoramaTeaser({
      panorama: null,
      legend: document.createElement('p'),
      fetchTeaser: vi.fn(),
      paint,
      fg: () => '#f2ead8',
      time: () => '19:32',
    });
    expect(paint).not.toHaveBeenCalled();
  });

  it('on a successful fetch, paints the real count and fills the legend and the aria-label with it', async () => {
    const canvas = document.createElement('canvas');
    const legend = document.createElement('p');
    const paint = vi.fn();
    await paintPanoramaTeaser({
      panorama: canvas,
      legend,
      fetchTeaser: async () => ({ modules: [zetRt(214)] }),
      paint,
      fg: () => '#f2ead8',
      time: () => '19:32',
    });
    expect(paint).toHaveBeenCalledWith(canvas, { fg: '#f2ead8', count: 214 });
    expect(legend.textContent).toBe(
      'SL. 1 — ZAGREBAČKA PANORAMA: MEDVEDNICA I GRAD · NA PRUZI JEDNA TOČKA = JEDNO VOZILO ZET-a · 214 U POKRETU, 19:32',
    );
    expect(canvas.getAttribute('aria-label')).toBe(legend.textContent);
  });

  it('on a failed fetch, paints an honest zero and never overwrites the legend it could not confirm', async () => {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', 'SL. 1 — ZAGREBAČKA PANORAMA · UČITAVANJE PODATAKA');
    const legend = document.createElement('p');
    legend.textContent = 'SL. 1 — ZAGREBAČKA PANORAMA · UČITAVANJE PODATAKA';
    const paint = vi.fn();
    await paintPanoramaTeaser({
      panorama: canvas,
      legend,
      fetchTeaser: async () => { throw new Error('network down'); },
      paint,
      fg: () => '#f2ead8',
      time: () => '19:32',
    });
    expect(paint).toHaveBeenCalledWith(canvas, { fg: '#f2ead8', count: 0 });
    expect(legend.textContent).toBe('SL. 1 — ZAGREBAČKA PANORAMA · UČITAVANJE PODATAKA');
    expect(canvas.getAttribute('aria-label')).toBe('SL. 1 — ZAGREBAČKA PANORAMA · UČITAVANJE PODATAKA');
  });

  it('a teaser with no zet-rt module (or no count on it) also paints zero beads without touching the legend', async () => {
    const canvas = document.createElement('canvas');
    const legend = document.createElement('p');
    legend.textContent = 'placeholder';
    const paint = vi.fn();
    await paintPanoramaTeaser({
      panorama: canvas,
      legend,
      fetchTeaser: async () => ({ modules: [] }),
      paint,
      fg: () => '#f2ead8',
      time: () => '19:32',
    });
    expect(paint).toHaveBeenCalledWith(canvas, { fg: '#f2ead8', count: 0 });
    expect(legend.textContent).toBe('placeholder');
  });
});

describe('paintHealth', () => {
  it('does nothing without a #health element', async () => {
    const fetchImpl = vi.fn();
    await paintHealth({ el: null, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('shows the worker version and time on an ok response', async () => {
    const el = document.createElement('code');
    const fetchImpl = vi.fn(async () => ({ json: async () => ({ ok: true, version: '1.2.3', time: '2026-09-12T17:32:00.000Z' }) })) as unknown as typeof fetch;
    await paintHealth({ el, fetchImpl, now: () => 0 });
    expect(el.textContent).toContain('worker 1.2.3');
  });

  it('shows greška on a non-ok response and nedostupno when the fetch itself throws', async () => {
    const el = document.createElement('code');
    await paintHealth({ el, fetchImpl: (async () => ({ json: async () => ({ ok: false }) })) as unknown as typeof fetch, now: () => 0 });
    expect(el.textContent).toBe('greška');
    await paintHealth({ el, fetchImpl: (async () => { throw new Error('down'); }) as unknown as typeof fetch, now: () => 0 });
    expect(el.textContent).toBe('nedostupno');
  });
});
