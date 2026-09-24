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
// redeems at most one code per surface (phone, desktop), each read from the screen's own page, and starts a
// redemption only 12 s (REDEMPTION_SPACING_MS, plus a margin) after the previous one was redeemed, that is
// after its POST /api/scan answered, never counted from a navigation. A full run spends two ten-minute
// sessions and no screen. On the phone it taps only the phone's own controls: "Podijeli grad" (when it is at
// rest in the header), the Karta tab, and the stop search's field and first result.
//
// What it does. The wall at 1920×1080 for `--minutes` of real time (one reading every 2 s, e2e/wall.ts),
// its first viewport (e2e/inventory.ts) and its 3-metre legibility (e2e/legibility.ts); meanwhile a Pixel 7
// and a 1440×900 desktop each redeem one code and are read the same way (Sada, the share code, Karta cold
// open, the stop board by search, axe); after the rotation the wall in portrait (1080×1920), a DPR 0.25 proxy
// screenshot, and the phone once its ten minutes are over (session-ended, no content row, no further
// /api/data request). The instruments are the TypeScript modules the accept specs use, loaded through a
// throwaway Vite loader (the pattern of scripts/audit-production.mjs), so a production verdict and a local one
// read the same selectors and numbers. Every planned reading is judged: a reading that failed or never
// happened fails its row, it never drops out of the verdict.
//
// Every rotation reading also carries the wall validator's `data-skipped-text` census (`skippedText` in
// rotation.jsonl, totals in report.md): a monitored figure (RUN decision 24), read by no threshold, and `fleet`,
// what the twin had reported to the page by then (the zet-rt snapshots the page itself received; the observer makes
// no request for them), so a reading without a vehicle pill is judged against whether there was a vehicle to draw.
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
/**
 * The wall's settle waits, as the accept spec's (e2e/accept/wall.spec.ts settle): the map census (data-unlabelled
 * written, map/name-census.ts), then the first vehicle pill (the spec's VEHICLES_MS). Waits, never gates: a census or
 * a pill that does not come in time leaves the reading to be judged as it stands, and the run log says how long each took.
 */
export const CENSUS_TIMEOUT_MS = 20_000;
export const VEHICLES_TIMEOUT_MS = 10_000;
/**
 * How long a reading may show no pill after the twin first reported vehicles to the page: the push, the frame, and the
 * census retaken once the frame has stood PROBE_SETTLE_MS (1 s, map/name-census.ts), with a rotation step of margin.
 */
export const PILLS_DRAW_GRACE_MS = 5_000;
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
/** A share code must follow the tap on "Podijeli grad" within this long. */
export const SHARE_TIMEOUT_MS = 15_000;
/** The stop board must open this long after the search result is tapped. */
export const STOP_BOARD_TIMEOUT_MS = 15_000;
/**
 * A redeemed session's length in minutes ("Skeniraj za 10 minuta grada."). The page keeps its own expiresAt in memory
 * only (app/src/session.ts), so this configured length is the observer's estimate of the end when the page's own
 * end stamp cannot be read.
 */
export const SESSION_MINUTES = 10;
export const SESSION_LENGTH_MS = SESSION_MINUTES * 60_000;
/** How long past the session's end the phone may take to show session-ended. */
export const EXPIRY_MARGIN_MS = 90_000;
/** Past the shell's 30 s data poll: no /api/data request may follow once the session has ended (the phone spec's AFTER_EXPIRY_MS). */
export const AFTER_EXPIRY_MS = 31_000;
/** A data-feed that says the vehicles are not live: during it the wall need draw no pill (§16.3 outage0800). */
export const OUTAGE_FEEDS = Object.freeze(['stale', 'down']);
/** The wall's data-feed before its first poll has answered (app/src/kiosk/mapview.ts feedStateOf): no outage, and no vehicle to draw yet. */
export const LOADING_FEED = 'loading';
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
/**
 * At most `perSurface` redemptions per surface, and each starts only `spacingMs` after the latest redemption
 * was redeemed: the moment its POST /api/scan answered (`redeemed`), never the moment its navigation began.
 * A surface that took its redemption and has not been confirmed holds every other one back. A breach throws
 * before any request.
 */
export function redemptionBudget({ perSurface = REDEMPTIONS_PER_SURFACE, spacingMs = REDEMPTION_SPACING_MS } = {}) {
  const counts = new Map();
  const times = [];
  const failures = [];
  const lates = [];
  let pending = null;
  const guard = (surface) => {
    if ((counts.get(surface) ?? 0) >= perSurface) throw new Error(`the ${surface} has already redeemed ${perSurface} code(s); the observer redeems at most ${perSurface} per surface`);
    if (pending !== null) throw new Error(`the ${pending}'s redemption is not confirmed yet (no /api/scan answer); no other may start`);
  };
  // A failed redemption's scan was cancelled at its `at`; the server may have redeemed it up to then, so the
  // spacing runs from there too. It is never a confirmation.
  const latest = () => {
    const all = [...times, ...failures, ...lates].map((t) => t.at);
    return all.length ? Math.max(...all) : undefined;
  };
  return {
    /** How long to wait before this surface may redeem (0 when the latest redemption is ≥ spacingMs ago). */
    waitMs(surface, now) {
      guard(surface);
      const last = latest();
      return last === undefined ? 0 : Math.max(0, last + spacingMs - now);
    },
    /** The surface's one redemption begins (its navigation to the scan URL): refused inside the spacing. */
    take(surface, now) {
      guard(surface);
      const last = latest();
      if (last !== undefined && now - last < spacingMs) throw new Error(`redemptions ${Math.round(now - last)} ms apart (at least ${spacingMs} ms)`);
      counts.set(surface, (counts.get(surface) ?? 0) + 1);
      pending = surface;
    },
    /** The surface's code was redeemed at `at`: its /api/scan answered, or (none seen) the observer stopped waiting. A later answer moves it on. */
    /**
     * An /api/scan answer came for the surface at `at`. It confirms the redemption unless that has already failed:
     * a failed redemption stays failed for good, and its answer is only late (it still moves the spacing on).
     * Returns whether it confirmed.
     */
    redeemed(surface, at) {
      if (failures.some((f) => f.surface === surface)) {
        lates.push({ surface, at });
        return false;
      }
      times.push({ surface, at });
      if (pending === surface) pending = null;
      return true;
    },
    /** The surface's redemption failed for good: no /api/scan answer came by `at`. */
    failed(surface, at) {
      failures.push({ surface, at });
      if (pending === surface) pending = null;
    },
    /** The failed redemption's page was left (the scan cancelled) at `at`, or leaving it failed with `cancelError`. */
    settle(surface, at, cancelError = null) {
      const f = failures.find((x) => x.surface === surface);
      if (!f) return;
      f.at = Math.max(f.at, at);
      if (cancelError) f.cancelError = cancelError;
    },
    counts: () => Object.fromEntries(counts),
    /** Confirmed redemptions: /api/scan answers, in the order they came. */
    times: () => times.map((t) => ({ ...t })),
    failures: () => failures.map((t) => ({ ...t })),
    /** Answers for redemptions that had already failed: reported, never confirmations. */
    lates: () => lates.map((t) => ({ ...t })),
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
/** The map has written its census (map/name-census.ts): data-unlabelled carries a value, as the accept spec waits for. */
export const MAP_CENSUS_IN_PAGE = (spec) => {
  const m = document.querySelector(spec.map);
  const v = m ? m.getAttribute('data-unlabelled') : null;
  return typeof v === 'string' && v !== '';
};
/** The map draws at least one vehicle pill (data-pills non-empty). */
export const PILLS_DRAWN_IN_PAGE = (spec) => {
  const m = document.querySelector(spec.map);
  return Boolean(m && (m.getAttribute('data-pills') || '').trim());
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
  // Shown: a box, and neither hidden, collapsed, invisible nor transparent on itself or any ancestor.
  const shown = (el) => {
    if (!el || el.hidden || el.closest('[hidden]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    for (let a = el; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'none' || cs.visibility === 'hidden' || (cs.opacity !== '' && Number(cs.opacity) === 0)) return false;
    }
    return true;
  };
  const place = document.querySelector(spec.place);
  const sentence = document.querySelector(spec.sentence);
  const rows = Array.from(document.querySelectorAll(spec.departures)).filter(shown);
  // Fully inside the viewport across and down: a row pushed sideways (a carousel) is not in the first viewport.
  const inside = rows.filter((el) => { const r = el.getBoundingClientRect(); return r.top >= -1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1; });
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
/**
 * The share code as the page shows it after the tap on "Podijeli grad". Visible by e2e/wall.ts's rule for a row
 * on the wall: a box, not hidden, collapsed, invisible or transparent on itself or any ancestor, wholly inside the
 * viewport and inside every ancestor that clips its overflow.
 */
export const SHARE_CODE_IN_PAGE = (spec) => {
  const el = document.querySelector(spec.code);
  const within = (r, c) => r.top >= c.top - 1 && r.bottom <= c.bottom + 1 && r.left >= c.left - 1 && r.right <= c.right + 1;
  const clips = (v) => v !== '' && v !== 'visible';
  const visible = (() => {
    if (!el || el.hidden || el.closest('[hidden]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    if (!(r.top >= -1 && r.left >= -1 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1)) return false;
    for (let a = el; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'none' || cs.visibility === 'hidden' || (cs.opacity !== '' && Number(cs.opacity) === 0)) return false;
      const root = a === el || a === document.body || a === document.documentElement;
      if (!root && (clips(cs.overflowX) || clips(cs.overflowY) || clips(cs.overflow)) && !within(r, a.getBoundingClientRect())) return false;
    }
    return true;
  })();
  return { present: Boolean(el), visible, text: ((el && el.textContent) || '').replace(/\s+/g, ' ').trim() };
};

/** The key on `window` under which the phone page stamps the moment its session ended. */
export const EXPIRY_KEY = '__kajimaObserverSessionEnded';
/**
 * Installed on the phone right after its redemption: a MutationObserver that stamps (Date.now()) the moment the
 * session-ended block first shows by the same visibility rule, so "no /api/data after the end" counts from the
 * page's own end, not from whenever the observer comes to look. Reads nothing else and changes nothing.
 */
export const EXPIRY_WATCH_IN_PAGE = (spec) => {
  const w = window;
  if (w[spec.key]) return true;
  const state = { endedAt: null, observer: null };
  const shown = (el) => {
    if (!el || el.hidden || el.closest('[hidden]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    for (let a = el; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'none' || cs.visibility === 'hidden' || (cs.opacity !== '' && Number(cs.opacity) === 0)) return false;
    }
    return true;
  };
  const check = () => {
    if (state.endedAt !== null || !shown(document.querySelector(spec.ended))) return;
    state.endedAt = Date.now();
    if (state.observer) state.observer.disconnect();
  };
  state.observer = new MutationObserver(check);
  state.observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'class', 'style'] });
  w[spec.key] = state;
  check();
  return true;
};
/** The page's stamp of its session's end (epoch ms), or null while the session lasts or without the watch. */
export const EXPIRY_STAMP_IN_PAGE = (spec) => {
  const s = window[spec.key];
  return s && typeof s.endedAt === 'number' ? s.endedAt : null;
};
/** The stop board: open and in the viewport, and its departure rows fully inside the viewport (the phone spec's rule). */
export const STOP_BOARD_READ_IN_PAGE = (spec) => {
  const shown = (el) => {
    if (!el || el.hidden || el.closest('[hidden]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 1 || r.height <= 1) return false;
    for (let a = el; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'none' || cs.visibility === 'hidden' || (cs.opacity !== '' && Number(cs.opacity) === 0)) return false;
    }
    return true;
  };
  const inView = (el) => { const b = el.getBoundingClientRect(); return b.bottom > 0 && b.right > 0 && b.top < innerHeight && b.left < innerWidth; };
  const board = document.querySelector(spec.board);
  // The probe wrapper is display: contents (app/src/ui/map.css .t-stop-board): no box of its own, 0 × 0 by
  // construction, so the board is open when its first rendered child is shown and in the viewport, the accept
  // spec's reading (e2e/accept/phone.spec.ts). Production, 24 Sep: the board and its three rows were on screen.
  const boxless = Boolean(board) && !board.hidden && !board.closest('[hidden]') && getComputedStyle(board).display === 'contents';
  const face = boxless ? Array.from(board.children).find(shown) : null;
  const open = boxless ? Boolean(face) && inView(face) : shown(board) && inView(board);
  const rows = Array.from(document.querySelectorAll(spec.rows)).filter(shown);
  const inside = rows.filter((el) => { const r = el.getBoundingClientRect(); return r.top >= -1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1; });
  return { open, total: rows.length, inViewport: inside.length, texts: rows.slice(0, 6).map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)) };
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
/**
 * The wall validator's census (RUN decision 24: a MONITORED figure, never a gate): every element that
 * carries `data-skipped-text`, by its data-testid. The kiosk root (`kiosk`) writes the rows the last
 * selection left out for their third-party text and why, "count:2;link:1;instruction:1"
 * (app/src/city/nearby.ts skippedTextCensus, reasons in shared/kiosk/external-text.ts order); the
 * "U blizini" timeline (`nearby`) writes how many rows its render check dropped, a bare "1"
 * (app/src/kiosk/timeline.ts). Read on every rotation reading, recorded in rotation.jsonl and counted in
 * report.md; no threshold reads it, so it never moves the exit code.
 */
export const SKIPPED_TEXT_SPEC = Object.freeze({ selector: '[data-skipped-text]' });
export const SKIPPED_TEXT_IN_PAGE = (spec) => Array.from(document.querySelectorAll(spec.selector)).map((el) => ({
  surface: el.getAttribute('data-testid') || el.tagName.toLowerCase(),
  value: el.getAttribute('data-skipped-text') || '',
}));

const shipped = (re) => ({ source: re.source, flags: re.flags });
const phoneSpec = (inventory) => {
  const P = inventory.PHONE_PROBES;
  // Every departure row, Sada's block and the shared timeline alike: the phone spec's PHONE_DEPARTURE_ROWS.
  return { place: P.sadaPlace, sentence: P.sadaSentence, departures: inventory.PHONE_DEPARTURE_ROWS, tab: P.tab, shareCity: P.shareCity, slop: shipped(inventory.PHONE_SLOP_RE) };
};
const errText = (e) => String(e && e.message ? e.message : e).split(/\r?\n/)[0].slice(0, 300);
/** An error's first line and the call log Playwright appends (what it was waiting for), on one line. */
const errDetail = (e) => String(e && e.message ? e.message : e).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 6).join(' ').slice(0, 600);
const zagreb = (ms) => new Date(ms).toLocaleString('hr-HR', { timeZone: 'Europe/Zagreb', hour12: false });

/** One census value: "count:N;reason:n…" (the kiosk root) or a bare "N" (the timeline); anything else keeps its raw text and no count. */
export function parseSkippedText(value) {
  const text = String(value ?? '').trim();
  if (/^\d+$/.test(text)) return { count: Number(text), reasons: {} };
  let count = null;
  const reasons = {};
  for (const part of text.split(';')) {
    const m = /^([a-z-]+):(\d+)$/.exec(part.trim());
    if (!m) return { count: null, reasons: {}, raw: text.slice(0, 80) };
    if (m[1] === 'count') count = Number(m[2]);
    else reasons[m[1]] = Number(m[2]);
  }
  return count === null ? { count: null, reasons: {}, raw: text.slice(0, 80) } : { count, reasons };
}
/** A reading's census per surface, and its total: null when no surface wrote a count (a build before D2). */
export function skippedTextOf(entries) {
  const surfaces = entries.map(({ surface, value }) => ({ surface, ...parseSkippedText(value) }));
  const counted = surfaces.filter((x) => x.count !== null);
  return { total: counted.length ? counted.reduce((n, x) => n + x.count, 0) : null, surfaces };
}
/** The census now; a page that cannot answer gives no count and the error, never a failed run. */
export async function readSkippedText(page) {
  try {
    return skippedTextOf(await page.evaluate(SKIPPED_TEXT_IN_PAGE, SKIPPED_TEXT_SPEC));
  } catch (e) {
    return { total: null, surfaces: [], error: errText(e) };
  }
}
/**
 * The rotation's census for report.md: total = the counts summed over the readings (a row left out in
 * consecutive readings counts in each), max = the largest count in one reading, with its reading and surfaces.
 */
export function summariseSkippedText(rotation) {
  const withCensus = rotation.filter((r) => r.skippedText && r.skippedText.total !== null);
  const bySurface = {};
  const reasons = {};
  let max = null;
  for (const r of withCensus) {
    if (max === null || r.skippedText.total > max.skippedText.total) max = r;
    for (const x of r.skippedText.surfaces) {
      if (x.count !== null) bySurface[x.surface] = (bySurface[x.surface] ?? 0) + x.count;
      for (const [reason, n] of Object.entries(x.reasons)) reasons[reason] = (reasons[reason] ?? 0) + n;
    }
  }
  const flagged = withCensus.filter((r) => r.skippedText.total > 0).map((r) => r.n);
  return {
    readings: rotation.length,
    withCensus: withCensus.length,
    withSkip: flagged.length,
    total: withCensus.reduce((n, r) => n + r.skippedText.total, 0),
    max: max ? max.skippedText.total : null,
    maxReading: max ? max.n : null,
    maxSurfaces: max ? max.skippedText.surfaces.map((x) => ({ surface: x.surface, count: x.count })) : [],
    bySurface,
    reasons,
    flagged,
    errors: rotation.filter((r) => r.skippedText && r.skippedText.error).length,
  };
}

// --- observing ----------------------------------------------------------------------------------------
/** A browser context with the observer's user agent and a recorder on its one page. */
async function openPage(browser, ctx, name, surface, options) {
  const context = await browser.newContext({ locale: 'hr-HR', timezoneId: 'Europe/Zagreb', colorScheme: 'light', ...options });
  const page = await context.newPage();
  // The recorder shares the observer's clock, so the redemption spacing is read on one time line.
  const entry = { surface, recorder: ctx.instruments.recorders.attachRecorders(page, name, { now: () => new Date(ctx.now()) }), snapshot: null };
  ctx.recorders.push(entry);
  // The zet-rt snapshots the page reads: whether the twin had any vehicle to draw when a reading found no pill.
  ctx.fleets?.set(page, watchFleet(page, ctx));
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
export async function openKiosk(page, ctx, label = 'kiosk') {
  const { wall, lib } = ctx.instruments;
  try {
    await page.goto(ctx.kioskUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(INVITATION_READY_IN_PAGE, { invitation: wall.WALL_PROBES.invitation, code: wall.WALL_PROBES.code, shown: shipped(lib.CODE_SHOWN_RE) }, { timeout: INVITATION_TIMEOUT_MS });
  } catch (e) {
    throw new KioskUnavailable(`the screen named by E2E_KIOSK_URL showed no invitation with a code within ${INVITATION_TIMEOUT_MS / 1000} s (expired, revoked or not a screen?): ${errText(e)}`);
  }
  await page.waitForFunction(MAP_SETTLED_IN_PAGE, { map: wall.WALL_PROBES.map, pending: ['loading'] }, { timeout: MAP_SETTLE_TIMEOUT_MS })
    .catch(() => ctx.note(`kiosk: the map did not settle within ${MAP_SETTLE_TIMEOUT_MS / 1000} s`));
  // The accept spec's settle: the census is taken once the map has settled (MapLibre's idle, or a still frame after
  // PROBE_SETTLE_MS), so a reading before it measures a map that has not drawn. Production, 24 Sep: the portrait,
  // read 2.5 s after `ready`, had no data-unlabelled, data-markers or data-pills and failed unlabelled, pills-drawn
  // and legibility on it; the rotation's first reading came 2 s before the first pill. Then the vehicles, where the
  // twin has any. Neither wait is a gate.
  const map = { map: wall.WALL_PROBES.map };
  const t0 = ctx.now();
  const census = await page.waitForFunction(MAP_CENSUS_IN_PAGE, map, { timeout: CENSUS_TIMEOUT_MS }).then(() => ctx.now() - t0, () => null);
  const pills = await page.waitForFunction(PILLS_DRAWN_IN_PAGE, map, { timeout: VEHICLES_TIMEOUT_MS }).then(() => ctx.now() - t0, () => null);
  ctx.note(`${label}: the map census ${census === null ? `not written within ${CENSUS_TIMEOUT_MS / 1000} s` : `${census} ms`} and ${pills === null ? `no vehicle pill within ${VEHICLES_TIMEOUT_MS / 1000} s` : `the first vehicle pill ${pills} ms`} after the map left loading`);
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
  sample.fleet = fleetNow(ctx, page, sample.at);
  ctx.scrub.noteCode(sample.code);
  const viewport = await viewportOf(page, label, { surface, scenario: 'the passive wall' }, ctx, { wall: true });
  let legible = null;
  try { legible = await legibility.legibilityReport(page, legibility.WALL_1920); } catch (e) { ctx.error(`${label} legibility`, e); }
  await shot(page, label, ctx);
  return { sample, viewport, legibility: legible };
}

/** The rotation's planned readings for `minutes` of real time, one every `stepMs`: 300 for ten minutes. */
export const plannedRotationSteps = (minutes, stepMs) => Math.max(1, Math.round((minutes * 60_000) / stepMs));

/**
 * The rotation in real time, every reading appended to rotation.jsonl as it is made. Meanwhile calm motion
 * (principle 7, e2e/wall.ts, the accept spec's own watcher and verdict) is measured over every minute of it: a
 * window opens at reading 0, 30, 60 … and closes at the next, the last one at the end of the rotation; each goes
 * to `calm` as { from, to, reading } or { from, to, error }.
 */
export async function rotate(page, ctx, calm = []) {
  const { wall } = ctx.instruments;
  const steps = plannedRotationSteps(ctx.minutes, wall.ROTATION_STEP_MS);
  const per = Math.max(1, Math.round(wall.IDLE_MINUTE_MS / wall.ROTATION_STEP_MS));
  let open = null;
  const close = async (to) => {
    if (open === null) return;
    const from = open;
    open = null;
    try { calm.push({ from, to, reading: await page.evaluate(wall.CALM_MOTION_READ_IN_PAGE, wall.CALM_MOTION_SPEC) }); } catch (e) { calm.push({ from, to, error: errText(e) }); }
  };
  const start = async (n) => {
    try { await page.evaluate(wall.CALM_MOTION_START_IN_PAGE, wall.CALM_MOTION_SPEC); open = n; } catch (e) { calm.push({ from: n, to: n, error: errText(e) }); }
  };
  let last = -1;
  const rows = await wall.sampleRotation(page, {
    steps, stepMs: wall.ROTATION_STEP_MS, clock: 'real',
    onSample: async (row) => {
      if (!('error' in row)) {
        ctx.scrub.noteCode(row.code);
        row.fleet = fleetNow(ctx, page, row.at);
      }
      // The validator's census rides on the reading it belongs to (monitored, never judged).
      row.skippedText = await readSkippedText(page);
      ctx.appendRotation(row);
      last = row.n;
      if (row.n % per === 0) { await close(row.n); await start(row.n); }
    },
  });
  if (open !== null && open < last) await close(last);
  else if (open !== null) await page.evaluate(wall.CALM_MOTION_READ_IN_PAGE, wall.CALM_MOTION_SPEC).catch(() => {});
  return rows;
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

/**
 * One redemption for `surface` inside the budget: wait out the spacing from the latest redemption (its /api/scan
 * answer), read a fresh code, land in the live session. A redemption counts only when its POST /api/scan answers
 * on this page before the wait for the live session ends. Without one the redemption is failed for good, first,
 * and only then is the page left for about:blank, so the browser cancels a scan still in flight: an answer during
 * or after that cancellation is a late answer in the report, never a confirmation (it still moves the spacing on).
 * A cancellation that rejects is recorded (the recorder row names it) and the redemption stays failed. The next
 * surface waits the spacing from the latest answer, failure or late answer.
 */
export async function redeem(page, kioskPage, surface, ctx) {
  let scanUrl = null;
  for (;;) {
    const wait = ctx.budget.waitMs(surface, ctx.now());
    if (wait > 0) {
      ctx.note(`${surface}: waiting ${Math.ceil(wait / 1000)} s so it is redeemed at least ${REDEMPTION_SPACING_MS / 1000} s after the last /api/scan answer`);
      await ctx.sleep(wait);
    }
    scanUrl = await freshScanUrl(kioskPage, ctx);
    // Reading a code takes time, and a late /api/scan answer may have come in meanwhile: wait again if so.
    if (ctx.budget.waitMs(surface, ctx.now()) === 0) break;
  }
  const { pathOf } = ctx.instruments.recorders;
  let answeredAt = null;
  let timedOut = false;
  page.on('response', (res) => {
    try {
      if (res.request().method() !== 'POST' || !pathOf(res.url()).startsWith('/api/scan')) return;
    } catch { return; }
    const at = ctx.now();
    if (timedOut) {
      ctx.budget.redeemed(surface, at);
      ctx.note(`${surface}: a late /api/scan answer after its redemption failed; reported, not counted as confirmed`);
      return;
    }
    if (ctx.budget.redeemed(surface, at)) answeredAt = at;
  });
  ctx.budget.take(surface, ctx.now());
  const t0 = ctx.now();
  try {
    await page.goto(scanUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(ANY_PRESENT_IN_PAGE, { selectors: [SESSION_LIVE, ctx.instruments.inventory.PHONE_PROBES.sadaPlace] }, { timeout: SESSION_TIMEOUT_MS });
  } finally {
    if (answeredAt === null) {
      // Failed for good before the cancellation starts: nothing that answers from here on can confirm it.
      timedOut = true;
      ctx.budget.failed(surface, ctx.now());
      let cancelError = null;
      try {
        await page.goto('about:blank', { timeout: 10_000 });
      } catch (e) {
        cancelError = errText(e);
        ctx.error(`${surface} cancellation`, e);
      }
      ctx.budget.settle(surface, ctx.now(), cancelError);
      ctx.note(`${surface}: no /api/scan answer within ${SESSION_TIMEOUT_MS / 1000} s; the redemption failed${cancelError ? ', and leaving its page to cancel the scan failed' : ' and its page was left, so the scan is cancelled'}`);
    }
  }
  return ctx.now() - t0;
}

async function axeOf(page, ctx, label) {
  if (!ctx.axe) return null;
  try { return await ctx.axe(page); } catch (e) { ctx.error(`${label} axe`, e); return null; }
}

/** What a phone phase fills; a failure part way keeps what was read. */
export const newPhone = () => ({ landingMs: null, sada: null, share: null, karta: null, stopBoard: null, expiry: null, axe: { sada: null, karta: null }, viewports: [] });
export const newDesktop = () => ({ landingMs: null, read: null, viewports: [] });

/**
 * "Podijeli grad", once: one tap when the button is at rest in the header (Sada's reading says so; before WP4 it
 * is not, and nothing is tapped), then the share code within SHARE_TIMEOUT_MS, then Escape to close the dialog.
 * The code itself is never kept: only whether one appeared, and when.
 */
export async function shareOnce(page, ctx, sada) {
  const { inventory, lib } = ctx.instruments;
  const P = inventory.PHONE_PROBES;
  if (!sada || !sada.shareCity.visible) return { tapped: false, code: false, afterMs: null, detail: `${P.shareCity} was not visible at rest, so nothing was tapped` };
  const out = { tapped: false, code: false, afterMs: null, detail: null };
  try {
    await page.click(`${P.shareCity}:visible`, { timeout: 10_000 });
    out.tapped = true;
    const t0 = ctx.now();
    for (;;) {
      const read = await page.evaluate(SHARE_CODE_IN_PAGE, { code: P.shareCode });
      ctx.scrub.noteCode(read.text);
      if (read.visible && lib.CODE_RE.test(read.text.replace(/\s+/g, ''))) {
        out.code = true;
        out.afterMs = ctx.now() - t0;
        break;
      }
      if (ctx.now() - t0 > SHARE_TIMEOUT_MS) {
        out.detail = `${P.shareCode} ${!read.present ? 'never appeared' : !read.visible ? 'stayed hidden' : `read ${read.text.length} character(s), not a code`} within ${SHARE_TIMEOUT_MS / 1000} s of the tap`;
        break;
      }
      await ctx.sleep(POLL_MS);
    }
  } catch (e) {
    out.detail = `the tap on ${P.shareCity} failed: ${errText(e)}`;
  } finally {
    if (out.tapped) {
      await page.keyboard.press('Escape').catch(() => {});
      await ctx.sleep(SETTLE_MS);
    }
  }
  return out;
}

/** Karta's stop search (§16.4): the tab was tap one; the field and the first result make three. Nothing is sent to the screen. */
export async function stopBoardBySearch(page, ctx) {
  const { inventory } = ctx.instruments;
  const P = inventory.PHONE_PROBES;
  const out = { taps: 1, query: inventory.STOP_SEARCH_QUERY, open: false, total: 0, inViewport: 0, texts: [], error: null };
  try {
    await page.click(`${P.transportSearch}:visible`, { timeout: 10_000 });
    out.taps++;
    await page.fill(`${P.transportSearch}:visible`, inventory.STOP_SEARCH_QUERY, { timeout: 5_000 });
    try {
      await page.click(`${P.selectStop}:visible`, { timeout: STOP_BOARD_TIMEOUT_MS });
    } catch (e) {
      // 24 Sep 03:40: the click reported its timeout on a page whose frames were slow (Karta's first pill 8.2 s), yet
      // the board stood open with three departures in the viewport, and nothing but that tap opens it. The tap is
      // made when the board is there; only a board that is not fails the path. The click's own words go in the notes.
      const opened = await page.waitForFunction(ANY_PRESENT_IN_PAGE, { selectors: [P.stopBoard] }, { timeout: 1_000 }).then(() => true, () => false);
      if (!opened) throw e;
      ctx.note(`phone: the stop search's result click reported "${errDetail(e)}", and the board opened: the tap counts`);
    }
    out.taps++;
    await page.waitForFunction(ANY_PRESENT_IN_PAGE, { selectors: [P.stopBoard] }, { timeout: STOP_BOARD_TIMEOUT_MS })
      .catch(() => ctx.note(`phone: no ${P.stopBoard} within ${STOP_BOARD_TIMEOUT_MS / 1000} s of the search result`));
    await ctx.sleep(SETTLE_MS);
    Object.assign(out, await page.evaluate(STOP_BOARD_READ_IN_PAGE, { board: P.stopBoard, rows: `${P.stopBoard} ${P.departureRows}` }));
  } catch (e) {
    out.error = errText(e);
  }
  await shot(page, 'phone-stop-board', ctx);
  return out;
}

/** Every /api/data request `page` makes from now on, with the observer's clock (Date.now() on a real run, as the page's stamp). */
export function watchDataRequests(page, ctx) {
  const { pathOf } = ctx.instruments.recorders;
  const list = [];
  page.on('request', (req) => {
    try {
      const path = pathOf(req.url());
      if (/^\/api\/data(\/|$|\?)/.test(path)) list.push({ path: path.slice(0, 120), at: ctx.now() });
    } catch { /* a request without a URL is not a data request */ }
  });
  return list;
}

/**
 * What the twin told a page about the vehicles in one data response: the zet-rt snapshot of /api/teaser (the wall's:
 * the pins inside the teaser's box, worker/feed/registry.ts), of /api/data/zet-rt (the phone's: the whole fleet) or of
 * an aggregate /api/data; null for any other answer. `pins` counts the moving vehicles (ids `vehicle:`), never the
 * route summaries (`route:`) nor the teaser's fleet count (`vozila`, given as `fleet`).
 */
export function fleetOf(path, body) {
  const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
  let snapshots;
  if (/^\/api\/teaser(\?|$)/.test(path)) snapshots = isObj(body) && Array.isArray(body.modules) ? body.modules : [];
  else if (/^\/api\/data\/zet-rt(\?|$)/.test(path)) snapshots = [body];
  else if (/^\/api\/data(\?|$)/.test(path)) snapshots = isObj(body) ? (Array.isArray(body.modules) ? body.modules : Object.values(body)) : [];
  else return null;
  const zet = snapshots.find((m) => isObj(m) && m.module === 'zet-rt');
  if (!zet) return null;
  const items = (Array.isArray(zet.items) ? zet.items : []).filter(isObj);
  const count = items.find((i) => i.id === 'vozila');
  const fleet = count && isObj(count.data) && Number.isFinite(Number(count.data.vehicles)) ? Number(count.data.vehicles) : null;
  return { status: typeof zet.status === 'string' ? zet.status : null, pins: items.filter((i) => String(i.id ?? '').startsWith('vehicle:')).length, fleet };
}

/**
 * What a page held at `at`: the latest zet-rt snapshot it had received by then, and `since`, when the run of snapshots
 * with vehicles that one belongs to began (its own time when it has none). null before the first snapshot.
 */
export function fleetAt(records, at) {
  const seen = records.filter((r) => r.at <= at).sort((a, b) => a.at - b.at);
  if (!seen.length) return null;
  const last = seen[seen.length - 1];
  let since = last.at;
  for (let i = seen.length - 1; last.pins > 0 && i >= 0 && seen[i].pins > 0; i--) since = seen[i].at;
  return { at: last.at, status: last.status, pins: last.pins, fleet: last.fleet, since };
}

/** Every zet-rt snapshot `page` receives from now on, stamped on the observer's clock when its answer came. */
export function watchFleet(page, ctx) {
  const { pathOf } = ctx.instruments.recorders;
  const list = [];
  page.on('response', async (res) => {
    let path;
    try { path = pathOf(res.url()); } catch { return; }
    if (!/^\/api\/(teaser|data)(\/zet-rt)?(\?|$)/.test(path)) return;
    const at = ctx.now();
    try {
      if (res.status() >= 400) return;
      const fleet = fleetOf(path, await res.json());
      if (fleet) list.push({ at, ...fleet });
    } catch { /* an answer without a JSON body tells nothing about the vehicles */ }
  });
  return list;
}
/** The twin's report as `page` held it at `at` (null when the page read no zet-rt snapshot by then). */
const fleetNow = (ctx, page, at) => fleetAt(ctx.fleets?.get(page) ?? [], at);

/**
 * The phone once its ten minutes are over: session-ended with /s/ and /hitno, no content row, no export control,
 * and no /api/data request from the page's own stamp of the end through AFTER_EXPIRY_MS after it (e2e/inventory.ts
 * expiryFailures, the phone spec's own). The request watcher has run since the redemption.
 */
export async function observeExpiry(page, ctx, out) {
  const { inventory } = ctx.instruments;
  const P = inventory.PHONE_PROBES;
  const redeemedAt = ctx.budget.times().find((t) => t.surface === 'phone')?.at ?? ctx.now();
  const timeout = Math.max(EXPIRY_MARGIN_MS, redeemedAt + SESSION_LENGTH_MS + EXPIRY_MARGIN_MS - ctx.now());
  const spec = { ended: P.sessionEnded, key: EXPIRY_KEY };
  const seen = ctx.expiryWatch
    ? await page.waitForFunction(EXPIRY_STAMP_IN_PAGE, spec, { timeout }).then(() => true, () => false)
    : await page.waitForFunction(ANY_PRESENT_IN_PAGE, { selectors: [P.sessionEnded] }, { timeout }).then(() => true, () => false);
  if (!seen) ctx.note(`phone: no ${P.sessionEnded} by ${(SESSION_LENGTH_MS + EXPIRY_MARGIN_MS) / 1000} s after its redemption`);
  const stamp = ctx.expiryWatch ? await page.evaluate(EXPIRY_STAMP_IN_PAGE, spec).catch(() => null) : null;
  // Without the page's own stamp there is no blind window: the boundary is the observer's estimate of the end, the
  // confirmed redemption + SESSION_MINUTES, never the later moment it came to look. A missing stamp fails the row.
  const estimate = redeemedAt + SESSION_LENGTH_MS;
  const endedAt = stamp ?? estimate;
  if (stamp === null) ctx.note(`phone: the page kept no stamp of its session's end; /api/data requests count from the redemption + ${SESSION_MINUTES} min`);
  const ended = await page.evaluate(inventory.EXPIRY_READ_IN_PAGE, inventory.EXPIRY_SPEC);
  // A full AFTER_EXPIRY_MS past the end: from the stamp, or (the real end unknown) from now.
  await ctx.sleep(Math.max(0, (stamp ?? ctx.now()) + AFTER_EXPIRY_MS - ctx.now()));
  const later = await page.evaluate(inventory.EXPIRY_READ_IN_PAGE, inventory.EXPIRY_SPEC);
  const requestsAfter = (ctx.phoneDataRequests ?? []).filter((r) => r.at >= endedAt).map((r) => r.path);
  out.expiry = { seen: seen || ended.ended, stamped: stamp !== null, boundary: stamp !== null ? 'stamp' : 'estimate', afterRedemptionMs: endedAt - redeemedAt, ended, later, requestsAfter };
  await shot(page, 'phone-expired', ctx);
  return out.expiry;
}

/** The phone: one redemption, Sada's first viewport and reading, the share code, Karta's cold open (the tab), the stop board by search. */
export async function observePhone(page, kioskPage, ctx, out = newPhone()) {
  const { inventory } = ctx.instruments;
  const P = inventory.PHONE_PROBES;
  // Every /api/data request from the redemption on, so none made after the session's end can slip past.
  ctx.phoneDataRequests = watchDataRequests(page, ctx);
  out.landingMs = await redeem(page, kioskPage, 'phone', ctx);
  ctx.expiryWatch = await page.evaluate(EXPIRY_WATCH_IN_PAGE, { ended: P.sessionEnded, key: EXPIRY_KEY }).then(() => true, (e) => { ctx.error('phone expiry watch', e); return false; });
  await page.waitForFunction(ANY_PRESENT_IN_PAGE, { selectors: [P.sadaPlace, P.sadaDepartures] }, { timeout: SADA_TIMEOUT_MS })
    .catch(() => ctx.note(`phone: neither ${P.sadaPlace} nor ${P.sadaDepartures} within ${SADA_TIMEOUT_MS / 1000} s`));
  await ctx.sleep(SETTLE_MS);
  out.viewports.push(await viewportOf(page, 'phone-sada', { surface: 'phone', scenario: 'Sada right after redemption' }, ctx));
  out.sada = await page.evaluate(PHONE_READ_IN_PAGE, phoneSpec(inventory));
  out.axe.sada = await axeOf(page, ctx, 'phone Sada');
  await shot(page, 'phone-sada', ctx);
  out.share = await shareOnce(page, ctx, out.sada);

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
    // The pills are written the moment one is drawn; the marker census (data-unlabelled, data-markers) waits for
    // every city source and a settled second (app/src/map/name-census.ts). Read that once it is there, as the
    // wall's settle does; waits, never gates: a census that never comes still fails karta-unlabelled.
    if (read.unlabelled === null) {
      const censusAt = await page.waitForFunction(MAP_CENSUS_IN_PAGE, { map: P.mapCanvas }, { timeout: CENSUS_TIMEOUT_MS }).then(() => ctx.now() - readyAt, () => null);
      ctx.note(`phone Karta: the map census ${censusAt === null ? `not written within ${CENSUS_TIMEOUT_MS / 1000} s` : `${censusAt} ms`} after ready`);
      const census = await page.evaluate(KARTA_READ_IN_PAGE, spec);
      read = { ...read, unlabelled: census.unlabelled, markers: census.markers };
    }
  }
  // Whether the twin had any vehicle for the phone by the end of the window: without one no pill is owed.
  out.karta = { ...read, pillsAfterMs, fleet: fleetNow(ctx, page, readyAt + inventory.KARTA_PILLS_WITHIN_MS) };
  out.viewports.push(await viewportOf(page, 'phone-karta-cold', { surface: 'phone', scenario: 'Karta cold open (one tap: the tab)' }, ctx));
  out.axe.karta = await axeOf(page, ctx, 'phone Karta');
  await shot(page, 'phone-karta-cold', ctx);
  out.stopBoard = await stopBoardBySearch(page, ctx);
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
  const kiosk = { first: null, portrait: null, rotation: [], calm: [], viewports: [], legibility: {}, proxy: null };
  observation.kiosk = kiosk;

  const landscape = await openPage(browser, ctx, 'kiosk-1920x1080', 'kiosk', { viewport: { ...scenes.WALL_LANDSCAPE }, deviceScaleFactor: 1, userAgent: desktopUa });
  await openKiosk(landscape.page, ctx, 'kiosk-1920x1080');
  const first = await readKiosk(landscape.page, 'kiosk-1920x1080', 'kiosk', ctx);
  kiosk.first = first.sample;
  kiosk.viewports.push(first.viewport);
  kiosk.legibility['kiosk-1920x1080'] = first.legibility;
  ctx.note(`kiosk: first reading; rotation for ${ctx.minutes} min`);
  const rotation = rotate(landscape.page, ctx, kiosk.calm);

  // Nothing below may throw past this point: the rotation is running and must be awaited.
  let phonePage = null;
  if (surfaces.includes('phone')) {
    observation.phone = newPhone();
    try {
      const phone = await openPage(browser, ctx, 'phone', 'phone', { ...ctx.devices['Pixel 7'], userAgent: `${ctx.devices['Pixel 7'].userAgent}${USER_AGENT_SUFFIX}` });
      phonePage = phone.page;
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
    await openKiosk(portrait.page, ctx, 'kiosk-1080x1920');
    const read = await readKiosk(portrait.page, 'kiosk-1080x1920', 'kiosk-portrait', ctx);
    kiosk.portrait = read.sample;
    kiosk.viewports.push(read.viewport);
    kiosk.legibility['kiosk-1080x1920'] = read.legibility;
    await closePage(portrait);
  } catch (e) { ctx.error('kiosk portrait', e); }

  try {
    const proxy = await openPage(browser, ctx, 'kiosk-3m-proxy', 'kiosk', { viewport: { ...scenes.WALL_LANDSCAPE }, deviceScaleFactor: scenes.PROXY_DEVICE_SCALE_FACTOR, userAgent: desktopUa });
    await openKiosk(proxy.page, ctx, 'kiosk-3m-proxy');
    await ctx.sleep(PROXY_SETTLE_MS);
    const name = `kiosk-1920x1080-dpr${String(scenes.PROXY_DEVICE_SCALE_FACTOR).replace('.', '')}-3m`;
    await shot(proxy.page, name, ctx);
    if (ctx.captures.includes(`captures/${name}.png`)) kiosk.proxy = `captures/${name}.png`;
    await closePage(proxy);
  } catch (e) { ctx.error('kiosk 3 m proxy', e); }

  // The phone's ten minutes run out after the rotation: its end is read last.
  if (phonePage && observation.phone.landingMs !== null) {
    try { await observeExpiry(phonePage, ctx, observation.phone); } catch (e) { ctx.error('phone expiry', e); }
  }
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
  // D1: before the wall lands, only the pills and the recorders, on every planned reading.
  T('wall-read', 'd1', 'kiosk', 'kiosk.missingReadings', NONE, 'every planned wall reading made: the first, each rotation reading ({ROTATION_STEP_MS} ms apart) and the portrait; a failed or missing one counts', '§16.7'),
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
  T('pills-drawn', 'd2', 'kiosk', 'kiosk.pillsEmptyReadings', NONE, 'vehicle pills drawn (data-pills non-empty) in every reading whose data-feed is live while the twin reports vehicles (from {PILLS_DRAW_GRACE_S} s after they appear); an outage (stale, down) or a twin reporting none needs none', '[O-71], §16.3'),
  T('outage', 'd2', 'kiosk', 'kiosk.outageDishonest', NONE, 'while data-feed is down: no vehicle pill, no live countdown row, data-markers > 0, every departure a clock time', '§16.3 outage0800'),
  T('outage-heading', 'd2', 'kiosk', 'kiosk.outageHeadline', NONE, 'while data-feed is down: no heading (h1, h2) or sentence matches the outage scene\'s headline rule, and the map note shows exactly once', '§16.3 outage0800, principle 9'),
  T('calm-motion', 'd2', 'kiosk', 'kiosk.calmMotion', NONE, 'every minute of the rotation: at most {IDLE_MUTATIONS_MAX} structural mutations under the timeline, and every row that stays keeps its node', '§16.3, principle 7'),
  T('sentence-length', 'd2', 'kiosk', 'kiosk.sentenceOutOfRange', NONE, 'the sentence has 1–{SENTENCE_MAX_CHARS} characters in every reading', '§16.3, §12'),
  T('sentence-ellipsis', 'd2', 'kiosk', 'kiosk.sentenceEllipses', NONE, 'no sentence cut by an ellipsis', '§16.3'),
  T('sentence-overflow', 'd2', 'kiosk', 'kiosk.sentenceOverflows', NONE, 'no sentence overflowing its box', '§16.3'),
  T('sentence-repeat', 'd2', 'kiosk', 'kiosk.sentenceRepeats', NONE, 'no sentence repeated verbatim within ten minutes', '§12'),
  T('sentence-distinct', 'd2', 'kiosk', 'kiosk.sentencesTooFew', NONE, 'at least {DISTINCT_SENTENCES_MIN} distinct sentences in every ten minutes of the rotation (a shorter run in proportion, at least 1)', '§16.3, §12'),
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
  T('legibility', 'd2', 'kiosk', 'kiosk.legibilityViolations', NONE, 'legibility violations [] in landscape and portrait (read tier x-height ≥ {X_HEIGHT_FLOOR_MM} mm, ×{DARK_FACTOR} dark; other text ≥ {WALKUP_MIN_PX} px; the canvas map measured)', '§16.3, P3'),
  T('proxy', 'd2', 'kiosk', 'kiosk.proxyMissing', NONE, 'the DPR {PROXY_DEVICE_SCALE_FACTOR} screenshot for the 3-metre check was written', '§16.3, §16.7'),
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
  T('phone-share-code', 'd3', 'phone', 'phone.shareCodeMissing', NONE, 'one tap on "{SHARE_CITY_LABEL}" shows share-code as a code (ABCD-EFGH)', '§16.4'),
  T('karta-pills', 'd3', 'phone', 'phone.kartaPillsLate', NONE, 'Karta cold open: a vehicle pill within {KARTA_PILLS_WITHIN_MS} ms of data-map-status=ready, no tap (none owed while the twin reports no vehicle)', '§16.4'),
  T('karta-disclosures', 'd3', 'phone', 'phone.kartaDisclosures', NONE, 'Karta: no filter disclosure or group taxonomy', '§16.4'),
  T('karta-unlabelled', 'd3', 'phone', 'phone.kartaUnlabelled', NONE, 'Karta: data-unlabelled = 0 (a missing probe counts)', '§16.4'),
  T('phone-stop-board', 'd3', 'phone', 'phone.stopBoardFailures', NONE, 'Karta: the search reaches a stop board in at most {SEARCH_TAPS_MAX} taps, {PHONE_DEPARTURES} departures fully inside the viewport', '§16.4, D3'),
  T('phone-expiry', 'd3', 'phone', 'phone.expiryFailures', NONE, 'after the ten minutes: session-ended with its /s/ and /hitno links, no content row, no export control, no /api/data request after it', '§16.4, [O-59]'),
  T('phone-axe', 'd3', 'phone', 'phone.axeSeriousCritical', NONE, 'axe serious + critical 0 on Sada and Karta', '§16.4'),
  T('desktop-side-by-side', 'd3', 'desktop', 'desktop.outOfViewport', NONE, 'desktop 1440×900: Sada and Karta both in the viewport', '§16.4'),
  T('desktop-domains', 'd3', 'desktop', 'desktop.domains', NONE, 'desktop: no six-domain bar (.ki-domains)', '§16.4'),
]);

export const stageIndex = (stage) => (stage === STAGE_ALL ? STAGES.length - 1 : STAGES.indexOf(stage));
/** The rows a stage applies. */
export const thresholdsFor = (stage) => THRESHOLDS.filter((t) => stageIndex(t.stage) <= stageIndex(stage));

/** `{NAME}` in a target, from the instruments' exported constants (PILLS_DRAW_GRACE_S is the observer's own). */
export function fillTarget(text, instruments) {
  const own = { PILLS_DRAW_GRACE_S: PILLS_DRAW_GRACE_MS / 1000 };
  return text.replace(/\{([A-Z0-9_]+)\}/g, (_, name) => {
    if (name in own) return String(own[name]);
    for (const mod of [instruments.wall, instruments.inventory, instruments.legibility, instruments.scenes]) {
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
/** What an outage reading (data-feed down) shows that §16.3's outage0800 rules out. */
function outageIssues(s, k) {
  const out = [];
  if (k.wall.pillLabels(s.pills).length) out.push(`vehicle pills ${quote(s.pills, 40)}`);
  if (s.liveRows > 0) out.push(`${s.liveRows} live countdown row(s)`);
  if (!((s.markers ?? 0) > 0)) out.push(`data-markers ${s.markers ?? 'missing'}`);
  const untimed = s.rows.filter((r) => r.kind === 'departure' && !(r.hasTime && k.wall.CLOCK_RE.test(r.whenText)));
  if (untimed.length) out.push(`${untimed.length} departure(s) without a clock time`);
  return out;
}
/** An outage reading's headline against the outage scene's rule (e2e/scenes.ts outage0800 headingNot) and its one map note. */
function outageHeadlineIssues(s, k) {
  const out = [];
  const rule = k.scenes.SCENES.outage0800.expect.headingNot;
  const hits = [...(s.headings ?? []), s.sentence].filter((t) => t && rule && rule.test(t));
  if (hits.length) out.push(`a headline matches ${String(rule)}: ${hits.map((t) => quote(t, 60)).join(', ')}`);
  if (s.mapNotes !== 1) out.push(`${s.mapNotes} map note(s), not 1`);
  return out;
}
/**
 * Whether a wall reading owes vehicle pills (§16.3, [O-71]): its data-feed live (an outage, stale or down, owes none,
 * and so does the boot state, loading, before the first poll has answered),
 * and the twin reporting vehicles to the page for at least PILLS_DRAW_GRACE_MS. A live feed whose last zet-rt snapshot
 * carried no vehicle owes none: the night between two runs, a timetable without service. A reading without a recorded
 * snapshot owes them: the row stays strict wherever the observer cannot tell.
 */
export function pillsOwed(s) {
  if (OUTAGE_FEEDS.includes(s.feed) || s.feed === LOADING_FEED) return false;
  const f = s.fleet;
  if (!f) return true;
  if (f.pins === 0) return false;
  return s.at - f.since >= PILLS_DRAW_GRACE_MS;
}
const twinWords = (f) => (!f ? 'no zet-rt snapshot read' : f.pins === 0 ? `the twin reporting no vehicle${f.status && f.status !== 'live' ? ` (${f.status})` : ''}` : `the twin reporting ${f.pins} vehicle(s)`);
/** The rotation's pills in one line of report.md: drawn, owed, and why the rest owed none. */
function pillsCensus(readings, k) {
  const drawn = readings.filter((s) => k.wall.pillLabels(s.pills).length).length;
  const outage = readings.filter((s) => OUTAGE_FEEDS.includes(s.feed)).length;
  const quiet = readings.filter((s) => !OUTAGE_FEEDS.includes(s.feed) && s.fleet && s.fleet.pins === 0).length;
  const owed = readings.filter(pillsOwed).length;
  return `Vehicle pills: drawn in ${drawn} of ${readings.length} readings, owed in ${owed}; the twin reported no vehicle in ${quiet}, the feed was stale or down in ${outage}.`;
}
const recordersOf = (obs, surface) => (obs.recorders ?? []).filter((r) => surface === 'all' || r.surface === surface);
function recorderProblems(obs, surface) {
  const recs = recordersOf(obs, surface);
  if (!recs.length) return { value: null, detail: [`no ${surface} page was opened`] };
  // A phone or desktop that never landed in its session saw nothing: its empty recorder proves nothing.
  const visit = surface === 'phone' ? obs.phone : surface === 'desktop' ? obs.desktop : null;
  const unconfirmed = (obs.redemptions?.failed ?? []).find((f) => f.surface === surface);
  if (unconfirmed) {
    const late = (obs.redemptions?.late ?? []).filter((l) => l.surface === surface);
    return {
      value: null,
      detail: [`the ${surface}'s redemption was not confirmed: no /api/scan answer within ${SESSION_TIMEOUT_MS / 1000} s, so it failed for good`
        + (unconfirmed.cancelError ? `; leaving its page to cancel the scan failed: ${unconfirmed.cancelError}` : '; its page was left, so the scan is cancelled')
        + (late.length ? `; ${late.length} late answer(s), not counted as confirmed` : '')],
    };
  }
  if (visit && visit.landingMs === null) return { value: null, detail: [`the ${surface} never landed in its session${visit.failed ? ` (${visit.failed})` : ''}: its recorder proves nothing`] };
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
  // Every planned reading, counted when it failed or never happened: nothing drops out of the verdict.
  'kiosk.missingReadings': (obs, k) => {
    if (!obs.kiosk) return { value: null, detail: ['the wall was not observed'] };
    const planned = plannedRotationSteps(obs.meta.minutes, k.wall.ROTATION_STEP_MS);
    const rot = obs.kiosk.rotation ?? [];
    const failed = rot.filter((r) => 'error' in r);
    const absent = Math.max(0, planned - rot.length);
    const portraitError = obs.errors.find((e) => e.phase === 'kiosk portrait');
    const missing = [];
    if (!obs.kiosk.first) missing.push('the first reading was not made');
    if (failed.length) missing.push(`${failed.length} of ${planned} rotation readings failed (${failed.slice(0, 2).map((r) => `#${r.n}: ${quote(r.error, 80)}`).join('; ')}${failed.length > 2 ? '; …' : ''})`);
    if (absent) missing.push(`${absent} of ${planned} rotation readings were never made`);
    if (!obs.kiosk.portrait) missing.push(`the portrait reading (1080 × 1920) was not made${portraitError ? ` (${quote(portraitError.error, 120)})` : ''}`);
    const value = (obs.kiosk.first ? 0 : 1) + failed.length + absent + (obs.kiosk.portrait ? 0 : 1);
    return { value, detail: value ? missing : [`the first, ${planned} rotation readings and the portrait, all made`] };
  },
  'kiosk.plusPillReadings': (obs, k) => {
    const m = countReadings(obs, (s) => k.wall.PLUS_PILL_RE.test(s.pills ?? ''), (s) => `pills ${quote(s.pills, 80)}`);
    const readings = readingsOf(obs) ?? [];
    const empty = readings.filter((s) => !s.pills).length;
    if (empty) m.detail.push(`data-pills was empty in ${empty} of ${readings.length} readings; those readings prove nothing about "+N"`);
    return m;
  },
  // "+N" on any label of the census (e2e/wall.ts pillLabels, the phone spec's rule): 6+2 counts.
  'phone.kartaPlusPills': (obs, k) => {
    const r = karta(obs);
    if (!r) return notMeasured('the Karta cold open');
    const folded = k.wall.pillLabels(r.pills).filter((label) => k.wall.PLUS_PILL_RE.test(label));
    return { value: folded.length, detail: [r.pills ? `pills ${quote(r.pills, 80)}${folded.length ? `; folded ${folded.map((label) => quote(label, 20)).join(', ')}` : ''}` : 'data-pills empty on the Karta cold open'] };
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
    const failed = obs.redemptions?.failed ?? [];
    return { value: over + close, detail: [`redemptions ${Object.entries(per).map(([s, n]) => `${s} ${n}`).join(' · ') || 'none'}${gaps.length ? `; gaps ${gaps.map((g) => `${(g / 1000).toFixed(1)} s`).join(', ')}` : ''}${failed.length ? `; failed (no /api/scan answer, the scan cancelled): ${failed.map((f) => f.surface).join(', ')}` : ''}`] };
  },
  'kiosk.emptyPlaceReadings': (obs) => countReadings(obs, (s) => !s.place, () => 'kiosk-context empty'),
  // `departures` counts only rows a passer-by can see (e2e/wall.ts); rows hidden, offscreen or clipped are hiddenRows.
  'kiosk.departuresOutOfRange': (obs, k) => countReadings(obs, (s) => s.departures < k.wall.DEPARTURES_MIN || s.departures > k.wall.DEPARTURES_MAX, (s) => `${s.departures} visible departure rows${s.hiddenRows ? ` (${s.hiddenRows} row(s) in the DOM but not on the wall, not counted)` : ''}`),
  'kiosk.unlabelledReadings': (obs) => countReadings(obs, (s) => s.unlabelled !== 0, (s) => (s.unlabelled === null ? 'no data-unlabelled probe' : `${s.unlabelled} unlabelled marker(s)`)),
  // Pills are owed while the wall's own data-feed is live (or says nothing) and the twin reports vehicles (pillsOwed).
  'kiosk.pillsEmptyReadings': (obs, k) => {
    const m = countReadings(obs, (s) => pillsOwed(s) && !k.wall.pillLabels(s.pills).length, (s) => `data-pills empty (feed ${s.feed ?? '?'}, map ${s.mapStatus ?? '?'}, ${twinWords(s.fleet)})`);
    const readings = readingsOf(obs) ?? [];
    const outage = readings.filter((s) => OUTAGE_FEEDS.includes(s.feed)).length;
    const quiet = readings.filter((s) => !OUTAGE_FEEDS.includes(s.feed) && s.fleet && s.fleet.pins === 0).length;
    const fresh = readings.filter((s) => !OUTAGE_FEEDS.includes(s.feed) && s.fleet && s.fleet.pins > 0 && !pillsOwed(s)).length;
    if (outage) m.detail.push(`${outage} reading(s) during an outage (data-feed ${OUTAGE_FEEDS.join(' or ')}) owe no pill`);
    if (quiet) m.detail.push(`${quiet} reading(s) with a live feed whose last zet-rt snapshot carried no vehicle owe no pill`);
    if (fresh) m.detail.push(`${fresh} reading(s) within ${PILLS_DRAW_GRACE_MS / 1000} s of the twin first reporting vehicles owe none yet`);
    return m;
  },
  'kiosk.outageHeadline': (obs, k) => countReadings(obs, (s) => s.feed === 'down' && outageHeadlineIssues(s, k).length > 0, (s) => `data-feed down: ${outageHeadlineIssues(s, k).join('; ')}`),
  'kiosk.calmMotion': (obs, k) => {
    const windows = obs.kiosk?.calm ?? [];
    if (!windows.length) return { value: null, detail: ['calm motion was not measured (no minute of the rotation)'] };
    const bad = windows.map((w) => ({ w, f: w.error ? [`not measured: ${w.error}`] : k.wall.calmMotionFailures(w.reading) })).filter((x) => x.f.length);
    return { value: bad.length, detail: bad.length ? bad.slice(0, 5).map((x) => `readings ${x.w.from}–${x.w.to}: ${x.f.join('; ')}`) : [`${windows.length} minute(s) measured, each within ${k.wall.IDLE_MUTATIONS_MAX} structural mutations, every staying row on its node`] };
  },
  'kiosk.outageDishonest': (obs, k) => countReadings(obs, (s) => s.feed === 'down' && outageIssues(s, k).length > 0, (s) => `data-feed down: ${outageIssues(s, k).join('; ')}`),
  'kiosk.sentenceOutOfRange': (obs, k) => countReadings(obs, (s) => s.sentenceChars < 1 || s.sentenceChars > k.wall.SENTENCE_MAX_CHARS, (s) => `${s.sentenceChars} characters ${quote(s.sentence, 90)}`),
  'kiosk.sentenceEllipses': (obs) => countReadings(obs, (s) => s.sentenceEllipsis, (s) => quote(s.sentence, 90)),
  'kiosk.sentenceOverflows': (obs) => countReadings(obs, (s) => s.sentenceOverflow, (s) => quote(s.sentence, 90)),
  'kiosk.sentenceRepeats': (obs) => {
    const rot = valid(obs.kiosk?.rotation ?? []);
    if (!rot.length) return { value: null, detail: ['no rotation reading'] };
    const r = repeatsWithin(rot, REPEAT_WINDOW_MS);
    return { value: r.repeats.length, detail: [`${r.turns} sentence turns, ${r.distinct} distinct`, ...r.repeats.slice(0, 3).map((x) => `${x.at} again after ${Math.round(x.afterMs / 1000)} s: ${quote(x.sentence, 90)}`)] };
  },
  'kiosk.sentencesTooFew': (obs, k) => {
    if (!obs.kiosk || !(obs.kiosk.rotation ?? []).length) return { value: null, detail: ['no rotation reading'] };
    const d = distinctPerWindow(obs.kiosk.rotation, plannedRotationSteps(obs.meta.minutes, k.wall.ROTATION_STEP_MS), k.wall.ROTATION_STEP_MS, REPEAT_WINDOW_MS, k.wall.DISTINCT_SENTENCES_MIN);
    return { value: d.short, detail: d.windows.map((w) => `readings ${w.from}–${w.to}: ${w.distinct} distinct of ${w.required} required`) };
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
  // Landscape and portrait both: a report that could not be taken fails the row, it is not "no violation".
  'kiosk.legibilityViolations': (obs) => {
    const all = obs.kiosk?.legibility ?? {};
    const reports = Object.entries(all).filter(([, r]) => r);
    const missing = ['kiosk-1920x1080', 'kiosk-1080x1920'].filter((label) => !all[label]);
    const findings = reports.flatMap(([label, r]) => [...r.violations, ...r.otherSmall].map((f) => `${label}: ${f.detail}`));
    const detail = findings.slice(0, 5).concat(findings.length > 5 ? [`… ${findings.length - 5} more`] : []);
    if (missing.length) return { value: null, detail: [`no legibility report for ${missing.join(', ')}`, ...detail] };
    return { value: findings.length, detail };
  },
  'kiosk.proxyMissing': (obs) => (obs.kiosk ? { value: obs.kiosk.proxy ? 0 : 1, detail: [obs.kiosk.proxy ?? `no proxy screenshot${obs.errors.some((e) => e.phase === 'kiosk 3 m proxy') ? ` (${quote(obs.errors.find((e) => e.phase === 'kiosk 3 m proxy').error, 120)})` : ''}`] } : notMeasured('the wall')),
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
  'phone.shareCodeMissing': (obs) => {
    const s = obs.phone?.share;
    if (!s) return notMeasured('the tap on share-city');
    return { value: s.code ? 0 : 1, detail: [s.code ? `a share code ${s.afterMs} ms after the tap` : s.detail ?? 'no share code after the tap'] };
  },
  'phone.stopBoardFailures': (obs, k) => {
    const b = obs.phone?.stopBoard;
    if (!b) return notMeasured('the stop search');
    const P = k.inventory.PHONE_PROBES;
    const f = [];
    if (b.error) f.push(`the search path stopped after ${b.taps} tap(s): ${b.error}`);
    else if (!b.open) f.push(`no ${P.stopBoard} in the viewport after the tab, the field and the first result for "${b.query}"`);
    if (b.taps > k.inventory.SEARCH_TAPS_MAX) f.push(`${b.taps} taps (target ≤ ${k.inventory.SEARCH_TAPS_MAX})`);
    if (b.open) f.push(...k.inventory.phoneDepartureFailures({ total: b.total, inFold: b.inViewport, texts: b.texts }, 'the stop board'));
    return { value: f.length, detail: f.length ? f : [`the board after ${b.taps} taps, ${b.inViewport} departures inside the viewport`] };
  },
  'phone.expiryFailures': (obs, k) => {
    const x = obs.phone?.expiry;
    if (!x) return notMeasured('the end of the phone\'s session');
    const f = [...new Set([...k.inventory.expiryFailures(x.ended), ...k.inventory.expiryFailures(x.later, x.requestsAfter)])];
    if (!x.stamped) f.push(`the page kept no stamp of its session's end (a defect): requests counted from the observer's estimate, the redemption + ${SESSION_MINUTES} min`);
    return { value: f.length, detail: f.length ? f : [`session-ended ${Math.round(x.afterRedemptionMs / 1000)} s after the redemption; cleared, and no /api/data request in the ${AFTER_EXPIRY_MS / 1000} s after`] };
  },
  // Strict whenever the twin reported vehicles to the phone (or the observer read no snapshot); none owed when it reported none.
  'phone.kartaPillsLate': (obs, k) => {
    const r = karta(obs);
    if (!r) return notMeasured('the Karta cold open');
    const late = r.pillsAfterMs === null || r.pillsAfterMs > k.inventory.KARTA_PILLS_WITHIN_MS;
    const quiet = late && r.status === 'ready' && r.fleet && r.fleet.pins === 0;
    const seen = r.status !== 'ready' ? `map status ${r.status ?? 'missing'}` : r.pillsAfterMs === null ? `no pill within ${KARTA_POLL_MS / 1000} s of ready` : `first pill ${r.pillsAfterMs} ms after ready`;
    if (quiet) return { value: 0, detail: [`${seen}; the phone's last zet-rt snapshot by ${k.inventory.KARTA_PILLS_WITHIN_MS} ms carried no vehicle, so none was owed`] };
    return { value: late ? 1 : 0, detail: [`${seen}${r.fleet !== undefined ? ` (${twinWords(r.fleet)})` : ''}`] };
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

/**
 * §16.3's floor over the rotation: the planned readings cut into ten-minute windows (by their index `n`), each
 * window needing `min` distinct sentences, a shorter one in proportion and at least one. `short` sums what is
 * missing; failed readings bring no sentence.
 */
export function distinctPerWindow(rotation, planned, stepMs, windowMs, min) {
  const per = Math.max(1, Math.round(windowMs / stepMs));
  const windows = [];
  for (let from = 0; from < planned; from += per) {
    const to = Math.min(planned, from + per) - 1;
    const size = to - from + 1;
    const required = Math.max(1, Math.ceil((min * size) / per));
    const distinct = new Set(rotation.filter((r) => !('error' in r) && r.n >= from && r.n <= to && r.sentence).map((r) => r.sentence)).size;
    windows.push({ from, to, required, distinct });
  }
  return { windows, short: windows.reduce((n, w) => n + Math.max(0, w.required - w.distinct), 0) };
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

/** The canvas map's census (e2e/legibility.ts) in one cell: what its container says, or what it lacks. */
const mapCensus = (m) => {
  if (!m) return '—';
  const pairs = (o) => (o ? Object.entries(o).map(([k, n]) => `${k} ${n}`).join(' ') : '—');
  return `markers ${m.markers ?? '—'}, unlabelled ${m.unlabelled ?? '—'}, BAJS ${pairs(m.bajs)}, overlaps ${pairs(m.overlaps)}, pills ${m.pills ?? '—'}${m.missing.length ? `; missing ${m.missing.map((k) => `data-${k}`).join(', ')}` : ''}`;
};

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
  const failedRedemptions = observation.redemptions?.failed ?? [];
  if (failedRedemptions.length) {
    lines.push(`- Failed redemptions: ${failedRedemptions.map((f) => {
      const late = (observation.redemptions.late ?? []).filter((l) => l.surface === f.surface);
      return `${f.surface} (no /api/scan answer within ${SESSION_TIMEOUT_MS / 1000} s${f.cancelError ? '; the cancellation failed' : ''}${late.length ? `; a late answer ${late.map((l) => `+${Math.max(0, Math.round((l.at - f.at) / 1000))} s`).join(', ')} after it failed, not counted as confirmed` : ''})`;
    }).join(', ')}.`);
  }
  lines.push('- Nothing pressed on the screen, no view presented, settings never opened; the phone tapped only its own controls ("Podijeli grad" when at rest, the Karta tab, the stop search\'s field and first result).', '');

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
    if (k.first) lines.push(`First reading: place ${quote(k.first.place)}, sentence ${quote(k.first.sentence, 90)} (${k.first.kicker ?? 'no kicker'}), head ${quote(k.first.head)}, ${k.first.departures} visible departures (${k.first.hiddenRows} rows not on the wall), feed ${k.first.feed ?? '?'}, ${twinWords(k.first.fleet)}, theme ${k.first.theme ?? '?'}.`, '');
    const wallReadings = readingsOf(observation) ?? [];
    if (wallReadings.length) lines.push(pillsCensus(wallReadings, instruments), '');
    const skip = summariseSkippedText(rot);
    lines.push('### Skipped third-party text (data-skipped-text, monitored, never a gate)', '');
    if (skip.withCensus === 0) {
      lines.push(`No reading carried a \`data-skipped-text\` count (${skip.readings} readings${skip.errors ? `, ${skip.errors} could not be read` : ''}): a build before D2, or the census was not readable.`, '');
    } else {
      const pairs = (o) => Object.entries(o).map(([key, n]) => `${key} ${n}`).join(', ') || '—';
      lines.push('| Readings with a census | Without | With a skip | Total skipped | Max per reading | Per surface | Reasons |', '|---:|---:|---:|---:|---|---|---|');
      lines.push(`| ${skip.withCensus} | ${skip.readings - skip.withCensus} | ${skip.withSkip} | ${skip.total} | ${skip.max}${skip.max ? ` (reading ${skip.maxReading}: ${cell(skip.maxSurfaces.map((x) => `${x.surface} ${x.count ?? '?'}`).join(', '))})` : ''} | ${cell(pairs(skip.bySurface))} | ${cell(pairs(skip.reasons))} |`, '');
      lines.push(`Total skipped sums the counts over the readings, so a row left out in consecutive readings counts in each. ${skip.withSkip ? `Readings with a skip, for the owner: ${skip.flagged.slice(0, 30).join(', ')}${skip.flagged.length > 30 ? ` and ${skip.flagged.length - 30} more` : ''} (rotation.jsonl, \`skippedText\`).` : 'No reading left a row out.'} No threshold reads this census, so it never changes the exit code.`, '');
    }
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
    lines.push('| Capture | Theme | Violations | Other < 28 px | Warnings | Symbols | Map census |', '|---|---|---:|---:|---:|---|---|');
    for (const [label, r] of leg) lines.push(`| ${label} | ${r.dark ? 'dark' : 'light'} | ${r.violations.length} | ${r.otherSmall.length} | ${r.warnings.length} | ${cell(r.symbols.slice(0, 4).map((x) => `${x.selector.replace(/^.*\[data-symbol=([a-z]+)\]$/, '$1')} ${x.mm} mm`).join(', ')) || '—'} | ${cell(mapCensus(r.map))} |`);
    lines.push('');
  }

  if (observation.phone) {
    const p = observation.phone;
    lines.push('## Phone and desktop', '');
    if (p.sada) lines.push(`- Sada: place ${quote(p.sada.place ?? '—')}, sentence ${quote(p.sada.sentence ?? '—', 90)}, departures ${p.sada.departures.inViewport} in the viewport of ${p.sada.departures.total}; landed ${p.landingMs ?? '?'} ms after the scan URL.`);
    if (p.share) lines.push(`- Share: ${p.share.code ? `a code ${p.share.afterMs} ms after the tap` : cell(p.share.detail ?? 'no code')}.`);
    if (p.karta) lines.push(`- Karta cold open: status ${p.karta.status ?? '—'}, first pill ${p.karta.pillsAfterMs === null ? 'none' : `${p.karta.pillsAfterMs} ms`} after ready (${p.karta.fleet ? `the twin: ${p.karta.fleet.pins} vehicle(s), ${p.karta.fleet.status ?? '?'}` : 'no zet-rt snapshot read'}), unlabelled ${p.karta.unlabelled ?? '—'}, markers ${p.karta.markers ?? '—'}, disclosures ${p.karta.disclosures}.`);
    if (p.stopBoard) lines.push(`- Stop board by search ("${p.stopBoard.query}"): ${p.stopBoard.error ? `stopped, ${cell(p.stopBoard.error)}` : `${p.stopBoard.open ? 'open' : 'not open'} after ${p.stopBoard.taps} taps, ${p.stopBoard.inViewport} of ${p.stopBoard.total} departures inside the viewport`}.`);
    if (p.expiry) lines.push(`- End of the session: ${p.expiry.seen ? `session-ended ${Math.round(p.expiry.afterRedemptionMs / 1000)} s after the redemption` : 'no session-ended'}, ${p.expiry.later.rows} content row(s), ${p.expiry.requestsAfter.length} /api/data request(s) after it.`);
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
    redemptions: { confirmed: [], failed: [], late: [] },
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
    capturesDir, captures: observation.captures, inventories: observation.inventories, recorders: [], fleets: new Map(), usedCodes: new Set(),
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
    observation.redemptions = { confirmed: ctx.budget.times(), failed: ctx.budget.failures(), late: ctx.budget.lates() };
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
