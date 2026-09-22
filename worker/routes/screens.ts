import type { RouteHandler } from '../index';
import { json } from '../http';
import { indexStub } from '../do/index-do';
import { accessPrincipal } from '../pairing/access';
import { isTestEnvironment } from '../config';
import type { Env } from '../env';
import { clientIp } from '../http';
import { addressPrefix } from '../pairing/netkey';
import { hexEncode, hmacSha256, requireSecret } from '../pairing/tokens';
import { provisionScreen } from '../pairing/provision';
import { parseFrame, parsePlaceInput, resolvePlace } from '../pairing/place';
import { screenStop } from '../pairing/stops';
import { areaName, CITY_AREA } from '../pairing/areas';
import { districtOf } from '../feed/geo/districts';
import { DEFAULT_FRAME_STOPS } from '../../shared/city/frame';
import { areaSlugOf } from './admin';
import { isSameOrigin, readCappedBody } from './pairing';
import { logError } from '../log';

export const TEMPORARY_SCREEN_MS = 24 * 60 * 60_000;
/** BeaconDO's operator-label bound (OPERATOR_LABEL_MAX there). */
const LABEL_MAX = 80;

/** The default operator label, shortened with an ellipsis when a long street name would pass the bound. */
function defaultLabel(name: string): string {
  const label = `Kaj ima? · ${name}`;
  if (label.length <= LABEL_MAX) return label;
  let cut = label.slice(0, LABEL_MAX - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

/**
 * The quota key for a caller without an Access identity: the network the request
 * comes from, at the same width the same-WiFi check uses (an IPv4 address, or the
 * first four hextets of an IPv6 one), keyed through the session secret so the
 * rolling-hour quota rows carry no address. Null only when Cloudflare reported no
 * client address, which a request through the edge never lacks.
 */
export async function networkPrincipal(env: Env, request: Request): Promise<string | null> {
  const prefix = addressPrefix(clientIp(request));
  if (!prefix) return null;
  return hexEncode(await hmacSha256(requireSecret(env, 'SESSION_SECRET'), `screen-network:${prefix}`));
}

export const handleScreens: RouteHandler = async (request, env, _ctx, url) => {
  if (url.pathname !== '/api/screens') return null;
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405, { allow: 'POST' });
  if (!isSameOrigin(request, url)) return json({ error: 'forbidden' }, 403);
  let reservation: string | undefined;
  try {
    let principal = await accessPrincipal(env, request);
    // The public quota path is identical locally: independent simulated
    // visitors must not collapse into one fixed test principal.
    if (!principal) principal = await networkPrincipal(env, request);
    // Local development exercises the same self-service path, without an Access
    // tenant or (in direct unit requests) a client address. This fallback never
    // confers administrative access or skips code redemption.
    if (!principal && isTestEnvironment(env)) {
      principal = hexEncode(await hmacSha256(requireSecret(env, 'SESSION_SECRET'), 'local-screen-evaluator'));
    }
    if (!principal) return json({ error: 'evaluation-access-required' }, 403);
    const raw = await readCappedBody(request, 512);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw ?? '') as Record<string, unknown>; } catch { return json({ error: 'bad-request' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'bad-request' }, 400);
    // An empty body is the ordinary way in (the field left empty): the whole
    // city, no stop, no place stored; the read path names Trg bana Jelačića
    // with placeSet false. `{ place, frame? }` is the one field "Adresa ili
    // stajalište" (place-v2): a stop by its id (name and point from the
    // server's own table) or an address point inside Zagreb; the area then
    // follows from the place. The legacy `{ area?, stopId? }` body stays
    // accepted. The screen's own settings panel changes all of it later over
    // the beacon socket ('screen-set').
    const hasPlace = body.place !== undefined && body.place !== null;
    const placeInput = hasPlace ? parsePlaceInput(body.place) : null;
    const place = placeInput ? resolvePlace(placeInput) : null;
    if (hasPlace && !place) return json({ error: 'bad-request', field: 'place' }, 400);
    // One way to say where the screen is: a place, or the legacy stop, never both.
    if (hasPlace && body.stopId !== undefined) return json({ error: 'bad-request', field: 'stopId' }, 400);
    const frame = body.frame === undefined ? DEFAULT_FRAME_STOPS : parseFrame(body.frame);
    if (frame === null) return json({ error: 'bad-request', field: 'frame' }, 400);
    const placeArea = place ? (districtOf(place.lon, place.lat) ?? CITY_AREA.slug) : CITY_AREA.slug;
    const area = areaSlugOf(body.area ?? placeArea);
    const stopId = place ? (place.stopId ?? null) : typeof body.stopId === 'string' ? body.stopId : null;
    const stop = stopId === null ? null : screenStop(stopId);
    if (!area || (stopId !== null && !stop)) return json({ error: 'bad-request', field: !area ? 'area' : 'stopId' }, 400);
    const label = typeof body.operatorLabel === 'string' ? body.operatorLabel.trim() : defaultLabel(place ? place.name : stop ? stop.name : areaName(area));
    if (!label || label.length > 80) return json({ error: 'bad-request', field: 'operatorLabel' }, 400);
    const quota = await indexStub(env).reserveScreen(principal);
    if (!quota.allowed) return json({ error: 'screen-limit', retryAfter: quota.retryAfter }, 429, { 'retry-after': String(quota.retryAfter) });
    reservation = quota.reservation;
    const result = await provisionScreen(env, {
      venueType: 'ostalo', area, operatorLabel: label, stopId,
      kind: 'temporary', expiresAt: Date.now() + TEMPORARY_SCREEN_MS,
      // Without a place the stop (if any) is the place, derived in provisionScreen.
      ...(place ? { place } : {}), frame,
    }, url.origin);
    return json(result, 201, { 'cache-control': 'no-store' });
  } catch (error) {
    if (reservation) await indexStub(env).releaseScreen(reservation).catch(() => {});
    logError('screen-create-failed', error);
    return json({ error: 'screen-create-failed' }, 503, { 'cache-control': 'no-store' });
  }
};
