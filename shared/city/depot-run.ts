// A tram on its way to the depot is no longer its line. ZET runs every
// pull-in as a passenger trip of its own: GTFS gives it the line's route id
// and the headsign "Spr. Trešnj." or "Spr.Dubrava" (721 such trips in feed
// 000396, under exactly these two headsigns), and GTFS-RT reports it under the
// same route id. The run leaves the line where the line turns away from the
// depot: a 17 for Trešnjevka goes on from Vodnikova by Tehnički muzej,
// Badalićeva, Trešnjevački trg, Nehajska and Selska to Ljubljanica, streets
// line 17 never serves, and the tram's own sign drops the number for
// "Spremište Trešnjevka". Pull-ins come whenever service thins, not only at
// night: weekday 0_30 starts 19 of its 173 between 08 and 10 h and 45
// between 18 and 20 h.
//
// So the app names the run as the city sees it: ST or SD, Spremište
// Trešnjevka or Spremište Dubrava. The route id stays the line's, because the
// twin's rails, ordering and learning are keyed on it; what changes is the
// label a rider reads. scripts/gtfs-lastrun.mjs keeps a copy of
// `depotRunOf`, line for line (test/city/depot-run.test.ts holds them equal).

export type DepotCode = 'ST' | 'SD';

export interface DepotRun {
  /** The front sign: what the tram says it is going to, in every language,
   *  like a stop's name. */
  name: string;
}

export const DEPOT_RUNS: Readonly<Record<DepotCode, DepotRun>> = {
  ST: { name: 'Spremište Trešnjevka' },
  SD: { name: 'Spremište Dubrava' },
};

/** "Spr. Trešnj.", "Spr.Dubrava", "SPREMIŠTE TREŠNJEVKA", "Spremište Dubrava":
 *  the depot it names, or null for every other headsign. */
export function depotRunOf(headsign: string | null | undefined): DepotCode | null {
  if (!headsign) return null;
  const plain = headsign.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim();
  const match = /^spr(?:emiste)? ?(tresnj\w*|dubrav\w*)$/.exec(plain);
  if (!match) return null;
  return match[1].startsWith('tresnj') ? 'ST' : 'SD';
}

/** Is this route label one of the two depot codes? */
export function isDepotCode(label: string | null | undefined): label is DepotCode {
  return label === 'ST' || label === 'SD';
}
