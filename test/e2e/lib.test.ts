import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET } from '../../worker/protocol';
import { CODE_RE, kioskUrl, parseDevVars, rebaseUrl } from '../../e2e/lib';

describe('CODE_RE', () => {
  it('accepts ABCD-EFGH built from the Crockford alphabet and rejects I, L, O, U', () => {
    expect(CODE_RE.test('7XKQ-M2ZR')).toBe(true);
    expect(CODE_RE.test('ABCD-EFGH')).toBe(true);
    expect(CODE_RE.test('ABCD-EFGI')).toBe(false);
    expect(CODE_RE.test('ABCDEFGH')).toBe(false);
    expect(CODE_RE.test('abcd-efgh')).toBe(false);
    for (const ch of CODE_ALPHABET) expect(CODE_RE.test(`${ch}${ch}${ch}${ch}-${ch}${ch}${ch}${ch}`)).toBe(true);
  });
});

describe('rebaseUrl', () => {
  it('swaps the origin and keeps path, query and fragment', () => {
    expect(rebaseUrl('https://zagreb.aningfilm.hr/s#7XKQ-M2ZR', 'http://localhost:8787')).toBe(
      'http://localhost:8787/s#7XKQ-M2ZR',
    );
    expect(rebaseUrl('https://a.example/x/y?q=1#h', 'https://b.example:8443/')).toBe('https://b.example:8443/x/y?q=1#h');
  });
});

describe('kioskUrl', () => {
  it('rebuilds the kiosk provisioning URL from its fragment on the target origin', () => {
    expect(kioskUrl('https://zagreb.aningfilm.hr/kiosk/#K7Q2M9XZ.s3cr3t-part', 'http://localhost:8788')).toBe(
      'http://localhost:8788/kiosk/#K7Q2M9XZ.s3cr3t-part',
    );
  });
  it('refuses a URL without a beaconId.secret fragment', () => {
    expect(() => kioskUrl('https://zagreb.aningfilm.hr/kiosk/', 'http://localhost:8787')).toThrow(/fragment/);
  });
});

describe('parseDevVars', () => {
  it('reads KEY=VALUE lines, strips quotes, skips comments and blanks', () => {
    const text = [
      '# runtime values for wrangler dev',
      'SESSION_MINUTES=10',
      'NETWORK_CHECK = off',
      'E2E_ADMIN_BYPASS="abc-DEF_123"',
      "SESSION_SECRET='with=equals=inside'",
      '',
    ].join('\n');
    expect(parseDevVars(text)).toEqual({
      SESSION_MINUTES: '10',
      NETWORK_CHECK: 'off',
      E2E_ADMIN_BYPASS: 'abc-DEF_123',
      SESSION_SECRET: 'with=equals=inside',
    });
  });
});
