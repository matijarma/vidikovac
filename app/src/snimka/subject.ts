// The subject of the instrument (a route, a BAJS station or a stop) from the
// map's own selection (plan section 3.5). Lane V2 owns this file; V0 ships
// the direct mapping (a vehicle's route needs the map's vehicle list, V2).
import type { MapSelection } from '../map/city-map';
import type { Subject } from './contracts';

export function subjectFromSelection(sel: MapSelection | null): Subject | null {
  if (!sel) return null;
  if (sel.kind === 'route') return { kind: 'route', id: sel.id };
  if (sel.kind === 'stop') return { kind: 'stop', id: sel.id };
  if (sel.kind === 'place' && sel.id.startsWith('bajs:')) return { kind: 'station', id: sel.id.slice('bajs:'.length) };
  return null;
}
