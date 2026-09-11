// worker/routes/admin.ts
// Screen provisioning behind Cloudflare Access. The secret is generated here
// and shown once in the response; BeaconDO stores it as-is and uses it
// directly as the kiosk challenge's HMAC key (rulings.md R-32 — no hashing of
// the secret before use, so both sides key the HMAC identically). Every
// unauthorised request — and every unexpected error — is the same 404.
import { beaconStub, BEACON_ID_SHAPE, type BeaconCreateInput } from '../do/beacon-do';
import { indexStub } from '../do/index-do';
import type { Env } from '../env';
import { json } from '../http';
import type { RouteHandler } from '../index';
import { logError, logInfo } from '../log';
import { verifyAccess } from '../pairing/access';
import { AREAS, isVenueType, type AreaSlug } from '../pairing/areas';
import { randomId } from '../pairing/tokens';
import type { CreateBeaconRequest, CreateBeaconResponse } from '../protocol';
import { readCappedBody } from './pairing';

/** The kiosk URL is minted for production; e2e rebases the fragment onto its own origin. */
export const PROVISION_ORIGIN = 'https://zagreb.aningfilm.hr';
export const ADMIN_BODY_MAX_BYTES = 512;
export const OPERATOR_LABEL_MAX = 80;
/** randomId packs five bits per character: 5 bytes -> 8 characters = BEACON_ID_LENGTH. */
const BEACON_ID_BYTES = 5;
/** 20 bytes -> 32 characters of Crockford base32. */
const SECRET_BYTES = 20;
const CREATE_ATTEMPTS = 5;
/** The shape BeaconDO.create enforces; checked here so a typo is a 400, not a thrown RPC. */
const STOP_ID_SHAPE = /^[0-9A-Za-z_-]{1,32}$/;

/** Accepts a slug, the written name in any case, and either dash. */
export function areaSlugOf(value: unknown): AreaSlug | null {
  if (typeof value !== 'string') return null;
  const key = value
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return AREAS.find((area) => area.slug === key)?.slug ?? null;
}

function notFound(): Response {
  // Byte-identical to the dispatcher's answer, on purpose.
  return json({ error: 'not-found' }, 404);
}

function badRequest(field: string): Response {
  return json({ error: 'bad-request', field }, 400);
}

async function createBeacon(request: Request, env: Env): Promise<Response> {
  const raw = await readCappedBody(request, ADMIN_BODY_MAX_BYTES);
  if (raw === null) return badRequest('body');
  let body: Partial<CreateBeaconRequest>;
  try {
    body = JSON.parse(raw) as Partial<CreateBeaconRequest>;
  } catch {
    return badRequest('body');
  }
  const venueType = body.venueType;
  if (!isVenueType(venueType)) return badRequest('venueType');
  const area = areaSlugOf(body.area);
  if (area === null) return badRequest('area');
  const operatorLabel = typeof body.operatorLabel === 'string' ? body.operatorLabel.trim() : '';
  if (operatorLabel.length === 0 || operatorLabel.length > OPERATOR_LABEL_MAX) return badRequest('operatorLabel');
  const stopId = body.stopId === undefined || body.stopId === '' ? null : String(body.stopId);
  if (stopId !== null && !STOP_ID_SHAPE.test(stopId)) return badRequest('stopId');

  const secret = randomId(SECRET_BYTES);
  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
    const beaconId = randomId(BEACON_ID_BYTES);
    const input: BeaconCreateInput = { beaconId, venueType, area, operatorLabel, stopId, secret };
    const { created } = await beaconStub(env, beaconId).create(input);
    if (!created) continue; // id already taken: draw another one
    await indexStub(env).registerBeacon({ beaconId, venueType, area, operatorLabel, stopId, createdAt: Date.now() });
    logInfo('beacon-created', { beaconId, venueType, area });
    const response: CreateBeaconResponse = {
      beaconId,
      secret,
      provisionUrl: `${PROVISION_ORIGIN}/kiosk#${beaconId}.${secret}`,
    };
    return json(response, 201);
  }
  logError('beacon-id-collision', new Error('five ids taken in a row'));
  return json({ error: 'internal' }, 500);
}

async function revokeBeacon(env: Env, beaconId: string): Promise<Response> {
  if (!BEACON_ID_SHAPE.test(beaconId)) return notFound();
  const stub = beaconStub(env, beaconId);
  if (!(await stub.status()).exists) return notFound();
  await stub.revoke();
  await indexStub(env).markBeaconRevoked(beaconId, Date.now());
  logInfo('beacon-revoked', { beaconId });
  return json({ beaconId, revoked: true }, 200);
}

async function listBeacons(env: Env): Promise<Response> {
  return json({ beacons: await indexStub(env).listBeacons() }, 200);
}

const REVOKE_PATH = /^\/api\/admin\/beacons\/([^/]+)\/revoke$/;

export const handleAdmin: RouteHandler = async (request, env, _ctx, url) => {
  if (url.pathname !== '/api/admin' && !url.pathname.startsWith('/api/admin/')) return null;
  try {
    // The gate comes before the path, so an unauthenticated caller learns nothing about the routes.
    if (!(await verifyAccess(env, request))) return notFound();
    if (url.pathname === '/api/admin/beacons') {
      if (request.method === 'POST') return await createBeacon(request, env);
      if (request.method === 'GET') return await listBeacons(env);
      return json({ error: 'method-not-allowed' }, 405, { allow: 'GET, POST' });
    }
    const revoke = REVOKE_PATH.exec(url.pathname);
    if (revoke !== null) {
      if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405, { allow: 'POST' });
      return await revokeBeacon(env, revoke[1]!);
    }
    return notFound();
  } catch (error) {
    logError('admin-route-failed', error, { path: url.pathname });
    return notFound();
  }
};
