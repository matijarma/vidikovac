// Seam S6 (docs/companion-2026-09-22.md §15.2 and §12): the header sentence
// on the client, shared by the wall and the phone (WP4's ctx.sentence). Owned
// by WP1, which fills the three functions: the facts from the same candidates
// as the timeline plus weather, closures and bikes; one template sentence per
// fact (the deterministic fallback when the model is absent, as under
// wrangler dev); and the sequence that holds a sentence for the rhythm, skips
// expired and overflowing ones and never repeats a text within ten minutes.
// Pure: no DOM, no fetch, no clock of its own. The wire types are S4's.
import type { ScreenPlace } from '../../../shared/city/place';
import type { CityState } from '../../../shared/city/types';
import type { SentenceFact, WrittenSentence } from '../../../shared/kiosk/sentence';
import type { FeedSnapshots } from '../core/contracts';
import type { I18n } from '../i18n/i18n';
import type { NearbyRow } from './nearby';

/** What the facts are read from: the timeline's own rows first, then the feeds. */
export interface SentenceFactsInput {
  place: ScreenPlace;
  rows: readonly NearbyRow[];
  snapshots: FeedSnapshots;
  city: CityState;
  now: number;
  /** The vehicle feed is down: one outage fact that says what still holds (departures by the timetable). */
  outage: boolean;
  locale: string;
  i18n: I18n;
}

/** The facts a sentence may say, each written as a short sentence of its own. Stub until WP1 step 4: none. */
export function sentenceFacts(input: SentenceFactsInput): SentenceFact[] {
  void input;
  return [];
}

/** One template sentence per fact that fits, never cut. Stub until WP1 step 4: none. */
export function templateSentences(facts: readonly SentenceFact[], i18n: I18n): WrittenSentence[] {
  void facts;
  void i18n;
  return [];
}

/** No text is shown twice within this window (§12). */
export const SENTENCE_NO_REPEAT_MS = 600_000;

export interface SentenceSequenceOptions {
  /** How long a sentence holds: the screen's Ritam, 20, 30 or 60 s (app/src/kiosk/prefs.ts). */
  rhythmMs: number;
  /** SENTENCE_NO_REPEAT_MS unless a test shortens it. */
  noRepeatMs?: number;
}

export interface SentenceSequence {
  /**
   * The sentence to show at `now`: the current one while it holds (or while `suspended`),
   * else the next valid one that has not been shown within noRepeatMs and does not overflow.
   * Null only when no sentence at all is available.
   */
  read(sentences: readonly WrittenSentence[], now: number, suspended?: boolean, overflowed?: (s: WrittenSentence) => boolean): WrittenSentence | null;
}

/** A sentence sequence with its own memory of what it showed. Stub until WP1 step 4: shows nothing. */
export function createSentenceSequence(options: SentenceSequenceOptions): SentenceSequence {
  void options;
  return { read: () => null };
}
