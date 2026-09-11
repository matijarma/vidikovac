// Route names come from the static ZET GTFS, converted by scripts/gtfs-routes.mjs
// (Area E) into app/src/data/zet-routes.json, which Area C also imports for the
// panels. The Worker only enriches titles with it, so a missing or malformed
// file degrades to bare route ids instead of failing a fetch.

export interface ZetRoute {
  shortName: string;
  longName: string;
  type: string | number;
}

export type ZetRoutes = Record<string, ZetRoute>;

let cached: ZetRoutes | null = null;

export async function loadZetRoutes(): Promise<ZetRoutes> {
  if (cached) return cached;
  try {
    const module = (await import('../../../app/src/data/zet-routes.json')) as { default?: ZetRoutes };
    cached = module.default ?? {};
  } catch {
    cached = {};
  }
  return cached;
}
