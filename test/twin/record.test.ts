import { describe, expect, it, vi } from 'vitest';
import { recordFrame, recordingKey } from '../../worker/twin/record';

// Raw feed frames go to R2 under a key that sorts by time and names the
// header timestamp, so a replay can walk a day in order and a human can find
// a minute. The bucket is optional (a worktree, a test without the binding):
// recording is never the reason a tick fails.
describe('recordingKey', () => {
  it('names the UTC day path, the clock time and the header timestamp', () => {
    // 1789514335 = 2026-09-15T23:18:55Z
    expect(recordingKey(1_789_514_335)).toBe('zet-rt/2026/09/15/231855-1789514335.pb');
  });
});

describe('recordFrame', () => {
  const bytes = new Uint8Array([1, 2, 3]);

  it('stores the bytes under the key and says so', async () => {
    const put = vi.fn(async () => ({}) as R2Object);
    const bucket = { put } as unknown as R2Bucket;
    await expect(recordFrame(bucket, 1_789_514_335, bytes)).resolves.toBe('stored');
    expect(put).toHaveBeenCalledWith('zet-rt/2026/09/15/231855-1789514335.pb', bytes, expect.objectContaining({ httpMetadata: { contentType: 'application/x-protobuf' } }));
  });

  it('skips quietly without a bucket', async () => {
    await expect(recordFrame(undefined, 1_789_514_335, bytes)).resolves.toBe('skipped');
  });

  it('reports a failed put instead of throwing', async () => {
    const bucket = { put: vi.fn(async () => { throw new Error('r2 down'); }) } as unknown as R2Bucket;
    await expect(recordFrame(bucket, 1_789_514_335, bytes)).resolves.toBe('failed');
  });
});
