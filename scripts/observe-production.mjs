#!/usr/bin/env node
// Read-only production observer of the Kaj ima? companion (master brief §16.7, WP6 step 10).
//
// Usage, from the repo root:
//
//   E2E_KIOSK_URL=<the day's screen> npm run observe:production -- --minutes 10
//   node scripts/observe-production.mjs [--minutes 10] [--surfaces kiosk,phone,desktop]
//                                       [--stage d1|d2|d3|full] [--out review.local/observe-<stamp>]
//
// E2E_KIOSK_URL is the provisioning URL of a screen that already exists (…/kiosk/#<beacon>.<secret>): the
// day's temporary screen, made by hand through /kiosk/ (one per verification day, Q15). It is required;
// without it the run exits 2 before it loads a module or opens a connection. E2E_APP_URL, when set, moves
// the same screen onto another origin (a local wrangler dev run). The URL is never printed or written: its
// secret, every pairing code and every ticket are masked in each file the run writes.
//
// What it never does. It has no code path that creates a screen, never presents a view to the screen, never
// opens the screen's settings and presses nothing on the screen: the wall is read through its DOM only. It
// redeems at most one code per surface (phone, desktop), each read from the screen's own page and at least
// 12 s apart (REDEMPTION_SPACING_MS), so a full run spends two ten-minute sessions and no screen.
//
// What it does. The wall at 1920×1080 for `--minutes` of real time (one reading every 2 s, e2e/wall.ts),
// its first viewport (e2e/inventory.ts) and its 3-metre legibility (e2e/legibility.ts); meanwhile a Pixel 7
// and a 1440×900 desktop each redeem one code and are read the same way (Sada, Karta cold open, axe); after
// the rotation the wall in portrait (1080×1920) and a DPR 0.25 proxy screenshot. The instruments are the
// TypeScript modules the accept specs use, loaded through a throwaway Vite loader (the pattern of
// scripts/audit-production.mjs), so a production verdict and a local one read the same selectors and numbers.
//
// Output: review.local/observe-<stamp>/ with inventory.json, rotation.jsonl, legibility.json, report.md,
// plus recorders.json and captures/*.png (all gitignored through *.local; --out must stay in such a folder
// or outside the repository). Exit codes: 0 every applied threshold holds; 1 a threshold fails; 2 the run
// could not observe (no E2E_KIOSK_URL, a bad argument, the loader or the browser did not start, the screen
// never showed its invitation).
//
// Thresholds (THRESHOLDS below) are one table, each row tagged with the deploy it belongs to: `--stage d1`
// applies the pills and recorder rows only (before the wall lands), d2 adds the wall (§16.3), d3 the phone and
// desktop (§16.4), `full` (the default) applies every row. Rows above the chosen stage are still measured and
// reported, as information.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// --- run constants -------------------------------------------------------------------------------
export const DEFAULT_MINUTES = 10;
/** A longer run is a mistake, not an observation: ten minutes is the design. */
export const MAX_MINUTES = 60;
export const SURFACES = Object.freeze(['kiosk', 'phone', 'desktop']);
/** Deploys in order (brief §15.3): D1 trust (pills), D2 wall, D3 phone. `full` applies all of them. */
export const STAGES = Object.freeze(['d1', 'd2', 'd3']);
export const STAGE_ALL = 'full';
/** Code redemptions per surface; each is a real ten-minute session on production. */
export const REDEMPTIONS_PER_SURFACE = 1;
/** Between two redemptions (≤ 5 per minute overall, the walkthroughs' rule). */
export const REDEMPTION_SPACING_MS = 12_000;
/** Added when the observer waits, so request latency cannot bring two scans under REDEMPTION_SPACING_MS. */
export const REDEMPTION_MARGIN_MS = 3_000;
/** Appended to Chromium's own user agent, so the owner can tell the observer's requests apart. */
export const USER_AGENT_SUFFIX = ' kajima-observer/1 (read-only)';
/** §12: a sentence is never repeated verbatim within ten minutes. */
export const REPEAT_WINDOW_MS = 10 * 60_000;
export const AXE_TAGS = Object.freeze(['wcag2a', 'wcag2aa', 'wcag21aa']);
export const INVITATION_TIMEOUT_MS = 90_000;
export const MAP_SETTLE_TIMEOUT_MS = 45_000;
export const SETTLE_MS = 2_500;
export const SESSION_TIMEOUT_MS = 60_000;
/** Codes rotate every 30 s; three rotations is enough to find one this run has not spent. */
export const CODE_TIMEOUT_MS = 90_000;
/** A code in its last quarter (aria-valuenow < 25) is left alone: it would expire on the way. */
export const CODE_MIN_PROGRESS = 25;
export const SADA_TIMEOUT_MS = 20_000;
export const KARTA_READY_TIMEOUT_MS = 30_000;
/** How long the Karta pill poll keeps going after the 2 s threshold, so the report can say when pills came. */
export const KARTA_POLL_MS = 10_000;
export const POLL_MS = 100;
export const PROXY_SETTLE_MS = 3_000;
/** Elements whose text is a pairing or share code: masked in every file. */
export const CODE_TESTIDS = Object.freeze(['code-a', 'code-b', 'pair-code', 'kiosk-code', 'pair-url', 'share-code']);
/** The pairing elements read for a redemption; the same names e2e/helpers.ts readPairing reads. */
export const PAIRING_PROBES = Object.freeze({
  codeA: '[data-testid=code-a]',
  codeB: '[data-testid=code-b]',
  link: '[data-testid=pair-url]',
  progress: '[data-testid=code-progress]',
});
/** The session is live: today's session label, or Sada's place once WP4 lands. */
export const SESSION_LIVE = '[data-testid=session-label][data-state=live]';
/** A failed request Chromium reports as aborted: a navigation or the app's own AbortController, not a failure. */
export const ABORTED = 'net::ERR_ABORTED';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const USAGE = `Read-only production observer (master brief §16.7).

  E2E_KIOSK_URL=<provisioning URL of the day's screen> npm run observe:production -- --minutes 10

Options:
  --minutes N         real-time wall rotation, 0 < N ≤ ${MAX_MINUTES} (default ${DEFAULT_MINUTES})
  --surfaces LIST     kiosk,phone,desktop (default all three; kiosk is required: codes come from its page)
  --stage S           ${STAGES.join(' | ')} | ${STAGE_ALL} (default ${STAGE_ALL}); d1 = pills and recorders only
  --out DIR           output folder (default review.local/observe-<stamp>); inside the repo it must be a *.local folder
  --help              this text

Never creates a screen, never presents, never opens settings, presses nothing on the screen.
Exit 0 all applied thresholds hold, 1 a threshold fails, 2 the run could not observe.`;

/** A run refused before it starts: exit code 2, and a message that never repeats a secret. */
export class ObserverRefusal extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = 'ObserverRefusal';
    this.exitCode = exitCode;
  }
}
/** The screen named by E2E_KIOSK_URL never showed its invitation: nothing to observe (exit 2). */
export class KioskUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = 'KioskUnavailable';
  }
}

// --- arguments and environment ----------------------------------------------------------------------
/** `--name value` or `--name=value`; unknown flags and bad values are refused (exit 2). */
export function parseArgs(argv) {
  const args = { minutes: DEFAULT_MINUTES, surfaces: [...SURFACES], stage: STAGE_ALL, out: null, help: false };
  const list = [...argv];
  while (list.length) {
    const raw = list.shift();
    if (raw === '--help' || raw === '-h') { args.help = true; continue; }
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(raw);
    if (!m) throw new ObserverRefusal(`observe-production: unexpected argument "${raw}"\n\n${USAGE}`);
    const [, name, inline] = m;
    const value = () => {
      if (inline !== undefined) return inline;
      if (!list.length || list[0].startsWith('--')) throw new ObserverRefusal(`observe-production: --${name} needs a value`);
      return list.shift();
    };
    if (name === 'minutes') {
      const text = value();
      const n = Number(text);
      if (!Number.isFinite(n) || n <= 0 || n > MAX_MINUTES) throw new ObserverRefusal(`observe-production: --minutes must be a number above 0 and at most ${MAX_MINUTES}, not "${text}"`);
      args.minutes = n;
    } else if (name === 'surfaces') {
      const surfaces = value().split(',').map((s) => s.trim()).filter(Boolean);
      const unknown = surfaces.filter((s) => !SURFACES.includes(s));
      if (unknown.length) throw new ObserverRefusal(`observe-production: unknown surface(s) ${unknown.join(', ')}; choose from ${SURFACES.join(', ')}`);
      if (!surfaces.includes('kiosk')) throw new ObserverRefusal('observe-production: --surfaces must include kiosk: the phone and the desktop redeem codes read from the screen\'s own page');
      args.surfaces = SURFACES.filter((s) => surfaces.includes(s));
    } else if (name === 'stage') {
      const stage = value();
      if (![...STAGES, STAGE_ALL].includes(stage)) throw new ObserverRefusal(`observe-production: --stage must be one of ${[...STAGES, STAGE_ALL].join(', ')}, not "${stage}"`);
      args.stage = stage;
    } else if (name === 'out') {
      args.out = value();
    } else {
      throw new ObserverRefusal(`observe-production: unknown option --${name}\n\n${USAGE}`);
    }
  }
  return args;
}

/**
 * The screen to observe, from the environment. E2E_KIOSK_URL is required and must carry a
 * `#<beacon>.<secret>` fragment; the messages never quote the value. E2E_APP_URL moves it to another origin.
 */
export function kioskFromEnv(env) {
  const raw = String(env.E2E_KIOSK_URL ?? '').trim();
  if (!raw) {
    throw new ObserverRefusal(
      'observe-production: E2E_KIOSK_URL is not set. Set it to the provisioning URL of an existing screen (…/kiosk/#<beacon>.<secret>, the day\'s temporary screen); this script never creates a screen.',
    );
  }
  let url;
  try { url = new URL(raw); } catch { throw new ObserverRefusal('observe-production: E2E_KIOSK_URL is not an absolute URL (value not shown)'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new ObserverRefusal('observe-production: E2E_KIOSK_URL must be an http(s) URL (value not shown)');
  const m = /^#([^.#]+)\.([^.#]+)$/.exec(url.hash);
  if (!m) throw new ObserverRefusal('observe-production: E2E_KIOSK_URL has no #<beacon>.<secret> fragment; it must be a screen\'s provisioning URL (value not shown)');
  let origin = url.origin;
  const app = String(env.E2E_APP_URL ?? '').trim();
  if (app) {
    try { origin = new URL(app).origin; } catch { throw new ObserverRefusal('observe-production: E2E_APP_URL is not an absolute URL'); }
  }
  return { kioskUrl: `${origin}/kiosk/${url.hash}`, origin, beaconId: m[1], secrets: [`${m[1]}.${m[2]}`, m[2]] };
}

/** The output folder: review.local/observe-<stamp> by default; inside the repo only a gitignored *.local folder. */
export function outDirFor(out, root, stamp) {
  if (!out) return resolve(root, 'review.local', `observe-${stamp}`);
  const dir = resolve(root, out);
  const rel = relative(root, dir);
  const insideRepo = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  if (insideRepo && !rel.split(sep).some((part) => part.endsWith('.local'))) {
    throw new ObserverRefusal(`observe-production: --out ${out} is inside the repository but not in a *.local folder; production captures show live codes and never enter git (use review.local/…)`);
  }
  return dir;
}

export const stampOf = (date) => date.toISOString().replace(/[:.]/g, '-');

/** Everything a run needs, or an ObserverRefusal. Touches no network and no module beyond node's own. */
export function configFrom({ argv, env, root = ROOT, now = new Date() }) {
  const args = parseArgs(argv);
  if (args.help) return { ...args };
  const kiosk = kioskFromEnv(env);
  return { ...args, ...kiosk, root, startedAt: now.toISOString(), outDir: outDirFor(args.out, root, stampOf(now)) };
}

// --- masking --------------------------------------------------------------------------------------
const CROCKFORD = '[0-9A-HJKMNP-TV-Z]';
const CODE_PAIR = new RegExp(`\\b${CROCKFORD}{4}[·-]${CROCKFORD}{4}\\b`, 'g');
const CODE_HALF = new RegExp(`^${CROCKFORD}{4}$`);

/**
 * One function every written byte passes through: the screen's secret, `/kiosk/#…` and `/s/#…` fragments,
 * ticket-like query values and pairing codes (both halves of every code this run saw) become '…' or '••••'.
 */
export function makeScrubber(secrets = []) {
  const literals = secrets.filter((s) => typeof s === 'string' && s.length >= 4).sort((a, b) => b.length - a.length);
  const halves = new Set();
  const scrub = (text) => {
    let s = String(text);
    for (const lit of literals) s = s.split(lit).join('…');
    s = s.replace(/(\/(?:kiosk|s)\/)#[^\s"'`)\]\\]*/g, '$1#…');
    s = s.replace(/([?&](?:room|ticket|token|secret|label|code)=)[^&#\s"'`)\]\\]*/g, '$1…');
    s = s.replace(CODE_PAIR, '••••·••••');
    for (const h of halves) s = s.replace(new RegExp(`\\b${h}\\b`, 'g'), '••••');
    return s;
  };
  scrub.noteCode = (code) => {
    for (const part of String(code ?? '').split(/[·\-\s]+/)) if (CODE_HALF.test(part)) halves.add(part);
  };
  return scrub;
}

// --- the redemption budget ----------------------------------------------------------------------------
/** At most `perSurface` redemptions per surface, `spacingMs` apart; a breach throws before any request. */
export function redemptionBudget({ perSurface = REDEMPTIONS_PER_SURFACE, spacingMs = REDEMPTION_SPACING_MS } = {}) {
  const counts = new Map();
  const times = [];
  const guard = (surface) => {
    if ((counts.get(surface) ?? 0) >= perSurface) throw new Error(`the ${surface} has already redeemed ${perSurface} code(s); the observer redeems at most ${perSurface} per surface`);
  };
  return {
    /** How long to wait before this surface may redeem (0 when the last redemption is ≥ spacingMs ago). */
    waitMs(surface, now) {
      guard(surface);
      const last = times.at(-1);
      return last === undefined ? 0 : Math.max(0, last.at + spacingMs - now);
    },
    take(surface, now) {
      guard(surface);
      const last = times.at(-1);
      if (last !== undefined && now - last.at < spacingMs) throw new Error(`redemptions ${Math.round(now - last.at)} ms apart (at least ${spacingMs} ms)`);
      counts.set(surface, (counts.get(surface) ?? 0) + 1);
      times.push({ surface, at: now });
    },
    counts: () => Object.fromEntries(counts),
    times: () => times.map((t) => ({ ...t })),
  };
}

// --- page-side readings (serialised by Playwright: they reference only their argument and the DOM) -----
export const INVITATION_READY_IN_PAGE = (spec) => {
  const code = document.querySelector(spec.code);
  const shown = new RegExp(spec.shown.source, spec.shown.flags);
  return Boolean(document.querySelector(spec.invitation)) && shown.test((code ? code.textContent || '' : '').replace(/\s+/g, '').trim());
};
export const MAP_SETTLED_IN_PAGE = (spec) => {
  const m = document.querySelector(spec.map);
  const status = m ? m.getAttribute('data-map-status') : null;
  return Boolean(status) && !spec.pending.includes(status);
};
export const ANY_PRESENT_IN_PAGE = (spec) => spec.selectors.some((s) => Boolean(document.querySelector(s)));
export const PAIRING_IN_PAGE = (p) => {
  const text = (s) => ((document.querySelector(s) || {}).textContent || '').trim();
  const link = document.querySelector(p.link);
  const bar = document.querySelector(p.progress);
  return {
    code: `${text(p.codeA)}-${text(p.codeB)}`,
    href: ((link && (link.getAttribute('href') || link.textContent)) || '').trim(),
    progress: bar ? Number(bar.getAttribute('aria-valuenow') ?? 100) : 100,
  };
};
export const PHONE_READ_IN_PAGE = (spec) => {
  const words = (el) => ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
  const shown = (el) => {
    if (!el || el.hidden || el.closest('[hidden]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  };
  const place = document.querySelector(spec.place);
  const sentence = document.querySelector(spec.sentence);
  const rows = Array.from(document.querySelectorAll(spec.departures)).filter(shown);
  const inside = rows.filter((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
  const flags = spec.slop.flags.includes('g') ? spec.slop.flags : `${spec.slop.flags}g`;
  const share = document.querySelector(spec.shareCity);
  return {
    place: place ? words(place) : null,
    sentence: sentence ? words(sentence) : null,
    sentenceChars: sentence ? Array.from(words(sentence)).length : 0,
    departures: { total: rows.length, inViewport: inside.length },
    slop: (document.body.innerText.match(new RegExp(spec.slop.source, flags)) || []).slice(0, 10),
    tabs: Array.from(document.querySelectorAll(spec.tab)).filter(shown).map(words),
    shareCity: { present: Boolean(share), visible: shown(share), text: words(share) },
  };
};
export const KARTA_READ_IN_PAGE = (spec) => {
  const m = document.querySelector(spec.map);
  const num = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const d = m ? m.dataset : {};
  return { status: d.mapStatus ?? null, pills: d.pills ?? null, bodies: num(d.bodies), unlabelled: num(d.unlabelled), markers: num(d.markers), disclosures: document.querySelectorAll(spec.disclosures).length };
};
export const DESKTOP_READ_IN_PAGE = (spec) => {
  const inView = (s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };
  return { sadaInViewport: inView(spec.sada), kartaInViewport: inView(spec.karta), domains: document.querySelectorAll(spec.domains).length, shareCityVisible: inView(spec.shareCity) };
};

const shipped = (re) => ({ source: re.source, flags: re.flags });
const phoneSpec = (P, slop) => ({ place: P.sadaPlace, sentence: P.sadaSentence, departures: P.departureRows, tab: P.tab, shareCity: P.shareCity, slop: shipped(slop) });
const errText = (e) => String(e && e.message ? e.message : e).split(/\r?\n/)[0].slice(0, 300);
const zagreb = (ms) => new Date(ms).toLocaleString('hr-HR', { timeZone: 'Europe/Zagreb', hour12: false });

// --- observing ----------------------------------------------------------------------------------------
/** A browser context with the observer's user agent and a recorder on its one page. */
async function openPage(browser, ctx, name, surface, options) {
  const context = await browser.newContext({ locale: 'hr-HR', timezoneId: 'Europe/Zagreb', colorScheme: 'light', ...options });
  const page = await context.newPage();
  // The recorder shares the observer's clock, so the redemption spacing is read on one time line.
  const entry = { surface, recorder: ctx.instruments.recorders.attachRecorders(page, name, { now: () => new Date(ctx.now()) }), snapshot: null };
  ctx.recorders.push(entry);
  return { context, page, entry };
}

/** The recorder's report as the page last saw it, taken before its context closes (closing aborts what is in flight). */
export function freeze(entry) {
  if (entry.snapshot) return entry.snapshot;
  const { surface, recorder } = entry;
  const all = recorder.problems();
  const aborted = all.filter((p) => p.startsWith('failed request: ') && p.endsWith(`(${ABORTED})`));
  entry.snapshot = {
    surface,
    ...recorder.report(),
    problems: all.filter((p) => !aborted.includes(p)),
    aborted: aborted.length,
    scanTimes: recorder.dataResponses.filter((r) => r.method === 'POST' && r.path.startsWith('/api/scan')).map((r) => r.t),
  };
  return entry.snapshot;
}

async function closePage(opened) {
  freeze(opened.entry);
  await opened.context.close().catch(() => {});
}

async function shot(page, name, ctx) {
  const file = join(ctx.capturesDir, `${name}.png`);
  try {
    await page.screenshot({ path: file });
    ctx.captures.push(`captures/${name}.png`);
  } catch (e) {
    ctx.error(`screenshot ${name}`, e);
  }
}

/** The screen from its provisioning URL; throws KioskUnavailable when the invitation never shows a code. */
export async function openKiosk(page, ctx) {
  const { wall, lib } = ctx.instruments;
  try {
    await page.goto(ctx.kioskUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(INVITATION_READY_IN_PAGE, { invitation: wall.WALL_PROBES.invitation, code: wall.WALL_PROBES.code, shown: shipped(lib.CODE_SHOWN_RE) }, { timeout: INVITATION_TIMEOUT_MS });
  } catch (e) {
    throw new KioskUnavailable(`the screen named by E2E_KIOSK_URL showed no invitation with a code within ${INVITATION_TIMEOUT_MS / 1000} s (expired, revoked or not a screen?): ${errText(e)}`);
  }
  await page.waitForFunction(MAP_SETTLED_IN_PAGE, { map: wall.WALL_PROBES.map, pending: ['loading'] }, { timeout: MAP_SETTLE_TIMEOUT_MS })
    .catch(() => ctx.note(`kiosk: the map did not settle within ${MAP_SETTLE_TIMEOUT_MS / 1000} s`));
  await ctx.sleep(SETTLE_MS);
}

/** The first viewport of a page, classified, with the wall's aside disclaimers; the full units go to inventory.json. */
export async function viewportOf(page, label, extra, ctx, { wall = false } = {}) {
  const { inventory } = ctx.instruments;
  const view = await inventory.firstViewport(page, label, extra);
  ctx.inventories.push(view);
  const aside = wall ? inventory.unitsWithin(view.units, inventory.WALL_ASIDE_MARKS).filter((u) => u.class === 'EMPTY/DISCLAIMER') : [];
  const counts = Object.fromEntries(inventory.CLASSES.map((c) => [c, view.summary.perClass[c].count]));
  return {
    label, surface: extra.surface ?? null, scenario: extra.scenario ?? null, at: view.inventory.at, zagreb: view.inventory.zagreb,
    units: view.summary.elementCount, counts, perClass: view.summary.perClass, coveredHeightShare: view.summary.coveredHeightShare,
    unclassified: view.summary.unclassified, asideDisclaimers: aside.map((u) => (u.text || u.value || u.ariaLabel || `<${u.tag}>`).slice(0, 80)),
    failures: inventory.firstViewportFailures(view, { wall }),
  };
}

/** One wall capture: a reading, the first viewport, the legibility report, a screenshot. */
export async function readKiosk(page, label, surface, ctx) {
  const { wall, legibility } = ctx.instruments;
  const sample = await wall.wallSample(page);
  ctx.scrub.noteCode(sample.code);
  const viewport = await viewportOf(page, label, { surface, scenario: 'the passive wall' }, ctx, { wall: true });
  let legible = null;
  try { legible = await legibility.legibilityReport(page, legibility.WALL_1920); } catch (e) { ctx.error(`${label} legibility`, e); }
  await shot(page, label, ctx);
  return { sample, viewport, legibility: legible };
}

/** The rotation in real time, every reading appended to rotation.jsonl as it is made. */
export async function rotate(page, ctx) {
  const { wall } = ctx.instruments;
  const steps = Math.max(1, Math.round((ctx.minutes * 60_000) / wall.ROTATION_STEP_MS));
  return wall.sampleRotation(page, {
    steps, stepMs: wall.ROTATION_STEP_MS, clock: 'real',
    onSample: (row) => {
      if (!('error' in row)) ctx.scrub.noteCode(row.code);
      ctx.appendRotation(row);
    },
  });
}

/** A code from the screen's own page that this run has not spent, as a scan URL on the observed origin. */
export async function freshScanUrl(kioskPage, ctx) {
  const { lib } = ctx.instruments;
  const deadline = ctx.now() + CODE_TIMEOUT_MS;
  while (ctx.now() < deadline) {
    const p = await kioskPage.evaluate(PAIRING_IN_PAGE, PAIRING_PROBES);
    if (lib.CODE_RE.test(p.code) && !ctx.usedCodes.has(p.code) && p.progress >= CODE_MIN_PROGRESS && p.href.includes(`#${p.code}`)) {
      ctx.usedCodes.add(p.code);
      ctx.scrub.noteCode(p.code);
      return lib.rebaseUrl(new URL(p.href, ctx.origin).toString(), ctx.origin);
    }
    await ctx.sleep(1000);
  }
  throw new Error(`no fresh code on the screen within ${CODE_TIMEOUT_MS / 1000} s`);
}

/** One redemption for `surface` inside the budget: wait out the spacing, read a fresh code, land in the live session. */
export async function redeem(page, kioskPage, surface, ctx) {
  const wait = ctx.budget.waitMs(surface, ctx.now());
  if (wait > 0) {
    ctx.note(`${surface}: waiting ${Math.ceil(wait / 1000)} s so redemptions stay at least ${REDEMPTION_SPACING_MS / 1000} s apart`);
    await ctx.sleep(wait);
  }
  const scanUrl = await freshScanUrl(kioskPage, ctx);
  ctx.budget.take(surface, ctx.now());
  const t0 = ctx.now();
  await page.goto(scanUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(ANY_PRESENT_IN_PAGE, { selectors: [SESSION_LIVE, ctx.instruments.inventory.PHONE_PROBES.sadaPlace] }, { timeout: SESSION_TIMEOUT_MS });
  return ctx.now() - t0;
}

async function axeOf(page, ctx, label) {
  if (!ctx.axe) return null;
  try { return await ctx.axe(page); } catch (e) { ctx.error(`${label} axe`, e); return null; }
}

/** What a phone phase fills; a failure part way keeps what was read. */
export const newPhone = () => ({ landingMs: null, sada: null, karta: null, axe: { sada: null, karta: null }, viewports: [] });
export const newDesktop = () => ({ landingMs: null, read: null, viewports: [] });

/** The phone: one redemption, Sada's first viewport and reading, then Karta's cold open (one tab tap). */
export async function observePhone(page, kioskPage, ctx, out = newPhone()) {
  const { inventory } = ctx.instruments;
  const P = inventory.PHONE_PROBES;
  out.landingMs = await redeem(page, kioskPage, 'phone', ctx);
  await page.waitForFunction(ANY_PRESENT_IN_PAGE, { selectors: [P.sadaPlace, P.sadaDepartures] }, { timeout: SADA_TIMEOUT_MS })
    .catch(() => ctx.note(`phone: neither ${P.sadaPlace} nor ${P.sadaDepartures} within ${SADA_TIMEOUT_MS / 1000} s`));
  await ctx.sleep(SETTLE_MS);
  out.viewports.push(await viewportOf(page, 'phone-sada', { surface: 'phone', scenario: 'Sada right after redemption' }, ctx));
  out.sada = await page.evaluate(PHONE_READ_IN_PAGE, phoneSpec(P, inventory.PHONE_SLOP_RE));
  out.axe.sada = await axeOf(page, ctx, 'phone Sada');
  await shot(page, 'phone-sada', ctx);

  // Karta cold open: the one tap is the tab; pills must follow within KARTA_PILLS_WITHIN_MS of the map being ready.
  await page.click(`${P.kartaTab}:visible`, { timeout: 10_000 });
  await page.waitForFunction(MAP_SETTLED_IN_PAGE, { map: P.mapCanvas, pending: ['loading'] }, { timeout: KARTA_READY_TIMEOUT_MS })
    .catch(() => ctx.note(`phone Karta: the map did not settle within ${KARTA_READY_TIMEOUT_MS / 1000} s`));
  const spec = { map: P.mapCanvas, disclosures: P.kartaDisclosures };
  const readyAt = ctx.now();
  let read = await page.evaluate(KARTA_READ_IN_PAGE, spec);
  let pillsAfterMs = null;
  if (read.status === 'ready') {
    for (;;) {
      if (read.pills) { pillsAfterMs = ctx.now() - readyAt; break; }
      if (ctx.now() - readyAt > KARTA_POLL_MS) break;
      await ctx.sleep(POLL_MS);
      read = await page.evaluate(KARTA_READ_IN_PAGE, spec);
    }
  }
  out.karta = { ...read, pillsAfterMs };
  out.viewports.push(await viewportOf(page, 'phone-karta-cold', { surface: 'phone', scenario: 'Karta cold open (one tap: the tab)' }, ctx));
  out.axe.karta = await axeOf(page, ctx, 'phone Karta');
  await shot(page, 'phone-karta-cold', ctx);
  return out;
}

/** The desktop: one redemption (spaced from the phone's), Sada and Karta side by side. */
export async function observeDesktop(page, kioskPage, ctx, out = newDesktop()) {
  const { inventory } = ctx.instruments;
  const P = inventory.PHONE_PROBES;
  out.landingMs = await redeem(page, kioskPage, 'desktop', ctx);
  await page.waitForFunction(ANY_PRESENT_IN_PAGE, { selectors: [P.desktopSada, P.desktopKarta] }, { timeout: SADA_TIMEOUT_MS })
    .catch(() => ctx.note(`desktop: neither ${P.desktopSada} nor ${P.desktopKarta} within ${SADA_TIMEOUT_MS / 1000} s`));
  await ctx.sleep(SETTLE_MS);
  out.viewports.push(await viewportOf(page, 'desktop-1440', { surface: 'desktop', scenario: 'right after redemption' }, ctx));
  out.read = await page.evaluate(DESKTOP_READ_IN_PAGE, { sada: P.desktopSada, karta: P.desktopKarta, domains: P.domains, shareCity: P.shareCity });
  await shot(page, 'desktop-1440', ctx);
  return out;
}

/** The whole observation: wall landscape + rotation, phone and desktop meanwhile, then portrait and the proxy. */
export async function observeAll(browser, ctx, observation) {
  const { scenes } = ctx.instruments;
  const surfaces = observation.meta.surfaces;
  const desktopUa = `${ctx.devices['Desktop Chrome'].userAgent}${USER_AGENT_SUFFIX}`;
  const kiosk = { first: null, portrait: null, rotation: [], viewports: [], legibility: {}, proxy: null };
  observation.kiosk = kiosk;

  const landscape = await openPage(browser, ctx, 'kiosk-1920x1080', 'kiosk', { viewport: { ...scenes.WALL_LANDSCAPE }, deviceScaleFactor: 1, userAgent: desktopUa });
  await openKiosk(landscape.page, ctx);
  const first = await readKiosk(landscape.page, 'kiosk-1920x1080', 'kiosk', ctx);
  kiosk.first = first.sample;
  kiosk.viewports.push(first.viewport);
  kiosk.legibility['kiosk-1920x1080'] = first.legibility;
  ctx.note(`kiosk: first reading; rotation for ${ctx.minutes} min`);
  const rotation = rotate(landscape.page, ctx);

  // Nothing below may throw past this point: the rotation is running and must be awaited.
  if (surfaces.includes('phone')) {
    observation.phone = newPhone();
    try {
      const phone = await openPage(browser, ctx, 'phone', 'phone', { ...ctx.devices['Pixel 7'], userAgent: `${ctx.devices['Pixel 7'].userAgent}${USER_AGENT_SUFFIX}` });
      await observePhone(phone.page, landscape.page, ctx, observation.phone);
    } catch (e) { ctx.error('phone', e); observation.phone.failed = errText(e); }
  }
  if (surfaces.includes('desktop')) {
    observation.desktop = newDesktop();
    try {
      const desktop = await openPage(browser, ctx, 'desktop-1440', 'desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, userAgent: desktopUa });
      await observeDesktop(desktop.page, landscape.page, ctx, observation.desktop);
    } catch (e) { ctx.error('desktop', e); observation.desktop.failed = errText(e); }
  }

  kiosk.rotation = await rotation;
  ctx.note(`kiosk: rotation done, ${kiosk.rotation.length} readings`);
  // A second socket for the same screen closes the first (4004), so portrait and the proxy wait for the rotation.
  await closePage(landscape);

  try {
    const portrait = await openPage(browser, ctx, 'kiosk-1080x1920', 'kiosk', { viewport: { ...scenes.WALL_PORTRAIT }, deviceScaleFactor: 1, userAgent: desktopUa });
    await openKiosk(portrait.page, ctx);
    const read = await readKiosk(portrait.page, 'kiosk-1080x1920', 'kiosk-portrait', ctx);
    kiosk.portrait = read.sample;
    kiosk.viewports.push(read.viewport);
    kiosk.legibility['kiosk-1080x1920'] = read.legibility;
    await closePage(portrait);
  } catch (e) { ctx.error('kiosk portrait', e); }

  try {
    const proxy = await openPage(browser, ctx, 'kiosk-3m-proxy', 'kiosk', { viewport: { ...scenes.WALL_LANDSCAPE }, deviceScaleFactor: scenes.PROXY_DEVICE_SCALE_FACTOR, userAgent: desktopUa });
    await openKiosk(proxy.page, ctx);
    await ctx.sleep(PROXY_SETTLE_MS);
    const name = `kiosk-1920x1080-dpr${String(scenes.PROXY_DEVICE_SCALE_FACTOR).replace('.', '')}-3m`;
    await shot(proxy.page, name, ctx);
    if (ctx.captures.includes(`captures/${name}.png`)) kiosk.proxy = `captures/${name}.png`;
    await closePage(proxy);
  } catch (e) { ctx.error('kiosk 3 m proxy', e); }
  return observation;
}

// --- thresholds: one table, each row tagged with its deploy -------------------------------------------
const T = (id, stage, surface, metric, bound, target, source) => Object.freeze({ id, stage, surface, metric, ...bound, target, source });
const NONE = { max: 0 };
/**
 * Every row the observer judges. `metric` names a METRICS entry (a count of offences, or of readings); a row
 * holds when the measured value is within `min`/`max`, and fails when it could not be measured. `{NAME}` in a
 * target is filled from the constants of e2e/wall.ts, e2e/inventory.ts and e2e/legibility.ts, the accept
 * specs' own numbers.
 */
export const THRESHOLDS = Object.freeze([
  // D1: before the wall lands, only the pills and the recorders.
  T('wall-read', 'd1', 'kiosk', 'kiosk.readings', { min: 1 }, 'the wall is read at least once (first reading, rotation, portrait)', '§16.7'),
  T('pills-plus', 'd1', 'kiosk', 'kiosk.plusPillReadings', NONE, 'no vehicle pill matches {PLUS_PILL_RE} in any reading', '§16.3, D1'),
  T('karta-pills-plus', 'd1', 'phone', 'phone.kartaPlusPills', NONE, 'no vehicle pill on the Karta cold open matches {PLUS_PILL_RE}', '§16.4, D1'),
  T('recorders-kiosk', 'd1', 'kiosk', 'kiosk.recorderProblems', NONE, 'console errors, page errors, failed requests, HTTP ≥ 400 on the wall pages: none', '§16.3'),
  T('recorders-phone', 'd1', 'phone', 'phone.recorderProblems', NONE, 'console errors, page errors, failed requests, HTTP ≥ 400 on the phone: none', '§16.4'),
  T('recorders-desktop', 'd1', 'desktop', 'desktop.recorderProblems', NONE, 'console errors, page errors, failed requests, HTTP ≥ 400 on the desktop: none', '§16.4'),
  T('no-screen', 'd1', 'all', 'all.screenCreations', NONE, 'no screen created by the run', '§16.7, Q15'),
  T('redemptions', 'd1', 'all', 'all.redemptionsOverBudget', NONE, 'at most one code redemption per surface, at least 12 s apart', '§16.7'),
  // D2: the wall (WP1, WP2, WP3).
  T('place', 'd2', 'kiosk', 'kiosk.emptyPlaceReadings', NONE, 'kiosk-context non-empty in every reading', '§16.3, D2'),
  T('departures', 'd2', 'kiosk', 'kiosk.departuresOutOfRange', NONE, '{DEPARTURES_MIN}–{DEPARTURES_MAX} departure rows in every reading', '§16.3, [O-65]'),
  T('unlabelled', 'd2', 'kiosk', 'kiosk.unlabelledReadings', NONE, 'data-unlabelled = 0 in every reading (a missing probe counts)', '§16.3, D2'),
  T('pills-drawn', 'd2', 'kiosk', 'kiosk.pillsEmptyReadings', NONE, 'vehicle pills drawn (data-pills non-empty) in every reading', '[O-71]'),
  T('sentence-length', 'd2', 'kiosk', 'kiosk.sentenceOutOfRange', NONE, 'the sentence has 1–{SENTENCE_MAX_CHARS} characters in every reading', '§16.3, §12'),
  T('sentence-ellipsis', 'd2', 'kiosk', 'kiosk.sentenceEllipses', NONE, 'no sentence cut by an ellipsis', '§16.3'),
  T('sentence-overflow', 'd2', 'kiosk', 'kiosk.sentenceOverflows', NONE, 'no sentence overflowing its box', '§16.3'),
  T('sentence-repeat', 'd2', 'kiosk', 'kiosk.sentenceRepeats', NONE, 'no sentence repeated verbatim within ten minutes', '§12'),
  T('solar', 'd2', 'kiosk', 'kiosk.solarOverMax', NONE, 'at most {SOLAR_ROWS_MAX} solar row per reading', '§16.3, §12'),
  T('rows-timed', 'd2', 'kiosk', 'kiosk.untimedReadings', NONE, 'every row carries data-when or data-always', '§16.3'),
  T('caveats', 'd2', 'kiosk', 'kiosk.caveatRows', NONE, 'no row reads as a caveat', '§16.3, principle 5'),
  T('closure-reentries', 'd2', 'kiosk', 'kiosk.closureReentries', NONE, 'no closure row leaves the list and comes back', '§16.3'),
  T('last-passed', 'd2', 'kiosk', 'kiosk.pastLastRows', NONE, 'no last-departure row whose time has passed', '[O-41]'),
  T('controls', 'd2', 'kiosk', 'kiosk.controlReadings', NONE, 'no control a passer-by can press in the invitation or the header', '§16.3, principle 8'),
  T('retired-chrome', 'd2', 'kiosk', 'kiosk.retiredChromeReadings', NONE, 'no retired operator control in the DOM', '§15.6'),
  T('qr', 'd2', 'kiosk', 'kiosk.qrUnderMin', NONE, 'QR SVG at least {QR_MIN_PX} × {QR_MIN_PX} px (landscape and portrait)', '§16.3'),
  T('footer-clock', 'd2', 'kiosk', 'kiosk.stripClockReadings', NONE, 'the footer prints no clock time', '§16.3'),
  T('nearby-head', 'd2', 'kiosk', 'kiosk.nearbyHeadMismatches', NONE, 'the list head matches {NEARBY_HEAD_RE}', '§16.3, [O-68]'),
  T('lead', 'd2', 'kiosk', 'kiosk.leadMismatches', NONE, 'the QR lead reads exactly "{LEAD_TEXT}"', '§16.3'),
  T('wall-instruction', 'd2', 'kiosk', 'kiosk.fv.instruction', NONE, 'INSTRUCTION 0 in the first viewport (landscape and portrait)', '§16.3, principle 1'),
  T('wall-count', 'd2', 'kiosk', 'kiosk.fv.count', NONE, 'COUNT 0 in the first viewport (landscape and portrait)', '§16.3, principle 1'),
  T('wall-unclassified', 'd2', 'kiosk', 'kiosk.fv.unclassified', NONE, 'UNCLASSIFIED 0 in the first viewport', '§16.3'),
  T('wall-aside', 'd2', 'kiosk', 'kiosk.fv.asideDisclaimers', NONE, 'EMPTY/DISCLAIMER 0 in the aside (list and QR card)', '§16.3, principle 5'),
  T('legibility', 'd2', 'kiosk', 'kiosk.legibilityViolations', NONE, 'legibility violations [] (read tier x-height ≥ {X_HEIGHT_FLOOR_MM} mm, ×{DARK_FACTOR} dark; other text ≥ {WALKUP_MIN_PX} px)', '§16.3, P3'),
  // D3: the phone and the desktop (WP4).
  T('phone-instruction', 'd3', 'phone', 'phone.fv.instruction', NONE, 'INSTRUCTION 0 in the Sada first viewport', '§16.4, principle 1'),
  T('phone-count', 'd3', 'phone', 'phone.fv.count', NONE, 'COUNT 0 in the Sada first viewport', '§16.4, principle 1'),
  T('phone-unclassified', 'd3', 'phone', 'phone.fv.unclassified', NONE, 'UNCLASSIFIED 0 in the Sada first viewport', '§16.4'),
  T('phone-departures', 'd3', 'phone', 'phone.departuresInViewportOff', NONE, 'exactly {PHONE_DEPARTURES} departure rows inside the first viewport', '§16.4, principle 3'),
  T('phone-departures-total', 'd3', 'phone', 'phone.departuresOverMax', NONE, 'at most {PHONE_DEPARTURES} departure rows on Sada', '§16.4, principle 3'),
  T('phone-place', 'd3', 'phone', 'phone.sadaPlaceMissing', NONE, 'sada-place present and non-empty', '§16.4'),
  T('phone-sentence', 'd3', 'phone', 'phone.sadaSentenceOutOfRange', NONE, 'sada-sentence present, 1–{SENTENCE_MAX_CHARS} characters', '§16.4'),
  T('phone-slop', 'd3', 'phone', 'phone.slopMatches', NONE, 'no text matching {PHONE_SLOP_RE}', '§16.4, §13'),
  T('phone-tabs', 'd3', 'phone', 'phone.tabsMismatch', NONE, 'the tabs read {TAB_LABELS}', '§16.4'),
  T('phone-share', 'd3', 'phone', 'phone.shareCityMissing', NONE, 'share-city visible at rest, reading "{SHARE_CITY_LABEL}"', '§16.4, [O-61]'),
  T('karta-pills', 'd3', 'phone', 'phone.kartaPillsLate', NONE, 'Karta cold open: a vehicle pill within {KARTA_PILLS_WITHIN_MS} ms of data-map-status=ready, no tap', '§16.4'),
  T('karta-disclosures', 'd3', 'phone', 'phone.kartaDisclosures', NONE, 'Karta: no filter disclosure or group taxonomy', '§16.4'),
  T('karta-unlabelled', 'd3', 'phone', 'phone.kartaUnlabelled', NONE, 'Karta: data-unlabelled = 0 (a missing probe counts)', '§16.4'),
  T('phone-axe', 'd3', 'phone', 'phone.axeSeriousCritical', NONE, 'axe serious + critical 0 on Sada and Karta', '§16.4'),
  T('desktop-side-by-side', 'd3', 'desktop', 'desktop.outOfViewport', NONE, 'desktop 1440×900: Sada and Karta both in the viewport', '§16.4'),
  T('desktop-domains', 'd3', 'desktop', 'desktop.domains', NONE, 'desktop: no six-domain bar (.ki-domains)', '§16.4'),
]);

export const stageIndex = (stage) => (stage === STAGE_ALL ? STAGES.length - 1 : STAGES.indexOf(stage));
/** The rows a stage applies. */
export const thresholdsFor = (stage) => THRESHOLDS.filter((t) => stageIndex(t.stage) <= stageIndex(stage));

/** `{NAME}` in a target, from the instruments' exported constants. */
export function fillTarget(text, instruments) {
  return text.replace(/\{([A-Z0-9_]+)\}/g, (_, name) => {
    for (const mod of [instruments.wall, instruments.inventory, instruments.legibility]) {
      if (mod && name in mod) {
        const v = mod[name];
        return v instanceof RegExp ? String(v) : Array.isArray(v) ? v.join(' · ') : String(v);
      }
    }
    throw new Error(`threshold target names ${name}, which no instrument exports`);
  });
}

// --- metrics: the observation reduced to the numbers the table judges ----------------------------------
const valid = (rows) => rows.filter((r) => !('error' in r));
/** Every wall reading: the first, the rotation, the portrait. null when the wall was not observed. */
export const readingsOf = (obs) => (obs.kiosk ? [obs.kiosk.first, ...valid(obs.kiosk.rotation ?? []), obs.kiosk.portrait].filter(Boolean) : null);
const quote = (s, n = 60) => `"${String(s ?? '').slice(0, n)}"`;
const at = (s) => (s && s.at ? new Date(s.at).toISOString().slice(11, 19) : '?');
function countReadings(obs, pred, describe) {
  const readings = readingsOf(obs);
  if (!readings || !readings.length) return { value: null, detail: ['no wall reading'] };
  const bad = readings.filter(pred);
  return { value: bad.length, detail: bad.slice(0, 3).map((s) => `${at(s)} ${describe(s)}`).concat(bad.length > 3 ? [`… ${bad.length - 3} more of ${readings.length} readings`] : []) };
}
const recordersOf = (obs, surface) => (obs.recorders ?? []).filter((r) => surface === 'all' || r.surface === surface);
function recorderProblems(obs, surface) {
  const recs = recordersOf(obs, surface);
  if (!recs.length) return { value: null, detail: [`no ${surface} page was opened`] };
  const problems = recs.flatMap((r) => r.problems.map((p) => `${r.page}: ${p}`));
  const aborted = recs.reduce((n, r) => n + (r.aborted ?? 0), 0);
  return {
    value: problems.length,
    detail: problems.slice(0, 5).concat(problems.length > 5 ? [`… ${problems.length - 5} more`] : [], aborted ? [`${aborted} request(s) aborted (${ABORTED}: a navigation or the page's own abort) not counted`] : []),
  };
}
function viewportCount(obs, surface, cls, labels = null) {
  const views = surface === 'kiosk' ? obs.kiosk?.viewports : obs.phone?.viewports;
  const chosen = (views ?? []).filter((v) => !labels || labels.includes(v.label));
  if (!chosen.length) return { value: null, detail: ['no first viewport captured'] };
  const value = chosen.reduce((n, v) => n + (cls === 'aside' ? v.asideDisclaimers.length : v.counts[cls]), 0);
  const detail = chosen.flatMap((v) => (cls === 'aside' ? v.asideDisclaimers.map((t) => `${v.label}: ${quote(t)}`) : v.failures.filter((f) => f.includes(` ${cls} `)).map((f) => f.slice(0, 200))));
  return { value, detail: detail.slice(0, 5) };
}
const phoneSada = (obs) => obs.phone?.sada ?? null;
const karta = (obs) => obs.phone?.karta ?? null;
const notMeasured = (what) => ({ value: null, detail: [`${what} was not measured`] });

/** Each metric: (observation, instruments) → { value: number | null, detail: string[] }. null fails an applied row. */
export const METRICS = Object.freeze({
  'kiosk.readings': (obs) => {
    const r = readingsOf(obs);
    const rot = obs.kiosk?.rotation ?? [];
    return { value: r ? r.length : null, detail: [`${valid(rot).length} of ${rot.length} rotation readings${rot.length - valid(rot).length ? ` (${rot.length - valid(rot).length} failed)` : ''}, first ${obs.kiosk?.first ? 'yes' : 'no'}, portrait ${obs.kiosk?.portrait ? 'yes' : 'no'}`] };
  },
  'kiosk.plusPillReadings': (obs, k) => {
    const m = countReadings(obs, (s) => k.wall.PLUS_PILL_RE.test(s.pills ?? ''), (s) => `pills ${quote(s.pills, 80)}`);
    const readings = readingsOf(obs) ?? [];
    const empty = readings.filter((s) => !s.pills).length;
    if (empty) m.detail.push(`data-pills was empty in ${empty} of ${readings.length} readings; those readings prove nothing about "+N"`);
    return m;
  },
  'phone.kartaPlusPills': (obs, k) => {
    const r = karta(obs);
    if (!r) return notMeasured('the Karta cold open');
    const bad = k.wall.PLUS_PILL_RE.test(r.pills ?? '');
    return { value: bad ? 1 : 0, detail: [r.pills ? `pills ${quote(r.pills, 80)}` : 'data-pills empty on the Karta cold open'] };
  },
  'kiosk.recorderProblems': (obs) => recorderProblems(obs, 'kiosk'),
  'phone.recorderProblems': (obs) => recorderProblems(obs, 'phone'),
  'desktop.recorderProblems': (obs) => recorderProblems(obs, 'desktop'),
  'all.screenCreations': (obs) => {
    const recs = recordersOf(obs, 'all');
    const n = recs.reduce((s, r) => s + r.screenCreations, 0);
    return { value: n, detail: n ? recs.filter((r) => r.screenCreations).map((r) => `${r.page}: ${r.screenCreations}`) : [] };
  },
  'all.redemptionsOverBudget': (obs) => {
    const recs = recordersOf(obs, 'all');
    const per = {};
    for (const r of recs) per[r.surface] = (per[r.surface] ?? 0) + r.redemptions;
    let over = 0;
    for (const [surface, n] of Object.entries(per)) over += Math.max(0, n - (surface === 'kiosk' ? 0 : REDEMPTIONS_PER_SURFACE));
    const times = recs.flatMap((r) => r.scanTimes).map((t) => Date.parse(t)).filter(Number.isFinite).sort((a, b) => a - b);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    const close = gaps.filter((g) => g < REDEMPTION_SPACING_MS).length;
    return { value: over + close, detail: [`redemptions ${Object.entries(per).map(([s, n]) => `${s} ${n}`).join(' · ') || 'none'}${gaps.length ? `; gaps ${gaps.map((g) => `${(g / 1000).toFixed(1)} s`).join(', ')}` : ''}`] };
  },
  'kiosk.emptyPlaceReadings': (obs) => countReadings(obs, (s) => !s.place, () => 'kiosk-context empty'),
  'kiosk.departuresOutOfRange': (obs, k) => countReadings(obs, (s) => s.departures < k.wall.DEPARTURES_MIN || s.departures > k.wall.DEPARTURES_MAX, (s) => `${s.departures} departure rows`),
  'kiosk.unlabelledReadings': (obs) => countReadings(obs, (s) => s.unlabelled !== 0, (s) => (s.unlabelled === null ? 'no data-unlabelled probe' : `${s.unlabelled} unlabelled marker(s)`)),
  'kiosk.pillsEmptyReadings': (obs) => countReadings(obs, (s) => !s.pills, (s) => `data-pills empty (feed ${s.feed ?? '?'}, map ${s.mapStatus ?? '?'})`),
  'kiosk.sentenceOutOfRange': (obs, k) => countReadings(obs, (s) => s.sentenceChars < 1 || s.sentenceChars > k.wall.SENTENCE_MAX_CHARS, (s) => `${s.sentenceChars} characters ${quote(s.sentence, 90)}`),
  'kiosk.sentenceEllipses': (obs) => countReadings(obs, (s) => s.sentenceEllipsis, (s) => quote(s.sentence, 90)),
  'kiosk.sentenceOverflows': (obs) => countReadings(obs, (s) => s.sentenceOverflow, (s) => quote(s.sentence, 90)),
  'kiosk.sentenceRepeats': (obs) => {
    const rot = valid(obs.kiosk?.rotation ?? []);
    if (!rot.length) return { value: null, detail: ['no rotation reading'] };
    const r = repeatsWithin(rot, REPEAT_WINDOW_MS);
    return { value: r.repeats.length, detail: [`${r.turns} sentence turns, ${r.distinct} distinct`, ...r.repeats.slice(0, 3).map((x) => `${x.at} again after ${Math.round(x.afterMs / 1000)} s: ${quote(x.sentence, 90)}`)] };
  },
  'kiosk.solarOverMax': (obs, k) => countReadings(obs, (s) => s.solarRows > k.wall.SOLAR_ROWS_MAX, (s) => `${s.solarRows} solar rows`),
  'kiosk.untimedReadings': (obs) => countReadings(obs, (s) => s.rows.some((r) => r.when === null && !r.always), (s) => s.rows.filter((r) => r.when === null && !r.always).map((r) => quote(r.text, 40)).join(', ')),
  'kiosk.caveatRows': (obs) => {
    const readings = readingsOf(obs);
    if (!readings || !readings.length) return { value: null, detail: ['no wall reading'] };
    const rows = new Map();
    for (const s of readings) for (const r of s.rows) if (r.caveat) rows.set(r.id || r.text, r.text);
    return { value: rows.size, detail: [...rows.values()].slice(0, 5).map((t) => quote(t, 80)) };
  },
  'kiosk.closureReentries': (obs, k) => {
    const rot = obs.kiosk?.rotation ?? [];
    if (!valid(rot).length) return { value: null, detail: ['no rotation reading'] };
    const s = k.wall.summariseRotation(rot);
    return { value: s.closureReentries, detail: Object.entries(s.reentriesByKind).map(([kind, n]) => `${kind}: ${n} re-entr${n === 1 ? 'y' : 'ies'}`) };
  },
  'kiosk.pastLastRows': (obs) => countReadings(obs, (s) => s.rows.some((r) => r.kind === 'last' && r.when !== null && Date.parse(r.when) < s.at), (s) => s.rows.filter((r) => r.kind === 'last').map((r) => `${quote(r.text, 40)} at ${r.when}`).join(', ')),
  'kiosk.controlReadings': (obs) => countReadings(obs, (s) => s.controls > 0, (s) => s.controlNames.join(', ')),
  'kiosk.retiredChromeReadings': (obs) => countReadings(obs, (s) => s.retiredChrome > 0, (s) => `${s.retiredChrome} retired control(s)`),
  'kiosk.qrUnderMin': (obs, k) => countReadings(obs, (s) => !s.qr || Math.min(s.qr.w, s.qr.h) < k.wall.QR_MIN_PX, (s) => (s.qr ? `QR ${s.qr.w} × ${s.qr.h}` : 'no QR svg')),
  'kiosk.stripClockReadings': (obs) => countReadings(obs, (s) => s.stripHasClock, (s) => `footer ${quote(s.strip, 80)}`),
  'kiosk.nearbyHeadMismatches': (obs, k) => countReadings(obs, (s) => !k.wall.NEARBY_HEAD_RE.test(s.head), (s) => `head ${quote(s.head)}`),
  'kiosk.leadMismatches': (obs, k) => countReadings(obs, (s) => s.lead !== k.wall.LEAD_TEXT, (s) => `lead ${quote(s.lead)}`),
  'kiosk.fv.instruction': (obs) => viewportCount(obs, 'kiosk', 'INSTRUCTION'),
  'kiosk.fv.count': (obs) => viewportCount(obs, 'kiosk', 'COUNT'),
  'kiosk.fv.unclassified': (obs) => viewportCount(obs, 'kiosk', 'UNCLASSIFIED'),
  'kiosk.fv.asideDisclaimers': (obs) => viewportCount(obs, 'kiosk', 'aside'),
  'kiosk.legibilityViolations': (obs) => {
    const reports = Object.entries(obs.kiosk?.legibility ?? {}).filter(([, r]) => r);
    if (!reports.length) return { value: null, detail: ['no legibility report'] };
    const findings = reports.flatMap(([label, r]) => [...r.violations, ...r.otherSmall].map((f) => `${label}: ${f.detail}`));
    return { value: findings.length, detail: findings.slice(0, 5).concat(findings.length > 5 ? [`… ${findings.length - 5} more`] : []) };
  },
  'phone.fv.instruction': (obs) => viewportCount(obs, 'phone', 'INSTRUCTION', ['phone-sada']),
  'phone.fv.count': (obs) => viewportCount(obs, 'phone', 'COUNT', ['phone-sada']),
  'phone.fv.unclassified': (obs) => viewportCount(obs, 'phone', 'UNCLASSIFIED', ['phone-sada']),
  'phone.departuresInViewportOff': (obs, k) => {
    const r = phoneSada(obs);
    if (!r) return notMeasured('Sada');
    return { value: Math.abs(r.departures.inViewport - k.inventory.PHONE_DEPARTURES), detail: [`${r.departures.inViewport} inside the viewport, ${r.departures.total} in all`] };
  },
  'phone.departuresOverMax': (obs, k) => {
    const r = phoneSada(obs);
    if (!r) return notMeasured('Sada');
    return { value: Math.max(0, r.departures.total - k.inventory.PHONE_DEPARTURES), detail: [`${r.departures.total} departure rows`] };
  },
  'phone.sadaPlaceMissing': (obs) => {
    const r = phoneSada(obs);
    if (!r) return notMeasured('Sada');
    return { value: r.place ? 0 : 1, detail: [r.place === null ? 'no sada-place element' : r.place ? quote(r.place) : 'sada-place empty'] };
  },
  'phone.sadaSentenceOutOfRange': (obs, k) => {
    const r = phoneSada(obs);
    if (!r) return notMeasured('Sada');
    const bad = r.sentence === null || r.sentenceChars < 1 || r.sentenceChars > k.wall.SENTENCE_MAX_CHARS;
    return { value: bad ? 1 : 0, detail: [r.sentence === null ? 'no sada-sentence element' : `${r.sentenceChars} characters ${quote(r.sentence, 90)}`] };
  },
  'phone.slopMatches': (obs) => {
    const r = phoneSada(obs);
    if (!r) return notMeasured('Sada');
    return { value: r.slop.length, detail: r.slop.map((t) => quote(t)) };
  },
  'phone.tabsMismatch': (obs, k) => {
    const r = phoneSada(obs);
    if (!r) return notMeasured('Sada');
    const ok = r.tabs.length === k.inventory.TAB_LABELS.length && r.tabs.every((t, i) => t === k.inventory.TAB_LABELS[i]);
    return { value: ok ? 0 : 1, detail: [`visible tabs ${r.tabs.map((t) => quote(t, 20)).join(' · ') || 'none'}`] };
  },
  'phone.shareCityMissing': (obs, k) => {
    const r = phoneSada(obs);
    if (!r) return notMeasured('Sada');
    const ok = r.shareCity.visible && r.shareCity.text === k.inventory.SHARE_CITY_LABEL;
    return { value: ok ? 0 : 1, detail: [!r.shareCity.present ? 'no share-city element' : `${r.shareCity.visible ? 'visible' : 'hidden'}, reading ${quote(r.shareCity.text)}`] };
  },
  'phone.kartaPillsLate': (obs, k) => {
    const r = karta(obs);
    if (!r) return notMeasured('the Karta cold open');
    const late = r.pillsAfterMs === null || r.pillsAfterMs > k.inventory.KARTA_PILLS_WITHIN_MS;
    return { value: late ? 1 : 0, detail: [r.status !== 'ready' ? `map status ${r.status ?? 'missing'}` : r.pillsAfterMs === null ? `no pill within ${KARTA_POLL_MS / 1000} s of ready` : `first pill ${r.pillsAfterMs} ms after ready`] };
  },
  'phone.kartaDisclosures': (obs) => {
    const r = karta(obs);
    if (!r) return notMeasured('the Karta cold open');
    return { value: r.disclosures, detail: r.disclosures ? [`${r.disclosures} disclosure or group element(s)`] : [] };
  },
  'phone.kartaUnlabelled': (obs) => {
    const r = karta(obs);
    if (!r) return notMeasured('the Karta cold open');
    return { value: r.unlabelled, detail: [r.unlabelled === null ? 'no data-unlabelled probe on the map canvas' : `${r.unlabelled} unlabelled, ${r.markers ?? '?'} markers`] };
  },
  'phone.axeSeriousCritical': (obs) => {
    const a = obs.phone?.axe;
    if (!a || !a.sada || !a.karta) return notMeasured('axe on Sada and Karta');
    return { value: a.sada.seriousCritical + a.karta.seriousCritical, detail: [...a.sada.rules.map((r) => `Sada: ${r}`), ...a.karta.rules.map((r) => `Karta: ${r}`)].slice(0, 6) };
  },
  'desktop.outOfViewport': (obs) => {
    const r = obs.desktop?.read;
    if (!r) return notMeasured('the desktop');
    return { value: (r.sadaInViewport ? 0 : 1) + (r.kartaInViewport ? 0 : 1), detail: [`Sada ${r.sadaInViewport ? 'in' : 'out of'} the viewport, Karta ${r.kartaInViewport ? 'in' : 'out of'} it`] };
  },
  'desktop.domains': (obs) => {
    const r = obs.desktop?.read;
    if (!r) return notMeasured('the desktop');
    return { value: r.domains, detail: r.domains ? [`${r.domains} .ki-domains element(s)`] : [] };
  },
});

/**
 * §12 over the rotation: sentence turns (a new data-valid-until or a new text, e2e/wall.ts's rule) whose
 * text was already shown by a turn that began less than `windowMs` earlier.
 */
export function repeatsWithin(readings, windowMs) {
  const turns = [];
  let prevKey = null;
  let prevText = null;
  for (const s of readings) {
    if (!s.sentence) continue;
    const key = s.validUntil ?? s.sentence;
    if (key !== prevKey || s.sentence !== prevText) {
      turns.push({ at: s.at, sentence: s.sentence });
      prevKey = key;
      prevText = s.sentence;
    }
  }
  const repeats = [];
  turns.forEach((t, i) => {
    const earlier = turns.slice(0, i).reverse().find((u) => u.sentence === t.sentence);
    if (earlier && t.at - earlier.at < windowMs) repeats.push({ at: new Date(t.at).toISOString().slice(11, 19), afterMs: t.at - earlier.at, sentence: t.sentence });
  });
  return { turns: turns.length, distinct: new Set(turns.map((t) => t.sentence)).size, repeats };
}

const holds = (t, v) => (t.min === undefined || v >= t.min) && (t.max === undefined || v <= t.max);

/** The table against an observation: every row with its value and status; `ok` when no applied row fails. */
export function judge(observation, instruments, stage = observation.meta.stage) {
  const applied = stageIndex(stage);
  const rows = THRESHOLDS.map((t) => {
    const observed = t.surface === 'all' || observation.meta.surfaces.includes(t.surface);
    const m = observed ? METRICS[t.metric](observation, instruments) : { value: null, detail: [] };
    const status = !observed ? 'not observed' : stageIndex(t.stage) > applied ? 'info' : m.value !== null && holds(t, m.value) ? 'pass' : 'fail';
    const ok = m.value !== null && holds(t, m.value);
    return { id: t.id, stage: t.stage, surface: t.surface, metric: t.metric, min: t.min, max: t.max, source: t.source, target: fillTarget(t.target, instruments), value: m.value, holds: ok, detail: m.detail, status };
  });
  const failures = rows.filter((r) => r.status === 'fail');
  return { stage, rows, failures, applied: rows.filter((r) => r.status === 'pass' || r.status === 'fail').length, ok: failures.length === 0 };
}

// --- writing --------------------------------------------------------------------------------------------
const pct = (x) => `${Math.round((x ?? 0) * 100)} %`;
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const bound = (r) => (r.min !== undefined && r.max !== undefined ? `${r.min}–${r.max}` : r.min !== undefined ? `≥ ${r.min}` : `≤ ${r.max}`);

/** report.md: the verdict table first, then what the instruments saw. */
export function renderReport(observation, verdict, instruments) {
  const { meta } = observation;
  const k = observation.kiosk;
  const lines = [];
  const verdictWord = verdict.ok ? '**PASS**' : `**FAIL** (${verdict.failures.length} of ${verdict.applied} applied thresholds)`;
  lines.push(`# Production observation, ${zagreb(Date.parse(meta.startedAt))} Zagreb (read-only)`, '');
  lines.push(`Origin ${meta.origin}, build ${meta.health?.version ?? 'unknown'} · ${meta.minutes} min · stage \`${meta.stage}\` · surfaces ${meta.surfaces.join(', ')} · ended ${meta.endedAt ? zagreb(Date.parse(meta.endedAt)) : '?'} Zagreb.`, '');
  lines.push(`Verdict: ${verdictWord}.`, '');
  const recs = observation.recorders ?? [];
  const red = recs.reduce((m, r) => ({ ...m, [r.surface]: (m[r.surface] ?? 0) + r.redemptions }), {});
  lines.push('## Footprint', '');
  lines.push(`- Screens created: ${recs.reduce((n, r) => n + r.screenCreations, 0)} (the observer has no code path that creates one).`);
  lines.push(`- Code redemptions: ${Object.entries(red).filter(([s]) => s !== 'kiosk').map(([s, n]) => `${s} ${n}`).join(', ') || 'none'} (at most ${REDEMPTIONS_PER_SURFACE} per surface, at least ${REDEMPTION_SPACING_MS / 1000} s apart).`);
  lines.push('- Nothing pressed on the screen, no view presented, settings never opened; the phone tapped only its Karta tab.', '');

  lines.push('## Thresholds (§16.3, §16.4)', '');
  lines.push('| Row | Stage | Surface | Target | Bound | Observed | Result |', '|---|---|---|---|---|---:|---|');
  for (const r of verdict.rows) lines.push(`| ${r.id} | ${r.stage} | ${r.surface} | ${cell(r.target)} | ${bound(r)} | ${r.value === null ? '—' : r.value} | ${r.status === 'fail' ? '**fail**' : r.status} |`);
  lines.push('');
  // Failed rows, and rows above the stage that would fail once applied.
  const noted = verdict.rows.filter((r) => (r.status === 'fail' || (r.status === 'info' && !r.holds)) && r.detail.length);
  if (noted.length) {
    lines.push('### Findings', '');
    for (const r of noted) lines.push(`- **${r.id}** (${r.status}): ${r.detail.map(cell).join('; ')}`);
    lines.push('');
  }

  if (k) {
    const rot = k.rotation ?? [];
    const s = instruments.wall.summariseRotation(rot);
    const rep = repeatsWithin(valid(rot), REPEAT_WINDOW_MS);
    lines.push(`## Wall rotation (${rot.length} readings, ${instruments.wall.ROTATION_STEP_MS / 1000} s apart, rotation.jsonl)`, '');
    lines.push('| Readings | Failed | Turns | Distinct | Repeats ≤ 10 min | Departures | Solar max | Live max | "+N" pills | Unlabelled max | Kinds | Themes |', '|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---|---|');
    lines.push(`| ${s.samples} | ${s.errors} | ${rep.turns} | ${rep.distinct} | ${rep.repeats.length} | ${s.minDepartures}–${s.maxDepartures} | ${s.solarRowsMax} | ${s.liveRowsMax} | ${s.plusPills} | ${s.unlabelledMax ?? '—'} | ${cell(Object.entries(s.kinds).map(([kind, n]) => `${kind} ${n}`).join(', '))} | ${cell(Object.entries(s.themes).map(([t, n]) => `${t} ${n}`).join(', '))} |`, '');
    if (k.first) lines.push(`First reading: place ${quote(k.first.place)}, sentence ${quote(k.first.sentence, 90)} (${k.first.kicker ?? 'no kicker'}), head ${quote(k.first.head)}, ${k.first.departures} departures, feed ${k.first.feed ?? '?'}, theme ${k.first.theme ?? '?'}.`, '');
  }

  const views = [...(k?.viewports ?? []), ...(observation.phone?.viewports ?? []), ...(observation.desktop?.viewports ?? [])];
  if (views.length) {
    const classes = instruments.inventory.CLASSES;
    lines.push('## First viewports (inventory.json)', '');
    lines.push(`| Capture | Units | ${classes.join(' | ')} |`, `|---|---:|${classes.map(() => '---').join('|')}|`);
    for (const v of views) lines.push(`| ${v.label} | ${v.units} | ${classes.map((c) => (v.perClass[c].count ? `${v.perClass[c].count} · ${pct(v.perClass[c].viewportHeightShare)}` : '0')).join(' | ')} |`);
    lines.push('');
  }

  const leg = Object.entries(k?.legibility ?? {}).filter(([, r]) => r);
  if (leg.length) {
    lines.push('## Legibility at 3 m (legibility.json)', '');
    lines.push('| Capture | Theme | Violations | Other < 28 px | Warnings | Symbols |', '|---|---|---:|---:|---:|---|');
    for (const [label, r] of leg) lines.push(`| ${label} | ${r.dark ? 'dark' : 'light'} | ${r.violations.length} | ${r.otherSmall.length} | ${r.warnings.length} | ${cell(r.symbols.slice(0, 4).map((x) => `${x.selector.replace(/^.*\[data-symbol=([a-z]+)\]$/, '$1')} ${x.mm} mm`).join(', ')) || '—'} |`);
    lines.push('');
  }

  if (observation.phone) {
    const p = observation.phone;
    lines.push('## Phone and desktop', '');
    if (p.sada) lines.push(`- Sada: place ${quote(p.sada.place ?? '—')}, sentence ${quote(p.sada.sentence ?? '—', 90)}, departures ${p.sada.departures.inViewport} in the viewport of ${p.sada.departures.total}; landed ${p.landingMs ?? '?'} ms after the scan URL.`);
    if (p.karta) lines.push(`- Karta cold open: status ${p.karta.status ?? '—'}, first pill ${p.karta.pillsAfterMs === null ? 'none' : `${p.karta.pillsAfterMs} ms`} after ready, unlabelled ${p.karta.unlabelled ?? '—'}, disclosures ${p.karta.disclosures}.`);
    if (observation.desktop?.read) lines.push(`- Desktop 1440×900: Sada ${observation.desktop.read.sadaInViewport ? 'in' : 'out of'} the viewport, Karta ${observation.desktop.read.kartaInViewport ? 'in' : 'out of'} it, .ki-domains ${observation.desktop.read.domains}.`);
    lines.push('');
  }

  if (recs.length) {
    lines.push('## Recorders (recorders.json)', '');
    lines.push('| Page | Data responses | Failed | HTTP ≥ 400 | Console errors | Page errors | Redemptions | Screens created |', '|---|---:|---:|---:|---:|---:|---:|---:|');
    for (const r of recs) lines.push(`| ${r.page} | ${r.dataResponses} | ${r.failed.length} | ${r.httpErrors.length} | ${r.consoleErrors.length} | ${r.pageErrors.length} | ${r.redemptions} | ${r.screenCreations} |`);
    const statuses = Object.entries(recs.reduce((m, r) => ({ ...m, ...r.moduleStatuses }), {}));
    if (statuses.length) lines.push('', `Module statuses: ${cell(statuses.map(([m, s]) => `${m} ${s}`).join(' · '))}.`);
    lines.push('');
  }

  if (observation.errors.length || observation.notes.length) {
    lines.push('## Run log', '');
    for (const e of observation.errors) lines.push(`- error, ${e.phase}: ${cell(e.error)}`);
    for (const n of observation.notes) lines.push(`- ${cell(n)}`);
    lines.push('');
  }
  lines.push('## Files', '', `inventory.json · rotation.jsonl · legibility.json · recorders.json · ${(observation.captures ?? []).join(' · ') || 'no captures'}`, '');
  return lines.join('\n');
}

const unitRecord = (u) => {
  const code = [u.testid, u.nearestTestid].some((t) => CODE_TESTIDS.includes(t));
  return { class: u.class, tag: u.tag, testid: u.testid, nearestTestid: u.nearestTestid, text: code ? '••••' : (u.text || u.value || u.ariaLabel || ''), rect: u.rect, clip: u.clip, path: u.path, within: u.within };
};

/** inventory.json, legibility.json, recorders.json, report.md (rotation.jsonl is written as the rotation goes). */
export function writeOutputs(outDir, observation, verdict, instruments, scrub) {
  const write = (name, text) => writeFileSync(join(outDir, name), scrub(text));
  const inventories = observation.inventories.map((v) => ({
    label: v.inventory.label, surface: v.inventory.surface, scenario: v.inventory.scenario, at: v.inventory.at, zagreb: v.inventory.zagreb,
    url: String(v.inventory.url ?? '').replace(/#.*$/, '#…'), vw: v.inventory.vw, vh: v.inventory.vh, theme: v.inventory.theme, map: v.inventory.map,
    summary: v.summary, units: v.units.map(unitRecord),
  }));
  write('inventory.json', JSON.stringify(inventories, null, 2));
  write('legibility.json', JSON.stringify({ spec: instruments.legibility.WALL_1920, captures: observation.kiosk?.legibility ?? {} }, null, 2));
  write('recorders.json', JSON.stringify(observation.recorders ?? [], null, 2));
  write('report.md', renderReport(observation, verdict, instruments));
}

// --- the run --------------------------------------------------------------------------------------------
/** A fresh observation record; the phases fill it. */
export function newObservation(config, health) {
  return {
    meta: { origin: config.origin, startedAt: config.startedAt, endedAt: null, minutes: config.minutes, stage: config.stage, surfaces: config.surfaces, health, userAgentSuffix: USER_AGENT_SUFFIX.trim() },
    kiosk: null, phone: null, desktop: null, recorders: [], inventories: [], captures: [], errors: [], notes: [],
  };
}

/**
 * The observation itself, from an already loaded runtime (`load()` in main, fakes in the unit tier):
 * { instruments, chromium, devices, AxeBuilder?, fetch? }. Returns the exit code.
 */
export async function run(config, runtime, { log = console.log, error = console.error, clock } = {}) {
  const now = clock?.now ?? (() => Date.now());
  const sleep = clock?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const { instruments } = runtime;
  const capturesDir = join(config.outDir, 'captures');
  mkdirSync(capturesDir, { recursive: true });
  const scrub = makeScrubber(config.secrets);
  const rotationFile = join(config.outDir, 'rotation.jsonl');
  writeFileSync(rotationFile, '');

  let health = null;
  try {
    const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10_000) : undefined;
    const res = await (runtime.fetch ?? fetch)(`${config.origin}/api/health`, { signal });
    if (res.ok) health = await res.json();
  } catch (e) { log(`observe-production: /api/health unreadable (${errText(e)})`); }

  const observation = newObservation(config, health);
  const ctx = {
    instruments, devices: runtime.devices, kioskUrl: config.kioskUrl, origin: config.origin, minutes: config.minutes,
    capturesDir, captures: observation.captures, inventories: observation.inventories, recorders: [], usedCodes: new Set(),
    budget: redemptionBudget({ spacingMs: REDEMPTION_SPACING_MS + REDEMPTION_MARGIN_MS }), scrub, now, sleep,
    axe: runtime.AxeBuilder ? async (page) => {
      const res = await new runtime.AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
      const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      return { seriousCritical: bad.length, rules: bad.map((v) => `${v.impact} ${v.id} (${v.nodes.length})`) };
    } : null,
    appendRotation: (row) => appendFileSync(rotationFile, `${scrub(JSON.stringify(row))}\n`),
    note: (text) => { observation.notes.push(text); log(`observe-production: ${scrub(text)}`); },
    error: (phase, e) => { observation.errors.push({ phase, error: scrub(errText(e)) }); error(`observe-production: ${phase}: ${scrub(errText(e))}`); },
  };

  let browser;
  try {
    browser = await runtime.chromium.launch({ headless: true });
  } catch (e) {
    error(`observe-production: the browser did not start: ${errText(e)}`);
    return 2;
  }
  let code;
  try {
    log(`observe-production: ${config.origin}, ${config.minutes} min, stage ${config.stage}, surfaces ${config.surfaces.join(',')} -> ${relative(config.root, config.outDir) || config.outDir}`);
    await observeAll(browser, ctx, observation);
  } catch (e) {
    // Only the wall's own start can throw out of observeAll (every later phase keeps its error): nothing was observed.
    code = 2;
    ctx.error(e instanceof KioskUnavailable ? 'kiosk' : 'observation', e);
  } finally {
    observation.recorders = ctx.recorders.map(freeze);
    await browser.close().catch(() => {});
  }
  observation.meta.endedAt = new Date(now()).toISOString();
  const verdict = judge(observation, instruments, config.stage);
  writeOutputs(config.outDir, observation, verdict, instruments, scrub);
  for (const r of verdict.failures) log(`observe-production: FAIL ${r.id}: ${scrub(r.target)} (observed ${r.value ?? 'nothing'})`);
  log(`observe-production: ${verdict.ok ? 'pass' : 'fail'}, ${verdict.failures.length} of ${verdict.applied} applied thresholds fail; report ${join(relative(config.root, config.outDir) || config.outDir, 'report.md')}`);
  return code ?? (verdict.ok ? 0 : 1);
}

/** The instruments through a throwaway Vite loader (no port, no watcher), then Playwright and axe. */
export async function loadRuntime(root = ROOT) {
  const { createServer } = await import('vite');
  const loader = await createServer({
    configFile: false, root, appType: 'custom', logLevel: 'warn',
    cacheDir: resolve(root, 'review.local/ssr-cache'),
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const instruments = {};
    for (const [name, path] of [['wall', '/e2e/wall.ts'], ['inventory', '/e2e/inventory.ts'], ['recorders', '/e2e/recorders.ts'], ['legibility', '/e2e/legibility.ts'], ['scenes', '/e2e/scenes.ts'], ['lib', '/e2e/lib.ts']]) {
      instruments[name] = await loader.ssrLoadModule(path);
    }
    const { chromium, devices } = await import('@playwright/test');
    const { default: AxeBuilder } = await import('@axe-core/playwright');
    return { instruments, chromium, devices, AxeBuilder };
  } finally {
    await loader.close();
  }
}

/** The command line. Refusals (no E2E_KIOSK_URL, bad arguments) return 2 before anything is loaded. */
export async function main({ argv = process.argv.slice(2), env = process.env, root = ROOT, log = console.log, error = console.error, load = loadRuntime } = {}) {
  let config;
  try {
    config = configFrom({ argv, env, root });
  } catch (e) {
    if (e instanceof ObserverRefusal) { error(e.message); return e.exitCode; }
    throw e;
  }
  if (config.help) { log(USAGE); return 0; }
  let runtime;
  try {
    runtime = await load(root);
  } catch (e) {
    error(`observe-production: the instrument loader could not start: ${errText(e)}`);
    return 2;
  }
  return run(config, runtime, { log, error });
}

const invokedDirectly = typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; }, (e) => { console.error(`observe-production: ${errText(e)}`); process.exitCode = 2; });
}
