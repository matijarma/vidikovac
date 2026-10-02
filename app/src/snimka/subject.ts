// The subject of the instrument (a route, a BAJS station or a stop): from the
// map's own selection, to a label the panels and the feed print, to the
// focus the camera flies to (plan section 3.5). Pure; on the entry graph.
import type { Focus, PlacesFile, RoutesFile } from '../../../shared/snimka';
import type { MapSelection } from '../map/city-map';
import type { LoadedComparison } from './context';
import type { Subject } from './contracts';
import { SN, fill } from './strings';

/** The subject a map selection names: a route, a BAJS station (the wall's `bajs:<id>` city point) or a stop; a vehicle,
 *  a closure, a street or another place is none. */
export function subjectFromSelection(sel: MapSelection | null): Subject | null {
  if (!sel) return null;
  if (sel.kind === 'route') return { kind: 'route', id: sel.id };
  if (sel.kind === 'stop') return { kind: 'stop', id: sel.id };
  if (sel.kind === 'place' && sel.id.startsWith('bajs:')) return { kind: 'station', id: sel.id.slice('bajs:'.length) };
  return null;
}

/** The map selection a subject asks for (the inverse of subjectFromSelection). */
export function selectionOfSubject(subject: Subject | null): MapSelection | null {
  if (!subject) return null;
  if (subject.kind === 'route') return { kind: 'route', id: subject.id };
  if (subject.kind === 'stop') return { kind: 'stop', id: subject.id };
  return { kind: 'place', id: `bajs:${subject.id}` };
}

export const sameSubject = (a: Subject | null, b: Subject | null): boolean => (a === null || b === null ? a === b : a.kind === b.kind && a.id === b.id);

/** Names the context does not carry (BAJS stations live in the map's stations file): a caller that has them passes them. */
export interface SubjectNames { station?(id: string): string | null; stop?(id: string): string | null }

/** The subject as the panels say it: "Linija 228", "Stanica Trg bana J. Jelačića", "Stajalište Glavni kolodvor"; a
 *  name nobody can resolve falls back to the id, never to an empty label. */
export function subjectLabel(ctx: { routes: Pick<RoutesFile, 'routes'>; places: Pick<PlacesFile, 'places'> }, subject: Subject, names: SubjectNames = {}): string {
  if (subject.kind === 'route') {
    const short = ctx.routes.routes.find((r) => r.id === subject.id)?.shortName ?? subject.id;
    return fill(SN.subject.line, { short });
  }
  if (subject.kind === 'station') return fill(SN.subject.station, { name: names.station?.(subject.id) ?? subject.id });
  const place = ctx.places.places.find((p) => p.from === 'stop' && p.ref === subject.id)?.name ?? null;
  return fill(SN.subject.stop, { name: names.stop?.(subject.id) ?? place ?? subject.id });
}

/** The focus a subject asks the camera for. */
export function focusOf(subject: Subject): Focus {
  return subject.kind === 'route' ? { kind: 'route', id: subject.id } : subject.kind === 'station' ? { kind: 'station', id: subject.id } : { kind: 'stop', id: subject.id };
}

const WEEKDAY_NAMES: Record<number, string> = { 1: 'ponedjeljak', 4: 'četvrtak' };
const MONTHS_GENITIVE = ['siječnja', 'veljače', 'ožujka', 'travnja', 'svibnja', 'lipnja', 'srpnja', 'kolovoza', 'rujna', 'listopada', 'studenoga', 'prosinca'];

/** A comparison day as the page names it: "četvrtak 24. rujna", "ponedjeljak 21. rujna" (for twins.normal and layers.compareWhich). */
export function comparisonDayLabel(c: Pick<LoadedComparison, 'day' | 'weekday'>): string {
  const [, month, day] = c.day.split('-').map(Number);
  const weekday = WEEKDAY_NAMES[c.weekday] ?? '';
  const date = month && day ? `${day}. ${MONTHS_GENITIVE[month - 1] ?? ''}` : c.day;
  return `${weekday} ${date}`.trim();
}
