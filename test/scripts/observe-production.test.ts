// scripts/observe-production.mjs is the read-only production observer of
// master brief §16.7: it needs E2E_KIOSK_URL (an existing screen), never
// creates a screen, never presents, never opens settings, presses nothing on
// the wall, redeems at most one code per surface 12 s apart, and judges what it
// reads against one thresholds table whose rows carry their deploy stage. This
// file holds it without a browser or a network: argument parsing and the
// refusals (also as a child process that could not open a socket if it
// tried), the redemption budget, the masking, the table, the page-side
// readings evaluated from their own text in happy-dom, and whole runs over a
// fake browser whose pages answer with recorded or synthetic readings, down to
// the files the run writes.
// @vitest-environment happy-dom
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as wall from '../../e2e/wall';
import * as inventory from '../../e2e/inventory';
import * as recorders from '../../e2e/recorders';
import * as legibility from '../../e2e/legibility';
import * as scenes from '../../e2e/scenes';
import * as lib from '../../e2e/lib';
import type { WallRow, WallSample } from '../../e2e/wall';
import type { PageInventory, RawInventory } from '../../e2e/inventory';
import type { ExpiryReading } from '../../e2e/inventory';
import type { CalmMotionReading } from '../../e2e/wall';
import { skippedTextCensus } from '../../app/src/city/nearby';
import {
  ANY_PRESENT_IN_PAGE, CENSUS_TIMEOUT_MS, DESKTOP_READ_IN_PAGE, INVITATION_READY_IN_PAGE, KARTA_READ_IN_PAGE, MAP_CENSUS_IN_PAGE, MAP_SETTLED_IN_PAGE, METRICS, MAX_MINUTES,
  PILLS_DRAWN_IN_PAGE, PILLS_DRAW_GRACE_MS, VEHICLES_TIMEOUT_MS, fleetAt, fleetOf, pillsOwed, type FleetRecord, type ObservedSample,
  ObserverRefusal, PAIRING_IN_PAGE, PAIRING_PROBES, PHONE_READ_IN_PAGE, REDEMPTION_SPACING_MS, SESSION_LIVE, SESSION_TIMEOUT_MS, SHARE_CODE_IN_PAGE, STAGES, STOP_BOARD_READ_IN_PAGE, STOP_BOARD_TIMEOUT_MS, SURFACES, THRESHOLDS,
  EXPIRY_STAMP_IN_PAGE, EXPIRY_WATCH_IN_PAGE, SESSION_LENGTH_MS, SESSION_MINUTES,
  SKIPPED_TEXT_IN_PAGE, SKIPPED_TEXT_SPEC, parseSkippedText, skippedTextOf, summariseSkippedText,
  USER_AGENT_SUFFIX, configFrom, distinctPerWindow, fillTarget, judge, kioskFromEnv, main, makeScrubber, newObservation, outDirFor, parseArgs,
  plannedRotationSteps, redemptionBudget, repeatsWithin, run, stageIndex, thresholdsFor,
  type Instruments, type KartaRead, type ObservedRotationRow, type SkippedTextEntry, type ObserverConfig, type PhoneRead, type DesktopRead, type Runtime, type StopBoardRead,
} from '../../scripts/observe-production.mjs';

const root = resolve(import.meta.dirname, '..', '..');
const instruments: Instruments = { wall, inventory, recorders, legibility, scenes, lib };
/** A short fake secret: never the shape of a real provisioning URL (the trust guard's secret grep). */
const KIOSK_URL = 'https://zagreb.example/kiosk/#ABCDEFGH.s3cr3t-part';
const ENV = { E2E_KIOSK_URL: KIOSK_URL };
/** Codes the fake screen shows, one per 30 s window. */
const CODES = ['7K3M-QX9P', 'R2D4-WV8T', 'HJ6N-5B1Z', 'M8XC-3F7G'];
const T0 = Date.UTC(2026, 8, 22, 15, 45);

const refusal = (fn: () => unknown): ObserverRefusal => {
  try { fn(); } catch (e) { if (e instanceof ObserverRefusal) return e; throw e; }
  throw new Error('expected an ObserverRefusal');
};

// --- arguments and environment -------------------------------------------------------------
describe('arguments', () => {
  it('defaults to ten minutes, all three surfaces, every stage and the review.local folder', () => {
    expect(parseArgs([])).toEqual({ minutes: 10, surfaces: ['kiosk', 'phone', 'desktop'], stage: 'full', out: null, help: false });
  });

  it('takes --name value and --name=value, and keeps the surfaces in their fixed order', () => {
    expect(parseArgs(['--minutes', '3', '--surfaces=phone,kiosk', '--stage', 'd1', '--out=review.local/x'])).toEqual({ minutes: 3, surfaces: ['kiosk', 'phone'], stage: 'd1', out: 'review.local/x', help: false });
    expect(parseArgs(['--help']).help).toBe(true);
  });

  it.each([
    [['--minutes', '0'], /--minutes must be a number above 0/],
    [['--minutes', String(MAX_MINUTES + 1)], /at most 60/],
    [['--minutes', 'ten'], /not "ten"/],
    [['--minutes'], /--minutes needs a value/],
    [['--surfaces', 'kiosk,wall'], /unknown surface\(s\) wall/],
    [['--surfaces', 'phone,desktop'], /must include kiosk/],
    [['--stage', 'd4'], /--stage must be one of d1, d2, d3, full/],
    [['--present'], /unknown option --present/],
    [['kiosk'], /unexpected argument "kiosk"/],
  ])('refuses %j with exit code 2', (argv, message) => {
    const e = refusal(() => parseArgs(argv));
    expect(e.exitCode).toBe(2);
    expect(e.message).toMatch(message);
  });
});

describe('the screen comes only from E2E_KIOSK_URL', () => {
  it.each([[{}], [{ E2E_KIOSK_URL: '' }], [{ E2E_KIOSK_URL: '   ' }]])('refuses a run without it (%j): exit 2, and the message says no screen is ever created', (env) => {
    const e = refusal(() => kioskFromEnv(env));
    expect(e.exitCode).toBe(2);
    expect(e.message).toContain('E2E_KIOSK_URL is not set');
    expect(e.message).toContain('never creates a screen');
  });

  it.each([
    ['kiosk/#ABCDEFGH.s3cr3t-x1', /not an absolute URL/],
    ['ftp://zagreb.example/kiosk/#ABCDEFGH.s3cr3t-x1', /http\(s\)/],
    ['https://zagreb.example/kiosk/', /no #<beacon>.<secret> fragment/],
    ['https://zagreb.example/kiosk/#ABCDEFGHs3cr3t-x1', /no #<beacon>.<secret> fragment/],
  ])('refuses %s without quoting the value', (value, message) => {
    const e = refusal(() => kioskFromEnv({ E2E_KIOSK_URL: value }));
    expect(e.message).toMatch(message);
    expect(e.message).not.toContain('s3cr3t');
  });

  it('opens the screen at /kiosk/ on its own origin, or on E2E_APP_URL, and keeps the secret for masking', () => {
    expect(kioskFromEnv(ENV)).toEqual({ kioskUrl: KIOSK_URL, origin: 'https://zagreb.example', beaconId: 'ABCDEFGH', secrets: ['ABCDEFGH.s3cr3t-part', 's3cr3t-part'] });
    expect(kioskFromEnv({ ...ENV, E2E_APP_URL: 'http://localhost:8787/whatever' }).kioskUrl).toBe('http://localhost:8787/kiosk/#ABCDEFGH.s3cr3t-part');
    expect(refusal(() => kioskFromEnv({ ...ENV, E2E_APP_URL: 'localhost' })).message).toMatch(/E2E_APP_URL/);
  });
});

describe('the output folder never lands in git', () => {
  it('defaults to review.local/observe-<stamp>, accepts any *.local folder or a folder outside the repository', () => {
    expect(outDirFor(null, root, 'S')).toBe(join(root, 'review.local', 'observe-S'));
    expect(outDirFor('review.local/today', root, 'S')).toBe(join(root, 'review.local', 'today'));
    expect(outDirFor('notes.local/obs', root, 'S')).toBe(join(root, 'notes.local', 'obs'));
    expect(outDirFor(join(tmpdir(), 'obs'), root, 'S')).toBe(join(tmpdir(), 'obs'));
  });

  it.each(['docs/observe', '.', 'test-results/../docs'])('refuses %s inside the repository: captures show live codes', (out) => {
    expect(refusal(() => outDirFor(out, root, 'S')).message).toMatch(/not in a \*\.local folder/);
  });
});

describe('refusals happen before anything is loaded', () => {
  it('main returns 2 without E2E_KIOSK_URL and never calls the loader (no Vite, no Playwright, no request)', async () => {
    const errors: string[] = [];
    let loaded = false;
    const code = await main({ argv: ['--minutes', '10'], env: {}, root, error: (l) => errors.push(l), log: () => {}, load: async () => { loaded = true; throw new Error('must not load'); } });
    expect(code).toBe(2);
    expect(loaded).toBe(false);
    expect(errors.join('\n')).toContain('E2E_KIOSK_URL is not set');
  });

  it('--help prints the usage and loads nothing', async () => {
    const lines: string[] = [];
    const code = await main({ argv: ['--help'], env: {}, root, log: (l) => lines.push(l), load: async () => { throw new Error('must not load'); } });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('Never creates a screen, never presents, never opens settings');
  });

  it('a loader that cannot start is exit 2', async () => {
    const errors: string[] = [];
    expect(await main({ argv: [], env: ENV, root, error: (l) => errors.push(l), log: () => {}, load: async () => { throw new Error('no vite'); } })).toBe(2);
    expect(errors.join('\n')).toContain('the instrument loader could not start: no vite');
  });

  // The documented acceptance, `E2E_KIOSK_URL= node scripts/observe-production.mjs; echo $?`, in a child whose
  // sockets, DNS and fetch would report any attempt: it prints the refusal and exits 2 without one.
  const guard = `data:text/javascript,${encodeURIComponent([
    "import net from 'node:net'; import dns from 'node:dns';",
    "const trip = (what) => { process.stderr.write('NETWORK ATTEMPT ' + what + '\\n'); throw new Error(what); };",
    "net.Socket.prototype.connect = function () { return trip('net.connect'); };",
    "dns.lookup = () => trip('dns.lookup');",
    "globalThis.fetch = () => trip('fetch');",
  ].join('\n'))}`;
  it.each([
    [{ E2E_KIOSK_URL: '' }, [], /E2E_KIOSK_URL is not set/],
    [{ E2E_KIOSK_URL: KIOSK_URL }, ['--minutes', '0'], /--minutes must be a number/],
    [{ E2E_KIOSK_URL: 'https://zagreb.example/kiosk/' }, [], /no #<beacon>.<secret> fragment/],
  ])('as a process (%j %j): exit 2, the message on stderr, no network attempt', (env, argv, message) => {
    const child = spawnSync(process.execPath, ['--import', guard, 'scripts/observe-production.mjs', ...argv], { cwd: root, env: { ...process.env, E2E_APP_URL: '', ...env }, encoding: 'utf8', timeout: 30_000 });
    expect(child.status).toBe(2);
    expect(child.stderr).toMatch(message);
    expect(child.stderr).not.toContain('NETWORK ATTEMPT');
    expect(child.stdout).toBe('');
  });

  it('holds no code path to the setup button or the screens route (the acceptance grep)', () => {
    const source = readFileSync(join(root, 'scripts/observe-production.mjs'), 'utf8');
    expect(source).not.toMatch(/setup-create|api\/screens/);
    expect(source).not.toMatch(/present-view|kiosk-settings-panel|toggle-/);
  });
});

// --- budget and masking -----------------------------------------------------------------------
describe('the redemption budget', () => {
  it('allows one redemption per surface, spaced from the moment each was redeemed (its /api/scan response), not from its navigation', () => {
    const b = redemptionBudget();
    expect(b.waitMs('phone', 0)).toBe(0);
    b.take('phone', 1_000);
    // Until the phone's scan has answered, nothing else may start: its redemption time is not known yet.
    expect(() => b.waitMs('desktop', 2_000)).toThrow(/the phone's redemption is not confirmed yet/);
    expect(() => b.take('desktop', 2_000)).toThrow(/not confirmed yet/);
    // The scan answered 8 s after the navigation: the spacing runs from there.
    b.redeemed('phone', 9_000);
    expect(b.waitMs('desktop', 9_000)).toBe(REDEMPTION_SPACING_MS);
    expect(b.waitMs('desktop', 19_000)).toBe(2_000);
    expect(b.waitMs('desktop', 21_000)).toBe(0);
    expect(() => b.take('desktop', 13_000)).toThrow(/redemptions 4000 ms apart \(at least 12000 ms\)/);
    expect(() => b.take('phone', 60_000)).toThrow(/already redeemed 1 code/);
    expect(() => b.waitMs('phone', 60_000)).toThrow(/already redeemed/);
    b.take('desktop', 21_000);
    b.redeemed('desktop', 21_400);
    // A late answer still moves the spacing on: the next wait counts from the latest redemption.
    b.redeemed('phone', 30_000);
    expect(b.counts()).toEqual({ phone: 1, desktop: 1 });
    expect(b.times()).toEqual([{ surface: 'phone', at: 9_000 }, { surface: 'desktop', at: 21_400 }, { surface: 'phone', at: 30_000 }]);
    expect(b.failures()).toEqual([]);
  });

  // Review round 2: a redemption that timed out was treated as confirmed at the timeout, so a late answer could land
  // beside the next surface's. It is recorded as failed, never as a confirmation; the next one still waits the spacing.
  it('records a redemption with no /api/scan answer as failed, not confirmed, and keeps the next one spaced from it', () => {
    const b = redemptionBudget();
    b.take('phone', 0);
    b.failed('phone', 60_000);
    expect(b.times()).toEqual([]);
    expect(b.failures()).toEqual([{ surface: 'phone', at: 60_000 }]);
    expect(b.counts()).toEqual({ phone: 1 });
    expect(() => b.take('phone', 90_000)).toThrow(/already redeemed 1 code/);
    // The cancelled scan may have been redeemed up to its failure: the desktop waits the spacing from there.
    expect(b.waitMs('desktop', 60_000)).toBe(REDEMPTION_SPACING_MS);
    expect(() => b.take('desktop', 65_000)).toThrow(/ms apart/);
    b.take('desktop', 72_000);
    b.redeemed('desktop', 72_300);
    expect(b.times()).toEqual([{ surface: 'desktop', at: 72_300 }]);
    // Failed for good: a late phone answer is late, never a confirmation, though it still moves the spacing on.
    expect(b.redeemed('phone', 80_000)).toBe(false);
    expect(b.times()).toEqual([{ surface: 'desktop', at: 72_300 }]);
    expect(b.lates()).toEqual([{ surface: 'phone', at: 80_000 }]);
    b.settle('phone', 61_000, 'page.goto: net::ERR_FAILED');
    expect(b.failures()).toEqual([{ surface: 'phone', at: 61_000, cancelError: 'page.goto: net::ERR_FAILED' }]);
  });
});

describe('masking', () => {
  it('removes the secret, the kiosk and scan fragments, ticket-like values and every code it has seen', () => {
    const scrub = makeScrubber(['ABCDEFGH.s3cr3t-part', 's3cr3t-part']);
    scrub.noteCode('7K3M·QX9P');
    const text = scrub(`${KIOSK_URL} https://zagreb.example/s/#7K3M-QX9P /d/?room=R1&ticket=T2&x=1 code 7K3M·QX9P half 7K3M and QX9P, s3cr3t-part`);
    expect(text).not.toMatch(/s3cr3t|7K3M|QX9P|R1|T2/);
    expect(text).toContain('/kiosk/#…');
    expect(text).toContain('/s/#…');
    expect(text).toContain('room=…&ticket=…&x=1');
    expect(text).toContain('••••·••••');
  });
});

// --- the table ----------------------------------------------------------------------------------
describe('the thresholds are one table with a stage per row', () => {
  it('every row names a stage, a surface, a metric the observer computes, a bound and a filled target', () => {
    const ids = new Set<string>();
    for (const t of THRESHOLDS) {
      expect(STAGES).toContain(t.stage);
      expect([...SURFACES, 'all']).toContain(t.surface);
      expect(METRICS[t.metric], t.metric).toBeTypeOf('function');
      expect(t.min !== undefined || t.max !== undefined, t.id).toBe(true);
      expect(ids.has(t.id), t.id).toBe(false);
      ids.add(t.id);
      expect(fillTarget(t.target, instruments)).not.toMatch(/\{[A-Z_]+\}/);
    }
  });

  it('--stage d1 applies the pills and the recorders only (plus the run footprint and that the wall was read)', () => {
    expect(thresholdsFor('d1').map((t) => t.id)).toEqual(['wall-read', 'pills-plus', 'karta-pills-plus', 'recorders-kiosk', 'recorders-phone', 'recorders-desktop', 'no-screen', 'redemptions']);
    expect(thresholdsFor('d2').length).toBeGreaterThan(thresholdsFor('d1').length);
    expect(thresholdsFor('full')).toEqual([...THRESHOLDS]);
    expect(stageIndex('full')).toBe(STAGES.length - 1);
  });

  it('the targets carry the accept specs\' own numbers and strings', () => {
    const target = (id: string): string => fillTarget(THRESHOLDS.find((t) => t.id === id)!.target, instruments);
    expect(target('departures')).toContain(`${wall.DEPARTURES_MIN}–${wall.DEPARTURES_MAX}`);
    expect(target('sentence-length')).toContain(`1–${wall.SENTENCE_MAX_CHARS}`);
    expect(target('lead')).toContain('"Skeniraj za 10 minuta grada."');
    expect(target('phone-tabs')).toContain('Sada · Karta · Još');
    expect(target('phone-share')).toContain('"Podijeli grad"');
    expect(target('pills-plus')).toContain(String(wall.PLUS_PILL_RE));
    expect(target('qr')).toContain(`${wall.QR_MIN_PX} × ${wall.QR_MIN_PX}`);
    expect(() => fillTarget('{NO_SUCH_CONSTANT}', instruments)).toThrow(/NO_SUCH_CONSTANT/);
  });

  it('§12 counts a turn whose sentence was shown less than ten minutes before, not one shown earlier', () => {
    const s = (atMs: number, sentence: string, validUntil: string | null = null): WallSample => ({ ...wallReading(0), at: atMs, sentence, validUntil });
    const r = repeatsWithin([s(0, 'A', 'v1'), s(2_000, 'A', 'v1'), s(20_000, 'B', 'v2'), s(40_000, 'A', 'v3'), s(700_000, 'B', 'v4')], 600_000);
    expect(r.turns).toBe(4);
    expect(r.distinct).toBe(2);
    expect(r.repeats.map((x) => x.sentence)).toEqual(['A']);
  });

  it('a row applied at its stage fails when it could not be measured; above the stage it is information', () => {
    const config = configFrom({ argv: ['--stage', 'd1'], env: ENV, root, now: new Date(T0) });
    const obs = newObservation(config, null);
    const d1 = judge(obs, instruments, 'd1');
    expect(d1.rows.find((r) => r.id === 'wall-read')!.status).toBe('fail');
    expect(d1.rows.find((r) => r.id === 'place')!.status).toBe('info');
    expect(d1.ok).toBe(false);
  });
});

// --- page-side readings, shipped from their own text -----------------------------------------------
const shipped = <F extends (...args: never[]) => unknown>(fn: F): F => new Function(`return (${String(fn)});`)() as F;
const box = (el: Element, top: number, height = 40, width = 200, left = 0): void => {
  (el as HTMLElement).getBoundingClientRect = () => ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON: () => ({}) }) as DOMRect;
};

describe('the page-side readings reference only their argument and the DOM', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('pairing: the code from its two halves, the scan link and the progress', () => {
    document.body.innerHTML = '<p data-testid="pair-code"><span data-testid="code-a">7K3M</span>·<span data-testid="code-b">QX9P</span></p><a data-testid="pair-url" href="https://zagreb.example/s/#7K3M-QX9P"></a><div data-testid="code-progress" aria-valuenow="60"></div>';
    expect(shipped(PAIRING_IN_PAGE)(PAIRING_PROBES)).toEqual({ code: '7K3M-QX9P', href: 'https://zagreb.example/s/#7K3M-QX9P', progress: 60 });
    expect(shipped(INVITATION_READY_IN_PAGE)({ invitation: 'p', code: '[data-testid=pair-code]', shown: { source: lib.CODE_SHOWN_RE.source, flags: '' } })).toBe(true);
    expect(shipped(ANY_PRESENT_IN_PAGE)({ selectors: ['.nothing', '[data-testid=pair-url]'] })).toBe(true);
  });

  it('the map settles once its status leaves loading', () => {
    document.body.innerHTML = '<div data-testid="kiosk-map" data-map-status="loading"></div>';
    const settled = shipped(MAP_SETTLED_IN_PAGE);
    expect(settled({ map: '[data-testid=kiosk-map]', pending: ['loading'] })).toBe(false);
    document.querySelector('div')!.setAttribute('data-map-status', 'tiles-failed');
    expect(settled({ map: '[data-testid=kiosk-map]', pending: ['loading'] })).toBe(true);
  });

  // Production 24 Sep 02:43: the portrait was read 2.5 s after the map left `loading` and carried no data-unlabelled,
  // data-markers or data-pills, so unlabelled, pills-drawn and legibility failed on a census not yet taken. The accept
  // spec's settle waits for the census, then for pills where there are vehicles; the observer's settle does the same.
  it('the wall settles as the accept spec does: the census written (data-unlabelled), then vehicle pills (data-pills)', () => {
    document.body.innerHTML = '<div data-testid="kiosk-map" data-map-status="ready"></div>';
    const spec = { map: '[data-testid=kiosk-map]' };
    const map = document.querySelector('div')!;
    expect(shipped(MAP_CENSUS_IN_PAGE)(spec)).toBe(false);
    expect(shipped(PILLS_DRAWN_IN_PAGE)(spec)).toBe(false);
    map.setAttribute('data-unlabelled', '0');
    map.setAttribute('data-pills', ' ');
    expect(shipped(MAP_CENSUS_IN_PAGE)(spec)).toBe(true);
    expect(shipped(PILLS_DRAWN_IN_PAGE)(spec)).toBe(false);
    map.setAttribute('data-pills', '13·33|31|32');
    expect(shipped(PILLS_DRAWN_IN_PAGE)(spec)).toBe(true);
    document.body.innerHTML = '';
    expect(shipped(MAP_CENSUS_IN_PAGE)(spec)).toBe(false);
    expect(shipped(PILLS_DRAWN_IN_PAGE)(spec)).toBe(false);
  });

  it('phone Sada: place, sentence, departures inside the viewport, slop, visible tabs and the share button', () => {
    const P = inventory.PHONE_PROBES;
    document.body.innerHTML = `
      <p data-testid="sada-place">Trg bana J. Jelačića</p>
      <p data-testid="sada-sentence" data-kicker="promet">Tramvaj 6 kreće za dvije minute.</p>
      <ul data-testid="day-departures">${[0, 1, 2, 3].map((i) => `<li class="sada-departure" data-kind="departure">6 Sopot ${i + 2} min</li>`).join('')}<li class="sada-departure" style="opacity: 0">11 Dubec</li><li class="sada-departure">12 Dubrava</li></ul>
      <nav><a class="ki-tab">Sada</a><a class="ki-tab">Karta</a><a class="ki-tab">Još</a><a class="ki-tab" hidden>Promet</a></nav>
      <button data-testid="share-city">Podijeli grad</button><p>Sada u gradu.</p>`;
    const rows = document.querySelectorAll('li.sada-departure');
    rows.forEach((el, i) => box(el, 200 + i * 60));
    box(rows[3], innerHeight - 10);
    // A transparent row is not shown; a row pushed sideways out of the viewport is shown but not inside it.
    box(rows[5], 260, 40, 200, innerWidth + 20);
    document.querySelectorAll('.ki-tab, [data-testid=share-city], [data-testid=sada-place], [data-testid=sada-sentence]').forEach((el) => box(el, 10));
    const read = shipped(PHONE_READ_IN_PAGE)({ place: P.sadaPlace, sentence: P.sadaSentence, departures: inventory.PHONE_DEPARTURE_ROWS, tab: P.tab, shareCity: P.shareCity, slop: { source: inventory.PHONE_SLOP_RE.source, flags: inventory.PHONE_SLOP_RE.flags } }) as PhoneRead;
    expect(read.place).toBe('Trg bana J. Jelačića');
    expect(read.sentenceChars).toBe('Tramvaj 6 kreće za dvije minute.'.length);
    expect(read.departures).toEqual({ total: 5, inViewport: 3 });
    expect(read.slop).toEqual(['Sada u gradu']);
    expect(read.tabs).toEqual(['Sada', 'Karta', 'Još']);
    expect(read.shareCity).toEqual({ present: true, visible: true, text: 'Podijeli grad' });
  });

  // Review round 2, item 2: a share code that is transparent, invisible, collapsed or boxless is not shown; the
  // page-side readings of the observer use wall.ts's rule, and one battery holds them all to it.
  it('one visibility rule for every page-side reading: transparent, invisible, collapsed, boxless and [hidden] elements are not shown', () => {
    const P = inventory.PHONE_PROBES;
    const cases: [string, string, (el: HTMLElement) => void][] = [
      ['opacity 0', 'style="opacity: 0"', () => {}],
      ['a transparent ancestor', '', (el) => { el.parentElement!.style.opacity = '0'; }],
      ['visibility hidden', 'style="visibility: hidden"', () => {}],
      ['display none', 'style="display: none"', () => {}],
      ['an invisible ancestor', '', (el) => { el.parentElement!.style.visibility = 'hidden'; }],
      ['zero size', '', (el) => box(el, 300, 0, 0)],
      ['a [hidden] ancestor', '', (el) => { el.parentElement!.hidden = true; }],
    ];
    for (const [name, attr, tweak] of cases) {
      document.body.innerHTML = `<div class="host"><p data-testid="share-code" ${attr}>W4TN-8KQZ</p></div>`;
      const code = document.querySelector<HTMLElement>('[data-testid=share-code]')!;
      box(code, 300);
      tweak(code);
      expect(shipped(SHARE_CODE_IN_PAGE)({ code: P.shareCode }), `share code, ${name}`).toMatchObject({ present: true, visible: false });

      document.body.innerHTML = `<section data-testid="stop-board"><div class="host"><li data-kind="departure" ${attr}>6 Sopot 2 min</li></div></section>`;
      box(document.querySelector('[data-testid=stop-board]')!, 200, 400, 390);
      const li = document.querySelector<HTMLElement>('li')!;
      box(li, 220, 50, 358, 16);
      tweak(li);
      expect(shipped(STOP_BOARD_READ_IN_PAGE)({ board: P.stopBoard, rows: `${P.stopBoard} ${P.departureRows}` }), `stop board row, ${name}`).toMatchObject({ total: 0 });

      document.body.innerHTML = `<ul data-testid="day-departures"><div class="host"><li class="sada-departure" ${attr}>6 Sopot</li></div></ul>`;
      const row = document.querySelector<HTMLElement>('li')!;
      box(row, 220);
      tweak(row);
      const read = shipped(PHONE_READ_IN_PAGE)({ place: P.sadaPlace, sentence: P.sadaSentence, departures: inventory.PHONE_DEPARTURE_ROWS, tab: P.tab, shareCity: P.shareCity, slop: { source: 'x^', flags: '' } }) as PhoneRead;
      expect(read.departures, `Sada row, ${name}`).toEqual({ total: 0, inViewport: 0 });

      document.body.innerHTML = `<div class="host"><section data-testid="session-ended" ${attr}><a href="/s/">Skeniraj</a><a href="/hitno">Hitno</a></section></div>`;
      const ended = document.querySelector<HTMLElement>('[data-testid=session-ended]')!;
      box(ended, 100, 300, 390);
      document.querySelectorAll('a').forEach((a) => box(a, 120, name === 'zero size' ? 0 : 40, name === 'zero size' ? 0 : 200));
      tweak(ended);
      const x = shipped(inventory.EXPIRY_READ_IN_PAGE)(inventory.EXPIRY_SPEC) as ExpiryReading;
      expect([x.ended, x.scanLinks, x.hitnoLinks], `session-ended, ${name}`).toEqual([false, 0, 0]);
    }
    document.body.innerHTML = '';
  });

  it('the share code, and the stop board with its departures inside the viewport', () => {
    const P = inventory.PHONE_PROBES;
    document.body.innerHTML = '<p data-testid="share-code">W4TN-8KQZ</p><section data-testid="stop-board"><ol><li data-kind="departure">6 Sopot 2 min</li><li data-kind="departure">11 Dubec 5 min</li><li data-kind="departure">12 Dubrava 8 min</li><li data-kind="departure">13 Žitnjak 9 min</li></ol></section>';
    box(document.querySelector('[data-testid=share-code]')!, 300);
    expect(shipped(SHARE_CODE_IN_PAGE)({ code: P.shareCode })).toEqual({ present: true, visible: true, text: 'W4TN-8KQZ' });
    box(document.querySelector('[data-testid=stop-board]')!, 400, 400, 390);
    const items = document.querySelectorAll('[data-testid=stop-board] li');
    items.forEach((el, i) => box(el, 420 + i * 60, 50, 358, 16));
    box(items[3], 420, 50, 358, innerWidth + 10);
    const board = shipped(STOP_BOARD_READ_IN_PAGE)({ board: P.stopBoard, rows: `${P.stopBoard} ${P.departureRows}` }) as StopBoardRead;
    expect(board).toEqual({ open: true, total: 4, inViewport: 3, texts: ['6 Sopot 2 min', '11 Dubec 5 min', '12 Dubrava 8 min', '13 Žitnjak 9 min'] });
    document.querySelector<HTMLElement>('[data-testid=stop-board]')!.hidden = true;
    expect(shipped(STOP_BOARD_READ_IN_PAGE)({ board: P.stopBoard, rows: `${P.stopBoard} ${P.departureRows}` })).toMatchObject({ open: false, total: 0 });
  });

  // Production 24 Sep 02:31: the search opened "Bana Josipa Jelačića" with its three departures on screen and the
  // observer read "not open". The probe wrapper is display: contents (app/src/ui/map.css .t-stop-board), a 0 × 0 box
  // by construction; the accept spec reads the board's first rendered child (e2e/accept/phone.spec.ts), and so does this.
  it('a stop board whose wrapper is display: contents is open when its first rendered child is in the viewport', () => {
    const P = inventory.PHONE_PROBES;
    const spec = { board: P.stopBoard, rows: `${P.stopBoard} ${P.departureRows}` };
    const lay = (headTop: number, headHidden = false): void => {
      document.body.innerHTML = '<div class="t-stop-board" data-testid="stop-board" style="display: contents"><div class="t-head"><h3>Bana Josipa Jelačića</h3></div>'
        + '<section data-testid="stop-arrivals"><ul><li data-kind="departure">177 G. Bistra 04:31</li><li data-kind="departure">177 Črnomerec 05:01</li><li data-kind="departure">177 G. Bistra 05:21</li></ul></section></div>';
      const board = document.querySelector<HTMLElement>('[data-testid=stop-board]')!;
      box(board, 0, 0, 0);
      const [head, arrivals] = [...board.children] as HTMLElement[];
      box(head, headTop, 60, 390);
      if (headHidden) head.style.display = 'none';
      box(arrivals, 200, 240, 390);
      document.querySelectorAll('li').forEach((el, i) => box(el, 210 + i * 70, 60, 358, 16));
    };
    lay(100);
    expect(shipped(STOP_BOARD_READ_IN_PAGE)(spec)).toEqual({ open: true, total: 3, inViewport: 3, texts: ['177 G. Bistra 04:31', '177 Črnomerec 05:01', '177 G. Bistra 05:21'] });
    // The first rendered child is the one that counts: a hidden head gives way to the arrivals.
    lay(100, true);
    expect(shipped(STOP_BOARD_READ_IN_PAGE)(spec)).toMatchObject({ open: true, total: 3 });
    // Its first rendered child below the viewport: the board is not open.
    lay(innerHeight + 20);
    expect(shipped(STOP_BOARD_READ_IN_PAGE)(spec)).toMatchObject({ open: false });
    // A hidden wrapper hides everything in it, display: contents or not.
    lay(100);
    document.querySelector<HTMLElement>('[data-testid=stop-board]')!.hidden = true;
    expect(shipped(STOP_BOARD_READ_IN_PAGE)(spec)).toMatchObject({ open: false, total: 0 });
  });

  it('Karta and the desktop: the map probes, disclosures, and whether Sada and Karta both sit in the viewport', () => {
    document.body.innerHTML = '<div data-testid="map-canvas" data-map-status="ready" data-pills="6|11" data-unlabelled="0" data-markers="12" data-bodies="40"></div><details class="city-filter-disclosure"></details><section id="layer-grad-sada"></section><section data-testid="transport-workspace"></section>';
    expect(shipped(KARTA_READ_IN_PAGE)({ map: '[data-testid=map-canvas]', disclosures: inventory.PHONE_PROBES.kartaDisclosures })).toEqual({ status: 'ready', pills: '6|11', bodies: 40, unlabelled: 0, markers: 12, disclosures: 1 });
    box(document.querySelector('#layer-grad-sada')!, 0);
    box(document.querySelector('[data-testid=transport-workspace]')!, innerHeight + 5);
    const d = shipped(DESKTOP_READ_IN_PAGE)({ sada: '#layer-grad-sada', karta: '[data-testid=transport-workspace]', domains: '.ki-domains', shareCity: '[data-testid=share-city]' }) as DesktopRead;
    expect(d).toEqual({ sadaInViewport: true, kartaInViewport: false, domains: 0, shareCityVisible: false });
  });

  it('the validator census: every data-skipped-text by its surface, in the formats the kiosk root and the timeline write', () => {
    // The kiosk root's value comes from the wall's own writer, so a format change there turns this red.
    const root = skippedTextCensus(['instruction', 'link', 'instruction']);
    document.body.innerHTML = `<div data-testid="kiosk" data-skipped-text="${root}"><section data-testid="nearby" data-skipped-text="1"></section></div><p>no census</p>`;
    const entries = shipped(SKIPPED_TEXT_IN_PAGE)(SKIPPED_TEXT_SPEC) as SkippedTextEntry[];
    expect(entries).toEqual([{ surface: 'kiosk', value: 'count:3;link:1;instruction:2' }, { surface: 'nearby', value: '1' }]);
    expect(skippedTextOf(entries)).toEqual({ total: 4, surfaces: [{ surface: 'kiosk', count: 3, reasons: { link: 1, instruction: 2 } }, { surface: 'nearby', count: 1, reasons: {} }] });
    expect(parseSkippedText(skippedTextCensus([]))).toEqual({ count: 0, reasons: {} });
    expect(parseSkippedText('0')).toEqual({ count: 0, reasons: {} });
    expect(parseSkippedText('link:1')).toEqual({ count: null, reasons: {}, raw: 'link:1' });
    expect(parseSkippedText('')).toEqual({ count: null, reasons: {}, raw: '' });
    // A wall that writes no census (a build before D2) has no total, not a total of 0.
    document.body.innerHTML = '<div data-testid="kiosk"></div>';
    expect(skippedTextOf(shipped(SKIPPED_TEXT_IN_PAGE)(SKIPPED_TEXT_SPEC) as SkippedTextEntry[])).toEqual({ total: null, surfaces: [] });
  });

  it('the census summary: total over the readings, the largest reading with its surfaces, the reasons and the flagged readings', () => {
    const at = (n: number, entries: SkippedTextEntry[] | null): ObservedRotationRow => ({ at: T0 + n, error: 'x', n, skippedText: entries === null ? { total: null, surfaces: [], error: 'gone' } : skippedTextOf(entries) });
    const s = summariseSkippedText([
      at(0, [{ surface: 'kiosk', value: 'count:0' }, { surface: 'nearby', value: '0' }]),
      at(1, [{ surface: 'kiosk', value: 'count:2;link:1;instruction:1' }, { surface: 'nearby', value: '1' }]),
      at(2, [{ surface: 'kiosk', value: 'count:1;instruction:1' }, { surface: 'nearby', value: '0' }]),
      at(3, null),
    ]);
    expect(s).toEqual({
      readings: 4, withCensus: 3, withSkip: 2, total: 4, max: 3, maxReading: 1,
      maxSurfaces: [{ surface: 'kiosk', count: 2 }, { surface: 'nearby', count: 1 }],
      bySurface: { kiosk: 3, nearby: 1 }, reasons: { link: 1, instruction: 2 }, flagged: [1, 2], errors: 1,
    });
  });
});

// --- whole runs over a fake browser ------------------------------------------------------------------
function row(over: Partial<WallRow>): WallRow {
  return { id: null, kind: 'departure', when: null, always: false, live: false, source: 'zet', title: '', whenText: '', sub: '', hasTime: true, text: '', caveat: false, ...over };
}
/** A reading of a wall that holds every §16.3 row; `n` makes its sentence and validity unique. */
function wallReading(n: number, at = T0 + n * 2_000, code = CODES[0].replace('-', '·')): WallSample {
  const rows = [
    row({ id: `trip-${n}`, when: new Date(at + 120_000).toISOString(), title: '6 Sopot', whenText: '2 min', text: '6 Sopot 2 min' }),
    row({ id: 'solar', kind: 'solar', when: new Date(at + 3_600_000).toISOString(), title: 'Zalazak sunca', whenText: '18:57', text: 'Zalazak sunca 18:57', source: 'solar' }),
  ];
  const sentence = `Tramvaj ${n} kreće za dvije minute.`;
  return {
    at, place: 'Trg bana J. Jelačića', sentence, kicker: 'promet', kickerText: 'Promet', validUntil: new Date(at + 1_000).toISOString(),
    sentenceChars: [...sentence].length, sentenceOverflow: false, sentenceEllipsis: false, head: wall.NEARBY_HEAD_2KM, rows, hiddenRows: 0,
    departures: 1, solarRows: 1, liveRows: 0, pills: '6|12|17', bodies: 41, zoom: '14.20', feed: 'live', mapStatus: 'ready', unlabelled: 0,
    markers: 12, frame: '6', mapNotes: 0, theme: 'light', code, codeState: 'live', qr: { w: 240, h: 240 }, lead: wall.LEAD_TEXT,
    strip: 'Mirno · DHMZ · EMSC', stripHasClock: false, pharmacy: '24/7 Ilica 1', pharmacySymbols: 1, controls: 0, controlNames: [],
    retiredChrome: 0, settingsOpen: false, stopBoardOpen: false, headings: ['U blizini'],
  };
}
const EMPTY_INVENTORY = (vw: number, vh: number): PageInventory => ({ vw, vh, scrollY: 0, url: 'https://zagreb.example/kiosk/#ABCDEFGH.s3cr3t-part', title: 'Kaj ima?', theme: 'light', map: null, elements: [] });
const recorded = (name: string): PageInventory => {
  const { label: _l, at: _a, zagreb: _z, surface: _s, scenario: _c, ...raw } = JSON.parse(readFileSync(join(root, 'test/fixtures/inventory', name), 'utf8')) as RawInventory;
  return raw;
};
/** The wall map's census as WP2-E's render probe writes it on the canvas map's container. */
const CANVAS_MAP = { selector: '[data-testid=kiosk-map]', element: 'div[data-testid=kiosk-map]', domSymbols: 0, missing: [], markers: 3, unlabelled: 0, bajs: { counted: 1, zero: 1, blank: 1, far: 0 }, overlaps: { discs: 2, names: 17 }, pills: 28 };
const GOOD_PHONE: PhoneRead = { place: 'Trg bana J. Jelačića', sentence: 'Tramvaj 6 kreće za dvije minute.', sentenceChars: 32, departures: { total: 3, inViewport: 3 }, slop: [], tabs: ['Sada', 'Karta', 'Još'], shareCity: { present: true, visible: true, text: 'Podijeli grad' } };
const GOOD_KARTA: KartaRead = { status: 'ready', pills: '6|11|12', bodies: 40, unlabelled: 0, markers: 10, disclosures: 0 };
const GOOD_DESKTOP: DesktopRead = { sadaInViewport: true, kartaInViewport: true, domains: 0, shareCityVisible: true };
const GOOD_SHARE = { present: true, visible: true, text: 'W4TN-8KQZ' };
const GOOD_BOARD: StopBoardRead = { open: true, total: 3, inViewport: 3, texts: ['6 Sopot 2 min', '11 Dubec 5 min', '12 Dubrava 8 min'] };
const GOOD_EXPIRY: ExpiryReading = { ended: true, scanLinks: 1, hitnoLinks: 1, rows: 0, rowTexts: [], exportControls: 0 };
/** The wall's validator census when nothing was left out: the kiosk root and the timeline both write 0. */
const QUIET_CENSUS: SkippedTextEntry[] = [{ surface: 'kiosk', value: 'count:0' }, { surface: 'nearby', value: '0' }];
const GOOD_CALM: CalmMotionReading = { rootFound: true, before: 3, after: 3, mutations: 2, textSwaps: 5, kept: 2, rebuilt: [], left: ['departure|trip-0'], entered: ['departure|trip-9'], untracked: 0 };

type Kind = 'kiosk' | 'portrait' | 'proxy' | 'phone' | 'desktop';
/** What e2e/legibility.ts reports for the canvas map before its census is written (the 24 Sep portrait). */
const CENSUS_MISSING = {
  violations: [{ tier: 'symbol', selector: '[data-testid=kiosk-map]', element: 'div.k-map-canvas.maplibregl-map[data-testid=kiosk-map]', text: '', px: 0, mm: 0, floorMm: 40, detail: 'the map [data-testid=kiosk-map] draws on one canvas with no [data-symbol] mark and no data-markers, data-unlabelled, data-bajs, data-overlaps, data-pills: its BAJS discs and vehicle pills would go unmeasured' }],
  warnings: [], symbols: [], otherSmall: [], dark: false,
  map: { ...CANVAS_MAP, markers: null, unlabelled: null, bajs: null, overlaps: null, pills: null, missing: ['markers', 'unlabelled', 'bajs', 'overlaps', 'pills'] },
};
/** A zet-rt snapshot as the worker sends it: the teaser's fleet count (`vozila`), `pins` moving vehicles, one route summary. */
function zetSnapshot(pins: number, teaser: boolean, status = 'live') {
  const vehicles = Array.from({ length: pins }, (_, i) => ({ id: `vehicle:${1000 + i}`, module: 'zet-rt', kind: 'vehicle', title: `${31 + i}`, geo: { type: 'Point', coordinates: [15.97, 45.81] } }));
  const route = { id: 'route:0_31', module: 'zet-rt', kind: 'vehicle', title: '31', data: { routeId: '0_31', vehicles: pins } };
  return { module: 'zet-rt', status, fetchedAt: new Date(T0).toISOString(), items: [...(teaser ? [{ id: 'vozila', module: 'zet-rt', kind: 'vehicle', title: `${pins} vozila u pokretu`, data: { vehicles: pins + 40 } }] : []), ...vehicles, route] };
}
/** A data response on the fake page: the recorder and the observer's own watcher both read it. */
const zetResponse = (path: string, pins: number, teaser: boolean) => {
  const body = teaser ? { generatedAt: new Date(T0).toISOString(), modules: [zetSnapshot(pins, true)] } : zetSnapshot(pins, false);
  return { url: () => `https://zagreb.example${path}`, status: () => 200, request: () => ({ method: () => 'GET' }), headers: () => ({ 'content-type': 'application/json' }), json: async () => body, body: async () => Buffer.from(JSON.stringify(body)) };
};
interface FakeOptions {
  reading?: (n: number, at: number, code: string) => WallSample;
  inventories?: Partial<Record<'kiosk' | 'portrait' | 'phone-sada' | 'phone-karta' | 'desktop', PageInventory>>;
  phone?: PhoneRead;
  karta?: KartaRead;
  desktop?: DesktopRead;
  axeViolations?: { id: string; impact: string; nodes: unknown[] }[];
  kioskConsoleError?: string;
  noInvitation?: boolean;
  /** Only these pages never show their invitation (the portrait, say). */
  noInvitationOn?: Kind[];
  /** The wall reading number `n` (0 the first, 1… the rotation) throws, as a page that navigated would. */
  failReading?: (n: number) => boolean;
  /** How long the phone's /api/scan takes to answer after its navigation. */
  scanDelayMs?: number;
  /** How long each code stays on the fake screen (30 s, the real rotation, by default). */
  codeWindowMs?: number;
  /** What share-code shows after the tap on share-city. */
  shareCode?: { present: boolean; visible: boolean; text: string };
  stopBoard?: StopBoardRead;
  expiry?: ExpiryReading;
  /** An /api/data request the phone makes after its session ended. */
  requestAfterExpiry?: string;
  /** The phone's /api/scan answers only after the observer stopped waiting: this long after the desktop's navigation. */
  phoneAnswersAfterDesktopMs?: number;
  /** The phone's session ends this long after its scan answered (the page stamps it). */
  endsAfterScanMs?: number;
  /** /api/data requests the phone makes this long after its scan answered. */
  phoneRequests?: { path: string; afterScanMs: number }[];
  /** The calm-motion reading of each rotation minute, by its index. */
  calm?: (i: number) => CalmMotionReading;
  /** The wall's data-skipped-text census at rotation reading `i`, or a page that cannot answer it. */
  skippedText?: (i: number) => SkippedTextEntry[];
  skippedTextThrows?: boolean;
  /** How the phone's cancellation (its page left for about:blank) goes: the held answer lands during it, or it rejects. */
  cancel?: 'answers' | 'rejects';
  /** The page-side end stamp: its watch cannot be installed, or it never stamps. */
  expiryWatch?: 'rejects' | 'no-stamp';
  /** The observer comes to look at the ended session this long after the phone's scan answered. */
  expirySeenAfterScanMs?: number;
  /** The wall map writes its census this long after the page opened: before it a reading has no data-unlabelled,
   *  data-markers or data-pills, and the legibility pass finds a canvas map without its census (production, 24 Sep). */
  censusAfterMs?: Partial<Record<Kind, number>>;
  /** Vehicle pills are drawn this long after the page opened (Infinity: never); before it data-pills is empty. */
  pillsAfterMs?: Partial<Record<Kind, number>>;
  /** Each wall page reads one /api/teaser whose zet-rt snapshot carries this many vehicle pins (none read without it). */
  teaserPins?: number;
  /** The phone reads one /api/data/zet-rt with this many vehicle pins right after its scan answers. */
  phonePins?: number;
  /** A click on this selector reports Playwright's timeout, as the stop search's result did on 24 Sep 03:40 while the board opened. */
  clickTimesOut?: string;
  /** The stop board never opens (a wait for it times out). */
  noStopBoard?: boolean;
  /** The Karta's marker census (data-unlabelled, data-markers) lands this long after the Karta's first read;
   *  before it the Karta read carries its pills and no census (lane p-map: the pills no longer wait for it). */
  kartaCensusAfterMs?: number;
}
interface Handler { (arg: unknown): unknown }

function fakeRuntime(options: FakeOptions = {}) {
  let t = T0;
  // Events due at a later fake time (a late /api/scan answer, a poll after the session ended), fired as the
  // clock passes them; a page's own are cancelled when it leaves for about:blank, as a browser cancels them.
  const due: { at: number; kind: Kind; fire: () => void }[] = [];
  const advance = (ms: number): void => {
    const target = t + ms;
    // Each event fires at its own due time, the clock standing there while it does.
    for (;;) {
      const next = due.filter((e) => e.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      due.splice(due.indexOf(next), 1);
      t = Math.max(t, next.at);
      next.fire();
    }
    t = Math.max(t, target);
  };
  const clock = { now: () => t, sleep: async (ms: number) => { advance(ms); } };
  const log = {
    contexts: [] as { kind: Kind; options: Record<string, unknown> }[], gotos: [] as { kind: Kind; url: string; at: number }[], clicks: [] as { kind: Kind; selector: string }[],
    keys: [] as { kind: Kind; key: string }[], fills: [] as { kind: Kind; selector: string; value: string }[], scans: [] as { kind: Kind; at: number }[], readings: 0,
    cancelled: [] as Kind[], watches: [] as Kind[],
  };
  const codeNow = (): string => CODES[Math.floor((t - T0) / (options.codeWindowMs ?? 30_000)) % CODES.length];
  const kindOf = (o: Record<string, unknown>): Kind => {
    const vp = o.viewport as { width: number } | undefined;
    if (o.isMobile) return 'phone';
    if (vp?.width === 1440) return 'desktop';
    if (vp?.width === 1080) return 'portrait';
    return o.deviceScaleFactor === scenes.PROXY_DEVICE_SCALE_FACTOR ? 'proxy' : 'kiosk';
  };
  const page = (kind: Kind) => {
    const handlers = new Map<string, Handler[]>();
    const emit = (event: string, arg: unknown): void => { for (const fn of handlers.get(event) ?? []) void fn(arg); };
    let onKarta = false;
    let expiryReads = 0;
    /** When the Karta was first read (kartaCensusAfterMs counts from it). */
    let kartaFirstAt: number | null = null;
    let answered = false;
    let calmReads = 0;
    let censusReads = 0;
    let endedAt: number | null = null;
    let openedAt: number | null = null;
    const dueOf = (after: Partial<Record<Kind, number>> | undefined): number => (openedAt ?? t) + (after?.[kind] ?? 0);
    const inv = (key: keyof NonNullable<FakeOptions['inventories']>, vw: number, vh: number): PageInventory => options.inventories?.[key] ?? EMPTY_INVENTORY(vw, vh);
    return {
      on(event: string, fn: Handler) { handlers.set(event, [...(handlers.get(event) ?? []), fn]); return this; },
      async goto(url: string) {
        log.gotos.push({ kind, url, at: t });
        if (url === 'about:blank') {
          if (kind === 'phone' && options.cancel === 'rejects') throw new Error('page.goto: net::ERR_FAILED at about:blank');
          const held = due.find((x) => x.kind === kind && x.at === Infinity);
          if (kind === 'phone' && options.cancel === 'answers' && held) { due.splice(due.indexOf(held), 1); held.fire(); }
          for (const e of due.filter((x) => x.kind === kind)) { due.splice(due.indexOf(e), 1); log.cancelled.push(kind); }
          return;
        }
        openedAt ??= t;
        if (options.teaserPins !== undefined && (kind === 'kiosk' || kind === 'portrait' || kind === 'proxy')) emit('response', zetResponse('/api/teaser?stop=106_1', options.teaserPins, true));
        if (kind === 'kiosk' && options.kioskConsoleError) emit('console', { type: () => 'error', text: () => options.kioskConsoleError, location: () => ({ url: 'https://zagreb.example/assets/kiosk.js' }) });
        if (url.includes('/s/#')) {
          const answer = (): void => {
            log.scans.push({ kind, at: t });
            answered = true;
            emit('response', { url: () => 'https://zagreb.example/api/scan', status: () => 200, request: () => ({ method: () => 'POST' }), headers: () => ({ 'content-type': 'application/json' }), json: async () => ({ ticket: 'T-secret', room: 'R-secret' }), body: async () => Buffer.from('') });
            for (const r of kind === 'phone' ? options.phoneRequests ?? [] : []) {
              due.push({ at: t + r.afterScanMs, kind, fire: () => emit('request', { url: () => `https://zagreb.example${r.path}`, method: () => 'GET' }) });
            }
            if (kind === 'phone' && options.endsAfterScanMs !== undefined) endedAt = t + options.endsAfterScanMs;
            if (kind === 'phone' && options.phonePins !== undefined) emit('response', zetResponse('/api/data/zet-rt', options.phonePins, false));
          };
          if (kind === 'phone' && options.phoneAnswersAfterDesktopMs !== undefined) { due.push({ at: Infinity, kind, fire: answer }); return; }
          // The phone's late answer, still in flight, lands just after the desktop's own.
          const late = kind === 'desktop' ? due.find((e) => e.kind === 'phone' && e.at === Infinity) : undefined;
          if (late) late.at = t + options.phoneAnswersAfterDesktopMs!;
          if (kind === 'phone' && options.scanDelayMs) t += options.scanDelayMs;
          answer();
        }
      },
      async waitForFunction(fn: unknown, arg?: unknown) {
        const waitsForEnd = fn === EXPIRY_STAMP_IN_PAGE || (fn === ANY_PRESENT_IN_PAGE && (arg as { selectors: string[] }).selectors.includes(inventory.PHONE_PROBES.sessionEnded));
        if (kind === 'phone' && waitsForEnd && options.expirySeenAfterScanMs !== undefined) {
          const scan = log.scans.find((x) => x.kind === 'phone')!.at;
          advance(Math.max(0, scan + options.expirySeenAfterScanMs - t));
        }
        if (kind === 'phone' && fn === EXPIRY_STAMP_IN_PAGE && options.expiryWatch === 'no-stamp') throw new Error('Timeout 690000ms exceeded.');
        if (fn === INVITATION_READY_IN_PAGE && (options.noInvitation || options.noInvitationOn?.includes(kind))) throw new Error('Timeout 90000ms exceeded.');
        if (fn === ANY_PRESENT_IN_PAGE && options.noStopBoard && (arg as { selectors: string[] }).selectors.includes(inventory.PHONE_PROBES.stopBoard)) throw new Error('Timeout 15000ms exceeded.');
        // The wall's census and its first pills come when they come; a wait that outlasts its timeout throws, as Playwright's does.
        if (kind === 'phone' && fn === MAP_CENSUS_IN_PAGE && options.kartaCensusAfterMs !== undefined) {
          const wait = (kartaFirstAt ?? t) + options.kartaCensusAfterMs - t;
          if (wait > CENSUS_TIMEOUT_MS) { advance(CENSUS_TIMEOUT_MS); throw new Error(`Timeout ${CENSUS_TIMEOUT_MS}ms exceeded.`); }
          advance(Math.max(0, wait));
          return true;
        }
        for (const [waited, after, timeout] of [[MAP_CENSUS_IN_PAGE, options.censusAfterMs, CENSUS_TIMEOUT_MS], [PILLS_DRAWN_IN_PAGE, options.pillsAfterMs, VEHICLES_TIMEOUT_MS]] as const) {
          if (fn !== waited) continue;
          const wait = dueOf(after) - t;
          if (wait > timeout) { advance(timeout); throw new Error(`Timeout ${timeout}ms exceeded.`); }
          advance(Math.max(0, wait));
        }
        // The session goes live only once the scan has answered; the observer waits SESSION_TIMEOUT_MS for it.
        if (fn === ANY_PRESENT_IN_PAGE && (arg as { selectors: string[] }).selectors.includes(SESSION_LIVE) && !answered) {
          advance(SESSION_TIMEOUT_MS);
          if (!answered) throw new Error(`Timeout ${SESSION_TIMEOUT_MS}ms exceeded.`);
        }
        return true;
      },
      async fill(selector: string, value: string) { log.fills.push({ kind, selector, value }); },
      keyboard: { press: async (key: string) => { log.keys.push({ kind, key }); } },
      async waitForTimeout(ms: number) { advance(ms); },
      async screenshot({ path }: { path: string }) { writeFileSync(path, 'png'); },
      async click(selector: string) {
        log.clicks.push({ kind, selector });
        if (kind === 'phone') onKarta = true;
        if (options.clickTimesOut && selector.startsWith(options.clickTimesOut)) { advance(STOP_BOARD_TIMEOUT_MS); throw new Error(`page.click: Timeout ${STOP_BOARD_TIMEOUT_MS}ms exceeded.\nCall log:\n  - waiting for element to be visible, enabled and stable`); }
      },
      clock: { runFor: async () => { throw new Error('the observer runs on the real clock'); } },
      async evaluate(fn: unknown, _arg?: unknown) {
        if (fn === wall.WALL_SAMPLE_IN_PAGE) {
          const n = log.readings++;
          if (options.failReading?.(n)) throw new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation');
          const reading = (options.reading ?? wallReading)(n, t, codeNow().replace('-', '·'));
          if (t < dueOf(options.censusAfterMs)) return { ...reading, unlabelled: null, markers: null, pills: '' };
          return t < dueOf(options.pillsAfterMs) ? { ...reading, pills: '' } : reading;
        }
        if (fn === inventory.COLLECT_IN_PAGE) {
          if (kind === 'phone') return onKarta ? inv('phone-karta', 412, 839) : inv('phone-sada', 412, 839);
          if (kind === 'desktop') return inv('desktop', 1440, 900);
          return kind === 'portrait' ? inv('portrait', 1080, 1920) : inv('kiosk', 1920, 1080);
        }
        if (fn === legibility.LEGIBILITY_IN_PAGE) return t < dueOf(options.censusAfterMs) ? CENSUS_MISSING : { violations: [], warnings: [], symbols: [], otherSmall: [], dark: false, map: CANVAS_MAP };
        if (fn === PAIRING_IN_PAGE) return { code: codeNow(), href: `https://zagreb.example/s/#${codeNow()}`, progress: 80 };
        if (fn === PHONE_READ_IN_PAGE) return options.phone ?? GOOD_PHONE;
        if (fn === KARTA_READ_IN_PAGE) {
          const karta = options.karta ?? GOOD_KARTA;
          kartaFirstAt ??= t;
          return options.kartaCensusAfterMs !== undefined && t < kartaFirstAt + options.kartaCensusAfterMs ? { ...karta, unlabelled: null, markers: null } : karta;
        }
        if (fn === DESKTOP_READ_IN_PAGE) return options.desktop ?? GOOD_DESKTOP;
        if (fn === SHARE_CODE_IN_PAGE) return options.shareCode ?? GOOD_SHARE;
        if (fn === STOP_BOARD_READ_IN_PAGE) return options.stopBoard ?? GOOD_BOARD;
        if (fn === inventory.EXPIRY_READ_IN_PAGE) {
          // The second read comes after the observer's wait: the request falls between the two.
          if (options.requestAfterExpiry && ++expiryReads === 2) emit('request', { url: () => `https://zagreb.example${options.requestAfterExpiry}`, method: () => 'GET' });
          return options.expiry ?? GOOD_EXPIRY;
        }
        if (fn === EXPIRY_WATCH_IN_PAGE) {
          if (options.expiryWatch === 'rejects') throw new Error('page.evaluate: Execution context was destroyed');
          log.watches.push(kind);
          return true;
        }
        if (fn === EXPIRY_STAMP_IN_PAGE && options.expiryWatch === 'no-stamp') return null;
        // The page's own stamp of the moment session-ended showed; by default the session has just ended.
        if (fn === EXPIRY_STAMP_IN_PAGE) return endedAt !== null ? (endedAt <= t ? endedAt : null) : t;
        if (fn === wall.CALM_MOTION_START_IN_PAGE) return 3;
        if (fn === wall.CALM_MOTION_READ_IN_PAGE) return (options.calm ?? (() => GOOD_CALM))(calmReads++);
        if (fn === SKIPPED_TEXT_IN_PAGE) {
          if (options.skippedTextThrows) throw new Error('page.evaluate: Execution context was destroyed');
          return (options.skippedText ?? (() => QUIET_CENSUS))(censusReads++);
        }
        throw new Error(`unexpected page function on the ${kind} page`);
      },
    };
  };
  const browser = {
    async newContext(o: Record<string, unknown> = {}) {
      const kind = kindOf(o);
      log.contexts.push({ kind, options: o });
      const p = page(kind);
      return { newPage: async () => p, close: async () => {} };
    },
    async close() {},
  };
  class FakeAxe {
    constructor(_: { page: unknown }) {}
    withTags() { return this; }
    async analyze() { return { violations: options.axeViolations ?? [] }; }
  }
  const runtime = {
    instruments,
    chromium: { launch: async () => browser },
    devices: { 'Desktop Chrome': { userAgent: 'Mozilla/5.0 Desktop' }, 'Pixel 7': { userAgent: 'Mozilla/5.0 Pixel 7', viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 } },
    AxeBuilder: FakeAxe,
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, version: 'abc1234' }) }),
  } as unknown as Runtime;
  return { runtime, clock, log };
}

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function observe(argv: string[], options: FakeOptions = {}) {
  const out = mkdtempSync(join(tmpdir(), 'observe-'));
  dirs.push(out);
  const config: ObserverConfig = configFrom({ argv: ['--minutes', '0.1', '--out', out, ...argv], env: ENV, root, now: new Date(T0) });
  const fake = fakeRuntime(options);
  const lines: string[] = [];
  return run(config, fake.runtime, { log: (l) => lines.push(l), error: (l) => lines.push(l), clock: fake.clock }).then((code) => ({ code, out, lines, ...fake }));
}
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)).map((g) => `${f}/${g}`) : [f]));
const read = (dir: string, f: string): string => readFileSync(join(dir, f), 'utf8');

describe('a run over a fake browser', () => {
  it('a wall, phone and desktop that hold every row: exit 0, the four files and the extras written', async () => {
    const r = await observe([]);
    expect(r.code, r.lines.join('\n')).toBe(0);
    expect(files(r.out).sort()).toEqual(['captures/desktop-1440.png', 'captures/kiosk-1080x1920.png', 'captures/kiosk-1920x1080-dpr025-3m.png', 'captures/kiosk-1920x1080.png', 'captures/phone-expired.png', 'captures/phone-karta-cold.png', 'captures/phone-sada.png', 'captures/phone-stop-board.png', 'inventory.json', 'legibility.json', 'recorders.json', 'report.md', 'rotation.jsonl']);
    expect(read(r.out, 'rotation.jsonl').trim().split('\n')).toHaveLength(3);
    expect((JSON.parse(read(r.out, 'inventory.json')) as { label: string }[]).map((v) => v.label)).toEqual(['kiosk-1920x1080', 'phone-sada', 'phone-karta-cold', 'desktop-1440', 'kiosk-1080x1920']);
    expect(Object.keys((JSON.parse(read(r.out, 'legibility.json')) as { captures: object }).captures)).toEqual(['kiosk-1920x1080', 'kiosk-1080x1920']);
    const report = read(r.out, 'report.md');
    expect(report).toContain('Verdict: **PASS**.');
    expect(report).toContain('build abc1234');
    expect(report).toContain('- Screens created: 0');
    expect(report).toContain('- Code redemptions: phone 1, desktop 1');
    // The canvas map's census reaches the legibility table (e2e/legibility.ts reads it off the container).
    expect(report).toContain('| markers 3, unlabelled 0, BAJS counted 1 zero 1 blank 1 far 0, overlaps discs 2 names 17, pills 28 |');
    expect(report).toMatch(/\| pills-plus \| d1 \| kiosk \| no vehicle pill matches \/\\\+\\d\/ in any reading \| ≤ 0 \| 0 \| pass \|/);
    expect(report).not.toContain('**fail**');
  });

  it('never creates a screen, presents or opens settings: nothing is pressed on the wall, the phone taps only its own controls, the only redemptions are one per surface 12 s apart', async () => {
    const r = await observe([]);
    const P = inventory.PHONE_PROBES;
    expect(r.log.clicks).toEqual([
      { kind: 'phone', selector: `${P.shareCity}:visible` },
      { kind: 'phone', selector: `${P.kartaTab}:visible` },
      { kind: 'phone', selector: `${P.transportSearch}:visible` },
      { kind: 'phone', selector: `${P.selectStop}:visible` },
    ]);
    expect(r.log.fills).toEqual([{ kind: 'phone', selector: `${P.transportSearch}:visible`, value: inventory.STOP_SEARCH_QUERY }]);
    expect(r.log.keys).toEqual([{ kind: 'phone', key: 'Escape' }]);
    const scans = r.log.gotos.filter((g) => g.url.includes('/s/#'));
    expect(scans.map((g) => g.kind)).toEqual(['phone', 'desktop']);
    expect(scans[1].at - scans[0].at).toBeGreaterThanOrEqual(REDEMPTION_SPACING_MS);
    expect(new Set(scans.map((g) => g.url)).size).toBe(2);
    expect(r.log.gotos.filter((g) => g.kind !== 'phone' && g.kind !== 'desktop').map((g) => g.url)).toEqual([KIOSK_URL, KIOSK_URL, KIOSK_URL]);
    expect(r.log.contexts.map((c) => c.kind)).toEqual(['kiosk', 'phone', 'desktop', 'portrait', 'proxy']);
    for (const c of r.log.contexts) expect(String(c.options.userAgent)).toMatch(new RegExp(`${USER_AGENT_SUFFIX.trim().replace(/[()]/g, '\\$&')}$`));
    const recs = JSON.parse(read(r.out, 'recorders.json')) as { page: string; redemptions: number; screenCreations: number }[];
    expect(recs.map((x) => [x.page, x.redemptions, x.screenCreations])).toEqual([['kiosk-1920x1080', 0, 0], ['phone', 1, 0], ['desktop-1440', 1, 0], ['kiosk-1080x1920', 0, 0], ['kiosk-3m-proxy', 0, 0]]);
  });

  it('writes no secret, no scan link, no code and no ticket into any file', async () => {
    const r = await observe([]);
    for (const f of files(r.out)) {
      const text = read(r.out, f);
      expect(text, f).not.toMatch(/s3cr3t|T-secret|R-secret/);
      for (const code of CODES) for (const part of [code, code.replace('-', '·'), ...code.split('-')]) expect(text, `${f} carries ${part}`).not.toContain(part);
    }
    expect(r.lines.join('\n')).not.toMatch(/s3cr3t/);
  });

  it('with the recorded 21 September inventories the report names the first-viewport findings; --stage d1 still passes', async () => {
    const inventories = { kiosk: recorded('1720-mon-kiosk-1920.json'), 'phone-sada': recorded('1720-mon-phone-sada.json'), 'phone-karta': recorded('1720-mon-phone-karta-cold.json') };
    const full = await observe([], { inventories });
    expect(full.code).toBe(1);
    const verdict = read(full.out, 'report.md');
    expect(verdict).toMatch(/\| phone-instruction \| d3 \| phone \| .* \| ≤ 0 \| 1 \| \*\*fail\*\* \|/);
    expect(verdict).toMatch(/\| phone-count \| d3 \| phone \| .* \| ≤ 0 \| 2 \| \*\*fail\*\* \|/);
    expect(verdict).toMatch(/\| wall-instruction \| d2 \| kiosk \| .* \| ≤ 0 \| 0 \| pass \|/);
    expect(verdict).toContain('**phone-instruction** (fail): phone-sada: 1 INSTRUCTION unit in the first viewport (target 0): "Odaberi i spremi stajalište na karti za sljedeće polaske ovdje."');
    const d1 = await observe(['--stage', 'd1'], { inventories });
    expect(d1.code).toBe(0);
    expect(read(d1.out, 'report.md')).toMatch(/\| phone-instruction \| d3 \| phone \| .* \| ≤ 0 \| 1 \| info \|/);
  });

  it('a departure only in hidden rows is no departure: the reading fails and the finding names the hidden rows', async () => {
    const r = await observe([], { reading: (n, at, code) => ({ ...wallReading(n, at, code), ...(n === 1 ? { rows: [], departures: 0, solarRows: 0, hiddenRows: 2 } : {}) }) });
    expect(r.code).toBe(1);
    expect(r.lines.join('\n')).toContain('FAIL departures');
    expect(read(r.out, 'report.md')).toContain('0 visible departure rows (2 row(s) in the DOM but not on the wall, not counted)');
  });

  it('a "+N" pill in one reading fails d1', async () => {
    const r = await observe(['--stage', 'd1'], { reading: (n, at, code) => ({ ...wallReading(n, at, code), pills: n === 2 ? '6|2 +11' : '6|12' }) });
    expect(r.code).toBe(1);
    expect(r.lines.join('\n')).toContain('FAIL pills-plus');
    expect(read(r.out, 'report.md')).toContain('pills "6\\|2 +11"');
  });

  it('a console error on the wall fails d1 through its recorder', async () => {
    const r = await observe(['--stage', 'd1'], { kioskConsoleError: 'Uncaught TypeError: x is undefined' });
    expect(r.code).toBe(1);
    expect(read(r.out, 'report.md')).toMatch(/\*\*recorders-kiosk\*\* \(fail\): kiosk-1920x1080: console error: Uncaught TypeError/);
  });

  it('wall, phone and desktop rows each fail on their own reading', async () => {
    const r = await observe([], {
      reading: (n, at, code) => ({ ...wallReading(n, at, code), ...(n === 1 ? { place: '', departures: 4, sentence: 'x'.repeat(81), sentenceChars: 81, unlabelled: null } : {}) }),
      phone: { ...GOOD_PHONE, departures: { total: 3, inViewport: 2 }, tabs: ['Sada', 'Karta', 'Promet'] },
      karta: { ...GOOD_KARTA, pills: '', unlabelled: null },
      desktop: { ...GOOD_DESKTOP, domains: 1 },
      axeViolations: [{ id: 'color-contrast', impact: 'serious', nodes: [{}, {}] }],
    });
    expect(r.code).toBe(1);
    const failed = new Set(JSON.stringify(r.lines).match(/FAIL [a-z-]+/g)!.map((f) => f.slice(5)));
    for (const id of ['place', 'departures', 'sentence-length', 'unlabelled', 'phone-departures', 'phone-tabs', 'karta-pills', 'karta-unlabelled', 'phone-axe', 'desktop-domains']) expect(failed, id).toContain(id);
    expect(failed).not.toContain('pills-plus');
    expect(read(r.out, 'report.md')).toContain('Sada: serious color-contrast (2)');
  });

  // Review P1: the spacing ran from the phone's navigation, so a first scan answering late let the second
  // /api/scan follow it by less than 12 s. It runs from the answer now.
  it('spaces the second redemption from the first /api/scan answer: a scan answering 10 s after its navigation still leaves ≥ 12 s', async () => {
    // A code a second, so the desktop is never held back by waiting for a fresh one: only the spacing holds it.
    const r = await observe([], { scanDelayMs: 10_000, codeWindowMs: 1_000 });
    expect(r.log.scans.map((x) => x.kind)).toEqual(['phone', 'desktop']);
    expect(r.log.scans[1].at - r.log.scans[0].at).toBeGreaterThanOrEqual(REDEMPTION_SPACING_MS);
    expect(r.code, r.lines.join('\n')).toBe(0);
    expect(read(r.out, 'report.md')).toMatch(/\| redemptions \| d1 \| all \| .* \| ≤ 0 \| 0 \| pass \|/);
  });

  // Review P1: failed readings were filtered out and a missing portrait dropped silently, so a run with
  // 299 of 300 rotation readings failed and no portrait passed D2.
  it('a failed or missing reading never leaves the judgment: 299 of 300 rotation readings failed and no portrait fail every stage', async () => {
    const broken = { failReading: (n: number) => n >= 2 && n <= 300, noInvitationOn: ['portrait'] as Kind[] };
    const d2 = await observe(['--minutes', '10', '--stage', 'd2'], broken);
    expect(d2.code).toBe(1);
    expect(d2.lines.join('\n')).toContain('FAIL wall-read');
    const report = read(d2.out, 'report.md');
    expect(report).toMatch(/\| wall-read \| d1 \| kiosk \| .* \| ≤ 0 \| 300 \| \*\*fail\*\* \|/);
    expect(report).toContain('299 of 300 rotation readings failed');
    expect(report).toContain('the portrait reading (1080 × 1920) was not made');
    expect(report).toMatch(/\*\*legibility\*\* \(fail\): no legibility report for kiosk-1080x1920/);
    const d1 = await observe(['--minutes', '10', '--stage', 'd1'], broken);
    expect(d1.code).toBe(1);
    expect(d1.lines.join('\n')).toContain('FAIL wall-read');
    // The whole plan read is the row's pass: the first, 300 rotation readings, the portrait.
    const whole = await observe(['--minutes', '10', '--stage', 'd1']);
    expect(whole.code, whole.lines.join('\n')).toBe(0);
    expect(plannedRotationSteps(10, wall.ROTATION_STEP_MS)).toBe(wall.ROTATION_STEPS);
  });

  it('a missing 3-metre proxy fails d2', async () => {
    const r = await observe(['--stage', 'd2'], { noInvitationOn: ['proxy'] });
    expect(r.code).toBe(1);
    expect(r.lines.join('\n')).toContain('FAIL proxy');
  });

  // Review P2: pills were required in every reading, so a correct outage failed. They are required while
  // data-feed is live; once it is down the wall must show no pill and no live countdown.
  it('a correct outage needs no pill; an outage that still draws pills or live countdowns fails', async () => {
    // A correct outage (§16.3 outage0800): no pill, no live countdown, the one map note, markers kept, timetable times only.
    const timetable = (at: number): WallRow => row({ id: 'trip-t', when: new Date(at + 180_000).toISOString(), title: '6 Sopot', whenText: '17:48', text: '6 Sopot 17:48' });
    const outage = (over: Partial<WallSample>) => (n: number, at: number, code: string): WallSample => {
      const base = wallReading(n, at, code);
      return { ...base, rows: [timetable(at), ...base.rows.slice(1)], feed: 'down', pills: '', bodies: 0, liveRows: 0, mapNotes: 1, ...over };
    };
    const correct = await observe(['--stage', 'd2'], { reading: outage({}) });
    expect(correct.code, correct.lines.join('\n')).toBe(0);
    expect(read(correct.out, 'report.md')).toMatch(/\| pills-drawn \| d2 \| kiosk \| .* \| ≤ 0 \| 0 \| pass \|/);
    const stale = await observe(['--stage', 'd2'], { reading: outage({ feed: 'stale' }) });
    expect(stale.code, stale.lines.join('\n')).toBe(0);
    const pills = await observe(['--stage', 'd2'], { reading: outage({ pills: '6|12' }) });
    expect(pills.code).toBe(1);
    expect(pills.lines.join('\n')).toContain('FAIL outage');
    const live = await observe(['--stage', 'd2'], { reading: outage({ liveRows: 1 }) });
    expect(live.lines.join('\n')).toContain('FAIL outage');
    const countdown = await observe(['--stage', 'd2'], { reading: (n, at, code) => ({ ...outage({})(n, at, code), rows: wallReading(n, at, code).rows }) });
    expect(read(countdown.out, 'report.md')).toContain('data-feed down: 1 departure(s) without a clock time');
    const noNote = await observe(['--stage', 'd2'], { reading: outage({ mapNotes: 0, markers: 0 }) });
    expect(read(noNote.out, 'report.md')).toContain('data-feed down: data-markers 0');
    expect(read(noNote.out, 'report.md')).toContain('data-feed down: 0 map note(s), not 1');
    const empty = await observe(['--stage', 'd2'], { reading: (n, at, code) => ({ ...wallReading(n, at, code), pills: '' }) });
    expect(empty.lines.join('\n')).toContain('FAIL pills-drawn');
    expect(empty.lines.join('\n')).not.toContain('FAIL outage');
  });

  it('fewer than three distinct sentences in ten minutes fail d2', async () => {
    const two = await observe(['--minutes', '10', '--stage', 'd2'], { reading: (n, at, code) => ({ ...wallReading(n, at, code), sentence: n % 2 ? 'Tramvaj 6 kreće.' : 'Sunce zalazi u 18:57.', validUntil: new Date(Math.floor(at / 20_000) * 20_000 + 20_000).toISOString() }) });
    expect(two.lines.join('\n')).toContain('FAIL sentence-distinct');
    expect(read(two.out, 'report.md')).toContain('2 distinct of 3 required');
    expect(distinctPerWindow([], 300, wall.ROTATION_STEP_MS, 600_000, 3)).toMatchObject({ short: 3 });
    expect(distinctPerWindow([], 10, wall.ROTATION_STEP_MS, 600_000, 3)).toMatchObject({ short: 1, windows: [{ from: 0, to: 9, required: 1, distinct: 0 }] });
    const rows = (sentences: string[]): WallSample[] => sentences.map((sentence, n) => ({ ...wallReading(n), n, sentence }) as WallSample & { n: number });
    expect(distinctPerWindow(rows(['a', 'b', 'c']), 3, wall.ROTATION_STEP_MS, 600_000, 3)).toMatchObject({ short: 0, windows: [{ required: 1, distinct: 3 }] });
    expect(distinctPerWindow(rows(Array.from({ length: 600 }, (_, i) => (i < 300 ? ['a', 'b', 'c'][i % 3] : 'a'))), 600, wall.ROTATION_STEP_MS, 600_000, 3))
      .toMatchObject({ short: 2, windows: [{ required: 3, distinct: 3 }, { required: 3, distinct: 1 }] });
  });

  it('the share code, the stop board and the end of the session are judged on the phone at d3', async () => {
    const good = await observe([]);
    const report = read(good.out, 'report.md');
    for (const id of ['phone-share-code', 'phone-stop-board', 'phone-expiry']) expect(report).toMatch(new RegExp(`\\| ${id} \\| d3 \\| phone \\| .* \\| ≤ 0 \\| 0 \\| pass \\|`));
    for (const f of files(good.out)) expect(read(good.out, f), f).not.toContain('W4TN');
    const bad = await observe([], {
      shareCode: { present: true, visible: true, text: '' },
      stopBoard: { open: true, total: 4, inViewport: 2, texts: ['a', 'b', 'c', 'd'] },
      expiry: { ...GOOD_EXPIRY, rows: 3, rowTexts: ['6 Sopot 2 min', '11 Dubec 5 min', '12 Dubrava 8 min'] },
    });
    const failed = bad.lines.join('\n');
    for (const id of ['phone-share-code', 'phone-stop-board', 'phone-expiry']) expect(failed).toContain(`FAIL ${id}`);
    expect(read(bad.out, 'report.md')).toContain('3 content row(s) kept after the session ended');
    const late = await observe([], { requestAfterExpiry: '/api/data/zet-rt' });
    expect(late.lines.join('\n')).toContain('FAIL phone-expiry');
    expect(read(late.out, 'report.md')).toContain('1 /api/data request(s) after the session ended: /api/data/zet-rt');
    // Before WP4 the share button is not at rest in the header: nothing is tapped, the row fails at d3 and is information below it.
    const hidden = await observe(['--stage', 'd2'], { phone: { ...GOOD_PHONE, shareCity: { present: false, visible: false, text: '' } } });
    expect(hidden.log.clicks.map((c) => c.selector)).not.toContain(`${inventory.PHONE_PROBES.shareCity}:visible`);
    expect(hidden.code, hidden.lines.join('\n')).toBe(0);
    expect(read(hidden.out, 'report.md')).toMatch(/\| phone-share-code \| d3 \| phone \| .* \| ≤ 0 \| 1 \| info \|/);
  });

  // Lane p-map: the Karta's pills are written the moment one is drawn, before the
  // marker census (every city source loaded and a settled second); the read that
  // judges karta-unlabelled waits for that census as the wall's settle does.
  it('reads the Karta\u2019s census once it is written, after the first pills', async () => {
    const run = await observe([], { kartaCensusAfterMs: 5_000 });
    expect(run.lines.join('\n')).not.toContain('FAIL karta-unlabelled');
    expect(run.lines.join('\n')).not.toContain('FAIL karta-pills');
    const never = await observe([], { kartaCensusAfterMs: CENSUS_TIMEOUT_MS * 10 });
    expect(never.lines.join('\n')).toContain('FAIL karta-unlabelled');
  });

  // Lane p-map (second observation, 24 Sep 03:40): the stop search's result
  // click reported Playwright's 15 s timeout, yet the capture shows the board
  // open with three departures inside the viewport; nothing but that tap
  // opens it. A board that opened counts the tap; one that did not still fails.
  it('counts the result tap when the board opened though the click reported a timeout, and fails the path when no board opened', async () => {
    const select = `${inventory.PHONE_PROBES.selectStop}:visible`;
    const slow = await observe([], { clickTimesOut: select });
    expect(slow.lines.join('\n')).not.toContain('FAIL phone-stop-board');
    const report = read(slow.out, 'report.md');
    expect(report).toMatch(/\| phone-stop-board \| d3 \| phone \| .* \| ≤ 0 \| 0 \| pass \|/);
    expect(report).toContain('Timeout 15000ms exceeded');
    expect(report).toContain('waiting for element to be visible, enabled and stable');
    const none = await observe([], { clickTimesOut: select, noStopBoard: true });
    expect(none.lines.join('\n')).toContain('FAIL phone-stop-board');
  });

  it('a phone that never landed in its session fails its recorder row: an empty recorder proves nothing', () => {
    const obs = newObservation(configFrom({ argv: [], env: ENV, root, now: new Date(T0) }), null);
    obs.desktop = { landingMs: null, read: null, viewports: [], failed: 'no fresh code on the screen within 90 s' };
    obs.recorders = [{ surface: 'desktop', page: 'desktop-1440', dataResponses: 0, failed: [], httpErrors: [], consoleErrors: [], consoleWarnings: [], pageErrors: [], moduleStatuses: {}, redemptions: 0, screenCreations: 0, problems: [], aborted: 0, scanTimes: [] }];
    const m = METRICS['desktop.recorderProblems'](obs, instruments);
    expect(m.value).toBeNull();
    expect(m.detail.join(' ')).toContain('the desktop never landed in its session (no fresh code on the screen within 90 s)');
  });

  // Review round 2, item 1: the phone's scan answered only after the observer stopped waiting. The timeout was taken
  // as a confirmation, the desktop redeemed 15 s later (75 s) and the phone's answer landed 1 s after it (76 s). The
  // unanswered redemption now fails, its page is left so the browser cancels the scan, and every answer that does
  // arrive is at least 12 s from the others.
  it('a phone scan that never answers in time is a failed redemption: its page is left, the desktop stays ≥ 12 s from every answer', async () => {
    const r = await observe([], { phoneAnswersAfterDesktopMs: 1_000, codeWindowMs: 1_000 });
    const answers = r.log.scans.map((x) => x.at).sort((a, b) => a - b);
    for (let i = 1; i < answers.length; i++) expect(answers[i] - answers[i - 1], `answers ${answers.join(', ')}`).toBeGreaterThanOrEqual(REDEMPTION_SPACING_MS);
    expect(r.log.scans.map((x) => x.kind)).toEqual(['desktop']);
    expect(r.log.cancelled).toContain('phone');
    expect(r.log.gotos.filter((g) => g.kind === 'phone').map((g) => g.url)).toEqual([expect.stringContaining('/s/#'), 'about:blank']);
    const desktopNav = r.log.gotos.find((g) => g.kind === 'desktop' && g.url.includes('/s/#'))!;
    const phoneLeft = r.log.gotos.find((g) => g.kind === 'phone' && g.url === 'about:blank')!;
    expect(desktopNav.at - phoneLeft.at).toBeGreaterThanOrEqual(REDEMPTION_SPACING_MS);
    expect(r.code).toBe(1);
    const report = read(r.out, 'report.md');
    expect(report).toMatch(/\*\*recorders-phone\*\* \(fail\): the phone's redemption was not confirmed: no \/api\/scan answer within 60 s/);
    expect(report).toMatch(/\| redemptions \| d1 \| all \| .* \| ≤ 0 \| 0 \| pass \|/);
  });

  // Review round 3, item 1: once a redemption has timed out it is failed for good. An answer that lands while its
  // page is being left, or after a cancellation that rejected, is a late answer in the report, never a confirmation.
  it('an /api/scan answer during the cancellation never confirms a timed-out redemption: it is reported as late', async () => {
    const r = await observe([], { phoneAnswersAfterDesktopMs: 1_000, cancel: 'answers', codeWindowMs: 1_000 });
    expect(r.log.scans.map((x) => x.kind)).toEqual(['phone', 'desktop']);
    const [phone, desktop] = r.log.scans.map((x) => x.at);
    expect(desktop - phone).toBeGreaterThanOrEqual(REDEMPTION_SPACING_MS);
    const report = read(r.out, 'report.md');
    expect(report).toMatch(/\*\*recorders-phone\*\* \(fail\): the phone's redemption was not confirmed: no \/api\/scan answer within 60 s/);
    expect(report).toContain('- Failed redemptions: phone (no /api/scan answer within 60 s; a late answer +0 s after it failed, not counted as confirmed).');
    expect(r.code).toBe(1);
  });

  it('a cancellation that rejects is recorded on the phone\'s recorder row, and a later answer still does not confirm the redemption', async () => {
    const r = await observe([], { phoneAnswersAfterDesktopMs: 3_000, cancel: 'rejects', codeWindowMs: 1_000 });
    expect(r.log.scans.map((x) => x.kind)).toEqual(['desktop', 'phone']);
    const report = read(r.out, 'report.md');
    expect(report).toMatch(/\*\*recorders-phone\*\* \(fail\): the phone's redemption was not confirmed: no \/api\/scan answer within 60 s, so it failed for good; leaving its page to cancel the scan failed: page\.goto: net::ERR_FAILED at about:blank; 1 late answer\(s\), not counted as confirmed/);
    expect(report).toMatch(/- Failed redemptions: phone \(no \/api\/scan answer within 60 s; the cancellation failed; a late answer \+\d+ s after it failed, not counted as confirmed\)\./);
    expect(report).toContain('error, phone cancellation: page.goto: net::ERR_FAILED at about:blank');
    // The scan the failed cancellation left in flight landed 3 s after the desktop's: the spacing row says so.
    expect(report).toMatch(/\| redemptions \| d1 \| all \| .* \| ≤ 0 \| 1 \| \*\*fail\*\* \|/);
    expect(r.code).toBe(1);
  });

  // Review round 3, item 2: without the page's own end stamp the boundary fell back to the moment the observer looked
  // (700 s), so a request at 610 s escaped a session that ended at 600 s. The boundary is now the observer's estimate,
  // the redemption + SESSION_MINUTES, and a missing stamp is itself a failure.
  it('no end stamp: the boundary is the redemption + the session length, so a request at 610 s fails an expiry looked at 700 s', async () => {
    expect(SESSION_LENGTH_MS).toBe(SESSION_MINUTES * 60_000);
    expect(SESSION_MINUTES).toBe(10);
    const late = await observe([], { expiryWatch: 'no-stamp', expirySeenAfterScanMs: 700_000, phoneRequests: [{ path: '/api/data/dhmz-now', afterScanMs: 590_000 }, { path: '/api/data/zet-rt', afterScanMs: 610_000 }] });
    expect(late.lines.join('\n')).toContain('FAIL phone-expiry');
    const report = read(late.out, 'report.md');
    expect(report).toContain('1 /api/data request(s) after the session ended: /api/data/zet-rt');
    expect(report).not.toContain('/api/data/dhmz-now (target none)');
    expect(report).toContain('the page kept no stamp of its session\'s end (a defect): requests counted from the observer\'s estimate, the redemption + 10 min');
    // No stamp and no request: still a failure, never ungraded.
    const unstamped = await observe([], { expiryWatch: 'rejects', expirySeenAfterScanMs: 700_000 });
    expect(unstamped.lines.join('\n')).toContain('FAIL phone-expiry');
    expect(read(unstamped.out, 'report.md')).toContain('the page kept no stamp of its session\'s end (a defect)');
  });

  // Review round 2, item 2: the watcher for /api/data after expiry was attached only once the observer saw
  // session-ended, so a poll made after the end but before that moment escaped. It is attached at the redemption,
  // and the end is the page's own stamp of when session-ended showed.
  it('an /api/data request between the end of the session and the observer\'s look at it still fails phone-expiry', async () => {
    const r = await observe([], { endsAfterScanMs: 8_000, phoneRequests: [{ path: '/api/data/zet-rt', afterScanMs: 5_000 }, { path: '/api/data/dhmz-now', afterScanMs: 9_000 }] });
    expect(r.log.watches).toEqual(['phone']);
    expect(r.lines.join('\n')).toContain('FAIL phone-expiry');
    const report = read(r.out, 'report.md');
    expect(report).toContain('1 /api/data request(s) after the session ended: /api/data/dhmz-now');
    expect(report).not.toContain('/api/data/zet-rt (target none)');
    const clean = await observe([], { endsAfterScanMs: 8_000, phoneRequests: [{ path: '/api/data/zet-rt', afterScanMs: 5_000 }] });
    expect(read(clean.out, 'report.md')).toMatch(/\| phone-expiry \| d3 \| phone \| .* \| ≤ 0 \| 0 \| pass \|/);
  });

  // Review round 2, item 3: §16.3's calm motion is a D2 observer row: every minute of the rotation, ≤ 2 structural
  // mutations under the timeline and every row that stays keeps its node (e2e/wall.ts, the accept spec's own).
  it('calm motion: a minute with three structural mutations or a rebuilt row fails d2; every minute is measured', async () => {
    const calm = await observe(['--minutes', '10', '--stage', 'd2']);
    expect(calm.code, calm.lines.join('\n')).toBe(0);
    expect(read(calm.out, 'report.md')).toMatch(/\| calm-motion \| d2 \| kiosk \| .* \| ≤ 0 \| 0 \| pass \|/);
    const busy = await observe(['--minutes', '10', '--stage', 'd2'], { calm: (i) => (i === 4 ? { ...GOOD_CALM, mutations: 3 } : i === 7 ? { ...GOOD_CALM, rebuilt: ['departure|trip-2'] } : GOOD_CALM) });
    expect(busy.lines.join('\n')).toContain('FAIL calm-motion');
    const report = read(busy.out, 'report.md');
    expect(report).toMatch(/\| calm-motion \| d2 \| kiosk \| .* \| ≤ 0 \| 2 \| \*\*fail\*\* \|/);
    expect(report).toContain('readings 120–150: 3 structural mutations under the timeline in an idle minute');
    expect(report).toContain('readings 210–240: 1 row(s) stayed on the list but were re-created: departure\\|trip-2');
    const gone = await observe(['--stage', 'd2'], { calm: () => ({ ...GOOD_CALM, rootFound: false }) });
    expect(gone.lines.join('\n')).toContain('FAIL calm-motion');
  });

  // §16.3 outage0800: while the feed is down no headline reads "unavailable" and the map note shows once.
  it('outage headline: a /nedostup/ heading or sentence, or a missing map note, fails d2 while the feed is down', async () => {
    const timetable = (at: number): WallRow => row({ id: 'trip-t', when: new Date(at + 180_000).toISOString(), title: '6 Sopot', whenText: '17:48', text: '6 Sopot 17:48' });
    const down = (over: Partial<WallSample>) => (n: number, at: number, code: string): WallSample => {
      const base = wallReading(n, at, code);
      return { ...base, rows: [timetable(at), ...base.rows.slice(1)], feed: 'down', pills: '', bodies: 0, liveRows: 0, mapNotes: 1, ...over };
    };
    const quiet = await observe(['--stage', 'd2'], { reading: down({}) });
    expect(quiet.code, quiet.lines.join('\n')).toBe(0);
    const heading = await observe(['--stage', 'd2'], { reading: down({ headings: ['Kaj ima?', 'Promet nedostupan'] }) });
    expect(heading.lines.join('\n')).toContain('FAIL outage-heading');
    expect(read(heading.out, 'report.md')).toContain('a headline matches /nedostup/i: "Promet nedostupan"');
    const sentence = await observe(['--stage', 'd2'], { reading: down({ sentence: 'Podaci nedostupni.', sentenceChars: 18 }) });
    expect(sentence.lines.join('\n')).toContain('FAIL outage-heading');
    const note = await observe(['--stage', 'd2'], { reading: down({ mapNotes: 2 }) });
    expect(read(note.out, 'report.md')).toContain('2 map note(s), not 1');
    expect(note.lines.join('\n')).toContain('FAIL outage-heading');
    // A live feed may say anything about a closed road; the headline rule is the outage's.
    const live = await observe(['--stage', 'd2'], { reading: (n, at, code) => ({ ...wallReading(n, at, code), headings: ['Nedostupno'] }) });
    expect(live.lines.join('\n')).not.toContain('FAIL outage-heading');
  });

  it('--surfaces kiosk redeems nothing and reports the phone and desktop rows as not observed', async () => {
    const r = await observe(['--surfaces', 'kiosk']);
    expect(r.code).toBe(0);
    expect(r.log.gotos.filter((g) => g.url.includes('/s/#'))).toEqual([]);
    expect(read(r.out, 'report.md')).toMatch(/\| phone-tabs \| d3 \| phone \| .* \| — \| not observed \|/);
  });

  it('a screen that never shows its invitation is exit 2, with the report written', async () => {
    const r = await observe([], { noInvitation: true });
    expect(r.code).toBe(2);
    expect(r.log.gotos.filter((g) => g.url.includes('/s/#'))).toEqual([]);
    expect(read(r.out, 'report.md')).toContain('error, kiosk: the screen named by E2E_KIOSK_URL showed no invitation with a code');
  });
  it('records the validator census on every rotation reading and counts it in report.md, never in the verdict', async () => {
    const census = (i: number): SkippedTextEntry[] => {
      if (i === 1) return [{ surface: 'kiosk', value: 'count:2;link:1;instruction:1' }, { surface: 'nearby', value: '1' }];
      if (i === 2) return [{ surface: 'kiosk', value: 'count:1;instruction:1' }, { surface: 'nearby', value: '0' }];
      return QUIET_CENSUS;
    };
    const quiet = await observe([]);
    const skipping = await observe([], { skippedText: census });
    // Monitored, never a gate (decision 24): the same verdict and exit code as a wall that skipped nothing.
    expect(skipping.code, skipping.lines.join('\n')).toBe(0);
    expect(skipping.code).toBe(quiet.code);
    const statuses = (out: string): string[] => read(out, 'report.md').split('\n').filter((l) => /^\| [a-z0-9-]+ \| d[123] \|/.test(l));
    expect(statuses(skipping.out)).toEqual(statuses(quiet.out));
    expect(THRESHOLDS.filter((t) => /skipped/i.test(`${t.id} ${t.metric} ${t.target}`))).toEqual([]);
    const rows = read(skipping.out, 'rotation.jsonl').trim().split('\n').map((l) => JSON.parse(l) as ObservedRotationRow);
    expect(rows.map((r) => r.skippedText?.total)).toEqual([0, 3, 1]);
    expect(rows[1].skippedText!.surfaces).toEqual([{ surface: 'kiosk', count: 2, reasons: { link: 1, instruction: 1 } }, { surface: 'nearby', count: 1, reasons: {} }]);
    const report = read(skipping.out, 'report.md');
    expect(report).toContain('Verdict: **PASS**.');
    expect(report).toContain('### Skipped third-party text (data-skipped-text, monitored, never a gate)');
    expect(report).toContain('| 3 | 0 | 2 | 4 | 3 (reading 1: kiosk 2, nearby 1) | kiosk 3, nearby 1 | link 1, instruction 2 |');
    expect(report).toContain('Readings with a skip, for the owner: 1, 2 (rotation.jsonl, `skippedText`).');
    expect(read(quiet.out, 'report.md')).toContain('| 3 | 0 | 0 | 0 | 0 | kiosk 0, nearby 0 | — |');
  });

  it('a wall without the census, or a page that cannot answer it, is reported as such and still leaves the exit code alone', async () => {
    const none = await observe([], { skippedText: () => [] });
    expect(none.code, none.lines.join('\n')).toBe(0);
    expect(read(none.out, 'report.md')).toContain('No reading carried a `data-skipped-text` count (3 readings): a build before D2, or the census was not readable.');
    const gone = await observe([], { skippedTextThrows: true });
    expect(gone.code, gone.lines.join('\n')).toBe(0);
    expect(read(gone.out, 'report.md')).toContain('No reading carried a `data-skipped-text` count (3 readings, 3 could not be read)');
    const rows = read(gone.out, 'rotation.jsonl').trim().split('\n').map((l) => JSON.parse(l) as ObservedRotationRow);
    expect(rows.every((r) => r.skippedText?.total === null && /context was destroyed/.test(r.skippedText.error ?? ''))).toBe(true);
  });
});

// --- the first production observation after the release: 24 Sep 2026, 02:30-02:43 Zagreb ------------------------
// review.local/observe-2026-09-24-d5 failed six rows. Four were the observer's: the portrait read before its census
// (unlabelled, pills-drawn, legibility), the rotation's first reading 2 s before the first pill (pills-drawn), and the
// stop board's display: contents wrapper read as "not open" (phone-stop-board, above). At night the twin can report
// no vehicle at all; the pill rows then owe none, and stay strict whenever it reports any.
describe('the first production observation after the release (24 Sep, 02:30 Zagreb)', () => {
  it('the twin\'s vehicles as a data response carries them: pins are moving vehicles, never route summaries or the fleet count', () => {
    const teaser = { generatedAt: 'g', modules: [{ module: 'emsc', status: 'live', items: [{ id: 'vehicle:x' }] }, zetSnapshot(3, true)] };
    expect(fleetOf('/api/teaser?stop=106_1', teaser)).toEqual({ status: 'live', pins: 3, fleet: 43 });
    expect(fleetOf('/api/data/zet-rt', zetSnapshot(0, false))).toEqual({ status: 'live', pins: 0, fleet: null });
    expect(fleetOf('/api/data', { modules: [zetSnapshot(2, false, 'stale')] })).toEqual({ status: 'stale', pins: 2, fleet: null });
    expect(fleetOf('/api/data', { 'zet-rt': zetSnapshot(1, false) })).toEqual({ status: 'live', pins: 1, fleet: null });
    expect(fleetOf('/api/data/emsc', { module: 'emsc', status: 'live', items: [] })).toBeNull();
    expect(fleetOf('/api/scan', { ticket: 't' })).toBeNull();
    expect(fleetOf('/api/teaser', { modules: [] })).toBeNull();
    expect(fleetOf('/api/teaser', null)).toBeNull();
  });

  it('what a page held at a moment: the latest snapshot by then, and since when its vehicles have been reported', () => {
    const r = (at: number, pins: number): FleetRecord => ({ at, status: 'live', pins, fleet: null });
    const records = [r(3_000, 2), r(1_000, 0), r(5_000, 3), r(9_000, 0), r(12_000, 1)];
    expect(fleetAt(records, 500)).toBeNull();
    expect(fleetAt(records, 1_500)).toEqual({ at: 1_000, status: 'live', pins: 0, fleet: null, since: 1_000 });
    expect(fleetAt(records, 6_000)).toMatchObject({ at: 5_000, pins: 3, since: 3_000 });
    expect(fleetAt(records, 9_000)).toMatchObject({ at: 9_000, pins: 0 });
    expect(fleetAt(records, 20_000)).toMatchObject({ at: 12_000, pins: 1, since: 12_000 });
    expect(fleetAt([], 1)).toBeNull();
  });

  it('a reading owes pills while the feed is live and the twin has reported vehicles for the grace; a live feed without a vehicle owes none', () => {
    const at = T0 + 60_000;
    const s = (over: Partial<ObservedSample>): ObservedSample => ({ ...wallReading(0, at), pills: '', ...over });
    const fleet = (pins: number, since = at - 60_000) => ({ at: since, status: 'live', pins, fleet: null, since });
    // No snapshot recorded (a build or a path the watcher does not know): strict, as before.
    expect(pillsOwed(s({}))).toBe(true);
    expect(pillsOwed(s({ fleet: null }))).toBe(true);
    expect(pillsOwed(s({ fleet: fleet(3) }))).toBe(true);
    // The night: the twin reports no vehicle in the wall's box.
    expect(pillsOwed(s({ fleet: fleet(0) }))).toBe(false);
    // Vehicles just reported: the census is retaken once the frame has settled (name-census.ts PROBE_SETTLE_MS).
    expect(pillsOwed(s({ fleet: fleet(3, at - PILLS_DRAW_GRACE_MS + 1) }))).toBe(false);
    expect(pillsOwed(s({ fleet: fleet(3, at - PILLS_DRAW_GRACE_MS) }))).toBe(true);
    // An outage (stale, down) owes none, whatever the twin said before it.
    expect(pillsOwed(s({ feed: 'down', fleet: fleet(3) }))).toBe(false);
    expect(pillsOwed(s({ feed: 'stale', fleet: fleet(3) }))).toBe(false);
    // Before the wall's first poll has answered (data-feed "loading", lane p-map) it holds no vehicle to draw.
    expect(pillsOwed(s({ feed: 'loading', fleet: null }))).toBe(false);
    expect(pillsOwed(s({ feed: 'loading' }))).toBe(false);
  });

  it('the wall is read once its census is written and its pills drawn: the 24 Sep portrait and first rotation reading pass', async () => {
    const late = await observe([], { censusAfterMs: { portrait: 6_000 }, pillsAfterMs: { kiosk: 4_000, portrait: 7_000 }, teaserPins: 3 });
    expect(late.code, late.lines.join('\n')).toBe(0);
    const report = read(late.out, 'report.md');
    for (const id of ['unlabelled', 'pills-drawn', 'legibility']) expect(report).toMatch(new RegExp(`\\| ${id} \\| d2 \\| kiosk \\| .* \\| ≤ 0 \\| 0 \\| pass \\|`));
    expect(report).toContain('kiosk-1920x1080: the map census 0 ms and the first vehicle pill 4000 ms after the map left loading');
    expect(report).toContain('kiosk-1080x1920: the map census 6000 ms and the first vehicle pill 7000 ms after the map left loading');
    // A census that never comes is still judged: the reading as it stands fails every row that needs it.
    const never = await observe([], { censusAfterMs: { portrait: Infinity }, teaserPins: 3 });
    const failed = never.lines.join('\n');
    for (const id of ['unlabelled', 'pills-drawn', 'legibility']) expect(failed).toContain(`FAIL ${id}`);
    expect(read(never.out, 'report.md')).toContain(`kiosk-1080x1920: the map census not written within ${CENSUS_TIMEOUT_MS / 1000} s`);
  });

  it('a live feed whose twin reports no vehicle owes no pill on the wall or on Karta; with vehicles both rows stay strict', async () => {
    const never = { kiosk: Infinity, portrait: Infinity, proxy: Infinity };
    const noPills = (n: number, at: number, code: string): WallSample => ({ ...wallReading(n, at, code), pills: '', bodies: 0 });
    const night = await observe([], { reading: noPills, pillsAfterMs: never, teaserPins: 0, phonePins: 0, karta: { ...GOOD_KARTA, pills: '' } });
    expect(night.code, night.lines.join('\n')).toBe(0);
    const report = read(night.out, 'report.md');
    expect(report).toMatch(/\| pills-drawn \| d2 \| kiosk \| .* \| ≤ 0 \| 0 \| pass \|/);
    expect(report).toMatch(/\| karta-pills \| d3 \| phone \| .* \| ≤ 0 \| 0 \| pass \|/);
    expect(report).toContain('Vehicle pills: drawn in 0 of 5 readings, owed in 0; the twin reported no vehicle in 5, the feed was stale or down in 0.');
    expect(report).toContain(`kiosk-1920x1080: the map census 0 ms and no vehicle pill within ${VEHICLES_TIMEOUT_MS / 1000} s after the map left loading`);
    expect(report).toContain('Karta cold open: status ready, first pill none after ready (the twin: 0 vehicle(s), live)');
    const rows = read(night.out, 'rotation.jsonl').trim().split('\n').map((l) => JSON.parse(l) as ObservedRotationRow & { fleet?: { pins: number } | null });
    expect(rows.map((r) => r.fleet?.pins)).toEqual([0, 0, 0]);
    // The same wall and Karta with vehicles in the twin's report: both rows fail.
    const day = await observe([], { reading: noPills, pillsAfterMs: never, teaserPins: 3, phonePins: 2, karta: { ...GOOD_KARTA, pills: '' } });
    const failed = day.lines.join('\n');
    expect(failed).toContain('FAIL pills-drawn');
    expect(failed).toContain('FAIL karta-pills');
    expect(read(day.out, 'report.md')).toContain('data-pills empty (feed live, map ready, the twin reporting 3 vehicle(s))');
    expect(read(day.out, 'report.md')).toContain('Vehicle pills: drawn in 0 of 5 readings, owed in 5; the twin reported no vehicle in 0, the feed was stale or down in 0.');
  });
});
