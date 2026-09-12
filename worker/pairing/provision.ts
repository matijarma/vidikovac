import { beaconStub, type BeaconCreateInput } from '../do/beacon-do';
import { indexStub } from '../do/index-do';
import type { Env } from '../env';
import type { CreateBeaconResponse, ScreenMetadata, VenueType } from '../protocol';
import { randomId } from './tokens';
import { screenStop } from './stops';

export interface ProvisionInput {
  venueType: VenueType;
  area: string;
  operatorLabel: string;
  stopId: string | null;
  kind: 'temporary' | 'venue';
  expiresAt?: number;
}

/** Same beacon, authentication and redemption path for temporary and venue screens. */
export async function provisionScreen(env: Env, input: ProvisionInput, origin: string): Promise<CreateBeaconResponse> {
  const secret = randomId(20);
  const stop = input.stopId ? screenStop(input.stopId) : null;
  const screen: ScreenMetadata = { kind: input.kind, expiresAt: input.expiresAt ?? null, stop };
  for (let attempt = 0; attempt < 5; attempt++) {
    const beaconId = randomId(5);
    const record: BeaconCreateInput = {
      beaconId, secret, area: input.area, venueType: input.venueType,
      operatorLabel: input.operatorLabel, stopId: input.stopId, kind: input.kind,
      ...(stop ? { stop } : {}),
      ...(input.expiresAt ? { screenExpiresAt: input.expiresAt } : {}),
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
