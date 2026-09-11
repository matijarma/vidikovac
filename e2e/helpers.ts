// Page-level helpers for the pairing tier. Two browser contexts per test so the
// kiosk and the phone share no storage, exactly like a screen in a café and a
// stranger's phone.
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import type { CreateBeaconRequest, CreateBeaconResponse } from '../worker/protocol';
import { CODE_RE, kioskUrl, parseDevVars, rebaseUrl } from './lib';

export const APP_URL = process.env.E2E_APP_URL ?? 'http://localhost:8787';
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
  const body: CreateBeaconRequest = { venueType: 'kafic', area: 'Donji grad', operatorLabel: 'E2E testni zaslon' };
  const res = await request.post(`${base}/api/admin/beacons`, { headers: { 'x-e2e-admin-bypass': token }, data: body });
  expect([200, 201], `POST /api/admin/beacons answered ${res.status()}: ${await res.text()}`).toContain(res.status());
  const json = (await res.json()) as CreateBeaconResponse;
  expect(json.beaconId).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  return { kioskUrl: kioskUrl(json.provisionUrl, base), beaconId: json.beaconId };
}

/** Waits for the kiosk's rotating code and returns it with the QR's URL rebased onto `base`. */
export async function readPairing(kiosk: Page, base: string): Promise<{ code: string; scanUrl: string }> {
  const codeEl = kiosk.getByTestId('pair-code');
  await expect(codeEl).toHaveText(CODE_RE, { timeout: 30_000 });
  const code = ((await codeEl.textContent()) ?? '').trim();
  const urlEl = kiosk.getByTestId('pair-url');
  const href = ((await urlEl.getAttribute('href')) ?? (await urlEl.textContent()) ?? '').trim();
  expect(href, 'pair-url must carry the displayed code in its fragment').toContain(`#${code}`);
  return { code, scanUrl: rebaseUrl(href, base) };
}

/** Phone side: open the scanned URL, read the confirm card, press Otključaj, wait for the session label. */
export async function unlockOnPhone(phone: Page, scanUrl: string): Promise<void> {
  await phone.goto(scanUrl);
  const card = phone.getByTestId('confirm-card');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('10 minuta');
  await phone.getByRole('button', { name: 'Otključaj' }).click();
  await expect(phone.getByTestId('session-label')).toBeVisible({ timeout: 30_000 });
}

export function readDataToken(phone: Page): Promise<string | null> {
  return phone.evaluate(() => sessionStorage.getItem('vidikovac.dataToken'));
}
