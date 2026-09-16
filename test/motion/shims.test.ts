import { describe, expect, it } from 'vitest';
import * as geoShim from '../../app/src/motion/geo';
import * as geoShared from '../../shared/motion/geo';
import * as polylineShim from '../../app/src/motion/polyline';
import * as polylineShared from '../../shared/motion/polyline';

// R-TE15: the app-side paths are pure re-exports of the shared engine code,
// the same function objects, so nothing in the app can drift from what the
// twin computes with. D1 removes the shims once no importer is left.
describe('the app-side geo and polyline paths are shims of shared/motion', () => {
  it('re-export the identical functions', () => {
    expect(geoShim.toPlane).toBe(geoShared.toPlane);
    expect(geoShim.toLonLat).toBe(geoShared.toLonLat);
    expect(geoShim.dist).toBe(geoShared.dist);
    expect(polylineShim.project).toBe(polylineShared.project);
    expect(polylineShim.at).toBe(polylineShared.at);
    expect(polylineShim.tangent).toBe(polylineShared.tangent);
    expect(polylineShim.cumulative).toBe(polylineShared.cumulative);
  });
});
