// Guards the one duplication Area D carries: OPEN_DATASETS mirrors the ttl and
// tier Area A declares in worker/feed/registry.ts. If Area A's export is not
// named MODULES, change the import below (one line) and nothing else.
//
// Area A builds worker/feed/registry.ts in parallel; until it lands in this
// worktree the dynamic import fails and the whole describe block is skipped
// (controller ruling R-06) rather than failing the file at collection time.
import { describe, expect, it } from 'vitest';
import type { ModuleId, ModuleSpec } from '../../worker/feed/schema';
import { OPEN_DATASETS } from '../../worker/open/catalog';

const registry = await import('../../worker/feed/registry').catch(() => null);
const registryMissing = registry === null;
const specs = (registry?.MODULES ?? {}) as Record<ModuleId, ModuleSpec>;

describe.skipIf(registryMissing)('OPEN_DATASETS mirrors the feed registry', () => {
  it('every catalogued dataset is an open-tier module with the registry ttl', () => {
    for (const dataset of OPEN_DATASETS) {
      const spec = specs[dataset.module];
      expect(spec, dataset.module).toBeDefined();
      expect(spec.tier, `${dataset.module} tier`).toBe('open');
      expect(dataset.ttl, `${dataset.module} ttl`).toBe(spec.ttl);
      expect(dataset.source.url, `${dataset.module} attribution url`).toBe(spec.attribution.url);
    }
  });

  it('every open-tier module in the registry is catalogued', () => {
    const openIds = (Object.keys(specs) as ModuleId[]).filter((id) => specs[id].tier === 'open').sort();
    expect(OPEN_DATASETS.map((d) => d.module).sort()).toEqual(openIds);
  });
});
