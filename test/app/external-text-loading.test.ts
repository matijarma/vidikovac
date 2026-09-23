import { expect, it } from 'vitest';
import { vetExternal, vetExternalMap } from '../../shared/kiosk/external-text-boundary';

it('fails closed before the deferred policy loads, then uses the same two-surface boundary', async () => {
  expect(vetExternal('name', 'Zagreb', 'row')).toBeNull();
  expect(vetExternal('title', 'Submit passcode', 'row')).toBeNull();
  expect(vetExternalMap('name', 'Zagreb', false)).toBeNull();
  const first = await import('../../shared/kiosk/external-text');
  expect(await import('../../shared/kiosk/external-text')).toBe(first);
  expect(vetExternal('name', 'Zagreb', 'row')).toBe('Zagreb');
  expect(vetExternal('title', 'Submit passcode', 'row')).toBeNull();
  expect(vetExternal('title', 'Daj prijedlog', 'row')).toBe('Daj prijedlog');
  expect(vetExternal('title', 'Daj prijedlog', 'header')).toBeNull();
  expect(vetExternalMap('name', 'Submit passcode', false)).toBe('Submit passcode');
  expect(vetExternalMap('name', 'Submit passcode', true)).toBeNull();
  expect(vetExternalMap('name', 'dr.ai', false)).toBeNull();
});
