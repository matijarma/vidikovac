// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { kioskStrings } from '../../app/src/kiosk/strings';
import { arrivalCells, arrivalFrontRows } from '../../app/src/kiosk/arrivals';
import { essentialsMarkup } from '../../app/src/kiosk/essentials';
import { selectionCard, fitSentences, pairedMarkup, type PairedContext } from '../../app/src/kiosk/paired';
import { panelMarkup } from '../../app/src/kiosk/front';
import { kBadge } from '../../app/src/kiosk/markup';
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
