// The producers of the time band (plan A.6), in the sada reading order:
// transit -> mobility -> komunalno -> safety -> news -> civic (DOMAIN_ORDER in
// tiles.ts). The gazette is the least time-critical value and the only
// half-width tile after the line tiles, so it sits under the news row;
// assembly and events fill the time lanes; last run reads the stop's GTFS
// schedule behind FEED_LASTRUN and declares no module. Bikes, parking and
// waste (T3.2) sit last, each behind its own flag, off until its source is
// confirmed (docs/izvori.md "Crveni izvori"); appended, never reordering the nine above.
export { assemblyProducer, gazetteProducer } from './civic';
export { bikesProducer } from './bikes';
export { eventsProducer } from './events';
export { lastRunProducer } from './last-run';
export { closuresProducer } from './mobility';
export { worksProducer } from './komunalno';
export { parkingProducer } from './parking';
export { safetyProducer, safetyVerdict, SAFETY_ICON } from './safety';
export { transitProducer } from './transit';
export { wasteProducer } from './waste';

import { assemblyProducer, gazetteProducer } from './civic';
import { bikesProducer } from './bikes';
import { eventsProducer } from './events';
import { lastRunProducer } from './last-run';
import { closuresProducer } from './mobility';
import { worksProducer } from './komunalno';
import { parkingProducer } from './parking';
import { safetyProducer } from './safety';
import { transitProducer } from './transit';
import { wasteProducer } from './waste';
import type { TileProducer } from '../timeband';

export const DEFAULT_PRODUCERS: readonly TileProducer[] = [
  transitProducer,
  closuresProducer,
  worksProducer,
  safetyProducer,
  gazetteProducer,
  assemblyProducer,
  eventsProducer,
  lastRunProducer,
  bikesProducer,
  parkingProducer,
  wasteProducer,
];
