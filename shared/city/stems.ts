// Frozen seam of the U3 package (docs/upgrade-2026-10-plan/U3.md §0.2): created identically by two briefs.
import { normalName } from './geo';

/** Croatian case endings, longest first. */
const ENDINGS = ['ama', 'ima', 'oga', 'om', 'oj', 'em', 'ih', 'im', 'a', 'e', 'i', 'o', 'u'] as const;
const MIN_STEM = 4;

/** A word without its case endings: "vinskoj" and "vinska" are both "vinsk", "caffeu" and "caffe" both "caff". */
export function stemWord(word: string): string {
  let stem = word;
  for (;;) {
    const ending = ENDINGS.find((e) => stem.length - e.length >= MIN_STEM && stem.endsWith(e));
    if (!ending) return stem;
    stem = stem.slice(0, -ending.length);
  }
}

/** The stems of a name's words, in order: "Aleji Seljačke bune" and "Aleja Seljačke bune" are both ["alej", "seljack", "bune"]. */
export function stemWords(text: string): string[] {
  return normalName(text).split(' ').filter(Boolean).map(stemWord);
}

/** Whether `needle` occurs in `hay` as one consecutive run of stems. */
export function containsStems(hay: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((s, j) => hay[i + j] === s)) return true;
  return false;
}
