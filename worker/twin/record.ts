// Every new frame's raw bytes go to R2, so the engine can be replayed over a
// real day (scripts/replay-twin.mjs, task B8) and graded by hindsight rather
// than by impression. The key sorts by time and names the header timestamp;
// the bucket's own 7-day expiry rule (set out-of-band, see the plan's
// Workspace section) is the whole retention policy. Recording is never the
// reason a tick fails: no bucket means skipped, a failed put means a logged
// metric, and the tick goes on.

import { logError } from '../log';

export const RECORDING_PREFIX = 'zet-rt';

export type RecordOutcome = 'stored' | 'skipped' | 'failed';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `zet-rt/YYYY/MM/DD/HHMMSS-<headerTs>.pb`, UTC. */
export function recordingKey(headerTs: number): string {
  const d = new Date(headerTs * 1000);
  const day = `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`;
  const clock = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `${RECORDING_PREFIX}/${day}/${clock}-${headerTs}.pb`;
}

export async function recordFrame(bucket: R2Bucket | undefined, headerTs: number, bytes: Uint8Array): Promise<RecordOutcome> {
  if (!bucket) return 'skipped';
  try {
    await bucket.put(recordingKey(headerTs), bytes, { httpMetadata: { contentType: 'application/x-protobuf' } });
    return 'stored';
  } catch (error) {
    logError('twin_record_failed', error, { headerTs });
    return 'failed';
  }
}
