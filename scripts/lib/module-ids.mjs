// Shared by test/docs/docs.test.ts (Task E4) and scripts/check-plan-links.mjs
// (Task E7): one reading of the `ModuleId` union so the two never drift
// (controller ruling R-18).

/** Reads the `ModuleId` union out of worker/feed/schema.ts's source text. */
export function moduleIdsFromSchema(src) {
  const m = src.match(/export type ModuleId =([\s\S]*?);/);
  if (!m) throw new Error('ModuleId union not found in worker/feed/schema.ts');
  return [...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]);
}
