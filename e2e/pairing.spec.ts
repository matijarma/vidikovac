// The mechanic, end to end, in a real browser: a screen mints a rotating code,
// a phone in a separate browser context opens the QR's URL, confirms, and both
// devices show the same session; the phone's data token gates /api/data; the
// code is single-use; and with a 12-second session both observe the expiry.
import { devices, expect, test, type Browser, type BrowserContext } from '@playwright/test';
import {
  APP_URL,
  SHORT_URL,
  health,
  provisionKiosk,
  readDataToken,
  readPairing,
  unlockOnPhone,
} from './helpers';
import { CODE_RE } from './lib';

async function twoContexts(browser: Browser): Promise<{ kioskCtx: BrowserContext; phoneCtx: BrowserContext }> {
  const kioskCtx = await browser.newContext({ ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } });
  const phoneCtx = await browser.newContext({ ...devices['Pixel 7'] });
  return { kioskCtx, phoneCtx };
}

test.describe('pairing: a public screen and a phone', () => {
  test('one-hop sharing gives a second phone its own five minutes without extending or taking over the original session', async ({ browser, request }) => {
    const { kioskCtx, phoneCtx } = await twoContexts(browser);
    const peerCtx = await browser.newContext({ ...devices['Pixel 7'], locale: 'hr-HR' });
    try {
      const { kioskUrl } = await provisionKiosk(request, APP_URL);
      const kiosk = await kioskCtx.newPage();
      await kiosk.goto(kioskUrl);
      const { scanUrl } = await readPairing(kiosk, APP_URL);
      const phone = await phoneCtx.newPage();
      await unlockOnPhone(phone, scanUrl, '10 minuta');
      const originalExpiry = await phone.getByTestId('session-label').getAttribute('data-expires-at');
      await phone.getByTestId('session-label').click();
      await phone.getByTestId('share-city').click();
      const code = phone.getByTestId('share-code');
      await expect(code).toHaveText(CODE_RE);
      const peer = await peerCtx.newPage();
      const raw = (await code.textContent())!.trim();
      await unlockOnPhone(peer, `${APP_URL}/s/#${raw}`, '5 minuta');
      const peerExpiry = Number(await peer.getByTestId('session-label').getAttribute('data-expires-at'));
      expect(peerExpiry - Date.now()).toBeGreaterThan(270_000);
      expect(peerExpiry - Date.now()).toBeLessThanOrEqual(300_000);
      const room = (url: string) => new URLSearchParams(new URL(url).hash.slice(1)).get('room');
      expect(room(peer.url())).not.toBe(room(phone.url()));
      await expect(phone.getByTestId('session-label')).toHaveAttribute('data-expires-at', originalExpiry!);
      await expect(kiosk.getByTestId('session-label')).toHaveAttribute('data-expires-at', originalExpiry!);
      await peer.getByTestId('session-label').click();
      await expect(peer.getByTestId('session-sheet')).toBeVisible();
      await expect(peer.getByTestId('share-city')).toHaveCount(0);
      const reuse = await request.post(`${APP_URL}/api/scan`, { data: { code: raw } });
      expect((await reuse.json()).error).toBe('code-used');
      const token = await readDataToken(peer);
      const allowed = await peer.request.get(`${APP_URL}/api/data/zet-rt`, { headers: { authorization: `Bearer ${token}` } });
      expect(allowed.status()).toBe(200);
    } finally {
      await peerCtx.close();
      await phoneCtx.close();
      await kioskCtx.close();
    }
  });
  test('a scan unlocks both devices, the token gates /api/data, the code is single-use', async ({ browser, request }) => {
    expect((await health(request, APP_URL)).networkCheck).toBe('off');
    const { kioskCtx, phoneCtx } = await twoContexts(browser);
    try {
      const { kioskUrl } = await provisionKiosk(request, APP_URL);
      const kiosk = await kioskCtx.newPage();
      await kiosk.goto(kioskUrl);
      const { code, scanUrl } = await readPairing(kiosk, APP_URL);
      const phone = await phoneCtx.newPage();

      // Same-Wi-Fi pairing is a supported journey, on the deployed app too.
      await unlockOnPhone(phone, scanUrl, '10 minuta');

      // Both devices are in the same session: identical expiry down to the millisecond.
      const kioskLabel = kiosk.getByTestId('session-label');
      await expect(kioskLabel).toBeVisible({ timeout: 30_000 });
      const phoneLabel = phone.getByTestId('session-label');
      const [kioskExpiry, phoneExpiry] = await Promise.all([
        kioskLabel.getAttribute('data-expires-at'),
        phoneLabel.getAttribute('data-expires-at'),
      ]);
      expect(kioskExpiry).toMatch(/^\d{13}$/);
      expect(phoneExpiry).toBe(kioskExpiry);
      // The screen says "Otključano do HH:MM"; the phone names the venue in
      // between ("Otključano · Kavana Velebit · do HH:MM", hr.json
      // session.unlocked), so the shared shape is the word and the time.
      await expect(kioskLabel).toContainText(/Otključano.*do \d{1,2}:\d{2}/);
      await expect(phoneLabel).toContainText(/Otključano.*do \d{1,2}:\d{2}/);

      // The phone's stateless data token opens the session tier; nothing else does.
      const token = await readDataToken(phone);
      expect(token).toMatch(/^[A-Za-z0-9_-]+\.\d+\.[A-Za-z0-9_-]+$/);
      const allowed = await phone.request.get(`${APP_URL}/api/data/zet-rt`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(allowed.status()).toBe(200);
      const snapshot = await allowed.json();
      expect(snapshot.module).toBe('zet-rt');
      expect(['live', 'stale', 'down']).toContain(snapshot.status);
      expect(snapshot.attribution.text).toContain('Public dataset by ZET provided under Open license');
      const denied = await phone.request.get(`${APP_URL}/api/data/zet-rt`);
      expect(denied.status()).toBe(401);
      const tampered = await phone.request.get(`${APP_URL}/api/data/zet-rt`, {
        headers: { authorization: `Bearer ${token!.slice(0, -2)}AA` },
      });
      expect(tampered.status()).toBe(401);

      // The redeemed code is spent.
      const reuse = await request.post(`${APP_URL}/api/scan`, { data: { code } });
      expect(reuse.status()).toBeGreaterThanOrEqual(400);
      expect(reuse.status()).toBeLessThan(500);
      expect((await reuse.json()).error).toBe('code-used');
    } finally {
      await kioskCtx.close();
      await phoneCtx.close();
    }
  });
});

test.describe('expiry with SESSION_MINUTES=0.2', () => {
  test.skip(!SHORT_URL, 'set E2E_SHORT_URL to a server running with SESSION_MINUTES=0.2');

  test('the phone freezes with the closing line and the screen shows the QR again', async ({ browser, request }) => {
    const base = SHORT_URL!;
    expect((await health(request, base)).networkCheck).toBe('off');
    const { kioskCtx, phoneCtx } = await twoContexts(browser);
    try {
      const { kioskUrl } = await provisionKiosk(request, base);
      const kiosk = await kioskCtx.newPage();
      await kiosk.goto(kioskUrl);
      const { scanUrl } = await readPairing(kiosk, base);
      const phone = await phoneCtx.newPage();
      // 12 seconds rounds to 1 minute: Math.max(1, Math.round((expiresAt - now) / 60_000)) per confirmLabel.
      await unlockOnPhone(phone, scanUrl, '1 minuta');
      await expect(kiosk.getByTestId('session-label')).toBeVisible({ timeout: 30_000 });

      // Guard: prove the short server really runs with 0.2 minutes, otherwise fail
      // in seconds with a sentence instead of timing out after two minutes.
      const expiresAt = Number(await phone.getByTestId('session-label').getAttribute('data-expires-at'));
      const secondsLeft = (expiresAt - Date.now()) / 1000;
      expect(secondsLeft, `session is ${secondsLeft.toFixed(0)} s long; is ${base} running with --var SESSION_MINUTES:0.2?`).toBeLessThan(20);

      const token = await readDataToken(phone);

      const frozen = phone.getByTestId('frozen-line');
      await expect(frozen).toBeVisible({ timeout: 45_000 });
      await expect(frozen).toContainText('Sesija je završila. Prikaz je zamrznut.');
      await expect(kiosk.getByTestId('pair-code')).toBeVisible({ timeout: 45_000 });
      await expect(kiosk.getByTestId('session-label')).toHaveCount(0);

      // The token carries its own expiry; the Worker refuses it without asking any DO.
      const late = await phone.request.get(`${base}/api/data/zet-rt`, { headers: { authorization: `Bearer ${token}` } });
      expect(late.status()).toBe(401);
    } finally {
      await kioskCtx.close();
      await phoneCtx.close();
    }
  });
});
