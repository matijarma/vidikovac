import { describe, expect, it, vi } from 'vitest';
import { recordFrame, recordingKey } from '../../worker/twin/record';

// Raw frames go to R2 under a key that sorts by time and names the header
// timestamp; recording is never the reason a tick fails.
describe('recordFrame', () => {
  it('stores under the UTC time key, skips without a bucket, reports a failed put instead of throwing', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(recordingKey(1_789_514_335)).toBe('zet-rt/2026/09/15/231855-1789514335.pb'); // 2026-09-15T23:18:55Z
    const put = vi.fn(async () => ({}) as R2Object);
    await expect(recordFrame({ put } as unknown as R2Bucket, 1_789_514_335, bytes)).resolves.toBe('stored');
    expect(put).toHaveBeenCalledWith('zet-rt/2026/09/15/231855-1789514335.pb', bytes, expect.objectContaining({ httpMetadata: { contentType: 'application/x-protobuf' } }));
    await expect(recordFrame(undefined, 1_789_514_335, bytes)).resolves.toBe('skipped');
    const failing = { put: vi.fn(async () => { throw new Error('r2 down'); }) } as unknown as R2Bucket;
    await expect(recordFrame(failing, 1_789_514_335, bytes)).resolves.toBe('failed');
  });
});
