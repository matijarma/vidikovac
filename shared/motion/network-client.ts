// Thin browser entry: lightweight screens need neither the geometry decoder nor its graph machinery.
import type { GraphNetwork, Network } from './network';
export type { GraphNetwork, Network } from './network';

/** Preserve loadNetwork's null-on-failure contract without loading its decoder in lightweight mode. */
export async function loadNetwork(fetchImpl: typeof fetch = fetch, lightweight = false): Promise<GraphNetwork | null> {
  if (lightweight) return null;
  try {
    const network = await import('./network');
    return await network.loadNetwork(fetchImpl);
  } catch {
    return null;
  }
}

/** The route's normal shapes, with the existing fallback for older artefacts. */
export function mainShapes(net: Pick<Network, 'routes'>, routeId: string): number[] {
  const route = net.routes.get(routeId);
  if (!route) return [];
  return route.main && route.main.length > 0 ? route.main : route.shapes;
}
