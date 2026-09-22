import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../worker/env';
import { beaconStub, type BeaconDO } from '../../worker/do/beacon-do';
import { roomStub } from '../../worker/do/room-do';
import type { CodeSlot } from '../../worker/protocol';
import type { PresentationResult, PresentationState, ScreenPresentation } from '../../worker/presentation';
import { provision, connectBeaconDirect, connectRoom, kioskAnswer, KIOSK_NET_KEY } from './helpers';

const testEnv = env as unknown as Env;
async function screen(capabilities:string[] = []) {
  const { beaconId, secret } = await provision();
  const kiosk = await connectBeaconDirect(beaconId, KIOSK_NET_KEY);
  const challenge = await kiosk.inbox.nextOfType('challenge');
  kiosk.ws.send(JSON.stringify({ t: 'auth', hmac: await kioskAnswer(secret, String(challenge.nonce)), presentationVersion: 1,capabilities }));
  const batch = (await kiosk.inbox.nextOfType('codes')).batch as CodeSlot[];
  const initial = (await kiosk.inbox.nextOfType('presentation')).presentation as ScreenPresentation;
  const stub = beaconStub(testEnv, beaconId);
  async function scanner(index: number) {
    await runInDurableObject(stub, (instance: BeaconDO) => { vi.spyOn(instance, 'now').mockReturnValue(batch[index]!.slotStart + 1000); });
    const result = await stub.redeem(batch[index]!.code);
    if (!result.ok) throw new Error(result.error);
    const phone = await connectRoom(result.scan.roomId);
    phone.ws.send(JSON.stringify({ t: 'join', ticket: result.scan.ticket }));
    const joined = await phone.inbox.nextOfType('joined');
    return { phone, scan: result.scan, state: joined.presentation as PresentationState };
  }
  return { beaconId, secret, kiosk, initial, stub, scanner };
}

describe('screen-owned explicit presentation', () => {
  it('negotiates city subjects without sending unknown selections to an old screen',async()=>{
    for(const capabilities of [[],['city-v1']]){
      const s=await screen(capabilities),a=await s.scanner(0);
      const result=await s.stub.present(a.scan.roomId,{version:1,requestId:'city-test',expectedRevision:0,action:'present',target:{layer:'u-pokretu',selection:{kind:'place',id:'culture-a'}}});
      if(capabilities.length){
        expect(result.error).toBeUndefined();expect(result.state.status).toBe('pending');
        const frame=await s.kiosk.inbox.nextOfType('presentation');
        expect((frame.presentation as ScreenPresentation).target?.selection).toEqual({kind:'place',id:'culture-a'});
      }else expect(result.error).toBe('unsupported');
      a.phone.ws.close(1000,'done');s.kiosk.ws.close(1000,'done');
    }
  });
  it('scanning leaves the public overview, delivers only public context and waits for a screen ack', async () => {
    const s = await screen();
    const { phone, scan, state } = await s.scanner(0);
    expect(state).toMatchObject({ version: 1, revision: 0, target: null, online: true, supported: true });
    expect((await s.kiosk.inbox.nextOfType('paired')).expiresAt).toBe(scan.expiresAt);
    expect((await s.stub.presentationStatus(scan.roomId)).target).toBeNull();
    phone.ws.send(JSON.stringify({ t: 'present', command: { version: 1, requestId: 'first', expectedRevision: 0, action: 'present', target: { layer: 'u-pokretu', selection: { kind: 'route', id: '6' } } } }));
    const result = (await phone.inbox.nextOfType('presentation-result')).result as PresentationResult;
    expect(result).toMatchObject({ requestId: 'first', state: { owner: 'self', status: 'pending', revision: 1 } });
    const shown = (await s.kiosk.inbox.nextOfType('presentation')).presentation as ScreenPresentation;
    expect(shown.target).toEqual({ layer: 'u-pokretu', selection: { kind: 'route', id: '6' } });
    expect(shown.dataToken).toBeTruthy();
    expect(JSON.stringify(result)).not.toContain(shown.dataToken);
    s.kiosk.ws.send(JSON.stringify({ t: 'presented', version: 1, revision: 1, status: 'displayed' }));
    const ack = await phone.inbox.nextWhere(f => f.t === 'presentation' && (f.state as PresentationState).status === 'displayed');
    expect(ack.state).toMatchObject({ revision: 1, owner: 'self' });
    // A feed refresh may remove or restore the subject without a new request.
    // The controller keeps its ownership; only rendered availability changes.
    for (const status of ['unavailable', 'displayed'] as const) {
      s.kiosk.ws.send(JSON.stringify({ t: 'presented', version: 1, revision: 1, status }));
      const refreshed = await phone.inbox.nextWhere(f => f.t === 'presentation' && (f.state as PresentationState).status === status);
      expect(refreshed.state).toMatchObject({ revision: 1, owner: 'self', status });
    }
    phone.ws.close(1000, 'done'); s.kiosk.ws.close(1000, 'done');
  });

  it('a second scan does not interrupt; takeover is explicit, revision checked and not replayable', async () => {
    const s = await screen();
    const a = await s.scanner(0);
    const first = { version: 1 as const, requestId: 'a_first', expectedRevision: 0, action: 'present' as const, target: { layer: 'kultura' as const } };
    expect((await s.stub.present(a.scan.roomId, first)).state.revision).toBe(1);
    const b = await s.scanner(1);
    expect(b.state).toMatchObject({ owner: 'other', revision: 1, target: { layer: 'kultura' } });
    const second = { ...first, requestId: 'b_first', expectedRevision: 1, target: { layer: 'zrak-i-nebo' as const } };
    expect((await s.stub.present(b.scan.roomId, second)).error).toBe('occupied');
    expect((await s.stub.present(b.scan.roomId, { ...second, takeover: true, expectedRevision: 0 })).error).toBe('changed');
    expect((await s.stub.present(b.scan.roomId, { ...second, takeover: true })).state).toMatchObject({ owner: 'self', revision: 2 });
    expect((await s.stub.presentationStatus(a.scan.roomId)).owner).toBe('other');
    // Retransmitting an already accepted first request cannot steal it back.
    expect((await s.stub.present(a.scan.roomId, first)).state).toMatchObject({ owner: 'other', revision: 2 });
    s.kiosk.ws.send(JSON.stringify({ t: 'presented', version: 1, revision: 1, status: 'displayed' }));
    expect((await s.stub.presentationStatus(b.scan.roomId)).status).toBe('pending');
    expect((await s.stub.present(a.scan.roomId, { version: 1, requestId: 'wrong-stop', expectedRevision: 2, action: 'stop' })).error).toBe('not-allowed');
    expect((await s.stub.present(b.scan.roomId, { version: 1, requestId: 'stop', expectedRevision: 2, action: 'stop' })).state).toMatchObject({ owner: null, target: null, revision: 3 });
    a.phone.ws.close(1000, 'done'); b.phone.ws.close(1000, 'done'); s.kiosk.ws.close(1000, 'done');
  });

  it('a screen socket cannot end a presentation; the presenter\'s phone can (T6)', async () => {
    const s = await screen();
    const a = await s.scanner(0);
    await s.stub.present(a.scan.roomId, { version: 1, requestId: 'show', expectedRevision: 0, action: 'present', target: { layer: 'kultura' } });
    expect(((await s.kiosk.inbox.nextOfType('presentation')).presentation as ScreenPresentation).revision).toBe(1);
    // The frame a kiosk bundle with the old wall button sent: read and ignored, never a bad-frame error.
    s.kiosk.ws.send(JSON.stringify({ t: 'presentation-stop', version: 1, revision: 1 }));
    // One socket's frames are handled in order, so once this ack reaches the phone the stop was seen.
    s.kiosk.ws.send(JSON.stringify({ t: 'presented', version: 1, revision: 1, status: 'displayed' }));
    const ack = await a.phone.inbox.nextWhere(f => f.t === 'presentation' && (f.state as PresentationState).status === 'displayed');
    expect(ack.state).toMatchObject({ revision: 1, owner: 'self', target: { layer: 'kultura' } });
    expect(await s.stub.presentationStatus(a.scan.roomId)).toMatchObject({ revision: 1, owner: 'self', target: { layer: 'kultura' }, status: 'displayed' });
    const stop = await s.stub.present(a.scan.roomId, { version: 1, requestId: 'stop', expectedRevision: 1, action: 'stop' });
    expect(stop.state).toMatchObject({ revision: 2, owner: null, target: null });
    const ended = await s.kiosk.inbox.nextWhere(f => {
      if (f.t === 'error') throw new Error(`the screen was answered ${String(f.error)}`);
      return f.t === 'presentation' && (f.presentation as ScreenPresentation).revision === 2;
    });
    expect((ended.presentation as ScreenPresentation).target).toBeNull();
    a.phone.ws.close(1000, 'done'); s.kiosk.ws.close(1000, 'done');
  });

  it('holds presentation through phone disconnect, restores it on screen reload, and expires it', async () => {
    const s = await screen();
    const a = await s.scanner(0);
    await s.stub.present(a.scan.roomId, { version: 1, requestId: 'hold', action: 'present', expectedRevision: 0, target: { layer: 'kvart', district: 'trnje' } });
    a.phone.ws.close(1000, 'phone asleep');
    expect((await s.stub.presentationStatus(a.scan.roomId)).target).toEqual({ layer: 'kvart', district: 'trnje' });
    const next = await connectBeaconDirect(s.beaconId, KIOSK_NET_KEY);
    const challenge = await next.inbox.nextOfType('challenge');
    next.ws.send(JSON.stringify({ t: 'auth', hmac: await kioskAnswer(s.secret, String(challenge.nonce)), presentationVersion: 1 }));
    await next.inbox.nextOfType('codes');
    expect(((await next.inbox.nextOfType('presentation')).presentation as ScreenPresentation).target).toEqual({ layer: 'kvart', district: 'trnje' });
    await runInDurableObject(s.stub, async (instance: BeaconDO) => { vi.spyOn(instance, 'now').mockReturnValue(a.scan.expiresAt + 1); await instance.alarm(); });
    expect(await s.stub.presentationStatus(a.scan.roomId)).toMatchObject({ target: null, owner: null, status: 'idle' });
    next.ws.close(1000, 'done');
  });

  it('a peer or arbitrary room cannot claim the screen', async () => {
    const s = await screen();
    const a = await s.scanner(0);
    const command = { version: 1 as const, requestId: 'invalid', action: 'present' as const, expectedRevision: 0, target: { layer: 'grad-sada' as const } };
    expect((await s.stub.present('unbound-room', command)).error).toBe('not-allowed');
    a.phone.ws.send(JSON.stringify({ t: 'share' }));
    const codes = (await a.phone.inbox.nextOfType('codes')).batch as CodeSlot[];
    const peerGrant = await roomStub(testEnv, a.scan.roomId).redeemPeer(codes[0]!.code);
    if (!peerGrant.ok) throw new Error(peerGrant.error);
    const peer = await connectRoom(peerGrant.scan.roomId);
    peer.ws.send(JSON.stringify({ t: 'join', ticket: peerGrant.scan.ticket }));
    expect((await peer.inbox.nextOfType('joined')).presentation).toBeUndefined();
    peer.ws.send(JSON.stringify({ t: 'present', command }));
    expect((await peer.inbox.nextOfType('error')).error).toBe('presentation-not-allowed');
    peer.ws.close(1000, 'done'); a.phone.ws.close(1000, 'done'); s.kiosk.ws.close(1000, 'done');
  });
});
