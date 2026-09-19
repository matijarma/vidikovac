// The three things the twin reaches outside itself for, each behind a test
// seam in the style of worker/feed/registry.ts's setFetcherForTest: the
// realtime upstream (a conditional GET of ZET's feed), the static trip index
// and the network artefact. Production never calls the setters; a test in
// the workers project runs in the same isolate as the Durable Object, so a
// module-level override here is what the object sees.

import type { DwellOverride } from '../../shared/motion/dwell';
import type { GraphNetwork } from '../../shared/motion/network';
import type { TripIndex } from '../../shared/motion/trips';
import type { Env } from '../env';
import { upstreamFetchConditional } from '../feed/http';
import { ZET_RT_URL } from '../feed/modules/zet-rt';
import { fetchDwellOverrides, fetchNetwork, fetchTripIndex } from './index-load';

/** Fetches the feed, sending `If-None-Match` when an ETag is known; resolves
 *  to a 200 with bytes or a 304, throws on anything else. */
export type TwinUpstream = (etag: string | null) => Promise<Response>;

/** Resolves to the decoded trip index, or null when it cannot be read. */
export type TwinIndexSource = () => Promise<TripIndex | null>;

/** Resolves to the decoded network artefact, or null when it cannot be read. */
export type TwinNetworkSource = () => Promise<GraphNetwork | null>;

/** Resolves to the owner's dwell overrides (F11); an empty list when the
 *  file is missing or unreadable. */
export type TwinOverridesSource = () => Promise<DwellOverride[]>;

let upstreamOverride: TwinUpstream | null = null;
let indexOverride: TwinIndexSource | null = null;
let networkOverride: TwinNetworkSource | null = null;
let overridesOverride: TwinOverridesSource | null = null;

export function setTwinUpstreamForTest(upstream: TwinUpstream | null): void {
  upstreamOverride = upstream;
}

export function setTwinIndexSourceForTest(source: TwinIndexSource | null): void {
  indexOverride = source;
}

export function setTwinNetworkSourceForTest(source: TwinNetworkSource | null): void {
  networkOverride = source;
}

export function setTwinOverridesSourceForTest(source: TwinOverridesSource | null): void {
  overridesOverride = source;
}

export function twinUpstream(): TwinUpstream {
  return upstreamOverride ?? ((etag) => upstreamFetchConditional(ZET_RT_URL, etag));
}

export function twinIndexSource(env: Env): TwinIndexSource {
  return indexOverride ?? (() => fetchTripIndex(env));
}

export function twinNetworkSource(env: Env): TwinNetworkSource {
  return networkOverride ?? (() => fetchNetwork(env));
}

export function twinOverridesSource(env: Env): TwinOverridesSource {
  return overridesOverride ?? (() => fetchDwellOverrides(env));
}
