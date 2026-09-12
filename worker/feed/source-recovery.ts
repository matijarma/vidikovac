import type { FeedItem, ModuleSnapshot, SourceAvailability } from './schema';
import { sourceCoverage } from './payload';

function sourceOf(item: FeedItem): string {
  if (item.module === 'ckan-geo') return String(item.data?.layer ?? '');
  if (item.data?.source === 'etnografski') {
    return item.data.category === 'izlozba' ? 'etnografski-izlozbe' : 'etnografski-dogadjanja';
  }
  return String(item.data?.source ?? '');
}

function withinWindow(source: SourceAvailability, now: number, maxStaleSeconds: number): boolean {
  const fetchedAt = Date.parse(source.fetchedAt ?? '');
  return Number.isFinite(fetchedAt) && now - fetchedAt <= maxStaleSeconds * 1000;
}

/** A good endpoint must not erase last-good rows from another failed endpoint. */
export function recoverPartialSources(
  fresh: ModuleSnapshot,
  previous: ModuleSnapshot | null,
  now: number,
  maxStaleSeconds: number,
): ModuleSnapshot {
  if (!fresh.sources || !previous?.sources) return fresh;
  const sources = { ...fresh.sources };
  const items = [...fresh.items];
  let recovered = false;
  for (const [key, source] of Object.entries(sources)) {
    if (source.status !== 'down') continue;
    const old = previous.sources[key];
    if (!old || old.status === 'down' || !withinWindow(old, now, maxStaleSeconds)) continue;
    const rows = previous.items.filter((item) => sourceOf(item) === key);
    sources[key] = { ...old, status: 'stale', itemCount: rows.length };
    items.push(...rows);
    recovered = true;
  }
  return recovered ? { ...fresh, items, sources, status: 'stale', coverage: sourceCoverage(sources) } : fresh;
}

/** Per-source age is never extended by successful fetches of another source. */
export function expireStaleSources(snapshot: ModuleSnapshot, now: number, maxStaleSeconds: number): ModuleSnapshot {
  if (!snapshot.sources) return snapshot;
  const expired = new Set(Object.entries(snapshot.sources)
    .filter(([, source]) => source.status === 'stale' && !withinWindow(source, now, maxStaleSeconds))
    .map(([key]) => key));
  if (!expired.size) return snapshot;
  const sources = Object.fromEntries(Object.entries(snapshot.sources).map(([key, source]) => [
    key, expired.has(key) ? { status: 'down' as const, itemCount: 0 } : source,
  ]));
  return {
    ...snapshot,
    status: Object.values(sources).every((source) => source.status === 'down') ? 'down' : 'stale',
    items: snapshot.items.filter((item) => !expired.has(sourceOf(item))),
    sources, coverage: sourceCoverage(sources),
  };
}
