// The data-status recorder: console errors and warnings, page errors, failed
// requests, HTTP >= 400, and a summary of every data response the page reads
// (/api/teaser, /api/data, /api/city: module, status, fetch time, item counts;
// /api/scan and /api/screens bodies reduced to their key names, never the
// values). Ported from the walkthroughs of 21 September
// (review.local/companion/walkthroughs/1720-mon/lib.mjs attachRecorders,
// summariseBody, recorderReport) without their file writes: the caller decides
// where a record goes (onEvent), so the accept specs keep it in memory and the
// production observer appends it to review.local.
//
// Nothing secret is kept: a URL's fragment (the provisioning secret, a code) is
// cut to '#…' and a pairing or scan body is reduced to its keys.
import type { Page } from '@playwright/test';

/** Page access the recorders need; Playwright's Page satisfies it. */
export type RecorderPage = Pick<Page, 'on'>;

export interface ConsoleRecord { t: string; type: string; text: string; at?: string }
export interface PageErrorRecord { t: string; type: 'pageerror'; text: string }
export interface FailedRecord { t: string; url: string; method: string; error?: string; resourceType: string }
export interface HttpErrorRecord { t: string; path: string; status: number; method: string }
export interface DataRecord { t: string; page: string; path: string; status: number; method: string; summary?: unknown; bytes?: number; parseError?: string }
export type RecorderEvent =
  | { kind: 'console'; record: ConsoleRecord }
  | { kind: 'pageerror'; record: PageErrorRecord }
  | { kind: 'failed'; record: FailedRecord }
  | { kind: 'http-error'; record: HttpErrorRecord }
  | { kind: 'data'; record: DataRecord };

export interface RecorderOptions {
  /** Requests to leave out of failed / HTTP >= 400 / console errors: the accept specs answer map tiles with 404 by design. */
  ignore?: readonly RegExp[];
  /** Every record as it is made (the observer writes net/console jsonl from here). */
  onEvent?: (event: RecorderEvent) => void;
  /** The recorder's clock for `t`; real time by default. */
  now?: () => Date;
}

/** Map tiles answered 404 by the accept specs (e2e/round-f.spec.ts pattern): never a finding. */
export const TILE_REQUESTS = /\/maps\/zagreb-v1\//;

/** The browser's word for a fetch it cancelled itself: the page dropped what asked for it, no answer failed. */
export const ABORTED = 'net::ERR_ABORTED';
/** Static assets by path: MapLibre's sprite sheets and glyphs, images and fonts. Never an /api/ path (checked apart). */
export const STATIC_ASSET_PATH = /\/maps\/(?:sprites|fonts|glyphs)\/|\.(?:png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|pbf)(?:\?|$)/i;

export interface RecorderReport {
  page: string;
  dataResponses: number;
  failed: FailedRecord[];
  httpErrors: HttpErrorRecord[];
  consoleErrors: ConsoleRecord[];
  consoleWarnings: ConsoleRecord[];
  pageErrors: PageErrorRecord[];
  /** Each data module's last status (`zet-rt: live`), from /api/teaser, /api/data and /api/city answers. */
  moduleStatuses: Record<string, string>;
  /** POST /api/scan answers: code redemptions, each a real ten-minute session. */
  redemptions: number;
  /** POST /api/screens answers: a screen created (the observer must read 0). */
  screenCreations: number;
}

export interface Recorder {
  name: string;
  dataResponses: DataRecord[];
  failed: FailedRecord[];
  httpErrors: HttpErrorRecord[];
  consoleErrors: ConsoleRecord[];
  consoleWarnings: ConsoleRecord[];
  pageErrors: PageErrorRecord[];
  /** The last /api/teaser body as the page read it. */
  lastTeaser: unknown;
  /** The findings the accept specs assert empty: console errors, page errors, failed requests, HTTP >= 400. */
  problems(): string[];
  report(): RecorderReport;
}

interface ModuleLike { module?: unknown; status?: unknown; fetchedAt?: unknown; sourceUpdatedAt?: unknown; staleSince?: unknown; items?: unknown; coverage?: unknown }
export interface ModuleSummary { module: unknown; status: unknown; fetchedAt: unknown; sourceUpdatedAt: unknown; staleSince: unknown; itemCount: number; kinds: Record<string, number>; coverage: unknown }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function moduleSummary(m: unknown): ModuleSummary | unknown {
  if (!isObject(m)) return m;
  const mod = m as ModuleLike;
  const items = Array.isArray(mod.items) ? (mod.items as unknown[]) : [];
  const kinds: Record<string, number> = {};
  for (const it of items) {
    const kind = String(isObject(it) ? it.kind : undefined);
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
  return { module: mod.module, status: mod.status, fetchedAt: mod.fetchedAt, sourceUpdatedAt: mod.sourceUpdatedAt, staleSince: mod.staleSince, itemCount: items.length, kinds, coverage: mod.coverage };
}

function countArrays(o: unknown, depth = 0): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObject(o) || depth > 2) return out;
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v)) out[k] = v.length;
    else if (isObject(v)) for (const [k2, n] of Object.entries(countArrays(v, depth + 1))) out[`${k}.${k2}`] = n;
  }
  return out;
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const sources = (v: unknown, keys: readonly string[]): Record<string, unknown>[] => list(v).map((s) => Object.fromEntries(keys.map((k) => [k, isObject(s) ? s[k] : undefined])));

/** A data response body reduced to what a report needs; pairing and scan bodies to their key names. */
export function summariseBody(path: string, body: unknown): Record<string, unknown> {
  const b = isObject(body) ? body : {};
  if (path.startsWith('/api/scan') || path.startsWith('/api/screens')) return { keys: Object.keys(b) };
  if (path.startsWith('/api/teaser')) return { generatedAt: b.generatedAt, modules: list(b.modules).map(moduleSummary) };
  if (path.startsWith('/api/data/')) return { module: moduleSummary(body) };
  if (path === '/api/data') return { modules: (Array.isArray(b.modules) ? b.modules : Object.values(b)).map(moduleSummary) };
  if (path.startsWith('/api/city/manifest')) return { schema: b.schema, generatedAt: b.generatedAt, sources: sources(b.sources, ['id', 'status', 'count', 'fetchedAt', 'updatedAt', 'limited']), parts: list(b.parts ?? b.chunks).length };
  if (path.startsWith('/api/city/')) return { keys: Object.keys(b), counts: countArrays(b), status: b.status, fetchedAt: b.fetchedAt ?? b.generatedAt ?? b.updatedAt, sources: Array.isArray(b.sources) ? sources(b.sources, ['id', 'status', 'count', 'fetchedAt']) : undefined };
  return { keys: Object.keys(b) };
}

/** The path and query of a URL, the fragment cut (it can carry a secret). */
export function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url.replace(/#.*$/, '');
  }
}

const DATA_PATHS = /^\/api\/(data\/|data$|teaser|city\/|scan|screens)/;

function moduleStatusesOf(records: readonly DataRecord[]): Record<string, string> {
  const out: Record<string, string> = {};
  const note = (m: unknown): void => {
    if (isObject(m) && typeof m.module === 'string' && typeof m.status === 'string') out[m.module] = m.status;
  };
  for (const r of records) {
    const s = isObject(r.summary) ? r.summary : {};
    for (const m of list(s.modules)) note(m);
    note(s.module);
    if (r.path.startsWith('/api/city/') && typeof s.status === 'string') out[r.path.replace(/\?.*$/, '').replace(/\/[0-9a-f]{64}\.json$/, '/<hash>.json')] = s.status;
  }
  return out;
}

/** The findings, with the failed requests given (all of them for `problems()`). */
function problemLines(rec: Recorder, failed: readonly FailedRecord[]): string[] {
  return [
    ...rec.consoleErrors.map((r) => `console error: ${r.text}`),
    ...rec.pageErrors.map((r) => `page error: ${r.text}`),
    ...failed.map((r) => `failed request: ${r.method} ${r.url} (${r.error ?? 'no reason'})`),
    ...rec.httpErrors.map((r) => `HTTP ${r.status}: ${r.method} ${r.path}`),
  ];
}

/** A static asset (sprite, image, font) the browser cancelled at or after `since` (an ISO time on the recorder's clock), outside /api/. */
export function isTeardownAbort(record: FailedRecord, since: string): boolean {
  const path = pathOf(record.url);
  return record.error === ABORTED && record.t >= since && !path.startsWith('/api/') && STATIC_ASSET_PATH.test(path);
}

/**
 * `problems()` across a teardown the page makes on purpose (the end of a session removes the Sada band, and the
 * browser cancels the band's sprite fetches in the same millisecond): the static assets cancelled from `since` on
 * are listed in `tolerated`, not counted. Every /api/ request, an abort before `since`, an asset that failed for
 * another reason, an HTTP error, a console or page error stays a finding.
 */
export function problemsAfterTeardown(rec: Recorder, since: string): { problems: string[]; tolerated: FailedRecord[] } {
  const tolerated = rec.failed.filter((r) => isTeardownAbort(r, since));
  return { problems: problemLines(rec, rec.failed.filter((r) => !tolerated.includes(r))), tolerated };
}

/** Attach the recorders to a page before it navigates; read them with `problems()` or `report()`. */
export function attachRecorders(page: RecorderPage, name: string, options: RecorderOptions = {}): Recorder {
  const ignore = options.ignore ?? [];
  const now = options.now ?? (() => new Date());
  const t = (): string => now().toISOString();
  const ignored = (url: string | undefined): boolean => Boolean(url) && ignore.some((re) => re.test(url!));
  const emit = options.onEvent ?? (() => {});
  const rec: Recorder = {
    name,
    dataResponses: [],
    failed: [],
    httpErrors: [],
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    lastTeaser: null,
    problems() {
      return problemLines(rec, rec.failed);
    },
    report() {
      return {
        page: name,
        dataResponses: rec.dataResponses.length,
        failed: rec.failed,
        httpErrors: rec.httpErrors,
        consoleErrors: rec.consoleErrors,
        consoleWarnings: rec.consoleWarnings.slice(0, 20),
        pageErrors: rec.pageErrors,
        moduleStatuses: moduleStatusesOf(rec.dataResponses),
        redemptions: rec.dataResponses.filter((r) => r.method === 'POST' && r.path.startsWith('/api/scan')).length,
        screenCreations: rec.dataResponses.filter((r) => r.method === 'POST' && r.path.startsWith('/api/screens')).length,
      };
    },
  };

  page.on('console', (msg) => {
    const type = msg.type();
    if (type !== 'error' && type !== 'warning') return;
    const at = msg.location()?.url;
    if (ignored(at)) return;
    const record: ConsoleRecord = { t: t(), type, text: msg.text().slice(0, 600), at: at ? pathOf(at).slice(0, 200) : undefined };
    (type === 'error' ? rec.consoleErrors : rec.consoleWarnings).push(record);
    emit({ kind: 'console', record });
  });
  page.on('pageerror', (err) => {
    const record: PageErrorRecord = { t: t(), type: 'pageerror', text: String(err).slice(0, 600) };
    rec.pageErrors.push(record);
    emit({ kind: 'pageerror', record });
  });
  page.on('requestfailed', (req) => {
    if (ignored(req.url())) return;
    const record: FailedRecord = { t: t(), url: req.url().replace(/#.*$/, '#…'), method: req.method(), error: req.failure()?.errorText, resourceType: req.resourceType() };
    rec.failed.push(record);
    emit({ kind: 'failed', record });
  });
  page.on('response', async (res) => {
    const url = res.url();
    const status = res.status();
    const path = pathOf(url);
    const method = res.request().method();
    if (status >= 400 && !ignored(url)) {
      const record: HttpErrorRecord = { t: t(), path, status, method };
      rec.httpErrors.push(record);
      emit({ kind: 'http-error', record });
    }
    if (!DATA_PATHS.test(path)) return;
    const record: DataRecord = { t: t(), page: name, path: path.slice(0, 160), status, method };
    try {
      const type = res.headers()['content-type'] ?? '';
      if (type.includes('json') && !path.includes('/api/city/chunks/')) {
        const body: unknown = await res.json();
        record.summary = summariseBody(path, body);
        if (path.startsWith('/api/teaser')) rec.lastTeaser = body;
      } else {
        const buf = await res.body().catch(() => null);
        record.bytes = buf?.length;
      }
    } catch (e) {
      record.parseError = String(e).slice(0, 160);
    }
    rec.dataResponses.push(record);
    emit({ kind: 'data', record });
  });
  return rec;
}
