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
import {
  ANY_PRESENT_IN_PAGE, DESKTOP_READ_IN_PAGE, INVITATION_READY_IN_PAGE, KARTA_READ_IN_PAGE, MAP_SETTLED_IN_PAGE, METRICS, MAX_MINUTES,
  ObserverRefusal, PAIRING_IN_PAGE, PAIRING_PROBES, PHONE_READ_IN_PAGE, REDEMPTION_SPACING_MS, STAGES, SURFACES, THRESHOLDS,
  USER_AGENT_SUFFIX, configFrom, fillTarget, judge, kioskFromEnv, main, makeScrubber, newObservation, outDirFor, parseArgs,
  redemptionBudget, repeatsWithin, run, stageIndex, thresholdsFor,
  type Instruments, type KartaRead, type ObserverConfig, type PhoneRead, type DesktopRead, type Runtime,
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
  it('allows one redemption per surface and says how long to wait for the spacing', () => {
    const b = redemptionBudget();
    expect(b.waitMs('phone', 0)).toBe(0);
    b.take('phone', 1_000);
    expect(b.waitMs('desktop', 1_000)).toBe(REDEMPTION_SPACING_MS);
    expect(b.waitMs('desktop', 11_000)).toBe(2_000);
    expect(b.waitMs('desktop', 13_000)).toBe(0);
    expect(() => b.take('phone', 60_000)).toThrow(/already redeemed 1 code/);
    expect(() => b.waitMs('phone', 60_000)).toThrow(/already redeemed/);
    expect(() => b.take('desktop', 5_000)).toThrow(/ms apart \(at least 12000 ms\)/);
    b.take('desktop', 13_000);
    expect(b.counts()).toEqual({ phone: 1, desktop: 1 });
    expect(b.times().map((t) => t.surface)).toEqual(['phone', 'desktop']);
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
const box = (el: Element, top: number, height = 40, width = 200): void => {
  (el as HTMLElement).getBoundingClientRect = () => ({ x: 0, y: top, left: 0, top, right: width, bottom: top + height, width, height, toJSON: () => ({}) }) as DOMRect;
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

  it('phone Sada: place, sentence, departures inside the viewport, slop, visible tabs and the share button', () => {
    const P = inventory.PHONE_PROBES;
    document.body.innerHTML = `
      <p data-testid="sada-place">Trg bana J. Jelačića</p>
      <p data-testid="sada-sentence" data-kicker="promet">Tramvaj 6 kreće za dvije minute.</p>
      <ul data-testid="day-departures">${[0, 1, 2, 3].map((i) => `<li class="sada-departure" data-kind="departure">6 Sopot ${i + 2} min</li>`).join('')}</ul>
      <nav><a class="ki-tab">Sada</a><a class="ki-tab">Karta</a><a class="ki-tab">Još</a><a class="ki-tab" hidden>Promet</a></nav>
      <button data-testid="share-city">Podijeli grad</button><p>Sada u gradu.</p>`;
    const rows = document.querySelectorAll('[data-kind=departure]');
    rows.forEach((el, i) => box(el, 200 + i * 60));
    box(rows[3], innerHeight - 10);
    document.querySelectorAll('.ki-tab, [data-testid=share-city], [data-testid=sada-place], [data-testid=sada-sentence]').forEach((el) => box(el, 10));
    const read = shipped(PHONE_READ_IN_PAGE)({ place: P.sadaPlace, sentence: P.sadaSentence, departures: P.departureRows, tab: P.tab, shareCity: P.shareCity, slop: { source: inventory.PHONE_SLOP_RE.source, flags: inventory.PHONE_SLOP_RE.flags } }) as PhoneRead;
    expect(read.place).toBe('Trg bana J. Jelačića');
    expect(read.sentenceChars).toBe('Tramvaj 6 kreće za dvije minute.'.length);
    expect(read.departures).toEqual({ total: 4, inViewport: 3 });
    expect(read.slop).toEqual(['Sada u gradu']);
    expect(read.tabs).toEqual(['Sada', 'Karta', 'Još']);
    expect(read.shareCity).toEqual({ present: true, visible: true, text: 'Podijeli grad' });
  });

  it('Karta and the desktop: the map probes, disclosures, and whether Sada and Karta both sit in the viewport', () => {
    document.body.innerHTML = '<div data-testid="map-canvas" data-map-status="ready" data-pills="6|11" data-unlabelled="0" data-markers="12" data-bodies="40"></div><details class="city-filter-disclosure"></details><section id="layer-grad-sada"></section><section data-testid="transport-workspace"></section>';
    expect(shipped(KARTA_READ_IN_PAGE)({ map: '[data-testid=map-canvas]', disclosures: inventory.PHONE_PROBES.kartaDisclosures })).toEqual({ status: 'ready', pills: '6|11', bodies: 40, unlabelled: 0, markers: 12, disclosures: 1 });
    box(document.querySelector('#layer-grad-sada')!, 0);
    box(document.querySelector('[data-testid=transport-workspace]')!, innerHeight + 5);
    const d = shipped(DESKTOP_READ_IN_PAGE)({ sada: '#layer-grad-sada', karta: '[data-testid=transport-workspace]', domains: '.ki-domains', shareCity: '[data-testid=share-city]' }) as DesktopRead;
    expect(d).toEqual({ sadaInViewport: true, kartaInViewport: false, domains: 0, shareCityVisible: false });
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
    sentenceChars: [...sentence].length, sentenceOverflow: false, sentenceEllipsis: false, head: wall.NEARBY_HEAD_2KM, rows,
    departures: 1, solarRows: 1, liveRows: 0, pills: '6|12|17', bodies: 41, zoom: '14.20', feed: 'live', mapStatus: 'ready', unlabelled: 0,
    markers: 12, frame: '6', mapNotes: 0, theme: 'light', code, codeState: 'live', qr: { w: 240, h: 240 }, lead: wall.LEAD_TEXT,
    strip: 'Mirno · DHMZ · EMSC', stripHasClock: false, pharmacy: '24/7 Ilica 1', pharmacySymbols: 1, controls: 0, controlNames: [],
    retiredChrome: 0, settingsOpen: false, stopBoardOpen: false,
  };
}
const EMPTY_INVENTORY = (vw: number, vh: number): PageInventory => ({ vw, vh, scrollY: 0, url: 'https://zagreb.example/kiosk/#ABCDEFGH.s3cr3t-part', title: 'Kaj ima?', theme: 'light', map: null, elements: [] });
const recorded = (name: string): PageInventory => {
  const { label: _l, at: _a, zagreb: _z, surface: _s, scenario: _c, ...raw } = JSON.parse(readFileSync(join(root, 'test/fixtures/inventory', name), 'utf8')) as RawInventory;
  return raw;
};
const GOOD_PHONE: PhoneRead = { place: 'Trg bana J. Jelačića', sentence: 'Tramvaj 6 kreće za dvije minute.', sentenceChars: 32, departures: { total: 3, inViewport: 3 }, slop: [], tabs: ['Sada', 'Karta', 'Još'], shareCity: { present: true, visible: true, text: 'Podijeli grad' } };
const GOOD_KARTA: KartaRead = { status: 'ready', pills: '6|11|12', bodies: 40, unlabelled: 0, markers: 10, disclosures: 0 };
const GOOD_DESKTOP: DesktopRead = { sadaInViewport: true, kartaInViewport: true, domains: 0, shareCityVisible: true };

type Kind = 'kiosk' | 'portrait' | 'proxy' | 'phone' | 'desktop';
interface FakeOptions {
  reading?: (n: number, at: number, code: string) => WallSample;
  inventories?: Partial<Record<'kiosk' | 'portrait' | 'phone-sada' | 'phone-karta' | 'desktop', PageInventory>>;
  phone?: PhoneRead;
  karta?: KartaRead;
  desktop?: DesktopRead;
  axeViolations?: { id: string; impact: string; nodes: unknown[] }[];
  kioskConsoleError?: string;
  noInvitation?: boolean;
}
interface Handler { (arg: unknown): unknown }

function fakeRuntime(options: FakeOptions = {}) {
  let t = T0;
  const clock = { now: () => t, sleep: async (ms: number) => { t += ms; } };
  const log = { contexts: [] as { kind: Kind; options: Record<string, unknown> }[], gotos: [] as { kind: Kind; url: string; at: number }[], clicks: [] as { kind: Kind; selector: string }[], readings: 0 };
  const codeNow = (): string => CODES[Math.floor((t - T0) / 30_000) % CODES.length];
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
    const inv = (key: keyof NonNullable<FakeOptions['inventories']>, vw: number, vh: number): PageInventory => options.inventories?.[key] ?? EMPTY_INVENTORY(vw, vh);
    return {
      on(event: string, fn: Handler) { handlers.set(event, [...(handlers.get(event) ?? []), fn]); return this; },
      async goto(url: string) {
        log.gotos.push({ kind, url, at: t });
        if (kind === 'kiosk' && options.kioskConsoleError) emit('console', { type: () => 'error', text: () => options.kioskConsoleError, location: () => ({ url: 'https://zagreb.example/assets/kiosk.js' }) });
        if (url.includes('/s/#')) {
          emit('response', { url: () => 'https://zagreb.example/api/scan', status: () => 200, request: () => ({ method: () => 'POST' }), headers: () => ({ 'content-type': 'application/json' }), json: async () => ({ ticket: 'T-secret', room: 'R-secret' }), body: async () => Buffer.from('') });
        }
      },
      async waitForFunction(fn: unknown) {
        if (fn === INVITATION_READY_IN_PAGE && options.noInvitation) throw new Error('Timeout 90000ms exceeded.');
        return true;
      },
      async waitForTimeout(ms: number) { t += ms; },
      async screenshot({ path }: { path: string }) { writeFileSync(path, 'png'); },
      async click(selector: string) { log.clicks.push({ kind, selector }); if (kind === 'phone') onKarta = true; },
      clock: { runFor: async () => { throw new Error('the observer runs on the real clock'); } },
      async evaluate(fn: unknown, _arg?: unknown) {
        if (fn === wall.WALL_SAMPLE_IN_PAGE) { const n = log.readings++; return (options.reading ?? wallReading)(n, t, codeNow().replace('-', '·')); }
        if (fn === inventory.COLLECT_IN_PAGE) {
          if (kind === 'phone') return onKarta ? inv('phone-karta', 412, 839) : inv('phone-sada', 412, 839);
          if (kind === 'desktop') return inv('desktop', 1440, 900);
          return kind === 'portrait' ? inv('portrait', 1080, 1920) : inv('kiosk', 1920, 1080);
        }
        if (fn === legibility.LEGIBILITY_IN_PAGE) return { violations: [], warnings: [], symbols: [], otherSmall: [], dark: false };
        if (fn === PAIRING_IN_PAGE) return { code: codeNow(), href: `https://zagreb.example/s/#${codeNow()}`, progress: 80 };
        if (fn === PHONE_READ_IN_PAGE) return options.phone ?? GOOD_PHONE;
        if (fn === KARTA_READ_IN_PAGE) return options.karta ?? GOOD_KARTA;
        if (fn === DESKTOP_READ_IN_PAGE) return options.desktop ?? GOOD_DESKTOP;
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
    expect(files(r.out).sort()).toEqual(['captures/desktop-1440.png', 'captures/kiosk-1080x1920.png', 'captures/kiosk-1920x1080-dpr025-3m.png', 'captures/kiosk-1920x1080.png', 'captures/phone-karta-cold.png', 'captures/phone-sada.png', 'inventory.json', 'legibility.json', 'recorders.json', 'report.md', 'rotation.jsonl']);
    expect(read(r.out, 'rotation.jsonl').trim().split('\n')).toHaveLength(3);
    expect((JSON.parse(read(r.out, 'inventory.json')) as { label: string }[]).map((v) => v.label)).toEqual(['kiosk-1920x1080', 'phone-sada', 'phone-karta-cold', 'desktop-1440', 'kiosk-1080x1920']);
    expect(Object.keys((JSON.parse(read(r.out, 'legibility.json')) as { captures: object }).captures)).toEqual(['kiosk-1920x1080', 'kiosk-1080x1920']);
    const report = read(r.out, 'report.md');
    expect(report).toContain('Verdict: **PASS**.');
    expect(report).toContain('build abc1234');
    expect(report).toContain('- Screens created: 0');
    expect(report).toContain('- Code redemptions: phone 1, desktop 1');
    expect(report).toMatch(/\| pills-plus \| d1 \| kiosk \| no vehicle pill matches \/\\\+\\d\/ in any reading \| ≤ 0 \| 0 \| pass \|/);
    expect(report).not.toContain('**fail**');
  });

  it('never creates a screen, presents or opens settings: the only tap is the phone\'s Karta tab, the only redemptions are one per surface 12 s apart', async () => {
    const r = await observe([]);
    expect(r.log.clicks).toEqual([{ kind: 'phone', selector: `${inventory.PHONE_PROBES.kartaTab}:visible` }]);
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
});
