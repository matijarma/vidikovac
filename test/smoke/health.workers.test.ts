import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('/api/health (workers project smoke)', () => {
  it('answers with ok, version and the test network mode', async () => {
    const res = await SELF.fetch('https://vidikovac.test/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string; networkCheck: string };
    expect(body.ok).toBe(true);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.networkCheck).toBe('off');
  });
  it('returns JSON 404 for unknown api paths', async () => {
    const res = await SELF.fetch('https://vidikovac.test/api/nothing');
    expect(res.status).toBe(404);
  });
});
