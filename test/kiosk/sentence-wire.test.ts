// Seam S4: shared/kiosk/sentence.ts, the header sentence's wire contract and
// the complete-claim acceptance contract implemented by WP1.
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  SENTENCE_KICKERS,
  SENTENCE_MAX_CHARS,
  acceptSentence,
  type SentenceContext,
  type SentenceFact,
  type SentenceKicker,
  type SentenceRejection,
  type SentenceRequest,
  type SentenceResponse,
  type SentenceVerdict,
  type WrittenSentence,
} from '../../shared/kiosk/sentence';

const FACT: SentenceFact = { id: 'closure:1', kind: 'radovi', text: 'Ilica: zatvoreno za promet do 18:00.', validUntil: Date.parse('2026-09-22T16:00:00Z') };
const CTX: SentenceContext = { facts: [FACT] };

describe('sentence wire types', () => {
  it('names the six kickers', () => {
    expect(SENTENCE_KICKERS).toEqual(['promet', 'kultura', 'vrijeme', 'bicikli', 'nocas', 'radovi']);
    expectTypeOf<SentenceKicker>().toEqualTypeOf<'promet' | 'kultura' | 'vrijeme' | 'bicikli' | 'nocas' | 'radovi'>();
    expect(SENTENCE_MAX_CHARS).toBe(80);
  });

  it('round-trips a request and a response as JSON', () => {
    const written: WrittenSentence = { kicker: 'radovi', text: FACT.text, refs: [FACT.id], validUntil: FACT.validUntil, origin: 'template' };
    const request: SentenceRequest = { locale: 'hr', budget: 80, facts: [FACT] };
    const response: SentenceResponse = { generatedAt: '2026-09-22T15:00:00.000Z', sentences: [written] };
    expect(JSON.parse(JSON.stringify(request))).toEqual(request);
    expect(JSON.parse(JSON.stringify(response))).toEqual(response);
  });
});

describe('acceptSentence', () => {
  it('requires a grounded claim even within the 1 to 80 character budget', () => {
    expect(acceptSentence('Ilica: zatvoreno za promet do 18:00.', CTX)).toEqual<SentenceVerdict>({ ok: true });
    expect(acceptSentence('x', CTX)).toEqual({ ok: false, reason: 'unknown-family' });
    expect(acceptSentence('š'.repeat(80), CTX)).toEqual({ ok: false, reason: 'unknown-family' });
  });

  it('refuses an empty, an over-long or a cut sentence', () => {
    const reasons: SentenceRejection[] = [];
    for (const candidate of ['', '   ', 'x'.repeat(81), 'Tramvaj 6 prema Črnomercu…', 'Tramvaj 6 prema Črnomercu...']) {
      const verdict = acceptSentence(candidate, CTX);
      if (!verdict.ok) reasons.push(verdict.reason);
    }
    expect(reasons).toEqual(['empty', 'empty', 'too-long', 'ellipsis', 'ellipsis']);
  });

  it('honours a smaller budget, never a larger one', () => {
    expect(acceptSentence('x'.repeat(65), { ...CTX, budget: 64 })).toEqual({ ok: false, reason: 'too-long' });
    expect(acceptSentence('x'.repeat(81), { ...CTX, budget: 120 })).toEqual({ ok: false, reason: 'too-long' });
  });
});
