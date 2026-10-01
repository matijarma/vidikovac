// Guards the one duplication Area D carries: OPEN_DATASETS mirrors the ttl and
// tier Area A declares in worker/feed/registry.ts. Open-tier delivery is not
// automatically a republishing offer: R3's three DHMZ modules remain off /open.
import { describe, expect, it } from 'vitest';
import type { ModuleId } from '../../worker/feed/schema';
import { MODULES as specs } from '../../worker/feed/registry';
import { OPEN_DATASETS } from '../../worker/open/catalog';

describe('OPEN_DATASETS mirrors the feed registry', () => {
  it('every catalogued dataset is an open-tier module with the registry ttl', () => {
    for (const dataset of OPEN_DATASETS) {
      const spec = specs[dataset.module];
      expect(spec, dataset.module).toBeDefined();
      expect(spec.tier, `${dataset.module} tier`).toBe('open');
      expect(dataset.ttl, `${dataset.module} ttl`).toBe(spec.ttl);
      expect(dataset.source.url, `${dataset.module} attribution url`).toBe(spec.attribution.url);
    }
  });

  it('every open-tier module is catalogued or explicitly excluded from republishing', () => {
    const openIds = (Object.keys(specs) as ModuleId[]).filter((id) => specs[id].tier === 'open').sort();
    // R3 §0.3 D-E and §0.4: teaser-readable, but not republished as catalogue datasets.
    const notRepublished: ModuleId[] = ['dhmz-bio', 'dhmz-radar', 'dhmz-waves'];
    const catalogued = OPEN_DATASETS.map((d) => d.module);
    for (const id of notRepublished) expect(catalogued).not.toContain(id);
    expect([...catalogued, ...notRepublished].sort()).toEqual(openIds);
  });
});
