// The two things the twin reaches outside itself for, each behind a test
// seam in the style of worker/feed/registry.ts's setFetcherForTest: the
// realtime upstream (a conditional GET of ZET's feed) and the static index
// asset. Production never calls the setters; a test in the workers project
// runs in the same isolate as the Durable Object, so a module-level override
// here is what the object sees.

import type { Env } from '../env';
import { upstreamFetchConditional } from '../feed/http';
import { ZET_RT_URL } from '../feed/modules/zet-rt';
import { fetchTripIndexRaw } from './index-load';

/** Fetches the feed, sending `If-None-Match` when an ETag is known; resolves
 *  to a 200 with bytes or a 304, throws on anything else. */
export type TwinUpstream = (etag: string | null) => Promise<Response>;

/** Resolves to the parsed index asset, or null when it cannot be read. */
export type TwinIndexSource = () => Promise<unknown | null>;

let upstreamOverride: TwinUpstream | null = null;
let indexOverride: TwinIndexSource | null = null;

export function setTwinUpstreamForTest(upstream: TwinUpstream | null): void {
  upstreamOverride = upstream;
}

export function setTwinIndexSourceForTest(source: TwinIndexSource | null): void {
  indexOverride = source;
}

export function twinUpstream(): TwinUpstream {
  return upstreamOverride ?? ((etag) => upstreamFetchConditional(ZET_RT_URL, etag));
}

export function twinIndexSource(env: Env): TwinIndexSource {
  return indexOverride ?? (() => fetchTripIndexRaw(env));
}
