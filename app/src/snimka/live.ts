// The band "I danas" (plan v3, decision V3-25): the one live read of the page
// (decision S-10), a slim band after Što snimka pokazuje. When the band first
// comes into view it reads the application's public summary, fetch('/api/teaser')
// once per page view with a four-second limit, and says the city's state now
// in the words of the recording ("Sada, u 20:14: u pokretu 351 vozilo, po
// voznom redu 450. Uobičajena večer."), then the same minute of Monday 28
// September from the window series ("U ponedjeljak 28. 9. u 20:14: u pokretu
// 3."; "bez podatka" where the recording has no number, never 0). Nothing is
// counted or sent; the band and its links stand whether or not the read
// succeeds. This is the only file under app/src/snimka/ that may name
// /api/teaser (test/app/pages.test.ts).
//
// Numbers only for a judged state (normal, reduced, silent) with whole
// counts; every other answer (down, unconfirmed, unknown, loading, no
// service, a refused or malformed answer, a timeout) says the state is not
// available: never a number the summary did not give.
import { aboutExpected, resetServiceStateMemory, serviceNumbers, serviceStateOf } from '../../../shared/city/service-state';
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { escapeHtml } from '../ui/dom/escape';
import type { SeriesFile } from '../../../shared/snimka';
import type { SnimkaContext } from './context';
import { count, duration, num, parseZagrebLocal, zagrebClock, zagrebTimeOfDay } from './format';
import { SN, fill } from './strings';

export const TEASER_URL = '/api/teaser';
export const LIVE_TIMEOUT_MS = 4000;

export type LiveState = 'normal' | 'reduced' | 'silent';
export type LiveReading = { kind: 'numbers'; seen: number; expected: number; state: LiveState; ageS: number | null } | { kind: 'unavailable' };

const UNAVAILABLE: LiveReading = { kind: 'unavailable' };
const whole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isRec = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The summary's zet-rt module, or null when the answer is not a summary. */
function zetModule(json: unknown): ModuleSnapshot | null {
  if (!isRec(json) || !Array.isArray(json.modules)) return null;
  const found = json.modules.find((m): m is ModuleSnapshot => isRec(m) && m.module === 'zet-rt' && typeof m.status === 'string');
  return found ?? null;
}

/** What the card says for one answer of /api/teaser read at `nowMs` (epoch ms): pure, total. `expected` is already
 *  rounded the way every surface says it after "oko" (aboutExpected). */
export function readLive(json: unknown, nowMs: number): LiveReading {
  try {
    const snapshot = zetModule(json);
    if (!snapshot) return UNAVAILABLE;
    // The seam keeps a memory of an unconfirmed hold; one read per page view starts from none.
    resetServiceStateMemory();
    const { kind } = serviceStateOf(snapshot, nowMs);
    if (kind !== 'normal' && kind !== 'reduced' && kind !== 'silent') return UNAVAILABLE;
    let counts = serviceNumbers(snapshot);
    if (kind === 'normal') {
      // serviceNumbers speaks only while the city deviates; the card says the normal day's numbers on the same terms.
      const service = snapshot.sources?.zet?.service;
      counts = service && whole(service.seen) && whole(service.expected) && service.expected > 0 ? { seen: service.seen, expected: service.expected } : null;
    }
    if (!counts || !whole(counts.seen) || !whole(counts.expected)) return UNAVAILABLE;
    const iso = snapshot.sources?.zet?.sourceUpdatedAt ?? snapshot.sourceUpdatedAt;
    const at = typeof iso === 'string' ? Date.parse(iso) : Number.NaN;
    const ageS = Number.isFinite(at) ? Math.max(0, Math.round((nowMs - at) / 1000)) : null;
    return { kind: 'numbers', seen: counts.seen, expected: aboutExpected(counts.expected), state: kind, ageS };
  } catch {
    return UNAVAILABLE;
  }
}

/** The state sentence of a normal reading by the Zagreb daypart of `nowMs`. */
function normalSentence(nowMs: number): string {
  const h = Number(zagrebClock(nowMs).slice(0, 2));
  return h >= 5 && h < 10 ? SN.live.state.morning : h >= 10 && h < 18 ? SN.live.state.day : h >= 18 && h < 23 ? SN.live.state.evening : SN.live.state.night;
}

/** The sentences of a reading at `nowMs` (epoch ms): the numbers and, over five minutes, their age; or the one line
 *  that says the state is not available. */
export function liveLines(r: LiveReading, nowMs: number = Date.now()): string[] {
  if (r.kind === 'unavailable') return [SN.live.unavailable];
  const state = r.state === 'normal' ? normalSentence(nowMs) : SN.live.state[r.state];
  const now = fill(SN.live.now, { time: zagrebClock(nowMs), vehicles: count(r.seen, SN.live.vehicleForms), expected: num(r.expected), state });
  return r.ageS === null || r.ageS <= 300 ? [now] : [now, fill(SN.live.age, { age: duration(r.ageS * 1000) })];
}

/** Midnight of Monday 28 September in Zagreb (epoch ms): the first day of the strike, the band's "then". */
export const MONDAY_MS = parseZagrebLocal('2026-09-28T00:00')!;

/** "U ponedjeljak 28. 9. u {time}: u pokretu {n}." at the Zagreb time of day of `nowMs`, from the window series;
 *  "bez podatka" where the recording has no number for the minute (never 0). */
export function mondayLine(series: Pick<SeriesFile, 't0' | 'n' | 'seen'>, nowMs: number): string {
  const time = zagrebClock(nowMs);
  const atSec = (MONDAY_MS + zagrebTimeOfDay(nowMs)) / 1000;
  const m = Math.floor((atSec - series.t0) / 60);
  const seen = m >= 0 && m < series.n ? series.seen.all[m] : null;
  return typeof seen === 'number' ? fill(SN.live.then, { time, n: num(seen) }) : fill(SN.live.thenMissing, { time });
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
/** Calls `fn` once when `el` first comes into view; returns the teardown. */
export type Observe = (el: HTMLElement, fn: () => void) => () => void;

export interface LiveDeps { fetchImpl?: FetchLike; observe?: Observe; now?: () => number; timeoutMs?: number }

/** IntersectionObserver once; without one (an old engine, a test document) the read happens at once. */
export const observeOnce: Observe = (el, fn) => {
  const IO = (el.ownerDocument.defaultView as (Window & typeof globalThis) | null)?.IntersectionObserver;
  if (!IO) { fn(); return () => {}; }
  const io = new IO((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    fn();
  });
  io.observe(el);
  return () => io.disconnect();
};

function timeoutSignal(ms: number): { signal: AbortSignal; clear: () => void } {
  if (typeof AbortSignal.timeout === 'function') return { signal: AbortSignal.timeout(ms), clear: () => {} };
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, clear: () => clearTimeout(id) };
}

/** One read of the summary: the reading, or unavailable on any failure (status, body, timeout). */
export async function fetchLive(fetchImpl: FetchLike, now: () => number, timeoutMs = LIVE_TIMEOUT_MS): Promise<LiveReading> {
  const t = timeoutSignal(timeoutMs);
  try {
    const res = await fetchImpl(TEASER_URL, { signal: t.signal, headers: { accept: 'application/json' } });
    if (!res.ok) {
      await res.text().catch(() => '');
      return UNAVAILABLE;
    }
    return readLive(await res.json(), now());
  } catch {
    return UNAVAILABLE;
  } finally {
    t.clear();
  }
}

/** Draws the band into `root` and reads the summary once when it comes into view. `data-sn-live` is `pending`, then
 *  `numbers` or `unavailable`. */
export function mountLive(root: HTMLElement, ctx: Pick<SnimkaContext, 'series'>, deps: LiveDeps = {}): () => void {
  const doc = root.ownerDocument;
  const fetchImpl = deps.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const now = deps.now ?? (() => Date.now());
  const observe = deps.observe ?? observeOnce;
  let disposed = false;
  const L = SN.live;
  const band = doc.createElement('div');
  band.className = 'sn-live-band';
  band.innerHTML =
    `<p class="sn-live-head"><span class="sn-live-kicker">${escapeHtml(L.kicker)}</span> <span class="sn-live-lede">${escapeHtml(L.lede)}</span></p>` +
    '<div class="sn-live-lines">' +
    '<div class="sn-live-now" data-sn="live-now" aria-live="polite"><span class="skeleton sn-live-skeleton"></span></div>' +
    '<p class="sn-live-then" data-sn="live-then"></p>' +
    '</div>' +
    `<p class="sn-live-links"><a class="st-link sn-live-link" href="/">${escapeHtml(L.app)}</a> <a class="st-link sn-live-link" href="/statistika/">${escapeHtml(L.stats)}</a></p>`;
  root.replaceChildren(band);
  root.removeAttribute('aria-busy');
  root.dataset.snLive = 'pending';
  const out = band.querySelector<HTMLElement>('[data-sn="live-now"]')!;
  const then = band.querySelector<HTMLElement>('[data-sn="live-then"]')!;
  out.setAttribute('aria-busy', 'true');

  const stop = observe(root, () => {
    void fetchLive(fetchImpl, now, deps.timeoutMs).then((reading) => {
      if (disposed) return;
      const at = now();
      out.replaceChildren(...liveLines(reading, at).map((line, i) => {
        const p = doc.createElement('p');
        p.className = i === 0 ? 'sn-live-line' : 'sn-live-age';
        p.textContent = line;
        return p;
      }));
      out.removeAttribute('aria-busy');
      then.textContent = mondayLine(ctx.series, at);
      root.dataset.snLive = reading.kind;
    });
  });

  return () => {
    disposed = true;
    stop();
    delete root.dataset.snLive;
  };
}
