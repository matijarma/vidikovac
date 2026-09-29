// Rolling closure ends (upgrade 2026-10, U0 step 6). The City's closures dataset carries a placeholder end for a
// long closure and moves it forward by a day every night: in two copies a night apart
// (test/fixtures/prometnice-rolling/README.md) 19 of 39 ends moved exactly +24 h and the rest rolled the next night;
// every such closure had started at least 12.7 days before, the one real end (Jazbina) was 186 hours away, and no
// closure was between 1 and 13 days old. So a closure older than CLOSURE_ROLLING_AGE_D whose end is less than a day
// away has an unknown end: the surfaces say "u tijeku", and the header never states the end as a fact.
import type { FeedItem } from '../../worker/feed/schema';

/** A closure older than this many days whose end is within a day has a rolling, unknown end. */
export const CLOSURE_ROLLING_AGE_D = 7;

const DAY_MS = 86_400_000;

/** False when the closure started more than seven days ago and its published end is less than 24 h away; true otherwise. */
export function closureEndKnown(item: Pick<FeedItem, 'at' | 'until'>, now: number): boolean {
  const at = item.at ? Date.parse(item.at) : NaN;
  const until = item.until ? Date.parse(item.until) : NaN;
  if (!Number.isFinite(at) || !Number.isFinite(until)) return true;
  const ahead = until - now;
  return !(now - at > CLOSURE_ROLLING_AGE_D * DAY_MS && ahead > 0 && ahead < DAY_MS);
}
