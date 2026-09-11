import { describe, expect, it } from 'vitest';
import { networkCheck, sessionMinutes } from '../../worker/config';
import type { Env } from '../../worker/env';

const env = (overrides: Partial<Env> = {}): Env => ({ ...(overrides as Env) });

describe('config defaults (unit project smoke)', () => {
  it('falls back to 10 minutes and enforce', () => {
    expect(sessionMinutes(env())).toBe(10);
    expect(networkCheck(env())).toBe('enforce');
  });
  it('reads overrides and rejects nonsense', () => {
    expect(sessionMinutes(env({ SESSION_MINUTES: '0.2' }))).toBe(0.2);
    expect(sessionMinutes(env({ SESSION_MINUTES: 'abc' }))).toBe(10);
    expect(networkCheck(env({ NETWORK_CHECK: 'warn' }))).toBe('warn');
    expect(networkCheck(env({ NETWORK_CHECK: 'bogus' }))).toBe('enforce');
  });
});
