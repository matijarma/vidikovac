// @vitest-environment happy-dom
// Zaslon (app/src/snimka/screen.ts, decision V3-22): the reading shown is the
// latest at or before the clock in the run that covers it; between runs the
// board's next timetable departures, never padded; the photograph only while
// the clock is within a minute of the shown run; the five mornings take the
// slot runs at 07:45; and on the page there is no source toggle, the
// miniature always draws the record and is rewritten only when the reading
// changes, two lines say what the screen showed and what today's rules would
// show, and the mornings are a five-row table with the recorded sentences.
import { describe, expect, it } from 'vitest';
import { SNIMKA_WINDOW, ZAGREB_OFFSET_S, type BoardSeries, type SeriesFile, type HashedRef, type ScreenIndex, type ScreenRun, type VoiceFile, type VoiceIndex } from '../../shared/snimka';
import type { SnimkaContext } from '../../app/src/snimka/context';
import type { FrameLoop } from '../../app/src/snimka/frames';
import {
  RUN_LEAD_S, badgeOf, boardAt, boardHtml, captureHtml, captureInRun, morningSentence, mornings, mountScreen, movingText, nextRunAfter, readingHtml, readingIndexAt, routeKind, runAt, runShownAt, screenSourceAt, type IndexRun,
} from '../../app/src/snimka/screen';

const zg = (month: number, day: number, hour: number, minute = 0, second = 0): number => Date.UTC(2026, month - 1, day, hour, minute, second) / 1000 - ZAGREB_OFFSET_S;
const ref = (name: string): HashedRef => ({ path: `${name}.0123456789abcdef.json`, bytes: 10, sha256: '0123456789abcdef'.padEnd(64, '0') });
const capture = (name: string): HashedRef => ({ path: `${name}.0123456789abcdef.webp`, bytes: 10, sha256: '0123456789abcdef'.padEnd(64, '0') });

function indexRun(id: string, kind: IndexRun['kind'], fromSec: number, minutes = 10, withCapture = true): IndexRun {
  return {
    id, kind, fromSec, toSec: fromSec + minutes * 60, readings: minutes * 3, file: ref(`screen/${id}`),
    captures: { kiosk: withCapture ? capture(`captures/${id}`) : null, phone: null },
    summary: { sentences: { solar: minutes * 3 }, departureRows: 3, liveRows: 0 },
  };
}

function screenRun(run: IndexRun, sentence = (i: number) => `Rečenica ${i}.`): ScreenRun {
  const readings = Array.from({ length: run.readings }, (_, i) => ({
    at: run.fromSec + i * 20, sentence: sentence(i), kicker: 'vrijeme', kickerText: 'Vrijeme', fact: 'sunset|x', family: 'solar' as const,
    rows: [0, 1, 2], pills: null, mapNote: i === 0 ? 'ZET: u pokretu 5 vozila, po voznom redu oko 450.' : null, fleet: null,
  }));
  return {
    v: 1, id: run.id, kind: run.kind, place: 'Trg bana J. Jelačića', fromSec: run.fromSec, toSec: run.toSec,
    rows: [
      { id: 'dep:13', kind: 'departure', source: 'zet-gtfs', live: false, title: '13 Kvat. trg', whenText: '07:45', sub: null, caveat: false },
      { id: 'dep:6', kind: 'departure', source: 'zet-rt', live: true, title: '6 Sopot', whenText: '07:46', sub: null, caveat: false },
      { id: 'always:jelacic', kind: 'always', source: 'heritage', live: false, title: 'Spomenik banu Josipu Jelačiću', whenText: 'uvijek', sub: 'Trg bana Josipa Jelačića', caveat: false },
    ],
    readings,
  };
}

// The four mornings, each a slot run starting a few seconds after 07:45 as the observer's did, and runs that must not count.
const MON = indexRun('0928-0745', 'slot', zg(9, 28, 7, 45, 11));
const TUE_EARLY = indexRun('0929-0730', 'slot', zg(9, 29, 7, 30));
const TUE = indexRun('0929-0745', 'slot', zg(9, 29, 7, 44, 50));
const WED_SERIES = indexRun('0930-0745-series', 'series', zg(9, 30, 7, 45));
const WED = indexRun('0930-0745', 'slot', zg(9, 30, 7, 46, 2));
const WED_NOON = indexRun('0930-1230', 'slot', zg(9, 30, 12, 30));
const THU = indexRun('1001-0745', 'slot', zg(10, 1, 7, 45, 3));
const RETURN = indexRun('0930-2000-return', 'return', zg(9, 30, 20, 0), 30, false);
const RETURN_INNER = indexRun('0930-2010-adhoc', 'adhoc', zg(9, 30, 20, 10), 5, false);
const INDEX: ScreenIndex = { v: 1, runs: [MON, TUE_EARLY, TUE, WED_SERIES, WED, WED_NOON, RETURN, RETURN_INNER, THU] };

describe('the run and the reading at an instant', () => {
  it('at a run\'s first reading, inside it, at its end, and between runs', () => {
    const run = screenRun(MON);
    expect(runAt(INDEX, MON.fromSec)?.id).toBe(MON.id);
    expect(readingIndexAt(run, MON.fromSec)).toBe(0);
    // Inside: the latest reading at or before the clock, never the next one.
    expect(readingIndexAt(run, MON.fromSec + 15 * 20 + 19)).toBe(15);
    expect(readingIndexAt(run, MON.fromSec + 15 * 20)).toBe(15);
    expect(runAt(INDEX, MON.toSec)?.id).toBe(MON.id);
    expect(readingIndexAt(run, MON.toSec)).toBe(29);
    // Before the first reading and between runs there is none.
    expect(readingIndexAt(run, MON.fromSec - 1)).toBe(-1);
    expect(runAt(INDEX, MON.toSec + 1)).toBeNull();
    expect(runAt(INDEX, zg(9, 28, 12, 0))).toBeNull();
    expect(nextRunAfter(INDEX, zg(9, 28, 12, 0))?.id).toBe(TUE_EARLY.id);
  });
  it('at 07:45 sharp on each of the four mornings the slot run shows, though it starts a few seconds into the minute', () => {
    // (A run already covering the minute wins: here Wednesday's series run, started at 07:45:00.)
    expect(runShownAt(INDEX, zg(9, 30, 7, 45))?.id).toBe(WED_SERIES.id);
    const slots: ScreenIndex = { v: 1, runs: INDEX.runs.filter((r) => r.kind === 'slot') };
    for (const [run, day] of [[MON, 28], [TUE, 29], [WED, 30], [THU, 1]] as const) {
      const at = zg(day === 1 ? 10 : 9, day, 7, 45);
      expect(runShownAt(slots, at)?.id, run.id).toBe(run.id);
    }
    // Only within the lead: earlier, the clock is between runs.
    expect(runShownAt(INDEX, MON.fromSec - RUN_LEAD_S)?.id).toBe(MON.id);
    expect(runShownAt(INDEX, MON.fromSec - RUN_LEAD_S - 1)).toBeNull();
    expect(runAt(INDEX, zg(9, 28, 7, 45))).toBeNull();
  });
  it('where two runs overlap, the one that started last', () => {
    expect(runAt(INDEX, zg(9, 30, 20, 5))?.id).toBe(RETURN.id);
    expect(runAt(INDEX, zg(9, 30, 20, 12))?.id).toBe(RETURN_INNER.id);
    expect(runAt(INDEX, zg(9, 30, 20, 20))?.id).toBe(RETURN.id);
    expect(runAt(INDEX, zg(9, 30, 7, 50))?.id).toBe(WED.id);
  });
});

describe('the five mornings', () => {
  it('take the slot run nearest 07:45 on each morning from Monday to Friday, never a series run', () => {
    const slots = mornings(INDEX, SNIMKA_WINDOW.fromSec, SNIMKA_WINDOW.toSec);
    expect(slots.map((s) => s.key)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
    expect(slots.map((s) => s.run?.id ?? null)).toEqual([MON.id, TUE.id, WED.id, THU.id, null]);
    expect(slots.map((s) => s.atSec)).toEqual([zg(9, 28, 7, 45), zg(9, 29, 7, 45), zg(9, 30, 7, 45), zg(10, 1, 7, 45), zg(10, 2, 7, 45)]);
  });
  it('a morning without a slot run stays empty rather than borrowing another hour', () => {
    const slots = mornings({ v: 1, runs: [MON, WED_NOON, WED_SERIES] }, SNIMKA_WINDOW.fromSec, SNIMKA_WINDOW.toSec);
    expect(slots.map((s) => s.run?.id ?? null)).toEqual([MON.id, null, null, null, null]);
  });
  it('the subtitle\'s source at an instant: the record where a run shows, today\'s rules elsewhere', () => {
    expect(screenSourceAt(INDEX, MON.fromSec + 60)).toBe('observed');
    expect(screenSourceAt(INDEX, zg(9, 28, 15, 0))).toBe('replayed');
    expect(screenSourceAt(null, MON.fromSec)).toBe('replayed');
  });
});

describe('the board between runs', () => {
  const board: BoardSeries = {
    v: 2, stop: '106_1', name: 'Trg bana J. Jelačića', place: 'jelacic',
    samples: [
      { at: zg(9, 28, 12, 0), status: 'timetable', next: [['6', 'Sopot', zg(9, 28, 12, 1)], ['13', 'Kvat. trg', zg(9, 28, 12, 3)], ['228', 'Rebro', zg(9, 28, 12, 6)]] },
      { at: zg(9, 28, 12, 5), status: 'timetable', next: [] },
    ],
  };
  it('the next departures at or after the clock, never padded', () => {
    expect(boardAt(board, zg(9, 28, 12, 2))).toEqual({ at: zg(9, 28, 12, 0), next: [['13', 'Kvat. trg', zg(9, 28, 12, 3)], ['228', 'Rebro', zg(9, 28, 12, 6)]] });
    expect(boardAt(board, zg(9, 28, 12, 6))?.next).toEqual([]);
    expect(boardAt(board, zg(9, 28, 11, 59))).toBeNull();
    expect(boardAt(board, zg(9, 28, 12, 21))).toBeNull(); // a sample a quarter of an hour old is no longer "next"
  });
  it('draws the note, the badges in their modes and the word when nothing is due', () => {
    const html = boardHtml(board.name, boardAt(board, zg(9, 28, 12, 0))!);
    expect(html).toContain('Između zapisa zaslona');
    expect(html).toContain('<span class="line" data-kind="tram" data-size="s">13</span>');
    expect(html).toContain('<span class="line" data-kind="bus" data-size="s">228</span>');
    expect(boardHtml(board.name, { at: board.samples[1]!.at, next: [] })).toContain('U voznom redu nema sljedećih polazaka.');
  });
});

describe('the photograph beside the miniature', () => {
  it('only while the clock is within a minute of the shown run, and only a run with a capture', () => {
    expect(captureInRun(INDEX, MON.fromSec + 60)?.id).toBe(MON.id);
    // The run shows from up to RUN_LEAD_S before its first reading: the photograph from a minute before.
    expect(captureInRun(INDEX, MON.fromSec - 60)?.id).toBe(MON.id);
    expect(captureInRun(INDEX, MON.fromSec - 61)).toBeNull();
    expect(captureInRun(INDEX, MON.toSec)?.id).toBe(MON.id);
    // Past its end the run no longer shows: no photograph, never the nearest one of another hour.
    expect(captureInRun(INDEX, MON.toSec + 30)).toBeNull();
    expect(captureInRun(INDEX, zg(9, 28, 13, 0))).toBeNull();
    // The return runs have no capture.
    expect(captureInRun(INDEX, zg(9, 30, 20, 10))).toBeNull();
  });
  it('is a small thumbnail linking to the full picture, its text naming the day and the time', () => {
    const html = captureHtml('/api/snimka/v2/captures/x.webp', MON);
    expect(html).toContain('href="/api/snimka/v2/captures/x.webp"');
    expect(html).toContain('Fotografija zaslona');
    expect(html).toContain('Izgled zaslona, pon 28. 9. u 07:45');
    expect(html).toContain('loading="eager"');
    expect(html).toContain('fetchpriority="low"');
    expect(html).not.toContain('loading="lazy"');
  });
});

describe('the rows', () => {
  it('a departure gets its line badge in its mode; other rows none', () => {
    expect(badgeOf({ kind: 'departure', title: '13 Kvat. trg' })).toEqual({ label: '13', kind: 'tram', rest: 'Kvat. trg' });
    expect(badgeOf({ kind: 'departure', title: 'Tramvaj 6 prema Črnomercu' })).toEqual({ label: '6', kind: 'tram', rest: 'prema Črnomercu' });
    expect(badgeOf({ kind: 'departure', title: '228 Borongaj' })).toEqual({ label: '228', kind: 'bus', rest: 'Borongaj' });
    expect(badgeOf({ kind: 'notice', title: '228 linija' })).toBeNull();
    expect(routeKind('31')).toBe('tram');
    expect(routeKind('101')).toBe('bus');
    expect(routeKind('N')).toBe('other');
  });
  it('the miniature carries the sentence with its kicker, the note and the rows, live times marked', () => {
    const run = screenRun(MON);
    const html = readingHtml(run, run.readings[0]!);
    expect(html).toContain('data-kicker="vrijeme"');
    expect(html).toContain('<span class="sn-mini-kicker">Vrijeme</span> <span class="sn-mini-text">Rečenica 0.</span>');
    expect(html).toContain('ZET: u pokretu 5 vozila');
    expect(html).toContain('<span class="sn-mini-clock">07:45</span>');
    expect(html).toMatch(/data-live="true"[^]*07:46/);
    expect(html).toContain('Spomenik banu Josipu Jelačiću');
    expect(readingHtml(run, run.readings[1]!)).not.toContain('sn-mini-note');
  });
});

// ---- the replayed voice ------------------------------------------------------------------

/** Monday's voice from 07:30 to 08:15: two rows and the service sentence (the other days have no file). */
const VOICE_MON: VoiceFile = {
  v: 2, place: '106_1', day: '2026-09-28', t0: zg(9, 28, 0, 0), step: 60, n: 1440,
  facts: [{ id: 'service:zet', kind: 'service', wording: 'silent', text: 'U pokretu su 2 vozila, po voznom redu oko 230.' }],
  rows: [
    { id: 'dep-6', kind: 'departure', source: 'zet-timetable', live: false, title: 'Tramvaj 6 prema Črnomercu', sub: 'vozni red', atSec: zg(9, 28, 7, 52), caveat: false },
    { id: 'always:jelacic', kind: 'always', source: 'heritage', live: false, title: 'Spomenik banu Josipu Jelačiću', sub: null, atSec: null, caveat: false },
  ],
  sentences: ['U pokretu su 2 vozila, po voznom redu oko 230.'],
  minutes: Array.from({ length: 1440 }, (_, m) => (m >= 450 && m <= 495 ? { at: zg(9, 28, 0, 0) + m * 60, f: [0], r: [0, 1], lead: 0, state: 'silent' as const, voice: 'none' as const, seen: 2, expected: 230, note: null } : null)),
};
const VOICE_INDEX: VoiceIndex = { v: 2, place: '106_1', days: [{ day: VOICE_MON.day, t0: VOICE_MON.t0, n: VOICE_MON.n, file: ref('voice/2026-09-28') }] };
VOICE_INDEX.days[0]!.file.path = `voice/${VOICE_MON.day}.json`;

// ---- the fleet against the normal day ---------------------------------------------------

/** A series of n minutes from t0 whose moving fleet is `seen(minute)`. */
const seriesOf = (t0: number, n: number, seen: (m: number) => number | null): SeriesFile => ({ t0, n, seen: { all: Array.from({ length: n }, (_, m) => seen(m)) } }) as unknown as SeriesFile;
/** The window: 2 vehicles on Monday morning, missing on Tuesday at 07:45, 380 from Thursday on. */
const SERIES = seriesOf(SNIMKA_WINDOW.fromSec, Math.ceil((SNIMKA_WINDOW.toSec - SNIMKA_WINDOW.fromSec) / 60), (m) => {
  const at = SNIMKA_WINDOW.fromSec + m * 60;
  if (at === zg(9, 29, 7, 45)) return null;
  return at >= zg(10, 1, 0, 0) ? 380 : 2;
});
const NORMAL_THU = seriesOf(zg(9, 24, 0, 0), 1440, (m) => (m < 120 ? null : 330));
const NORMAL_MON = seriesOf(zg(9, 21, 0, 0), 1440, () => 321);

describe('the mornings\' cells', () => {
  const ctx = { series: SERIES, comparisons: [{ id: 'cet-0924', weekday: 4, fromSec: zg(9, 24, 0, 0), series: NORMAL_THU }, { id: 'pon-0921', weekday: 1, fromSec: zg(9, 21, 0, 0), series: NORMAL_MON }] } as unknown as Pick<SnimkaContext, 'series' | 'comparisons'>;
  it('the moving fleet with the weekday-matched normal day in brackets; a missing number is a word, never 0', () => {
    expect(movingText(ctx, zg(9, 28, 7, 45))).toBe('2 (321)');
    expect(movingText(ctx, zg(9, 29, 7, 45))).toBe('bez podatka (330)');
    expect(movingText(ctx, zg(10, 1, 7, 45))).toBe('380 (330)');
    // Thursday 24 Sep has no record before 02:00.
    expect(movingText(ctx, zg(9, 29, 1, 0))).toBe('2 (bez podatka)');
  });
  it('the recorded sentence is the slot run\'s reading at 07:45, else its first', () => {
    const run = screenRun(MON);
    expect(morningSentence(run, zg(9, 28, 7, 45))).toBe('Rečenica 0.');
    expect(morningSentence(run, MON.fromSec + 45)).toBe('Rečenica 2.');
    expect(morningSentence({ readings: [] }, zg(9, 28, 7, 45))).toBeNull();
  });
});

// ---- on the page --------------------------------------------------------------------------

function page(runs: Map<string, ScreenRun>) {
  const subs = new Set<(t: number) => void>();
  const frames: FrameLoop = { subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; }, kick() {}, destroy() {} };
  let now = MON.fromSec * 1000;
  const requested: string[] = [];
  const objects = new Map<string, unknown>([['screen/index.json', INDEX], ['board.json', { v: 2, stop: '106_1', name: 'Trg bana J. Jelačića', place: 'jelacic', samples: [] }],
    ['voice/index.json', VOICE_INDEX], [`voice/${VOICE_MON.day}.json`, VOICE_MON]]);
  for (const [id, run] of runs) objects.set(INDEX.runs.find((r) => r.id === id)!.file.path, run);
  const ctx = {
    series: SERIES,
    comparisons: [{ id: 'cet-0924', day: '2026-09-24', weekday: 4, fromSec: zg(9, 24, 0, 0), series: NORMAL_THU }, { id: 'pon-0921', day: '2026-09-21', weekday: 1, fromSec: zg(9, 21, 0, 0), series: NORMAL_MON }],
    manifest: { window: { ...SNIMKA_WINDOW }, files: { screenIndex: 'screen/index.json', voiceIndex: 'voice/index.json', boards: [{ stop: '106_1', name: 'Trg bana J. Jelačića', samples: 0, path: 'board.json', bytes: 0, sha256: '' }] } },
    clock: { now: () => now },
    frames,
    data: {
      url: (r: HashedRef | string) => `/api/snimka/v2/${typeof r === 'string' ? r : r.path}`,
      get: async <T,>(r: HashedRef | string, decode?: (raw: unknown) => T): Promise<T> => {
        const path = typeof r === 'string' ? r : r.path;
        requested.push(path);
        if (!objects.has(path)) throw new Error(`404 ${path}`);
        return decode ? decode(objects.get(path)) : (objects.get(path) as T);
      },
    },
  } as unknown as SnimkaContext;
  return { ctx, emit: (t: number) => { now = t; for (const fn of subs) fn(t); }, requested };
}

const mini = (root: HTMLElement): HTMLElement => root.querySelector<HTMLElement>('.sn-mini')!;
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

const withoutObserver = async (fn: () => Promise<void>): Promise<void> => {
  const g = globalThis as { IntersectionObserver?: unknown };
  const saved = g.IntersectionObserver;
  delete g.IntersectionObserver;
  try { await fn(); } finally { if (saved !== undefined) g.IntersectionObserver = saved; }
};

describe('mountScreen', () => {
  it('has no source toggle; the miniature draws the record, is rewritten only when the reading changes, and the next run is prefetched', async () => {
    const { ctx, emit, requested } = page(new Map([[MON.id, screenRun(MON)], [TUE_EARLY.id, screenRun(TUE_EARLY)]]));
    const root = document.createElement('div');
    root.setAttribute('aria-busy', 'true');
    document.body.append(root);
    let handed: ScreenIndex | null | undefined;
    const off = mountScreen(ctx, root, (ix) => { handed = ix; });
    await settle();
    expect(handed).toBe(INDEX);
    expect(root.hasAttribute('aria-busy')).toBe(false);
    expect(root.querySelectorAll('button')).toHaveLength(0);
    expect(root.querySelector('.sn-screen-source')).toBeNull();
    const mini = root.querySelector<HTMLElement>('.sn-mini')!;
    expect(mini.dataset.view).toBe('reading');
    expect(mini.textContent).toContain('Rečenica 0.');
    expect(root.querySelectorAll('.sn-mini .line').length).toBe(2);
    expect(requested).toContain(TUE_EARLY.file.path);
    const node = mini.firstElementChild;
    emit(MON.fromSec * 1000 + 15_000);
    expect(mini.firstElementChild).toBe(node);
    emit(MON.fromSec * 1000 + 21_000);
    expect(mini.firstElementChild).not.toBe(node);
    expect(mini.textContent).toContain('Rečenica 1.');
    off();
  });
  it('two lines: what the screen showed and what today\'s rules would show, with the note on the second', async () => {
    const { ctx, emit } = page(new Map([[MON.id, screenRun(MON)], [TUE_EARLY.id, screenRun(TUE_EARLY)]]));
    const root = document.createElement('div');
    document.body.append(root);
    const off = mountScreen(ctx, root, () => {});
    await settle();
    const dts = [...root.querySelectorAll('.sn-screen-lines dt')];
    expect(dts.map((d) => d.childNodes[0]!.textContent)).toEqual(['Na zaslonu je pisalo:', 'Po današnjim pravilima pisalo bi:']);
    expect(dts[1]!.getAttribute('title')).toBe('Ovako bi pisalo na zaslonu da je nadogradnja od 29. rujna postojala od početka.');
    const wrote = root.querySelector<HTMLElement>('[data-sn="screen-wrote"]')!;
    const would = root.querySelector<HTMLElement>('[data-sn="screen-would"]')!;
    emit((MON.fromSec + 60) * 1000);
    await settle();
    emit((MON.fromSec + 60) * 1000);
    expect(wrote.textContent).toBe('Rečenica 3.');
    expect(would.textContent).toBe('U pokretu su 2 vozila, po voznom redu oko 230.');
    // Between runs: the miniature draws the board, the first line says the minute was not recorded; the voice has no minute at 15:00.
    emit(zg(9, 28, 15, 0) * 1000);
    expect(mini(root).dataset.view).toBe('none');
    expect(mini(root).textContent).toContain('U voznom redu nema sljedećih polazaka.');
    expect(wrote.textContent).toBe('U ovoj minuti zaslon nije snimljen.');
    expect(wrote.dataset.state).toBe('none');
    expect(would.textContent).toBe('Za ovu minutu nema izračunane rečenice.');
    off();
  });
  it('the photograph shows only inside the shown run', async () => {
    const { ctx, emit } = page(new Map([[MON.id, screenRun(MON)], [TUE_EARLY.id, screenRun(TUE_EARLY)]]));
    const root = document.createElement('div');
    document.body.append(root);
    const off = mountScreen(ctx, root, () => {});
    await settle();
    const capture = root.querySelector<HTMLElement>('[data-sn="screen-capture"]')!;
    expect(capture.hidden).toBe(false);
    expect(capture.querySelector('a')!.getAttribute('href')).toBe(`/api/snimka/v2/${MON.captures.kiosk!.path}`);
    emit(zg(9, 28, 13, 0) * 1000);
    expect(capture.hidden).toBe(true);
    expect(capture.querySelector('img')).toBeNull();
    off();
  });
  it('at 07:45 sharp the miniature shows the run\'s first reading with its own time, not the board', async () => {
    const { ctx, emit } = page(new Map([[MON.id, screenRun(MON)], [TUE_EARLY.id, screenRun(TUE_EARLY)]]));
    const root = document.createElement('div');
    document.body.append(root);
    const off = mountScreen(ctx, root, () => {});
    await settle();
    emit(zg(9, 28, 7, 45) * 1000);
    await settle();
    expect(mini(root).dataset.view).toBe('reading');
    expect(mini(root).textContent).toContain('Rečenica 0.');
    expect(mini(root).querySelector('.sn-mini-clock')!.textContent).toBe('07:45');
    const node = mini(root).firstElementChild;
    emit(MON.fromSec * 1000);
    expect(mini(root).firstElementChild).toBe(node);
    off();
  });
  it('a run on its way shows the loading state; one that cannot load reads as between runs and is not asked for again', async () => {
    const { ctx, emit, requested } = page(new Map([[MON.id, screenRun(MON)]]));
    const root = document.createElement('div');
    document.body.append(root);
    const off = mountScreen(ctx, root, () => {});
    await settle();
    emit((TUE.fromSec + 30) * 1000);
    expect(mini(root).dataset.view).toBe('loading');
    expect(mini(root).getAttribute('aria-busy')).toBe('true');
    await settle();
    expect(mini(root).dataset.view).toBe('none');
    expect(mini(root).hasAttribute('aria-busy')).toBe(false);
    expect(mini(root).textContent).not.toContain('Rečenica');
    emit((TUE.fromSec + 50) * 1000);
    emit((TUE.fromSec + 70) * 1000);
    expect(requested.filter((p) => p === TUE.file.path).length).toBe(1);
    off();
  });
});

describe('Pet jutara u 07:45', () => {
  it('a five-row table: the day with its caption, the fleet against the normal day, the recorded sentence and today\'s', async () => {
    await withoutObserver(async () => {
      const wedRun = screenRun(WED, () => 'U pokretu su 3 vozila, po voznom redu oko 230.');
      const { ctx } = page(new Map([[MON.id, screenRun(MON, (i) => `Ponedjeljak ${i}.`)], [WED.id, wedRun]]));
      const root = document.createElement('div');
      document.body.append(root);
      const off = mountScreen(ctx, root, () => {});
      await settle();
      await settle();
      expect([...root.querySelectorAll('.sn-screen-table thead th')].map((th) => th.textContent)).toEqual(['Dan', 'U pokretu (običan dan)', 'Na zaslonu je pisalo', 'Po današnjim pravilima']);
      const rows = [...root.querySelectorAll<HTMLElement>('.sn-screen-table tbody tr')];
      expect(rows.map((r) => r.dataset.day)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
      expect(rows.map((r) => r.querySelector('th')!.textContent)).toEqual([
        'pon 28. 9.Zaslon najavljuje polaske po voznom redu kao da voze.', 'uto 29. 9.ZET-ovi podaci ne mijenjaju se; zaslon i dalje najavljuje polaske.',
        'sri 30. 9.Zaslon brojkama kaže koliko vozila nedostaje.', 'čet 1. 10.Uobičajeno jutro.', 'pet 2. 10.Opet uobičajeno jutro.',
      ]);
      expect(rows.map((r) => r.querySelector('.sn-screen-moving')!.textContent)).toEqual(['2 (321)', 'bez podatka (330)', '2 (330)', '380 (330)', '380 (330)']);
      const wrote = rows.map((r) => r.querySelector('[data-sn="morning-wrote"]')!);
      // Monday's run starts 11 s after 07:45: its first reading. Tuesday's run file is missing: not recorded.
      expect(wrote[0]!.querySelector('.sn-screen-said')!.textContent).toBe('Ponedjeljak 0.');
      expect(wrote[0]!.querySelector('a.sn-screen-photo')!.getAttribute('href')).toBe(`/api/snimka/v2/${MON.captures.kiosk!.path}`);
      expect(wrote[1]!.textContent).toBe('U ovoj minuti zaslon nije snimljen.');
      expect(wrote[2]!.querySelector('.sn-screen-said')!.textContent).toBe('U pokretu su 3 vozila, po voznom redu oko 230.');
      expect(wrote[4]!.textContent).toBe('U ovoj minuti zaslon nije snimljen.');
      const would = rows.map((r) => r.querySelector('[data-sn="morning-would"]')!.textContent);
      expect(would[0]).toBe('U pokretu su 2 vozila, po voznom redu oko 230.');
      expect(would[1]).toBe('Za ovu minutu nema izračunane rečenice.');
      off();
    });
  });
});
