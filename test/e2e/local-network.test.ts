import { describe, expect, it } from 'vitest';
import { localNetworkHeaders } from '../../scripts/local-network.mjs';
import { addressPrefix } from '../../worker/pairing/netkey';

describe('local browser network isolation', () => {
  it('uses the same network for every browser in one scenario and a different one in the next', () => {
    const a = localNetworkHeaders('http://127.0.0.1:5178', 'scenario-a')['CF-Connecting-IP']!;
    const again = localNetworkHeaders('http://localhost:8787', 'scenario-a')['CF-Connecting-IP']!;
    const b = localNetworkHeaders('http://[::1]:8788', 'scenario-b')['CF-Connecting-IP']!;
    expect(a).toBe(again);
    expect(a).toMatch(/^2001:db8:/);
    expect(addressPrefix(a)).toBeTruthy();
    expect(addressPrefix(a)).not.toBe(addressPrefix(b));
  });
  it('never sends synthetic edge headers to a hosted or lookalike origin', () => {
    for (const base of ['https://zagreb.aningfilm.hr', 'https://localhost.example', 'https://127.0.0.1.example', 'file:///kiosk/']) {
      expect(localNetworkHeaders(base, 'scenario')).toEqual({});
    }
  });
});
