// The companion's voice at Jelačić, minute by minute, with today's rules
// (lane V1, plan section 5 "voice", decision S-15): the wall's own calls in
// the wall's order (app/src/kiosk.ts paintWall), minus what needs a screen.
// selectNearby over the boards, the vehicles and the modules, then
// sentenceFacts over the rows, then the template sentences through
// sentencePool and a sentence sequence at the wall's 20-second rhythm. No
// model text: only templates, so the result is deterministic. The map
// adapter (app/src/kiosk/mapview.ts) drags the map graph, so the fixes are
// read here as its vehiclePoints and the wall's liveFixes read them:
// vehicleFixes with routeName, none while the feed is down or unconfirmed,
// none older than the twin keeps a fix. Rail boards, opening hours and the
// last-run table are not recorded and stay out (the wall without them).

import '../../shared/kiosk/external-text';
import { DEPARTED_HOLD_MS, selectNearby, type NearbyInput, type NearbyRow } from '../../app/src/city/nearby';
import { createSentenceSequence, sentenceFacts, sentencePool, templateSentences, SENTENCE_BUDGET, SENTENCE_NO_REPEAT_MS, type CitySentenceFact, type RotatingSentence } from '../../app/src/city/sentence';
import { createDefaultI18n } from '../../app/src/i18n/create-default-i18n';
import { vehicleFixes } from '../../app/src/motion/fixes';
import { routeName } from '../../app/src/data/routes';
import type { ScreenStop } from '../../app/src/core/contracts';
import { departureVoice, positionsUnavailable, railPolicy, resetServiceStateMemory, serviceStateOf } from '../../shared/city/service-state';
import type { ScreenPlace } from '../../shared/city/place';
import type { CityState, DepartureBoard } from '../../shared/city/types';
import type { WrittenSentence } from '../../shared/kiosk/sentence';
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import type { VoiceState } from '../../shared/snimka';

/** The wall's "U blizini" radius at Jelačić (the strike seed and test/app/service-voice.test.ts). */
export const WALL_NEARBY_RADIUS_M = 2200;
/** The wall's header rhythm and the steps of one minute. */
export const VOICE_RHYTHM_MS = 20_000;
export const VOICE_STEPS = 3;
/** A fix older than this times no row (app/src/city/feed.ts LIVE_FIX_MAX_AGE_MS, the twin's eviction). */
const LIVE_FIX_MAX_AGE_MS = 180_000;

export interface VoiceInputs { place: ScreenPlace; stops: readonly ScreenStop[]; city: CityState }
export interface VoiceStep { rows: NearbyRow[]; facts: CitySentenceFact[]; lead: RotatingSentence | null; state: VoiceState; voice: 'all' | 'live-only' | 'none' }

export function byModule(modules: readonly ModuleSnapshot[]): Partial<Record<ModuleId, ModuleSnapshot>> {
  const out: Partial<Record<ModuleId, ModuleSnapshot>> = {};
  for (const snapshot of modules) out[snapshot.module] = snapshot;
  return out;
}

/** The fixes the wall's list may time a row by (app/src/city/feed.ts liveFixes), titled as the map titles them. */
export function wallFixes(zet: ModuleSnapshot | undefined, now: number): ReturnType<typeof vehicleFixes> {
  if (!zet || positionsUnavailable(zet, now)) return [];
  const at = Date.parse(zet.sourceUpdatedAt ?? zet.fetchedAt);
  if (Number.isFinite(at) && now - at > LIVE_FIX_MAX_AGE_MS) return [];
  return vehicleFixes(zet, now).filter((fix) => now - fix.at <= LIVE_FIX_MAX_AGE_MS).map((fix) => ({ ...fix, title: routeName(fix.routeId ?? '') }));
}

/**
 * One wall, stepped forward minute by minute. The memory the wall keeps
 * between paints (the rows held on screen, the departed rows, the sentence on
 * screen, the ten-minute memory of shown wordings, the service-state hold) is
 * kept here in the same way, so the voice of a minute depends on the minutes
 * before it exactly as the wall's would.
 */
export function createVoiceEngine(inputs: VoiceInputs) {
  const i18n = createDefaultI18n('hr');
  resetServiceStateMemory();
  const sequence = createSentenceSequence({ rhythmMs: VOICE_RHYTHM_MS, noRepeatMs: SENTENCE_NO_REPEAT_MS });
  const budget = SENTENCE_BUDGET.wide;
  let wallItems: NearbyRow[] = [];
  const departedAt = new Map<string, number>();
  const shown = new Map<string, number>();
  let current: WrittenSentence | null = null;

  /** The wall at `at` (epoch ms) over these modules and boards; the sentence read VOICE_STEPS times, a rhythm apart, ending at `at`. */
  function step(modules: readonly ModuleSnapshot[], boards: readonly DepartureBoard[], at: number): VoiceStep {
    const snapshots = byModule(modules);
    const zet = snapshots['zet-rt'];
    const state = serviceStateOf(zet, at);
    const outage = positionsUnavailable(zet, at);
    const heldDepartures = wallItems.filter((row) => row.kind === 'departure');
    const departedDepartures = [...departedAt].map(([id, leftAt]) => ({ id, leftAt }));
    const policy = railPolicy(state.kind);
    const input: NearbyInput = {
      place: inputs.place, radiusM: WALL_NEARBY_RADIUS_M, now: at, boards: [...boards], fixes: outage ? [] : wallFixes(zet, at),
      snapshots, city: inputs.city, lastRun: null, locale: 'hr', i18n, stops: [...inputs.stops], heldDepartures, departedDepartures,
      ...(policy ? { policy } : {}),
    };
    wallItems = selectNearby(input);
    for (const row of heldDepartures) if (!wallItems.some((item) => item.id === row.id)) departedAt.set(row.id, at);
    for (const [id, leftAt] of departedAt) if (at - leftAt > DEPARTED_HOLD_MS) departedAt.delete(id);
    const facts = sentenceFacts({ place: inputs.place, radiusM: WALL_NEARBY_RADIUS_M, rows: wallItems, snapshots, city: inputs.city, now: at, outage, locale: 'hr', i18n,
      ...(current ? { pinned: current.refs } : {}) }) as CitySentenceFact[];
    for (let k = VOICE_STEPS - 1; k >= 0; k--) {
      const t = at - k * VOICE_RHYTHM_MS;
      for (const [text, shownAt] of shown) if (t - shownAt > SENTENCE_NO_REPEAT_MS && text !== current?.text) shown.delete(text);
      const pool = sentencePool(templateSentences(facts, i18n, budget, t), current, shown);
      const next = sequence.read(pool, t, false);
      if (current && next?.text !== current.text) shown.set(current.text, t);
      current = next;
      if (next) shown.set(next.text, t);
    }
    return { rows: wallItems, facts, lead: current as RotatingSentence | null, state: state.kind, voice: departureVoice(zet, at) };
  }
  return { step };
}
