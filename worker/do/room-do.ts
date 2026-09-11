// Placeholder for task B7. BeaconDO (this task, B6) needs RoomDO's `open()`
// to turn a redeemed code into a session; task B7 replaces this file with
// the full RoomDO (tickets, resume, driver view, one-hop share, expiry
// chain). Until then this object stores nothing and answers every open()
// with zero participants, exactly as task-B6-brief.md's Step 5 specifies.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import type { BeaconKind, Role, VenueType } from '../protocol';

export interface RoomTicket {
  ticket: string;
  role: Role;
}

export interface RoomOpenInput {
  roomId: string;
  expiresAt: number;
  beaconType: BeaconKind;
  venueType: VenueType | null;
  area: string | null;
  screenLabel: string | null;
  tickets: RoomTicket[];
}

export function roomStub(env: Env, roomId: string): DurableObjectStub<RoomDO> {
  const namespace = env.ROOM_DO as DurableObjectNamespace<RoomDO>;
  return namespace.get(namespace.idFromName(roomId));
}

export class RoomDO extends DurableObject<Env> {
  async open(_input: RoomOpenInput): Promise<{ participants: number }> {
    return { participants: 0 };
  }
}
