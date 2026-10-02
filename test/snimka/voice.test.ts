// The voice stage's engine (scripts/snimka/voice-engine.ts) on the committed
// wall fixture of Mon 28 Sep 2026 07:45 (test/fixtures/wall/2026-09-28-0745/):
// the minute through the builder yields the facts test/app/service-voice.test.ts
// expects of the wall itself, a frozen header reads `unconfirmed`, and a day's
// dictionaries hold each fact, row and sentence once.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalPlaces } from '../../shared/city/events';
import { placeFromStop } from '../../shared/city/place';
import type { ZetService } from '../../shared/city/service-wire';
import { emptyCity, type CityState, type DepartureBoard, type Place } from '../../shared/city/types';
import type { ScreenStop } from '../../app/src/core/contracts';
import type { ModuleSnapshot } from '../../worker/feed/schema';
import { createVoiceEngine } from '../../scripts/snimka/voice-engine';
import { DayBuilder, voiceDays } from '../../scripts/snimka/stage-voice';
import { SNIMKA_WINDOW } from '../../shared/snimka';

const ROOT = join(import.meta.dirname, '../fixtures/wall/2026-09-28-0745');
const read = <T>(file: string): T => JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as T;
const NOW = Date.parse('2026-09-28T05:47:00Z');
const stops = read<ScreenStop[]>('stops.json');
const city = { ...emptyCity(), places: canonicalPlaces(read<Place[]>('places.json')) } as CityState;
const boards = ['106_1', '106_2'].map((id) => `boards/${id}.json`).filter((file) => existsSync(join(ROOT, file))).map((file) => read<DepartureBoard>(file));
const recorded = read<{ modules: ModuleSnapshot[] }>('teaser.json').modules;
const place = placeFromStop(stops.find((stop) => stop.id === '106_1')!, (route) => Number(route) < 100);
const TIMETABLE = ['departureIn', 'departureAt', 'busIn', 'busAt', 'lastTram', 'firstTram'];

function withService(service: Partial<ZetService> | undefined): ModuleSnapshot[] {
  return recorded.map((m) => m.module !== 'zet-rt' || !service ? m : { ...m, sources: { ...m.sources, zet: { ...m.sources!.zet!, service: {
    state: 'silent', since: '2026-09-28T05:40:54Z', observedAt: '2026-09-28T05:46:58Z', expected: 460, seen: 2, ratio: 0, confidence: 1, baseline: 'declared',
    byMode: { tram: [0, 140], bus: [2, 320] }, ...service } as ZetService } } });
}
const engine = () => createVoiceEngine({ place, stops, city });

describe('the voice engine on the wall fixture of Mon 28 Sep 07:45', () => {
  it('as recorded: timetable departures among the facts, no service fact, and the same answer twice', () => {
    const a = engine().step(recorded, boards, NOW);
    const b = engine().step(recorded, boards, NOW);
    expect(a.rows.filter((r) => r.kind === 'departure').length).toBeGreaterThanOrEqual(2);
    expect(a.facts.filter((f) => TIMETABLE.includes(f.wording ?? '')).length).toBeGreaterThan(0);
    expect(a.facts.some((f) => f.id === 'service:zet')).toBe(false);
    expect(b.facts.map((f) => [f.id, f.text])).toEqual(a.facts.map((f) => [f.id, f.text]));
    expect(b.lead?.text).toBe(a.lead?.text);
    expect(a.lead).not.toBeNull();
  });

  it('silent: the deviation first with its numbers, no departure fact, voice none', () => {
    const s = engine().step(withService({}), boards, NOW);
    expect(s.state).toBe('silent');
    expect(s.voice).toBe('none');
    expect(s.facts[0]!.id).toBe('service:zet');
    expect(s.facts.filter((f) => f.id === 'service:zet').map((f) => f.text)).toEqual(['ZET: u pokretu 2 vozila, po voznom redu oko 460.']);
    expect(s.facts.some((f) => f.id.startsWith('dep:'))).toBe(false);
    // The lead is the sentence on screen after the minute's three 20-second turns: one of the facts' own sentences.
    expect(s.facts.map((f) => f.text)).toContain(s.lead?.text);
    expect(s.facts.map((f) => f.text).join(' ')).not.toMatch(/štrajk|strike/iu);
  });

  it('a payload held through a gap reads unconfirmed once its header is over three minutes old, and no fix times a row', () => {
    const e = engine();
    e.step(withService({ state: 'normal', seen: 380, expected: 450 }), boards, NOW);
    const later = e.step(withService({ state: 'normal', seen: 380, expected: 450 }), boards, NOW + 5 * 60_000);
    expect(later.state).toBe('unconfirmed');
    expect(later.voice).toBe('none');
    expect(later.rows.filter((r) => r.live)).toEqual([]);
  });
});

describe('the voice day files', () => {
  it('splits the window into Zagreb days: Sun 240, Mon to Thu 1,440, Fri 720', () => {
    const days = voiceDays(SNIMKA_WINDOW.fromSec, SNIMKA_WINDOW.minutes);
    expect(days.map((d) => [d.day, d.n])).toEqual([['2026-09-27', 240], ['2026-09-28', 1440], ['2026-09-29', 1440], ['2026-09-30', 1440], ['2026-10-01', 1440], ['2026-10-02', 720]]);
    expect(days.reduce((s, d) => s + d.n, 0)).toBe(SNIMKA_WINDOW.minutes);
  });

  it('keeps each fact, row and sentence once and the minutes as indices; an unwritten minute stays null', () => {
    const e = engine();
    const day = new DayBuilder('2026-09-28', Math.floor(NOW / 1000) - 120, 3);
    const one = e.step(recorded, boards, NOW);
    const two = e.step(recorded, boards, NOW + 60_000);
    day.put(0, Math.floor(NOW / 1000), one, { seen: 2, expected: 460 });
    day.put(1, Math.floor(NOW / 1000) + 60, two, { seen: null, expected: null });
    const file = day.file('106_1');
    expect(new Set(file.facts.map((f) => JSON.stringify(f))).size).toBe(file.facts.length);
    expect(new Set(file.rows.map((r) => JSON.stringify(r))).size).toBe(file.rows.length);
    expect(new Set(file.sentences).size).toBe(file.sentences.length);
    expect(file.minutes[0]!.f.map((i) => file.facts[i]!.id)).toEqual(one.facts.map((f) => f.id));
    expect(file.minutes[0]!.seen).toBe(2);
    expect(file.minutes[1]!.seen).toBeNull();
    expect(file.minutes[2]).toBeNull();
    expect(file.rows.every((r) => !('whenText' in r) && (r.atSec === null || Number.isInteger(r.atSec)))).toBe(true);
  });
});
