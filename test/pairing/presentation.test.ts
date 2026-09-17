import { describe, expect, it } from 'vitest';
import { parsePresentationCommand, parsePresentationTarget } from '../../worker/presentation';

describe('public presentation vocabulary', () => {
  it('accepts a domain, public selection, district and time scope', () => {
    const target = { layer: 'kvart', district: 'trnje', time: 'veceras' };
    expect(parsePresentationTarget(target)).toEqual(target);
    expect(parsePresentationTarget({ layer: 'u-pokretu', selection: { kind: 'route', id: '6' } })).not.toBeNull();
  });
  it.each([
    { layer: 'grad-sada', query: 'my private search' },
    { layer: 'u-pokretu', center: [15.9, 45.8] },
    { layer: 'kvart', district: 'arbitrary address' },
    { layer: 'kultura', time: 'made-up' },
    { layer: 'grad-sada', selection: { kind: 'route', id: '6', lat: 45 } },
    { layer: 'unknown' }, null,
  ])('rejects private or unknown context: %j', target => {
    expect(parsePresentationTarget(target)).toBeNull();
  });
  it('requires a version, idempotency key and nonnegative revision', () => {
    const command = { version: 1, requestId: 'request_1', action: 'present', expectedRevision: 0, target: { layer: 'kultura' } };
    expect(parsePresentationCommand(command)).toEqual(command);
    expect(parsePresentationCommand({ ...command, version: 2 })).toBeNull();
    expect(parsePresentationCommand({ ...command, expectedRevision: -1 })).toBeNull();
    expect(parsePresentationCommand({ ...command, target: undefined })).toBeNull();
    expect(parsePresentationCommand({ ...command, secret: 'no' })).toBeNull();
  });
  it('a stop cannot smuggle a target or takeover', () => {
    const stop = { version: 1, requestId: 'stop', action: 'stop', expectedRevision: 4 };
    expect(parsePresentationCommand(stop)).toEqual(stop);
    expect(parsePresentationCommand({ ...stop, takeover: true })).toBeNull();
    expect(parsePresentationCommand({ ...stop, target: { layer: 'kultura' } })).toBeNull();
  });
});
