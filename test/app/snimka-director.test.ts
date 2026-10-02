// @vitest-environment happy-dom
// The director (app/src/snimka/director.ts, plan section 3.5): the pure step
// under an injected wall clock (dwell, hold, resume, re-arm, layer cues,
// reduced motion), the cue choice between events and headlines, and the
// binding to a fake context and StageMap (never seeks, never changes speed,
// only a layer cue touches the layers; a second bind replaces the first).
import { describe, expect, it, vi } from 'vitest';
import type { NewsFile, SnimkaEvent, Speed } from '../../shared/snimka';
import type { ReplayClock, TickReason } from '../../app/src/snimka/clock';
import { createLayerStore, createViewStore, type SnimkaContext } from '../../app/src/snimka/context';
import type { StageMap } from '../../app/src/snimka/contracts';
import {
  DIRECTOR_RESUME_EVENT, DIRECTOR_STATE_EVENT, DWELL_MS, INITIAL_DIRECTOR_STATE, RESUME_AFTER_MS, bindDirector, bindDirectorContract, cueAt, directorStep, holdDirector, rearmDirector, spotFor,
  type DirectorCue, type DirectorState,
} from '../../app/src/snimka/director';

const H = 3600;
const P = { facts: [] as never[], mentions: {} };
const ev = (id: string, atSec: number, focus: SnimkaEvent['focus'], spot?: SnimkaEvent['spot']): SnimkaEvent =>
  ({ id, atSec, kind: 'recording', title: id, text: null, sources: [], derived: false, chapter: true, focus, ...(spot ? { spot } : {}), ...P });
const events: SnimkaEvent[] = [
  ev('city', 10 * H, { kind: 'city' }),
  ev('line', 11 * H, { kind: 'route', id: '228' }),
  ev('court', 12 * H, { kind: 'none' }, 'stanje'),
  ev('bikes', 13 * H, { kind: 'layer', layer: 'bikes' }),
];
const news: NewsFile = {
  v: 2,
  outlets: { jutarnji: { name: 'Jutarnji list', home: 'https://www.jutarnji.hr/' }, vecernji: { name: 'Večernji list', home: 'https://www.vecernji.hr/' }, n1: { name: 'N1', home: 'https://n1info.hr/' } },
  items: [{ id: 'j1', outlet: 'jutarnji', title: 'Naslov', link: 'https://www.jutarnji.hr/1', pubSec: 11 * H + 1800, beat: null, focus: { kind: 'place', id: 'jelacic' }, ...P }],
};
const cue = (id: string, focus: DirectorCue['focus'] = { kind: 'city' }): DirectorCue => ({ id, atSec: 0, focus, spot: spotFor(focus) });
const input = (over: Partial<Parameters<typeof directorStep>[1]> = {}): Parameters<typeof directorStep>[1] =>
  ({ now: 100_000, playing: true, follow: true, cue: cue('a'), lastUserInputAt: -Infinity, reducedMotion: false, ...over });

describe('directorStep', () => {
  it('does nothing while paused or not following, and nothing without a cue change', () => {
    expect(directorStep(INITIAL_DIRECTOR_STATE, input({ playing: false })).commands).toEqual([]);
    expect(directorStep(INITIAL_DIRECTOR_STATE, input({ follow: false })).commands).toEqual([]);
    expect(directorStep(INITIAL_DIRECTOR_STATE, input({ cue: null })).commands).toEqual([]);
    expect(directorStep({ ...INITIAL_DIRECTOR_STATE, lastCueId: 'a' }, input()).commands).toEqual([]);
  });
  it('a new cue flies to its focus and pulses its spot; the move is recorded', () => {
    const r = directorStep(INITIAL_DIRECTOR_STATE, input({ cue: cue('line', { kind: 'route', id: '228' }) }));
    expect(r.commands).toEqual([{ kind: 'fly', focus: { kind: 'route', id: '228' } }, { kind: 'spot', id: 'mreza' }]);
    expect(r.state).toEqual({ lastCueId: 'line', lastMoveAt: 100_000, held: false });
  });
  it('waits DWELL_MS after a move, then takes the newest cue', () => {
    let state: DirectorState = { lastCueId: 'a', lastMoveAt: 100_000, held: false };
    let r = directorStep(state, input({ now: 100_000 + DWELL_MS - 1, cue: cue('b') }));
    expect(r.commands).toEqual([]);
    expect(r.state).toBe(state);
    r = directorStep(state, input({ now: 100_000 + DWELL_MS, cue: cue('c') }));
    expect(r.commands[0]).toEqual({ kind: 'fly', focus: { kind: 'city' } });
    state = r.state;
    expect(state.lastCueId).toBe('c');
  });
  it('a none cue only pulses and a layer cue switches its layer; neither counts as a camera move', () => {
    const none = directorStep({ lastCueId: 'a', lastMoveAt: 100_000, held: false }, input({ now: 100_100, cue: cue('court', { kind: 'none' }) }));
    expect(none.commands).toEqual([{ kind: 'spot', id: 'vozila' }]);
    expect(none.state.lastMoveAt).toBe(100_000);
    const layer = directorStep(none.state, input({ now: 100_200, cue: cue('bikes', { kind: 'layer', layer: 'bikes' }) }));
    expect(layer.commands).toEqual([{ kind: 'layer', layer: 'bikes' }, { kind: 'spot', id: 'bicikli' }]);
    expect(layer.state.lastMoveAt).toBe(100_000);
  });
  it('held: a cue inside RESUME_AFTER_MS of the reader input is skipped for good; the next one after it resumes', () => {
    let state = holdDirector({ lastCueId: 'a', lastMoveAt: 0, held: false });
    expect(state.held).toBe(true);
    let r = directorStep(state, input({ now: 100_000, lastUserInputAt: 90_000, cue: cue('b') }));
    expect(r.commands).toEqual([]);
    expect(r.state).toEqual({ ...state, lastCueId: 'b' });
    state = r.state;
    // Still b after the 20 s: nothing, the director never flies back on its own.
    r = directorStep(state, input({ now: 90_000 + RESUME_AFTER_MS + 1, lastUserInputAt: 90_000, cue: cue('b') }));
    expect(r.commands).toEqual([]);
    r = directorStep(state, input({ now: 90_000 + RESUME_AFTER_MS + 1, lastUserInputAt: 90_000, cue: cue('c') }));
    expect(r.commands[0]).toEqual({ kind: 'fly', focus: { kind: 'city' } });
    expect(r.state.held).toBe(false);
  });
  it('re-armed: the current cue is applied again at the next tick', () => {
    const state = rearmDirector({ lastCueId: 'b', lastMoveAt: 0, held: true });
    expect(state).toEqual({ lastCueId: null, lastMoveAt: 0, held: false });
    expect(directorStep(state, input({ cue: cue('b') })).commands[0]).toEqual({ kind: 'fly', focus: { kind: 'city' } });
  });
  it('reduced motion: the fly stays (the map jumps), the spot goes', () => {
    const r = directorStep(INITIAL_DIRECTOR_STATE, input({ reducedMotion: true, cue: cue('b') }));
    expect(r.commands).toEqual([{ kind: 'fly', focus: { kind: 'city' } }]);
  });
});

describe('cueAt and spotFor', () => {
  const ctx = { events, news };
  it('the newest event or headline at or before the instant, the later of the two, with the event\'s own spot or the focus\'s', () => {
    expect(cueAt(ctx, 10 * H + 5)).toMatchObject({ id: 'event:city', spot: 'vozila' });
    expect(cueAt(ctx, 11 * H + 5)).toMatchObject({ id: 'event:line', spot: 'mreza' });
    expect(cueAt(ctx, 11 * H + 1800)).toMatchObject({ id: 'news:j1', focus: { kind: 'place', id: 'jelacic' }, spot: 'vozila' });
    expect(cueAt(ctx, 12 * H)).toMatchObject({ id: 'event:court', spot: 'vozila' }); // the event's v2 spot 'stanje' points at Vozila
    expect(cueAt(ctx, 13 * H)).toMatchObject({ id: 'event:bikes', spot: 'bicikli' });
    expect(cueAt(ctx, 9 * H)).toBeNull();
  });
  it('spotFor: a line to Mreža, a station to Bicikli, a layer to its panel, the rest to Vozila', () => {
    expect(spotFor({ kind: 'station', id: 'x' })).toBe('bicikli');
    expect(spotFor({ kind: 'layer', layer: 'live' })).toBe('mreza');
    expect(spotFor({ kind: 'layer', layer: 'closures' })).toBe('vozila');
    expect(spotFor({ kind: 'stop', id: '109_1' })).toBe('vozila');
  });
});

// ---- bindDirector on a fake context -------------------------------------------------------------------------

function fakeContext(startSec: number) {
  let nowMs = startSec * 1000;
  let playing = true;
  const tickListeners = new Set<(t: number, reason: TickReason) => void>();
  const clock: ReplayClock = {
    now: () => nowMs, playing: () => playing, suspended: () => false, speed: () => 600 as Speed, start: 0, end: 1e12,
    play: () => { playing = true; }, pause: () => { playing = false; }, toggle: () => { playing = !playing; },
    setSpeed: vi.fn(), seek: vi.fn((t: number) => { nowMs = t; }), step: vi.fn(), chapters: () => [], chapterIndex: () => -1, prevChapter: () => null, nextChapter: () => null,
    suspend: () => {}, resume: () => {}, onTick: (fn) => { tickListeners.add(fn); return () => { tickListeners.delete(fn); }; }, destroy: () => {},
  };
  const subscribers = new Set<(t: number) => void>();
  const frames = { subscribe: (fn: (t: number) => void) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; }, kick: vi.fn(), destroy: () => {} };
  const layers = createLayerStore();
  const view = createViewStore();
  const ctx = {
    events, news, clock, frames, layers, view, reducedMotion: false, doc: document,
  } as unknown as SnimkaContext;
  return {
    ctx, clock, layers, view, frames,
    /** Advance the replay instant and emit one frame. */
    frame: (sec: number) => { nowMs = sec * 1000; for (const fn of [...subscribers]) fn(nowMs); },
    setPlaying: (on: boolean) => { playing = on; },
  };
}

function fakeMap() {
  const moveListeners = new Set<() => void>();
  const map: StageMap = {
    flyTo: vi.fn(), select: vi.fn(), camera: () => ({ center: [15.98, 45.815], zoom: 12.6 }),
    onUserMove: (fn) => { moveListeners.add(fn); return () => { moveListeners.delete(fn); }; },
    vehicles: () => [], liveCounts: () => null, resize: () => {}, destroy: () => {},
  };
  return { map, userMove: () => { for (const fn of [...moveListeners]) fn(); } };
}

describe('bindDirector', () => {
  it('flies on a cue change while playing, pulses the spot, never seeks or changes the speed; the opening cue is not re-flown', () => {
    const f = fakeContext(10 * H + 10);
    const { map } = fakeMap();
    const spot = vi.fn();
    let wall = 1_000_000;
    const unbind = bindDirector(f.ctx, map, { spot }, { now: () => wall });
    f.frame(10 * H + 20);
    expect(map.flyTo).not.toHaveBeenCalled();
    f.frame(11 * H + 1);
    expect(map.flyTo).toHaveBeenCalledWith({ kind: 'route', id: '228' }, { reason: 'director' });
    expect(spot).toHaveBeenCalledWith('mreza');
    wall += DWELL_MS;
    f.frame(11 * H + 1800);
    expect(map.flyTo).toHaveBeenLastCalledWith({ kind: 'place', id: 'jelacic' }, { reason: 'director' });
    expect(f.clock.seek).not.toHaveBeenCalled();
    expect(f.clock.setSpeed).not.toHaveBeenCalled();
    expect(f.layers.get()).toEqual({ vehicles: true, compare: true, bikes: true, follow: true });
    unbind();
    wall += DWELL_MS;
    f.frame(12 * H + 1);
    expect(map.flyTo).toHaveBeenCalledTimes(2);
  });
  it('a reader move or a subject holds it, announced on the document; the chip, the view and the resume event re-arm it', () => {
    const f = fakeContext(10 * H + 10);
    const { map, userMove } = fakeMap();
    const states: boolean[] = [];
    document.addEventListener(DIRECTOR_STATE_EVENT, (e) => { states.push((e as CustomEvent<{ held: boolean }>).detail.held); });
    let wall = 1_000_000;
    const unbind = bindDirector(f.ctx, map, { spot: () => {} }, { now: () => wall });
    userMove();
    expect(states).toEqual([true]);
    wall += 1000;
    f.frame(11 * H + 1);
    expect(map.flyTo).not.toHaveBeenCalled();
    // The chip re-arms at once: the current cue is applied at the next frame.
    f.layers.set({ follow: false });
    f.layers.set({ follow: true });
    expect(states).toEqual([true, false]);
    f.frame(11 * H + 2);
    expect(map.flyTo).toHaveBeenCalledTimes(1);
    // A subject the reader sets holds again; the resume event re-arms.
    f.view.set({ subject: { kind: 'stop', id: '109_1' } }, 'user');
    expect(states).toEqual([true, false, true]);
    document.dispatchEvent(new CustomEvent(DIRECTOR_RESUME_EVENT));
    expect(states).toEqual([true, false, true, false]);
    // A subject the director itself sets is not a hold.
    f.view.set({ subject: { kind: 'route', id: '6' } }, 'director');
    expect(states).toEqual([true, false, true, false]);
    unbind();
  });
  it('a layer cue switches the layer on and nothing else; paused, nothing happens', () => {
    const f = fakeContext(12 * H + 10);
    const { map } = fakeMap();
    f.layers.set({ bikes: false });
    const unbind = bindDirectorContract(f.ctx, map, { spot: () => {} });
    f.setPlaying(false);
    f.frame(13 * H + 1);
    expect(f.layers.get().bikes).toBe(false);
    f.setPlaying(true);
    f.frame(13 * H + 2);
    expect(f.layers.get().bikes).toBe(true);
    expect(map.flyTo).not.toHaveBeenCalled();
    unbind();
  });
  it('a second bind on the same map replaces the first', () => {
    const f = fakeContext(10 * H + 10);
    const { map } = fakeMap();
    const first = vi.fn();
    const second = vi.fn();
    bindDirector(f.ctx, map, { spot: first });
    const unbind = bindDirector(f.ctx, map, { spot: second });
    f.frame(11 * H + 1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('mreza');
    expect(map.flyTo).toHaveBeenCalledTimes(1);
    unbind();
  });
});
