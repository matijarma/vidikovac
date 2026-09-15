// The producers of the time band (plan A.6), in the order buildTimeband asks
// them. Task T2.3 fills this list; until then the band has no producers and
// paints "ništa najavljeno" in every lane, which is what an empty register
// honestly looks like. The import from timeband.ts is type-only here and stays
// type-only in every producer, so the default-parameter import there is never
// a runtime cycle.
import type { TileProducer } from '../timeband';

export const DEFAULT_PRODUCERS: readonly TileProducer[] = [];
