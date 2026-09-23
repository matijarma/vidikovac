// Page-level helpers for the pairing tier. Two browser contexts per test so the
// kiosk and the phone share no storage, exactly like a screen in a café and a
// stranger's phone.
import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { CreateBeaconRequest, CreateBeaconResponse } from '../worker/protocol';
import { CODE_RE, CODE_SHOWN_RE, kioskUrl, parseDevVars, rebaseUrl } from './lib';
import { localNetworkHeaders } from '../scripts/local-network.mjs';

export const APP_URL = process.env.E2E_APP_URL ?? 'http://localhost:8787';
const RUN_ID = randomUUID();

/** A local test is one visitor network, not the combined traffic of every
 *  previous run. Hosted tests never send a synthetic Cloudflare address. */
export function localHeaders(base = APP_URL): Record<string, string> {
  return localNetworkHeaders(base, `${RUN_ID}:${test.info().testId}`);
}
export function localContext(browser: Browser, options: BrowserContextOptions = {}, base = APP_URL): Promise<BrowserContext> {
  return browser.newContext({ ...options, extraHTTPHeaders: { ...options.extraHTTPHeaders, ...localHeaders(base) } });
}
export async function isolateLocalNetwork(context: BrowserContext, base = APP_URL): Promise<void> {
  const headers = localHeaders(base);
  if (Object.keys(headers).length) await context.setExtraHTTPHeaders(headers);
}
/** The stop the Prozor proofs give their screen (DEFAULT_STOP_ID on both sides of the wire, the wizard's preselection):
 *  Trg bana J. Jelačića, platform 1. The id is a literal here because Playwright's own loader cannot follow either
 *  module's JSON imports. */
export const E2E_STOP_ID = '106_1';
/** Server running with SESSION_MINUTES=0.2; undefined when pointed at a hosted target without one. */
export const SHORT_URL: string | undefined = process.env.E2E_NO_WEBSERVER
  ? process.env.E2E_SHORT_URL
  : (process.env.E2E_SHORT_URL ?? 'http://localhost:8788');

export interface Health {
  ok: boolean;
  version: string;
  networkCheck: 'enforce' | 'warn' | 'off';
  time: string;
}

export async function health(request: APIRequestContext, base: string): Promise<Health> {
  const res = await request.get(`${base}/api/health`);
  expect(res.status(), `${base}/api/health`).toBe(200);
  return (await res.json()) as Health;
}

/** E2E_ADMIN_BYPASS from the environment, else from .dev.vars (gitignored). */
export function adminBypassToken(): string | undefined {
  if (process.env.E2E_ADMIN_BYPASS) return process.env.E2E_ADMIN_BYPASS;
  if (existsSync('.dev.vars')) return parseDevVars(readFileSync('.dev.vars', 'utf8')).E2E_ADMIN_BYPASS;
  return undefined;
}

/** A screen to test against: the pre-provisioned E2E screen (E2E_KIOSK_URL) or a fresh one via the test-only bypass. */
export async function provisionKiosk(
  request: APIRequestContext,
  base: string,
  /** The admin route provisions a screen without a stop unless one is named, which no café screen is (the wizard always
   *  picks one): the Prozor proofs pass `{ stopId: E2E_STOP_ID }`, since the transit statement, the stop ring, the
   *  stop-scoped teaser and the lines board all follow from the stop. The phone-session proofs (a11y, motion) and the
   *  box-scoped lagano board proofs were written against the stopless screen and keep it -- a stop-bearing screen opens
   *  the phone's U pokretu sheet on a route of that stop, which is the phone's own behaviour to settle
   *  (task-WB-report.md, concerns), and the stopless board lists the box, which those specs' teaser stubs feed. */
  options: { stopId?: string } = {},
): Promise<{ kioskUrl: string; beaconId: string }> {
  const preset = process.env.E2E_KIOSK_URL;
  if (preset) {
    return { kioskUrl: kioskUrl(preset, base), beaconId: new URL(preset).hash.slice(1).split('.')[0] };
  }
  const token = adminBypassToken();
  if (!token) {
    throw new Error(
      'No E2E_KIOSK_URL and no E2E_ADMIN_BYPASS (env or .dev.vars): cannot provision a test screen. See docs/kiosk.md, section "Testni zaslon".',
    );
  }
  const body: CreateBeaconRequest = { venueType: 'kafic', area: 'Donji grad', operatorLabel: 'E2E testni zaslon', ...(options.stopId ? { stopId: options.stopId } : {}) };
  const res = await request.post(`${base}/api/admin/beacons`, { headers: { 'x-e2e-admin-bypass': token }, data: body });
  expect([200, 201], `POST /api/admin/beacons answered ${res.status()}: ${await res.text()}`).toContain(res.status());
  const json = (await res.json()) as CreateBeaconResponse;
  expect(json.beaconId).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  return { kioskUrl: kioskUrl(json.provisionUrl, base), beaconId: json.beaconId };
}

/** Waits for the kiosk's rotating code and returns it with the QR's URL rebased onto `base`. */
export async function readPairing(kiosk: Page, base: string): Promise<{ code: string; scanUrl: string }> {
  const codeEl = kiosk.getByTestId('kiosk-code');
  await expect(codeEl).toHaveText(CODE_SHOWN_RE, { timeout: 30_000 });
  // The kiosk paints the code and the link in one step; read them in one step too, or a
  // rotation between two round trips hands back the old code with the new link. The shown
  // code carries a middle dot; the typed and URL form joins its two groups with a hyphen.
  const { code, href } = await kiosk.evaluate(() => {
    const part = (id: string): string => (document.querySelector(`[data-testid=${id}]`)?.textContent ?? '').trim();
    const u = document.querySelector('[data-testid=pair-url]');
    return { code: `${part('code-a')}-${part('code-b')}`, href: (u?.getAttribute('href') ?? u?.textContent ?? '').trim() };
  });
  expect(code).toMatch(CODE_RE);
  expect(href, 'pair-url must carry the displayed code in its fragment').toContain(`#${code}`);
  return { code, scanUrl: rebaseUrl(href, base) };
}

/**
 * Phone side: redeem the real code and land directly in the granted session.
 * The remaining argument is retained for callers distinguishing ordinary and
 * short-lived expiry scenarios; no redundant unlock screen is expected.
 */
export async function unlockOnPhone(phone: Page, scanUrl: string, expectedMinutesText: string): Promise<void> {
  await phone.goto(scanUrl);
  await expect(phone.getByTestId('session-label')).toBeVisible({ timeout: 30_000 });
  await expect(phone.getByTestId('session-label')).toHaveAttribute('data-state', 'live', { timeout: 30_000 });
  await expect(phone.getByTestId('session-label')).toHaveAttribute('data-expires-at', /^\d{13}$/);
}

export function readDataToken(phone: Page): Promise<string | null> {
  return phone.evaluate(() => sessionStorage.getItem('vidikovac.dataToken'));
}
