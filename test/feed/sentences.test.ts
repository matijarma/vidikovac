import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SentenceRequest } from '../../shared/kiosk/sentence';
import type { Env } from '../../worker/env';
import {
  SENTENCE_MODEL, SENTENCE_NEGATIVE_TTL_SECONDS, SENTENCE_SYSTEM_PROMPT_HR,
  SENTENCE_TIMEOUT_MS, SENTENCE_TTL_SECONDS, sentenceKey, writeSentences,
} from '../../worker/feed/sentences';
import { BRIEF_MODEL_AKT } from '../../worker/feed/brief';

const NOW = Date.parse('2026-09-22T12:30:00+02:00');
const request: SentenceRequest = {
  locale: 'hr', budget: 80, facts: [
    { id: 'closure:ilica', kind: 'radovi', text: 'Ilica je zatvorena do 18:00.', validUntil: NOW + 3_600_000 },
    { id: 'solar:sunset:today', kind: 'vrijeme', text: 'Sunce zalazi u 19:05.', validUntil: NOW + 2 * 3_600_000 },
  ],
};
class Kv {
  readonly data = new Map<string, unknown>();
  readonly puts: { key: string; value: unknown; ttl: number }[] = [];
  readFailure = false;
  writeFailure = false;
  gate: Promise<void> | null = null;
  async get(key: string) {
    if (this.readFailure) throw new Error('read-failure');
    return this.data.get(key) ?? null;
  }
  async put(key: string, raw: string, options: { expirationTtl: number }) {
    if (this.gate) await this.gate;
    if (this.writeFailure) throw new Error('write-failure');
    const value: unknown = JSON.parse(raw);
    this.data.set(key, value);
    this.puts.push({ key, value, ttl: options.expirationTtl });
  }
}
let kv: Kv;
const env = (run?: (...args: unknown[]) => Promise<unknown>, appEnv?: string): Env =>
  ({ FEED: kv, ...(run ? { AI: { run } } : {}), ...(appEnv ? { APP_ENV: appEnv } : {}) }) as unknown as Env;
const answer = 'closure:ilica|Ilica je zatvorena do 18:00.';
beforeEach(() => { kv = new Kv(); vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe('Workers AI sentences, without a real AI binding', () => {
  it('uses the pinned 70b model once and reads the twenty-minute KV entry next time', async () => {
    const run = vi.fn(async () => ({ response: answer }));
    const first = await writeSentences(env(run), request);
    expect(first).toEqual([{ kicker: 'radovi', text: request.facts[0]!.text, refs: ['closure:ilica'], validUntil: request.facts[0]!.validUntil, origin: 'model' }]);
    expect(await writeSentences(env(run), request)).toEqual(first);
    expect(run).toHaveBeenCalledTimes(1);
    expect(SENTENCE_MODEL).toBe(BRIEF_MODEL_AKT);
    expect(run).toHaveBeenCalledWith(SENTENCE_MODEL, expect.objectContaining({ max_tokens: 400, temperature: 0.3 }));
    expect(kv.puts[0]!.ttl).toBe(SENTENCE_TTL_SECONDS);
    const [, prompt] = run.mock.calls[0]! as unknown as [string, { messages: { role: string; content: string }[] }];
    expect(prompt.messages[0]!.content).toBe(SENTENCE_SYSTEM_PROMPT_HR.replace('{budget}', '80'));
  });

  it('hashes model/prompt, locale, budget, text, kind, ids and expiry', async () => {
    const key = await sentenceKey(request);
    expect(key).toMatch(/^sentence:v1:[a-f0-9]{64}$/);
    expect(await sentenceKey(JSON.parse(JSON.stringify(request)) as SentenceRequest)).toBe(key);
    for (const other of [
      { ...request, locale: 'en' as const }, { ...request, budget: 64 },
      { ...request, facts: request.facts.map(f => ({ ...f, text: f.text + ' ' })) },
      { ...request, facts: request.facts.map(f => ({ ...f, validUntil: f.validUntil! + 1 })) },
      { ...request, facts: request.facts.map(f => ({ ...f, kind: 'kultura' as const })) },
    ]) expect(await sentenceKey(other)).not.toBe(key);
  });

  it('is a no-op under APP_ENV=test, even when a cached sentence and an AI binding exist', async () => {
    const run = vi.fn(async () => ({ response: answer }));
    await writeSentences(env(run), request);
    run.mockClear();
    expect(await writeSentences(env(run, 'test'), request)).toEqual([]);
    expect(run).not.toHaveBeenCalled();
    expect(kv.puts).toHaveLength(1);
  });

  it('provides accepted templates with no binding, without accessing KV', async () => {
    kv.readFailure = true;
    const result = await writeSentences(env(), request);
    expect(result.map(s => s.text)).toEqual(request.facts.map(f => f.text));
    expect(result.every(s => s.origin === 'template')).toBe(true);
    expect(kv.puts).toHaveLength(0);
  });

  it('refuses ellipses, invented numbers, unrelated refs, long answers and fabricated predicates', async () => {
    const bad = [
      'closure:ilica|Ilica...',
      'closure:ilica|Ilica…',
      'closure:ilica|Ilica je zatvorena do 19:00.',
      'solar:sunset:today|Ilica je zatvorena do 18:00.',
      'unknown|Ilica je zatvorena do 18:00.',
      'closure:ilica|Ilica je poplavljena do 18:00.',
      `closure:ilica|Ilica ${'zatvorena '.repeat(10)}do 18:00.`,
    ].join('\n');
    const run = vi.fn(async () => ({ response: bad }));
    const result = await writeSentences(env(run), request);
    expect(result.every(s => s.origin === 'template')).toBe(true);
    expect(kv.puts[0]!.ttl).toBe(SENTENCE_NEGATIVE_TTL_SECONDS);
    expect(kv.puts[0]!.value).toEqual({ sentences: [] });
    expect(await writeSentences(env(run), request)).toEqual(result);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('derives the kicker from the first cited fact, minimum expiry, and deduplicates text', async () => {
    const run = vi.fn(async () => ({ response: [
      'closure:ilica,solar:sunset:today|Ilica je zatvorena do 18:00; sunce zalazi u 19:05.',
      answer, answer,
    ].join('\n') }));
    const result = await writeSentences(env(run), request);
    expect(result).toHaveLength(2);
    expect(result[0]!.kicker).toBe('radovi');
    expect(result[0]!.refs).toEqual(request.facts.map(f => f.id));
    expect(result[0]!.validUntil).toBe(request.facts[0]!.validUntil);
  });

  it('never sends departures or countdowns to AI, even for an unfiltered caller', async () => {
    const run = vi.fn(async () => ({ response: answer }));
    const facts = [...request.facts,
      { id: 'dep:6', kind: 'promet' as const, text: 'Tramvaj 6 polazi u 12:33.', validUntil: NOW + 180_000 },
      { id: 'unrecognised-id', kind: 'promet' as const, text: 'Tramvaj 6 polazi za 3 min.', validUntil: NOW + 30_000 }];
    await writeSentences(env(run), { ...request, facts });
    expect(JSON.stringify(run.mock.calls)).not.toContain('Tramvaj');
  });

  it('times out in six seconds, remembers the failure and returns templates', async () => {
    const run = vi.fn(() => new Promise<never>(() => {}));
    const pending = writeSentences(env(run), request);
    // Hashing is real async work; wait for the model to start before advancing.
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(SENTENCE_TIMEOUT_MS);
    expect((await pending).every(s => s.origin === 'template')).toBe(true);
    expect(kv.puts[0]!.ttl).toBe(SENTENCE_NEGATIVE_TTL_SECONDS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not publish a fact that expired while AI was running', async () => {
    const run = vi.fn(async () => { vi.setSystemTime(NOW + 2000); return { response: answer }; });
    const result = await writeSentences(env(run), { ...request, facts: [{ ...request.facts[0]!, validUntil: NOW + 1000 }] });
    expect(result).toEqual([]);
  });

  it('does not resurrect an expired cached event or trust cached metadata', async () => {
    const key = await sentenceKey(request);
    kv.data.set(key, { sentences: [{ text: request.facts[0]!.text, refs: ['closure:ilica'],
      kicker: 'radovi', validUntil: null, origin: 'model' }] });
    const run = vi.fn(async () => ({ response: answer }));
    expect((await writeSentences(env(run), request))[0]!.validUntil).toBe(request.facts[0]!.validUntil);
    expect(run).not.toHaveBeenCalled();
    vi.setSystemTime(NOW + 3 * 3_600_000);
    expect(await writeSentences(env(run), request)).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });

  it('treats malformed KV as a miss and survives read, write and AI failures', async () => {
    kv.data.set(await sentenceKey(request), { sentences: [null, {}] });
    const run = vi.fn(async () => ({ response: answer }));
    expect((await writeSentences(env(run), request))[0]!.origin).toBe('model');
    kv.readFailure = true; kv.writeFailure = true;
    const fail = vi.fn(async () => { throw new Error('AI down'); });
    expect((await writeSentences(env(fail), request)).every(s => s.origin === 'template')).toBe(true);
  });

  it('hands a slow KV write to waitUntil without delaying accepted text', async () => {
    let release!: () => void;
    kv.gate = new Promise(resolve => { release = resolve; });
    const deferred: Promise<unknown>[] = [];
    const result = await writeSentences(env(async () => ({ response: answer })), request, promise => deferred.push(promise));
    expect(result[0]!.origin).toBe('model');
    expect(kv.puts).toHaveLength(0);
    expect(deferred).toHaveLength(1);
    release();
    await Promise.all(deferred);
    expect(kv.puts).toHaveLength(1);
  });
});
