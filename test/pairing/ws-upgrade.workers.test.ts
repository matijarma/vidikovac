import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { beaconStub, type BeaconCreateInput } from '../../worker/do/beacon-do';
import type { Env } from '../../worker/env';
import { randomId } from '../../worker/pairing/tokens';

const testEnv = env as unknown as Env;

function upgrade(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`https://vidikovac.test${path}`, {
    headers: { Upgrade: 'websocket', 'CF-Connecting-IP': '198.51.100.30', ...headers },
  });
}

/** A 101 leaves a live socket behind; close it so the test ends cleanly. */
function closeUpgrade(response: Response): void {
  const socket = response.webSocket;
  if (socket === null) return;
  socket.accept();
  socket.close(1000, 'done');
}

async function provision(): Promise<string> {
  const beaconId = randomId(5);
  const input: BeaconCreateInput = {
    beaconId,
    venueType: 'knjiznica',
    area: 'trnje',
    operatorLabel: 'Knjižnica Trnje',
    stopId: null,
    secret: randomId(20),
  };
  expect(await beaconStub(testEnv, beaconId).create(input)).toEqual({ created: true });
  return beaconId;
}

describe('GET /ws/beacon/:beaconId', () => {
  it('upgrades a provisioned screen and supplies the net key the client cannot mint', async () => {
    const beaconId = await provision();
    // A client-supplied X-Net-Key must be discarded: the DO rejects anything that is not 22 base64url characters.
    const response = await upgrade(`/ws/beacon/${beaconId}`, { 'X-Net-Key': 'podmetnuti-kljuc' });
    expect(response.status).toBe(101);
    closeUpgrade(response);
  });

  it('404s an unknown but well-formed screen and a malformed id', async () => {
    expect((await upgrade(`/ws/beacon/${randomId(5)}`)).status).toBe(404);
    expect((await upgrade('/ws/beacon/kratko')).status).toBe(404);
    expect((await upgrade('/ws/beacon/ABCDEFGI')).status).toBe(404); // I is not in CODE_ALPHABET
  });

  it('426s a plain GET and 403s a cross-origin handshake', async () => {
    const beaconId = await provision();
    const plain = await SELF.fetch(`https://vidikovac.test/ws/beacon/${beaconId}`);
    expect(plain.status).toBe(426);
    const foreign = await upgrade(`/ws/beacon/${beaconId}`, { Origin: 'https://zlonamjerni.example' });
    expect(foreign.status).toBe(403);
  });
});

describe('GET /ws/room/:roomId', () => {
  it('upgrades a well-formed room id and 404s anything else', async () => {
    const response = await upgrade(`/ws/room/${randomId(10)}`);
    expect(response.status).toBe(101);
    closeUpgrade(response);
    expect((await upgrade('/ws/room/PREKRATAK')).status).toBe(404);
    expect((await upgrade('/ws/room/')).status).toBe(404);
  });
});
