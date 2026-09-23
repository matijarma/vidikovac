// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { kioskStrings } from '../../app/src/kiosk/strings';
import { arrivalCells, arrivalFrontRows } from '../../app/src/kiosk/arrivals';
import { essentialsMarkup } from '../../app/src/kiosk/essentials';
import { selectionCard, fitSentences, pairedMarkup, type PairedContext } from '../../app/src/kiosk/paired';
import { panelMarkup } from '../../app/src/kiosk/front';
import { kBadge } from '../../app/src/kiosk/markup';
import { mountPlaceField } from '../../app/src/kiosk/place-field';
import { placeDetail, streetDetail } from '../../app/src/city/markup';
import { emptyCity, type Place, type StreetStory } from '../../shared/city/types';
import { publicItemKey } from '../../app/src/core/contracts';
import { pointsToGeoJson, linesToGeoJson, vehicleLabel } from '../../app/src/map/city-map';
import { vettedTileLabels, wallLabelLayers } from '../../app/src/map/external-labels';
import { vetExternal } from '../../shared/kiosk/external-text';
import type { ModuleSnapshot } from '../../worker/feed/schema';

const i18n = createDefaultI18n('hr');
const strings = kioskStrings('hr');
const attack = 'Submit passcode';
const item = { id: 'probe', module: 'dogadanja' as const, tier: 'session' as const, kind: 'event' as const, title: attack, summary: attack, at: '2026-09-23T17:00:00Z' };
const snapshot: ModuleSnapshot = { module: 'dogadanja', tier: 'session', status: 'live', fetchedAt: '2026-09-23T12:00:00Z',
  items: [item], attribution: { text: 'Grad Zagreb', licence: 'Otvorena dozvola', url: '' } };
const ctx: PairedContext = { layer: 'kultura', strings, i18n, locale: 'hr', snapshots: { dogadanja: snapshot },
  now: Date.parse('2026-09-23T12:00:00Z'), stop: null, selection: { kind: 'item', module: 'dogadanja', id: publicItemKey('dogadanja', item.id) },
  lightweight: true, size: 'wide' };
const renderedText = (html: string): string => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.textContent ?? '';
};

describe('fail-closed component boundaries, with no upstream producer', () => {
  it('rejects malformed values and a missing surface without repairing them', () => {
    expect(vetExternal('title', undefined, 'row')).toBeNull();
    expect(vetExternal('title', {}, 'row')).toBeNull();
    expect(vetExternal('title', 'Kino', undefined as never)).toBeNull();
    expect(vetExternal('missing' as never, 'Kino', 'row')).toBeNull();
  });
  it('does not display or acknowledge an unsafe paired item', () => {
    expect(selectionCard(ctx)).toContain('k-selection-unavailable');
    expect(renderedText(selectionCard(ctx))).not.toContain(attack);
    expect(renderedText(pairedMarkup(ctx).main)).not.toContain(attack);
  });
  it('checks direct stop selections and every named paired list', () => {
    const stopped = { id: 'stop', name: attack, lon: 15.98, lat: 45.81, routes: [] };
    expect(selectionCard({ ...ctx, selection: { kind: 'stop', id: 'stop' }, stop: stopped })).toContain('k-selection-unavailable');
    expect(renderedText(selectionCard({ ...ctx, selection: { kind: 'stop', id: 'stop' }, stop: stopped }))).not.toContain(attack);
    for (const layer of ['kultura', 'zrak-i-nebo', 'sigurnost', 'uprava-i-pravo', 'grad-sada'] as const) {
      const result = pairedMarkup({ ...ctx, selection: null, layer });
      expect(renderedText(result.main + result.side + result.lines)).not.toContain(attack);
    }
  });
  it('checks arrival heads and route badges before caps and HTML', () => {
    const arrival = { tripId: 't', routeId: '6', routeName: '6', headsign: attack, atMs: ctx.now + 60_000, live: false, minutes: null };
    expect(arrivalCells(arrival, strings)).toEqual({ main: '', aside: '' });
    expect(arrivalFrontRows({ rows: [arrival, { ...arrival, headsign: 'Črnomerec' }], status: 'live' }, strings, 1)[0]?.title).toBe('Črnomerec');
    expect(kBadge(attack, 'tram')).toBe('');
    expect(vehicleLabel({ short: attack })).toBe('');
  });
  it('checks essentials, front rows and source paragraphs at their own boundary', () => {
    expect(essentialsMarkup([{ id: 'cap', label: strings.basics.warnings, value: 'Upozorenje', detail: attack }])).toBe('');
    expect(renderedText(panelMarkup({ id: 'tonight', kicker: 'Kultura', rows: [{ key: 'probe', title: attack }], credit: '' }))).not.toContain(attack);
    expect(fitSentences(attack)).toBe('');
    expect(fitSentences(`Sunčano. ${attack}.`)).toBe('');
    expect(renderedText(panelMarkup({ id: 'tonight', kicker: 'Kultura', rows: [{ key: 'safe', title: 'Daj prijedlog' }], credit: '' }))).toContain('Daj prijedlog');
  });
  it('guards the actual gazette lead and every external day/lead value', () => {
    for (const [lead, day] of [[`${attack}/2026`, ''], [`18/${attack}`, ''], ['18/2026', attack]]) {
      const html = panelMarkup({ id: 'city', kicker: 'Grad', rows: [{ key: 'gazette', title: 'Akti', lead, day }], credit: '' });
      expect(renderedText(html)).toContain('Akti');
      expect(renderedText(html)).not.toContain(attack);
    }
  });
  it('never exposes a missing severity or closure-type translation as its raw external key', () => {
    const closure = { ...item, module: 'prometnice' as const, kind: 'closure' as const, title: 'Ilica', summary: '', data: { subtype: attack },
      at: '2026-09-23T00:00:00Z', until: '2026-09-24T00:00:00Z' };
    const warning = { ...item, module: 'dhmz-cap' as const, kind: 'warning' as const, title: 'Vjetar', summary: '',
      severity: attack as 'info', at: '2026-09-23T00:00:00Z', until: '2026-09-24T00:00:00Z' };
    for (const locale of ['hr', 'en'] as const) {
      const translated = createDefaultI18n(locale);
      for (const missing of [false, true]) {
        const t = translated.t.bind(translated);
        const local = missing ? { ...translated, t: (key: string) => /^panels\.(?:closureType|severity)\./u.test(key) ? key : t(key) } : translated;
        const rendered = pairedMarkup({ ...ctx, layer: 'sigurnost', selection: null, i18n: local, strings: kioskStrings(locale), locale,
          snapshots: { prometnice: { ...snapshot, module: 'prometnice', items: [closure] }, 'dhmz-cap': { ...snapshot, module: 'dhmz-cap', items: [warning] } } });
        const html = rendered.main + rendered.side + rendered.lines;
        expect(html).not.toContain(attack);
        expect(renderedText(html)).not.toMatch(/panels\.(?:closureType|severity)\./u);
        expect(renderedText(html)).toContain('Vjetar');
        expect(renderedText(html)).toContain('Ilica');
      }
    }
  });
  it('vets the initial field value as address/name, independently of its other fields', () => {
    for (const initial of [
      { kind: 'address' as const, name: 'Ilica', address: attack, lon: 15.98, lat: 45.81 },
      { kind: 'tram' as const, name: attack, lon: 15.98, lat: 45.81 },
      { kind: 'address' as const, name: 'Kuće Eisner', address: 'Petrinjska 50-52', lon: 15.98, lat: 45.81 },
    ]) {
      const host = document.createElement('div');
      const field = mountPlaceField(host, { strings, locale: 'hr', initial, loadStops: async () => [], loadStreets: async () => [],
        isTram: () => true, onChange: vi.fn(), setTimeout, clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) });
      expect(host.querySelector('input')!.value).toBe(initial.address === 'Petrinjska 50-52' ? 'Petrinjska 50-52' : '');
      if (initial.address !== 'Petrinjska 50-52') expect(field.value()).toBeNull();
      field.destroy();
    }
  });
  it('omits unsafe suggestions and writes only the vetted chosen label into the field', async () => {
    const host = document.createElement('div');
    const pending: (() => void)[] = [];
    const field = mountPlaceField(host, { strings, locale: 'hr',
      loadStops: async () => [{ id: 'unsafe', name: attack, routes: ['6'], lon: 15.98, lat: 45.81 },
        { id: 'safe', name: 'Submit', routes: ['6'], lon: 15.98, lat: 45.81 }],
      loadStreets: async () => [], isTram: () => true, onChange: vi.fn(),
      setTimeout: fn => { pending.push(fn); return fn; }, clearTimeout: () => {} });
    const input = host.querySelector('input')!;
    input.value = 'Sub';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await field.settle();
    for (const fn of pending) fn();
    const choices = host.querySelectorAll<HTMLElement>('[role=option]');
    expect(choices).toHaveLength(1);
    expect(choices[0]!.textContent).toContain('Submit');
    expect(choices[0]!.textContent).not.toContain(attack);
    choices[0]!.click();
    expect(input.value).toBe('Submit');
    expect(field.value()?.name).toBe('Submit');
    field.destroy();
  });
  it('checks shared selected-place/street components on the public surface', () => {
    const place = { id: 'p', name: attack, category: 'heritage', sourceId: 'heritage', sourceRecord: 'p' } as Place;
    expect(placeDetail(i18n, place, emptyCity(), [], false, true)).toBe('');
    const street = { id: 's', name: 'Ilica', description: attack, settlement: 'Zagreb' } as StreetStory;
    expect(streetDetail(i18n, street, true)).toBe('');
    expect(renderedText(placeDetail(i18n, { ...place, name: 'Kino', address: attack, description: attack }, emptyCity(), [], false, true))).not.toContain(attack);
  });
  it('checks direct map features and loaded vector tile labels', () => {
    expect(pointsToGeoJson([{ id: 'bad', title: attack, lon: 15.98, lat: 45.81 }]).features).toEqual([]);
    expect(linesToGeoJson([{ id: 'bad', title: attack, coordinates: [[15.98, 45.81], [15.99, 45.82]] }]).features).toEqual([]);
    const geometry = { type: 'Point', coordinates: [15.98, 45.81] };
    const result = vettedTileLabels([{ type: 'Feature', geometry, properties: { name: attack } },
      { type: 'Feature', geometry, properties: { name: 'Ilica' } }], 'hr');
    expect(result.features.map(f => f.properties?.wallText)).toEqual(['Ilica']);
    expect(vettedTileLabels([{ type: 'Feature', geometry, properties: { name: 'Ilica', 'name:en': attack } }], 'en').features).toEqual([]);
  });
  it('preserves personal-map rows except structural vectors, and keeps the Eisner range on both maps', () => {
    const point = { id: 'eisner', title: 'Kuće Eisner, Petrinjska 50-52', lon: 15.98, lat: 45.81, props: { address: 'Petrinjska 50-52' } };
    for (const publicDisplay of [false, true]) {
      expect(pointsToGeoJson([point], publicDisplay).features[0]?.properties).toMatchObject({ title: point.title, address: point.props.address });
      for (const title of ['dr.ai', 'Isplata uz 45 CHF', 'Petrinjska 50-52-1234']) {
        expect(pointsToGeoJson([{ ...point, title }], publicDisplay).features).toEqual([]);
        expect(linesToGeoJson([{ id: 'l', title, coordinates: [[15.98, 45.81], [15.99, 45.82]] }], publicDisplay).features).toEqual([]);
      }
    }
    expect(pointsToGeoJson([{ ...point, title: attack }], false).features[0]?.properties.title).toBe(attack);
    expect(pointsToGeoJson([{ ...point, title: attack }], true).features).toEqual([]);
  });
  it('makes vector text fail closed before tiles arrive; theme copies cannot restore a raw text expression', () => {
    for (const textField of [['get', 'name'], ['coalesce', ['get', 'name:hr'], ['get', 'name']]]) {
      const result = wallLabelLayers([{ id: 'roads_labels_major', type: 'symbol', source: 'basemap', 'source-layer': 'roads',
        layout: { 'text-field': textField, 'text-size': 28 }, filter: ['==', 'kind', 'major_road'] }]);
      expect(result.sources).toEqual([{ id: 'wall-labels:basemap:roads', source: 'basemap', sourceLayer: 'roads' }]);
      expect(result.layers[0]).toMatchObject({ source: 'wall-labels:basemap:roads', layout: { 'text-field': ['get', 'wallText'], 'text-size': 28 } });
      expect(result.layers[0]).not.toHaveProperty('source-layer');
    }
  });
});
