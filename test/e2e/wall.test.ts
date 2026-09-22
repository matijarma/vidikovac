// The wall instruments have one source each: e2e/wall.ts (one reading, the
// ten-minute rotation and its summary), e2e/recorders.ts (console, page errors,
// failed requests, HTTP >= 400, data status), e2e/scenes.ts (the eight
// fake-clock scenes), e2e/departures-fixture.ts (the board and the last-run
// file every scene reads) and the `{ now }` / `{ departures, lastRun }` options
// of e2e/experience-fixtures.ts and e2e/city-fixtures.ts. This file holds their
// numbers without a browser: page access is faked, the page-side reading runs
// in happy-dom from its own text, the fixtures are cross-checked against the
// app's own last-run loader and the shared arrivals join.
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import {
  DEPARTURES_MAX, DISTINCT_SENTENCES_MIN, LEAD_TEXT, NEARBY_HEAD_2KM, NEARBY_HEAD_RE, QR_MIN_PX, ROTATION_STEPS, ROTATION_STEP_MS,
  SENTENCE_MAX_CHARS, SETTINGS_HOLD_MS, WALL_PROBES, WALL_SAMPLE_IN_PAGE, WALL_SAMPLE_SPEC, rotationFailures, sampleFailures,
  sampleRotation, summariseRotation, wallSample, type RotationRow, type WallPage, type WallRow, type WallSample,
} from '../../e2e/wall';
import { TILE_REQUESTS, attachRecorders, pathOf, summariseBody, type RecorderPage } from '../../e2e/recorders';
import { PORTRAIT_SCENES, SCENES, SCENE_IDS } from '../../e2e/scenes';
import {
  FIXTURE_FIRST_TRAM, FIXTURE_LAST_DEPARTURES, departuresBoard, gtfsSeconds, lastRunSnapshot, serviceDays, trackedTrips,
} from '../../e2e/departures-fixture';
import { FIXTURE_STOP, experienceSnapshots, installKioskFeedFixture } from '../../e2e/experience-fixtures';
import { installCityFixture } from '../../e2e/city-fixtures';
import { scheduleInstant } from '../../worker/city/schedules';
import { arrivalsAt, type LiveVehicleRef } from '../../shared/city/arrivals';
import { lastDeparture, loadLastRun } from '../../app/src/core/lastrun';
import { isDaylight, sunTimes } from '../../app/src/ui/solar';
import { FIXTURE_NOW } from '../feed/fixture-contexts';

const MIN = 60_000;
const iso = (ms: number): string => new Date(ms).toISOString();

// --- helpers ---------------------------------------------------------------------------------
function row(over: Partial<WallRow>): WallRow {
  return { id: null, kind: 'departure', when: null, always: false, live: false, source: 'zet', title: '', whenText: '', sub: '', hasTime: true, text: '', caveat: false, ...over };
}
function sample(over: Partial<WallSample> = {}): WallSample {
  const rows = over.rows ?? [row({ id: 'trip-1', when: '2026-09-21T15:47:00.000Z', title: '6 Sopot', whenText: '2 min', text: '6 Sopot 2 min' })];
  return {
    at: Date.UTC(2026, 8, 21, 15, 45), place: 'Kvaternikov trg', sentence: 'Tramvaj 6 kreće za dvije minute.', kicker: 'promet', kickerText: 'Promet',
    validUntil: '2026-09-21T15:45:20.000Z', sentenceChars: 32, sentenceOverflow: false, sentenceEllipsis: false, head: NEARBY_HEAD_2KM,
    departures: rows.filter((r) => r.kind === 'departure').length, solarRows: rows.filter((r) => r.kind === 'solar').length, liveRows: rows.filter((r) => r.live).length,
    pills: '6|12|17', bodies: 41, zoom: '14.20', feed: 'live', mapStatus: 'ready', unlabelled: 0, markers: 12, frame: '6', mapNotes: 0,
    theme: 'light', code: 'ABCD·EFGH', codeState: 'live', qr: { w: 240, h: 240 }, lead: LEAD_TEXT, strip: 'Mirno · DHMZ · EMSC', stripHasClock: false,
    pharmacy: '24/7 Ilica 1', pharmacySymbols: 1, controls: 0, controlNames: [], retiredChrome: 0, settingsOpen: false, stopBoardOpen: false,
    ...over,
    rows,
  };
}
const rect = (w: number, h: number): DOMRect => ({ x: 0, y: 0, left: 0, top: 0, right: w, bottom: h, width: w, height: h, toJSON: () => ({}) }) as DOMRect;

// --- the probe contract and the numbers --------------------------------------------------------
describe('the wall probes and numbers', () => {
  it('reads the §15.6 names: kiosk-context for the place, the sentence with its kicker and text, the timeline, the map, kiosk-code', () => {
    expect(WALL_PROBES.place).toBe('[data-testid=kiosk-context]');
    expect(WALL_PROBES.sentence).toBe('[data-testid=kiosk-sentence]');
    expect(WALL_PROBES.sentenceKicker).toBe('[data-testid=kiosk-sentence-kicker]');
    expect(WALL_PROBES.sentenceText).toBe('[data-testid=kiosk-sentence-text]');
    expect(WALL_PROBES.row).toBe('[data-testid=nearby] .nearby-row');
    expect(WALL_PROBES.map).toBe('[data-testid=kiosk-map]');
    expect(WALL_PROBES.mapNote).toBe('[data-testid=map-note]');
    expect(WALL_PROBES.stopBoard).toBe('[data-testid=stop-board]');
    expect(WALL_PROBES.code).toContain('[data-testid=kiosk-code]');
    expect(WALL_PROBES.brand).toBe('[data-testid=kiosk-brand]');
    expect(WALL_PROBES.controlExempt).toBe('[data-testid=kiosk-qr], [data-testid=kiosk-brand]');
  });

  it('80 characters, 1–3 departures, QR 240 px, a 900 ms hold, 300 readings 2 s apart (ten minutes), a floor of 3 distinct sentences', () => {
    expect(SENTENCE_MAX_CHARS).toBe(80);
    expect(DEPARTURES_MAX).toBe(3);
    expect(QR_MIN_PX).toBe(240);
    expect(SETTINGS_HOLD_MS).toBe(900);
    expect(ROTATION_STEPS * ROTATION_STEP_MS).toBe(600_000);
    expect(DISTINCT_SENTENCES_MIN).toBe(3);
  });

  it('the head is measured per place, and reads "U blizini · 2 km · ~15 min" at 2.0 km; the lead is byte-exact', () => {
    expect(NEARBY_HEAD_RE.test(NEARBY_HEAD_2KM)).toBe(true);
    expect(NEARBY_HEAD_RE.test('U blizini · 2,2 km · ~16 min')).toBe(true);
    expect(NEARBY_HEAD_RE.test('U blizini · 2.2 km · ~16 min')).toBe(false);
    expect(NEARBY_HEAD_2KM).toBe('U blizini · 2 km · ~15 min');
    expect(LEAD_TEXT).toBe('Skeniraj za 10 minuta grada.');
  });
});

// --- one reading ---------------------------------------------------------------------------------
describe('one reading of the wall', () => {
  it('wallSample ships the probes and the patterns; the page-side source names no module identifier', async () => {
    let shipped: { fn: string; arg: unknown } | null = null;
    const page = { evaluate: (fn: unknown, arg: unknown) => { shipped = { fn: String(fn), arg }; return Promise.resolve(sample()); } } as unknown as Pick<Page, 'evaluate'>;
    await wallSample(page);
    expect(shipped!.fn).toBe(String(WALL_SAMPLE_IN_PAGE));
    expect(shipped!.arg).toEqual(WALL_SAMPLE_SPEC);
    expect(JSON.parse(JSON.stringify(WALL_SAMPLE_SPEC))).toEqual(WALL_SAMPLE_SPEC);
    expect(shipped!.fn).not.toMatch(/\b(WALL_PROBES|WALL_SAMPLE_SPEC|DISCL|CLOCK_RE|ELLIPSIS_RE|SENTENCE_MAX_CHARS|QR_MIN_PX)\b/);
  });

  it('reads the header, the list, the map probes, the card and the footer, counting only the controls a passer-by can press', () => {
    const shippedFn = new Function(`return (${String(WALL_SAMPLE_IN_PAGE)});`)() as typeof WALL_SAMPLE_IN_PAGE;
    document.documentElement.dataset.themeResolved = 'dark';
    document.body.innerHTML = `
      <div class="kiosk"><header class="k-head"><button data-testid="kiosk-brand">Kaj ima?</button><p data-testid="kiosk-context">Kvaternikov trg</p>
        <p data-testid="kiosk-sentence" data-kicker="promet" data-valid-until="2026-09-21T15:45:20.000Z"><span data-testid="kiosk-sentence-kicker">Promet</span><span data-testid="kiosk-sentence-text">Tramvaj 6 kreće za dvije minute.</span></p></header>
      <section data-testid="kiosk-invitation"><div data-testid="kiosk-map-host" data-frame="6"><div data-testid="kiosk-map" data-map-status="ready" data-zoom="14.20" data-pills="6|12|17" data-bodies="41" data-feed="live" data-unlabelled="0" data-markers="12"></div></div>
        <aside><section data-testid="nearby"><h2 data-testid="nearby-head">U blizini · 2 km · ~15 min</h2><ol data-testid="nearby-rows">
          <li class="nearby-row" data-id="trip-1" data-kind="departure" data-when="2026-09-21T15:47:00.000Z" data-live="1" data-source="zet"><span class="nearby-title">6 Sopot</span><span class="nearby-when"><time>2 min</time></span></li>
          <li class="nearby-row" data-id="sun" data-kind="solar" data-when="2026-09-21T16:57:00.000Z" data-source="solar"><span class="nearby-title">Zalazak sunca</span><span class="nearby-when"><time>18:57</time></span></li>
          <li class="nearby-row" data-id="story" data-kind="always" data-always="1" data-source="city"><span class="nearby-title">Kvaternikov trg</span><span class="nearby-when">uvijek</span><span class="nearby-sub">Podatak iz registra, nije provjera uživo.</span></li>
        </ol></section>
        <article data-testid="kiosk-invite"><h1 class="k-lead">Skeniraj za 10 minuta grada.</h1><p data-testid="kiosk-code" data-state="live">ABCD·EFGH</p>
          <button data-testid="pair-copy" aria-label="Kopiraj kod"></button><a data-testid="pair-url" href="" hidden></a><div data-testid="kiosk-qr"><svg></svg><a href="/s/">QR</a></div></article></aside></section>
      <footer data-testid="safety-strip"><span data-testid="strip-verdict">Mirno</span><span data-testid="strip-pharmacy"><span data-symbol="pharmacy">+</span> 24/7 Ilica 1</span><span data-testid="strip-sources">DHMZ · EMSC</span></footer></div>`;
    for (const el of document.body.querySelectorAll<HTMLElement>('*')) el.getBoundingClientRect = () => rect(100, 40);
    document.querySelector<SVGElement>('[data-testid=kiosk-qr] svg')!.getBoundingClientRect = () => rect(250, 250);
    try {
      const s = shippedFn(WALL_SAMPLE_SPEC);
      expect(s).toMatchObject({
        place: 'Kvaternikov trg', sentence: 'Tramvaj 6 kreće za dvije minute.', kicker: 'promet', kickerText: 'Promet', validUntil: '2026-09-21T15:45:20.000Z',
        sentenceChars: 32, sentenceOverflow: false, sentenceEllipsis: false, head: NEARBY_HEAD_2KM, departures: 1, solarRows: 1, liveRows: 1,
        pills: '6|12|17', bodies: 41, zoom: '14.20', feed: 'live', mapStatus: 'ready', unlabelled: 0, markers: 12, frame: '6', mapNotes: 0,
        theme: 'dark', code: 'ABCD·EFGH', codeState: 'live', qr: { w: 250, h: 250 }, lead: LEAD_TEXT, stripHasClock: false, pharmacySymbols: 1,
        settingsOpen: false, stopBoardOpen: false,
      });
      expect(s.rows.map((r) => [r.id, r.kind, r.when, r.always, r.live, r.hasTime, r.caveat])).toEqual([
        ['trip-1', 'departure', '2026-09-21T15:47:00.000Z', false, true, true, false],
        ['sun', 'solar', '2026-09-21T16:57:00.000Z', false, false, true, false],
        ['story', 'always', null, true, false, false, true],
      ]);
      expect(s.rows[0]).toMatchObject({ title: '6 Sopot', whenText: '2 min', source: 'zet' });
      // The brand (the long press) and everything inside the QR are exempt; the hidden link is not pressable; the copy button is.
      expect(s.controls).toBe(1);
      expect(s.controlNames).toEqual(['button "Kopiraj kod"']);
      expect(s.retiredChrome).toBe(1);
      expect(sampleFailures(s)).toEqual([
        '1 control(s) a passer-by can press (target 0): button "Kopiraj kod"',
        '1 retired operator control(s) still in the DOM ([data-testid=kiosk-settings], [data-testid=kiosk-theme], [data-action=pause-highlights], [data-testid=pair-copy], [data-testid=kiosk-stop-presentation])',
      ]);
      document.querySelector('[data-testid=strip-sources]')!.textContent = 'DHMZ 17:30 · EMSC';
      expect(shippedFn(WALL_SAMPLE_SPEC).stripHasClock).toBe(true);
    } finally {
      delete document.documentElement.dataset.themeResolved;
    }
  });

  it('a wall without the new probes reads as empty, never throws, and each gap is a named failure', () => {
    const shippedFn = new Function(`return (${String(WALL_SAMPLE_IN_PAGE)});`)() as typeof WALL_SAMPLE_IN_PAGE;
    document.body.innerHTML = '<main class="kiosk"><p class="k-brand">Kaj ima?</p></main>';
    const s = shippedFn(WALL_SAMPLE_SPEC);
    expect(s).toMatchObject({ place: '', sentence: '', rows: [], departures: 0, unlabelled: null, qr: null, controls: 0 });
    const failures = sampleFailures(s);
    expect(failures).toContain('the place ([data-testid=kiosk-context]) is empty: the wall names a stop or street, "Zagreb" for the whole city');
    expect(failures).toContain('0 departure rows (target 1–3)');
    expect(failures).toContain('the map has no data-unlabelled probe ([data-testid=kiosk-map])');
    expect(failures).toContain('the QR SVG is missing (target ≥ 240 × 240 px)');
  });

  it('a good reading has no failures', () => {
    expect(sampleFailures(sample())).toEqual([]);
    expect(sampleFailures(sample({ sentence: 'x'.repeat(81), sentenceChars: 81 }))).toEqual([`the sentence has 81 characters (target 1–80): "${'x'.repeat(81)}"`]);
    expect(sampleFailures(sample({ rows: [row({ id: 'a', when: 'x' }), row({ id: 'b', when: 'x' }), row({ id: 'c', when: 'x' }), row({ id: 'd', when: 'x' })] }))).toEqual(['4 departure rows (target 1–3)']);
  });
});

// --- the rotation --------------------------------------------------------------------------------
describe('the ten-minute rotation', () => {
  /** 30 readings: sentences A, B, C for ten readings each; a closure that leaves at 10 and returns at 15; one caveat row at 20; one "+3" pill at 5. */
  function log(): WallSample[] {
    return Array.from({ length: 30 }, (_, i) => {
      const turn = Math.floor(i / 10);
      const rows: WallRow[] = [row({ id: 'trip-1', when: '2026-09-21T15:59:00.000Z', text: '6 Sopot' })];
      if (i < 10 || i >= 15) rows.push(row({ id: 'closure-7', kind: 'closure', when: '2026-09-21T18:00:00.000Z', text: 'Ilica zatvorena do 20:00' }));
      if (i === 20) rows.push(row({ id: 'event-3', kind: 'event', when: '2026-09-21T17:00:00.000Z', sub: 'Podatak iz registra, nije provjera uživo.', caveat: true }));
      return sample({
        at: Date.UTC(2026, 8, 21, 15, 45) + i * 2000,
        sentence: ['Tramvaj 6 kreće za dvije minute.', 'Večeras u Gavelli: predstava u 20:00.', 'Ilica je zatvorena do 20:00.'][turn],
        validUntil: iso(Date.UTC(2026, 8, 21, 15, 45, 20) + turn * 20_000),
        pills: i === 5 ? '6|12 +3' : '6|12|17',
        rows,
      });
    });
  }

  it('one caveat row, one closure re-entry, one "+3" pill sample read 1 / 1 / 1; departures in every reading; three sentences, no repeat', () => {
    const r = summariseRotation(log());
    expect(r).toMatchObject({
      samples: 30, errors: 0, caveatRows: 1, closureReentries: 1, plusPills: 1, departuresEverySample: true, minDepartures: 1, maxDepartures: 1,
      distinctSentences: 3, sentenceTurns: 3, consecutiveRepeats: 0, sentenceOverflows: 0, unlabelledMax: 0, controlsMax: 0, solarRowsMax: 0, pastLastRows: 0, rowsWithoutTime: 0,
    });
    expect(r.reentriesByKind).toEqual({ closure: 1 });
    expect(r.kinds).toEqual({ departure: 30, closure: 25, event: 1 });
    expect(rotationFailures(r)).toEqual([
      '1 row(s) read as a caveat (target 0)',
      '1 closure row(s) left the list and came back (target 0)',
      '1 reading(s) with a "+N" vehicle pill (target 0)',
    ]);
  });

  it('one reading without a departure turns departuresEverySample false', () => {
    const rows = log();
    rows[17] = sample({ rows: [], at: rows[17].at, sentence: rows[17].sentence, validUntil: rows[17].validUntil });
    const r = summariseRotation(rows);
    expect(r.departuresEverySample).toBe(false);
    expect(r.minDepartures).toBe(0);
    expect(rotationFailures(r)[0]).toBe('a reading without a departure row (min 0 over 30 readings; target ≥ 1 in every one)');
  });

  it('counts a turn that repeats the sentence before it, and applies §12 (no verbatim repeat within ten minutes) for the observer', () => {
    const at = (i: number) => Date.UTC(2026, 8, 21, 15, 45) + i * 2000;
    const repeat = [0, 1, 2].map((i) => sample({ at: at(i), sentence: 'A.', validUntil: iso(at(i) + 20_000) }));
    expect(summariseRotation(repeat)).toMatchObject({ sentenceTurns: 3, distinctSentences: 1, consecutiveRepeats: 2 });
    const aba = ['A.', 'B.', 'A.'].map((s, i) => sample({ at: at(i), sentence: s, validUntil: iso(at(i) + 20_000) }));
    const r = summariseRotation(aba);
    expect(r).toMatchObject({ sentenceTurns: 3, distinctSentences: 2, consecutiveRepeats: 0 });
    expect(rotationFailures(r, { sentences: 'no-repeat' })).toEqual(['3 sentence turns but 2 distinct sentences: a sentence was repeated verbatim within ten minutes (§12)']);
    expect(rotationFailures(r)).toEqual(['2 distinct sentence(s) in ten minutes (template floor ≥ 3)']);
  });

  it('a last-departure row whose time has passed, a missing solar row where one is due, a failed reading and a missing map probe are named', () => {
    const at = Date.UTC(2026, 8, 21, 22, 45);
    const rows: (WallSample | { at: number; error: string })[] = [
      sample({ at, rows: [row({ id: 'd', when: iso(at + 2 * MIN) }), row({ id: 'last', kind: 'last', when: iso(at - 14 * MIN) })], unlabelled: null }),
      { at, error: 'Target closed' },
    ];
    const r = summariseRotation(rows);
    expect(r).toMatchObject({ samples: 1, errors: 1, pastLastRows: 1, unlabelledMax: null, solarRowsMin: 0 });
    expect(rotationFailures(r, { sentences: 'template-floor', solarMin: 1 })).toEqual([
      '1 of 2 readings failed',
      'the map never carried a data-unlabelled probe',
      'a reading without the solar row (target ≥ 1: the next solar event is inside the shown horizon)',
      '1 reading(s) with a last-departure row whose time has passed (target 0)',
      '1 distinct sentence(s) in ten minutes (template floor ≥ 3)',
    ]);
  });

  it('sampleRotation steps the fake clock, lets rAF settle 30 ms, reads, and keeps a failed reading', async () => {
    const calls: string[] = [];
    let n = 0;
    const page = {
      evaluate: async () => { calls.push('read'); if (++n === 2) throw new Error('Target closed'); return sample(); },
      waitForTimeout: async (ms: number) => { calls.push(`wait ${ms}`); },
      clock: { runFor: async (ms: number) => { calls.push(`run ${ms}`); } },
    } as unknown as WallPage;
    const seen: RotationRow[] = [];
    const rows = await sampleRotation(page, { steps: 3, onSample: (r) => { seen.push(r); } });
    expect(calls).toEqual(['run 2000', 'wait 30', 'read', 'run 2000', 'wait 30', 'read', 'run 2000', 'wait 30', 'read']);
    expect(rows.map((r) => r.n)).toEqual([0, 1, 2]);
    expect('error' in rows[1] && rows[1].error).toBe('Error: Target closed');
    expect(seen).toEqual(rows);
    calls.length = 0;
    await sampleRotation(page, { steps: 2, clock: 'real', stepMs: 500 });
    expect(calls).toEqual(['wait 500', 'read', 'wait 500', 'read']);
  });
});

// --- the scenes ------------------------------------------------------------------------------
describe('the eight scenes', () => {
  const zagreb = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Zagreb', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  it('are the slots of §16.3, at the instants their names say in Zagreb (UTC+2)', () => {
    expect(SCENE_IDS).toEqual(['peak1745', 'late2130', 'lastTrams2240', 'afterLast0045', 'night0430', 'morning0745', 'midday1230', 'outage0800']);
    expect(SCENES.afterLast0045.now).toBe(Date.UTC(2026, 8, 21, 22, 45));
    for (const id of SCENE_IDS) {
      const s = SCENES[id];
      expect(s.id).toBe(id);
      expect(zagreb.format(s.now)).toBe(s.zagreb);
      expect(id.slice(-4)).toBe(s.zagreb.slice(-5).replace(':', ''));
    }
    expect(PORTRAIT_SCENES).toEqual(['peak1745']);
  });

  it('carry the solar theme the wall resolves (sunset 18:57, sunrise 06:42), and a solar row exactly where the next one is within three hours', () => {
    for (const id of SCENE_IDS) {
      const s = SCENES[id];
      expect(s.theme, id).toBe(isDaylight(new Date(s.now)) ? 'light' : 'dark');
      const today = sunTimes(new Date(s.now));
      const tomorrow = sunTimes(new Date(s.now + 86_400_000));
      const next = [today.sunrise, today.sunset, tomorrow.sunrise].map((d) => d.getTime()).filter((t) => t > s.now).sort((a, b) => a - b)[0];
      expect(s.expect.solarMin, id).toBe(next - s.now <= 3 * 3_600_000 ? 1 : 0);
    }
  });

  it('every scene requires departures; the night scenes their first tram; the outage is ZET down with timetable times and one map note', () => {
    for (const id of SCENE_IDS) expect(SCENES[id].expect.requiredKinds).toContain('departure');
    expect(SCENES.lastTrams2240.expect.requiredKinds).toEqual(['departure', 'last', 'first']);
    expect(SCENES.afterLast0045.expect).toMatchObject({ requiredKinds: ['departure', 'first'], noPastKinds: ['last'] });
    expect(SCENES.afterLast0045.expect.sentenceNot?.test('Zadnji tramvaj 14 u 00:31')).toBe(true);
    expect(SCENES.night0430.expect.requiredKinds).toEqual(['departure', 'first', 'pharmacy']);
    expect(SCENES.morning0745.expect.liveMin).toBe(1);
    expect(SCENES.outage0800).toMatchObject({ feedState: 'down', expect: { liveMax: 0, feedLive: false, mapNotes: 1, pills: 'none', departuresAsClockTimes: true } });
    expect(SCENES.outage0800.expect.headingNot?.test('Podaci nedostupni')).toBe(true);
    for (const id of SCENE_IDS.filter((i) => i !== 'outage0800')) expect(SCENES[id]).toMatchObject({ feedState: 'ready', expect: { feedLive: true, pills: 'any', mapNotes: 0 } });
  });

  it('afterLast0045 is after every line\'s last departure of the 21st; lastTrams2240 is inside T−4 h of all of them and before each', () => {
    const lasts = Object.values(FIXTURE_LAST_DEPARTURES).map((t) => scheduleInstant('2026-09-21', gtfsSeconds(t)));
    expect(Math.max(...lasts)).toBeLessThan(SCENES.afterLast0045.now);
    expect(Math.min(...lasts) - 4 * 3_600_000).toBeLessThanOrEqual(SCENES.lastTrams2240.now);
    expect(Math.min(...lasts)).toBeGreaterThan(SCENES.lastTrams2240.now);
  });
});

// --- the departures fixture ---------------------------------------------------------------------
describe('the departures board and the last-run file', () => {
  const vehiclesOf = async (): Promise<LiveVehicleRef[]> => {
    const snapshots = await experienceSnapshots('ready');
    return snapshots['zet-rt'].items.filter((i) => i.id.startsWith('vehicle:')).map((i) => ({ id: i.id, tripId: i.data?.tripId as string | undefined, routeId: i.data?.routeId as string | undefined }));
  };

  it('twelve rows on a six-minute grid from now + 2 min, each line in turn, in the DepartureBoard shape', () => {
    const now = SCENES.peak1745.now;
    const b = departuresBoard({ now });
    expect(b).toMatchObject({ operator: 'zet', stopId: '106_1', stopName: FIXTURE_STOP.name, status: 'live', generatedAt: iso(now) });
    expect(b.departures).toHaveLength(12);
    expect(b.departures.map((d) => (Date.parse(d.at) - now) / MIN)).toEqual([2, 8, 14, 20, 26, 32, 38, 44, 50, 56, 62, 68]);
    expect(b.departures.map((d) => d.routeId)).toEqual(['6', '11', '12', '13', '14', '17', '6', '11', '12', '13', '14', '17']);
    expect(new Set(b.departures.map((d) => d.tripId)).size).toBe(12);
    expect(b.departures.every((d) => d.operator === 'zet' && d.routeName === d.routeId && d.headsign !== '')).toBe(true);
  });

  it('every scene has departures for the whole ten-minute rotation, at 00:45 and 04:30 too ([O-65])', () => {
    for (const id of SCENE_IDS) {
      const { now } = SCENES[id];
      const b = departuresBoard({ now });
      expect(b.departures.length, id).toBe(12);
      expect(Date.parse(b.departures.at(-1)!.at) - now, id).toBeGreaterThan(10 * MIN);
    }
  });

  it('no line runs past its own last departure; after the last tram the rows are the next morning\'s from 04:16', () => {
    const late = departuresBoard({ now: SCENES.lastTrams2240.now });
    for (const d of late.departures) expect(Date.parse(d.at)).toBeLessThanOrEqual(scheduleInstant('2026-09-21', gtfsSeconds(FIXTURE_LAST_DEPARTURES[d.routeId])));
    const after = departuresBoard({ now: SCENES.afterLast0045.now });
    const firstTram = scheduleInstant('2026-09-22', gtfsSeconds(FIXTURE_FIRST_TRAM));
    expect(Date.parse(after.departures[0].at)).toBeGreaterThanOrEqual(firstTram);
    expect(Date.parse(after.departures[0].at) - firstTram).toBeLessThan(6 * MIN);
    const night = departuresBoard({ now: SCENES.night0430.now });
    expect(Date.parse(night.departures[0].at) - SCENES.night0430.now).toBe(2 * MIN);
    // A global service end overrides the per-line table.
    const early = departuresBoard({ now: SCENES.late2130.now, serviceEnd: '21:40' });
    expect(early.departures.slice(0, 2).map((d) => (Date.parse(d.at) - SCENES.late2130.now) / MIN)).toEqual([2, 8]);
    expect(Date.parse(early.departures[2].at)).toBeGreaterThanOrEqual(scheduleInstant('2026-09-22', gtfsSeconds(FIXTURE_FIRST_TRAM)));
  });

  it('the first `tracked` rows carry the trip ids of zet-rt vehicles on the stop\'s lines, so the arrivals join gives them a countdown', async () => {
    const vehicles = await vehiclesOf();
    const now = SCENES.morning0745.now;
    const snapshots = await experienceSnapshots('ready');
    const b = departuresBoard({ now, vehicles: snapshots['zet-rt'].items });
    const tracked = trackedTrips(snapshots['zet-rt'].items, FIXTURE_STOP.routes, 2);
    expect(tracked.every((t) => FIXTURE_STOP.routes.includes(t.routeId))).toBe(true);
    expect(b.departures.slice(0, 2).map((d) => d.tripId)).toEqual(tracked.map((t) => t.tripId));
    expect(b.departures.slice(0, 2).map((d) => d.routeId)).toEqual(tracked.map((t) => t.routeId));
    const { rows } = arrivalsAt([b], vehicles, now, { stopIds: [b.stopId] });
    expect(rows.filter((r) => r.live).map((r) => r.minutes)).toEqual([2, 8]);
    expect(rows.filter((r) => !r.live).every((r) => r.minutes === null)).toBe(true);
    // No vehicles (the outage), or rows beyond the live horizon (the night), give no live row.
    expect(arrivalsAt([departuresBoard({ now, vehicles: [] })], vehicles, now, { stopIds: ['106_1'] }).rows.some((r) => r.live)).toBe(false);
    const night = departuresBoard({ now: SCENES.afterLast0045.now, vehicles: snapshots['zet-rt'].items });
    expect(night.departures.some((d) => tracked.some((t) => t.tripId === d.tripId))).toBe(false);
  });

  it('the last-run file parses through the app\'s own loader and agrees with the board', async () => {
    const now = SCENES.lastTrams2240.now;
    const file = lastRunSnapshot('106_1', serviceDays(now));
    expect(file.source).toBe('ZET GTFS');
    expect(Object.keys(file.routes)).toEqual(FIXTURE_STOP.routes);
    expect(file.routes['14']['2026-09-21']).toBe('24:31');
    expect(file.first?.['6']['2026-09-22']).toBe('04:16');
    expect(lastRunSnapshot('106_1', ['2026-09-21'], { withFirst: false }).first).toBeUndefined();
    const fetchImpl = (async () => new Response(JSON.stringify(file), { status: 200 })) as typeof fetch;
    const snap = await loadLastRun('fixture-lastrun-2240', fetchImpl, now);
    expect(snap?.status).toBe('live');
    expect(lastDeparture(snap, '14', now)?.at).toBe(scheduleInstant('2026-09-21', gtfsSeconds('24:31')));
    // At 00:45 tonight's last trams have all left: what the loader returns lies the next night, out of the four-hour window.
    const after = SCENES.afterLast0045.now;
    for (const routeId of FIXTURE_STOP.routes) {
      const at = lastDeparture(snap, routeId, after)?.at;
      if (at !== undefined) expect(at - after, routeId).toBeGreaterThan(4 * 3_600_000);
    }
    expect(serviceDays(now, 1, 2)).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23']);
  });
});

// --- the fixture options -----------------------------------------------------------------------
interface CapturedRoute { pattern: string; handler: (route: unknown) => unknown }
function routingPage(): { page: Page; routes: CapturedRoute[] } {
  const routes: CapturedRoute[] = [];
  const page = { route: async (pattern: string, handler: (route: unknown) => unknown) => { routes.push({ pattern, handler }); } } as unknown as Page;
  return { page, routes };
}
async function answer(routes: CapturedRoute[], pattern: string, url: string): Promise<{ status?: number; body: unknown }> {
  const found = routes.find((r) => r.pattern === pattern);
  if (!found) throw new Error(`no route ${pattern}`);
  let out: { status?: number; body: unknown } | null = null;
  await found.handler({
    request: () => ({ url: () => url }),
    fulfill: async (o: { status?: number; body?: string; json?: unknown }) => { out = { status: o.status, body: o.json ?? (o.body ? JSON.parse(o.body) : undefined) }; },
  });
  if (!out) throw new Error('route not fulfilled');
  return out;
}

describe('installKioskFeedFixture { now } and installCityFixture { departures, lastRun }', () => {
  it('a scene\'s now drives both the shift of the recorded times and the teaser generatedAt', async () => {
    const now = SCENES.morning0745.now;
    const { page, routes } = routingPage();
    const snapshots = await installKioskFeedFixture(page, 'ready', { now });
    const teaser = await answer(routes, '**/api/teaser*', 'http://localhost:8787/api/teaser?stop=106_1');
    expect((teaser.body as { generatedAt: string }).generatedAt).toBe(iso(now));
    const vehicles = snapshots['zet-rt'].items.filter((i) => i.id.startsWith('vehicle:'));
    expect(vehicles.length).toBeGreaterThan(0);
    expect(vehicles.every((v) => v.at === iso(now))).toBe(true);
    expect(snapshots['zet-rt'].sourceUpdatedAt).toBe(iso(now));
    const data = await answer(routes, '**/api/data/**', 'http://localhost:8787/api/data/zet-rt');
    expect((data.body as { module: string }).module).toBe('zet-rt');
  });

  it('without now the feed keeps today\'s behaviour: shifted to the real clock, generatedAt read at each request', async () => {
    const { page, routes } = routingPage();
    const before = Date.now();
    const snapshots = await installKioskFeedFixture(page);
    const shifted = Date.parse(snapshots['zet-rt'].sourceUpdatedAt!);
    expect(shifted).toBeGreaterThanOrEqual(before);
    expect(shifted).toBeLessThanOrEqual(Date.now());
    const teaser = await answer(routes, '**/api/teaser*', 'http://localhost:8787/api/teaser');
    expect(Date.parse((teaser.body as { generatedAt: string }).generatedAt)).toBeGreaterThanOrEqual(before);
    expect(FIXTURE_NOW.getTime()).toBeLessThan(before);
  });

  it('the city fixture answers departures from the factory and serves the last-run file; without options nothing changes', async () => {
    const now = SCENES.lastTrams2240.now;
    const asked: string[] = [];
    const { page, routes } = routingPage();
    await installCityFixture(page, now, {
      departures: (stopId, operator) => { asked.push(`${operator}:${stopId}`); return departuresBoard({ now, stopId }); },
      lastRun: (stopId) => (stopId === '106_1' ? lastRunSnapshot(stopId, serviceDays(now)) : null),
    });
    const board = await answer(routes, '**/api/city/**', 'http://localhost:8787/api/city/departures?operator=zet&stop=106_1');
    expect(asked).toEqual(['zet:106_1']);
    expect((board.body as { departures: unknown[] }).departures).toHaveLength(12);
    const file = await answer(routes, '**/data/lastrun/*.json', 'http://localhost:8787/data/lastrun/106_1.json');
    expect((file.body as { routes: Record<string, unknown> }).routes['14']).toBeDefined();
    expect((await answer(routes, '**/data/lastrun/*.json', 'http://localhost:8787/data/lastrun/999_9.json')).status).toBe(404);

    const plain = routingPage();
    await installCityFixture(plain.page, now);
    expect(plain.routes.map((r) => r.pattern)).toEqual(['**/api/city/**']);
    const one = await answer(plain.routes, '**/api/city/**', 'http://localhost:8787/api/city/departures?operator=zet&stop=106_1');
    expect((one.body as { departures: unknown[] }).departures).toHaveLength(1);
  });
});

// --- the recorders -------------------------------------------------------------------------------
describe('the data-status recorder', () => {
  type Handler = (x: unknown) => unknown;
  function emitter(): { page: RecorderPage; emit: (event: string, x: unknown) => Promise<void> } {
    const handlers = new Map<string, Handler>();
    const page = { on: (event: string, handler: Handler) => { handlers.set(event, handler); } } as unknown as RecorderPage;
    return { page, emit: async (event, x) => { await handlers.get(event)?.(x); } };
  }
  const response = (url: string, status: number, body: unknown, method = 'GET') => ({
    url: () => url, status: () => status, request: () => ({ method: () => method }), headers: () => ({ 'content-type': 'application/json' }),
    json: async () => body, body: async () => Buffer.from(JSON.stringify(body)),
  });
  const consoleMessage = (type: string, text: string, url: string) => ({ type: () => type, text: () => text, location: () => ({ url }) });

  it('keeps console errors, page errors, failed requests and HTTP >= 400, leaves the map tiles out, and reduces scan bodies to their keys', async () => {
    const { page, emit } = emitter();
    const events: string[] = [];
    const rec = attachRecorders(page, 'kiosk', { ignore: [TILE_REQUESTS], now: () => new Date(SCENES.peak1745.now), onEvent: (e) => events.push(e.kind) });
    await emit('console', consoleMessage('error', 'Uncaught boom', 'http://localhost:8787/assets/kiosk.js'));
    await emit('console', consoleMessage('log', 'hello', 'http://localhost:8787/assets/kiosk.js'));
    await emit('console', consoleMessage('warning', 'slow', 'http://localhost:8787/assets/kiosk.js'));
    await emit('console', consoleMessage('error', 'Failed to load resource: 404', 'http://localhost:8787/maps/zagreb-v1/12/2222/1455.pbf'));
    await emit('pageerror', new Error('kaboom'));
    await emit('requestfailed', { url: () => 'http://localhost:8787/s/#ABCD-EFGH', method: () => 'GET', failure: () => ({ errorText: 'net::ERR_ABORTED' }), resourceType: () => 'document' });
    await emit('response', response('http://localhost:8787/maps/zagreb-v1/12/2222/1455.pbf', 404, {}));
    await emit('response', response('http://localhost:8787/api/teaser?stop=106_1', 200, { generatedAt: '2026-09-21T15:45:00.000Z', modules: [{ module: 'zet-rt', status: 'live', fetchedAt: '2026-09-21T15:44:50.000Z', items: [{ kind: 'vehicle' }, { kind: 'vehicle' }] }] }));
    await emit('response', response('http://localhost:8787/api/scan', 200, { ticket: 'secret-ticket-value', dataToken: 'secret-token-value' }, 'POST'));
    await emit('response', response('http://localhost:8787/api/city/departures?operator=zet&stop=106_1', 503, { status: 'down' }));

    expect(rec.consoleErrors.map((r) => r.text)).toEqual(['Uncaught boom']);
    expect(rec.consoleErrors[0]).toMatchObject({ t: iso(SCENES.peak1745.now), at: '/assets/kiosk.js' });
    expect(rec.consoleWarnings.map((r) => r.text)).toEqual(['slow']);
    expect(rec.pageErrors.map((r) => r.text)).toEqual(['Error: kaboom']);
    expect(rec.failed).toEqual([{ t: iso(SCENES.peak1745.now), url: 'http://localhost:8787/s/#…', method: 'GET', error: 'net::ERR_ABORTED', resourceType: 'document' }]);
    expect(rec.httpErrors.map((r) => `${r.status} ${r.path}`)).toEqual(['503 /api/city/departures?operator=zet&stop=106_1']);
    expect(rec.problems()).toEqual([
      'console error: Uncaught boom', 'page error: Error: kaboom', 'failed request: GET http://localhost:8787/s/#… (net::ERR_ABORTED)',
      'HTTP 503: GET /api/city/departures?operator=zet&stop=106_1',
    ]);
    const report = rec.report();
    expect(report).toMatchObject({ page: 'kiosk', dataResponses: 3, redemptions: 1, screenCreations: 0, moduleStatuses: { 'zet-rt': 'live', '/api/city/departures': 'down' } });
    expect(JSON.stringify(rec.dataResponses)).not.toMatch(/secret-ticket-value|secret-token-value/);
    expect(rec.dataResponses.find((r) => r.path === '/api/scan')?.summary).toEqual({ keys: ['ticket', 'dataToken'] });
    expect((rec.lastTeaser as { generatedAt: string }).generatedAt).toBe('2026-09-21T15:45:00.000Z');
    expect(events).toEqual(['console', 'console', 'pageerror', 'failed', 'data', 'data', 'http-error', 'data']);
  });

  it('summariseBody keeps module, status, fetch time and item counts; pathOf cuts the fragment', () => {
    expect(summariseBody('/api/data/zet-rt', { module: 'zet-rt', status: 'stale', fetchedAt: 'f', items: [{ kind: 'vehicle' }, { kind: 'route' }] })).toEqual({
      module: { module: 'zet-rt', status: 'stale', fetchedAt: 'f', sourceUpdatedAt: undefined, staleSince: undefined, itemCount: 2, kinds: { vehicle: 1, route: 1 }, coverage: undefined },
    });
    expect(summariseBody('/api/screens', { beaconId: 'b', secret: 's' })).toEqual({ keys: ['beaconId', 'secret'] });
    expect(summariseBody('/api/city/manifest', { schema: 1, generatedAt: 'g', sources: [{ id: 'culture', status: 'live', count: 3, extra: 'x' }], parts: [1, 2] })).toEqual({
      schema: 1, generatedAt: 'g', sources: [{ id: 'culture', status: 'live', count: 3, fetchedAt: undefined, updatedAt: undefined, limited: undefined }], parts: 2,
    });
    expect(pathOf('https://example.org/kiosk/#K7Q2M9XZ.secret')).toBe('/kiosk/');
    expect(TILE_REQUESTS.test('http://localhost:8787/maps/zagreb-v1/12/1/1.pbf')).toBe(true);
  });
});

