// Types for scripts/lib/shown-facts.mjs (the unit tier is type-checked against its real exports).
export const TRANSIT_KINDS: readonly string[];
export const PROMISE_KINDS: readonly string[];
export const TRANSIT_WORDINGS: readonly string[];
export const ROTATION_STEP_MS: number;
export function zagrebHourKey(atMs: number): string;
export interface Reveal { kind: 'advance' | 'page'; id: string | null; beat: number }
export function revealOf(value: unknown): Reveal | null;
export interface ShownHour {
  hour: string;
  readings: number;
  failed: number;
  rows: Record<string, string[]>;
  nonTransit: number;
  city: number;
  facts: string[];
  nonTransitFacts: number;
  reveals: { count: number; byKind: { advance: number; page: number }; distinct: string[]; minGapBeats: number | null; maxDwellMs: number | null };
  departures: { min: number | null; max: number | null };
}
export interface ShownFacts {
  readings: number;
  failed: number;
  from: string | null;
  to: string | null;
  hours: ShownHour[];
  summary: { nonTransit: number; fewest: { hour: string; nonTransit: number } | null };
}
export function shownFacts(readings: readonly unknown[]): ShownFacts;
export function shownFactsMarkdown(result: ShownFacts, title: string): string;
