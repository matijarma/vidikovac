// The replayed voice's store (app/src/snimka/voice-data.ts): one per
// context, the index on first use, a day when a minute of it is asked for,
// the next day prefetched then; 'loading' while a file is on its way, null
// where the voice has no minute; the lead fact and its family.
import { describe, expect, it } from 'vitest';
import type { HashedRef, VoiceFile, VoiceIndex } from '../../shared/snimka';
import type { SnimkaContext } from '../../app/src/snimka/context';
import { factFamily, leadFact, loadVoiceDay, voiceData, voiceMinuteAt, voiceRows, voiceSentence } from '../../app/src/snimka/voice-data';
import { buildVoiceDay, zg } from '../../e2e/snimka-fixtures';

const ref = (path: string): HashedRef => ({ path, bytes: 1, sha256: '0'.repeat(64) });
const mon = buildVoiceDay('mon');
const thu = buildVoiceDay('thu');
/** Three days: Monday, an empty Tuesday (its file missing from the store) and Thursday. */
const tue = { ...mon, day: '2026-09-29', t0: zg(9, 29, 0, 0), minutes: mon.minutes.map(() => null) } satisfies VoiceFile;
const INDEX: VoiceIndex = { v: 2, place: '106_1', days: [thu, mon, tue].map((d) => ({ day: d.day, t0: d.t0, n: d.n, file: ref(`voice/${d.day}.json`) })) };

function ctx(files: VoiceFile[] = [mon, thu, tue], index: VoiceIndex | null = INDEX) {
  const objects = new Map<string, unknown>(files.map((f) => [`voice/${f.day}.json`, f]));
  if (index) objects.set('voice/index.json', index);
  const requested: string[] = [];
  const c = {
    manifest: { files: { voiceIndex: ref('voice/index.json') } },
    data: {
      url: (r: HashedRef | string) => String(r),
      get: async <T,>(r: HashedRef | string, decode?: (raw: unknown) => T): Promise<T> => {
        const path = typeof r === 'string' ? r : r.path;
        requested.push(path);
        if (!objects.has(path)) throw new Error(`404 ${path}`);
        return decode ? decode(objects.get(path)) : (objects.get(path) as T);
      },
    },
  } as unknown as SnimkaContext;
  return { ctx: c, requested };
}
const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

describe('the voice store', () => {
  it('answers loading, then the minute; prefetches the next day once the minute\'s day is in', async () => {
    const { ctx: c, requested } = ctx();
    const at = zg(9, 28, 7, 45);
    expect(voiceMinuteAt(c, at)).toBe('loading');
    await settle();
    expect(voiceMinuteAt(c, at)).toBe('loading');
    await settle();
    const got = voiceMinuteAt(c, at);
    expect(got).not.toBe('loading');
    expect(got && got !== 'loading' ? voiceSentence(got.file, got.minute) : null).toBe('U pokretu su 2 vozila, po voznom redu oko 230.');
    await settle();
    // The next day by time (Tuesday), not the next in the index's file order.
    expect(requested).toEqual(['voice/index.json', 'voice/2026-09-28.json', 'voice/2026-09-29.json']);
    // One store per context: the same object and no second fetch.
    expect(voiceData(c)).toBe(voiceData(c));
    voiceMinuteAt(c, at + 60);
    expect(requested.length).toBe(3);
  });
  it('null for a minute the day leaves empty, an instant outside every day, and a day whose file failed', async () => {
    const { ctx: c } = ctx([mon, thu]);
    voiceMinuteAt(c, zg(9, 28, 7, 45));
    await settle();
    voiceMinuteAt(c, zg(9, 28, 7, 45));
    await settle();
    expect(voiceMinuteAt(c, zg(9, 28, 3, 0))).toBeNull();
    expect(voiceMinuteAt(c, zg(9, 27, 21, 0))).toBeNull();
    voiceMinuteAt(c, zg(9, 29, 7, 45));
    await settle();
    expect(voiceMinuteAt(c, zg(9, 29, 7, 45))).toBeNull();
    expect(voiceData(c).file('2026-09-29')).toBeNull();
    expect(voiceData(c).loaded().map((f) => f.day)).toEqual(['2026-09-28']);
  });
  it('no index: every minute is null after the load fails, and loadVoiceDay resolves null', async () => {
    const { ctx: c } = ctx([mon], null);
    expect(voiceMinuteAt(c, zg(9, 28, 7, 45))).toBe('loading');
    await settle();
    expect(voiceMinuteAt(c, zg(9, 28, 7, 45))).toBeNull();
    expect(await loadVoiceDay(c, '2026-09-28')).toBeNull();
  });
  it('tells its listeners when a file arrives', async () => {
    const { ctx: c } = ctx();
    let calls = 0;
    const off = voiceData(c).onLoad(() => { calls += 1; });
    await loadVoiceDay(c, '2026-10-01');
    expect(calls).toBe(2); // the index, then the day
    off();
    await loadVoiceDay(c, '2026-09-28');
    expect(calls).toBe(2);
  });
});

describe('a minute\'s sentence, rows and lead fact', () => {
  const m745 = mon.minutes[7 * 60 + 45]!;
  const m747 = mon.minutes[7 * 60 + 47]!;
  it('the lead sentence and the rows by index', () => {
    expect(voiceSentence(mon, m745)).toBe(mon.sentences[0]);
    expect(voiceSentence(mon, { ...m745, lead: null })).toBeNull();
    expect(voiceRows(mon, m745).map((r) => r.id)).toEqual(['dep-6', 'weather']);
    expect(voiceRows(mon, { ...m745, r: [1, 7] }).map((r) => r.id)).toEqual(['weather']);
  });
  it('the lead fact is the one the sentence speaks, else the first; a departure\'s family carries its wording', () => {
    expect(leadFact(mon, m745)?.id).toBe('service:zet');
    expect(leadFact(mon, m747)?.id).toBe('bikes:total');
    expect(leadFact(thu, thu.minutes[7 * 60 + 45]!)?.id).toBe('dep:6:0752');
    expect(leadFact(mon, { ...m745, f: [] })).toBeNull();
    expect(factFamily({ kind: 'departure', wording: 'live' })).toBe('departure-live');
    expect(factFamily({ kind: 'departure', wording: 'timetable' })).toBe('departure-timetable');
    expect(factFamily({ kind: 'service', wording: 'silent' })).toBe('service');
  });
});
