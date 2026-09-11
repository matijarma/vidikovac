import { describe, expect, it } from 'vitest';
import type { Env } from '../../worker/env';
import { verifyAccess, type JwksDocument } from '../../worker/pairing/access';

const TEAM = 'vidikovac.cloudflareaccess.com';
const AUD = 'aud-0123456789abcdef';
const BYPASS = 'bypass-value-with-at-least-32-chars';

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function encodeJson(value: unknown): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

interface Signer {
  jwks: JwksDocument;
  sign(header: Record<string, unknown>, payload: Record<string, unknown>): Promise<string>;
}

async function makeSigner(kid: string): Promise<Signer> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey & { kid?: string };
  jwk.kid = kid;
  return {
    jwks: { keys: [jwk] },
    async sign(header, payload) {
      const input = `${encodeJson(header)}.${encodeJson(payload)}`;
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input));
      return `${input}.${base64url(new Uint8Array(signature))}`;
    },
  };
}

function accessEnv(overrides: Record<string, string | undefined> = {}): Env {
  return { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, NETWORK_CHECK: 'enforce', ...overrides } as unknown as Env;
}

function requestWith(headers: Record<string, string>): Request {
  return new Request('https://zagreb.aningfilm.hr/api/admin/beacons', { method: 'POST', headers });
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return { iss: `https://${TEAM}`, aud: AUD, exp: nowSeconds + 3600, nbf: nowSeconds - 10, email: 'operater@aningfilm.hr', ...overrides };
}

describe('verifyAccess with a real Access signature', () => {
  it('accepts a token the team signed, from the header and from the cookie', async () => {
    const signer = await makeSigner('k1');
    const deps = { fetchJwks: async (): Promise<JwksDocument> => signer.jwks };
    const token = await signer.sign({ alg: 'RS256', kid: 'k1' }, claims());
    expect(await verifyAccess(accessEnv(), requestWith({ 'Cf-Access-Jwt-Assertion': token }), deps)).toBe(true);
    expect(await verifyAccess(accessEnv(), requestWith({ Cookie: `other=1; CF_Authorization=${token}` }), deps)).toBe(true);
  });

  it('refuses a wrong audience, an expired token and a foreign issuer', async () => {
    const signer = await makeSigner('k1');
    const deps = { fetchJwks: async (): Promise<JwksDocument> => signer.jwks };
    const nowSeconds = Math.floor(Date.now() / 1000);
    const wrongAud = await signer.sign({ alg: 'RS256', kid: 'k1' }, claims({ aud: 'aud-nekog-drugog' }));
    const expired = await signer.sign({ alg: 'RS256', kid: 'k1' }, claims({ exp: nowSeconds - 120 }));
    const foreign = await signer.sign({ alg: 'RS256', kid: 'k1' }, claims({ iss: 'https://netko.cloudflareaccess.com' }));
    for (const token of [wrongAud, expired, foreign]) {
      expect(await verifyAccess(accessEnv(), requestWith({ 'Cf-Access-Jwt-Assertion': token }), deps)).toBe(false);
    }
  });

  it('pins RS256, refuses a tampered signature and an unknown kid', async () => {
    const signer = await makeSigner('k1');
    const deps = { fetchJwks: async (): Promise<JwksDocument> => signer.jwks };
    const good = await signer.sign({ alg: 'RS256', kid: 'k1' }, claims());
    const downgraded = `${encodeJson({ alg: 'HS256', kid: 'k1' })}.${encodeJson(claims())}.${good.split('.')[2]!}`;
    const tampered = `${good.slice(0, -4)}AAAA`;
    const unknownKid = await signer.sign({ alg: 'RS256', kid: 'k-nepoznat' }, claims());
    for (const token of [downgraded, tampered, unknownKid, 'nije.jwt']) {
      expect(await verifyAccess(accessEnv(), requestWith({ 'Cf-Access-Jwt-Assertion': token }), deps)).toBe(false);
    }
  });

  it('refuses when the token is missing or the vars are unset', async () => {
    const signer = await makeSigner('k1');
    const deps = { fetchJwks: async (): Promise<JwksDocument> => signer.jwks };
    const token = await signer.sign({ alg: 'RS256', kid: 'k1' }, claims());
    expect(await verifyAccess(accessEnv(), requestWith({}), deps)).toBe(false);
    expect(await verifyAccess(accessEnv({ CF_ACCESS_AUD: undefined }), requestWith({ 'Cf-Access-Jwt-Assertion': token }), deps)).toBe(false);
    expect(await verifyAccess(accessEnv({ CF_ACCESS_TEAM_DOMAIN: undefined }), requestWith({ 'Cf-Access-Jwt-Assertion': token }), deps)).toBe(false);
  });
});

describe('the test-only bypass (R-02)', () => {
  it('is accepted only with NETWORK_CHECK off, a long enough value and an exact match', async () => {
    const off = { NETWORK_CHECK: 'off', E2E_ADMIN_BYPASS: BYPASS };
    expect(await verifyAccess(accessEnv(off), requestWith({ 'x-e2e-admin-bypass': BYPASS }))).toBe(true);
    expect(await verifyAccess(accessEnv({ ...off, NETWORK_CHECK: 'enforce' }), requestWith({ 'x-e2e-admin-bypass': BYPASS }))).toBe(false);
    expect(await verifyAccess(accessEnv({ ...off, NETWORK_CHECK: 'warn' }), requestWith({ 'x-e2e-admin-bypass': BYPASS }))).toBe(false);
    expect(await verifyAccess(accessEnv(off), requestWith({ 'x-e2e-admin-bypass': `${BYPASS}x` }))).toBe(false);
    expect(await verifyAccess(accessEnv({ NETWORK_CHECK: 'off', E2E_ADMIN_BYPASS: 'prekratko' }), requestWith({ 'x-e2e-admin-bypass': 'prekratko' }))).toBe(false);
    expect(await verifyAccess(accessEnv({ NETWORK_CHECK: 'off' }), requestWith({ 'x-e2e-admin-bypass': BYPASS }))).toBe(false);
  });
});

// Last on purpose: a failed JWKS fetch arms a module-level 60 s back-off.
describe('a JWKS outage', () => {
  it('fails closed', async () => {
    const outageTeam = 'pad.cloudflareaccess.com';
    const signer = await makeSigner('k9');
    const token = await signer.sign({ alg: 'RS256', kid: 'k9' }, claims({ iss: `https://${outageTeam}` }));
    const deps = {
      fetchJwks: async (): Promise<JwksDocument> => {
        throw new Error('jwks-fetch-failed: 503');
      },
    };
    expect(
      await verifyAccess(accessEnv({ CF_ACCESS_TEAM_DOMAIN: outageTeam }), requestWith({ 'Cf-Access-Jwt-Assertion': token }), deps),
    ).toBe(false);
  });
});
