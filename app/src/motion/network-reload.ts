// The artefact reload past the HTTP cache that a renderer asks for when the
// motion names another rail graph than the one it draws on (city-map.ts
// acceptNetwork, schema-map.ts and schematic-host.ts of the same name) is
// bounded by the poll cadence, not by how often update() runs: the workspace
// also updates its renderer on search input and on every slot repaint, and a
// kiosk repaints its stage every twenty seconds, so a failed reload asked
// again on every update() would fetch the artefact tens of times a minute
// (review of lane/t-schema, finding 1). One attempt per poll interval per
// renderer; recovery on the next interval.

/** The traffic poll cadence (docs/arhitektura.md: "promet svakih 10 s"). */
export const NETWORK_RELOAD_RETRY_MS = 10_000;

export interface ReloadBudget {
  /** True when an attempt may start now; the attempt is then counted. */
  take(now: number): boolean;
  /** An installed graph frees the budget: a further graph is asked for at once. */
  reset(): void;
}

export function createReloadBudget(intervalMs = NETWORK_RELOAD_RETRY_MS): ReloadBudget {
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  return {
    take(now) {
      if (now - lastAttemptAt < intervalMs) return false;
      lastAttemptAt = now;
      return true;
    },
    reset() {
      lastAttemptAt = Number.NEGATIVE_INFINITY;
    },
  };
}
