// The director (plan section 3.5): while the clock plays and "Karta prati
// snimku" is on, the newest chapter, marker or headline at or before the
// instant is the cue, and on a cue change the map flies to its focus and
// the named panel datum is pulsed once. Minimum dwell DWELL_MS of wall time
// between camera moves; a move the reader makes (the map's own onUserMove)
// or a subject they set holds the director, which resumes only at the next
// cue change after RESUME_AFTER_MS without input and never flies back on its
// own; the chip (ctx.layers follow false to true) or the resume event re-arm
// it at once. It never seeks, never changes the speed or a layer, except a
// `layer` cue, which switches the named layer on. Reduced motion: the map
// jumps (its own rule) and nothing is pulsed.
//
// directorStep is pure and takes the wall clock as input; bindDirector wires
// it to the context, the StageMap and the shell's hooks. A second bind on
// the same StageMap replaces the first (V0's stub stage binds nothing, so the
// map lane binds itself with no spot hook; the shell's bind then takes over).
import type { Focus, SnimkaEvent } from '../../../shared/snimka';
import type { SnimkaContext } from './context';
import type { BindDirector, PanelId, StageMap } from './contracts';
import { sameSubject } from './subject';
import { currentArticle, currentMarker } from './voices';

export const DWELL_MS = 4000;
export const RESUME_AFTER_MS = 20_000;
/** Dispatched on ctx.doc by the shell's "Vrati vođeni prikaz" button: re-arms a held director. */
export const DIRECTOR_RESUME_EVENT = 'sn-director-resume';
/** Dispatched on ctx.doc whenever the director's hold changes: detail { held: boolean }. */
export const DIRECTOR_STATE_EVENT = 'sn-director-state';

export type SpotId = PanelId | 'zaslon';
export interface DirectorCue { id: string; atSec: number; focus: Focus; spot: SpotId }
export interface DirectorState { lastCueId: string | null; lastMoveAt: number; held: boolean }
export interface DirectorInput {
  /** Wall milliseconds. */
  now: number;
  playing: boolean;
  follow: boolean;
  cue: DirectorCue | null;
  /** Wall milliseconds of the reader's last move or subject, -Infinity for none. */
  lastUserInputAt: number;
  reducedMotion: boolean;
}
export type DirectorCommand =
  | { kind: 'fly'; focus: Focus }
  | { kind: 'layer'; layer: 'bikes' | 'closures' | 'live' }
  | { kind: 'spot'; id: SpotId };

/** v3: an event's spot naming a retired v2 panel points at the panel that absorbed it. */
const LEGACY_SPOT: Record<string, SpotId> = { stanje: 'vozila', linije: 'mreza', vrijeme: 'vozila' };

export const INITIAL_DIRECTOR_STATE: DirectorState = { lastCueId: null, lastMoveAt: -Infinity, held: false };

/** The panel a focus points at when the cue names none: a line to Linije, a station to Bicikli, a layer to its panel, the rest to Stanje. */
export function spotFor(focus: Focus): SpotId {
  switch (focus.kind) {
    case 'route': return 'mreza';
    case 'station': return 'bicikli';
    case 'layer': return focus.layer === 'bikes' ? 'bicikli' : focus.layer === 'live' ? 'mreza' : 'vozila';
    default: return 'vozila';
  }
}

/** The cue at an instant: the newest event (currentMarker) or headline (currentArticle) at or before it, the later of the two. */
export function cueAt(ctx: Pick<SnimkaContext, 'events' | 'news'>, atSec: number): DirectorCue | null {
  const marker: SnimkaEvent | null = currentMarker(ctx.events, atSec);
  const article = currentArticle(ctx.news, atSec);
  const fromMarker = marker ? { id: `event:${marker.id}`, atSec: marker.atSec, focus: marker.focus, spot: marker.spot ? (LEGACY_SPOT[marker.spot] ?? marker.spot) as SpotId : spotFor(marker.focus) } : null;
  const fromArticle = article ? { id: `news:${article.item.id}`, atSec: article.item.pubSec, focus: article.item.focus, spot: spotFor(article.item.focus) } : null;
  if (fromMarker && fromArticle) return fromArticle.atSec > fromMarker.atSec ? fromArticle : fromMarker;
  return fromMarker ?? fromArticle;
}

/** Whether a focus moves the camera (a layer cue switches a layer, `none` only pulses). */
const moves = (focus: Focus): boolean => focus.kind !== 'none' && focus.kind !== 'layer';

/** One tick: the commands to run now and the state after them. */
export function directorStep(state: DirectorState, input: DirectorInput): { commands: DirectorCommand[]; state: DirectorState } {
  if (!input.playing || !input.follow) return { commands: [], state };
  const cue = input.cue;
  if (!cue || cue.id === state.lastCueId) return { commands: [], state };
  if (state.held) {
    // Held by the reader: a cue that passes within RESUME_AFTER_MS of their input is skipped, never caught up on.
    if (input.now - input.lastUserInputAt < RESUME_AFTER_MS) return { commands: [], state: { ...state, lastCueId: cue.id } };
  }
  const moving = moves(cue.focus);
  // Too soon after the last move: nothing is recorded, so the newest cue is tried again next tick.
  if (moving && input.now - state.lastMoveAt < DWELL_MS) return { commands: [], state };
  const commands: DirectorCommand[] = [];
  if (cue.focus.kind === 'layer') commands.push({ kind: 'layer', layer: cue.focus.layer });
  else if (moving) commands.push({ kind: 'fly', focus: cue.focus });
  if (!input.reducedMotion) commands.push({ kind: 'spot', id: cue.spot });
  return { commands, state: { lastCueId: cue.id, lastMoveAt: moving ? input.now : state.lastMoveAt, held: false } };
}

/** The reader moved the map or set a subject: held. */
export function holdDirector(state: DirectorState): DirectorState {
  return state.held ? state : { ...state, held: true };
}

/** The chip or the resume button: not held, and the current cue is applied at the next tick (subject to the dwell). */
export function rearmDirector(state: DirectorState): DirectorState {
  return { ...state, held: false, lastCueId: null };
}

const bound = new WeakMap<StageMap, () => void>();

export interface DirectorDeps { now?: () => number }

/** Binds the director to the context, the map and the shell's hooks; returns its unbind. A second bind on the same map replaces the first. */
export function bindDirector(ctx: SnimkaContext, map: StageMap, hooks: { spot(id: SpotId): void }, deps: DirectorDeps = {}): () => void {
  bound.get(map)?.();
  const now = deps.now ?? ((): number => Date.now());
  const { clock, frames, layers, view, doc } = ctx;
  let state: DirectorState = { ...INITIAL_DIRECTOR_STATE, lastCueId: cueAt(ctx, clock.now() / 1000)?.id ?? null };
  let lastUserInputAt = -Infinity;
  let heldShown = false;
  let disposed = false;

  function announce(): void {
    if (state.held === heldShown) return;
    heldShown = state.held;
    try { doc.dispatchEvent(new CustomEvent(DIRECTOR_STATE_EVENT, { detail: { held: state.held } })); } catch { /* no CustomEvent: nothing to announce */ }
  }

  function hold(): void {
    lastUserInputAt = now();
    state = holdDirector(state);
    announce();
  }

  function rearm(): void {
    state = rearmDirector(state);
    announce();
    frames.kick();
  }

  function run(commands: readonly DirectorCommand[]): void {
    for (const command of commands) {
      if (command.kind === 'fly') map.flyTo(command.focus, { reason: 'director' });
      else if (command.kind === 'layer') layers.set({ [command.layer]: true });
      else hooks.spot(command.id);
    }
  }

  const offFrames = frames.subscribe((t) => {
    if (disposed) return;
    const result = directorStep(state, {
      now: now(),
      playing: clock.playing() && !clock.suspended(),
      follow: layers.get().follow,
      cue: cueAt(ctx, t / 1000),
      lastUserInputAt,
      reducedMotion: ctx.reducedMotion,
    });
    state = result.state;
    announce();
    run(result.commands);
  });
  const offMove = map.onUserMove(hold);
  const offView = view.onChange((next, prev, reason) => {
    if (reason === 'director') return;
    if (next.subject !== null && !sameSubject(next.subject, prev.subject)) hold();
    if (next.following && !prev.following) rearm();
  });
  const offLayers = layers.onChange((next, prev) => {
    if (next.follow && !prev.follow) rearm();
  });
  const onResume = (): void => rearm();
  doc.addEventListener(DIRECTOR_RESUME_EVENT, onResume);

  const unbind = (): void => {
    if (disposed) return;
    disposed = true;
    doc.removeEventListener(DIRECTOR_RESUME_EVENT, onResume);
    offLayers();
    offView();
    offMove();
    offFrames();
    if (bound.get(map) === unbind) bound.delete(map);
  };
  bound.set(map, unbind);
  return unbind;
}

/** The contract's name for it (contracts.ts BindDirector), without the test-only clock. */
export const bindDirectorContract: BindDirector = (ctx, map, hooks) => bindDirector(ctx, map, hooks);
