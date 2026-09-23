import type { CreateBeaconResponse } from '../../../worker/protocol';
import type { ScreenStop } from './contracts';

/** Everything is optional: the one-button start posts an empty body and the
 *  Worker answers with a whole-city screen (area `zagreb`, no stop). An area
 *  or a stop is only ever named by a caller that already has one. */
export interface CreateScreenInput { area?: string; stopId?: string | null; operatorLabel?: string }

export class ScreenError extends Error {
  constructor(readonly reason: string, readonly status: number, readonly retryAfter = 0) {
    super(reason);
  }
}

export async function createTemporaryScreen(input: CreateScreenInput, fetchImpl: typeof fetch = fetch): Promise<CreateBeaconResponse> {
  const response = await fetchImpl('/api/screens', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), cache: 'no-store',
  });
  const body = await response.json() as CreateBeaconResponse & { error?: string; retryAfter?: number };
  if (!response.ok) throw new ScreenError(body.error ?? 'screen-create-failed', response.status, body.retryAfter ?? 0);
  if (!body.beaconId || !body.secret || !body.screen) throw new ScreenError('invalid-screen-response', 502);
  return body;
}

let stops: Promise<ScreenStop[]> | undefined;
/** Lazy: fetched for screen setup or stop search, never the lightweight entry graph. */
export function loadStops(fetchImpl: typeof fetch = fetch): Promise<ScreenStop[]> {
  return stops ??= fetchImpl('/data/stops.json').then(async (response) => {
    if (!response.ok) throw new Error('stops-unavailable');
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error('stops-unavailable');
    return data as ScreenStop[];
  }).catch((error) => { stops = undefined; throw error; });
}
