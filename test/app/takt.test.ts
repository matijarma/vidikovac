// The reveal scheduler (shared/kiosk/takt.ts, reveal pass R2; docs/reveal-2026-10-plan/R2.md §0.2 is the rule text):
// the beat grid, page 1 by the static value, the quiet rule, the advance and page-turn cadences with their lead,
// row and imminence rules, the gap, freshness on page 2 only, the history and determinism.
import { describe, expect, it } from 'vitest';
import {
  ADVANCE_EVERY_BEATS, ADVANCE_LEAD_MS, beatIndex, candidateValue, EMPTY_HISTORY, FRESH_AFTER_MS, FRESH_MS, PAGE_EVERY_BEATS, PAGE_MAX_ROWS,
  REVEAL_EXEMPT_KINDS, REVEAL_GAP_BEATS, REVEAL_IMMINENT_MS, SOON_MS, takt, type TaktCandidate, type TaktHistory, type TaktKind, type TaktOptions,
} from '../../shared/kiosk/takt';

const MIN = 60_000;
const RHYTHM = 20_000;
/** Wednesday 30 September 2026, 12:00 Zagreb (CEST), moved onto a beat with b % 12 === 0 so both cadences are eligible. */
const B0 = Math.floor(Date.parse('2026-09-30T12:00:00+02:00') / RHYTHM / 12) * 12;
const at = (b: number): number => b * RHYTHM;
const NOW = at(B0);

function c(id: string, kind: TaktKind, over: { at?: number; until?: number; reserved?: boolean; imminent?: boolean } = {}): TaktCandidate {
  return {
    id, kind,
    ...(over.at !== undefined ? { atMs: over.at } : {}),
    ...(over.until !== undefined ? { untilMs: over.until } : {}),
    reserved: over.reserved ?? false,
    imminent: over.imminent ?? (over.at !== undefined && over.at - NOW <= REVEAL_IMMINENT_MS),
  };
}
const options = (over: Partial<TaktOptions> = {}): TaktOptions => ({ capacity: 7, rhythmMs: RHYTHM, quiet: false, reduced: false, ...over });

/** A midday wall: the line, the notice, the trams' promises, one timeless row, and the discretionary rows by value. */
function wall(now = NOW): TaktCandidate[] {
  return [
    c('departures', 'departures', { at: now + 5 * MIN, reserved: true }),
    c('notice:zet:1', 'notice', { reserved: true }),
    c('closure:ilica', 'closure', { until: now + 4 * 3_600_000 }),
    c('rail:hz:1215', 'rail', { at: now + 20 * MIN }),
    c('event:a', 'event', { at: now + 3 * 3_600_000 }),
    c('event:b', 'event', { at: now + 60 * MIN }),
    c('opening:m', 'opening', { at: now + 3 * 3_600_000 }),
    c('solar:sunset:2026-09-30', 'solar', { at: now + 5 * 3_600_000 }),
    c('opennow:p', 'open', { until: now + 2 * 3_600_000 }),
    c('first:2026-10-01', 'first', { at: now + 16 * 3_600_000, reserved: true }),
    c('last:2026-09-30', 'last', { at: now + 12 * 3_600_000, reserved: true }),
    c('always:heritage:x', 'always', { reserved: true }),
    c('always:story:y', 'always'),
  ];
}
const nexts = (now = NOW): TaktCandidate[] => [1, 2, 3].map((n) => c(`dep:n${n}`, 'next-departures', { at: now + (5 + 4 * n) * MIN }));
const still = (x: TaktCandidate, now = NOW): number => candidateValue(x, now, null);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

describe('beatIndex: the absolute grid of the epoch', () => {
  it('floors the instant onto the rhythm and returns -1 off the grid', () => {
    expect(beatIndex(20_000 * 7 + 19_999, 20_000)).toBe(7);
    expect(beatIndex(20_000 * 8, 20_000)).toBe(8);
    expect(beatIndex(20_000 * 8, 0)).toBe(-1);
    expect(beatIndex(20_000 * 8, -20_000)).toBe(-1);
    expect(beatIndex(20_000 * 8, Number.NaN)).toBe(-1);
    expect(beatIndex(Number.NaN, 20_000)).toBe(-1);
    expect(beatIndex(Number.POSITIVE_INFINITY, 20_000)).toBe(-1);
  });
  it('the constants are the brief §3 numbers, one number each', () => {
    expect([ADVANCE_EVERY_BEATS, PAGE_EVERY_BEATS, REVEAL_GAP_BEATS, PAGE_MAX_ROWS]).toEqual([4, 3, 3, 2]);
    expect(ADVANCE_LEAD_MS).toBe(600_000);
    expect(REVEAL_IMMINENT_MS).toBe(1_800_000);
    expect(REVEAL_IMMINENT_MS).toBe(SOON_MS);
    expect(FRESH_MS).toBe(600_000);
    expect(FRESH_MS).toBe(FRESH_AFTER_MS);
    expect(REVEAL_EXEMPT_KINDS).toEqual(['closure']);
  });
});

describe('page 1 by the static value', () => {
  it('holds every reserved candidate, then the most valuable of the rest, in candidate order', () => {
    const rows = wall();
    const { page1 } = takt(rows, EMPTY_HISTORY, NOW, options({ capacity: 7 }));
    const reserved = rows.filter((x) => x.reserved).map((x) => x.id);
    for (const id of reserved) expect(page1).toContain(id);
    const rest = rows.filter((x) => !x.reserved).sort((x, y) => still(y) - still(x) || rows.indexOf(x) - rows.indexOf(y));
    expect(rest.slice(0, 2).map((x) => x.id)).toEqual(['closure:ilica', 'rail:hz:1215']);
    expect(page1).toEqual(rows.filter((x) => x.reserved || x.id === 'closure:ilica' || x.id === 'rail:hz:1215').map((x) => x.id));
    expect(page1).toHaveLength(7);
  });
  it('breaks a value tie by candidate order', () => {
    const rows = [c('departures', 'departures', { at: NOW + 5 * MIN, reserved: true }), c('event:late', 'event', { at: NOW + 3 * 3_600_000 }), c('event:early', 'event', { at: NOW + 3 * 3_600_000 })];
    expect(still(rows[1]!)).toBe(still(rows[2]!));
    expect(takt(rows, EMPTY_HISTORY, NOW, options({ capacity: 2 })).page1).toEqual(['departures', 'event:late']);
    expect(takt([rows[0]!, rows[2]!, rows[1]!], EMPTY_HISTORY, NOW, options({ capacity: 2 })).page1).toEqual(['departures', 'event:early']);
  });
  it('a capacity under the reserved count gives the reserved only; a fractional or non-finite capacity floors to the rows', () => {
    const rows = wall();
    const reserved = rows.filter((x) => x.reserved).map((x) => x.id);
    expect(takt(rows, EMPTY_HISTORY, NOW, options({ capacity: 3 })).page1).toEqual(reserved);
    expect(takt(rows, EMPTY_HISTORY, NOW, options({ capacity: 0 })).page1).toEqual(reserved);
    expect(takt(rows, EMPTY_HISTORY, NOW, options({ capacity: 6.9 })).page1).toHaveLength(6);
    expect(takt(rows, EMPTY_HISTORY, NOW, options({ capacity: Number.NaN })).page1).toEqual(reserved);
  });
  it('never puts a next-departures candidate on page 1, whatever the capacity', () => {
    const rows = [...wall(), ...nexts()];
    const { page1 } = takt(rows, EMPTY_HISTORY, NOW, options({ capacity: 100 }));
    expect(page1).toHaveLength(wall().length);
    expect(page1.some((id) => id.startsWith('dep:n'))).toBe(false);
  });
  it('freshness never changes page 1: shown and unshown ids give the same page 1 as an empty history', () => {
    const rows = wall();
    const history: TaktHistory = { beat: B0 - 1, shownAt: { 'closure:ilica': NOW, 'rail:hz:1215': NOW, 'event:b': NOW - 11 * MIN }, lastReveal: null };
    expect(takt(rows, history, NOW, options()).page1).toEqual(takt(rows, EMPTY_HISTORY, NOW, options()).page1);
  });
});

describe('quiet', () => {
  it('returns page 1 and no reveal, keeps the beat and the last reveal, and still records page 1 as shown', () => {
    const rows = [...wall().map((x) => (x.id === 'departures' ? c('departures', 'departures', { at: NOW + 30 * MIN, reserved: true }) : x)), ...nexts()];
    const last = { kind: 'page' as const, beat: B0 - 10 };
    for (const b of [B0 + 3, B0 + 4]) {
      const loud = takt(rows, { ...EMPTY_HISTORY, lastReveal: last }, at(b), options({ capacity: 9, quiet: false }));
      expect(loud.reveal?.kind).toBe(b === B0 + 3 ? 'page' : 'advance');
      const quiet = takt(rows, { ...EMPTY_HISTORY, lastReveal: last }, at(b), options({ capacity: 9, quiet: true }));
      expect(quiet.reveal).toBeNull();
      expect(quiet.page1).toEqual(loud.page1);
      expect(quiet.history.beat).toBe(b);
      expect(quiet.history.lastReveal).toEqual(last);
      for (const id of quiet.page1) expect(quiet.history.shownAt[id]).toBe(at(b));
    }
  });
});

describe('the advance: one beat in four, only while the first shown departure is more than 10 min away', () => {
  const lineAt = (lead: number, now: number): TaktCandidate[] => [
    ...wall(now).map((x) => (x.id === 'departures' ? c('departures', 'departures', { at: now + lead, reserved: true }) : x)),
    ...nexts(now),
  ];
  it('advances on b % 4 === 0 with the three next ids in order, replacing the line', () => {
    const now = at(B0 + 4);
    const r = takt(lineAt(ADVANCE_LEAD_MS + 1, now), EMPTY_HISTORY, now, options());
    expect(r.reveal).toEqual({ kind: 'advance', ids: ['dep:n1', 'dep:n2', 'dep:n3'], replaces: ['departures'], beat: B0 + 4 });
    expect(r.history.lastReveal).toEqual({ kind: 'advance', beat: B0 + 4 });
  });
  it('does not advance at exactly 10 min, off its beat, or without next departures', () => {
    const now = at(B0 + 4);
    expect(takt(lineAt(ADVANCE_LEAD_MS, now), EMPTY_HISTORY, now, options()).reveal).toBeNull();
    const off = at(B0 + 5);
    expect(takt(lineAt(ADVANCE_LEAD_MS + 1, off), EMPTY_HISTORY, off, options()).reveal).toBeNull();
    expect(takt(lineAt(ADVANCE_LEAD_MS + 1, now).filter((x) => x.kind !== 'next-departures'), EMPTY_HISTORY, now, options()).reveal).toBeNull();
  });
  it('wins over a page turn on b % 12 === 0, and at exactly 10 min the page turn takes that beat', () => {
    const rows = lineAt(ADVANCE_LEAD_MS + 1, NOW);
    expect(takt(rows, EMPTY_HISTORY, NOW, options({ capacity: 9 })).reveal?.kind).toBe('advance');
    expect(takt(lineAt(ADVANCE_LEAD_MS, NOW), EMPTY_HISTORY, NOW, options({ capacity: 9 })).reveal?.kind).toBe('page');
  });
});

describe('the page turn: one beat in three, at most two rows, never a reserved, imminent or closure row', () => {
  const B3 = B0 + 3;
  it('replaces the two lowest-value non-reserved page-1 rows, lowest first, with the top two of page 2 by freshness', () => {
    const rows = wall();
    const r = takt(rows, EMPTY_HISTORY, at(B3), options({ capacity: 9 }));
    // Page 1: the 5 reserved plus closure 72, rail 60, event:b 57.6 (0.8 within 2 h), event:a and opening at 0.5: 36, 18 → the first four by value.
    expect(r.page1).toEqual(['departures', 'notice:zet:1', 'closure:ilica', 'rail:hz:1215', 'event:a', 'event:b', 'first:2026-10-01', 'last:2026-09-30', 'always:heritage:x']);
    // Replaceable on page 1: event:a (36) and event:b (57.6); the rail is imminent, the closure exempt, the rest reserved.
    expect(r.reveal).toEqual({ kind: 'page', ids: ['opennow:p', 'opening:m'], replaces: ['event:a', 'event:b'], beat: B3 });
  });
  it('never puts an imminent row in replaces, even when it is the lowest', () => {
    const rows = wall().map((x) => (x.id === 'event:a' ? { ...x, imminent: true } : x));
    const r = takt(rows, EMPTY_HISTORY, at(B3), options({ capacity: 9 }));
    expect(r.reveal?.replaces).toEqual(['event:b']);
    expect(r.reveal?.ids).toEqual(['opennow:p']);
  });
  it('never replaces a reserved row (the line, the notice, first, last, the first timeless) nor a closure, and never reveals a closure', () => {
    // Rain within the hour (70 × 1 × 1.2 = 84) outranks both closures (72 each); capacity 7 leaves the second closure on page 2.
    const rows = [...wall(), c('closure:gunduliceva', 'closure', { until: NOW + 6 * 3_600_000 }), c('rain:dhmz:1240', 'rain', { at: NOW + 40 * MIN })];
    const r = takt(rows, EMPTY_HISTORY, at(B3), options({ capacity: 7 }));
    expect(r.page1).toContain('closure:ilica');
    expect(r.page1).toContain('rain:dhmz:1240');
    expect(r.page1).not.toContain('closure:gunduliceva');
    const reveal = r.reveal!;
    expect(reveal.kind).toBe('page');
    expect(reveal.replaces).toEqual(['rain:dhmz:1240']);
    expect(reveal.ids).toEqual(['rail:hz:1215']);
    for (const id of ['departures', 'notice:zet:1', 'first:2026-10-01', 'last:2026-09-30', 'always:heritage:x', 'closure:ilica']) expect(reveal.replaces).not.toContain(id);
    expect(reveal.ids).not.toContain('closure:gunduliceva');
    expect(reveal.replaces.length).toBeLessThanOrEqual(PAGE_MAX_ROWS);
  });
  it('ranks page 2 by candidateValue with the history, replaces one row for one page-2 candidate, and none without one', () => {
    const rows = wall();
    const history: TaktHistory = { beat: B3 - 1, shownAt: { 'opennow:p': NOW }, lastReveal: null };
    const r = takt(rows, history, at(B3), options({ capacity: 9 }));
    // opening:m fresh 18 (×1.2) against opennow:p shown now, 30: the open row still leads; both are the page.
    expect(r.reveal?.ids).toEqual(['opennow:p', 'opening:m']);
    const one = takt(rows.filter((x) => x.id !== 'opening:m' && x.id !== 'solar:sunset:2026-09-30' && x.id !== 'always:story:y'), EMPTY_HISTORY, at(B3), options({ capacity: 9 }));
    expect(one.reveal).toEqual({ kind: 'page', ids: ['opennow:p'], replaces: ['event:a'], beat: B3 });
    const none = takt(wall(), EMPTY_HISTORY, at(B3), options({ capacity: 20 }));
    expect(none.reveal).toBeNull();
  });
  it('turns no page when no page-1 row may move, and none off its beat', () => {
    const reservedOnly = wall().filter((x) => x.reserved || x.kind === 'closure' || x.id === 'always:story:y');
    expect(takt(reservedOnly, EMPTY_HISTORY, at(B3), options({ capacity: 6 })).reveal).toBeNull();
    expect(takt(wall(), EMPTY_HISTORY, at(B0 + 1), options({ capacity: 9 })).reveal).toBeNull();
    expect(takt(wall(), EMPTY_HISTORY, at(B0 + 2), options({ capacity: 9 })).reveal).toBeNull();
  });
});

describe('the gap: nothing starts within REVEAL_GAP_BEATS of the last reveal', () => {
  it('a reveal on b gives none on b + 1 and b + 2 where the cadence allows, and may on b + 3', () => {
    const rows = [...wall().map((x) => (x.id === 'departures' ? c('departures', 'departures', { at: NOW + 30 * MIN, reserved: true }) : x)), ...nexts()];
    let history = takt(rows, EMPTY_HISTORY, at(B0), options({ capacity: 9 })).history;
    expect(history.lastReveal).toEqual({ kind: 'advance', beat: B0 });
    // B0 + 1: no cadence; B0 + 2: none; B0 + 3 is a page beat and the gap is met.
    for (const b of [B0 + 1, B0 + 2]) {
      const r = takt(rows, history, at(b), options({ capacity: 9 }));
      expect(r.reveal).toBeNull();
      history = r.history;
    }
    const third = takt(rows, history, at(B0 + 3), options({ capacity: 9 }));
    expect(third.reveal?.kind).toBe('page');
    // From a page turn on a beat with b % 3 === 0, b + 1 and b + 2 carry none even where b + 1 is an advance beat.
    let h2: TaktHistory = { ...EMPTY_HISTORY, lastReveal: { kind: 'page', beat: B0 + 3 } };
    expect(takt(rows, h2, at(B0 + 4), options({ capacity: 9 })).reveal).toBeNull();
    h2 = takt(rows, h2, at(B0 + 4), options({ capacity: 9 })).history;
    expect(takt(rows, h2, at(B0 + 5), options({ capacity: 9 })).reveal).toBeNull();
    expect(takt(rows, h2, at(B0 + 6), options({ capacity: 9 })).reveal).not.toBeNull();
    expect(takt(rows, { ...EMPTY_HISTORY, lastReveal: { kind: 'page', beat: B0 + 5 } }, at(B0 + 8), options({ capacity: 9 })).reveal?.kind).toBe('advance');
    expect(takt(rows, { ...EMPTY_HISTORY, lastReveal: { kind: 'page', beat: B0 + 6 } }, at(B0 + 8), options({ capacity: 9 })).reveal).toBeNull();
  });
  it('the cadence over twelve beats: advance at 0, page at 3, 6, 9, advance at 12', () => {
    const rows = [...wall().map((x) => (x.id === 'departures' ? c('departures', 'departures', { at: NOW + 60 * MIN, reserved: true }) : x)), ...nexts()];
    let history = EMPTY_HISTORY;
    const beats: string[] = [];
    for (let b = B0; b <= B0 + 12; b++) {
      const r = takt(rows, history, at(b), options({ capacity: 9 }));
      if (r.reveal) beats.push(`${b - B0}:${r.reveal.kind}`);
      history = r.history;
    }
    expect(beats).toEqual(['0:advance', '3:page', '6:page', '9:page', '12:advance']);
  });
});

describe('freshness ranks page 2 only', () => {
  const B3 = B0 + 3;
  const base = (): TaktCandidate[] => [
    c('departures', 'departures', { at: NOW + 5 * MIN, reserved: true }),
    c('event:shown', 'event', { at: NOW + 3 * 3_600_000 }),
    c('event:new', 'event', { at: NOW + 3 * 3_600_000 }),
    c('solar:s', 'solar', { at: NOW + 5 * 3_600_000 }),
  ];
  it('between two page-2 rows of equal static value the one shown 5 min ago loses to the one never shown', () => {
    const rows = base();
    const history: TaktHistory = { beat: B3 - 1, shownAt: { 'event:shown': NOW - 5 * MIN }, lastReveal: null };
    const r = takt(rows, history, at(B3), options({ capacity: 2 }));
    expect(r.page1).toEqual(['departures', 'event:shown']);
    expect(r.reveal?.ids).toEqual(['event:new']);
    // Capacity 2 keeps event:shown on page 1 by candidate order; make the solar row the page-1 filler instead.
    const rows2 = [rows[0]!, rows[3]!, rows[1]!, rows[2]!].map((x) => (x.id === 'solar:s' ? { ...x, reserved: true } : x));
    const r2 = takt(rows2, history, at(B3), options({ capacity: 2 }));
    expect(r2.page1).toEqual(['departures', 'solar:s']);
    expect(r2.reveal).toBeNull();
  });
  it('an equal-value pair both shown over 10 min ago reads ×1.2 alike and candidate order decides; the boundary is R0\'s', () => {
    const rows = [c('departures', 'departures', { at: NOW + 5 * MIN, reserved: true }), c('event:x', 'event', { at: NOW + 3 * 3_600_000 }),
      c('event:p', 'event', { at: NOW + 3 * 3_600_000 }), c('event:q', 'event', { at: NOW + 3 * 3_600_000 })];
    const T3 = at(B3);
    const old: TaktHistory = { beat: B3 - 1, shownAt: { 'event:p': T3 - 600_001, 'event:q': T3 - 600_001 }, lastReveal: null };
    expect(takt(rows, old, T3, options({ capacity: 2 })).reveal?.ids).toEqual(['event:p']);
    const swapped = [rows[0]!, rows[1]!, rows[3]!, rows[2]!];
    expect(takt(swapped, old, T3, options({ capacity: 2 })).reveal?.ids).toEqual(['event:q']);
    const pFresh: TaktHistory = { beat: B3 - 1, shownAt: { 'event:p': T3 - 599_999, 'event:q': T3 - 600_001 }, lastReveal: null };
    expect(takt(rows, pFresh, T3, options({ capacity: 2 })).reveal?.ids).toEqual(['event:q']);
    expect(candidateValue(rows[2]!, T3, pFresh)).toBe(candidateValue(rows[2]!, T3, null) / 1.2);
    expect(candidateValue(rows[3]!, T3, pFresh)).toBe(candidateValue(rows[3]!, T3, null));
    const edge: TaktHistory = { beat: B3 - 1, shownAt: { 'event:p': T3 - 600_000 }, lastReveal: null };
    expect(candidateValue(rows[2]!, T3, edge)).toBe(candidateValue(rows[2]!, T3, null) / 1.2);
  });
});

describe('the history', () => {
  it('records every page-1 and revealed id at now, prunes stale and future entries, sorts the keys, and never mutates its inputs', () => {
    const rows = deepFreeze([...wall(), ...nexts()]);
    const T3 = at(B0 + 3);
    const history = deepFreeze<TaktHistory>({ beat: B0 - 7, shownAt: { 'zzz:old': T3 - FRESH_MS - 1, 'aaa:kept': T3 - FRESH_MS, 'mmm:future': T3 + 1 }, lastReveal: { kind: 'page', beat: B0 - 7 } });
    const r = takt(rows, history, T3, options({ capacity: 9 }));
    expect(r.reveal?.kind).toBe('page');
    const keys = Object.keys(r.history.shownAt);
    expect(keys).toEqual([...keys].sort());
    expect(r.history.shownAt['zzz:old']).toBeUndefined();
    expect(r.history.shownAt['mmm:future']).toBeUndefined();
    expect(r.history.shownAt['aaa:kept']).toBe(T3 - FRESH_MS);
    for (const id of [...r.page1, ...r.reveal!.ids]) expect(r.history.shownAt[id]).toBe(T3);
    expect(r.history.beat).toBe(B0 + 3);
    expect(r.history.lastReveal).toEqual({ kind: 'page', beat: B0 + 3 });
    expect(history).toEqual({ beat: B0 - 7, shownAt: { 'zzz:old': T3 - FRESH_MS - 1, 'aaa:kept': T3 - FRESH_MS, 'mmm:future': T3 + 1 }, lastReveal: { kind: 'page', beat: B0 - 7 } });
    const quiet = takt(rows, history, at(B0 + 1), options({ capacity: 9 }));
    expect(quiet.reveal).toBeNull();
    expect(quiet.history.lastReveal).toEqual({ kind: 'page', beat: B0 - 7 });
    expect(quiet.history).not.toBe(history);
  });
});

describe('determinism', () => {
  it('the same inputs twice give deep-equal results, and reduced changes nothing', () => {
    const rows = [...wall(), ...nexts()];
    const history: TaktHistory = { beat: B0 - 5, shownAt: { 'event:b': NOW - 3 * MIN }, lastReveal: { kind: 'page', beat: B0 - 5 } };
    const a = takt(rows, history, at(B0 + 3), options({ capacity: 8, reduced: false }));
    const b = takt(rows, history, at(B0 + 3), options({ capacity: 8, reduced: false }));
    expect(a).toStrictEqual(b);
    expect(takt(rows, history, at(B0 + 3), options({ capacity: 8, reduced: true }))).toStrictEqual(a);
    const adv = takt(rows.map((x) => (x.id === 'departures' ? c('departures', 'departures', { at: NOW + 30 * MIN, reserved: true }) : x)), EMPTY_HISTORY, at(B0 + 4), options({ capacity: 8, reduced: true }));
    expect(adv).toStrictEqual(takt(rows.map((x) => (x.id === 'departures' ? c('departures', 'departures', { at: NOW + 30 * MIN, reserved: true }) : x)), EMPTY_HISTORY, at(B0 + 4), options({ capacity: 8, reduced: false })));
  });
});
