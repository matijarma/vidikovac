// The subtitle band (app/src/snimka/subtitle.ts): the hold of 1,200 ms at
// any speed with an injected wall clock, the latest line winning at expiry,
// the same text being no change, the observed readings sampled per replay
// minute at 600x, and on the page the record ("Zapis") inside a run and
// today's rules ("Po današnjim pravilima pisalo bi") between runs.
import { Window } from 'happy-dom';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SNIMKA_WINDOW, type HashedRef, type ScreenRun } from '../../shared/snimka';
import { createReplayClock } from '../../app/src/snimka/clock';
import { createViewStore, type SnimkaContext } from '../../app/src/snimka/context';
import type { FrameLoop } from '../../app/src/snimka/frames';
import { createSubtitleSelector, mountSubtitle, observedIndexAt, SUBTITLE_HOLD_MS, subtitleLineAt, type SubtitleLine } from '../../app/src/snimka/subtitle';
import { buildSnimkaFixture, buildVoiceDay, MARKS, zg } from '../../e2e/snimka-fixtures';

const line = (text: string, source: SubtitleLine['source'] = 'replayed'): SubtitleLine => ({ source, text });

describe('createSubtitleSelector', () => {
  it('shows the first line at once and holds every line 1,200 ms; the latest offer wins at expiry', () => {
    let wall = 0;
    const s = createSubtitleSelector({ holdMs: SUBTITLE_HOLD_MS, now: () => wall });
    expect(s.offer(line('a'))).toBe(true);
    wall = 500;
    expect(s.offer(line('b'))).toBe(false);
    wall = 900;
    expect(s.offer(line('c'))).toBe(false);
    expect(s.shown()?.text).toBe('a');
    expect(s.dueIn()).toBe(300);
    wall = 1199;
    expect(s.flush()).toBe(false);
    wall = 1200;
    expect(s.flush()).toBe(true);
    expect(s.shown()?.text).toBe('c');
    expect(s.dueIn()).toBeNull();
  });
  it('the same text is no change, and an offer that returns to the shown line drops the waiting one', () => {
    let wall = 0;
    const s = createSubtitleSelector({ now: () => wall });
    s.offer(line('a'));
    wall = 5000;
    expect(s.offer(line('a'))).toBe(false);
    wall = 5100;
    s.offer(line('b'));
    // b waits? No: the hold of a expired long ago, so b shows at once.
    expect(s.shown()?.text).toBe('b');
    wall = 5200;
    s.offer(line('c'));
    s.offer(line('b'));
    expect(s.dueIn()).toBeNull();
    // The same words from another source are another line.
    wall = 7000;
    expect(s.offer(line('b', 'observed'))).toBe(true);
  });
  it('ten minutes of wall at 600x with a sentence changing every replay minute: at most one change per hold', () => {
    let wall = 0;
    const s = createSubtitleSelector({ now: () => wall });
    let changes = 0;
    const frameMs = 1000 / 60;
    for (let f = 0; f * frameMs <= 600_000; f++) {
      wall = f * frameMs;
      const replayMinute = Math.floor((wall / 1000) * 600 / 60);
      if (s.offer(line(`minute ${replayMinute}`))) changes += 1;
      if (s.flush()) changes += 1;
    }
    expect(changes).toBeLessThanOrEqual(Math.ceil(600_000 / SUBTITLE_HOLD_MS) + 1);
    expect(changes).toBeGreaterThan(450);
    console.info(`[subtitle] 10 wall minutes at 600x, a new sentence every replay minute: ${changes} changes`);
  });
});

describe('the line at an instant', () => {
  const run: Pick<ScreenRun, 'readings'> = {
    readings: [0, 20, 40, 60, 80, 100, 130].map((s) => ({ at: 1_000_020 + s, sentence: `r${s}`, kicker: null, kickerText: null, fact: null, family: 'other', rows: [], pills: null, mapNote: null, fleet: null })),
  };
  it('below 600x the latest reading; at 600x and faster the first reading of the replay minute', () => {
    // 1_000_020 is 20 s into a minute (1_000_000 = 16666 min + 40 s; the minute starts at 999_960).
    const t = 1_000_020 + 50;
    expect(observedIndexAt(run, t, 60)).toBe(2);
    const minuteStart = Math.floor(t / 60) * 60;
    const first = run.readings.findIndex((r) => r.at >= minuteStart);
    expect(observedIndexAt(run, t, 600)).toBe(first);
    expect(observedIndexAt(run, t, 3600)).toBe(first);
    expect(observedIndexAt(run, 1_000_020 - 1, 60)).toBe(-1);
  });
  it('the record where a run is shown, today\'s rules elsewhere, the word for none, and nothing while loading', () => {
    const mon = buildVoiceDay('mon');
    const voice = { file: mon, minute: mon.minutes[7 * 60 + 45]!, i: 7 * 60 + 45 };
    expect(subtitleLineAt({ run: run as ScreenRun, voice, tSec: 1_000_100, speed: 60 })).toEqual({ source: 'observed', text: 'r80' });
    expect(subtitleLineAt({ run: null, voice, tSec: 0, speed: 60 })).toEqual({ source: 'replayed', text: 'U pokretu su 2 vozila, po voznom redu oko 230.' });
    expect(subtitleLineAt({ run: null, voice: null, tSec: 0, speed: 60 })).toEqual({ source: 'none', text: null });
    expect(subtitleLineAt({ run: 'loading', voice, tSec: 0, speed: 60 })).toBeNull();
    expect(subtitleLineAt({ run: null, voice: 'loading', tSec: 0, speed: 60 })).toBeNull();
  });
});

// ---- on the page --------------------------------------------------------------------------------

const fixture = buildSnimkaFixture();
let page: Window | null = null;
beforeAll(() => { page = new Window({ url: 'http://localhost/snimka/' }); });
afterAll(async () => { await page?.happyDOM.close(); });
afterEach(() => { vi.useRealTimers(); });

function stage(at: number) {
  const subs = new Set<(t: number) => void>();
  const frames: FrameLoop = { subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; }, kick() {}, destroy() {} };
  const clock = createReplayClock({ start: SNIMKA_WINDOW.fromSec * 1000, end: SNIMKA_WINDOW.toSec * 1000, at: at * 1000, playing: false, now: () => 0 });
  const ctx = {
    manifest: fixture.manifest, clock, frames, view: createViewStore(), doc: page!.document as unknown as Document, reducedMotion: false,
    data: {
      url: (r: HashedRef | string) => String(typeof r === 'string' ? r : r.path),
      get: async <T,>(r: HashedRef | string, decode?: (raw: unknown) => T): Promise<T> => {
        const path = typeof r === 'string' ? r : r.path;
        if (!fixture.objects.has(path)) throw new Error(`404 ${path}`);
        return decode ? decode(fixture.objects.get(path)) : (fixture.objects.get(path) as T);
      },
    },
  } as unknown as SnimkaContext;
  return { ctx, clock };
}

describe('mountSubtitle', () => {
  it('between runs: today\'s rules with their mark and note; inside a run the record; the mark is a described button', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const { ctx, clock } = stage(zg(9, 28, 7, 40));
    const root = page!.document.createElement('div') as unknown as HTMLElement;
    page!.document.body.append(root as never);
    const sub = mountSubtitle(ctx, root);
    for (let i = 0; i < 4; i++) { await vi.advanceTimersByTimeAsync(50); sub.update(clock.now()); }
    const band = root.querySelector<HTMLElement>('.sn-sub')!;
    expect(band.dataset.snSubSource).toBe('replayed');
    expect(root.querySelector('.sn-sub-kicker')!.textContent).toBe('Po današnjim pravilima pisalo bi');
    expect(root.querySelector('.sn-sub-mark')!.textContent).toBe('izračun');
    expect(root.querySelector('.sn-sub-text')!.textContent).toMatch(/^U pokretu su 2 vozila|^Na stanicama je/);
    const mark = root.querySelector<HTMLButtonElement>('.sn-sub-mark')!;
    expect(mark.tagName).toBe('BUTTON');
    const note = root.querySelector<HTMLElement>(`#${mark.getAttribute('aria-describedby')}`)!;
    expect(note.textContent).toContain('naknadno izračunala');
    expect(band.hasAttribute('aria-live')).toBe(false);
    expect(root.querySelector('[aria-live]')).toBeNull();
    // Into the Monday run: the record shows once the hold has passed.
    clock.seek(MARKS.monday0745 * 1000 + 60_000);
    for (let i = 0; i < 4; i++) { await vi.advanceTimersByTimeAsync(50); sub.update(clock.now()); }
    await vi.advanceTimersByTimeAsync(SUBTITLE_HOLD_MS + 50);
    expect(band.dataset.snSubSource).toBe('observed');
    expect(root.querySelector('.sn-sub-mark')!.textContent).toBe('zapis');
    expect(root.querySelector('.sn-sub-kicker')!.textContent).toBe('Na zaslonu je pisalo');
    expect(root.querySelector('.sn-sub-text')!.textContent).toBe('Tramvaj 6 prema Črnomercu polazi u 07:52 po voznom redu.');
    // A tap opens the note; Escape closes it.
    mark.click();
    expect(band.dataset.open).toBe('true');
    expect(mark.getAttribute('aria-expanded')).toBe('true');
    // A minute neither the record nor the voice covers: the word for none.
    clock.seek(zg(9, 28, 12, 0) * 1000);
    sub.update(clock.now());
    await vi.advanceTimersByTimeAsync(SUBTITLE_HOLD_MS + 50);
    expect(band.dataset.snSubSource).toBe('none');
    expect(root.querySelector('.sn-sub-text')!.textContent).toBe('Za ovu minutu nema rečenice.');
    expect(root.querySelector<HTMLElement>('.sn-sub-head')!.hidden).toBe(true);
    sub.destroy();
  });
});
