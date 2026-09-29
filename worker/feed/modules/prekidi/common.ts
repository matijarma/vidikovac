import { normalName } from '../../../../shared/city/geo';
import type { ItemInput } from '../../payload';

/** What one source of the prekidi module reads: its cuts and how many streets it named, located or not. */
export interface CutsResult {
  items: ItemInput[];
  /** Streets the source named for the days read, whether or not the street index could place them. */
  total: number;
}

/** "Aleja Seljačke bune" to "aleja-seljacke-bune": the street's part of a cut's id. */
export function streetSlug(street: string): string {
  return normalName(street).replace(/ /g, '-');
}

/**
 * The id of a cut, `prekidi:<source>:<day>:<street>`. A street named twice on one day (two outages on the same
 * street at different hours) keeps both under ids that stay the same from one read to the next: the second is
 * `-2`, the third `-3`, in the source's own order.
 */
export function cutId(source: 'hep' | 'vio', day: string, street: string, taken: Set<string>): string {
  const base = `prekidi:${source}:${day}:${streetSlug(street)}`;
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}
