// A tap (or a pointer passing) on a drawn city map: which mark it landed on
// and what that asks for -- a selection, or, on a merged mark, a closer look.
// In the MapLibre chunk (maplibre-entry.ts): city-map.ts binds it once the
// library has built the map, since only a drawn map is ever tapped, so the
// lightweight graph never carries it (test/app/budget.test.ts).
import { toLonLat } from '../../../shared/motion/geo';
import type { Drawn } from '../motion/integrator';
import type { StyleLayerLike } from './basemap';
import { CLUSTER_ZOOM_IN_UNTIL, type MapSelection } from './city-map';

/** The slice of a MapLibre map a tap reads: city-map.ts's MapApi, structurally. */
export interface PointerMap {
  on(type: string, listener: (event: { point?: { x: number; y: number } }) => void): unknown;
  getCanvas(): HTMLCanvasElement;
  getZoom(): number;
  project?(lonLat: [number, number]): { x: number; y: number };
  unproject?(point: { x: number; y: number }): { lng: number; lat: number };
  queryRenderedFeatures(geometry: unknown, options?: { layers?: string[] }): { properties: Record<string, unknown> }[];
}

/** The layer ids a tap reads, as the loaded module carries them; the city
 *  places' ids only where the module draws them (city-layers.ts). */
export type PointerIds = Pick<typeof import('./overlays'), 'LAYERS'> & { CITY_LAYERS?: readonly string[] };

/** What a tap reads off the map wrapper that owns it (city-map.ts). */
export interface PointerHost {
  readonly container: HTMLElement;
  /** Whether the overlays sit on the style: a tap before then means nothing. */
  styled(): boolean;
  /** How far from a mark a tap still hits it, in CSS px (CityMapOptions.hitTolerancePx). */
  hitTolerance(): number;
  closuresVisible(): boolean;
  /** The basemap layers as the live style carries them (a street's name is read off its label). */
  basemap(): readonly StyleLayerLike[];
  resolveStreet?: (name: string, point: { lon: number; lat: number }) => string | null;
  /** Every platform of the artefact sharing a name, or undefined for one. */
  siblingPlatforms(name: string): string[] | undefined;
  /** What the model draws now: a merged mark's members where they are. */
  drawn(): readonly Drawn[];
  fitCoordinates(coords: readonly [number, number][], maxZoom: number): void;
  selection(): MapSelection | null;
  /** The reader chose (or, with null, cleared): selected on the map and reported. */
  choose(next: MapSelection | null): void;
}

/** What a tap landed on: one of the map's selectable things, or a cluster of
 *  vehicles, which is not a selection but a request to look closer. */
type Picked = MapSelection | { kind: 'cluster'; ids: string[] };

/** Binds the tap, the pointer's cursor and Escape on the map `m`. */
export function bindCityMapPointer(m: PointerMap, l: PointerIds, host: PointerHost): void {
  /** A cluster mark's members, or null when the picked feature is one vehicle.
   *  MapLibre hands an array property back as an array (it JSON-tags the value
   *  through its own tile encoding and parses it again on the way out), so the
   *  ids the source wrote are the ids read here. */
  function clusterMembers(properties: Record<string, unknown>): string[] | null {
    if (properties.cluster !== true) return null;
    const ids = properties.ids;
    return Array.isArray(ids) ? ids.map(String) : [];
  }

  /** Where the model currently draws each of these vehicles; one that has gone
   *  since the frame the tap hit is simply left out. */
  function memberCoordinates(ids: readonly string[]): [number, number][] {
    const coords: [number, number][] = [];
    for (const id of ids) {
      const v = host.drawn().find((d) => d.id === id);
      if (v) coords.push(toLonLat(v.p));
    }
    return coords;
  }

  /** A tap on a merged mark. While the members are a few pixels apart no tap
   *  can mean one of them, so the camera goes in on them instead of guessing
   *  (CLUSTER_ZOOM_IN_UNTIL); close in, the pills are apart and the tap means
   *  the one under it. Nothing is selected on the way in: a selection the
   *  reader did not aim at is worse than one more tap. */
  function openCluster(ids: readonly string[], point: { x: number; y: number }): void {
    const coords = memberCoordinates(ids);
    if (coords.length === 0) return;
    if (m.getZoom() < CLUSTER_ZOOM_IN_UNTIL) {
      host.fitCoordinates(coords, CLUSTER_ZOOM_IN_UNTIL);
      return;
    }
    let nearest: string | null = null;
    let best = Infinity;
    for (const id of ids) {
      const v = host.drawn().find((d) => d.id === id);
      if (!v) continue;
      const at = m.project?.(toLonLat(v.p));
      const distance = at ? Math.hypot(at.x - point.x, at.y - point.y) : 0;
      if (distance < best) {
        best = distance;
        nearest = id;
      }
    }
    if (!nearest) return;
    host.choose({ kind: 'vehicle', id: nearest });
  }

  /** The mark under a tap, by priority: a vehicle over a city place over a
   *  stop over a closure; nothing under it clears. The vehicle wins because a
   *  numbered pill is what this map is for -- it is drawn last, over
   *  everything, and it moves; a place dot standing under one is still
   *  reachable by tapping beside the pill or by zooming, where a pill covered
   *  by a dot could not be tapped at all. */
  function pick(point: { x: number; y: number }): Picked | null {
    const tolerance = host.hitTolerance();
    const box = [
      [point.x - tolerance, point.y - tolerance],
      [point.x + tolerance, point.y + tolerance],
    ];
    const first = (layers: string[]): { properties: Record<string, unknown> } | undefined => m.queryRenderedFeatures(box, { layers })[0];
    const vehicle = first([l.LAYERS.vehicleSelected, l.LAYERS.vehicles, l.LAYERS.vehicleDots]);
    if (vehicle) {
      const members = clusterMembers(vehicle.properties);
      return members ? { kind: 'cluster', ids: members } : { kind: 'vehicle', id: String(vehicle.properties.id) };
    }
    const place = l.CITY_LAYERS ? first(['city-place-dots','city-place-badges','city-place-labels']) : undefined;
    if (place) return {kind:'place',id:String(place.properties.id)};
    const platform = first([l.LAYERS.stopsSelected, l.LAYERS.stopsRoute, l.LAYERS.stops, l.LAYERS.stopLabels]);
    if (platform) return { kind: 'stop', id: String(platform.properties.id), ids: host.siblingPlatforms(String(platform.properties.name)) };
    const closure = host.closuresVisible() ? first([l.LAYERS.closures, l.LAYERS.closuresCasing]) : undefined;
    if (closure) return { kind: 'closure', id: String(closure.properties.id) };
    if (host.resolveStreet && m.unproject) {
      const labelLayers=host.basemap().filter(layer=>layer.type==='symbol'&&layer.id.startsWith('roads_labels')).map(layer=>layer.id);
      const road=labelLayers.length?first(labelLayers):undefined;
      const name=road?.properties['name:hr']??road?.properties.name;
      if (typeof name==='string') {
        const p=m.unproject(point),id=host.resolveStreet(name,{lon:p.lng,lat:p.lat});
        if(id)return {kind:'street',id};
      }
    }
    return null;
  }

  const canvas = m.getCanvas();
  m.on('click', (event) => {
    if (!host.styled() || !event.point) return;
    const picked = pick(event.point);
    if (picked?.kind === 'cluster') {
      openCluster(picked.ids, event.point);
      return;
    }
    host.choose(picked);
  });
  m.on('mousemove', (event) => {
    if (!host.styled() || !event.point) return;
    canvas.style.cursor = pick(event.point) ? 'pointer' : '';
  });
  // Escape on the map clears the selection: the keyboard's tap on nothing.
  // Stopped here so the page's own Escape (leaving the full map) takes a second press.
  host.container.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !host.selection()) return;
    event.preventDefault();
    event.stopPropagation();
    host.choose(null);
  });
}
