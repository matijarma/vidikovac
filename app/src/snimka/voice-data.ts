// The replayed voice: the index and the day files, loaded on expansion (plan
// section 5, decision S-15). Lane V4 owns this file; V0 ships a loader that
// answers null.
import type { VoiceFile } from '../../../shared/snimka';
import type { SnimkaContext } from './context';

export async function loadVoiceDay(_ctx: SnimkaContext, _day: string): Promise<VoiceFile | null> {
  return null;
}
