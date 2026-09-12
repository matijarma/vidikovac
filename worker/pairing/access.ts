// worker/pairing/access.ts
// Two gates, both required. In production Cloudflare Access sits in front of
// /api/admin/* and /stats and injects a signed Cf-Access-Jwt-Assertion on every
// request it lets through; this module re-verifies that JWT in full, signature
// included, so the surface stays closed even if the Access application is
// deleted, misconfigured or bypassed by a direct route. Every failure is a
// plain false and the caller answers the same 404: an unauthenticated caller
// cannot even learn the route exists.
// Ported from D:\scratch\psdlat\worker\src\stats.ts (AGPL-3.0-or-later).
import { isTestEnvironment } from '../config';
import type { Env } from '../env';
import { constantTimeEqual, hexEncode, hmacSha256, requireSecret, utf8 } from './tokens';

export interface JwksDocument {
  keys?: Array<JsonWebKey & { kid?: string }>;
}

/** Injectable seam: verifying a real signature means controlling which key the verifier trusts, and tests have no network. */
export interface AccessDeps {
  fetchJwks?: (url: string) => Promise<JwksDocument>;
}

const ACCESS_JWT_HEADER = 'Cf-Access-Jwt-Assertion';
const ACCESS_COOKIE = 'CF_Authorization';
const BYPASS_HEADER = 'x-e2e-admin-bypass';
/** Shorter than this is not a token, whatever the variable says. */
const BYPASS_MIN_LENGTH = 32;
/** Access tokens live for hours; a minute of drift changes nothing real. */
const CLOCK_SKEW_SECONDS = 60;
/** Access rotates signing keys about every six weeks. */
const JWKS_TTL_MS = 60 * 60 * 1000;
/** A kid missing from a fresh-enough document is answered from memory, so a forged token cannot turn each probe into an upstream fetch. */
const JWKS_MISS_REFETCH_MS = 5 * 60 * 1000;
const JWKS_FAILURE_COOLDOWN_MS = 60 * 1000;

interface JwksKeyset {
  readonly keysByKid: ReadonlyMap<string, CryptoKey>;
  readonly fetchedAtMs: number;
}

const jwksKeysetCache = new Map<string, JwksKeyset>();
/** Concurrent verifications share one in-flight fetch per team. */
const jwksInFlight = new Map<string, Promise<JwksKeyset | null>>();
let jwksFailureCooldownUntilMs = 0;

// base64url is local on purpose: this module is a security boundary, and its
// decode path should be readable here rather than drift under a shared helper.
function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlToJson(value: string): unknown {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

// Matches the project-wide upstream-fetch convention (global-constraints.md:
// identified User-Agent, 6 s ceiling) already established by worker/feed/http.ts's
// upstreamFetch. Kept local rather than imported: this module owns its own
// security-relevant fetch, and a hanging Access certs endpoint must never stall
// an /api/admin/* or /stats request past that ceiling.
const JWKS_FETCH_USER_AGENT = 'Vidikovac/0.1 (zagreb.aningfilm.hr; kontakt@aningfilm.hr)';
const JWKS_FETCH_TIMEOUT_MS = 6000;

async function defaultFetchJwks(url: string): Promise<JwksDocument> {
  const response = await fetch(url, {
    headers: { 'user-agent': JWKS_FETCH_USER_AGENT },
    signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`jwks-fetch-failed: ${response.status}`);
  return (await response.json()) as JwksDocument;
}

function fetchKeyset(teamDomain: string, fetchJwks: (url: string) => Promise<JwksDocument>): Promise<JwksKeyset | null> {
  const inFlight = jwksInFlight.get(teamDomain);
  if (inFlight !== undefined) return inFlight;
  const load = (async (): Promise<JwksKeyset | null> => {
    try {
      const document = await fetchJwks(`https://${teamDomain}/cdn-cgi/access/certs`);
      const keysByKid = new Map<string, CryptoKey>();
      for (const jwk of document.keys ?? []) {
        if (typeof jwk.kid !== 'string' || jwk.kid.length === 0 || jwk.kty !== 'RSA') continue;
        keysByKid.set(
          jwk.kid,
          await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']),
        );
      }
      const keyset: JwksKeyset = { keysByKid, fetchedAtMs: Date.now() };
      jwksKeysetCache.set(teamDomain, keyset);
      return keyset;
    } catch {
      jwksFailureCooldownUntilMs = Date.now() + JWKS_FAILURE_COOLDOWN_MS;
      return null;
    } finally {
      jwksInFlight.delete(teamDomain);
    }
  })();
  jwksInFlight.set(teamDomain, load);
  return load;
}

async function verifyKeyForKid(
  teamDomain: string,
  kid: string,
  fetchJwks: (url: string) => Promise<JwksDocument>,
): Promise<CryptoKey | null> {
  const nowMs = Date.now();
  const cached = jwksKeysetCache.get(teamDomain);
  if (cached !== undefined) {
    const age = nowMs - cached.fetchedAtMs;
    const key = cached.keysByKid.get(kid);
    if (key !== undefined && age < JWKS_TTL_MS) return key;
    if (key === undefined && age < JWKS_MISS_REFETCH_MS) return null;
  }
  if (nowMs < jwksFailureCooldownUntilMs) {
    // During the back-off a stale hit still verifies; anything else stays a miss.
    return cached?.keysByKid.get(kid) ?? null;
  }
  const keyset = await fetchKeyset(teamDomain, fetchJwks);
  return (keyset ?? cached)?.keysByKid.get(kid) ?? null;
}

function tokenFromRequest(request: Request): string | null {
  const header = request.headers.get(ACCESS_JWT_HEADER);
  if (header !== null && header.length > 0) return header;
  const cookie = request.headers.get('Cookie');
  if (cookie === null) return null;
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== ACCESS_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

/**
 * Explicit test environment only. No pairing setting can enable this bypass.
 */
function bypassAccepted(env: Env, request: Request): boolean {
  if (!isTestEnvironment(env)) return false;
  const expected = env.E2E_ADMIN_BYPASS;
  if (typeof expected !== 'string' || expected.length < BYPASS_MIN_LENGTH) return false;
  const offered = request.headers.get(BYPASS_HEADER);
  if (offered === null) return false;
  return constantTimeEqual(utf8(offered), utf8(expected));
}

/**
 * True only for a request Cloudflare Access signed for this application, or
 * one carrying the test bypass while APP_ENV=test. Never throws.
 */
export async function verifyAccess(env: Env, request: Request, deps: AccessDeps = {}): Promise<boolean> {
  if (bypassAccepted(env, request)) return true;
  try {
    const teamVar = env.CF_ACCESS_TEAM_DOMAIN;
    const expectedAud = env.CF_ACCESS_AUD;
    if (!teamVar || !expectedAud) return false;
    // Tolerate the var pasted with or without the scheme; the issuer comparison below is exact either way.
    const teamDomain = teamVar.replace(/^https:\/\//, '').replace(/\/+$/, '');

    const token = tokenFromRequest(request);
    if (token === null || token.length > 16_384) return false;
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

    const header = base64UrlToJson(headerB64) as { alg?: unknown; kid?: unknown };
    // alg is pinned, not read: accepting whatever the token names is the classic JWT downgrade.
    if (header.alg !== 'RS256') return false;
    if (typeof header.kid !== 'string' || header.kid.length === 0) return false;

    const payload = base64UrlToJson(payloadB64) as { iss?: unknown; aud?: unknown; exp?: unknown; nbf?: unknown };
    if (payload.iss !== `https://${teamDomain}`) return false;
    const audOk = Array.isArray(payload.aud) ? payload.aud.includes(expectedAud) : payload.aud === expectedAud;
    if (!audOk) return false;
    const nowSeconds = Date.now() / 1000;
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || nowSeconds > payload.exp + CLOCK_SKEW_SECONDS) return false;
    if (payload.nbf !== undefined) {
      if (typeof payload.nbf !== 'number' || nowSeconds < payload.nbf - CLOCK_SKEW_SECONDS) return false;
    }

    const key = await verifyKeyForKid(teamDomain, header.kid, deps.fetchJwks ?? defaultFetchJwks);
    if (key === null) return false;
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlToBytes(signatureB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`),
    );
  } catch {
    return false;
  }
}

/** Hour-scoped pseudonymous quota key. No email/sub/token is persisted or logged. */
export async function accessPrincipal(
  env: Env,
  request: Request,
  deps: AccessDeps = {},
  now = Date.now(),
): Promise<string | null> {
  if (!(await verifyAccess(env, request, deps))) return null;
  let identity = 'test-evaluator';
  if (!bypassAccepted(env, request)) {
    const token = tokenFromRequest(request);
    if (!token) return null;
    const claims = base64UrlToJson(token.split('.')[1]!) as Record<string, unknown>;
    const subject = claims.sub || claims.email || claims.common_name;
    if (typeof subject !== 'string' || subject.length === 0 || subject.length > 1024) return null;
    identity = subject;
  }
  return hexEncode(await hmacSha256(requireSecret(env, 'SESSION_SECRET'), `screen-quota|${Math.floor(now / 3_600_000)}|${identity}`));
}
