// @vitest-environment happy-dom
// Zaslon (app/src/snimka/screen.ts): the reading shown is the latest at or
// before the clock in the run that covers it; between runs the board's next
// timetable departures, never padded; the capture is the nearest within six
// hours; the five mornings take the slot runs at 07:45; and on the page the
// miniature is rewritten only when the reading it shows changes, the source
// control follows the subtitle's source until the reader picks one, and every
// picture loads eagerly at low priority.
import { describe, expect, it } from 'vitest';
import { SNIMKA_WINDOW, ZAGREB_OFFSET_S, type BoardSeries, type HashedRef, type ScreenIndex, type ScreenRun, type VoiceFile, type VoiceIndex } from '../../shared/snimka';
import type { SnimkaContext } from '../../app/src/snimka/context';
import type { FrameLoop } from '../../app/src/snimka/frames';
import {
  RUN_LEAD_S, badgeOf, boardAt, boardHtml, captureHtml, mountScreen, nearestCapture, nextRunAfter, quartet, readingHtml, readingIndexAt, replayedHtml, routeKind, runAt, runShownAt, screenSourceAt, type IndexRun,
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
    const slots = quartet(INDEX, SNIMKA_WINDOW.fromSec, SNIMKA_WINDOW.toSec);
    expect(slots.map((s) => s.key)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
    expect(slots.map((s) => s.run?.id ?? null)).toEqual([MON.id, TUE.id, WED.id, THU.id, null]);
    expect(slots.map((s) => s.atSec)).toEqual([zg(9, 28, 7, 45), zg(9, 29, 7, 45), zg(9, 30, 7, 45), zg(10, 1, 7, 45), zg(10, 2, 7, 45)]);
  });
  it('a morning without a slot run stays empty rather than borrowing another hour', () => {
    const slots = quartet({ v: 1, runs: [MON, WED_NOON, WED_SERIES] }, SNIMKA_WINDOW.fromSec, SNIMKA_WINDOW.toSec);
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

describe('the capture beside the miniature', () => {
  it('is the run with a capture nearest the clock, within six hours', () => {
    expect(nearestCapture(INDEX, MON.fromSec + 60)?.id).toBe(MON.id);
    expect(nearestCapture(INDEX, zg(9, 28, 13, 0))?.id).toBe(MON.id);
    expect(nearestCapture(INDEX, zg(9, 28, 20, 0))).toBeNull();
    // The return runs have no capture: the nearest one with a capture is the noon slot, more than six hours away.
    expect(nearestCapture(INDEX, zg(9, 30, 20, 10))).toBeNull();
    expect(nearestCapture(INDEX, zg(9, 30, 17, 0))?.id).toBe(WED_NOON.id);
  });
  it('names the day and the time in its alt and caption', () => {
    const html = captureHtml('/api/snimka/v1/captures/x.webp', MON, null);
    expect(html).toContain('alt="Izgled zaslona, pon 28. 9. u 07:45"');
    expect(html).toContain('type="image/webp"');
    expect(html).toContain('<figcaption>Izgled zaslona, pon 28. 9. u 07:45</figcaption>');
    // Eager at low priority: a lazy picture below the fold was never fetched on 1 October.
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

describe('replayedHtml', () => {
  it('the sentence marked as today\'s rules, the rows with their badges and times', () => {
    const minute = VOICE_MON.minutes[465]!;
    const html = replayedHtml('Trg bana J. Jelačića', { file: VOICE_MON, minute, i: 465 });
    expect(html).toContain('data-kicker="replayed"');
    expect(html).toContain('<span class="sn-mini-kicker">izračun</span> <span class="sn-mini-text">U pokretu su 2 vozila, po voznom redu oko 230.</span>');
    expect(html).toContain('<span class="line" data-kind="tram" data-size="s">6</span>');
    expect(html).toContain('07:52');
    expect(html).toContain('Spomenik banu Josipu Jelačiću');
    expect(replayedHtml('x', { file: VOICE_MON, minute: { ...minute, lead: null }, i: 465 })).toContain('Za ovu minutu nema izračunane rečenice.');
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

const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); };

describe('mountScreen', () => {
  it('shows the reading, rewrites the miniature only when the reading changes, and prefetches the next run', async () => {
    const { ctx, emit, requested } = page(new Map([[MON.id, screenRun(MON)], [TUE_EARLY.id, screenRun(TUE_EARLY)]]));
    const root = document.createElement('div');
    root.setAttribute('aria-busy', 'true');
    document.body.append(root);
    let handed: ScreenIndex | null | undefined;
    const off = mountScreen(ctx, root, (ix) => { handed = ix; });
    await settle();
    expect(handed).toBe(INDEX);
    const mini = root.querySelector<HTMLElement>('.sn-mini')!;
    expect(mini.dataset.view).toBe('reading');
    expect(mini.textContent).toContain('Rečenica 0.');
    expect(root.querySelectorAll('.sn-mini .line').length).toBe(2);
    // The next run is fetched while this one shows.
    expect(requested).toContain(TUE_EARLY.file.path);
    // A frame inside the same reading leaves the miniature's nodes alone.
    const node = mini.firstElementChild;
    emit(MON.fromSec * 1000 + 15_000);
    expect(mini.firstElementChild).toBe(node);
    // The next reading replaces them.
    emit(MON.fromSec * 1000 + 21_000);
    expect(mini.firstElementChild).not.toBe(node);
    expect(mini.textContent).toContain('Rečenica 1.');
    // The capture and the quartet: four mornings, each with its picture or the word for none.
    expect(root.querySelector('.sn-capture img')?.getAttribute('alt')).toBe('Izgled zaslona, pon 28. 9. u 07:45');
    const items = root.querySelectorAll('.sn-quartet-item');
    expect(items.length).toBe(5);
    expect([...root.querySelectorAll('.sn-quartet-item img')].every((img) => (img.getAttribute('alt') ?? '').length > 0)).toBe(true);
    // Between runs, with an empty board: the note and the word for no departures (the record chosen; the default
    // there is today's rules, whose voice has no minute at 15:00).
    emit(zg(9, 28, 15, 0) * 1000);
    expect(root.dataset.snScreenSource).toBe('replayed');
    await settle();
    emit(zg(9, 28, 15, 0) * 1000 + 1000);
    expect(mini.textContent).toContain('Za ovu minutu nema izračunane rečenice.');
    root.querySelector<HTMLButtonElement>('[data-source="observed"]')!.click();
    expect(mini.dataset.view).toBe('none');
    expect(mini.textContent).toContain('U voznom redu nema sljedećih polazaka.');
    expect(root.querySelector('.sn-capture')?.textContent).toContain('Za ovo doba nema izgleda zaslona.');
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
    const mini = root.querySelector<HTMLElement>('.sn-mini')!;
    expect(mini.dataset.view).toBe('reading');
    expect(mini.textContent).toContain('Rečenica 0.');
    expect(mini.querySelector('.sn-mini-clock')!.textContent).toBe('07:45');
    // Reaching the first reading changes nothing on screen.
    const node = mini.firstElementChild;
    emit(MON.fromSec * 1000);
    expect(mini.firstElementChild).toBe(node);
    off();
  });
  it('the quartet\'s four pictures point at their own captures', async () => {
    const { ctx } = page(new Map([[MON.id, screenRun(MON)]]));
    const root = document.createElement('div');
    document.body.append(root);
    const off = mountScreen(ctx, root, () => {});
    await settle();
    const srcs = [...root.querySelectorAll('.sn-quartet-item img')].map((img) => img.getAttribute('src'));
    expect(srcs).toEqual([MON, TUE, WED, THU].map((r) => `/api/snimka/v2/${r.captures.kiosk!.path}`));
    off();
  });
  it('a run on its way shows the loading state; one that cannot load reads as between runs and is not asked for again', async () => {
    const { ctx, emit, requested } = page(new Map([[MON.id, screenRun(MON)]]));
    const root = document.createElement('div');
    document.body.append(root);
    const off = mountScreen(ctx, root, () => {});
    await settle();
    const mini = root.querySelector<HTMLElement>('.sn-mini')!;
    emit((TUE.fromSec + 30) * 1000);
    expect(mini.dataset.view).toBe('loading');
    expect(mini.getAttribute('aria-busy')).toBe('true');
    await settle();
    expect(mini.dataset.view).toBe('none');
    expect(mini.hasAttribute('aria-busy')).toBe(false);
    expect(mini.textContent).not.toContain('Rečenica');
    emit((TUE.fromSec + 50) * 1000);
    emit((TUE.fromSec + 70) * 1000);
    expect(requested.filter((p) => p === TUE.file.path).length).toBe(1);
    off();
  });
});

describe('the source control and the five mornings', () => {
  it('follows the subtitle\'s source until the reader picks one; the two sources show different rows', async () => {
    const { ctx, emit } = page(new Map([[MON.id, screenRun(MON)], [TUE_EARLY.id, screenRun(TUE_EARLY)]]));
    const root = document.createElement('div');
    document.body.append(root);
    const off = mountScreen(ctx, root, () => {});
    await settle();
    const control = root.querySelector('.sn-screen-source')!;
    expect(control.getAttribute('role')).toBe('group');
    expect(control.getAttribute('aria-label')).toBe('Izvor rečenice');
    const [observed, replayed] = [...root.querySelectorAll<HTMLButtonElement>('.sn-screen-source-option')];
    expect(observed!.textContent).toBe('Zapis');
    expect(replayed!.textContent).toBe('Današnja pravila');
    // Inside the Monday run: the record, pressed; the note about today's rules hidden.
    expect(root.dataset.snScreenSource).toBe('observed');
    expect(observed!.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector<HTMLElement>('.sn-screen-note')!.hidden).toBe(true);
    const mini = root.querySelector<HTMLElement>('.sn-mini')!;
    expect(mini.querySelectorAll('.sn-mini-row').length).toBe(3);
    // Before the run, the subtitle uses today's rules and so does the miniature (its voice loads first).
    emit(zg(9, 28, 7, 40) * 1000);
    await settle();
    emit(zg(9, 28, 7, 40) * 1000);
    expect(root.dataset.snScreenSource).toBe('replayed');
    expect(root.querySelector<HTMLElement>('.sn-screen-note')!.hidden).toBe(false);
    expect(mini.dataset.view).toBe('replayed');
    expect(mini.querySelectorAll('.sn-mini-row').length).toBe(2);
    expect(mini.textContent).toContain('U pokretu su 2 vozila');
    // The reader picks today's rules inside the run: the choice holds as the clock moves.
    emit((MON.fromSec + 60) * 1000);
    expect(root.dataset.snScreenSource).toBe('observed');
    replayed!.click();
    expect(root.dataset.snScreenSource).toBe('replayed');
    expect(replayed!.getAttribute('aria-pressed')).toBe('true');
    expect(mini.querySelectorAll('.sn-mini-row').length).toBe(2);
    emit((MON.fromSec + 120) * 1000);
    expect(root.dataset.snScreenSource).toBe('replayed');
    observed!.click();
    expect(mini.querySelectorAll('.sn-mini-row').length).toBe(3);
    off();
  });
  it('five mornings, each with its caption, its picture where one exists (eager, low priority) and today\'s sentence', async () => {
    const g = globalThis as { IntersectionObserver?: unknown };
    const saved = g.IntersectionObserver;
    delete g.IntersectionObserver;
    try {
      const { ctx } = page(new Map([[MON.id, screenRun(MON)]]));
      const root = document.createElement('div');
      document.body.append(root);
      const off = mountScreen(ctx, root, () => {});
      await settle();
      await settle();
      const items = [...root.querySelectorAll<HTMLElement>('.sn-quartet-item')];
      expect(items.map((li) => li.dataset.day)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
      expect(items.map((li) => li.querySelector('figcaption')!.textContent)).toEqual([
        'pon 28. 9. Polasci iz voznog reda, izrečeni kao činjenica.', 'uto 29. 9. Isto, dok se ZET-ovi podaci ne mijenjaju.', 'sri 30. 9. Odstupanje izrečeno brojkama.',
        'čet 1. 10. Uobičajeno jutro.', 'pet 2. 10. Drugo uobičajeno jutro.',
      ]);
      for (const img of root.querySelectorAll('.sn-quartet-item img')) {
        expect(img.getAttribute('loading')).toBe('eager');
        expect(img.getAttribute('fetchpriority')).toBe('low');
      }
      expect(items[4]!.querySelector('img')).toBeNull();
      expect(items[0]!.querySelector('.sn-screen-replayed')!.textContent).toBe('Po današnjim pravilima pisalo bi U pokretu su 2 vozila, po voznom redu oko 230.');
      // A morning whose day has no voice file says so in words.
      expect(items[1]!.querySelector('.sn-screen-replayed-text')!.textContent).toBe('Za ovu minutu nema izračunane rečenice.');
      off();
    } finally {
      if (saved !== undefined) g.IntersectionObserver = saved;
    }
  });
});
