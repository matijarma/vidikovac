import { DEFAULT_FRAME_STOPS, type FrameStops } from '../../shared/city/frame';
import { placeFromStop, type ScreenPlace } from '../../shared/city/place';
import { beaconStub, type BeaconCreateInput } from '../do/beacon-do';
import { indexStub } from '../do/index-do';
import type { Env } from '../env';
import type { CreateBeaconResponse, ScreenMetadata, VenueType } from '../protocol';
import { enrichPlace, isTramRoute } from './place';
import { randomId } from './tokens';
import { screenStop } from './stops';

export interface ProvisionInput {
  venueType: VenueType;
  area: string;
  operatorLabel: string;
  stopId: string | null;
  kind: 'temporary' | 'venue';
  expiresAt?: number;
  /**
   * The resolved place (worker/pairing/place.ts resolvePlace); a stop place names the same
   * stop as stopId. Null for the whole city; omitted, it is derived from the stop (the admin
   * route and the legacy `{ stopId }` body).
   */
  place?: ScreenPlace | null;
  /** Kadar 4 / 6 / 8, DEFAULT_FRAME_STOPS when omitted. */
  frame?: FrameStops;
}

/** Same beacon, authentication and redemption path for temporary and venue screens. */
export async function provisionScreen(env: Env, input: ProvisionInput, origin: string): Promise<CreateBeaconResponse> {
  const secret = randomId(20);
  const stop = input.stopId ? screenStop(input.stopId) : null;
  // No place given: the stop's, else none (null). A stop id the table does not know (the
  // admin route checks only its shape) leaves the place absent, the pre-place-v2 shape, since
  // a stored null may not carry a stop id; both read as Trg with placeSet false.
  const place = input.place !== undefined ? input.place : stop ? placeFromStop(stop, isTramRoute) : input.stopId === null ? null : undefined;
  const frame = input.frame ?? DEFAULT_FRAME_STOPS;
  // The same enrichment BeaconDO.screenMetadata() applies on every read, so the create
  // response, the scan grant and the room's 'joined' frame carry one and the same screen.
  const screen: ScreenMetadata = { kind: input.kind, expiresAt: input.expiresAt ?? null, stop, area: input.area, ...enrichPlace(place, stop), frame };
  for (let attempt = 0; attempt < 5; attempt++) {
    const beaconId = randomId(5);
    const record: BeaconCreateInput = {
      beaconId, secret, area: input.area, venueType: input.venueType,
      operatorLabel: input.operatorLabel, stopId: input.stopId, kind: input.kind,
      ...(stop ? { stop } : {}),
      ...(input.expiresAt ? { screenExpiresAt: input.expiresAt } : {}),
      ...(place !== undefined ? { place } : {}), frame,
    };
    if (!(await beaconStub(env, beaconId).create(record)).created) continue;
    try {
      await indexStub(env).registerBeacon({
        beaconId, venueType: input.venueType, area: input.area, operatorLabel: input.operatorLabel,
        stopId: input.stopId, createdAt: Date.now(), kind: input.kind, expiresAt: screen.expiresAt,
      });
    } catch (error) {
      await beaconStub(env, beaconId).revoke().catch(() => {});
      throw error;
    }
    return { beaconId, secret, provisionUrl: `${origin}/kiosk/#${beaconId}.${secret}`, screen };
  }
  throw new Error('screen-id-collision');
}
