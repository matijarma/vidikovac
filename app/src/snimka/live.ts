// The card "I danas": the one live read of the page (decision S-10). When
// the card first comes into view it reads the application's public summary,
// fetch('/api/teaser') once per page view with a four-second limit, and says
// the city's state now in the same words the recording used, labelled "uživo,
// nije snimka". Nothing is counted or sent; the card, its links and its
// method line stand whether or not the read succeeds. This is the only file
// under app/src/snimka/ that may name /api/teaser (test/app/pages.test.ts).
//
// Numbers only for a judged state (normal, reduced, silent) with whole
// counts; every other answer (down, unconfirmed, unknown, loading, no
// service, a refused or malformed answer, a timeout) says the state is not
// available: never a number the summary did not give.
import { aboutExpected, resetServiceStateMemory, serviceNumbers, serviceStateOf } from '../../../shared/city/service-state';
import type { ModuleSnapshot } from '../../../worker/feed/schema';
import { escapeHtml } from '../ui/dom/escape';
import { duration, num } from './format';
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

/** The sentences of a reading: the numbers and their age, or the one line that says the state is not available. */
export function liveLines(r: LiveReading): string[] {
  if (r.kind === 'unavailable') return [SN.live.unavailable];
  const state = SN.badge[r.state].toLocaleLowerCase('hr');
  const now = fill(SN.live.now, { seen: num(r.seen), expected: num(r.expected), state });
  return r.ageS === null ? [now] : [now, fill(SN.live.age, { age: duration(r.ageS * 1000) })];
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

/** Draws the card into `root` and reads the summary once when it comes into view. `data-sn-live` is `pending`, then
 *  `numbers` or `unavailable`. */
export function mountLive(root: HTMLElement, deps: LiveDeps = {}): () => void {
  const doc = root.ownerDocument;
  const fetchImpl = deps.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const now = deps.now ?? (() => Date.now());
  const observe = deps.observe ?? observeOnce;
  let disposed = false;
  const L = SN.live;
  const card = doc.createElement('article');
  card.className = 'sn-live-card';
  card.setAttribute('aria-labelledby', 'sn-live-h');
  card.innerHTML =
    `<p class="sn-live-kicker">${escapeHtml(L.kicker)}</p>` +
    `<h3 id="sn-live-h" class="sn-live-title">${escapeHtml(L.title)}</h3>` +
    `<p class="sn-live-lede">${escapeHtml(L.lede)}</p>` +
    '<div class="sn-live-now" data-sn="live-now" aria-live="polite"><span class="skeleton sn-live-skeleton"></span></div>' +
    `<p class="sn-live-links"><a class="btn btn-ghost sn-live-link" href="/">${escapeHtml(L.app)}</a> <a class="btn btn-ghost sn-live-link" href="/statistika/">${escapeHtml(L.stats)}</a></p>` +
    `<p class="st-method sn-live-method">${escapeHtml(L.method)}</p>`;
  root.replaceChildren(card);
  root.removeAttribute('aria-busy');
  root.dataset.snLive = 'pending';
  const out = card.querySelector<HTMLElement>('[data-sn="live-now"]')!;
  out.setAttribute('aria-busy', 'true');

  const stop = observe(root, () => {
    void fetchLive(fetchImpl, now, deps.timeoutMs).then((reading) => {
      if (disposed) return;
      out.replaceChildren(...liveLines(reading).map((line, i) => {
        const p = doc.createElement('p');
        p.className = i === 0 ? 'sn-live-line' : 'sn-live-age';
        p.textContent = line;
        return p;
      }));
      out.removeAttribute('aria-busy');
      root.dataset.snLive = reading.kind;
    });
  });

  return () => {
    disposed = true;
    stop();
    delete root.dataset.snLive;
  };
}
