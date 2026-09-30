// DEV mode (owner, 30 Sep 2026): the product without pairing, for the people who build and review
// it. Nothing links to it and nothing documents it; it is not hidden either, and this comment is
// its description.
//
//   The flag     `?DEV` (or `&DEV`, `?DEV=1`) on /kiosk/, /d/, /s/ or /hitno, remembered for the tab
//                (app/src/core/dev-mode.ts); /dev/ turns it on by itself. A chip at the top of the
//                page says DEV, opens a menu of the surfaces, and its × turns DEV off again.
//   The wall     /kiosk/?DEV runs on a DEV screen: POST /api/dev/screen answers with this network's
//                DEV screen for the Zagreb day, created on the first call and the same on every
//                later one (its id and secret are derived from the network and the day, so the
//                answer needs no table). Default place, 24 hours like any temporary screen, outside
//                the five-per-hour screen quota and never in the operator's screen registry. Its
//                QR carries ?DEV. Any number of tabs may show it at once.
//   The phone    /d/?DEV with no live session asks POST /api/dev/session, which opens an ordinary
//                room on that DEV screen without a code: a day long, renewed on every join and
//                resume and while a socket holds it (worker/do/room-do.ts), so the session-end card
//                never shows. It can do what a scanned session can (steer the wall, share) and
//                nothing more: no operator or admin path knows it.
//   The grid     /dev/ (app/dev/index.html) frames the wall, the phone, the desk and /hitno side by
//                side; those four pages allow their own origin as a frame ancestor (below, and
//                worker/security-headers.ts HITNO_SECURITY_HEADERS).
//   The counts   A DEV screen and every session on it count nothing (worker/metrics.ts metricScope):
//                no kiosk_online, session_start, session_end, scan_fail, panel_open, export or
//                hitno_view reaches MetricsDO, so /statistika/ and grad.csv describe real use only.
//   Unchanged    The Worker's own rate limits (RL_OPEN answers these two routes too), the CSP, the
//                pairing of every screen that is not a DEV screen.
import { DEFAULT_FRAME_STOPS } from '../../shared/city/frame';
import { beaconStub } from '../do/beacon-do';
import type { Env } from '../env';
import { json } from '../http';
import type { RouteHandler } from '../index';
import { logError } from '../log';
import { openRateLimited } from '../open/http';
import { zagrebDay } from '../open/time';
import { areaName, CITY_AREA } from '../pairing/areas';
import { crockford, hexEncode, hmacSha256, requireSecret } from '../pairing/tokens';
import { isTestEnvironment } from '../config';
import type { CreateBeaconResponse } from '../protocol';
import { isSameOrigin } from './pairing';
import { defaultLabel, networkPrincipal, TEMPORARY_SCREEN_MS } from './screens';
import { allowSameOriginFrame } from './statistika';

export const DEV_SCREEN_PATH = '/api/dev/screen';
export const DEV_SESSION_PATH = '/api/dev/session';
/** The static pages the /dev/ grid frames, as the asset store serves them (/hitno is worker/routes/open.ts's). */
export const FRAMED_PAGES: ReadonlySet<string> = new Set(['/kiosk', '/kiosk/', '/d', '/d/', '/s', '/s/']);

/** Whose DEV screen: the network's key, the one the screen quota uses (routes/screens.ts); a fixed one in local tests without an address. */
async function devPrincipal(env: Env, request: Request): Promise<string | null> {
  const principal = await networkPrincipal(env, request);
  if (principal || !isTestEnvironment(env)) return principal;
  return hexEncode(await hmacSha256(requireSecret(env, 'SESSION_SECRET'), 'local-dev-screen'));
}

/** The DEV screen's id and secret for a network and a Zagreb day, keyed through the session secret. */
export async function devCredentials(env: Env, principal: string, day: string): Promise<{ beaconId: string; secret: string }> {
  const key = requireSecret(env, 'SESSION_SECRET');
  const [id, secret] = await Promise.all([
    hmacSha256(key, `dev-screen-id:${principal}:${day}`),
    hmacSha256(key, `dev-screen-secret:${principal}:${day}`),
  ]);
  return { beaconId: crockford(id.slice(0, 5)), secret: crockford(secret.slice(0, 20)) };
}

/**
 * The network's DEV screen for today: created by the first call (the whole city, Kadar's default,
 * the ordinary label), the same answer on every later one. Never registered with IndexDO, so the
 * operator's list, its counts and the creation quota never see it. A screen of that id that is
 * not a DEV screen is refused, however unlikely a 40-bit collision is.
 */
export async function devScreen(env: Env, principal: string, now: number, origin: string): Promise<CreateBeaconResponse> {
  const { beaconId, secret } = await devCredentials(env, principal, zagrebDay(new Date(now)));
  const stub = beaconStub(env, beaconId);
  await stub.create({
    beaconId, secret, venueType: 'ostalo', area: CITY_AREA.slug, operatorLabel: defaultLabel(areaName(CITY_AREA.slug)),
    stopId: null, kind: 'temporary', screenExpiresAt: now + TEMPORARY_SCREEN_MS, place: null, frame: DEFAULT_FRAME_STOPS, dev: true,
  });
  const screen = await stub.screenMetadata();
  if (screen.dev !== true) throw new Error('dev-screen-collision');
  return { beaconId, secret, provisionUrl: `${origin}/kiosk/?DEV#${beaconId}.${secret}`, screen };
}

export const handleDev: RouteHandler = async (request, env, _ctx, url) => {
  if (FRAMED_PAGES.has(url.pathname)) {
    const response = await env.ASSETS.fetch(request);
    return (response.headers.get('content-type') ?? '').startsWith('text/html') ? allowSameOriginFrame(response) : response;
  }
  if (url.pathname !== DEV_SCREEN_PATH && url.pathname !== DEV_SESSION_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405, { allow: 'POST' });
  if (!isSameOrigin(request, url)) return json({ error: 'forbidden' }, 403);
  if (await openRateLimited(env, 'dev', request)) return json({ error: 'rate-limited' }, 429, { 'retry-after': '60' });
  try {
    const principal = await devPrincipal(env, request);
    if (!principal) return json({ error: 'forbidden' }, 403);
    const screen = await devScreen(env, principal, Date.now(), url.origin);
    if (url.pathname === DEV_SCREEN_PATH) return json(screen, 200);
    const result = await beaconStub(env, screen.beaconId).devSession();
    if (!result.ok) return json({ error: result.error }, 503);
    return json(result.scan, 201);
  } catch (error) {
    logError('dev-route-failed', error, { path: url.pathname });
    return json({ error: 'dev-unavailable' }, 503);
  }
};
