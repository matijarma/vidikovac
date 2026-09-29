// A street named in a text ("JARUNSKA 6", "Aleji Seljačke bune", "ZAGREBAČKA CESTA 40-66 par")
// to a point on the map. The Worker has no other way to place the power and water cuts and
// the road notices it reads: the sources give a street as words, in the case they happen to
// need, and no coordinate.
//
// The index is worker/data/street-points.json (scripts/street-points.mjs, from the street
// index the app ships: OpenStreetMap, ODbL 1.0). A name is matched on the case-ending stems
// of its words (shared/city/stems.ts): "Aleji Seljačke bune" is the street "Aleja Seljačke
// bune", and "JURJA NEIDHARDTA" is "Ulica Jurja Neidhardta". A name the index does not hold,
// or one that stands in two places far apart, has no point: a cut is never put on a guessed
// street.
import points from '../../data/street-points.json' with { type: 'json' };
import type { AreaSlug } from '../../pairing/areas';
import { distanceM } from '../../../shared/city/geo';
import { stemWords } from '../../../shared/city/stems';
import { districtOf } from './districts';

export interface StreetPoint {
  lon: number;
  lat: number;
  /** The street as the index spells it. */
  name: string;
  district: AreaSlug | null;
}

/** Two streets of the same name closer than this are one street cut in pieces (a settlement border). */
export const SAME_STREET_M = 1000;

interface Wire {
  origin: [number, number];
  pointScale: number;
  settlements: string[];
  name: string[];
  settlement: number[];
  lon: number[];
  lat: number[];
}

interface Row {
  name: string;
  settlementKey: string;
  lon: number;
  lat: number;
}

/** The house numbers of a street text: "98-do kraja par", "6", "1/A", "25/B", "2A". */
const HOUSE_NUMBER = /^\d+(?:[-/][\da-z]+|[a-z])?,?$/i;

/**
 * A street text without its house numbers: the words up to the first token that is a number
 * ("6", "98-do", "1/A") or "bb" (without a number), and that tail. The first token is never cut, so
 * "1. Zagrebački odvojak" keeps its 1., and an ordinal ("I.", "2.") inside a name is not a house number.
 */
export function splitHouseNumbers(text: string): { name: string; numbers: string } {
  const tokens = text.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  let cut = tokens.length;
  for (let i = 1; i < tokens.length; i += 1) {
    if (/^bb,?$/i.test(tokens[i]!) || HOUSE_NUMBER.test(tokens[i]!)) {
      cut = i;
      break;
    }
  }
  return { name: tokens.slice(0, cut).join(' ').replace(/[,;.]+$/, ''), numbers: tokens.slice(cut).join(' ') };
}

/** The forms a street's stems are looked up by: as written, without a leading "ulica", without a trailing one. */
function stemKeys(stems: readonly string[]): string[] {
  const keys = [stems.join(' ')];
  if (stems.length > 1 && stems[0] === 'ulic') keys.push(stems.slice(1).join(' '));
  if (stems.length > 1 && stems[stems.length - 1] === 'ulic') keys.push(stems.slice(0, -1).join(' '));
  return keys;
}

let byKey: Map<string, Row[]> | undefined;

function index(): Map<string, Row[]> {
  if (byKey) return byKey;
  const wire = points as unknown as Wire;
  const [ox, oy] = wire.origin;
  const settlementKeys = wire.settlements.map((settlement) => stemWords(settlement).join(' '));
  const map = new Map<string, Row[]>();
  wire.name.forEach((name, i) => {
    const row: Row = {
      name,
      settlementKey: settlementKeys[wire.settlement[i]!]!,
      lon: (ox + wire.lon[i]!) / wire.pointScale,
      lat: (oy + wire.lat[i]!) / wire.pointScale,
    };
    for (const key of new Set(stemKeys(stemWords(name)))) {
      const rows = map.get(key);
      if (rows) rows.push(row);
      else map.set(key, [row]);
    }
  });
  byKey = map;
  return map;
}

/**
 * The point of a street named in a text, or null. House numbers and "bb" are dropped; the words are
 * matched on their stems against each street of the index, also with a leading or trailing "ulica"
 * left out. With several matches the one in the given settlement (compared on stems, so "Sesvete" and
 * "Sesvetama" agree) stands; if several still remain and any two are more than a kilometre apart, the
 * name is ambiguous and there is no point.
 */
export function streetPoint(name: string, settlement?: string): StreetPoint | null {
  const stems = stemWords(splitHouseNumbers(name).name);
  if (stems.length === 0) return null;
  const found = new Set<Row>();
  for (const key of stemKeys(stems)) for (const row of index().get(key) ?? []) found.add(row);
  let candidates = [...found];
  if (candidates.length > 1 && settlement) {
    const wanted = stemWords(settlement).join(' ');
    const there = candidates.filter((row) => row.settlementKey === wanted);
    if (there.length > 0) candidates = there;
  }
  if (candidates.length === 0) return null;
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (distanceM(candidates[i]!, candidates[j]!) > SAME_STREET_M) return null;
    }
  }
  const row = candidates[0]!;
  return { lon: row.lon, lat: row.lat, name: row.name, district: districtOf(row.lon, row.lat) };
}
