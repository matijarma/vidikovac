// The column's statements: what the public screen says in words beside the
// picture (plan "The column: statements", rulings R-KP5, R-KP12, R-KP14).
// This file is a TYPED STUB on the integration branch (R-KP15) so the four
// wave A worktrees compile against one contract: area P2 replaces the bodies,
// area P3 mounts the markup. The shapes below are the contract (global
// constraints, contract 4 and 5); the bodies answer "nothing to say yet".
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import type { ScreenStop } from '../core/contracts';
import type { LastRunSnapshot } from '../core/lastrun';
import type { I18n } from '../i18n/i18n';
import type { KioskStrings } from './strings';

export type SayDomain = 'transit' | 'komunalno' | 'civic' | 'events' | 'safety' | 'mobility';
export type SayKind = 'transit' | 'quake' | 'closure' | 'lastrun' | 'zet' | 'assembly' | 'works' | 'kvart';
export type SayTone = 'late' | 'early' | 'ontime' | 'unknown' | 'komunalno' | 'events' | 'urgent' | 'calm';

export interface Statement {
  /** Reconciler identity: `say:<kind>`, one per kind, so a changed value keeps its slot. */
  key: string;
  domain: SayDomain;
  say: SayKind;
  /** The ranker's relevance; the plan's table gives each kind its weight. */
  weight: number;
  /** The kicker, stored in sentence case (CSS uppercases it). */
  label: string;
  /** Trusted markup: the line badges after the kicker (the transit statement). */
  badgesMarkup?: string;
  /** The plain value text, also the crossfade signature; never truncated by CSS. */
  value: string;
  /** Trusted markup standing in for the value (last-departure pairs). */
  valueMarkup?: string;
  context?: string;
  tone?: SayTone;
  state?: 'stale' | 'down';
  /** The whole statement read aloud: label, value, context joined by ", ". */
  aria: string;
}

export interface Slot { key: string; statement: Statement }

export interface SayInput {
  modules: readonly ModuleSnapshot[];
  stop: ScreenStop | null;
  now: number;
  lastRun: LastRunSnapshot | null;
  strings: KioskStrings;
  i18n: I18n;
  locale: string;
  /** How many statements the composition shows: wide 3, compact 2, portrait 3, handheld every candidate. */
  slots: number;
  /** Line badges before "+N": wide 12, compact 6, portrait 8, handheld 6. */
  badgeCap: number;
  /** A title's shortening budget in characters (cut at a word boundary with "…"): wide 56, compact 44, portrait 48, handheld 40. */
  valueChars: number;
}

export interface SayMarkupContext { strings: KioskStrings; locale: string; loading: boolean }

/** Hysteresis: a shown statement keeps its slot unless a newcomer outweighs it by this much. */
export const SAY_HYSTERESIS = 15;

/** The ranked statements for this moment (pure; P2 fills the candidates). The stub says nothing. */
export function rankStatements(_input: SayInput, _previous: readonly Slot[]): Slot[] {
  return [];
}

/** The column's markup for the slots (contract 4); the stub renders nothing, not even a skeleton. */
export function sayMarkup(_slots: readonly Slot[], _ctx: SayMarkupContext): string {
  return '';
}
