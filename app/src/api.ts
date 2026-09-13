// HTTP client for the three routes the browser calls. Typed against the shared
// contracts; `fetchImpl` is injectable so tests never touch the network.
import type { ModuleId, ModuleSnapshot } from '../../worker/feed/schema';
import type { DataToken, ScanFail, ScanOk, ScanRequest } from '../../worker/protocol';
import { normalizeCode } from './code';

export interface TeaserResponse { modules: ModuleSnapshot[] }

export class DataError extends Error {
  readonly status: number;
  constructor(status: number, message = `data request failed with ${status}`) {
    super(message);
    this.name = 'DataError';
    this.status = status;
  }
}

/** Bounds response-body reading too, without requiring AbortSignal.timeout. */
async function requestJson<T>(
  url: string, init: RequestInit, fetchImpl: typeof fetch,
): Promise<{ response: Response; body: T }> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new DataError(response.status);
    if (!(response.headers.get('content-type') ?? '').includes('application/json')) {
      throw new DataError(response.redirected ? 401 : 502, 'Expected data; the evaluation session may need to be reopened.');
    }
    const body = await response.json() as T;
    return { response, body };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function scan(code: string, fetchImpl: typeof fetch = fetch): Promise<ScanOk | ScanFail> {
  const body: ScanRequest = { code: normalizeCode(code) };
  let response: Response;
  try {
    response = await fetchImpl('/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    // Distinguished by the caller via the i18n key scan.errors.network; the
    // ScanError union has no network member, so bad-request carries it.
    return { error: 'bad-request', message: 'network' };
  }
  let parsed: unknown = null;
  try { parsed = await response.json(); } catch { parsed = null; }
  if (response.ok && parsed && typeof parsed === 'object' && 'roomId' in parsed) return parsed as ScanOk;
  if (parsed && typeof parsed === 'object' && 'error' in parsed) return parsed as ScanFail;
  return { error: response.status === 429 ? 'rate-limited' : 'bad-request', message: '' };
}

export async function fetchData(module: ModuleId, token: DataToken, fetchImpl: typeof fetch = fetch): Promise<ModuleSnapshot> {
  const { response, body } = await requestJson<ModuleSnapshot>(`/api/data/${module}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  }, fetchImpl);
  if (!response.ok) throw new DataError(response.status);
  return body;
}

export async function fetchTeaser(fetchImpl: typeof fetch = fetch, stopId?: string): Promise<TeaserResponse> {
  const path = stopId ? `/api/teaser?stop=${encodeURIComponent(stopId)}` : '/api/teaser';
  const { response, body } = await requestJson<TeaserResponse>(path, { cache: 'no-store' }, fetchImpl);
  if (!response.ok) throw new DataError(response.status);
  return body;
}
