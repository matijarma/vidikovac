// Pure selection: from the four open-tier snapshots to exactly what /hitno
// shows. No fetching, no HTML; render.ts turns the result into markup.
import type { FeedItem, ModuleId, ModuleSnapshot, Severity, SourceAvailability } from '../feed/schema';
import { parseIso } from '../open/time';

export const HITNO_MODULES: readonly ModuleId[] = ['dhmz-cap', 'emsc', 'prometnice', 'ckan-geo'];

export const QUAKE_WINDOW_MS = 72 * 60 * 60 * 1000;
/** A quake stamped slightly in the future (clock skew at the source) is still shown. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** The poi layer slug Area A's ckan-geo module stamps on every civil-protection
 *  assembly point (FeedItem.data.layer, the poi vocabulary of R-22). */
export const ZBORNA_MJESTA_LAYER = 'zborna-mjesta';

/** CAP severity in words: the DHMZ colour convention, always beside a shape (R-K1). Colour never carries this alone; "zeleno" is never a level. */
export const SEVERITY_WORDS: Readonly<Record<Severity, string>> = {
  info: 'obavijest',
  minor: 'manje upozorenje',
  moderate: 'žuto upozorenje',
  severe: 'narančasto upozorenje',
  extreme: 'crveno upozorenje',
};

const SEVERITY_RANK: Readonly<Record<Severity, number>> = {
  extreme: 4,
  severe: 3,
  moderate: 2,
  minor: 1,
  info: 0,
};

export interface HitnoPanel {
  snapshot: ModuleSnapshot | null;
  items: FeedItem[];
  /** The panel's own source health, not the health of an unrelated spatial layer.
   *  null means the legacy/missing snapshot cannot establish this source's health. */
  availability: SourceAvailability | null;
  /** Only `empty` supports a current no-results message. Stale empty lists and
   *  missing/failed sources must never be presented as an all-clear. */
  state: 'ready' | 'empty' | 'stale' | 'unavailable';
}

export interface HitnoData {
  warnings: HitnoPanel;
  quakes: HitnoPanel;
  closures: HitnoPanel;
  assembly: HitnoPanel;
}

function ms(iso: string | undefined): number | null {
  const d = parseIso(iso);
  return d === null ? null : d.getTime();
}

function find(snapshots: readonly ModuleSnapshot[], id: ModuleId): ModuleSnapshot | null {
  return snapshots.find((s) => s.module === id) ?? null;
}

function byTitle(a: FeedItem, b: FeedItem): number {
  return a.title.localeCompare(b.title, 'hr');
}

export function isActiveWarning(item: FeedItem, now: Date): boolean {
  const start = ms(item.at);
  return start === null || start <= now.getTime();
}

export function selectWarnings(snapshot: ModuleSnapshot | null, now: Date): FeedItem[] {
  if (snapshot === null) return [];
  const t = now.getTime();
  return snapshot.items
    .filter((i) => i.kind === 'warning')
    .filter((i) => {
      const until = ms(i.until);
      return until === null || until >= t;
    })
    .sort((a, b) => {
      const rank = SEVERITY_RANK[b.severity ?? 'info'] - SEVERITY_RANK[a.severity ?? 'info'];
      return rank !== 0 ? rank : (ms(a.at) ?? 0) - (ms(b.at) ?? 0);
    });
}

export function selectQuakes(snapshot: ModuleSnapshot | null, now: Date): FeedItem[] {
  if (snapshot === null) return [];
  const t = now.getTime();
  return snapshot.items
    .filter((i) => i.kind === 'quake')
    .filter((i) => {
      const at = ms(i.at);
      return at !== null && at >= t - QUAKE_WINDOW_MS && at <= t + FUTURE_TOLERANCE_MS;
    })
    .sort((a, b) => (ms(b.at) ?? 0) - (ms(a.at) ?? 0));
}

export function selectClosures(snapshot: ModuleSnapshot | null, now: Date): FeedItem[] {
  if (snapshot === null) return [];
  const t = now.getTime();
  return snapshot.items
    .filter((i) => i.kind === 'closure')
    .filter((i) => {
      const start = ms(i.at);
      const until = ms(i.until);
      return (start === null || start <= t) && (until === null || until >= t);
    })
    .sort((a, b) => {
      const ua = ms(a.until);
      const ub = ms(b.until);
      if (ua === null && ub === null) return byTitle(a, b);
      if (ua === null) return 1;
      if (ub === null) return -1;
      return ua !== ub ? ua - ub : byTitle(a, b);
    });
}

export function selectAssemblyPoints(snapshot: ModuleSnapshot | null): FeedItem[] {
  if (snapshot === null) return [];
  return snapshot.items
    .filter((i) => i.kind === 'poi' && i.data?.layer === ZBORNA_MJESTA_LAYER)
    .sort(byTitle);
}

function panel(snapshot: ModuleSnapshot | null, items: FeedItem[], source?: string): HitnoPanel {
  let availability: SourceAvailability | null = null;
  if (snapshot) {
    const ownSource = source === undefined ? {
      status: snapshot.status,
      itemCount: snapshot.items.length,
      ...(snapshot.status !== 'down' ? { fetchedAt: snapshot.fetchedAt } : {}),
      ...(snapshot.sourceUpdatedAt ? { sourceUpdatedAt: snapshot.sourceUpdatedAt } : {}),
    } : snapshot.sources?.[source];
    if (ownSource) {
      // A fresh partial composite is top-level stale even when this source
      // succeeded. Trust its own status/timestamp: total-failure KV fallback
      // explicitly marks formerly live sources stale. Legacy sources without
      // a readable fetch timestamp cannot establish that independence.
      const hasSourceFetch = source !== undefined && ms(ownSource.fetchedAt) !== null;
      const status = snapshot.status === 'down' || ownSource.status === 'down' ? 'down'
        : ownSource.status === 'stale' || (snapshot.status === 'stale' && !hasSourceFetch) ? 'stale' : 'live';
      availability = { ...ownSource, status };
    }
  }
  const state = !availability || availability.status === 'down' ? 'unavailable'
    : availability.status === 'stale' ? 'stale'
    : items.length > 0 ? 'ready' : 'empty';
  return { snapshot, items, availability, state };
}

export function selectHitno(snapshots: readonly ModuleSnapshot[], now: Date): HitnoData {
  const cap = find(snapshots, 'dhmz-cap');
  const emsc = find(snapshots, 'emsc');
  const prometnice = find(snapshots, 'prometnice');
  const ckan = find(snapshots, 'ckan-geo');
  return {
    warnings: panel(cap, selectWarnings(cap, now)),
    quakes: panel(emsc, selectQuakes(emsc, now)),
    closures: panel(prometnice, selectClosures(prometnice, now)),
    assembly: panel(ckan, selectAssemblyPoints(ckan), ZBORNA_MJESTA_LAYER),
  };
}
