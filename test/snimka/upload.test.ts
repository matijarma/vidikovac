// scripts/snimka/upload.mjs --only-changed: the keys absent from the remote listing or of another size go up, manifest.json always and last.
import { describe, expect, it } from 'vitest';
// @ts-expect-error the script is plain ESM without types
import { changedOnly, PREFIX } from '../../scripts/snimka/upload.mjs';

const item = (key: string, bytes: number) => ({ key, bytes, type: 'application/json' });

describe('upload --only-changed', () => {
  it('keeps absent keys and size differences, drops equal ones, ends with the manifest', () => {
    const list = [item('a.0000000000000001.json', 10), item('b.0000000000000002.json', 20), item('c.0000000000000003.json', 30), item('manifest.json', 500)];
    const remote = new Map<string, number>([[`${PREFIX}a.0000000000000001.json`, 10], [`${PREFIX}b.0000000000000002.json`, 21], [`${PREFIX}manifest.json`, 500]]);
    const keys = (changedOnly(list, remote) as { key: string }[]).map((i) => i.key);
    expect(keys).toEqual(['b.0000000000000002.json', 'c.0000000000000003.json', 'manifest.json']);
  });

  it('puts only the manifest when nothing else changed', () => {
    const list = [item('a.0000000000000001.json', 10), item('manifest.json', 500)];
    const remote = new Map<string, number>([[`${PREFIX}a.0000000000000001.json`, 10], [`${PREFIX}manifest.json`, 500]]);
    expect((changedOnly(list, remote) as { key: string }[]).map((i) => i.key)).toEqual(['manifest.json']);
  });
});
