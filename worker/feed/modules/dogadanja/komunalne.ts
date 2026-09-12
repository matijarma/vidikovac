import type { FetchContext } from '../../schema';
import { decodeEntities, stripTags } from '../../html';
import { parseHrDate, type Precision } from '../../hr-date';

// data.zagreb.hr's "Plan komunalnih aktivnosti" -- the live register of
// neighbourhood public works the City agrees with the mjesni odbori, the one
// daily-refreshed dataset the research sweep found alongside the road-closures
// feed (see the area E preamble). Confirmed live in
// test/fixtures/dogadanja/komunalne-aktivnosti.json and its sources.json note.
// The resource download URL is pinned unchanged from stage 1's docs/izvori.md;
// data.zagreb.hr's robots.txt disallows /api/ (the package_show metadata
// endpoint) but not this direct resource download path -- see sources.json.
export const KOMUNALNE_URL =
  'https://data.zagreb.hr/dataset/fddb4f87-c002-4e3c-b988-adf013997ecc/resource/f90738b6-8bfa-4dd9-9db7-b3c532d90c97/download/data.json';

// AXIS SWAP, VERIFIED ACROSS ALL 700 RECORDS OF THE LIVE FIXTURE: this feed
// names its own fields X_Koordinata / Y_Koordinata, and the reasonable
// assumption -- X is longitude, Y is latitude, the GeoJSON/most-GIS
// convention -- is wrong for this source. X_Koordinata carries Zagreb's
// *latitude* (~45.4-45.9) and Y_Koordinata its *longitude* (~15.4-16.6). Get
// this backwards and every pin lands with valid-looking numbers roughly
// 1,500 km from Zagreb (latitude and longitude swapped puts them off the
// Croatian coast), so nothing throws -- this is the single easiest silent bug
// in this file, which is why it is verified here rather than assumed:
// test/feed/dogadanja/komunalne.test.ts asserts a known record's swapped
// coordinate lands inside Zagreb's own bounding box. `geo.coordinates` below
// is built as [Y_Koordinata, X_Koordinata], rounded to 5 decimals like every
// other module in this project, specifically to undo the swap.

// The complete phase/status vocabulary, verified across all 700 records of
// the live fixture -- a closed set the source itself defines (six phases,
// three statuses), not a sample of a larger open-ended one (unlike
// Kulturpunkt's WordPress category tags, kulturpunkt.ts). A record whose
// phase or status falls outside this set is dropped rather than passed
// through unchecked -- see droppedCount.
const KNOWN_PHASES = [
  'U pripremi',
  'Ugovaranje',
  'Provedba javne nabave',
  'Izvođač uveden u posao',
  'Radovi u tijeku',
  'Završeni radovi',
] as const;
export type KomunalnaFaza = (typeof KNOWN_PHASES)[number];

const KNOWN_STATUSES = ['U tijeku', 'Zastoj', 'Gotovo'] as const;
export type KomunalniStatus = (typeof KNOWN_STATUSES)[number];

function isKnownPhase(value: string): value is KomunalnaFaza {
  return (KNOWN_PHASES as readonly string[]).includes(value);
}

function isKnownStatus(value: string): value is KomunalniStatus {
  return (KNOWN_STATUSES as readonly string[]).includes(value);
}

const COORD_PRECISION = 1e5;
function roundCoord(value: number): number {
  return Math.round(value * COORD_PRECISION) / COORD_PRECISION;
}

/** 51 of 700 records carry an empty X_Koordinata/Y_Koordinata (always both, or neither -- verified). */
function parseCoord(raw: string): number | null {
  if (!raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** "1502,5" -> 1502.5: 11 of 700 records write Iznos with a comma decimal separator, not a dot. */
function parseAmount(raw: string): number | null {
  const value = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

interface KomunalneRow {
  ID: string;
  Lokacija: string;
  Aktivnost: string;
  FazaAkcije: string;
  X_Koordinata: string;
  Y_Koordinata: string;
  ZadnjaPromjena: string;
  StatusAktivnosti: string;
  Iznos: string;
}

/**
 * One communal-works item, already reduced to headline-level metadata plus
 * R-P6's one named exception: `Aktivnost` (the works description) is
 * Otvorena dozvola data, not borrowed prose, so it alone becomes `summary` --
 * no other sub-fetcher in this directory sets that field.
 */
export interface KomunalneEvent {
  id: string;
  /** The location text (Lokacija) -- this register has no separate project name. */
  title: string;
  summary: string;
  /** ISO 8601, Europe/Zagreb midnight -- the register's own last-change date. Always day precision (see file header). */
  at: string;
  dateBasis: 'updated';
  /** [lon, lat], 5 decimals. Omitted, never guessed, for the 51/700 records with no coordinates at all. */
  geo?: { type: 'Point'; coordinates: [number, number] };
  data: {
    source: 'komunalne';
    phase: KomunalnaFaza;
    status: KomunalniStatus;
    amount: number;
    precision: Precision;
  };
}

export interface KomunalneResult {
  items: KomunalneEvent[];
  /** Rows with no last-change date, or a phase/status/amount this module cannot verify -- dropped, never guessed. */
  droppedCount: number;
  totalItems: number;
}

export async function fetchKomunalne(ctx: FetchContext): Promise<KomunalneResult> {
  const response = await ctx.fetch(KOMUNALNE_URL);
  if (!response.ok) throw new Error(`komunalne: HTTP ${response.status}`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) throw new Error('komunalne: unexpected response shape');

  const now = ctx.now();
  const items: KomunalneEvent[] = [];
  let droppedCount = 0;

  for (const row of rows as KomunalneRow[]) {
    const phase = decodeEntities(row.FazaAkcije ?? '').trim();
    const status = decodeEntities(row.StatusAktivnosti ?? '').trim();
    const amount = parseAmount(row.Iznos ?? '');
    // ZadnjaPromjena is a machine last-change stamp ("dd.mm.yyyy[ hh:mm:ss]" or
    // "d.m.yyyy."), always with an explicit year -- the same numeric anchor
    // grammar parseHrDate already recognises as its first alternative, so this
    // reuses it rather than hand-rolling a second dd.mm.yyyy regex. Every real
    // value's time-of-day is always 00:00:00, which never matches parseHrDate's
    // "sati"-anchored time grammar, so precision naturally comes back 'day' --
    // forced explicitly below anyway, per the brief's own rule.
    const changed = parseHrDate(row.ZadnjaPromjena ?? '', now);
    if (!isKnownPhase(phase) || !isKnownStatus(status) || amount === null || !changed) {
      droppedCount += 1;
      continue;
    }

    const lat = parseCoord(row.X_Koordinata ?? '');
    const lon = parseCoord(row.Y_Koordinata ?? '');

    items.push({
      id: `komunalne:${row.ID}`,
      title: decodeEntities(row.Lokacija ?? '').trim(),
      summary: typeof row.Aktivnost === 'string' ? stripTags(decodeEntities(row.Aktivnost)) : '',
      at: changed.startIso,
      dateBasis: 'updated',
      ...(lat !== null && lon !== null
        ? { geo: { type: 'Point' as const, coordinates: [roundCoord(lon), roundCoord(lat)] as [number, number] } }
        : {}),
      data: {
        source: 'komunalne',
        phase,
        status,
        amount,
        precision: 'day',
      },
    });
  }

  return { items, droppedCount, totalItems: items.length };
}
