// Seam S4 (docs/companion-2026-09-22.md §15.2): the header sentence's wire
// contract, shared by the Worker route (POST /api/kiosk/sentences), the wall
// and the phone. Owned by WP1, which fills acceptSentence with the full rules
// (no invented numbers, a token shared with the referenced facts, no markup,
// the time-aware validity); today it enforces the length and the ellipsis
// ban only. Pure, no imports.

/** The six kickers, in the owner's words: Promet · Kultura · Vrijeme · Bicikli · Noćas · Radovi. */
export const SENTENCE_KICKERS = ['promet', 'kultura', 'vrijeme', 'bicikli', 'nocas', 'radovi'] as const;
export type SentenceKicker = (typeof SENTENCE_KICKERS)[number];

/** A sentence never runs longer than this on the widest wall; narrower compositions ask for less. */
export const SENTENCE_MAX_CHARS = 80;

/** One fact the sentence may say, already written as a short sentence of its own. */
export interface SentenceFact {
  id: string;
  kind: SentenceKicker;
  text: string;
  /** Epoch ms after which the fact no longer holds (a departure, a sunset); null when it holds all day. */
  validUntil: number | null;
}

/** A sentence ready for the header: its kicker, its text, the facts it rests on. */
export interface WrittenSentence {
  kicker: SentenceKicker;
  text: string;
  /** Ids of the SentenceFacts the text says. */
  refs: string[];
  /** The earliest validUntil of its refs; null when none expires. */
  validUntil: number | null;
  origin: 'model' | 'template';
}

/** POST /api/kiosk/sentences, body. */
export interface SentenceRequest {
  locale: 'hr' | 'en';
  /** Characters the composition fits, 40..SENTENCE_MAX_CHARS. */
  budget: number;
  facts: SentenceFact[];
}

/** POST /api/kiosk/sentences, answer. */
export interface SentenceResponse {
  /** ISO 8601. */
  generatedAt: string;
  sentences: WrittenSentence[];
}

/** Why a candidate was refused. The stub returns the first three; WP1 adds the rest. */
export type SentenceRejection =
  | 'empty'
  | 'too-long'
  | 'ellipsis'
  | 'newline'
  | 'markup'
  | 'invented-number'
  | 'unrelated'
  | 'expired';

export type SentenceVerdict = { ok: true } | { ok: false; reason: SentenceRejection };

/** What a candidate is checked against. */
export interface SentenceContext {
  facts: readonly SentenceFact[];
  /** Characters allowed; SENTENCE_MAX_CHARS when absent. */
  budget?: number;
  now?: number;
}

/**
 * Whether a candidate may go on the wall. Today: 1..80 characters (or the budget, when
 * smaller) after trimming, and never an ellipsis ('…' or '...'); a sentence that does not fit
 * is dropped, never cut. WP1 extends it with the model rules; worker and app share it.
 */
export function acceptSentence(candidate: string, ctx: SentenceContext): SentenceVerdict {
  const text = candidate.trim();
  if (text.length === 0) return { ok: false, reason: 'empty' };
  if (text.includes('…') || text.includes('...')) return { ok: false, reason: 'ellipsis' };
  const budget = Math.min(SENTENCE_MAX_CHARS, ctx.budget ?? SENTENCE_MAX_CHARS);
  if ([...text].length > budget) return { ok: false, reason: 'too-long' };
  return { ok: true };
}
