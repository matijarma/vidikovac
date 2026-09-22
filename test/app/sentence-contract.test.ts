// Seam S6: app/src/city/sentence.ts (signatures; WP1 fills the facts, the
// templates and the sequence) and fetchSentences in app/src/api.ts, which is
// real: it posts to /api/kiosk/sentences and answers [] on any failure.
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { emptyCity } from '../../shared/city/types';
import type { SentenceRequest, WrittenSentence } from '../../shared/kiosk/sentence';
import { fetchSentences } from '../../app/src/api';
import {
  SENTENCE_NO_REPEAT_MS,
  createSentenceSequence,
  sentenceFacts,
  templateSentences,
  type SentenceFactsInput,
  type SentenceSequence,
  type SentenceSequenceOptions,
} from '../../app/src/city/sentence';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';

const i18n = createDefaultI18n('hr');
const NOW = Date.parse('2026-09-22T15:45:00Z');
const REQUEST: SentenceRequest = {
  locale: 'hr',
  budget: 80,
  facts: [{ id: 'closure:1', kind: 'radovi', text: 'Ilica zatvorena do 18:00.', validUntil: NOW + 3_600_000 }],
};
const WRITTEN: WrittenSentence = { kicker: 'radovi', text: 'Ilica je zatvorena do 18:00.', refs: ['closure:1'], validUntil: NOW + 3_600_000, origin: 'model' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('sentence client seam', () => {
  it('exposes the facts, templates and sequence signatures', () => {
    const input: SentenceFactsInput = {
      place: { kind: 'tram', name: 'Trg bana J. Jelačića', lon: 15.97726, lat: 45.81286, stopId: '106_1' },
      rows: [], snapshots: {}, city: emptyCity(), now: NOW, outage: false, locale: 'hr', i18n,
    };
    expect(Array.isArray(sentenceFacts(input))).toBe(true);
    expect(Array.isArray(templateSentences(REQUEST.facts, i18n))).toBe(true);
    const options: SentenceSequenceOptions = { rhythmMs: 20_000, noRepeatMs: SENTENCE_NO_REPEAT_MS };
    const sequence: SentenceSequence = createSentenceSequence(options);
    expect(typeof sequence.read).toBe('function');
    expectTypeOf(sequence.read).returns.toEqualTypeOf<WrittenSentence | null>();
    expect(SENTENCE_NO_REPEAT_MS).toBe(600_000);
  });
});

describe('fetchSentences', () => {
  it('posts the request to /api/kiosk/sentences and returns the sentences', async () => {
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('/api/kiosk/sentences');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual(REQUEST);
      return json({ generatedAt: new Date(NOW).toISOString(), sentences: [WRITTEN] });
    });
    expect(await fetchSentences(REQUEST, f as unknown as typeof fetch)).toEqual([WRITTEN]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('answers [] when the route is missing, refuses, sends no JSON or the network is down', async () => {
    const answers: Array<() => Promise<Response>> = [
      async () => json({ error: 'not-found' }, 404),
      async () => json({ error: 'rate-limited' }, 429),
      async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      async () => json({ generatedAt: 'x' }),
      async () => { throw new TypeError('Failed to fetch'); },
    ];
    for (const answer of answers) expect(await fetchSentences(REQUEST, answer as unknown as typeof fetch)).toEqual([]);
  });
});
